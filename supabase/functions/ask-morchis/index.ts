import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// "Preguntale a Morchi" — an agent that can answer ANY question about the
// household finances. Claude has tools to query the database; every tool runs a
// deterministic TypeScript aggregation (USD normalised to ARS). The model only
// decides what to query and writes the answer — it never does arithmetic.

const iso = (y: number, m: number, d: number) => new Date(y, m, d).toISOString().slice(0, 10);
const MONTHLY: Record<string, number> = { weekly: 4.345, biweekly: 2.17, monthly: 1 };
const norm = (s: string) => (s ?? '').toLowerCase();

function jwtPayload(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

interface Ctx { admin: SupabaseClient; hid: string; blue: number; pm: Record<string, string>; }

// ── tool executors (all money math lives here) ───────────────────────────────
interface AggInput { type?: string; group_by?: string; category?: string; merchant?: string; scope?: string; person?: string; date_from?: string; date_to?: string; limit?: number; }
async function aggregateTransactions(ctx: Ctx, input: AggInput) {
  const type = input.type === 'income' ? 'income' : 'expense';
  let q = ctx.admin.from('transactions')
    .select('categories(name),profile_id,scope,amount,currency,usd_rate_snapshot,merchant,occurred_on')
    .eq('household_id', ctx.hid).eq('type', type);
  if (input.date_from) q = q.gte('occurred_on', input.date_from);
  if (input.date_to) q = q.lte('occurred_on', input.date_to);
  const { data } = await q;
  let rows = ((data ?? []) as { categories: { name: string } | null; profile_id: string; scope: string; amount: number; currency: string; usd_rate_snapshot: number | null; merchant: string | null; occurred_on: string }[])
    .map(t => ({
      cat: t.categories?.name ?? 'Sin categoría',
      person: ctx.pm[t.profile_id] ?? 'Hogar',
      scope: t.scope,
      merchant: t.merchant ?? '',
      ars: t.currency === 'USD' ? t.amount * (Number(t.usd_rate_snapshot) || ctx.blue) : t.amount,
      month: (t.occurred_on || '').slice(0, 7),
    }));
  if (input.category) rows = rows.filter(r => norm(r.cat).includes(norm(input.category!)));
  if (input.merchant) rows = rows.filter(r => norm(r.merchant).includes(norm(input.merchant!)));
  if (input.scope) rows = rows.filter(r => r.scope === input.scope);
  if (input.person) rows = rows.filter(r => norm(r.person).includes(norm(input.person!)));
  const total = rows.reduce((s, r) => s + r.ars, 0);
  const gb = input.group_by && input.group_by !== 'none' ? input.group_by : null;
  let groups: { key: string; total_ars: number; count: number }[] = [];
  if (gb) {
    const map: Record<string, { total: number; count: number }> = {};
    for (const r of rows) {
      const k = gb === 'category' ? r.cat : gb === 'merchant' ? (r.merchant || '(sin comercio)') : gb === 'month' ? r.month : gb === 'person' ? r.person : r.scope;
      if (!map[k]) map[k] = { total: 0, count: 0 };
      map[k].total += r.ars; map[k].count++;
    }
    groups = Object.entries(map)
      .map(([key, v]) => ({ key, total_ars: Math.round(v.total), count: v.count }))
      .sort((a, b) => gb === 'month' ? a.key.localeCompare(b.key) : b.total_ars - a.total_ars)
      .slice(0, input.limit || 12);
  }
  return { type, total_ars: Math.round(total), count: rows.length, group_by: gb ?? 'none', groups, note: rows.length === 0 ? 'No hay transacciones para esos filtros.' : undefined };
}

async function getBalances(ctx: Ctx) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [{ data: accts }, { data: atx }] = await Promise.all([
    ctx.admin.from('accounts').select('id,name,type,currency,initial_balance').eq('household_id', ctx.hid).eq('archived', false),
    ctx.admin.from('transactions').select('account_id,transfer_account_id,type,amount,occurred_on').eq('household_id', ctx.hid).not('account_id', 'is', null),
  ]);
  const tx = (atx ?? []) as { account_id: string | null; transfer_account_id: string | null; type: string; amount: number; occurred_on: string }[];
  const balOf = (id: string, initial: number) => tx.reduce((s, t) => {
    if (t.occurred_on > todayStr) return s;
    if (t.account_id === id) { if (t.type === 'income') return s + t.amount; if (t.type === 'expense' || t.type === 'transfer') return s - t.amount; return s; }
    if (t.type === 'transfer' && t.transfer_account_id === id) return s + t.amount;
    return s;
  }, initial);
  let netWorth = 0;
  const accounts = ((accts ?? []) as { id: string; name: string; type: string; currency: string; initial_balance: number }[]).map(a => {
    const bal = balOf(a.id, a.initial_balance ?? 0);
    const balArs = a.currency === 'USD' ? bal * ctx.blue : bal;
    if (a.type !== 'credit') netWorth += balArs;
    return { name: a.name, type: a.type, currency: a.currency, balance: Math.round(bal), balance_ars: Math.round(balArs) };
  });
  return { accounts, net_worth_ars: Math.round(netWorth), note: 'El patrimonio neto excluye tarjetas de crédito.' };
}

