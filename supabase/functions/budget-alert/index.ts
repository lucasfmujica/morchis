// Sends a web push when a budget first crosses 80% / 100% for the month.
// Called (fire-and-forget) by the client right after a transaction is saved.
// The caller is always online at save time, so this also reaches the *other*
// partner whose budget moved because of a shared expense — even with their app
// closed. Dedupe state lives in `budget_alerts` so each threshold fires once
// per budget per month.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

interface Split { payer_profile_id: string; ower_profile_id: string; amount: number }
interface ExpenseRow {
  category_id: string | null;
  amount: number;
  currency: string;
  scope: string;
  profile_id: string;
  is_shared: boolean;
  splits?: Split[] | null;
}
interface Budget {
  id: string;
  // null = total limit for the period (all categories)
  category_id: string | null;
  scope: string;
  amount: number;
  currency: string | null;
  profile_id: string | null;
  period?: string;
}

function toArs(amount: number, currency: string | null | undefined, rate: number): number {
  return currency === "USD" && rate > 0 ? Math.round(amount * rate) : amount;
}

function myShareArs(t: ExpenseRow, profileId: string, rate: number): number {
  const total = toArs(t.amount, t.currency, rate);
  if (!t.is_shared) return total;
  const splits = t.splits ?? [];
  const iOwe = splits.filter((s) => s.ower_profile_id === profileId).reduce((a, s) => a + s.amount, 0);
  if (iOwe > 0) return iOwe;
  const owedToMe = splits.filter((s) => s.payer_profile_id === profileId).reduce((a, s) => a + s.amount, 0);
  if (owedToMe > 0) return Math.max(0, total - owedToMe);
  return t.profile_id === profileId ? total : 0;
}

function spentForBudget(b: Budget, rows: ExpenseRow[], rate: number): number {
  const owner = b.profile_id ?? "";
  return rows
    // A total budget (no category) counts every expense; a category budget only its own.
    .filter((t) => b.category_id == null || t.category_id === b.category_id)
    .reduce((sum, t) => {
      if (b.scope === "household") {
        return t.scope === "household" ? sum + toArs(t.amount, t.currency, rate) : sum;
      }
      if (t.is_shared) return sum + myShareArs(t, owner, rate);
      // Non-shared: the owner's spend when they fronted it — a solo expense or a
      // household one they paid without dividing (mirrors the in-app helper).
      return t.profile_id === owner ? sum + toArs(t.amount, t.currency, rate) : sum;
    }, 0);
}

function levelFor(pct: number): 0 | 80 | 100 {
  if (pct >= 1) return 100;
  if (pct >= 0.8) return 80;
  return 0;
}

// "now" in Argentina (UTC-3, no DST) — the server clock is UTC and would
// roll to tomorrow / next month after 21:00 local.
const artNow = () => new Date(Date.now() - 3 * 60 * 60 * 1000);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Identify the caller.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    if (!VAPID_PRIVATE || !VAPID_PUBLIC) {
      return json({ error: "VAPID keys not configured" }, 200);
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: me } = await admin.from("profiles").select("household_id").eq("id", user.id).single();
    const householdId = me?.household_id;
    if (!householdId) return json({ error: "no household" }, 200);

    const now = artNow();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthStart = `${period}-01`;
    // Cap at month end so a future-month installment cuota doesn't inflate spend
    // and fire a false over-budget alert.
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const monthEnd = `${period}-${String(lastDay).padStart(2, "0")}`;

    const [{ data: budgets }, { data: rows }, { data: fx }] = await Promise.all([
      admin.from("budgets").select("id, category_id, scope, amount, currency, profile_id, period")
        .eq("household_id", householdId).eq("active", true),
      admin.from("transactions")
        .select("category_id, amount, currency, scope, profile_id, is_shared, splits(payer_profile_id, ower_profile_id, amount)")
        .eq("household_id", householdId).eq("type", "expense").gte("occurred_on", monthStart).lte("occurred_on", monthEnd),
      admin.from("fx_rates").select("ars_per_usd").eq("source", "blue").order("date", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const rate = (fx?.ars_per_usd as number) ?? FALLBACK_RATE;
    const expenseRows = (rows ?? []) as ExpenseRow[];
    const activeBudgets = (budgets ?? []) as Budget[];

    // Existing dedupe state for this month.
    const { data: prior } = await admin.from("budget_alerts")
      .select("budget_id, level").eq("period", period)
      .in("budget_id", activeBudgets.map((b) => b.id).length ? activeBudgets.map((b) => b.id) : ["00000000-0000-0000-0000-000000000000"]);
    const priorLevel = new Map<string, number>((prior ?? []).map((p) => [p.budget_id as string, p.level as number]));

    // Members who haven't turned budget alerts off (absent pref = enabled).
    const { data: members } = await admin.from("profiles").select("id, notification_prefs").eq("household_id", householdId);
    const memberIds = (members ?? [])
      .filter((m) => ((m.notification_prefs as Record<string, boolean> | null)?.budget_alerts) !== false)
      .map((m) => m.id as string);

    const { data: cats } = await admin.from("categories").select("id, name").eq("household_id", householdId);
    const catName = new Map<string, string>((cats ?? []).map((c) => [c.id as string, c.name as string]));

    let sent = 0;
    for (const b of activeBudgets) {
      // Weekly budgets are tracked in-app; their push alerts (with a weekly
      // window + weekly dedupe) are a separate follow-up, so skip them here to
      // avoid firing a false alert computed over the whole month.
      if (b.period === "weekly") continue;
      const limit = toArs(b.amount, b.currency, rate);
      if (limit <= 0) continue;
      const spent = spentForBudget(b, expenseRows, rate);
      const level = levelFor(spent / limit);
      const prev = priorLevel.get(b.id) ?? 0;
      if (level <= prev) {
        // Reset the stored level if spend fell back (e.g. new month / deletions).
        if (level !== prev) await admin.from("budget_alerts").upsert({ budget_id: b.id, period, level });
        continue;
      }

      // Personal-budget pushes also go through the pref filter (memberIds
      // only contains people who keep budget alerts on).
      const targets = b.scope === "household" ? memberIds : b.profile_id ? memberIds.filter((id) => id === b.profile_id) : [];
      const name = b.category_id == null ? "tu límite total" : catName.get(b.category_id) ?? "tu presupuesto";
      const over = level === 100;
      const payload = JSON.stringify({
        title: over ? "🚨 Presupuesto excedido" : "⚠️ Cerca del límite",
        body: over ? `Te pasaste del presupuesto de ${name}.` : `Vas por el ${Math.round((spent / limit) * 100)}% del presupuesto de ${name}.`,
        url: "/presupuestos",
      });
      sent += await pushToProfiles(admin, targets, payload);
      await admin.from("budget_alerts").upsert({ budget_id: b.id, period, level });
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
      // Subscription is gone → prune it so we stop trying.
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
