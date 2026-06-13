-- =========================================================================
-- 0074_add_operator_ruth — incorpora a Ruth Carrasquero como Responsable
--                          Operativo seleccionable en la Nueva OS
-- =========================================================================
-- Contexto:
--   La tabla public.operators tenía 3 responsables activos (0006):
--     · Juan Carlos          — Encargado Depósito · Magaldi
--     · Jorge Merino         — Encargado Depósito · Luján
--     · José Luis Rodríguez  — Director de Operaciones
--   Ruth Carrasquero existe en el módulo RRHH (legajo 23, ADMINISTRACION) pero
--   NO estaba en public.operators, por lo que no aparecía en el selector de
--   "Responsable operativo" del wizard /orders/new.
--
-- Estrategia (ADITIVA — no destructiva):
--   · Upsert de Ruth con cargo "Administración y Atención al Cliente",
--     avatar "RC", depot NULL (transversal, no atada a un depósito), active=true.
--   · NO se desactiva ni modifica a ningún operador existente.
--   · Reutiliza el índice único operators_full_name_uniq creado en 0006.
--
-- Idempotente: re-ejecutable sin efectos colaterales (ON CONFLICT DO UPDATE).
-- =========================================================================

insert into public.operators (full_name, role, avatar, depot, active) values
  ('Ruth Carrasquero', 'Administración y Atención al Cliente', 'RC', null, true)
on conflict (full_name) do update
  set role   = excluded.role,
      avatar = excluded.avatar,
      depot  = excluded.depot,
      active = true;

-- =========================================================================
-- Verificación (correr post-migración):
--   select full_name, role, depot, active
--     from public.operators
--    where active = true
--    order by depot nulls last, full_name;
--
-- Esperado: 4 activos — Juan Carlos, Jorge Merino, José Luis Rodríguez,
--           Ruth Carrasquero.
-- =========================================================================
