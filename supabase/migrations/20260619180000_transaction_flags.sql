-- Ronda 5: YNAB-style colour flags on transactions.
alter table public.transactions add column if not exists flag text
  check (flag in ('red', 'orange', 'yellow', 'green', 'blue', 'purple'));
