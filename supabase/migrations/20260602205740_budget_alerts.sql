-- Dedupe state for the budget-alert edge function: one row per budget per month
-- recording the highest threshold (80 / 100) already pushed.
CREATE TABLE IF NOT EXISTS public.budget_alerts (
  budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  period text NOT NULL,              -- 'YYYY-MM'
  level integer NOT NULL,            -- highest threshold notified: 80 or 100
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (budget_id, period)
);

-- Only the service role (the edge function) touches this.
ALTER TABLE public.budget_alerts ENABLE ROW LEVEL SECURITY;
