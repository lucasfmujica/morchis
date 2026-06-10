import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// "Preguntale a Morchi" — an agent that can answer ANY question about the
// household finances. Claude has tools to query the database; every tool runs a
// deterministic TypeScript aggregation (USD normalised to ARS). The model only
// decides what to query and writes the answer — it never does arithmetic.
//
// The `lens` of aggregate_transactions mirrors the coach: it distinguishes a
// person's own share (personal + their split of shared, minus what a friend
// repays) from the household's shared spending, so the chat can tell apart
// "mis gastos" from "gastos del hogar" based on the question.

const iso = (y: number, m: number, d: number) => new Date(y, m, d).toISOString().slice(0, 10);
const MONTHLY: Record<string, number> = { weekly: 4.345, biweekly: 2.17, monthly: 1 };
const norm = (s: string) => (s ?? '').toLowerCase();
const toArs = (a: number, cur: string, snap: number | null, blue: number) => cur === 'USD' ? a * (Number(snap) || blue) : a;

function jwtPayload(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

interface Split { payer_profile_id: string; ower_profile_id: string; amount: number }
interface Debt { transaction_id: string | null; direction: string; amount: number; currency: string }
interface Ctx {
  admin: SupabaseClient; hid: string; blue: number;
  pm: Record<string, string>; askerId: string; partnerId: string | null;
  debtByTx: Record<string, Debt[]>; catNames: string;
}

function owedBackArs(txId: string, debtByTx: Record<string, Debt[]>, blue: number): number {
  return (debtByTx[txId] ?? []).filter(d => d.direction === 'owed').reduce((s, d) => s + toArs(d.amount, d.currency, null, blue), 0);
}

interface ExpRow { id: string; profile_id: string; scope: string; is_shared: boolean; amount: number; currency: string; usd_rate_snapshot: number | null; splits: Split[] | null }
// Amount of an expense attributable to a lens, in ARS:
//  - 'everyone'  → full amount (total money the couple spent)
//  - 'household' → only shared/household-scope expenses, full
//  - a profileId → that person's own expenses + their split share of shared ones
// Money a friend repays (a linked 'owed' debt) is netted out of the real cost.
function shareForExpense(t: ExpRow, lens: string, ctx: Ctx): number {
  const total = toArs(t.amount, t.currency, t.usd_rate_snapshot, ctx.blue);
  let base: number, owns: boolean;
  if (lens === 'everyone') { base = total; owns = true; }
  else if (lens === 'household') { if (t.scope !== 'household') return 0; base = total; owns = true; }
  else {
    owns = t.profile_id === lens;
    if (!t.is_shared) base = owns ? total : 0;
    else {
      const sp = t.splits ?? [];
      const iOwe = sp.filter(s => s.ower_profile_id === lens).reduce((a, s) => a + s.amount, 0);
      if (iOwe > 0) base = iOwe;
      else { const owedToMe = sp.filter(s => s.payer_profile_id === lens).reduce((a, s) => a + s.amount, 0); base = owedToMe > 0 ? Math.max(0, total - owedToMe) : (owns ? total : 0); }
    }
  }
  if (base <= 0) return 0;
  return owns ? Math.max(0, base - owedBackArs(t.id, ctx.debtByTx, ctx.blue)) : base;
}

// ── tool executors (all money math lives here) ───────────────────────────────
interface AggInput { type?: string; lens?: string; group_by?: string; category?: string; merchant?: string; date_from?: string; date_to?: string; limit?: number }
async function aggregateTransactions(ctx: Ctx, input: AggInput) {
  const type = input.type === 'income' ? 'income' : 'expense';
  const lensParam = input.lens ?? 'everyone';
  const lensTarget = lensParam === 'mine' ? ctx.askerId : lensParam === 'partner' ? (ctx.partnerId ?? '__none__') : lensParam; // 'household' | 'everyone' | profileId
  let q = ctx.admin.from('transactions')
    .select('id,categories(name),profile_id,scope,is_shared,amount,currency,usd_rate_snapshot,merchant,occurred_on,splits(payer_profile_id,ower_profile_id,amount)')
    .eq('household_id', ctx.hid).eq('type', type);
  if (input.date_from) q = q.gte('occurred_on', input.date_from);
  if (input.date_to) q = q.lte('occurred_on', input.date_to);
  const { data } = await q;
  let rows = ((data ?? []) as (ExpRow & { categories: { name: string } | null; merchant: string | null; occurred_on: string })[]);
  if (input.category) rows = rows.filter(r => norm(r.categories?.name ?? '').includes(norm(input.category!)));
  if (input.merchant) rows = rows.filter(r => norm(r.merchant ?? '').includes(norm(input.merchant!)));

  // income has no shares/scope: a person's income = what they received; household/everyone = all.
  const contrib = (t: typeof rows[number], lens: string): number => {
    if (type === 'income') {
      const total = toArs(t.amount, t.currency, t.usd_rate_snapshot, ctx.blue);
      return (lens === 'everyone' || lens === 'household') ? total : (t.profile_id === lens ? total : 0);
    }
    return shareForExpense(t, lens, ctx);
  };

  const gb = input.group_by && input.group_by !== 'none' ? input.group_by : null;

  if (gb === 'person') {
    // each person's own share (ignores lens; this IS the per-person split)
    const people = Object.entries(ctx.pm);
    const groups = people.map(([pid, name]) => ({ key: name, total_ars: Math.round(rows.reduce((s, t) => s + contrib(t, pid), 0)), count: rows.filter(t => contrib(t, pid) > 0).length }))
      .filter(g => g.total_ars > 0).sort((a, b) => b.total_ars - a.total_ars);
    return { type, lens: 'por persona', total_ars: groups.reduce((s, g) => s + g.total_ars, 0), group_by: 'person', groups };
  }

  if (lensTarget === '__none__') return { type, note: 'No encontré a esa persona en el hogar.', total_ars: 0, groups: [] };

  const withShare = rows.map(t => ({ t, ars: contrib(t, lensTarget) })).filter(x => x.ars > 0);
  const total = withShare.reduce((s, x) => s + x.ars, 0);
  let groups: { key: string; total_ars: number; count: number }[] = [];
  if (gb) {
    const map: Record<string, { total: number; count: number }> = {};
    for (const { t, ars } of withShare) {
      const k = gb === 'category' ? (t.categories?.name ?? 'Sin categoría') : gb === 'merchant' ? (t.merchant || '(sin comercio)') : gb === 'month' ? (t.occurred_on || '').slice(0, 7) : (t.scope ?? '?');
      if (!map[k]) map[k] = { total: 0, count: 0 };
      map[k].total += ars; map[k].count++;
    }
    groups = Object.entries(map).map(([key, v]) => ({ key, total_ars: Math.round(v.total), count: v.count }))
      .sort((a, b) => gb === 'month' ? a.key.localeCompare(b.key) : b.total_ars - a.total_ars).slice(0, input.limit || 12);
  }
  const lensLabel = lensParam === 'mine' ? `${ctx.pm[ctx.askerId] ?? 'vos'} (tu parte)` : lensParam === 'partner' ? `${ctx.partnerId ? ctx.pm[ctx.partnerId] : 'pareja'} (su parte)` : lensParam === 'household' ? 'hogar / compartido' : 'todo el hogar (combinado)';
  return { type, lens: lensLabel, total_ars: Math.round(total), count: withShare.length, group_by: gb ?? 'none', groups, note: withShare.length === 0 ? 'No hay transacciones para esos filtros.' : undefined };
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
    ctx.admin.from('budgets').select('amount,currency,scope,profile_id,categories(name)').eq('household_id', ctx.hid).eq('active', true),
    ctx.admin.from('transactions').select('id,categories(name),profile_id,scope,is_shared,amount,currency,usd_rate_snapshot,splits(payer_profile_id,ower_profile_id,amount)').eq('household_id', ctx.hid).eq('type', 'expense').gte('occurred_on', iso(y, m, 1)).lt('occurred_on', iso(y, m + 1, 1)),
  ]);
  const rows = (exp ?? []) as (ExpRow & { categories: { name: string } | null })[];
  return {
    budgets: ((buds ?? []) as { amount: number; currency: string; scope: string; profile_id: string | null; categories: { name: string } | null }[]).map(b => {
      const name = b.categories?.name ?? '';
      const limit = b.currency === 'USD' ? b.amount * ctx.blue : b.amount;
      const lens = b.scope === 'household' ? 'household' : (b.profile_id ?? ctx.askerId);
      const spent = rows.filter(t => (t.categories?.name ?? '') === name).reduce((s, t) => s + shareForExpense(t, lens, ctx), 0);
      return { category: name, scope: b.scope, owner: b.profile_id ? (ctx.pm[b.profile_id] ?? null) : null, spent_ars: Math.round(spent), limit_ars: Math.round(limit), pct: limit > 0 ? Math.round(spent / limit * 100) : 0 };
    }),
  };
}

