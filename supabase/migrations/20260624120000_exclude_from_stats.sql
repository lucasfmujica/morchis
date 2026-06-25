-- "Transferencia/FX" flag: a movement that still moves real money (so it keeps
-- its expense/income sign and hits account balances) but must NOT count as
-- spend/income in any analytics. Use it for currency conversions, card
-- payments, money sent to family, loans received and reimbursements — the
-- stuff that otherwise pollutes "Otros gastos/ingresos" and skews the análisis.
alter table public.transactions
  add column if not exists exclude_from_stats boolean not null default false;

-- The envelope activity view sums per-category expense. Excluded movements must
-- drop out of it too, so an FX/transfer filed in a category never eats its
-- envelope.
create or replace view public.category_activity_by_month
  with (security_invoker = true)
  as
    select
      household_id,
      category_id,
      to_char(occurred_on, 'YYYY-MM') as month,
      sum(case when currency = 'USD' and usd_rate_snapshot is not null
               then round(amount * usd_rate_snapshot, 2)
               else amount end) as ars
    from public.transactions
    where type = 'expense'
      and exclude_from_stats = false
    group by household_id, category_id, to_char(occurred_on, 'YYYY-MM');