async function getBudgets(ctx: Ctx) {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const [{ data: buds }, { data: exp }] = await Promise.all([
    ctx.admin.from('budgets').select('amount,currency,categories(name)').eq('household_id', ctx.hid).eq('active', true),
    ctx.admin.from('transactions').select('categories(name),amount,currency,usd_rate_snapshot').eq('household_id', ctx.hid).eq('type', 'expense').gte('occurred_on', iso(y, m, 1)).lt('occurred_on', iso(y, m + 1, 1)),
  ]);
  const spent: Record<string, number> = {};
  for (const t of (exp ?? []) as { categories: { name: string } | null; amount: number; currency: string; usd_rate_snapshot: number | null }[]) {
    const n = t.categories?.name ?? 'Sin categoría';
    spent[n] = (spent[n] ?? 0) + (t.currency === 'USD' ? t.amount * (Number(t.usd_rate_snapshot) || ctx.blue) : t.amount);
  }
  return {
    budgets: ((buds ?? []) as { amount: number; currency: string; categories: { name: string } | null }[]).map(b => {
      const name = b.categories?.name ?? '';
      const limit = b.currency === 'USD' ? b.amount * ctx.blue : b.amount;
      const sp = spent[name] ?? 0;
      return { category: name, spent_ars: Math.round(sp), limit_ars: Math.round(limit), pct: limit > 0 ? Math.round(sp / limit * 100) : 0 };
    }),
  };
}

async function getGoals(ctx: Ctx) {
  const { data } = await ctx.admin.from('goals').select('name,target_amount,current_amount,target_currency,deadline').eq('household_id', ctx.hid).eq('archived', false);
  return { goals: ((data ?? []) as { name: string; target_amount: number; current_amount: number; target_currency: string; deadline: string | null }[]).map(g => ({ name: g.name, current: Math.round(g.current_amount), target: Math.round(g.target_amount), currency: g.target_currency, pct: g.target_amount > 0 ? Math.round(g.current_amount / g.target_amount * 100) : 0, deadline: g.deadline })) };
}

async function getDebts(ctx: Ctx) {
  const { data } = await ctx.admin.from('debts').select('counterparty,direction,amount,currency,note').eq('household_id', ctx.hid).eq('settled', false);
  return { debts: ((data ?? []) as { counterparty: string; direction: string; amount: number; currency: string; note: string | null }[]).map(d => ({ counterparty: d.counterparty, direction: d.direction === 'owe' ? 'debemos' : 'nos deben', amount: Math.round(d.amount), currency: d.currency, note: d.note })) };
}

