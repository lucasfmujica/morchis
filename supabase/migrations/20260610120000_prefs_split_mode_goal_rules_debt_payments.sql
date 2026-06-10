-- Schema for the feature batch: real notification prefs, income-proportional
-- couple splits, "pagate primero" goal auto-contributions, partial debt
-- payments — plus process_recurring_rules v3 wiring the new columns in.

-- 1. Server-side notification preferences. The old toggles lived only in
--    localStorage and the push senders never read them. Absent key = enabled,
--    so existing users keep getting every push until they opt out.
--    Keys: budget_alerts, insights, monthly_report, card_due, settle_reminder.
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- 2. How the couple divides household expenses by default: 50/50 ('equal') or
--    proportional to each person's income in the previous closed month
--    ('income'). Used as the default split for new household expenses and by
--    the recurring-rules materializer.
alter table public.households
  add column if not exists split_mode text not null default 'equal';
alter table public.households
  drop constraint if exists households_split_mode_check;
alter table public.households
  add constraint households_split_mode_check check (split_mode in ('equal','income'));

-- 3. A recurring rule can feed a savings goal instead of posting a transaction
--    ("pagate primero"): each run inserts a goal_contribution (the DB trigger
--    keeps goals.current_amount in sync). Goal rules never touch cash-flow
--    projections — clients filter goal_id is null for money math.
alter table public.recurring_rules
  add column if not exists goal_id uuid references public.goals(id) on delete cascade;

-- 4. Partial payments on external (friend) debts: remaining = amount - paid_amount;
--    the client marks settled once paid_amount covers the full amount.
alter table public.debts
  add column if not exists paid_amount numeric(14,2) not null default 0;

-- 5. Materializer v3:
--    - rules with goal_id insert a goal_contribution instead of a transaction;
--    - household expense splits honor households.split_mode ('income' divides
--      by each person's share of the previous closed month's income);
--    - keeps v2 behavior: 50/50 fallback, anchor-day re-anchoring, label →
--      merchant, blue-rate snapshot.
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
  mode text;
  payer_income numeric;
  partner_income numeric;
  ower_frac numeric;
  prev_m0 date;
  prev_m1 date;
begin
  select ars_per_usd into blue
  from fx_rates
  where source = 'blue'
  order by date desc
  limit 1;

  prev_m1 := date_trunc('month', current_date)::date;
  prev_m0 := (date_trunc('month', current_date) - interval '1 month')::date;

  for r in
    select * from recurring_rules
    where active and next_run is not null and next_run <= current_date
  loop
    -- The other member of the household, if any.
    select id into partner
    from profiles
    where household_id = r.household_id and id <> r.profile_id
    limit 1;

    -- Ower's fraction of a shared expense. 'income' mode divides by each
    -- person's share of the previous closed month's income (in ARS); falls
    -- back to 50/50 when there's no income data yet.
    ower_frac := 0.5;
    if partner is not null and r.scope = 'household' and r.direction = 'expense' and r.goal_id is null then
      select coalesce(h.split_mode, 'equal') into mode from households h where h.id = r.household_id;
      if mode = 'income' then
        select
          coalesce(sum(case when t.profile_id = r.profile_id
            then case when t.currency = 'USD' then t.amount * coalesce(t.usd_rate_snapshot, blue, 1) else t.amount end end), 0),
          coalesce(sum(case when t.profile_id = partner
            then case when t.currency = 'USD' then t.amount * coalesce(t.usd_rate_snapshot, blue, 1) else t.amount end end), 0)
        into payer_income, partner_income
        from transactions t
        where t.household_id = r.household_id and t.type = 'income'
          and t.occurred_on >= prev_m0 and t.occurred_on < prev_m1;
        if payer_income + partner_income > 0 then
          ower_frac := partner_income / (payer_income + partner_income);
        end if;
      end if;
    end if;

    nr := r.next_run;
    guard := 0;
    while nr <= current_date and guard < 600 loop
      if r.goal_id is not null then
        -- "Pagate primero": contribute to the goal (virtual envelope, no
        -- transaction — same as a manual contribution).
        insert into goal_contributions (goal_id, profile_id, amount, occurred_on, note)
        values (r.goal_id, r.profile_id, r.amount, nr, r.label);
        created := created + 1;
      elsif not coalesce(r.is_variable, false) then
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

        -- Split for a shared household expense: the partner owes their
        -- fraction to whoever the rule belongs to. Splits are stored in ARS;
        -- skip rather than store USD units when no rate is known.
        if r.scope = 'household' and r.direction = 'expense' and partner is not null
           and (r.currency <> 'USD' or blue is not null) then
          ars_amount := case when r.currency = 'USD' then round(r.amount * blue, 2) else r.amount end;
          if round(ars_amount * ower_frac, 2) > 0 then
            insert into splits (transaction_id, payer_profile_id, ower_profile_id, amount)
            values (tx_id, r.profile_id, partner, round(ars_amount * ower_frac, 2));
          end if;
        end if;

        created := created + 1;
      end if;

      if r.cadence = 'weekly' then
        nr := nr + 7;
      elsif r.cadence = 'biweekly' then
        nr := nr + 14;
      else
        -- Same anchor day next month, clamped to that month's length.
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
