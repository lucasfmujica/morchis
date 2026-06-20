-- Covering indexes for the new foreign keys added in 20260619120000, so the
-- FK checks (and category drill-downs) have an index to use.
create index if not exists budget_months_category
  on public.budget_months (category_id);

create index if not exists accounts_payment_category
  on public.accounts (payment_category_id);
