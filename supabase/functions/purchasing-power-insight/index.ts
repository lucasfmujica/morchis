import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Resolve household from JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('household_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return new Response('Profile not found', { status: 404 });

  const householdId = profile.household_id;

  // Latest inflation rate + latest blue FX (for USD→ARS conversion)
  const [{ data: inflRow }, { data: fxRow }] = await Promise.all([
    supabase.from('inflation_rates').select('monthly_pct, date').order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('fx_rates').select('ars_per_usd').eq('source', 'blue').order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (!inflRow) {
    return new Response(JSON.stringify({ ok: false, reason: 'no inflation data' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const inflationPct = Number(inflRow.monthly_pct);
  const inflDate = inflRow.date.slice(0, 7); // YYYY-MM
  const fxRate = Number(fxRow?.ars_per_usd ?? 1200);
  const toArs = (amount: number, currency: string | null, snap: number | null): number =>
    currency === 'USD' ? Math.round(amount * (Number(snap) || fxRate)) : amount;

  // Income for current month and previous month (columns are amount/occurred_on;
  // the old code queried non-existent amount_ars/date and silently no-op'd).
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

  const incomeSel = 'amount, currency, usd_rate_snapshot';
  const [{ data: thisIncome }, { data: prevIncome }] = await Promise.all([
    supabase.from('transactions').select(incomeSel).eq('household_id', householdId).eq('type', 'income').gte('occurred_on', thisMonthStart),
    supabase.from('transactions').select(incomeSel).eq('household_id', householdId).eq('type', 'income').gte('occurred_on', prevMonthStart).lte('occurred_on', prevMonthEnd),
  ]);

  type IncomeRow = { amount: number; currency: string | null; usd_rate_snapshot: number | null };
  const sumArs = (rows: IncomeRow[] | null) => (rows ?? []).reduce((s, r) => s + toArs(r.amount, r.currency, r.usd_rate_snapshot), 0);
  const thisTotal = sumArs(thisIncome as IncomeRow[] | null);
  const prevTotal = sumArs(prevIncome as IncomeRow[] | null);

  if (prevTotal === 0) {
    return new Response(JSON.stringify({ ok: false, reason: 'no prev month income' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const incomePct = Math.round(((thisTotal - prevTotal) / prevTotal) * 10000) / 100;
  const diff = Math.round((incomePct - inflationPct) * 100) / 100;
  const gained = incomePct >= inflationPct;

  const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const mIdx = now.getMonth(); // current month label
  // Keep this period label distinct from generate-insights' "YYYY-MM" so its
  // period-scoped delete never wipes this purchasing-power card.
  const period = monthNames[mIdx] + ' ' + now.getFullYear();

  const title = gained
    ? `Ganaste poder adquisitivo en ${period}`
    : `Perdiste poder adquisitivo en ${period}`;

  const body = `Tus ingresos ${incomePct >= 0 ? 'subieron' : 'bajaron'} ${Math.abs(incomePct)}% este mes. La inflación fue ${inflationPct}% (${inflDate}). ${gained ? 'Ganaste' : 'Perdiste'} ${Math.abs(diff)}% de poder adquisitivo.`;

  const severity = gained ? 'positive' : 'warning';

  // Replace any prior purchasing-power insight for this period. The
  // (household_id, kind, period) unique constraint was removed (it broke
  // generate-insights), so de-duplicate manually with delete + insert.
  await supabase.from('insights')
    .delete()
    .eq('household_id', householdId)
    .eq('kind', 'purchasing_power')
    .eq('period', period);
  await supabase.from('insights').insert({
    household_id: householdId,
    title,
    body,
    severity,
    kind: 'purchasing_power',
    period,
    seen: false,
  });

  return new Response(JSON.stringify({ ok: true, incomePct, inflationPct, diff, gained, thisTotal, prevTotal }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
