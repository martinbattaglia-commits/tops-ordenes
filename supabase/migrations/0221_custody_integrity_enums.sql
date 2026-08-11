-- =========================================================================
-- 0221 · CUSTODIA IA — VALORES DE ENUM (D1)
--
-- Depende de: 0009 (permission_action_t) · 0036 (custody_event_type_t)
-- Habilita:   0222, 0223
--
-- ESTE ARCHIVO SÓLO AGREGA VALORES DE ENUM Y NADA MÁS.
--
-- PostgreSQL admite `alter type ... add value` dentro de un bloque de
-- transacción, pero PROHÍBE usar el valor nuevo en esa misma transacción
-- ("unsafe use of new value of enum type"). El harness aplica cada archivo de
-- migración como UNA sentencia/transacción implícita, de modo que cualquier
-- CHECK, seed o función que mencione 'inspeccion_humana' o 'custody_decide'
-- debe vivir en un archivo POSTERIOR. Por eso esta migración está deliberadamente
-- vacía de todo lo demás: partirla no es un capricho de estilo, es la única
-- forma de que 0222 pueda referenciar estos valores.
--
-- D1 · `inspeccion_humana` es el tipo de evento CANÓNICO de la inspección
-- física humana. Antes de este valor, el esquema no podía representar el hecho
-- «una persona miró la carga», y por eso la liberación era inalcanzable por
-- diseño. Este es el valor que Dirección aprobó; no se infiere ni se sustituye.
-- =========================================================================

alter type public.custody_event_type_t add value if not exists 'inspeccion_humana';

-- Acción RBAC propia para decidir sobre un caso de integridad. `permissions`
-- tiene `unique (module, action)`, y 'wms' ya ocupa view/edit/admin: sin una
-- acción nueva no se puede sembrar `wms.custody.decide`. Precedente idéntico en
-- 0164 ('incident_admin') y 0167 ('task_admin').
alter type public.permission_action_t add value if not exists 'custody_decide';