async function getGoals(ctx: Ctx) {
  const { data } = await ctx.admin.from('goals').select('name,target_amount,current_amount,target_currency,deadline,scope,profile_id').eq('household_id', ctx.hid).eq('archived', false);
  return { goals: ((data ?? []) as { name: string; target_amount: number; current_amount: number; target_currency: string; deadline: string | null; scope: string; profile_id: string | null }[]).map(g => ({ name: g.name, scope: g.scope, owner: g.profile_id ? (ctx.pm[g.profile_id] ?? null) : null, current: Math.round(g.current_amount), target: Math.round(g.target_amount), currency: g.target_currency, pct: g.target_amount > 0 ? Math.round(g.current_amount / g.target_amount * 100) : 0, deadline: g.deadline })) };
}

async function getDebts(ctx: Ctx) {
  const { data } = await ctx.admin.from('debts').select('counterparty,direction,amount,currency,note').eq('household_id', ctx.hid).eq('settled', false);
  return { debts: ((data ?? []) as { counterparty: string; direction: string; amount: number; currency: string; note: string | null }[]).map(d => ({ counterparty: d.counterparty, direction: d.direction === 'owe' ? 'debemos' : 'nos deben', amount: Math.round(d.amount), currency: d.currency, note: d.note })) };
}

async function getRecurring(ctx: Ctx) {
  // goal_id is null: goal auto-contributions are savings, not fixed expenses.
  const { data } = await ctx.admin.from('recurring_rules').select('label,amount,currency,cadence,direction,scope,profile_id,categories(name)').eq('household_id', ctx.hid).eq('active', true).is('goal_id', null);
  const rows = ((data ?? []) as { label: string; amount: number; currency: string; cadence: string; direction: string; scope: string; profile_id: string; categories: { name: string } | null }[]).map(r => ({
    label: r.label, direction: r.direction, category: r.categories?.name ?? null, scope: r.scope, owner: ctx.pm[r.profile_id] ?? null,
    monthly_ars: Math.round((r.currency === 'USD' ? r.amount * ctx.blue : r.amount) * (MONTHLY[r.cadence] ?? 1)), cadence: r.cadence,
  }));
  const expTotal = rows.filter(r => r.direction === 'expense').reduce((s, r) => s + r.monthly_ars, 0);
  return { rules: rows, fixed_expense_monthly_ars: Math.round(expTotal) };
}

