import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// ── inline projection (mirrors src/lib/projection.ts) ───────────────────────
// All amounts handed in here are already normalised to ARS (see toArs below).
interface PTx { type: string; amount: number; occurred_on: string; }
interface PRule { direction: string; amount: number; next_run: string | null; active: boolean; }
function computeProjection(txs: PTx[], rules: PRule[], today: Date) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayOfMonth = today.getDate();
  const daysElapsed = Math.max(1, dayOfMonth);
  const daysRemaining = daysInMonth - dayOfMonth;
  const ms = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const me = `${year}-${String(month+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;
  const todayStr = today.toISOString().split('T')[0];
  const thisMonth = txs.filter(t => t.occurred_on >= ms && t.occurred_on <= me);
  const incomeSoFar = thisMonth.filter(t => t.type==='income').reduce((s,t) => s+t.amount, 0);
  const expensesSoFar = thisMonth.filter(t => t.type==='expense').reduce((s,t) => s+t.amount, 0);
  const currentBalance = incomeSoFar - expensesSoFar;
  const remainingIncome = rules.filter(r => r.active && r.direction==='income' && r.next_run && r.next_run > todayStr && r.next_run <= me).reduce((s,r) => s+r.amount, 0);
  const remainingFixed = rules.filter(r => r.active && r.direction==='expense' && r.next_run && r.next_run > todayStr && r.next_run <= me).reduce((s,r) => s+r.amount, 0);
  const dailyRate = expensesSoFar / daysElapsed;
  const projectedVariableSpend = Math.round(dailyRate * daysRemaining);
  const projectedBalance = currentBalance + remainingIncome - remainingFixed - projectedVariableSpend;
  const totalIncome = incomeSoFar + remainingIncome;
  return { projectedBalance, totalIncome, expensesSoFar };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
}

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
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const ms = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const me = `${year}-${String(month+1).padStart(2,'0')}-${String(new Date(year,month+1,0).getDate()).padStart(2,'0')}`;

  const [txR, rulesR, goalsR, budgetsR, catsR, fxR] = await Promise.all([
    admin.from('transactions').select('type,amount,occurred_on,category_id,currency,usd_rate_snapshot').eq('household_id',hid).gte('occurred_on',ms).lte('occurred_on',me),
    admin.from('recurring_rules').select('direction,amount,next_run,active,currency').eq('household_id',hid).eq('active',true),
    admin.from('goals').select('id,name,icon,target_amount,current_amount,deadline,target_currency').eq('household_id',hid).eq('archived',false),
    admin.from('budgets').select('category_id,amount,currency').eq('household_id',hid).eq('active',true),
    admin.from('categories').select('id,name').eq('household_id',hid),
    admin.from('fx_rates').select('ars_per_usd').eq('source','blue').order('date',{ascending:false}).limit(1).maybeSingle(),
  ]);

  const fxRate = Number(fxR.data?.ars_per_usd ?? 1200);
  // Normalise every amount to ARS: USD rows use their frozen snapshot if present,
  // otherwise the latest blue rate. Keeps the simulator consistent with the app.
  const toArs = (amount: number, currency: string | null, snap?: number | null): number =>
    currency === 'USD' ? Math.round(amount * (Number(snap) || fxRate)) : amount;

  const rawTx = (txR.data ?? []) as { type:string; amount:number; occurred_on:string; category_id:string|null; currency:string|null; usd_rate_snapshot:number|null }[];
  const txs = rawTx.map(t => ({ type:t.type, occurred_on:t.occurred_on, category_id:t.category_id, amount: toArs(t.amount, t.currency, t.usd_rate_snapshot) }));
  const rules = ((rulesR.data ?? []) as { direction:string; amount:number; next_run:string|null; active:boolean; currency:string|null }[])
    .map(r => ({ direction:r.direction, next_run:r.next_run, active:r.active, amount: toArs(r.amount, r.currency) }));
  const goals = (goalsR.data ?? []) as { id:string; name:string; icon:string|null; target_amount:number; current_amount:number; deadline:string|null; target_currency:string }[];
  const budgets = ((budgetsR.data ?? []) as { category_id:string; amount:number; currency:string|null }[])
    .map(b => ({ category_id:b.category_id, amount: toArs(b.amount, b.currency) }));
  const categories = (catsR.data ?? []) as { id:string; name:string }[];

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

  const totalIncome = proj.totalIncome || 1;
  const savings_rate_current = proj.projectedBalance / totalIncome;
  const savings_rate_new = new_projected_balance / totalIncome;

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
