-- The UNIQUE (household_id, kind, period) constraint broke generate-insights:
-- it batch-inserts 2-4 cards per period that frequently share the same `kind`
-- (e.g. two "spending"), so the atomic insert hit 23505 duplicate-key and the
-- whole batch was rejected -> no insights ever appeared. The design intends
-- multiple insight rows per (household, period), so this invariant was wrong.
-- purchasing-power-insight, the only writer that relied on it (upsert
-- onConflict), now de-duplicates with delete+insert instead.
ALTER TABLE public.insights
  DROP CONSTRAINT IF EXISTS insights_household_kind_period_unique;
