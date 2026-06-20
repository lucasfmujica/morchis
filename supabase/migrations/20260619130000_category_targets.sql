-- YNAB-style targets ("metas"): how much a person wants AVAILABLE in a category
-- each month. Drives the funded/underfunded colour and the "assign what's
-- needed" actions. One persistent target per (person, category); v1 is monthly.
create table if not exists public.category_targets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  target_amount numeric(14,2) not null default 0,
  cadence text not null default 'monthly' check (cadence in ('monthly')),
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, category_id)
);

create index if not exists category_targets_profile on public.category_targets (profile_id);
create index if not exists category_targets_category on public.category_targets (category_id);
create index if not exists category_targets_household on public.category_targets (household_id);

alter table public.category_targets enable row level security;

drop policy if exists category_targets_all on public.category_targets;
create policy category_targets_all on public.category_targets
  for all
  using (household_id = public.my_household_id())
  with check (household_id = public.my_household_id());