interface ItemParent { occurred_on: string; currency: string; usd_rate_snapshot: number | null; scope: string; is_shared: boolean; profile_id: string; amount: number; splits: Split[] | null }
// Fraction of a transaction attributable to a lens (0..1), for splitting line items.
function lensFraction(p: ItemParent, lensTarget: string, blue: number): number {
  const total = toArs(p.amount, p.currency, p.usd_rate_snapshot, blue);
  if (lensTarget === 'everyone') return 1;
  if (lensTarget === 'household') return p.scope === 'household' ? 1 : 0;
  let base: number;
  if (!p.is_shared) base = p.profile_id === lensTarget ? total : 0;
  else {
    const sp = p.splits ?? [];
    const iOwe = sp.filter(s => s.ower_profile_id === lensTarget).reduce((a, s) => a + s.amount, 0);
    if (iOwe > 0) base = iOwe;
    else { const owedToMe = sp.filter(s => s.payer_profile_id === lensTarget).reduce((a, s) => a + s.amount, 0); base = owedToMe > 0 ? Math.max(0, total - owedToMe) : (p.profile_id === lensTarget ? total : 0); }
  }
  return total > 0 ? base / total : 0;
}

// Analyse the line ITEMS inside scanned receipts (transaction_items): what was
// actually bought, grouped by type or product name. Amounts are in the parent
// transaction's currency → normalised to ARS, and split by lens proportionally.
interface ItemAggInput { lens?: string; group?: string; group_by?: string; date_from?: string; date_to?: string; limit?: number }
async function aggregateItems(ctx: Ctx, input: ItemAggInput) {
  const lensParam = input.lens ?? 'everyone';
  const lensTarget = lensParam === 'mine' ? ctx.askerId : lensParam === 'partner' ? (ctx.partnerId ?? '__none__') : lensParam;
  if (lensTarget === '__none__') return { note: 'No encontré a esa persona.', total_ars: 0, groups: [] };
  let q = ctx.admin.from('transaction_items')
    .select('item_group,name,line_total,transactions!inner(occurred_on,currency,usd_rate_snapshot,scope,is_shared,profile_id,amount,type,splits(payer_profile_id,ower_profile_id,amount))')
    .eq('household_id', ctx.hid).eq('transactions.type', 'expense');
  if (input.date_from) q = q.gte('transactions.occurred_on', input.date_from);
  if (input.date_to) q = q.lte('transactions.occurred_on', input.date_to);
  const { data } = await q;
  type Row = { item_group: string; name: string; line_total: number; transactions: ItemParent };
  let rows = (data ?? []) as unknown as Row[];
  if (input.group) rows = rows.filter(r => norm(r.item_group ?? '').includes(norm(input.group!)));
  const withArs = rows.map(r => ({ r, ars: toArs(r.line_total, r.transactions.currency, r.transactions.usd_rate_snapshot, ctx.blue) * lensFraction(r.transactions, lensTarget, ctx.blue) })).filter(x => x.ars > 0);
  const total = withArs.reduce((s, x) => s + x.ars, 0);
  const gb = input.group_by === 'name' ? 'name' : 'item_group';
  const map: Record<string, { total: number; count: number }> = {};
  for (const { r, ars } of withArs) { const k = gb === 'name' ? r.name : (r.item_group || 'otros'); if (!map[k]) map[k] = { total: 0, count: 0 }; map[k].total += ars; map[k].count++; }
  const groups = Object.entries(map).map(([key, v]) => ({ key, total_ars: Math.round(v.total), count: v.count })).sort((a, b) => b.total_ars - a.total_ars).slice(0, input.limit || 12);
  return { total_ars: Math.round(total), items_count: withArs.length, group_by: gb, groups, note: withArs.length === 0 ? 'No hay ítems de ticket para esos filtros (los ítems se cargan al escanear un ticket).' : undefined };
}

