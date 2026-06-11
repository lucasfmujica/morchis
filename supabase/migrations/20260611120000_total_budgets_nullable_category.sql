-- A budget with NULL category_id is a TOTAL spending limit for its period —
-- e.g. "this week I want to spend 250.000 in total", across all categories.
alter table public.budgets alter column category_id drop not null;

-- At most one active total limit per (household, scope, owner, period), so the
-- home card never has to choose between two competing weekly limits.
create unique index if not exists budgets_one_active_total
  on public.budgets (household_id, scope, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), period)
  where category_id is null and active;
