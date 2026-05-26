-- =========================================================================
-- 0006_real_operators — reemplaza operadores mock por los reales de TOPS
-- =========================================================================
-- Contexto:
--   El seed inicial (0002) cargó 4 operadores ficticios. Para producción
--   reemplazamos por los responsables reales:
--     · Juan Carlos          — Encargado Depósito Magaldi
--     · Jorge Merino         — Encargado Depósito Luján
--     · José Luis Rodríguez  — Director de Operaciones
--
-- Estrategia:
--   1) Garantizamos un índice único en `full_name` (idempotente).
--   2) Upsert de los 3 reales — si ya existían, los actualizamos; si no,
--      los creamos.
--   3) Marcamos a TODOS los demás operadores como `active = false` para
--      que NO aparezcan en el wizard de nueva orden, pero NO los borramos
--      (pueden estar referenciados por órdenes históricas — borrarlos
--      rompería el FK orders.operator_id).
-- =========================================================================

-- 1. Índice único en full_name (necesario para ON CONFLICT)
create unique index if not exists operators_full_name_uniq
  on public.operators (full_name);

-- 2. Upsert de los reales
insert into public.operators (full_name, role, avatar, depot, active) values
  ('Juan Carlos',           'Encargado Depósito · Magaldi',  'JC', 'MAGALDI', true),
  ('Jorge Merino',          'Encargado Depósito · Luján',    'JM', 'LUJAN',   true),
  ('José Luis Rodríguez',   'Director de Operaciones',       'JR', null,      true)
on conflict (full_name) do update
  set role   = excluded.role,
      avatar = excluded.avatar,
      depot  = excluded.depot,
      active = true;

-- 3. Desactivar TODOS los demás operadores (los mock y cualquier otro
--    residuo) para que no aparezcan en el wizard.
update public.operators
   set active = false
 where full_name not in (
   'Juan Carlos',
   'Jorge Merino',
   'José Luis Rodríguez'
 );

-- =========================================================================
-- Verificación (correr post-migración):
--   select full_name, role, depot, active
--     from public.operators
--    order by active desc, depot, full_name;
--
-- Esperado: 3 activos (los reales) + N inactivos (los previos).
-- =========================================================================
