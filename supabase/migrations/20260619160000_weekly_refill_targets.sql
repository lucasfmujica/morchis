-- Ronda 4: weekly target cadence + "refill up to X" vs "set aside X more".
alter table public.category_targets drop constraint if exists category_targets_cadence_check;
alter table public.category_targets add constraint category_targets_cadence_check
  check (cadence in ('monthly', 'by_date', 'weekly'));

alter table public.category_targets add column if not exists target_type text
  check (target_type in ('refill', 'set_aside')) default 'refill';
