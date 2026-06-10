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

  // Compare the previous CLOSED month against the month before it. Comparing
  // the partial current month vs a full previous month produced false
  // "Perdiste poder adquisitivo" warnings most of the month — and the
  // inflation data is for closed months too. (Columns are amount/occurred_on;
  // the old code queried non-existent amount_ars/date and silently no-op'd.)
  // "now" in Argentina (UTC-3, no DST) — the server clock is UTC and would
  // roll to tomorrow / next month after 21:00 local.
  const artNow = () => new Date(Date.now() - 3 * 60 * 60 * 1000);
  const isoUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const now = artNow();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const lastMonthStart = isoUTC(y, m - 1, 1);
  const lastMonthEnd = isoUTC(y, m, 0);
  const baseMonthStart = isoUTC(y, m - 2, 1);
  const baseMonthEnd = isoUTC(y, m - 1, 0);

  const incomeSel = 'amount, currency, usd_rate_snapshot';
  const [{ data: lastIncome }, { data: baseIncome }] = await Promise.all([
    supabase.from('transactions').select(incomeSel).eq('household_id', householdId).eq('type', 'income').gte('occurred_on', lastMonthStart).lte('occurred_on', lastMonthEnd),
    supabase.from('transactions').select(incomeSel).eq('household_id', householdId).eq('type', 'income').gte('occurred_on', baseMonthStart).lte('occurred_on', baseMonthEnd),
  ]);

  type IncomeRow = { amount: number; currency: string | null; usd_rate_snapshot: number | null };
  const sumArs = (rows: IncomeRow[] | null) => (rows ?? []).reduce((s, r) => s + toArs(r.amount, r.currency, r.usd_rate_snapshot), 0);
  const lastTotal = sumArs(lastIncome as IncomeRow[] | null);
  const baseTotal = sumArs(baseIncome as IncomeRow[] | null);

  if (baseTotal === 0) {
    return new Response(JSON.stringify({ ok: false, reason: 'no base month income' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const incomePct = Math.round(((lastTotal - baseTotal) / baseTotal) * 10000) / 100;
  const diff = Math.round((incomePct - inflationPct) * 100) / 100;
  const gained = incomePct >= inflationPct;

  const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const lastMonthDate = new Date(Date.UTC(y, m - 1, 1)); // previous (closed) month label
  // Keep this period label distinct from generate-insights' "YYYY-MM" so its
  // period-scoped delete never wipes this purchasing-power card.
  const period = monthNames[lastMonthDate.getUTCMonth()] + ' ' + lastMonthDate.getUTCFullYear();

  const title = gained
    ? `Ganaste poder adquisitivo en ${period}`
    : `Perdiste poder adquisitivo en ${period}`;

  const body = `Tus ingresos ${incomePct >= 0 ? 'subieron' : 'bajaron'} ${Math.abs(incomePct)}% en ${period} vs el mes anterior. La inflación fue ${inflationPct}% (${inflDate}). ${gained ? 'Ganaste' : 'Perdiste'} ${Math.abs(diff)}% de poder adquisitivo.`;

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

  return new Response(JSON.stringify({ ok: true, incomePct, inflationPct, diff, gained, lastTotal, baseTotal }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
