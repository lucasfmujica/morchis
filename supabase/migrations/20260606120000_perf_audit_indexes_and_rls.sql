-- Performance audit fixes.
--   1. Add indexes for the hot query paths and every foreign key the linter
--      flagged as unindexed (sequential scans today, but they degrade linearly
--      as transactions/splits/goal_contributions grow).
--   2. Drop an index that has never been used.
--   3. Make RLS policies evaluate auth.uid()/my_household_id() once per query
--      (wrapped in a scalar sub-select) instead of once per row.

-- 1. Indexes -----------------------------------------------------------------

-- transactions: filtered by household and ordered by date on every list/analysis
-- screen; by type for budget/expense rollups; the composite (household_id, ...)
-- indexes also serve plain household_id lookups via their leftmost prefix.
create index if not exists transactions_household_occurred_idx
  on public.transactions (household_id, occurred_on desc);
create index if not exists transactions_household_type_occurred_idx
  on public.transactions (household_id, type, occurred_on);
create index if not exists transactions_account_id_idx
  on public.transactions (account_id);
create index if not exists transactions_transfer_account_id_idx
  on public.transactions (transfer_account_id);
create index if not exists transactions_category_id_idx
  on public.transactions (category_id);
create index if not exists transactions_profile_id_idx
  on public.transactions (profile_id);

-- splits: joined by transaction, and by payer/ower for the couple balance.
create index if not exists splits_transaction_id_idx
  on public.splits (transaction_id);
create index if not exists splits_payer_profile_id_idx
  on public.splits (payer_profile_id);
create index if not exists splits_ower_profile_id_idx
  on public.splits (ower_profile_id);

-- Remaining unindexed foreign keys.
create index if not exists accounts_household_id_idx on public.accounts (household_id);
create index if not exists accounts_owner_profile_id_idx on public.accounts (owner_profile_id);
create index if not exists budgets_household_id_idx on public.budgets (household_id);
create index if not exists budgets_category_id_idx on public.budgets (category_id);
create index if not exists budgets_profile_id_idx on public.budgets (profile_id);
create index if not exists categories_household_id_idx on public.categories (household_id);
create index if not exists categories_parent_id_idx on public.categories (parent_id);
create index if not exists debts_household_id_idx on public.debts (household_id);
create index if not exists debts_profile_id_idx on public.debts (profile_id);
create index if not exists draft_transactions_statement_id_idx on public.draft_transactions (statement_id);
create index if not exists goal_contributions_goal_id_idx on public.goal_contributions (goal_id);
create index if not exists goal_contributions_profile_id_idx on public.goal_contributions (profile_id);
create index if not exists goals_household_id_idx on public.goals (household_id);
create index if not exists goals_profile_id_idx on public.goals (profile_id);
create index if not exists household_invites_accepted_by_idx on public.household_invites (accepted_by);
create index if not exists household_invites_created_by_idx on public.household_invites (created_by);
create index if not exists household_invites_household_id_idx on public.household_invites (household_id);
create index if not exists merchant_aliases_category_id_idx on public.merchant_aliases (category_id);
create index if not exists profiles_household_id_idx on public.profiles (household_id);
create index if not exists recurring_rules_account_id_idx on public.recurring_rules (account_id);
create index if not exists recurring_rules_category_id_idx on public.recurring_rules (category_id);
create index if not exists recurring_rules_household_id_idx on public.recurring_rules (household_id);
create index if not exists recurring_rules_profile_id_idx on public.recurring_rules (profile_id);
create index if not exists settlements_from_profile_idx on public.settlements (from_profile);
create index if not exists settlements_to_profile_idx on public.settlements (to_profile);
create index if not exists settlements_household_id_idx on public.settlements (household_id);
create index if not exists statements_account_id_idx on public.statements (account_id);
create index if not exists statements_household_id_idx on public.statements (household_id);
create index if not exists statements_profile_id_idx on public.statements (profile_id);
create index if not exists transaction_items_household_id_idx on public.transaction_items (household_id);

-- 2. Drop the unused index (flagged by the linter, never scanned). ----------
drop index if exists public.transactions_installment_group_idx;

-- 3. RLS: evaluate auth helpers once per statement, not once per row. --------
alter policy profiles_select on public.profiles
  using ((household_id = (select my_household_id())) or (id = (select auth.uid())));
alter policy profiles_update_own on public.profiles
  using ((id = (select auth.uid())));
alter policy profiles_insert_own on public.profiles
  with check ((id = (select auth.uid())));

alter policy invites_select on public.household_invites
  using ((created_by = (select auth.uid())) or (household_id = (select my_household_id())));
alter policy invites_insert on public.household_invites
  with check ((created_by = (select auth.uid())) and (household_id = (select my_household_id())));

alter policy "own subs all" on public.push_subscriptions
  using ((profile_id = (select auth.uid())));
