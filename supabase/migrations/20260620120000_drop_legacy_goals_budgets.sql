-- Drop the legacy goals/budgets model now that every consumer reads the
-- envelope model (budget_months / category_targets / is_goal categories).
alter table public.recurring_rules drop column if exists goal_id;
drop table if exists public.goal_contributions;
drop table if exists public.budget_alerts;
drop table if exists public.budgets;
drop table if exists public.goals;
