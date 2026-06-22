// Sends a web push when an envelope (category) first goes OVERSPENT this month,
// or when a person's "Para asignar" (Ready to Assign) goes negative. Called
// (fire-and-forget) by the client right after a transaction is saved. The caller
// is always online, so this also reaches the *other* partner whose budget moved
// because of a shared expense. Dedupe lives in `envelope_alerts` (one row per
// person/alert/month); a row is removed when the condition clears so it can
// re-alert later. Mirrors the in-app math in src/lib/envelope.ts.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { toArs, onBudgetCashArs, activityByCategoryMonth, availableByCategory, readyToAssign, formatArs } from "./math.ts";
import type { Tx, Account, Assignment } from "./math.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:lucasfmujica@gmail.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FALLBACK_RATE = 1200;


// "now" in Argentina (UTC-3, no DST) — the server clock is UTC.
const artNow = () => new Date(Date.now() - 3 * 60 * 60 * 1000);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    if (!VAPID_PRIVATE || !VAPID_PUBLIC) return json({ error: "VAPID keys not configured" }, 200);
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: me } = await admin.from("profiles").select("household_id").eq("id", user.id).single();
    const householdId = me?.household_id;
    if (!householdId) return json({ error: "no household" }, 200);

    const now = artNow();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const monthEnd = `${period}-${String(lastDay).padStart(2, "0")}`;

    const [
      { data: bmonths }, { data: txs }, { data: accs }, { data: debts },
      { data: targets }, { data: cats }, { data: fx }, { data: members },
    ] = await Promise.all([
      admin.from("budget_months").select("profile_id, category_id, month, assigned, currency")
        .eq("household_id", householdId).lte("month", period),
      admin.from("transactions")
        .select("id, type, category_id, amount, currency, scope, profile_id, is_shared, occurred_on, account_id, transfer_account_id, splits(payer_profile_id, ower_profile_id, amount)")
        .eq("household_id", householdId).lte("occurred_on", monthEnd),
      admin.from("accounts").select("id, type, currency, archived, initial_balance, owner_profile_id, on_budget, payment_category_id")
        .eq("household_id", householdId),
      admin.from("debts").select("transaction_id, amount, currency")
        .eq("household_id", householdId).eq("direction", "owed").not("transaction_id", "is", null),
      admin.from("category_targets").select("profile_id, category_id, target_amount, currency")
        .eq("household_id", householdId),
      admin.from("categories").select("id, name").eq("household_id", householdId),
      admin.from("fx_rates").select("ars_per_usd").eq("source", "blue").order("date", { ascending: false }).limit(1).maybeSingle(),
      admin.from("profiles").select("id, notification_prefs").eq("household_id", householdId),
    ]);

    const rate = (fx?.ars_per_usd as number) ?? FALLBACK_RATE;
    const tx = (txs ?? []) as Tx[];
    const accounts = (accs ?? []) as Account[];
    const assignments = (bmonths ?? []) as Assignment[];

    const payMap = new Map<string, string>();
    for (const a of accounts) if (a.type === "credit" && a.payment_category_id) payMap.set(a.id, a.payment_category_id);

    const receivableMap = new Map<string, number>();
    for (const d of (debts ?? []) as { transaction_id: string; amount: number; currency: string }[]) {
      receivableMap.set(d.transaction_id, (receivableMap.get(d.transaction_id) ?? 0) + toArs(d.amount, d.currency, rate));
    }

    // Per (person, category): monthly target + assignment, to gate overspend
    // alerts to envelopes the person is actually budgeting (avoids spamming on
    // never-funded categories where spend just makes "available" negative).
    const targetKey = (p: string, c: string) => `${p}|${c}`;
    const targetByPC = new Map<string, number>();
    for (const t of (targets ?? []) as { profile_id: string; category_id: string; target_amount: number; currency: string }[]) {
      targetByPC.set(targetKey(t.profile_id, t.category_id), toArs(t.target_amount, t.currency, rate));
    }
    const assignedThisMonthByPC = new Map<string, number>();
    for (const a of assignments) {
      if (a.month !== period) continue;
      const k = targetKey(a.profile_id, a.category_id);
      assignedThisMonthByPC.set(k, (assignedThisMonthByPC.get(k) ?? 0) + toArs(a.assigned, a.currency, rate));
    }

    const catName = new Map<string, string>((cats ?? []).map((c) => [c.id as string, c.name as string]));

    const memberIds = (members ?? [])
      .filter((m) => ((m.notification_prefs as Record<string, boolean> | null)?.budget_alerts) !== false)
      .map((m) => m.id as string);

    // Existing dedupe state for this month.
    const { data: prior } = await admin.from("envelope_alerts").select("profile_id, alert_key").eq("period", period);
    const priorKeys = new Set<string>((prior ?? []).map((p) => `${p.profile_id}|${p.alert_key}`));

    let sent = 0;
    for (const member of memberIds) {
      const activity = activityByCategoryMonth(tx, member, rate, payMap, receivableMap);
      const memberAssignments = assignments.filter((a) => a.profile_id === member);
      const available = availableByCategory(memberAssignments, activity, period, rate);
      const cash = onBudgetCashArs(accounts, tx, member, monthEnd, rate);
      const rta = readyToAssign(cash, available);

      // Overspent envelopes (only those the person budgets: target or assignment).
      for (const [catId, av] of available) {
        const budgeted = (targetByPC.get(targetKey(member, catId)) ?? 0) > 0 || (assignedThisMonthByPC.get(targetKey(member, catId)) ?? 0) > 0;
        const overspent = av < 0 && budgeted;
        const dedupeKey = `${member}|${catId}`;
        if (overspent) {
          if (!priorKeys.has(dedupeKey)) {
            const name = catName.get(catId) ?? "un sobre";
            sent += await pushToProfiles(admin, [member], JSON.stringify({
              title: "🔴 Sobregiraste un sobre",
              body: `Te pasaste en ${name} (${formatArs(-av)} de más).`,
              url: "/presupuestos",
            }));
            await admin.from("envelope_alerts").upsert({ profile_id: member, alert_key: catId, period });
          }
        } else if (priorKeys.has(dedupeKey)) {
          await admin.from("envelope_alerts").delete().eq("profile_id", member).eq("alert_key", catId).eq("period", period);
        }
      }

      // "Para asignar" went negative (assigned/fronted more than you have).
      const rtaKey = `${member}|rta`;
      if (rta < 0) {
        if (!priorKeys.has(rtaKey)) {
          sent += await pushToProfiles(admin, [member], JSON.stringify({
            title: "⚠️ Para asignar en negativo",
            body: `Asignaste más de lo que tenés (${formatArs(rta)}). Sacá de algún sobre.`,
            url: "/presupuestos",
          }));
          await admin.from("envelope_alerts").upsert({ profile_id: member, alert_key: "rta", period });
        }
      } else if (priorKeys.has(rtaKey)) {
        await admin.from("envelope_alerts").delete().eq("profile_id", member).eq("alert_key", "rta").eq("period", period);
      }
    }

    return json({ ok: true, sent }, 200);
  } catch (err) {
    console.error("budget-alert error", err);
    return json({ error: String(err) }, 200);
  }
});


async function pushToProfiles(admin: ReturnType<typeof createClient>, profileIds: string[], payload: string): Promise<number> {
  if (profileIds.length === 0) return 0;
  const { data: subs } = await admin.from("push_subscriptions")
    .select("endpoint, p256dh, auth_key").in("profile_id", profileIds);
  let ok = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth_key as string } },
        payload,
      );
      ok++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint as string);
      } else {
        console.error("push send failed", status, err);
      }
    }
  }
  return ok;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
