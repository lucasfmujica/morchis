-- Ronda 4: account reconciliation (cleared transactions + reconcile-to-balance).
alter table public.transactions add column if not exists cleared boolean not null default false;
alter table public.accounts add column if not exists last_reconciled_at timestamptz;
alter table public.accounts add column if not exists reconciled_balance numeric;
create index if not exists transactions_account_cleared on public.transactions (account_id) where cleared;
