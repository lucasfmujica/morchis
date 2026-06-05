-- Which account a recurring rule credits (income) or debits (expense). Nullable
-- so existing rules keep working; the materialized transaction inherits it.
alter table public.recurring_rules
  add column if not exists account_id uuid references public.accounts(id);

-- Recreate the materializer so the posted transaction carries the rule's account.
create or replace function public.process_recurring_rules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  nr date;
  guard int;
  created int := 0;
begin
  for r in
    select * from recurring_rules
    where active and next_run is not null and next_run <= current_date
  loop
    nr := r.next_run;
    guard := 0;
    while nr <= current_date and guard < 600 loop
      if not coalesce(r.is_variable, false) then
        insert into transactions (
          household_id, profile_id, type, amount, currency,
          category_id, account_id, occurred_on, scope, is_shared, source
        ) values (
          r.household_id, r.profile_id, r.direction, r.amount, r.currency,
          r.category_id, r.account_id, nr, r.scope, false, 'recurring'
        );
        created := created + 1;
      end if;
      if r.cadence = 'weekly' then
        nr := nr + 7;
      elsif r.cadence = 'biweekly' then
        nr := nr + 14;
      else
        nr := (nr + interval '1 month')::date;
      end if;
      guard := guard + 1;
    end loop;
    update recurring_rules set next_run = nr where id = r.id;
  end loop;
  return created;
end;
$$;

revoke execute on function public.process_recurring_rules() from public, anon, authenticated;
