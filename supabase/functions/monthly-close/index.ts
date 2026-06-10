import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Monthly close: on day 1 (cron) builds a deterministic report of the month
// that just CLOSED — spend vs previous month (nominal and inflation-adjusted),
// savings rate vs target, budget compliance — publishes it as `insights` rows
// (kind 'monthly_close', period = the closed month) and pushes a summary, plus
// a couple settle-up reminder when the running balance warrants it.
// All math is deterministic TypeScript; no LLM involved, numbers are exact.

/* ── web-push (VAPID / RFC 8291) — same implementation as generate-insights ── */
function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = ''; bytes.forEach(b => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')), c => c.charCodeAt(0));
}
function concat(a: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out;
}
async function vapidJWT(aud: string, sub: string, privB64u: string): Promise<string> {
  const enc = new TextEncoder();
  const h = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64uEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 43200, sub })));
  const inp = `${h}.${p}`;
  const key = await crypto.subtle.importKey('pkcs8', b64uDecode(privB64u), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return `${inp}.${b64uEncode(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(inp)))}`;
}
async function encryptWebPush(payload: string, p256dh: string, authKey: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const recPub = b64uDecode(p256dh);
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const srvPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const recKey = await crypto.subtle.importKey('raw', recPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ss = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: recKey }, kp.privateKey as CryptoKey, 256));
  const ikm = await crypto.subtle.importKey('raw', ss, 'HKDF', false, ['deriveBits']);
  const prk = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: b64uDecode(authKey), info: concat([enc.encode('WebPush: info\0'), recPub, srvPub]) }, ikm, 256));
  const pk = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);
  const cek = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: aes128gcm\0') }, pk, 128));
  const nonce = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: nonce\0') }, pk, 96));
  const ck = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, ck, concat([enc.encode(payload), new Uint8Array([2])])));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, ct.length + 1, false);
  return concat([salt, rs, new Uint8Array([srvPub.length]), srvPub, ct]);
}
async function sendWebPush(sub: { endpoint: string; p256dh: string; auth_key: string }, payload: Record<string, string>, vPub: string, vPriv: string): Promise<void> {
  const { origin } = new URL(sub.endpoint);
  const jwt = await vapidJWT(origin, 'mailto:hola@morchis.app', vPriv);
  const ct = await encryptWebPush(JSON.stringify(payload), sub.p256dh, sub.auth_key);
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'TTL': '86400', 'Authorization': `vapid t=${jwt},k=${vPub}` }, body: ct });
  if (!r.ok && r.status !== 201) console.error('Push failed', r.status, await r.text().catch(() => ''));
}
function jwtPayload(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */
// "now" in Argentina (UTC-3, no DST) — the server clock is UTC.
const artNow = () => new Date(Date.now() - 3 * 60 * 60 * 1000);
const isoUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const fmt = (n: number): string => '$' + Math.round(n).toLocaleString('es-AR');
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const toArs = (a: number, cur: string, snap: number | null, blue: number) => cur === 'USD' ? a * (Number(snap) || blue) : a;

interface Split { payer_profile_id: string; ower_profile_id: string; amount: number }
interface Exp { category_id: string | null; categories: { name: string } | null; profile_id: string; scope: string; is_shared: boolean; amount: number; currency: string; usd_rate_snapshot: number | null; splits: Split[] | null }
interface Budget { id: string; category_id: string; scope: string; amount: number; currency: string | null; profile_id: string | null; period: string | null; categories: { name: string } | null }
interface ProfileRow { id: string; nickname: string | null; display_name: string | null; notification_prefs: Record<string, boolean> | null }

// Same per-share math as src/lib/budgets.ts.
function myShareArs(t: Exp, profileId: string, blue: number): number {
  const total = toArs(t.amount, t.currency, t.usd_rate_snapshot, blue);
  if (!t.is_shared) return total;
  const sp = t.splits ?? [];
  const iOwe = sp.filter(s => s.ower_profile_id === profileId).reduce((a, s) => a + s.amount, 0);
  if (iOwe > 0) return iOwe;
  const owedToMe = sp.filter(s => s.payer_profile_id === profileId).reduce((a, s) => a + s.amount, 0);
  if (owedToMe > 0) return Math.max(0, total - owedToMe);
  return t.profile_id === profileId ? total : 0;
}
function spentForBudget(b: Budget, rows: Exp[], blue: number): number {
  const owner = b.profile_id ?? '';
  return rows.filter(t => t.category_id === b.category_id).reduce((sum, t) => {
    if (b.scope === 'household') return t.scope === 'household' ? sum + toArs(t.amount, t.currency, t.usd_rate_snapshot, blue) : sum;
    if (t.is_shared) return sum + myShareArs(t, owner, blue);
    return t.profile_id === owner ? sum + toArs(t.amount, t.currency, t.usd_rate_snapshot, blue) : sum;
  }, 0);
}

function prefOn(p: ProfileRow | undefined, key: string): boolean {
  return (p?.notification_prefs?.[key]) !== false; // absent = enabled
}

async function pushTo(admin: SupabaseClient, profileIds: string[], payload: Record<string, string>, vPub: string, vPriv: string): Promise<void> {
  if (!vPub || !vPriv || profileIds.length === 0) return;
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint,p256dh,auth_key,profile_id').in('profile_id', profileIds);
  for (const s of (subs ?? []) as { endpoint: string; p256dh: string; auth_key: string }[]) {
    try { await sendWebPush(s, payload, vPub, vPriv); } catch (e) { console.error('push err', e); }
  }
}

async function processHousehold(admin: SupabaseClient, hid: string, vPub: string, vPriv: string): Promise<number> {
  const now = artNow();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  // Closed month [m0, m1) and the one before it [b0, m0).
  const m0 = isoUTC(y, m - 1, 1), m1 = isoUTC(y, m, 1), b0 = isoUTC(y, m - 2, 1);
  const closedDate = new Date(Date.UTC(y, m - 1, 1));
  const period = `${closedDate.getUTCFullYear()}-${String(closedDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const monthName = MONTHS[closedDate.getUTCMonth()];

  const expSel = 'category_id,categories(name),profile_id,scope,is_shared,amount,currency,usd_rate_snapshot,splits(payer_profile_id,ower_profile_id,amount)';
  const [curR, prevR, incR, incPrevR, budR, profR, fxR, savR, inflR, splitR, settleR] = await Promise.all([
    admin.from('transactions').select(expSel).eq('household_id', hid).eq('type', 'expense').gte('occurred_on', m0).lt('occurred_on', m1),
    admin.from('transactions').select(expSel).eq('household_id', hid).eq('type', 'expense').gte('occurred_on', b0).lt('occurred_on', m0),
    admin.from('transactions').select('amount,currency,usd_rate_snapshot').eq('household_id', hid).eq('type', 'income').gte('occurred_on', m0).lt('occurred_on', m1),
    admin.from('transactions').select('amount,currency,usd_rate_snapshot').eq('household_id', hid).eq('type', 'income').gte('occurred_on', b0).lt('occurred_on', m0),
    admin.from('budgets').select('id,category_id,scope,amount,currency,profile_id,period,categories(name)').eq('household_id', hid).eq('active', true),
    admin.from('profiles').select('id,nickname,display_name,notification_prefs').eq('household_id', hid),
    admin.from('fx_rates').select('ars_per_usd').eq('source', 'blue').order('date', { ascending: false }).limit(1).maybeSingle(),
    admin.from('savings_goals').select('target_pct').order('month', { ascending: false }).limit(1).maybeSingle(),
    admin.from('inflation_rates').select('monthly_pct,date').gte('date', m0).lt('date', m1).order('date', { ascending: false }).limit(1).maybeSingle(),
    admin.from('splits').select('payer_profile_id,ower_profile_id,amount,transactions!inner(household_id)').eq('transactions.household_id', hid),
    admin.from('settlements').select('from_profile,to_profile,amount').eq('household_id', hid),
  ]);

  const blue = Number(fxR.data?.ars_per_usd ?? 1200);
  const cur = (curR.data ?? []) as unknown as Exp[];
  const prev = (prevR.data ?? []) as unknown as Exp[];
  const profiles = (profR.data ?? []) as ProfileRow[];
  if (cur.length === 0 && (incR.data ?? []).length === 0) return 0; // nothing to close

  const sumInc = (rows: { amount: number; currency: string; usd_rate_snapshot: number | null }[] | null) =>
    (rows ?? []).reduce((s, t) => s + toArs(t.amount, t.currency, t.usd_rate_snapshot, blue), 0);
  const sumExp = (rows: Exp[]) => rows.reduce((s, t) => s + toArs(t.amount, t.currency, t.usd_rate_snapshot, blue), 0);

  const income = sumInc(incR.data as never);
  const expense = sumExp(cur);
  const prevExpense = sumExp(prev);
  const net = income - expense;
  const rate = income > 0 ? Math.round((net / income) * 100) : null;
  const targetPct = Number(savR.data?.target_pct ?? 20);

  // Nominal and inflation-adjusted month-over-month spend change.
  const infl = inflR.data ? Number(inflR.data.monthly_pct) : null;
  let changeTxt = '';
  if (prevExpense > 0) {
    const nomPct = Math.round(((expense - prevExpense) / prevExpense) * 100);
    changeTxt = ` Gasto ${nomPct >= 0 ? '+' : ''}${nomPct}% nominal vs el mes anterior`;
    if (infl != null) {
      const realPct = Math.round(((expense / prevExpense) / (1 + infl / 100) - 1) * 100);
      changeTxt += ` (${realPct >= 0 ? '+' : ''}${realPct}% real, con inflación de ${infl}%)`;
    }
    changeTxt += '.';
  }

  const cards: { title: string; body: string; severity: string }[] = [];

  // 1. Headline summary.
  const rateTxt = rate == null ? '' : ` Ahorraron ${rate}% (${fmt(net)} de ${fmt(income)} de ingresos)${rate >= targetPct ? ' — por encima de la meta' : ` — meta ${targetPct}%`}.`;
  cards.push({
    title: `Cierre de ${monthName}`,
    body: `Gastaron ${fmt(expense)} en total.${rateTxt}${changeTxt}`,
    severity: rate == null ? 'info' : rate < 0 ? 'warning' : rate >= targetPct ? 'positive' : 'info',
  });

  // 2. Top categories + biggest increase (couple view, full amounts).
  const byCat = (rows: Exp[]) => {
    const map: Record<string, number> = {};
    for (const t of rows) { const n = t.categories?.name ?? 'Sin categoría'; map[n] = (map[n] ?? 0) + toArs(t.amount, t.currency, t.usd_rate_snapshot, blue); }
    return map;
  };
  const curCat = byCat(cur), prevCat = byCat(prev);
  const top = Object.entries(curCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) {
    let body = `Top: ${top.map(([n, v]) => `${n} ${fmt(v)}`).join(' · ')}.`;
    const jumps = Object.entries(curCat)
      .map(([n, v]) => ({ n, v, d: v - (prevCat[n] ?? 0) }))
      .filter(x => prevCat[x.n] > 0 && x.d >= 20000 && x.d / prevCat[x.n] >= 0.25)
      .sort((a, b) => b.d - a.d);
    if (jumps.length) body += ` Mayor suba: ${jumps[0].n} (+${fmt(jumps[0].d)} vs el mes anterior).`;
    cards.push({ title: `En qué se fue ${monthName}`, body, severity: jumps.length ? 'warning' : 'info' });
  }

  // 3. Budget compliance over the CLOSED month (monthly budgets only).
  const monthly = ((budR.data ?? []) as unknown as Budget[]).filter(b => b.period !== 'weekly');
  if (monthly.length) {
    const results = monthly.map(b => {
      const limit = toArs(b.amount, b.currency ?? 'ARS', null, blue);
      const spent = spentForBudget(b, cur, blue);
      return { name: b.categories?.name ?? 'Categoría', limit, spent, ok: limit <= 0 || spent <= limit };
    }).filter(r => r.limit > 0);
    if (results.length) {
      const ok = results.filter(r => r.ok).length;
      const worst = results.filter(r => !r.ok).sort((a, b) => (b.spent / b.limit) - (a.spent / a.limit))[0];
      cards.push({
        title: `Presupuestos: ${ok} de ${results.length} cumplidos`,
        body: worst
          ? `Se pasaron en ${worst.name}: ${fmt(worst.spent)} de ${fmt(worst.limit)} (${Math.round((worst.spent / worst.limit) * 100)}%).`
          : 'Cumplieron todos los presupuestos del mes. 🎉',
        severity: worst ? 'warning' : 'positive',
      });
    }
  }

  // Replace any previous close for this period (idempotent re-runs), then insert.
  await admin.from('insights').delete().eq('household_id', hid).eq('kind', 'monthly_close').eq('period', period);
  const { error: insErr } = await admin.from('insights').insert(cards.map(c => ({
    household_id: hid, profile_id: null, period, kind: 'monthly_close',
    title: c.title, body: c.body, severity: c.severity, seen: false,
  })));
  if (insErr) { console.error('insert error', hid, insErr); return 0; }

  // Push the headline (prefs key: monthly_report).
  const reportTargets = profiles.filter(p => prefOn(p, 'monthly_report')).map(p => p.id);
  await pushTo(admin, reportTargets, {
    title: `📋 Cerró ${monthName}`,
    body: `Gastaron ${fmt(expense)}${rate != null ? ` · ahorro ${rate}%` : ''}. Tocá para ver el cierre.`,
    url: '/insights',
  }, vPub, vPriv);

  // Settle-up reminder (prefs key: settle_reminder) — running couple balance.
  if (profiles.length === 2) {
    const [a, b] = profiles;
    const sp = (splitR.data ?? []) as unknown as Split[];
    const st = (settleR.data ?? []) as { from_profile: string; to_profile: string; amount: number }[];
    // net > 0 → b owes a (mirrors useCouple's ledger math).
    const owedToA = sp.filter(s => s.payer_profile_id === a.id).reduce((s, x) => s + x.amount, 0);
    const owedByA = sp.filter(s => s.ower_profile_id === a.id).reduce((s, x) => s + x.amount, 0);
    const paidByA = st.filter(s => s.from_profile === a.id).reduce((s, x) => s + x.amount, 0);
    const paidByB = st.filter(s => s.from_profile === b.id).reduce((s, x) => s + x.amount, 0);
    const netAB = owedToA - owedByA + paidByA - paidByB;
    if (Math.abs(netAB) >= 1000) {
      const debtor = netAB > 0 ? b : a;
      const creditor = netAB > 0 ? a : b;
      const dName = debtor.nickname ?? debtor.display_name ?? 'Tu pareja';
      const cName = creditor.nickname ?? creditor.display_name ?? 'tu pareja';
      const settleTargets = profiles.filter(p => prefOn(p, 'settle_reminder')).map(p => p.id);
      await pushTo(admin, settleTargets, {
        title: '💸 Hora de saldar cuentas',
        body: `${dName} le debe ${fmt(Math.abs(netAB))} a ${cName} — buen momento para arrancar el mes en cero.`,
        url: '/pareja',
      }, vPub, vPriv);
    }
  }

  return cards.length;
}

Deno.serve(async (req: Request) => {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const vPub = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const vPriv = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceKey);

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return new Response('Unauthorized', { status: 401 });
  let requestedHid: string | null = null;
  if (jwtPayload(token)?.role !== 'service_role') {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response('Unauthorized', { status: 401 });
    const { data: prof } = await admin.from('profiles').select('household_id').eq('id', user.id).single();
    if (!prof?.household_id) return new Response('No household', { status: 400 });
    requestedHid = prof.household_id;
  }

  const { data: households } = requestedHid ? { data: [{ id: requestedHid }] } : await admin.from('households').select('id');
  const results: { household_id: string; cards?: number; error?: string }[] = [];
  for (const hh of (households ?? [])) {
    try { results.push({ household_id: hh.id, cards: await processHousehold(admin, hh.id, vPub, vPriv) }); }
    catch (err) { console.error('Error', hh.id, err); results.push({ household_id: hh.id, error: String(err) }); }
  }
  return new Response(JSON.stringify({ ok: true, results }), { headers: cors });
});
