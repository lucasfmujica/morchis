import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fmt, iso, buildSuggestions } from "./math.ts";
import type { Suggestion } from "./math.ts";

// AI-suggested budgets. HARD RULE: the suggested amount is computed in TS from
// the household's real history; Claude only writes a short rationale per
// category. It never picks or computes the number.

function jwtPayload(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

interface HistRow { category_id: string | null; amount: number; currency: string; usd_rate_snapshot: number | null; }

Deno.serve(async (req: Request) => {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let hid: string | null = null;
  let uid: string | null = null;
  if (jwtPayload(token)?.role === 'service_role') {
    const { data: hh } = await admin.from('households').select('id').limit(1).single();
    hid = hh?.id ?? null;
  } else {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
    uid = user.id;
    const { data: prof } = await admin.from('profiles').select('household_id').eq('id', user.id).single();
    hid = prof?.household_id ?? null;
  }
  if (!hid) return new Response(JSON.stringify({ error: 'No household' }), { status: 400, headers: cors });

  let body: { scope?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const scope = body.scope === 'household' ? 'household' : 'personal';

  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const m0 = iso(y, m, 1), m1 = iso(y, m + 1, 1), m3 = iso(y, m - 3, 1), pm0 = iso(y, m - 1, 1);
  const dim = new Date(y, m + 1, 0).getDate();
  const day = now.getDate();

  const [histR, lastR, curRq, catR, budR, fxR] = await Promise.all([
    admin.from('transactions').select('category_id,amount,currency,usd_rate_snapshot').eq('household_id', hid).eq('type', 'expense').eq('scope', scope).gte('occurred_on', m3).lt('occurred_on', m0),
    admin.from('transactions').select('category_id,amount,currency,usd_rate_snapshot').eq('household_id', hid).eq('type', 'expense').eq('scope', scope).gte('occurred_on', pm0).lt('occurred_on', m0),
    admin.from('transactions').select('category_id,amount,currency,usd_rate_snapshot').eq('household_id', hid).eq('type', 'expense').eq('scope', scope).gte('occurred_on', m0).lt('occurred_on', m1),
    admin.from('categories').select('id,name,kind').eq('household_id', hid).eq('kind', 'expense'),
    admin.from('category_targets').select('category_id').eq('profile_id', uid ?? '00000000-0000-0000-0000-000000000000'),
    admin.from('fx_rates').select('ars_per_usd').eq('source', 'blue').order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const blue = Number(fxR.data?.ars_per_usd ?? 1200);
  const ars = (a: number, cur: string, snap: number | null) => cur === 'USD' ? a * (Number(snap) || blue) : a;
  const cats = (catR.data ?? []) as { id: string; name: string; kind: string }[];
  const budgeted = new Set(((budR.data ?? []) as { category_id: string }[]).map(b => b.category_id));

  const hist3: Record<string, number> = {};
  for (const t of (histR.data ?? []) as HistRow[]) { if (!t.category_id) continue; hist3[t.category_id] = (hist3[t.category_id] ?? 0) + ars(t.amount, t.currency, t.usd_rate_snapshot); }
  const last1: Record<string, number> = {};
  for (const t of (lastR.data ?? []) as HistRow[]) { if (!t.category_id) continue; last1[t.category_id] = (last1[t.category_id] ?? 0) + ars(t.amount, t.currency, t.usd_rate_snapshot); }
  const cur0: Record<string, number> = {};
  for (const t of (curRq.data ?? []) as HistRow[]) { if (!t.category_id) continue; cur0[t.category_id] = (cur0[t.category_id] ?? 0) + ars(t.amount, t.currency, t.usd_rate_snapshot); }

  const suggestions: Suggestion[] = buildSuggestions(cats, budgeted, hist3, last1, cur0, day, dim);

  if (!suggestions.length) {
    return new Response(JSON.stringify({ ok: true, scope, suggestions: [] }), { headers: cors });
  }

  // Ask Claude for a one-line rationale per category (numbers come from us).
  try {
    const facts = suggestions.map((s, i) => `${i + 1}. ${s.name}: promedio 3 meses ${fmt(s.avg3m)}, mes pasado ${fmt(s.lastMonth)}, proyección de este mes ${fmt(s.projected)} → presupuesto sugerido ${fmt(s.suggested)}`).join('\n');
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: [{ type: 'text', text: 'Sos el coach de Morchis (pareja argentina, es-AR). Te paso categorías de gasto con su promedio, lo del mes pasado y un presupuesto sugerido ya calculado. Devolvé SOLO un array JSON: [{"name":string (igual al dado), "rationale":string (1 frase ≤18 palabras, cálida, que justifique el monto usando los números dados)}]. No inventes ni cambies montos.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: facts }],
    });
    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const a = s.indexOf('['), b = s.lastIndexOf(']');
    if (a !== -1 && b > a) s = s.slice(a, b + 1);
    const arr = JSON.parse(s) as { name: string; rationale: string }[];
    const byName: Record<string, string> = {};
    for (const r of arr) if (r && typeof r.name === 'string' && typeof r.rationale === 'string') byName[r.name] = r.rationale.trim();
    for (const sg of suggestions) sg.rationale = byName[sg.name] ?? `Según tu gasto reciente (${fmt(Math.max(sg.avg3m, sg.lastMonth, sg.projected))}), este tope te deja un margen cómodo.`;
  } catch (_e) {
    for (const sg of suggestions) sg.rationale = `Según tu gasto reciente (${fmt(Math.max(sg.avg3m, sg.lastMonth, sg.projected))}), este tope te deja un margen cómodo.`;
  }

  return new Response(JSON.stringify({ ok: true, scope, suggestions }), { headers: cors });
});
