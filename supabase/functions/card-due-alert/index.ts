import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isoOf, fmtARS, nextOccurrence, prevOccurrence, daysBetween } from "./math.ts";

// Daily cron: push a reminder 3 days before (and on) each credit card's due
// date, with the closed cycle's spend so the couple knows roughly how much is
// due. Runs once a day, so each card gets exactly one push at D-3 and one at
// D-0 — no dedupe table needed. Respects profiles.notification_prefs.card_due.
//
// Web-push is implemented inline (VAPID / RFC 8291) — the npm:web-push package
// relies on Node crypto APIs that don't run on the Deno edge runtime, so this
// mirrors the hand-rolled implementation in generate-insights / budget-alert.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hola@morchis.app";

// "now" in Argentina (UTC-3, no DST) — the server clock is UTC.
const artNow = () => new Date(Date.now() - 3 * 60 * 60 * 1000);

function jwtPayload(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

/* ── web-push (VAPID / RFC 8291), inline ─────────────────────────────────── */
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
async function sendWebPush(sub: { endpoint: string; p256dh: string; auth_key: string }, payload: Record<string, string>): Promise<number> {
  const { origin } = new URL(sub.endpoint);
  const jwt = await vapidJWT(origin, VAPID_SUBJECT, VAPID_PRIVATE);
  const ct = await encryptWebPush(JSON.stringify(payload), sub.p256dh, sub.auth_key);
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'TTL': '86400', 'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC}` }, body: ct });
  return r.status;
}


interface Card { id: string; name: string; currency: string; household_id: string; owner_profile_id: string | null; closing_date: string | null; due_date: string | null; statement_ars: number | null; statement_usd: number | null }
interface ProfileRow { id: string; notification_prefs: Record<string, boolean> | null }

async function pushToProfiles(admin: SupabaseClient, profileIds: string[], payload: Record<string, string>): Promise<number> {
  if (profileIds.length === 0) return 0;
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth_key").in("profile_id", profileIds);
  let ok = 0;
  for (const s of subs ?? []) {
    try {
      const status = await sendWebPush({ endpoint: s.endpoint as string, p256dh: s.p256dh as string, auth_key: s.auth_key as string }, payload);
      if (status >= 200 && status < 300) ok++;
      else if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint as string);
      else console.error("push send failed", status);
    } catch (err) {
      console.error("push send failed", err);
    }
  }
  return ok;
}

Deno.serve(async (req: Request) => {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } });

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || jwtPayload(token)?.role !== 'service_role') {
    // Cron-only function: a user has nothing to gain from triggering it
    // manually (it would just re-push), so require the service role.
    return new Response(JSON.stringify({ error: 'service role only' }), { status: 401, headers: cors });
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return new Response(JSON.stringify({ error: 'VAPID not configured' }), { status: 200, headers: cors });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const todayISO = isoOf(artNow());

  const { data: cards } = await admin
    .from('accounts')
    .select('id,name,currency,household_id,owner_profile_id,closing_date,due_date,statement_ars,statement_usd')
    .eq('type', 'credit')
    .eq('archived', false)
    .not('due_date', 'is', null);

  let sent = 0;
  const checked: { card: string; due: string; days: number }[] = [];
  for (const c of (cards ?? []) as Card[]) {
    const due = nextOccurrence(c.due_date!, todayISO);
    const days = daysBetween(todayISO, due);
    checked.push({ card: c.name, due, days });
    if (days !== 3 && days !== 0) continue;

    // Amount due: prefer the manually-entered statement balance; otherwise
    // estimate from the closed cycle's net spend (expenses minus refunds
    // between the two most recent closing dates).
    let amountTxt = '';
    if (c.statement_ars != null || c.statement_usd != null) {
      const parts: string[] = [];
      if (c.statement_ars) parts.push(fmtARS(Number(c.statement_ars)));
      if (c.statement_usd) parts.push(`US$${Math.round(Number(c.statement_usd)).toLocaleString('es-AR')}`);
      if (parts.length) amountTxt = ` · resumen ${parts.join(' + ')}`;
    } else if (c.closing_date) {
      const lastClose = prevOccurrence(c.closing_date, todayISO);
      const prevClose = prevOccurrence(c.closing_date, lastClose);
      const { data: txs } = await admin
        .from('transactions')
        .select('type,amount')
        .eq('account_id', c.id)
        .gt('occurred_on', prevClose)
        .lte('occurred_on', lastClose);
      const cycle = (txs ?? []).reduce((s, t) => s + (t.type === 'expense' ? Number(t.amount) : t.type === 'income' ? -Number(t.amount) : 0), 0);
      if (cycle > 0) amountTxt = c.currency === 'USD' ? ` · ciclo US$${Math.round(cycle).toLocaleString('es-AR')}` : ` · ciclo ${fmtARS(cycle)}`;
    }

    // Who to tell: the card owner, or both members when ownerless. Honor the
    // card_due preference (absent = enabled).
    const { data: profs } = await admin.from('profiles').select('id,notification_prefs').eq('household_id', c.household_id);
    const members = (profs ?? []) as ProfileRow[];
    const targets = members
      .filter(p => (c.owner_profile_id == null || p.id === c.owner_profile_id))
      .filter(p => (p.notification_prefs?.card_due) !== false)
      .map(p => p.id);

    const payload = {
      title: days === 0 ? '💳 Hoy vence la tarjeta' : '💳 Vencimiento en 3 días',
      body: `${c.name} vence ${days === 0 ? 'hoy' : `el ${due.slice(8, 10)}/${due.slice(5, 7)}`}${amountTxt}.`,
      url: '/cuentas',
    };
    sent += await pushToProfiles(admin, targets, payload);
  }

  return new Response(JSON.stringify({ ok: true, sent, checked }), { headers: cors });
});
