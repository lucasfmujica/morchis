-- Ronda 7: YNAB-style master category groups.
alter table public.categories add column if not exists is_group boolean not null default false;

-- Seed the 4 master groups per household (idempotent).
insert into public.categories (household_id, name, icon, kind, is_group, is_default)
select h.id, g.name, g.icon, 'expense', true, false
from public.households h
cross join (values
  ('Fijos', '📌'),
  ('Variables', '🛒'),
  ('Ocio', '🎉'),
  ('Ahorro y metas', '🎯')
) as g(name, icon)
where not exists (
  select 1 from public.categories c
  where c.household_id = h.id and c.is_group = true and c.name = g.name
);

-- Bucket existing leaf expense categories into their group.
with grp as (
  select household_id, name, id from public.categories where is_group = true
),
mapping(cat_name, grp_name) as (
  values
    ('Agua','Fijos'),('Alquiler','Fijos'),('Expensas','Fijos'),('Gas','Fijos'),('Luz','Fijos'),
    ('Teléfono e internet','Fijos'),('Monotributo','Fijos'),('Obra social','Fijos'),('Gimnasio','Fijos'),
    ('Psicóloga','Fijos'),('Servicios digitales','Fijos'),('Streaming','Fijos'),
    ('Super y almacén','Variables'),('Transporte','Variables'),('Cuidado personal','Variables'),
    ('Gastos de hogar','Variables'),('Mascotas','Variables'),('Otros gastos','Variables'),
    ('Ropa y calzado','Variables'),('Salud','Variables'),('Tecnología','Variables'),('Educación','Variables'),
    ('Cafeterías','Ocio'),('Comer afuera','Ocio'),('Delivery','Ocio'),('Deporte','Ocio'),
    ('Regalos','Ocio'),('Salidas y ocio','Ocio'),('Viajes','Ocio')
)
update public.categories c
set parent_id = grp.id
from mapping m, grp
where c.name = m.cat_name
  and grp.name = m.grp_name
  and grp.household_id = c.household_id
  and c.is_group = false
  and c.parent_id is null
  and c.kind = 'expense'
  and not exists (select 1 from public.accounts a where a.payment_category_id = c.id);

-- Savings-goal categories go under "Ahorro y metas".
update public.categories c
set parent_id = grp.id
from public.categories grp
where grp.is_group = true and grp.name = 'Ahorro y metas' and grp.household_id = c.household_id
  and c.is_goal = true and c.is_group = false and c.parent_id is null;
