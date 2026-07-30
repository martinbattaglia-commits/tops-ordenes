-- 0216_ai_grants_hardening.sql — LINK-WA-002 · endurecimiento de privilegios
-- de las tablas de IA creadas por 0213 y 0214, endurecidas en su modelo por 0215.
-- ⚠️ PROPUESTA — requiere Gate SQL autorizado. ADITIVA: no toca datos ni estructura.
--
-- POR QUÉ EXISTE
-- Los default privileges de Supabase otorgan ALL a `authenticated` en toda tabla
-- nueva del esquema public. El `revoke ... from public, anon` de 0213/0214 no los
-- alcanza, así que quedó concedido —entre otros— **TRUNCATE**, que **NO pasa por
-- RLS**: un autenticado podría vaciar `ai_analysis_runs`, es decir borrar la
-- auditoría de los análisis de IA. La RLS no puede contener TRUNCATE; sólo el
-- privilegio puede.
--
-- PATRÓN OBLIGATORIO (resolución de Dirección): REVOKE ALL → GRANT mínimo explícito.
-- No se enumeran los privilegios sobrantes uno por uno: se revoca todo y se concede
-- sólo lo que el flujo aprobado demuestra necesitar. Así, si mañana Supabase agrega
-- un privilegio nuevo por default, esta migración no queda desactualizada en silencio.
--
-- MATRIZ MÍNIMA — derivada de los consumidores REALES del código, no de supuestos:
--   ai_suggestions    SELECT  read.ts:36 (listSuggestions) — con la SESIÓN
--                     INSERT  analyze.ts:227 (persistencia)  — con la SESIÓN
--                     — SIN UPDATE (resolución de Dirección, D-2: mínimo privilegio
--                       REAL). Ningún consumidor de sesión lo ejecuta: el cambio de
--                       estado de una sugerencia corre por el canal gobernado con
--                       service_role (wa-analysis-actions.ts:62-64). No se concede
--                       por anticipación. Cuando exista una acción con sesión y RLS
--                       para aceptar o descartar, entrará por migración explícita
--                       con columnas delimitadas, actor, timestamp, transición de
--                       estado, auditoría y pruebas de suplantación.
--   ai_analysis_runs  SELECT  read.ts:69 (listRuns)
--                     INSERT  analyze.ts:71 (logRun)
--                     — sin UPDATE: una corrida es un hecho consumado, no se edita.
--   ai_budget_alerts  SELECT  budget-alerts.ts:59 (.select("id") del returning)
--                     INSERT  budget-alerts.ts:59 (upsert con ignoreDuplicates ⇒
--                             ON CONFLICT DO NOTHING, que NO requiere UPDATE)
--                     — sin UPDATE: una alerta emitida no se reescribe.
--
-- En las tres: `anon` sin ningún privilegio; `authenticated` sin DELETE, sin
-- TRUNCATE, sin TRIGGER y sin REFERENCES. `service_role` se deja como está: la
-- arquitectura vigente lo usa fuera de src/lib/ai (decisión humana sobre una
-- sugerencia) y retirarlo acá rompería el flujo aprobado.
--
-- ALCANCE: SÓLO las tres tablas de este expediente. El defecto sistémico del
-- esquema public se trata en el expediente separado DB-PRIV-001.

-- H-6: transacción explícita. Entre el REVOKE y el GRANT la tabla queda sin
-- privilegios para `authenticated`; envolver evita que una corrida concurrente
-- vea ese estado intermedio. Además hace el apply atómico: o las tres tablas
-- quedan endurecidas, o ninguna.
begin;

-- ── ai_suggestions ──────────────────────────────────────────────────────────
revoke all on table public.ai_suggestions from authenticated, anon, public;
grant select, insert on table public.ai_suggestions to authenticated;

-- ── ai_analysis_runs ────────────────────────────────────────────────────────
revoke all on table public.ai_analysis_runs from authenticated, anon, public;
grant select, insert on table public.ai_analysis_runs to authenticated;

-- ── ai_budget_alerts ────────────────────────────────────────────────────────
revoke all on table public.ai_budget_alerts from authenticated, anon, public;
grant select, insert on table public.ai_budget_alerts to authenticated;

commit;

-- La RLS sigue siendo la frontera de FILAS (policies de 0213/0214, intactas).
-- Esta migración cierra la frontera de OPERACIONES, que la RLS no cubre.
--
-- El canal de la CASCADA (hallazgo H-1) ya NO está abierto: lo cierra `0215`
-- reemplazando ON DELETE CASCADE por SET NULL y agregando `conversation_ref`
-- inmutable. Por eso 0215 va primero: revocar privilegios sin ese cambio de modelo
-- habría producido un Gate PASS afirmando una protección inexistente.
--
-- ⚠️ H-4: REVOKE no falla si no hay nada que revocar, y sólo retira lo concedido por
--   el grantor que ejecuta. Un no-op es indistinguible de un éxito ⇒ la verificación
--   es OBLIGATORIA y vive en supabase/tests/0216_ai_grants_hardening_VALIDATION.sql
--   (comprueba has_table_privilege real, relacl y attacl a nivel columna).
