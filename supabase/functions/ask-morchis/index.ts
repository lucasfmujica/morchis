import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { iso, MONTHLY, norm, toArs, jwtPayload, shareForExpense, lensFraction, buildPrimer } from "./math.ts";
import type { Debt, ExpRow, ItemParent } from "./math.ts";
import { computeProjection } from "../_shared/projection.ts";

// "Preguntale a Morchi" — an agent that can answer ANY question about the
// household finances. Claude has tools to query the database; every tool runs a
// deterministic TypeScript aggregation (USD normalised to ARS). The model only
// decides what to query and writes the answer — it never does arithmetic.
//
// The `lens` of aggregate_transactions mirrors the coach: it distinguishes a
// person's own share (personal + their split of shared, minus what a friend
// repays) from the household's shared spending, so the chat can tell apart
// "mis gastos" from "gastos del hogar" based on the question.

interface Ctx {
  admin: SupabaseClient; hid: string; blue: number;
  pm: Record<string, string>; askerId: string; partnerId: string | null;
  debtByTx: Record<string, Debt[]>; catNames: string;
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
  // Envelope model: a category's "budget" is its monthly target (category_targets).
  const [{ data: buds }, { data: exp }] = await Promise.all([
    ctx.admin.from('category_targets').select('target_amount,currency,profile_id,categories(name)').eq('household_id', ctx.hid),
    ctx.admin.from('transactions').select('id,categories(name),profile_id,scope,is_shared,amount,currency,usd_rate_snapshot,splits(payer_profile_id,ower_profile_id,amount)').eq('household_id', ctx.hid).eq('type', 'expense').gte('occurred_on', iso(y, m, 1)).lt('occurred_on', iso(y, m + 1, 1)),
  ]);
  const rows = (exp ?? []) as (ExpRow & { categories: { name: string } | null })[];
  return {
    budgets: ((buds ?? []) as { target_amount: number; currency: string; profile_id: string | null; categories: { name: string } | null }[]).map(b => {
      const name = b.categories?.name ?? '';
      const limit = b.currency === 'USD' ? b.target_amount * ctx.blue : b.target_amount;
      const lens = b.profile_id ?? ctx.askerId;
      const spent = rows.filter(t => (t.categories?.name ?? '') === name).reduce((s, t) => s + shareForExpense(t, lens, ctx), 0);
      return { category: name, scope: 'personal', owner: b.profile_id ? (ctx.pm[b.profile_id] ?? null) : null, spent_ars: Math.round(spent), limit_ars: Math.round(limit), pct: limit > 0 ? Math.round(spent / limit * 100) : 0 };
    }),
  };
}

async function getGoals(ctx: Ctx) {
  // Savings goals are is_goal categories with a target; progress = Σ assigned to date.
  const [{ data: cats }, { data: tgts }, { data: bm }] = await Promise.all([
    ctx.admin.from('categories').select('id,name').eq('household_id', ctx.hid).eq('is_goal', true),
    ctx.admin.from('category_targets').select('category_id,target_amount,currency,target_date,profile_id').eq('household_id', ctx.hid),
    ctx.admin.from('budget_months').select('category_id,assigned,currency').eq('household_id', ctx.hid),
  ]);
  const targets = (tgts ?? []) as { category_id: string; target_amount: number; currency: string; target_date: string | null; profile_id: string | null }[];
  const assigned = (bm ?? []) as { category_id: string; assigned: number; currency: string }[];
  return {
    goals: ((cats ?? []) as { id: string; name: string }[]).map(c => {
      const t = targets.find(x => x.category_id === c.id);
      if (!t) return null;
      const current = assigned.filter(a => a.category_id === c.id).reduce((s, a) => s + (a.currency === 'USD' ? a.assigned * ctx.blue : a.assigned), 0);
      const target = t.currency === 'USD' ? t.target_amount * ctx.blue : t.target_amount;
      return { name: c.name, scope: 'personal', owner: t.profile_id ? (ctx.pm[t.profile_id] ?? null) : null, current: Math.round(current), target: Math.round(target), currency: 'ARS', pct: target > 0 ? Math.round(current / target * 100) : 0, deadline: t.target_date };
    }).filter(Boolean),
  };
}

