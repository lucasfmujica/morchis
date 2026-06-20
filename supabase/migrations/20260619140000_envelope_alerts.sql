-- Dedupe state for the envelope budget-alert edge function: one row per
-- (person, alert_key, month) so each alert fires once per month. alert_key is a
-- category_id (overspent envelope) or the literal 'rta' (Para asignar negative).
-- Service-role only (the edge function); rows are deleted when the condition
-- clears so it can re-alert next time.
create table if not exists public.envelope_alerts (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  alert_key text not null,
  period text not null,
  notified_at timestamptz not null default now(),
  primary key (profile_id, alert_key, period)
);

alter table public.envelope_alerts enable row level security;
