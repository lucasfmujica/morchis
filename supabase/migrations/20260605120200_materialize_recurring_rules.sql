-- Materialize due recurring rules into real transactions and advance next_run.
-- Fixed rules (is_variable = false) post a transaction on each due date; variable
-- rules only have their date advanced (their amount varies, so they stay for
-- manual entry). Each occurrence is posted exactly once because next_run moves
-- past it in the same pass, so re-running the daily job never double-posts.
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
          category_id, occurred_on, scope, is_shared, source
        ) values (
          r.household_id, r.profile_id, r.direction, r.amount, r.currency,
          r.category_id, nr, r.scope, false, 'recurring'
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

-- Point the daily job at the new materializing function (replacing the
-- advance-only one). Unschedule the old job name first to avoid duplicates.
do $$
begin
  perform cron.unschedule('advance-recurring-rules-daily');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'process-recurring-rules-daily',
  '0 6 * * *',
  $$ select public.process_recurring_rules(); $$
);
