-- Advance recurring_rules.next_run past any due dates that have already passed,
-- so rules keep feeding the month-end projection and the "upcoming bills" list
-- instead of getting stuck in the past once their date elapses. Rules due
-- exactly today are left alone (they should still show/count today).
-- NOTE: superseded by process_recurring_rules() (materializes + advances); kept
-- for history. The daily cron is repointed in the later migration.
create or replace function public.advance_recurring_rules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  nr date;
  cnt int := 0;
  guard int;
begin
  for r in
    select id, cadence, anchor_day, next_run
    from recurring_rules
    where active and next_run is not null and next_run < current_date
  loop
    nr := r.next_run;
    guard := 0;
    while nr < current_date and guard < 600 loop
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
    cnt := cnt + 1;
  end loop;
  return cnt;
end;
$$;

do $$
begin
  perform cron.unschedule('advance-recurring-rules-daily');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'advance-recurring-rules-daily',
  '0 6 * * *',
  $$ select public.advance_recurring_rules(); $$
);