const TOOLS = [
  {
    name: 'aggregate_transactions',
    description: 'Suma y agrupa transacciones reales del hogar (gastos o ingresos), convertidas a ARS. Es la herramienta principal para "cuánto / en qué / cuándo / quién". Elegí el lens correcto según la pregunta.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['expense', 'income'], description: 'gasto (default) o ingreso' },
        lens: { type: 'string', enum: ['mine', 'partner', 'household', 'everyone'], description: 'Punto de vista: "mine"=la parte de quien pregunta (sus gastos personales + su mitad de lo compartido, neto de lo que le devuelven); "partner"=la parte de su pareja; "household"=solo lo compartido/del hogar; "everyone"=todo el dinero gastado por la pareja combinado (default). Elegilo según la pregunta ("mis gastos"→mine, "lo del hogar/juntos"→household, "cuánto gastamos en total"→everyone).' },
        group_by: { type: 'string', enum: ['none', 'category', 'merchant', 'month', 'person', 'scope'], description: 'desglose. "person" devuelve la parte real de cada integrante (ignora lens).' },
        category: { type: 'string', description: 'filtrar por nombre de categoría (parcial)' },
        merchant: { type: 'string', description: 'filtrar por comercio (parcial)' },
        date_from: { type: 'string', description: 'desde inclusive YYYY-MM-DD' },
        date_to: { type: 'string', description: 'hasta inclusive YYYY-MM-DD' },
        limit: { type: 'number', description: 'máximo de grupos (default 12)' },
      },
      required: [],
    },
  },
  { name: 'get_balances', description: 'Saldo actual de cada cuenta (en su moneda y en ARS) y el patrimonio neto del hogar.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_budgets', description: 'Presupuestos activos (con su scope personal/hogar y dueño) y lo gastado este mes vs el límite, usando la parte que le corresponde a cada uno.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_goals', description: 'Metas de ahorro con progreso, scope y dueño.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_debts', description: 'Deudas sin saldar (a quién le deben o quién les debe).', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_recurring', description: 'Gastos fijos y suscripciones activas (con scope y dueño, equivalente mensual en ARS) e ingresos recurrentes.', input_schema: { type: 'object', properties: {}, required: [] } },
  {
    name: 'aggregate_items',
    description: 'Analiza los ÍTEMS dentro de los tickets escaneados (qué se compró), agrupados por tipo (comida, bebidas, snacks, limpieza, cuidado personal, hogar, mascotas, otros) o por nombre de producto. Usala para "¿en qué se va el súper?", "¿cuánto gastamos en snacks/bebidas?", "¿qué compramos más?". Respeta el lens igual que aggregate_transactions.',
    input_schema: {
      type: 'object',
      properties: {
        lens: { type: 'string', enum: ['mine', 'partner', 'household', 'everyone'], description: 'punto de vista (igual que en aggregate_transactions)' },
        group: { type: 'string', description: 'filtrar por un tipo de ítem (ej. snacks, bebidas, limpieza)' },
        group_by: { type: 'string', enum: ['item_group', 'name'], description: 'agrupar por tipo de ítem (default) o por nombre de producto' },
        date_from: { type: 'string', description: 'desde inclusive YYYY-MM-DD' },
        date_to: { type: 'string', description: 'hasta inclusive YYYY-MM-DD' },
        limit: { type: 'number', description: 'máximo de grupos (default 12)' },
      },
      required: [],
    },
  },
];