async function getDebts(ctx: Ctx) {
  const { data } = await ctx.admin.from('debts').select('counterparty,direction,amount,currency,note').eq('household_id', ctx.hid).eq('settled', false);
  return { debts: ((data ?? []) as { counterparty: string; direction: string; amount: number; currency: string; note: string | null }[]).map(d => ({ counterparty: d.counterparty, direction: d.direction === 'owe' ? 'debemos' : 'nos deben', amount: Math.round(d.amount), currency: d.currency, note: d.note })) };
}

async function getRecurring(ctx: Ctx) {
  const { data } = await ctx.admin.from('recurring_rules').select('label,amount,currency,cadence,direction,scope,profile_id,categories(name)').eq('household_id', ctx.hid).eq('active', true);
  const rows = ((data ?? []) as { label: string; amount: number; currency: string; cadence: string; direction: string; scope: string; profile_id: string; categories: { name: string } | null }[]).map(r => ({
    label: r.label, direction: r.direction, category: r.categories?.name ?? null, scope: r.scope, owner: ctx.pm[r.profile_id] ?? null,
    monthly_ars: Math.round((r.currency === 'USD' ? r.amount * ctx.blue : r.amount) * (MONTHLY[r.cadence] ?? 1)), cadence: r.cadence,
  }));
  const expTotal = rows.filter(r => r.direction === 'expense').reduce((s, r) => s + r.monthly_ars, 0);
  return { rules: rows, fixed_expense_monthly_ars: Math.round(expTotal) };
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

// End-of-month projection for the whole household, with optional purchase sim.
interface ProjInput { purchase_amount?: number; purchase_currency?: string; installments?: number }
async function projectMonth(ctx: Ctx, input: ProjInput) {
  const artNow = new Date(Date.now() - 3 * 60 * 60 * 1000); // ARG (UTC-3)
  const y = artNow.getUTCFullYear(), m = artNow.getUTCMonth();
  const ms = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const me = `${y}-${String(m + 1).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
  const [{ data: txRows }, { data: ruleRows }] = await Promise.all([
    ctx.admin.from('transactions').select('type,amount,currency,usd_rate_snapshot,occurred_on').eq('household_id', ctx.hid).gte('occurred_on', ms).lte('occurred_on', me),
    ctx.admin.from('recurring_rules').select('direction,amount,currency,next_run,active,cadence').eq('household_id', ctx.hid).eq('active', true),
  ]);
  const txs = ((txRows ?? []) as { type: string; amount: number; currency: string; usd_rate_snapshot: number | null; occurred_on: string }[])
    .map(t => ({ type: t.type, amount: toArs(t.amount, t.currency, t.usd_rate_snapshot, ctx.blue), occurred_on: t.occurred_on }));
  const rules = ((ruleRows ?? []) as { direction: string; amount: number; currency: string; next_run: string | null; active: boolean; cadence: string | null }[])
    .map(r => ({ direction: r.direction, amount: toArs(r.amount, r.currency, null, ctx.blue), next_run: r.next_run, active: r.active, cadence: r.cadence }));
  const proj = computeProjection(txs, rules, artNow);
  let purchase: { amount_ars: number; installments: number | null; monthly_cost_ars: number; projected_end_balance_after_ars: number } | undefined;
  const amt = Number(input.purchase_amount);
  if (amt && amt > 0) {
    const ars = input.purchase_currency === 'USD' ? amt * ctx.blue : amt;
    const inst = Number(input.installments);
    const monthly = inst && inst > 1 ? Math.round(ars / inst) : Math.round(ars);
    purchase = { amount_ars: Math.round(ars), installments: inst > 1 ? inst : null, monthly_cost_ars: monthly, projected_end_balance_after_ars: Math.round(proj.projectedBalance - monthly) };
  }
  return {
    scope: 'todo el hogar',
    expenses_so_far_ars: Math.round(proj.expensesSoFar),
    remaining_fixed_ars: Math.round(proj.remainingFixed),
    remaining_income_ars: Math.round(proj.remainingIncome),
    projected_end_balance_ars: Math.round(proj.projectedBalance),
    projected_total_income_ars: Math.round(proj.totalIncome),
    projected_savings_rate_pct: proj.totalIncome > 0 ? Math.round(proj.projectedBalance / proj.totalIncome * 100) : null,
    purchase,
  };
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
  {
    name: 'project_month',
    description: 'Proyección de fin de mes del HOGAR: lo gastado hasta hoy, los gastos fijos e ingresos que faltan, y el saldo proyectado a fin de mes al ritmo actual. Opcional: simular una compra (purchase_amount, en cuotas) para ver el impacto. Usala para "¿llegamos a fin de mes?", "¿podemos comprar X?", "¿cuánto nos va a sobrar?".',
    input_schema: {
      type: 'object',
      properties: {
        purchase_amount: { type: 'number', description: 'monto de una compra hipotética a simular (opcional)' },
        purchase_currency: { type: 'string', enum: ['ARS', 'USD'], description: 'moneda de la compra (default ARS)' },
        installments: { type: 'number', description: 'cantidad de cuotas de la compra (opcional)' },
      },
      required: [],
    },
  },
  {
    name: 'record_transaction',
    description: 'PREVISUALIZA registrar un gasto o ingreso personal de quien escribe (no escribe hasta que el usuario confirme con el botón). Usala cuando pidan "anotá/registrá/cargá un gasto/ingreso".',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['expense', 'income'], description: 'gasto (default) o ingreso' },
        amount: { type: 'number', description: 'monto positivo en la moneda indicada' },
        currency: { type: 'string', enum: ['ARS', 'USD'], description: 'ARS (default) o USD' },
        category: { type: 'string', description: 'nombre de la categoría (se resuelve a la existente más parecida; opcional)' },
        merchant: { type: 'string', description: 'comercio/descripción (opcional)' },
        date: { type: 'string', description: 'fecha YYYY-MM-DD (default hoy)' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'settle_debt',
    description: 'PREVISUALIZA marcar como saldada(s) la(s) deuda(s) sin saldar con una persona (no escribe hasta que el usuario confirme).',
    input_schema: { type: 'object', properties: { counterparty: { type: 'string', description: 'nombre de la persona de la deuda' } }, required: ['counterparty'] },
  },
  {
    name: 'set_category_budget',
    description: 'PREVISUALIZA fijar el presupuesto (target del sobre) de una categoría de gasto de quien escribe (no escribe hasta confirmar).',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'nombre de la categoría de gasto' },
        amount: { type: 'number', description: 'monto del presupuesto, positivo' },
        currency: { type: 'string', enum: ['ARS', 'USD'], description: 'ARS (default) o USD' },
        cadence: { type: 'string', enum: ['monthly', 'weekly'], description: 'mensual (default) o semanal' },
      },
      required: ['category', 'amount'],
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
    case 'project_month': return await projectMonth(ctx, input as ProjInput);
    default: return { error: 'herramienta desconocida' };
  }
}

// ── write actions ───────────────────────────────────────────────────────────
// Morchi never writes on its own. A write tool only PREVIEWS: it validates and
// resolves a PendingAction that the client renders as a confirm card. The DB
// write happens later, when the client re-calls with `confirm: <action>` and
// executeAction runs — re-deriving household/owner from the JWT so the
// service-role client can't be tricked into touching another household.
const WRITE_TOOLS = new Set(['record_transaction', 'settle_debt', 'set_category_budget']);
interface PendingAction { kind: string; payload: Record<string, unknown>; summary: string }
const todayISO = () => new Date().toISOString().slice(0, 10);
const arsFmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

async function resolveCategory(ctx: Ctx, name: unknown, kind: 'expense' | 'income'): Promise<{ id: string | null; name: string | null }> {
  const q = (name ?? '').toString().trim();
  if (!q) return { id: null, name: null };
  const { data } = await ctx.admin.from('categories').select('id,name').eq('household_id', ctx.hid).eq('kind', kind);
  const cats = (data ?? []) as { id: string; name: string }[];
  const n = norm(q);
  const hit = cats.find(c => norm(c.name) === n) ?? cats.find(c => norm(c.name).includes(n) || n.includes(norm(c.name)));
  return hit ? { id: hit.id, name: hit.name } : { id: null, name: null };
}

// Validate + resolve a tool call into a PendingAction (no write). Returns {error} on bad input.
async function buildAction(ctx: Ctx, kind: string, input: Record<string, unknown>): Promise<PendingAction | { error: string }> {
  if (kind === 'record_transaction') {
    const type = input.type === 'income' ? 'income' : 'expense';
    const amount = Number(input.amount);
    if (!amount || amount <= 0) return { error: 'El monto tiene que ser un número positivo.' };
    const currency = input.currency === 'USD' ? 'USD' : 'ARS';
    const occurred_on = (typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date)) ? input.date : todayISO();
    const cat = await resolveCategory(ctx, input.category, type);
    const merchant = (input.merchant ?? '').toString().trim() || null;
    const payload = {
      household_id: ctx.hid, profile_id: ctx.askerId, type, amount, currency,
      usd_rate_snapshot: currency === 'USD' ? ctx.blue : null, category_id: cat.id,
      account_id: null, merchant, occurred_on, scope: 'personal', is_shared: false,
      is_fixed: false, flag: null, source: 'manual',
    };
    const amountTxt = currency === 'USD' ? `US$${amount}` : arsFmt(amount);
    const summary = `${type === 'income' ? 'Ingreso' : 'Gasto'} de ${amountTxt}${cat.name ? ` en ${cat.name}` : ''}${merchant ? ` (${merchant})` : ''}${occurred_on !== todayISO() ? ` el ${occurred_on}` : ''}`;
    return { kind, payload, summary };
  }
  if (kind === 'settle_debt') {
    const who = (input.counterparty ?? '').toString().trim();
    if (!who) return { error: 'Decime con quién es la deuda.' };
    const { data } = await ctx.admin.from('debts').select('id,counterparty,amount,currency').eq('household_id', ctx.hid).eq('settled', false);
    const debts = (data ?? []) as { id: string; counterparty: string; amount: number; currency: string }[];
    const matches = debts.filter(d => norm(d.counterparty).includes(norm(who)) || norm(who).includes(norm(d.counterparty)));
    if (matches.length === 0) return { error: `No encontré deudas sin saldar con "${who}".` };
    const total = matches.reduce((s, d) => s + (d.currency === 'USD' ? d.amount * ctx.blue : d.amount), 0);
    const summary = `Saldar ${matches.length} deuda${matches.length > 1 ? 's' : ''} con ${matches[0].counterparty} (≈ ${arsFmt(total)})`;
    return { kind, payload: { ids: matches.map(d => d.id) }, summary };
  }
  if (kind === 'set_category_budget') {
    const cat = await resolveCategory(ctx, input.category, 'expense');
    if (!cat.id) return { error: `No encontré la categoría "${(input.category ?? '').toString()}".` };
    const amount = Number(input.amount);
    if (!amount || amount <= 0) return { error: 'El monto tiene que ser un número positivo.' };
    const currency = input.currency === 'USD' ? 'USD' : 'ARS';
    const cadence = input.cadence === 'weekly' ? 'weekly' : 'monthly';
    const amountTxt = currency === 'USD' ? `US$${amount}` : arsFmt(amount);
    const summary = `Presupuesto ${cadence === 'weekly' ? 'semanal' : 'mensual'} de ${amountTxt} para ${cat.name}`;
    return { kind, payload: { category_id: cat.id, target_amount: amount, currency, cadence }, summary };
  }
  return { error: 'Acción desconocida.' };
}

// Execute a confirmed action. Re-derives household/owner from ctx (never trusts
// client-supplied ids for ownership) and re-checks that referenced rows are this
// household's.
async function executeAction(ctx: Ctx, action: PendingAction): Promise<string> {
  if (action.kind === 'record_transaction') {
    const p = { ...action.payload, household_id: ctx.hid, profile_id: ctx.askerId, scope: 'personal', is_shared: false, source: 'manual' };
    const { error } = await ctx.admin.from('transactions').insert(p);
    if (error) throw error;
    return `Listo, lo anoté: ${action.summary}. ✅`;
  }
  if (action.kind === 'settle_debt') {
    const wanted = (action.payload.ids as string[]) ?? [];
    const { data } = await ctx.admin.from('debts').select('id').eq('household_id', ctx.hid).eq('settled', false).in('id', wanted);
    const ids = ((data ?? []) as { id: string }[]).map(d => d.id);
    if (ids.length === 0) throw new Error('no matching debts');
    const { error } = await ctx.admin.from('debts').update({ settled: true }).in('id', ids);
    if (error) throw error;
    return `Listo, marqué como saldada${ids.length > 1 ? 's' : ''} ${ids.length} deuda${ids.length > 1 ? 's' : ''}. ✅`;
  }
  if (action.kind === 'set_category_budget') {
    const p = action.payload as { category_id: string; target_amount: number; currency: string; cadence: string };
    const { data: cat } = await ctx.admin.from('categories').select('id').eq('household_id', ctx.hid).eq('id', p.category_id).maybeSingle();
    if (!cat) throw new Error('category not in household');
    const { data: existing } = await ctx.admin.from('category_targets').select('id').eq('household_id', ctx.hid).eq('profile_id', ctx.askerId).eq('category_id', p.category_id).maybeSingle();
    if (existing) {
      const { error } = await ctx.admin.from('category_targets').update({ target_amount: p.target_amount, currency: p.currency, cadence: p.cadence }).eq('id', (existing as { id: string }).id);
      if (error) throw error;
    } else {
      const { error } = await ctx.admin.from('category_targets').insert({ household_id: ctx.hid, profile_id: ctx.askerId, category_id: p.category_id, target_amount: p.target_amount, currency: p.currency, cadence: p.cadence });
      if (error) throw error;
    }
    return `Listo, ${action.summary.charAt(0).toLowerCase()}${action.summary.slice(1)}. ✅`;
  }
  if (action.kind === 'record_receipt') {
    // Confirmed from the photo flow: the client parsed a receipt (parse-receipt)
    // and the user tapped Confirmar. Insert the expense + its line items.
    const r = action.payload.receipt as { merchant?: string; date?: string; total: number; currency: string; suggested_category?: string; items?: { name: string; qty?: number; line_total: number; group?: string }[] };
    const amount = Number(r?.total);
    if (!amount || amount <= 0) throw new Error('bad receipt total');
    const currency = r.currency === 'USD' ? 'USD' : 'ARS';
    const occurred_on = (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ? r.date : todayISO();
    const cat = await resolveCategory(ctx, r.suggested_category, 'expense');
    const { data: tx, error } = await ctx.admin.from('transactions').insert({
      household_id: ctx.hid, profile_id: ctx.askerId, type: 'expense', amount, currency,
      usd_rate_snapshot: currency === 'USD' ? ctx.blue : null, category_id: cat.id, account_id: null,
      merchant: r.merchant || 'Compra', occurred_on, scope: 'personal', is_shared: false, is_fixed: false, flag: null, source: 'receipt',
    }).select('id').single();
    if (error || !tx) throw error ?? new Error('insert failed');
    const items = Array.isArray(r.items) ? r.items : [];
    const rows = items.filter(it => it && it.name && Number(it.line_total) > 0)
      .map(it => ({ household_id: ctx.hid, transaction_id: (tx as { id: string }).id, name: String(it.name).slice(0, 200), qty: Number(it.qty) || 1, line_total: Number(it.line_total), item_group: it.group || 'otros' }));
    if (rows.length) await ctx.admin.from('transaction_items').insert(rows);
    return `Listo, cargué el ticket: ${action.summary}. ✅`;
  }
  throw new Error('unknown action');
}

const SYSTEM = 'Sos Morchi, el asistente financiero de la pareja Lucas y Sofi en la app Morchis (es-AR, tono cercano y motivador). Tenés HERRAMIENTAS para consultar su base de datos financiera real. Para CUALQUIER pregunta sobre montos, gastos, ingresos, comercios, categorías, meses, saldos, presupuestos, metas o deudas, USÁ las herramientas para obtener los números exactos antes de responder. IMPORTANTE: distinguí gastos personales de los del hogar según la pregunta y elegí el lens adecuado en aggregate_transactions (mine/partner/household/everyone). Si la pregunta es ambigua entre "lo mío" y "lo de los dos", aclaralo brevemente en la respuesta o preguntá. Reglas: (1) Nunca inventes ni estimes montos: salen siempre de las herramientas; si no hay datos, decílo. (2) Para fechas usá el dato de "Hoy". (3) Mostrá montos en formato $1.234.567. (4) Sé conciso: 2 a 4 oraciones. No uses tablas markdown ni encabezados; si listás, pocas líneas cortas con guión (-). Para resaltar usá **negrita**. (5) Para consejos, basate en los números que consultaste. ACCIONES: además de responder, podés REGISTRAR cosas con record_transaction (anotar un gasto/ingreso), settle_debt (saldar una deuda) y set_category_budget (fijar un presupuesto). Cuando el usuario pida registrar/anotar/cargar/saldar/poner algo, llamá la tool correspondiente (PREVISUALIZA, no escribe), después contale en UNA frase qué vas a hacer y pedile que confirme con el botón de abajo. NUNCA afirmes que ya quedó hecho ni inventes que lo registraste: lo confirma el usuario. Si la tool devuelve un error, explicá brevemente qué falta. SEGUIMIENTOS: al final de CADA respuesta agregá una línea aparte, EXACTA, con 2 o 3 preguntas de seguimiento cortas y relevantes a lo que charlaron, con el formato: SUGERENCIAS: pregunta uno | pregunta dos | pregunta tres. No menciones esa línea en el cuerpo ni uses el prefijo "SUGERENCIAS:" para otra cosa. Si estás proponiendo una acción para confirmar, NO agregues la línea de SUGERENCIAS.';

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

  let body: { question?: string; history?: { role: string; content: string }[]; as?: string; confirm?: PendingAction } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const question = (body.question ?? '').trim();
  // A request carries EITHER a question (chat turn) or a confirm (execute a
  // previously-previewed action). Reject only when both are missing.
  if (!question && !body.confirm) return new Response(JSON.stringify({ error: 'question requerida' }), { status: 400, headers: cors });

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

  // Confirm path: the user tapped "Confirmar" on a previewed action → execute it.
  if (body.confirm) {
    try {
      const answer = await executeAction(ctx, body.confirm);
      return new Response(JSON.stringify({ ok: true, answer }), { headers: cors });
    } catch (e) {
      console.error('executeAction failed', e);
      return new Response(JSON.stringify({ ok: true, answer: 'Uy, no pude completar esa acción. Probá de nuevo en un ratito.' }), { headers: cors });
    }
  }

  const primer = buildPrimer(ctx);
  const history = (body.history ?? []).slice(-6)
    .filter(h => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
    .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }));

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [...history, { role: 'user', content: question }];

  let answer = '';
  let pending: PendingAction | null = null;
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
        let out: unknown;
        if (WRITE_TOOLS.has(block.name)) {
          // Write tools only PREVIEW — they never touch the DB here.
          const built = await buildAction(ctx, block.name, block.input as Record<string, unknown>);
          if ('error' in built) { out = built; }
          else { pending = built; out = { ok: true, preview: built.summary, instruccion: 'Contale al usuario en una frase qué vas a registrar y pedile que confirme con el botón. NO digas que ya quedó hecho.' }; }
        } else {
          out = await runTool(block.name, block.input as Record<string, unknown>, ctx);
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  // Pull the trailing "SUGERENCIAS: a | b | c" line out of the answer into tappable
  // quick-replies. No suggestions alongside an action card (the card is the CTA).
  let suggestions: string[] = [];
  const sm = answer.match(/^[ \t]*SUGERENCIAS:[ \t]*(.+)$/im);
  if (sm) {
    suggestions = sm[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 3);
    answer = answer.replace(/\n?[ \t]*SUGERENCIAS:.*$/im, '').trim();
  }
  if (!answer) answer = pending ? `Voy a registrar: ${pending.summary}. Confirmá abajo 👇` : 'Uy, no pude llegar a una respuesta. Probá reformulando la pregunta.';
  if (pending) suggestions = [];

  return new Response(JSON.stringify({ ok: true, answer, pending_action: pending, suggestions }), { headers: cors });
});
