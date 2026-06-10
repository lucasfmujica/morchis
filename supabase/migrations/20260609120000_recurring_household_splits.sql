-- Recurring HOUSEHOLD expenses now enter the couple-split model: the posted
-- transaction is is_shared and a 50/50 split (in ARS) is created, so a
-- recurring rent paid by one person no longer lands 100% on their personal
-- budget with nothing owed by the partner. Also:
--  - monthly advancement re-anchors to anchor_day each month (the old
--    `+ interval '1 month'` clamped Jan 31 -> Feb 28 and then stayed on the
--    28th forever),
--  - the rule's label is carried into merchant so budget drill-downs can tell
--    "Netflix" from "Spotify",
--  - the latest blue rate is snapshotted on the row (manual saves do this).

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
  partner uuid;
  blue numeric;
  tx_id uuid;
  ars_amount numeric;
  next_month date;
  target_day int;
begin
  select ars_per_usd into blue
  from fx_rates
  where source = 'blue'
  order by date desc
  limit 1;

  for r in
    select * from recurring_rules
    where active and next_run is not null and next_run <= current_date
  loop
    -- The other member of the household, if any. Needed to split household
    -- expenses; null means there's nobody to owe the other half.
    select id into partner
    from profiles
    where household_id = r.household_id and id <> r.profile_id
    limit 1;

    nr := r.next_run;
    guard := 0;
    while nr <= current_date and guard < 600 loop
      if not coalesce(r.is_variable, false) then
        insert into transactions (
          household_id, profile_id, type, amount, currency,
          category_id, account_id, occurred_on, scope, is_shared, source,
          merchant, usd_rate_snapshot
        ) values (
          r.household_id, r.profile_id, r.direction, r.amount, r.currency,
          r.category_id, r.account_id, nr, r.scope,
          (r.scope = 'household' and r.direction = 'expense' and partner is not null),
          'recurring', r.label, blue
        )
        returning id into tx_id;

        -- 50/50 split for a shared household expense: the partner owes half to
        -- whoever the rule belongs to (their account takes the hit). Splits
        -- are stored in ARS; skip the split rather than store USD units when
        -- no rate is known.
        if r.scope = 'household' and r.direction = 'expense' and partner is not null
           and (r.currency <> 'USD' or blue is not null) then
          ars_amount := case when r.currency = 'USD' then round(r.amount * blue, 2) else r.amount end;
          if round(ars_amount / 2, 2) > 0 then
            insert into splits (transaction_id, payer_profile_id, ower_profile_id, amount)
            values (tx_id, r.profile_id, partner, round(ars_amount / 2, 2));
          end if;
        end if;

        created := created + 1;
      end if;

      if r.cadence = 'weekly' then
        nr := nr + 7;
      elsif r.cadence = 'biweekly' then
        nr := nr + 14;
      else
        -- Same anchor day next month, clamped to that month's length, so a
        -- day-31 rule fires Jan 31 -> Feb 28 -> Mar 31 instead of drifting to
        -- the 28th forever.
        next_month := (date_trunc('month', nr) + interval '1 month')::date;
        target_day := least(
          coalesce(r.anchor_day, extract(day from nr)::int),
          extract(day from (next_month + interval '1 month' - interval '1 day'))::int
        );
        nr := next_month + (target_day - 1);
      end if;
      guard := guard + 1;
    end loop;

    update recurring_rules set next_run = nr where id = r.id;
  end loop;
  return created;
end;
$$;

revoke execute on function public.process_recurring_rules() from public, anon, authenticated;
