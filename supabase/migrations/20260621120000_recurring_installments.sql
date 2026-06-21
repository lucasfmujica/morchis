-- Finite recurring rules ("cuotas") + a latent-bug fix.
--
-- 1. New columns on recurring_rules:
--    - installments_total: original number of occurrences (for "cuota N de M");
--    - remaining_count: how many are left; the cron decrements it and pauses the
--      rule when it reaches 0. NULL on both = the rule runs forever (old behavior).
--
-- 2. Recreate process_recurring_rules(). The live function still referenced
--    r.goal_id and goal_contributions, both dropped in
--    20260620120000_drop_legacy_goals_budgets.sql — so the nightly cron has been
--    erroring. This version removes the goal branch and adds the installment
--    logic: when a finite rule pays off its last cuota it sets active = false and
--    clears the budget target it had reserved on that category.

alter table public.recurring_rules
  add column if not exists installments_total integer;
alter table public.recurring_rules
  add column if not exists remaining_count integer;

comment on column public.recurring_rules.installments_total is
  'Total occurrences for a finite rule (cuotas); NULL = runs forever.';
comment on column public.recurring_rules.remaining_count is
  'Occurrences left before the rule auto-pauses; decremented by the cron each run.';

create or replace function public.process_recurring_rules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  nr date;
  rem int;
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
    if partner is not null and r.scope = 'household' and r.direction = 'expense' then
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
    rem := r.remaining_count;
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

      -- Cuotas: count this occurrence; stop once the finite rule is paid off.
      if rem is not null then
        rem := rem - 1;
        if rem <= 0 then
          exit;
        end if;
      end if;
    end loop;

    if rem is not null and rem <= 0 then
      -- Finite rule finished its last cuota: pause it and clear the budget
      -- target it had reserved on that category (the bill no longer exists).
      update recurring_rules set next_run = nr, active = false, remaining_count = 0 where id = r.id;
      if r.category_id is not null then
        delete from category_targets
        where profile_id = r.profile_id and category_id = r.category_id;
      end if;
    else
      update recurring_rules set next_run = nr, remaining_count = rem where id = r.id;
    end if;
  end loop;
  return created;
end;
$$;

revoke execute on function public.process_recurring_rules() from public, anon, authenticated;
