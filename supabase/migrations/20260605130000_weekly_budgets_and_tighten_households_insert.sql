-- Allow weekly budgets (Mon–Sun window), in addition to monthly.
alter table public.budgets drop constraint budgets_period_check;
alter table public.budgets
  add constraint budgets_period_check check (period = any (array['monthly'::text, 'weekly'::text]));

-- households are created via the create_household() SECURITY DEFINER RPC, which
-- bypasses RLS, so the permissive direct-insert policy (WITH CHECK true) is
-- unnecessary and only lets a client spam household rows. Drop it.
drop policy if exists households_insert on public.households;