async function runTool(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  switch (name) {
    case 'aggregate_transactions': return await aggregateTransactions(ctx, input as AggInput);
    case 'get_balances': return await getBalances(ctx);
    case 'get_budgets': return await getBudgets(ctx);
    case 'get_goals': return await getGoals(ctx);
    case 'get_debts': return await getDebts(ctx);
    case 'get_recurring': return await getRecurring(ctx);
    case 'aggregate_items': return await aggregateItems(ctx, input as ItemAggInput);
    default: return { error: 'herramienta desconocida' };
  }
}

function buildPrimer(ctx: Ctx): string {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const asker = ctx.pm[ctx.askerId] ?? 'el usuario';
  const partner = ctx.partnerId ? (ctx.pm[ctx.partnerId] ?? 'su pareja') : 'su pareja';
  return [
    `Hoy es ${iso(y, m, now.getDate())} (${months[m]} de ${y}).`,
    `Quien te escribe es ${asker}. Su pareja es ${partner}.`,
    `Categorías de gasto existentes (usá estos nombres exactos al filtrar): ${ctx.catNames || 'n/d'}.`,
    'Cada gasto puede ser personal (de una persona) o del hogar (compartido). Para "mis/mi" usá lens="mine"; para tu pareja lens="partner"; para lo compartido/del hogar/"juntos" lens="household"; para el total combinado lens="everyone".',
    'La moneda base es el peso argentino (ARS); los dólares ya vienen convertidos en las herramientas.',
  ].join('\n');
}

