-- These run only from the daily cron job / as triggers — never from a client.
-- Revoke the default public/anon/authenticated EXECUTE so they aren't callable
-- via the REST RPC endpoint (otherwise a user could spam transactions or
-- recompute goal totals). The cron job runs as the table owner, so it still works.
revoke execute on function public.process_recurring_rules() from public, anon, authenticated;
revoke execute on function public.advance_recurring_rules() from public, anon, authenticated;
revoke execute on function public.apply_goal_contribution() from public, anon, authenticated;
