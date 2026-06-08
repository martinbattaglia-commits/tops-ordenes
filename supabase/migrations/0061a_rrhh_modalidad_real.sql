-- CAPITAL HUMANO · CH5 (0062 v2) — Modalidades de contratación reales + condición jubilado.
-- Prerequisito de 0062 v2: agrega los valores de enum que la carga real necesita.
-- ⚠️ ORDEN: aplicar ANTES de 0062 (los ADD VALUE deben estar COMMITeados antes de usarse).
--    Secuencia: 0061a → 0062 → 0063 → 0064 → CH5-b.
-- NO aplicado a producción desde la sesión. Idempotente.
--
-- Por qué no es un solo enum con "jubilado":
--   - tiempo_parcial / director / periodo_prueba son MODALIDADES de contratación → enum.
--   - "jubilado" es una CONDICIÓN del trabajador (ortogonal: un jubilado puede ser parcial
--     o completo) → columna booleana, no valor de modalidad.

-- 1) Valores de modalidad faltantes (el enum 0058 sólo trae tiempo_indeterminado/plazo_fijo/...)
alter type public.rrhh_modalidad_contratacion_t add value if not exists 'tiempo_parcial';
alter type public.rrhh_modalidad_contratacion_t add value if not exists 'director';
alter type public.rrhh_modalidad_contratacion_t add value if not exists 'periodo_prueba';

-- 2) Condición jubilado (ortogonal a la modalidad). DDL → no dispara el trigger append-only.
alter table public.rrhh_empleados
  add column if not exists es_jubilado boolean not null default false;

comment on column public.rrhh_empleados.es_jubilado is
  'Trabajador jubilado que continúa en relación de dependencia (condición, no modalidad).';
