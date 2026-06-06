-- household_invites: the only writers are SECURITY DEFINER RPCs
-- (generate_invite_code / join_household), which bypass RLS. So the permissive
-- direct-access policies aren't needed and are a hole:
--   * invites_update USING(true) let any authenticated user modify any invite.
--   * invites_select USING(true) let anyone enumerate every invite code and
--     thereby join any household.
drop policy if exists invites_update on public.household_invites;

drop policy if exists invites_select on public.household_invites;
create policy invites_select on public.household_invites
  for select
  using (created_by = auth.uid() or household_id = public.my_household_id());

-- budget_alerts had RLS enabled but no policy (only the service-role edge
-- function touches it). Add a read policy scoped to the household; writes stay
-- service-role only.
drop policy if exists budget_alerts_select on public.budget_alerts;
create policy budget_alerts_select on public.budget_alerts
  for select
  using (
    exists (
      select 1 from public.budgets b
      where b.id = budget_alerts.budget_id
        and b.household_id = public.my_household_id()
    )
  );
