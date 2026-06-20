-- Ronda 2:
--  - Savings goals become categories with a "by date" target (save $X by a date).
--  - Saved "focused views" for the budget table (a named subset of categories).

-- category_targets: allow a by-date target (target_amount accumulated by target_date).
alter table public.category_targets add column if not exists target_date date;
alter table public.category_targets drop constraint if exists category_targets_cadence_check;
alter table public.category_targets add constraint category_targets_cadence_check
  check (cadence in ('monthly', 'by_date'));

-- Flag a category as a savings goal (gets the ring/goal treatment).
alter table public.categories add column if not exists is_goal boolean not null default false;

-- Saved budget views (focused views): a named set of categories to filter the table.
create table if not exists public.budget_views (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  category_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists budget_views_profile on public.budget_views (profile_id);
create index if not exists budget_views_household on public.budget_views (household_id);

alter table public.budget_views enable row level security;
drop policy if exists budget_views_all on public.budget_views;
create policy budget_views_all on public.budget_views
  for all
  using (household_id = public.my_household_id())
  with check (household_id = public.my_household_id());
