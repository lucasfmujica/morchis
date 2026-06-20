-- Envelope budgeting (YNAB-style), INDIVIDUAL per person.
-- Each person assigns their own money to their own category "envelopes" per
-- month; "available" carries over month to month and is COMPUTED in the app
-- (never stored, to avoid drift). This migration only adds the assignment
-- table, the on/off-budget + credit-card-payment plumbing, and a gross
-- activity view. Per-person net-share math (splits/debts) lives in the app.

-- 1. budget_months — one row per (person, category, month), holding only the
--    assigned amount. Activity & available are derived. `assigned` may be
--    negative (you can pull money back out of a category into "Para asignar").
create table if not exists public.budget_months (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),   -- 'YYYY-MM'
  assigned numeric(14,2) not null default 0,
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, category_id, month)
);

create index if not exists budget_months_profile_month
  on public.budget_months (profile_id, month);
create index if not exists budget_months_household
  on public.budget_months (household_id);

alter table public.budget_months enable row level security;

-- Household-scoped access (same convention as budgets_all). "Only edit mine" is
-- a UI concern; both partners trust each other within the household.
drop policy if exists budget_months_all on public.budget_months;
create policy budget_months_all on public.budget_months
  for all
  using (household_id = public.my_household_id())
  with check (household_id = public.my_household_id());

-- 2. on_budget flag. cash/checking/credit are part of the budget; savings are
--    tracking accounts (their balance doesn't feed "Para asignar").
alter table public.accounts add column if not exists on_budget boolean not null default true;
update public.accounts set on_budget = false where type = 'savings';

-- 3. Credit cards on-budget (full YNAB model): each card gets a "Pago <card>"
--    category that lives in the card owner's budget; card spending moves money
--    into that envelope (computed in the app). Link via payment_category_id.
alter table public.accounts
  add column if not exists payment_category_id uuid references public.categories(id) on delete set null;

with new_cats as (
  insert into public.categories (household_id, name, icon, kind, is_default)
  select a.household_id, 'Pago ' || a.name, '💳', 'expense', false
  from public.accounts a
  where a.type = 'credit' and a.payment_category_id is null
  returning id, household_id, name
)
update public.accounts a
set payment_category_id = nc.id
from new_cats nc
where nc.household_id = a.household_id
  and nc.name = 'Pago ' || a.name
  and a.type = 'credit'
  and a.payment_category_id is null;

-- 4. Gross expense activity per category per month, in ARS (USD priced at the
--    transaction's snapshot rate — stable, no re-pricing of history). Used for
--    aggregate/analysis displays; the per-person net-share carryover is built
--    in the app from transaction rows + splits. security_invoker so the
--    underlying transactions RLS applies to the caller.
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
    group by household_id, category_id, to_char(occurred_on, 'YYYY-MM');

-- 5. Backfill the current month's assignments from existing active monthly
--    per-category budgets (all are personal-scoped today, so each maps cleanly
--    to its owner's envelope). Weekly budgets and total (null-category) limits
--    are intentionally not carried over — they don't exist in envelope mode.
insert into public.budget_months (household_id, profile_id, category_id, month, assigned, currency)
select b.household_id, b.profile_id, b.category_id, to_char(current_date, 'YYYY-MM'), b.amount, b.currency
from public.budgets b
where b.active and b.period = 'monthly' and b.category_id is not null and b.profile_id is not null
on conflict (profile_id, category_id, month) do nothing;