const SYSTEM = 'Sos Morchi, el asistente financiero de la pareja Lucas y Sofi en la app Morchis (es-AR, tono cercano y motivador). Tenés HERRAMIENTAS para consultar su base de datos financiera real. Para CUALQUIER pregunta sobre montos, gastos, ingresos, comercios, categorías, meses, saldos, presupuestos, metas o deudas, USÁ las herramientas para obtener los números exactos antes de responder. IMPORTANTE: distinguí gastos personales de los del hogar según la pregunta y elegí el lens adecuado en aggregate_transactions (mine/partner/household/everyone). Si la pregunta es ambigua entre "lo mío" y "lo de los dos", aclaralo brevemente en la respuesta o preguntá. Reglas: (1) Nunca inventes ni estimes montos: salen siempre de las herramientas; si no hay datos, decílo. (2) Para fechas usá el dato de "Hoy". (3) Mostrá montos en formato $1.234.567. (4) Sé conciso: 2 a 4 oraciones. No uses tablas markdown ni encabezados; si listás, pocas líneas cortas con guión (-). Para resaltar usá **negrita**. (5) Para consejos, basate en los números que consultaste.';

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
  let askerId: string | null = null;
  if (jwtPayload(token)?.role === 'service_role') {
    const { data: hh } = await admin.from('households').select('id').limit(1).single();
    hid = hh?.id ?? null;
  } else {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
    const { data: prof } = await admin.from('profiles').select('household_id').eq('id', user.id).single();
    hid = prof?.household_id ?? null;
    askerId = user.id;
  }
  if (!hid) return new Response(JSON.stringify({ error: 'No household' }), { status: 400, headers: cors });

  let body: { question?: string; history?: { role: string; content: string }[]; as?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const question = (body.question ?? '').trim();
  if (!question) return new Response(JSON.stringify({ error: 'question requerida' }), { status: 400, headers: cors });

  const [{ data: fxRow }, { data: profs }, { data: debtRows }, { data: cats }] = await Promise.all([
    admin.from('fx_rates').select('ars_per_usd').eq('source', 'blue').order('date', { ascending: false }).limit(1).maybeSingle(),
    admin.from('profiles').select('id,nickname,display_name').eq('household_id', hid),
    // Linked friend-debts net out of the expense's real cost regardless of
    // settled — the friend paying back doesn't make the expense cost more.
    admin.from('debts').select('transaction_id,direction,amount,currency').eq('household_id', hid).not('transaction_id', 'is', null),
    admin.from('categories').select('name').eq('household_id', hid).eq('kind', 'expense'),
  ]);
  const blue = Number(fxRow?.ars_per_usd ?? 1200);
  const catNames = ((cats ?? []) as { name: string }[]).map(c => c.name).join(', ');
  const pm: Record<string, string> = {};
  const profiles = (profs ?? []) as { id: string; nickname: string | null; display_name: string | null }[];
  for (const p of profiles) pm[p.id] = p.nickname ?? p.display_name ?? 'Usuario';
  // Real users: askerId comes from their JWT (set above). Only the admin/test
  // path leaves it null — there an optional `as` (nickname or id) picks whose
  // viewpoint to simulate, otherwise the first profile.
  if (!askerId) {
    const asKey = (body.as ?? '').toLowerCase();
    askerId = (asKey ? profiles.find(p => (p.nickname ?? '').toLowerCase() === asKey || (p.display_name ?? '').toLowerCase() === asKey || p.id === body.as)?.id : null) ?? profiles[0]?.id ?? '';
  }
  const partnerId = profiles.find(p => p.id !== askerId)?.id ?? null;
  const debtByTx: Record<string, Debt[]> = {};
  for (const d of (debtRows ?? []) as Debt[]) { if (!d.transaction_id) continue; (debtByTx[d.transaction_id] ??= []).push(d); }
  const ctx: Ctx = { admin, hid, blue, pm, askerId, partnerId, debtByTx, catNames };

  const primer = buildPrimer(ctx);
  const history = (body.history ?? []).slice(-6)
    .filter(h => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
    .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }));

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [...history, { role: 'user', content: question }];

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
