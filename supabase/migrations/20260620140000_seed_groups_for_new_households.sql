-- New households get the 4 YNAB-style master groups, with the default
-- categories bucketed into them. Income categories stay ungrouped (the budget
-- is expense-only).
create or replace function public.create_household(household_name text default 'Nuestro hogar'::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_household_id uuid;
  v_user_id uuid;
  v_fijos uuid;
  v_variables uuid;
  v_ocio uuid;
  v_metas uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- 1. Create the household
  insert into households (name) values (household_name) returning id into v_household_id;

  -- 2. Assign the user to the household
  update profiles set household_id = v_household_id where id = v_user_id;

  -- 3. Seed the 4 master groups (headers, not budgetable)
  insert into categories (household_id, name, icon, kind, is_group, is_default)
    values (v_household_id, 'Fijos', '📌', 'expense', true, false) returning id into v_fijos;
  insert into categories (household_id, name, icon, kind, is_group, is_default)
    values (v_household_id, 'Variables', '🛒', 'expense', true, false) returning id into v_variables;
  insert into categories (household_id, name, icon, kind, is_group, is_default)
    values (v_household_id, 'Ocio', '🎉', 'expense', true, false) returning id into v_ocio;
  insert into categories (household_id, name, icon, kind, is_group, is_default)
    values (v_household_id, 'Ahorro y metas', '🎯', 'expense', true, false) returning id into v_metas;

  -- 4. Seed default Spanish categories, nested under their group
  insert into categories (household_id, name, icon, kind, is_default, parent_id) values
    (v_household_id, 'Comida y delivery', '🍕', 'expense', true, v_variables),
    (v_household_id, 'Super y almacén',   '🛒', 'expense', true, v_variables),
    (v_household_id, 'Transporte',        '🚇', 'expense', true, v_variables),
    (v_household_id, 'Salud',             '💊', 'expense', true, v_variables),
    (v_household_id, 'Ropa y calzado',    '👗', 'expense', true, v_variables),
    (v_household_id, 'Casa y hogar',      '🏠', 'expense', true, v_variables),
    (v_household_id, 'Tecnología',        '💻', 'expense', true, v_variables),
    (v_household_id, 'Educación',         '📚', 'expense', true, v_variables),
    (v_household_id, 'Otros gastos',      '🏷️', 'expense', true, v_variables),
    (v_household_id, 'Suscripciones',     '📱', 'expense', true, v_fijos),
    (v_household_id, 'Salidas y ocio',    '🎭', 'expense', true, v_ocio),
    (v_household_id, 'Viajes',            '✈️', 'expense', true, v_ocio);

  -- 5. Income categories (ungrouped; the budget is expense-only)
  insert into categories (household_id, name, icon, kind, is_default) values
    (v_household_id, 'Sueldo',         '💵', 'income', true),
    (v_household_id, 'Freelance',      '💼', 'income', true),
    (v_household_id, 'Otros ingresos', '💰', 'income', true);

  return v_household_id;
end;
$function$;
