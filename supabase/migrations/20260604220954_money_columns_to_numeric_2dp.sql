-- Decimal support: money columns go from bigint (whole units) to numeric(14,2)
-- so amounts can carry up to 2 decimals (cents). Existing integer values are
-- preserved exactly (e.g. 641539 -> 641539.00) and the `amount > 0` checks
-- stay valid. supabase-js returns numeric as a JS number, so balance math and
-- the generated TS types (already typed `number`) are unaffected.

ALTER TABLE transactions       ALTER COLUMN amount          TYPE numeric(14,2);

ALTER TABLE accounts           ALTER COLUMN initial_balance TYPE numeric(14,2);
ALTER TABLE accounts           ALTER COLUMN statement_ars   TYPE numeric(14,2);
ALTER TABLE accounts           ALTER COLUMN statement_usd   TYPE numeric(14,2);

ALTER TABLE splits             ALTER COLUMN amount          TYPE numeric(14,2);
ALTER TABLE budgets            ALTER COLUMN amount          TYPE numeric(14,2);
ALTER TABLE recurring_rules    ALTER COLUMN amount          TYPE numeric(14,2);
ALTER TABLE debts              ALTER COLUMN amount          TYPE numeric(14,2);

ALTER TABLE goals              ALTER COLUMN target_amount   TYPE numeric(14,2);
ALTER TABLE goals              ALTER COLUMN current_amount  TYPE numeric(14,2);
ALTER TABLE goal_contributions ALTER COLUMN amount          TYPE numeric(14,2);
ALTER TABLE settlements        ALTER COLUMN amount          TYPE numeric(14,2);
ALTER TABLE transaction_items  ALTER COLUMN line_total      TYPE numeric(14,2);