async function getRecurring(ctx: Ctx) {
  const { data } = await ctx.admin.from('recurring_rules').select('label,amount,currency,cadence,direction,categories(name)').eq('household_id', ctx.hid).eq('active', true);
  const rows = ((data ?? []) as { label: string; amount: number; currency: string; cadence: string; direction: string; categories: { name: string } | null }[]).map(r => ({
    label: r.label, direction: r.direction, category: r.categories?.name ?? null,
    monthly_ars: Math.round((r.currency === 'USD' ? r.amount * ctx.blue : r.amount) * (MONTHLY[r.cadence] ?? 1)),
    cadence: r.cadence,
  }));
  const expTotal = rows.filter(r => r.direction === 'expense').reduce((s, r) => s + r.monthly_ars, 0);
  return { rules: rows, fixed_expense_monthly_ars: Math.round(expTotal) };
}

const TOOLS = [
  {
    name: 'aggregate_transactions',
    description: 'Suma y agrupa transacciones reales del hogar (gastos o ingresos), ya convertidas a ARS. Usala para responder cualquier "cuánto / en qué / cuándo / quién" sobre gastos o ingresos. Filtros opcionales y agrupación opcional.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['expense', 'income'], description: 'gasto (default) o ingreso' },
        group_by: { type: 'string', enum: ['none', 'category', 'merchant', 'month', 'person', 'scope'], description: 'cómo agrupar el desglose' },
        category: { type: 'string', description: 'filtrar por nombre de categoría (parcial, sin distinguir mayúsculas)' },
        merchant: { type: 'string', description: 'filtrar por comercio (parcial)' },
        scope: { type: 'string', enum: ['personal', 'household'], description: 'personal o del hogar' },
        person: { type: 'string', description: 'filtrar por apodo de la persona (ej. Luqui, Chofi)' },
        date_from: { type: 'string', description: 'fecha desde inclusive, formato YYYY-MM-DD' },
        date_to: { type: 'string', description: 'fecha hasta inclusive, formato YYYY-MM-DD' },
        limit: { type: 'number', description: 'máximo de grupos a devolver (default 12)' },
      },
      required: [],
    },
  },
  { name: 'get_balances', description: 'Saldo actual de cada cuenta (en su moneda y en ARS) y el patrimonio neto del hogar.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_budgets', description: 'Presupuestos activos con lo gastado este mes vs el límite (en ARS) y el porcentaje.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_goals', description: 'Metas de ahorro con progreso (actual/objetivo, %, deadline).', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_debts', description: 'Deudas sin saldar (a quién le deben o quién les debe).', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_recurring', description: 'Gastos fijos y suscripciones activas (equivalente mensual en ARS) e ingresos recurrentes.', input_schema: { type: 'object', properties: {}, required: [] } },
];

async function runTool(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  switch (name) {
    case 'aggregate_transactions': return await aggregateTransactions(ctx, input as AggInput);
    case 'get_balances': return await getBalances(ctx);
    case 'get_budgets': return await getBudgets(ctx);
    case 'get_goals': return await getGoals(ctx);
    case 'get_debts': return await getDebts(ctx);
    case 'get_recurring': return await getRecurring(ctx);
    default: return { error: 'herramienta desconocida' };
  }
}

async function buildPrimer(ctx: Ctx): Promise<string> {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const [{ data: cats }, { data: accts }, { data: profs }] = await Promise.all([
    ctx.admin.from('categories').select('name').eq('household_id', ctx.hid).eq('kind', 'expense'),
    ctx.admin.from('accounts').select('name').eq('household_id', ctx.hid).eq('archived', false),
    ctx.admin.from('profiles').select('nickname,display_name').eq('household_id', ctx.hid),
  ]);
  const catNames = ((cats ?? []) as { name: string }[]).map(c => c.name).join(', ');
  const acctNames = ((accts ?? []) as { name: string }[]).map(a => a.name).join(', ');
  const people = ((profs ?? []) as { nickname: string | null; display_name: string | null }[]).map(p => p.nickname ?? p.display_name ?? 'Usuario').join(', ');
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return [
    `Hoy es ${iso(y, m, now.getDate())} (${months[m]} de ${y}).`,
    `Personas del hogar: ${people || 'n/d'}.`,
    `Categorías de gasto: ${catNames || 'n/d'}.`,
    `Cuentas: ${acctNames || 'n/d'}.`,
    'La moneda base es el peso argentino (ARS); los dólares ya vienen convertidos en las herramientas.',
  ].join('\n');
}

