import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { occurrencesInRange, computeProjection, monthsBetween, normalize } from "./math.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// "now" in Argentina (UTC-3, no DST) — the server clock is UTC and would
// roll to tomorrow / next month after 21:00 local. Use with getUTC* getters.
const artNow = () => new Date(Date.now() - 3 * 60 * 60 * 1000);


Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization,content-type', 'Access-Control-Allow-Methods':'POST,OPTIONS' }
  });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { data: profile } = await admin.from('profiles').select('household_id').eq('id', user.id).single();
  if (!profile?.household_id) return new Response('No household', { status: 400 });
  const hid = profile.household_id;

  const { text } = await req.json();
  if (!text?.trim()) return new Response(JSON.stringify({ error: 'text requerido' }), { status: 400 });

  // ── 1. Fetch all data in parallel ────────────────────────────────────────
  const today = artNow();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const ms = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const me = `${year}-${String(month+1).padStart(2,'0')}-${String(new Date(Date.UTC(year,month+1,0)).getUTCDate()).padStart(2,'0')}`;

  const [txR, rulesR, catsR, targetsR, assignedR, fxR] = await Promise.all([
    admin.from('transactions').select('type,amount,occurred_on,category_id,currency,usd_rate_snapshot').eq('household_id',hid).eq('exclude_from_stats',false).gte('occurred_on',ms).lte('occurred_on',me),
    admin.from('recurring_rules').select('direction,amount,next_run,active,cadence,currency').eq('household_id',hid).eq('active',true),
    admin.from('categories').select('id,name,icon,is_goal').eq('household_id',hid),
    admin.from('category_targets').select('category_id,target_amount,currency,cadence,target_date').eq('household_id',hid),
    admin.from('budget_months').select('category_id,assigned,currency').eq('household_id',hid),
    admin.from('fx_rates').select('ars_per_usd').eq('source','blue').order('date',{ascending:false}).limit(1).maybeSingle(),
  ]);

  const fxRate = Number(fxR.data?.ars_per_usd ?? 1200);
  // Normalise every amount to ARS: USD rows use their frozen snapshot if present,
  // otherwise the latest blue rate. Keeps the simulator consistent with the app.
  const toArs = (amount: number, currency: string | null, snap?: number | null): number =>
    currency === 'USD' ? Math.round(amount * (Number(snap) || fxRate)) : amount;

  const rawTx = (txR.data ?? []) as { type:string; amount:number; occurred_on:string; category_id:string|null; currency:string|null; usd_rate_snapshot:number|null }[];
  const txs = rawTx.map(t => ({ type:t.type, occurred_on:t.occurred_on, category_id:t.category_id, amount: toArs(t.amount, t.currency, t.usd_rate_snapshot) }));
  const rules = ((rulesR.data ?? []) as { direction:string; amount:number; next_run:string|null; active:boolean; cadence:string|null; currency:string|null }[])
    .map(r => ({ direction:r.direction, next_run:r.next_run, active:r.active, cadence:r.cadence, amount: toArs(r.amount, r.currency) }));
  const categories = (catsR.data ?? []) as { id:string; name:string; icon:string|null; is_goal:boolean }[];
  const targets = (targetsR.data ?? []) as { category_id:string; target_amount:number; currency:string|null; cadence:string; target_date:string|null }[];
  const assignedRows = (assignedR.data ?? []) as { category_id:string; assigned:number; currency:string|null }[];
  // Envelope-model "budget" per category = its target amount.
  const budgets = targets.map(t => ({ category_id: t.category_id, amount: toArs(t.target_amount, t.currency) }));
  // Savings goals = is_goal categories with a target; progress = Σ assigned to date.
  const goals = (categories.filter(c => c.is_goal).map(c => {
    const t = targets.find(tt => tt.category_id === c.id);
    if (!t) return null;
    const current = assignedRows.filter(a => a.category_id === c.id).reduce((s, a) => s + toArs(a.assigned, a.currency), 0);
    return { id: c.id, name: c.name, icon: c.icon, target_amount: toArs(t.target_amount, t.currency), current_amount: current, deadline: t.target_date, target_currency: 'ARS' };
  }).filter(Boolean)) as { id:string; name:string; icon:string|null; target_amount:number; current_amount:number; deadline:string|null; target_currency:string }[];

  // ── 2. Claude Sonnet — parse NL text ─────────────────────────────────────
  const parseResp = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Parseá el texto en español de un usuario argentino que describe una compra. Respondé SOLO con JSON: {"item":string, "amount":number (siempre positivo), "currency":"ARS"|"USD", "installments":number|null, "category_guess":string}. El campo currency indica si el monto mencionado es en ARS (pesos, $) o USD (dólares, US$). Si dice "cuotas" o "en X cuotas" o "en cuotas", ponelo en installments. category_guess: categoría del gasto en español (ej: Tecnología, Ropa, Alimentos, Viajes, etc).',
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: `Texto: "${text}"` },
        ],
      }],
    }),
  });

  interface ParsedPurchase { item: string; amount: number; currency: 'ARS'|'USD'; installments: number|null; category_guess: string; }
  let parsed: ParsedPurchase = { item: text, amount: 0, currency: 'ARS', installments: null, category_guess: '' };
  if (parseResp.ok) {
    const pd = await parseResp.json();
    const raw = (pd.content?.[0]?.text ?? '{}').replace(/^```[\w]*\n?/,'').replace(/\n?```$/,'').trim();
    try { parsed = { ...parsed, ...JSON.parse(raw) }; } catch { /* keep default */ }
  }

  // ── 3. Normalise amount to ARS ────────────────────────────────────────────
  const amount_ars = parsed.currency === 'USD'
    ? Math.round(parsed.amount * fxRate)
    : Math.round(parsed.amount);
  const installments = parsed.installments && parsed.installments > 1 ? parsed.installments : null;
  const monthly_cost = installments ? Math.round(amount_ars / installments) : amount_ars;

  // ── 4. Projection ─────────────────────────────────────────────────────────
  const proj = computeProjection(txs, rules, today);
  const new_projected_balance = proj.projectedBalance - monthly_cost;

  // No income this month → a rate would be meaningless (e.g. -15000000%);
  // send null and let the client render "—".
  const totalIncome = proj.totalIncome;
  const savings_rate_current = totalIncome > 0 ? proj.projectedBalance / totalIncome : null;
  const savings_rate_new = totalIncome > 0 ? new_projected_balance / totalIncome : null;

  // ── 5. Goal delays ────────────────────────────────────────────────────────
  const monthly_net = proj.projectedBalance;

  const goal_delays = goals
    .filter(g => g.deadline)
    .map(g => {
      const remaining_ars = g.target_currency === 'USD'
        ? Math.round((g.target_amount - g.current_amount) * fxRate)
        : g.target_amount - g.current_amount;
      if (remaining_ars <= 0) return null;

      const deadline = new Date(g.deadline!);
      const months_to_deadline = Math.max(1, monthsBetween(today, deadline));

      const months_current = monthly_net > 0 ? remaining_ars / monthly_net : Infinity;
      const months_new = (monthly_net - monthly_cost) > 0 ? remaining_ars / (monthly_net - monthly_cost) : Infinity;

      const slip_months = isFinite(months_new) && isFinite(months_current)
        ? Math.max(0, Math.round(months_new - months_current))
        : monthly_cost > 0 ? Math.round(monthly_cost / Math.max(1, monthly_net) * months_to_deadline) : 0;

      const is_past_deadline = slip_months > 0;

      return { name: g.name, icon: g.icon ?? '🎯', slip_months, is_past_deadline };
    })
    .filter(Boolean) as { name:string; icon:string; slip_months:number; is_past_deadline:boolean }[];

  // ── 6. Budget overflows ───────────────────────────────────────────────────
  const budget_overflows: { category:string; budget:number; current_spend:number; after_purchase:number }[] = [];

  const normGuess = normalize(parsed.category_guess ?? '');
  const matchedCat = normGuess
    ? categories.find(c => normalize(c.name).includes(normGuess) || normGuess.includes(normalize(c.name)))
    : null;

  if (matchedCat) {
    const budget = budgets.find(b => b.category_id === matchedCat.id);
    if (budget) {
      const current_spend = txs
        .filter(t => t.type==='expense' && t.category_id===matchedCat.id)
        .reduce((s,t) => s+t.amount, 0);
      const after_purchase = current_spend + monthly_cost;
      if (after_purchase > budget.amount) {
        budget_overflows.push({ category: matchedCat.name, budget: budget.amount, current_spend, after_purchase });
      }
    }
  }

  // ── 7. Response ───────────────────────────────────────────────────────────
  const is_negative_impact =
    new_projected_balance < 0 ||
    goal_delays.some(g => g.slip_months > 0) ||
    budget_overflows.length > 0;

  return new Response(JSON.stringify({
    parsed: { item: parsed.item, amount_ars, currency_input: parsed.currency, installments },
    projection: { current: proj.projectedBalance, new: new_projected_balance },
    monthly_cost,
    savings_rate: { current: savings_rate_current, new: savings_rate_new },
    goal_delays,
    budget_overflows,
    fx_rate: fxRate,
    is_negative_impact,
  }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
});
