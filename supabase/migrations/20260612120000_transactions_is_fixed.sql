-- Fixed-expense flag: rent, psychologist, etc. Excluded from the weekly total
-- spending limit (it measures discretionary spend), but still counted in
-- category budgets and monthly totals.
alter table transactions
  add column if not exists is_fixed boolean not null default false;

comment on column transactions.is_fixed is
  'Gasto fijo (alquiler, psicologa, etc.). Se excluye del limite semanal total; sigue contando en presupuestos por categoria y totales mensuales.';