const SYSTEM = 'Sos Morchi, el asistente financiero de la pareja Lucas y Sofi en la app Morchis (es-AR, tono cercano y motivador). Tenés HERRAMIENTAS para consultar su base de datos financiera real. Para CUALQUIER pregunta sobre montos, gastos, ingresos, comercios, categorías, meses, saldos, presupuestos, metas o deudas, USÁ las herramientas para obtener los números exactos antes de responder; podés llamar varias y combinarlas. Reglas: (1) Nunca inventes ni estimes montos: los números salen siempre de las herramientas. Si una herramienta no trae datos, decílo con honestidad. (2) Para resolver fechas usá el dato de "Hoy" del contexto (ej. "marzo" = del año en curso salvo que aclaren). (3) Mostrá los montos en formato $1.234.567. (4) Sé conciso y claro: 2 a 4 oraciones. No uses tablas markdown ni encabezados; si necesitás listar, usá pocas líneas cortas que empiecen con guión (-). Para resaltar un dato podés usar **negrita**. (5) Si te piden un consejo, basate en los números que consultaste.';

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
  if (jwtPayload(token)?.role === 'service_role') {
    const { data: hh } = await admin.from('households').select('id').limit(1).single();
    hid = hh?.id ?? null;
  } else {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
    const { data: prof } = await admin.from('profiles').select('household_id').eq('id', user.id).single();
    hid = prof?.household_id ?? null;
  }
  if (!hid) return new Response(JSON.stringify({ error: 'No household' }), { status: 400, headers: cors });

  let body: { question?: string; history?: { role: string; content: string }[] } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const question = (body.question ?? '').trim();
  if (!question) return new Response(JSON.stringify({ error: 'question requerida' }), { status: 400, headers: cors });

  // FX rate + name map for the tools.
  const [{ data: fxRow }, { data: profs }] = await Promise.all([
    admin.from('fx_rates').select('ars_per_usd').eq('source', 'blue').order('date', { ascending: false }).limit(1).maybeSingle(),
    admin.from('profiles').select('id,nickname,display_name').eq('household_id', hid),
  ]);
  const blue = Number(fxRow?.ars_per_usd ?? 1200);
  const pm: Record<string, string> = {};
  for (const p of (profs ?? []) as { id: string; nickname: string | null; display_name: string | null }[]) pm[p.id] = p.nickname ?? p.display_name ?? 'Usuario';
  const ctx: Ctx = { admin, hid, blue, pm };

  const primer = await buildPrimer(ctx);
  const history = (body.history ?? []).slice(-6)
    .filter(h => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
    .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }));

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [...history, { role: 'user', content: question }];

  // Agentic loop: let Claude call tools until it has enough to answer.
  let answer = '';
  for (let i = 0; i < 8; i++) {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'CONTEXTO:\n' + primer },
      ],
      tools: TOOLS,
      messages,
    });
    if (resp.stop_reason !== 'tool_use') {
      answer = resp.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim();
      break;
    }
    messages.push({ role: 'assistant', content: resp.content });
    const results = [];
    for (const block of resp.content) {
      if (block.type === 'tool_use') {
        const out = await runTool(block.name, block.input as Record<string, unknown>, ctx);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  if (!answer) answer = 'Uy, no pude llegar a una respuesta. Probá reformulando la pregunta.';

  return new Response(JSON.stringify({ ok: true, answer }), { headers: cors });
});
