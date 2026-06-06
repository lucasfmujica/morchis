-- Per-audience insights: profile_id null = household-wide ("Nuestro"),
-- otherwise the insight belongs to that person ("Mío"). Lets Análisis show
-- different insights per Mío/Nuestro tab.
ALTER TABLE public.insights
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Link an external-friend debt to the expense it offsets, so analytics can net
-- what a friend repays out of that transaction's real cost (e.g. a $59k dinner
-- where a friend pays back $27k counts as $32k of real spend).
ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;
