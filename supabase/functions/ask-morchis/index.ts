import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// "Preguntale a Morchis" — conversational finance Q&A.
// HARD RULE: every number is computed here in TypeScript. Claude only reads the
// snapshot and phrases the answer; it never does arithmetic or invents amounts.

const fmt = (n: number): string => '$' + Math.round(n).toLocaleString('es-AR');
const iso = (y: number, m: number, d: number) => new Date(y, m, d).toISOString().slice(0, 10);
const MONTHLY: Record<string, number> = { weekly: 4.345, biweekly: 2.17, monthly: 1 };
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

interface ExpRow { categories: { name: string } | null; amount: number; currency: string; usd_rate_snapshot: number | null; merchant: string | null; }
interface IncRow { amount: number; currency: string; usd_rate_snapshot: number | null; }
interface AcctRow { id: string; name: string; type: string; currency: string; archived: boolean; initial_balance: number; }
interface AcctTx { account_id: string | null; transfer_account_id: string | null; type: string; amount: number; occurred_on: string; }

async function buildSnapshot(admin: SupabaseClient, hid: string): Promise<string> {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  const day = now.getDate();
  const m0 = iso(y, m, 1), m1 = iso(y, m + 1, 1), m3 = iso(y, m - 3, 1);
  const pm0 = iso(y, m - 1, 1); // previous month start
  const todayStr = iso(y, m, day);

  const [curR, histR, incR, pincR, recR, budR, goalR, acctR, acctTxR, debtR, fxR] = await Promise.all([
    admin.from('transactions').select('categories(name),amount,currency,usd_rate_snapshot,merchant').eq('household_id', hid).eq('type', 'expense').gte('occurred_on', m0).lt('occurred_on', m1),
    admin.from('transactions').select('category_id,categories(name),amount,currency,usd_rate_snapshot').eq('household_id', hid).eq('type', 'expense').gte('occurred_on', m3).lt('occurred_on', m0),
    admin.from('transactions').select('amount,currency,usd_rate_snapshot').eq('household_id', hid).eq('type', 'income').gte('occurred_on', m0).lt('occurred_on', m1),
    admin.from('transactions').select('amount,currency,usd_rate_snapshot,type').eq('household_id', hid).gte('occurred_on', pm0).lt('occurred_on', m0),
    admin.from('recurring_rules').select('label,amount,currency,cadence,categories(name)').eq('household_id', hid).eq('active', true).eq('direction', 'expense'),
    admin.from('budgets').select('amount,currency,categories(name)').eq('household_id', hid).eq('active', true),
    admin.from('goals').select('name,target_amount,current_amount,target_currency,deadline').eq('household_id', hid).eq('archived', false),
    admin.from('accounts').select('id,name,type,currency,archived,initial_balance').eq('household_id', hid).eq('archived', false),
    admin.from('transactions').select('account_id,transfer_account_id,type,amount,occurred_on').eq('household_id', hid).not('account_id', 'is', null),
    admin.from('debts').select('counterparty,direction,amount,currency').eq('household_id', hid).eq('settled', false),
    admin.from('fx_rates').select('ars_per_usd').eq('source', 'blue').order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const blue = Number(fxR.data?.ars_per_usd ?? 1200);
  const ars = (a: number, cur: string, snap: number | null) => cur === 'USD' ? a * (Number(snap) || blue) : a;

  const cur = (curR.data ?? []) as ExpRow[];
  const hist = (histR.data ?? []) as { categories: { name: string } | null; amount: number; currency: string; usd_rate_snapshot: number | null }[];
  const inc = (incR.data ?? []) as IncRow[];
  const pinc = (pincR.data ?? []) as { amount: number; currency: string; usd_rate_snapshot: number | null; type: string }[];

  const expense = cur.reduce((s, t) => s + ars(t.amount, t.currency, t.usd_rate_snapshot), 0);
  const income = inc.reduce((s, t) => s + ars(t.amount, t.currency, t.usd_rate_snapshot), 0);
  const net = income - expense;
  const prevExpense = pinc.filter(t => t.type === 'expense').reduce((s, t) => s + ars(t.amount, t.currency, t.usd_rate_snapshot), 0);
  const prevIncome = pinc.filter(t => t.type === 'income').reduce((s, t) => s + ars(t.amount, t.currency, t.usd_rate_snapshot), 0);

  // per-category current + 3-month average
  const cmap: Record<string, number> = {};
  for (const t of cur) { const n = t.categories?.name ?? 'Sin categoría'; cmap[n] = (cmap[n] ?? 0) + ars(t.amount, t.currency, t.usd_rate_snapshot); }
  const hmap: Record<string, number> = {};
  for (const t of hist) { const n = t.categories?.name ?? 'Sin categoría'; hmap[n] = (hmap[n] ?? 0) + ars(t.amount, t.currency, t.usd_rate_snapshot); }
  const cats = Object.entries(cmap).sort((a, b) => b[1] - a[1]);

  // top merchants this month
  const mmap: Record<string, { total: number; n: number }> = {};
  for (const t of cur) { if (!t.merchant) continue; const k = t.merchant; if (!mmap[k]) mmap[k] = { total: 0, n: 0 }; mmap[k].total += ars(t.amount, t.currency, t.usd_rate_snapshot); mmap[k].n++; }
  const merchants = Object.entries(mmap).sort((a, b) => b[1].total - a[1].total).slice(0, 8);

  // account balances (convert by account currency, matching the app)
  const accts = (acctR.data ?? []) as AcctRow[];
  const atx = (acctTxR.data ?? []) as AcctTx[];
  const balOf = (id: string, initial: number) => atx.reduce((s, t) => {
    if (t.occurred_on > todayStr) return s;
    if (t.account_id === id) { if (t.type === 'income') return s + t.amount; if (t.type === 'expense' || t.type === 'transfer') return s - t.amount; return s; }
    if (t.type === 'transfer' && t.transfer_account_id === id) return s + t.amount;
    return s;
  }, initial);
  let netWorth = 0;
  const acctLines: string[] = [];
  for (const a of accts) {
    if (a.type === 'credit') continue;
    const bal = balOf(a.id, a.initial_balance ?? 0);
    const balArs = a.currency === 'USD' ? bal * blue : bal;
    netWorth += balArs;
    acctLines.push(`- ${a.name} (${a.type}): ${a.currency === 'USD' ? 'US$' + Math.round(bal).toLocaleString('es-AR') : fmt(bal)}`);
  }

  const rec = (recR.data ?? []) as { label: string; amount: number; currency: string; cadence: string; categories: { name: string } | null }[];
  const subsMonthly = rec.map(r => ({ label: r.label, m: ars(r.amount, r.currency, null) * (MONTHLY[r.cadence] ?? 1) }));
  const subsTotal = subsMonthly.reduce((s, r) => s + r.m, 0);

  const buds = (budR.data ?? []) as { amount: number; currency: string; categories: { name: string } | null }[];
  const goals = (goalR.data ?? []) as { name: string; target_amount: number; current_amount: number; target_currency: string; deadline: string | null }[];
  const debts = (debtR.data ?? []) as { counterparty: string; direction: string; amount: number; currency: string }[];

  // ── assemble the text snapshot ───────────────────────────────────────────
  const L: string[] = [];
  L.push(`Hoy: ${todayStr} (día ${day} de ${dim} de ${MONTHS[m]} ${y}, ${Math.round(day / dim * 100)}% del mes).`);
  L.push(`ESTE MES — Ingresos: ${fmt(income)} | Gastos: ${fmt(expense)} | Balance: ${fmt(net)} | Tasa de ahorro: ${income > 0 ? Math.round(net / income * 100) + '%' : 'n/d'}.`);
  L.push(`MES ANTERIOR (${MONTHS[(m + 11) % 12]}) — Ingresos: ${fmt(prevIncome)} | Gastos: ${fmt(prevExpense)}.`);
  if (cats.length) {
    L.push('', 'GASTOS POR CATEGORÍA este mes (con promedio últimos 3 meses):');
    for (const [n, v] of cats.slice(0, 12)) L.push(`- ${n}: ${fmt(v)} (prom 3m ${fmt((hmap[n] ?? 0) / 3)})`);
  }
  if (merchants.length) {
    L.push('', 'COMERCIOS con más gasto este mes:');
    for (const [n, v] of merchants) L.push(`- ${n}: ${fmt(v.total)} en ${v.n} compra${v.n === 1 ? '' : 's'}`);
  }
  if (buds.length) {
    L.push('', 'PRESUPUESTOS activos (gastado/límite):');
    for (const b of buds) { const n = b.categories?.name ?? ''; const lim = ars(b.amount, b.currency, null); const sp = cmap[n] ?? 0; L.push(`- ${n}: ${fmt(sp)} de ${fmt(lim)} (${lim > 0 ? Math.round(sp / lim * 100) : 0}%)`); }
  }
  if (goals.length) {
    L.push('', 'METAS de ahorro:');
    for (const g of goals) { const pct = g.target_amount > 0 ? Math.round(g.current_amount / g.target_amount * 100) : 0; L.push(`- ${g.name}: ${pct}% (${fmt(g.current_amount)}/${fmt(g.target_amount)} ${g.target_currency})${g.deadline ? `, vence ${g.deadline}` : ''}`); }
  }
  if (rec.length) {
    L.push('', `SUSCRIPCIONES/GASTOS FIJOS: ${fmt(subsTotal)}/mes en ${rec.length} (${subsMonthly.sort((a, b) => b.m - a.m).slice(0, 6).map(r => `${r.label} ${fmt(r.m)}`).join(', ')}).`);
  }
  if (acctLines.length) {
    L.push('', `CUENTAS (saldo actual) — Patrimonio neto ≈ ${fmt(netWorth)}:`);
    L.push(...acctLines);
  }
  if (debts.length) {
    L.push('', 'DEUDAS sin saldar:');
    for (const d of debts) L.push(`- ${d.direction === 'owe' ? 'Debemos a' : 'Nos debe'} ${d.counterparty}: ${d.currency === 'USD' ? 'US$' : '$'}${Math.round(d.amount).toLocaleString('es-AR')}`);
  }
  L.push('', `(Tipo de cambio usado para convertir USD→ARS: blue $${Math.round(blue)}.)`);
  return L.join('\n');
}

function jwtPayload(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

const SYSTEM = 'Sos Morchi, el asistente financiero de la pareja Lucas y Sofi en la app Morchis. Te paso un RESUMEN con los números reales de sus finanzas, ya calculados y exactos (en pesos argentinos salvo que diga USD). Respondé la pregunta del usuario de forma clara, cálida y breve en español rioplatense, usando SOLO los números del resumen. Reglas: (1) Nunca inventes, estimes ni recalcules montos: si un dato no está en el resumen (un comercio puntual que no figura, un mes lejano, una categoría inexistente), decílo en una frase y ofrecé lo que sí podés contar. (2) Mostrá los montos con formato $1.234.567. (3) Sé conciso: 2 a 4 oraciones, sin listas largas salvo que lo pidan. (4) Si te piden un consejo, basate en los números del resumen.';

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
  let householdId: string | null = null;
  if (jwtPayload(token)?.role === 'service_role') {
    // admin/test path — use the first household
    const { data: hh } = await admin.from('households').select('id').limit(1).single();
    householdId = hh?.id ?? null;
  } else {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
    const { data: prof } = await admin.from('profiles').select('household_id').eq('id', user.id).single();
    householdId = prof?.household_id ?? null;
  }
  if (!householdId) return new Response(JSON.stringify({ error: 'No household' }), { status: 400, headers: cors });

  let body: { question?: string; history?: { role: string; content: string }[] } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const question = (body.question ?? '').trim();
  if (!question) return new Response(JSON.stringify({ error: 'question requerida' }), { status: 400, headers: cors });

  const snapshot = await buildSnapshot(admin, householdId);

  // Keep a little conversation context (last 6 turns) for natural follow-ups.
  const history = (body.history ?? []).slice(-6)
    .filter(h => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
    .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }));

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'RESUMEN FINANCIERO ACTUAL:\n' + snapshot },
    ],
    messages: [...history, { role: 'user', content: question }],
  });
  const answer = resp.content[0]?.type === 'text' ? resp.content[0].text.trim() : '';
  return new Response(JSON.stringify({ ok: true, answer }), { headers: cors });
});
