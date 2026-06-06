-- Keep goals.current_amount in sync with goal_contributions atomically, so two
-- partners contributing at the same time can't clobber each other's update
-- (the previous client-side "read current_amount, add, write back" had a race).
create or replace function public.apply_goal_contribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update goals set current_amount = current_amount + new.amount where id = new.goal_id;
  elsif tg_op = 'DELETE' then
    update goals set current_amount = greatest(0, current_amount - old.amount) where id = old.goal_id;
    return old;
  elsif tg_op = 'UPDATE' then
    update goals set current_amount = greatest(0, current_amount - old.amount + new.amount) where id = new.goal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_goal_contribution on public.goal_contributions;
create trigger trg_apply_goal_contribution
  after insert or update or delete on public.goal_contributions
  for each row execute function public.apply_goal_contribution();
