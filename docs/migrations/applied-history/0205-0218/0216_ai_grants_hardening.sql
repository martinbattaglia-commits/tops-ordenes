-- SQL exacto del commit ef9375003b9a5d8310495f58e5b46731a19cb26f
-- SHA-256 del archivo: 676509c0f1ef5ed3f4e0bf409d9dcc9615910e47b513e03eb1a8d6ec9fb589bf
-- Se omiten únicamente el `begin;`/`commit;` explícitos: apply_migration ya ejecuta
-- de forma atómica. Las seis sentencias van íntegras y en el mismo orden.
--
-- POR QUÉ EXISTE
-- Los default privileges de Supabase otorgan ALL a `authenticated` en toda tabla
-- nueva del esquema public. El `revoke ... from public, anon` de 0213/0214 no los
-- alcanza, así que quedó concedido —entre otros— **TRUNCATE**, que **NO pasa por
-- RLS**: un autenticado podía vaciar `ai_analysis_runs`, es decir borrar la
-- auditoría de los análisis de IA. La RLS no puede contener TRUNCATE; sólo el
-- privilegio puede.
--
-- PATRÓN OBLIGATORIO: REVOKE ALL → GRANT mínimo explícito.
--
-- MATRIZ MÍNIMA (resolución de Dirección · D-2, mínimo privilegio real):
--   ai_suggestions    authenticated → SELECT, INSERT
--   ai_analysis_runs  authenticated → SELECT, INSERT
--   ai_budget_alerts  authenticated → SELECT, INSERT
--   anon              → ningún privilegio
--   service_role      → intacto
-- En las tres: sin UPDATE, sin DELETE, sin TRUNCATE, sin TRIGGER, sin REFERENCES.
--
-- El canal de la CASCADA (H-1) ya NO está abierto: lo cierra `0215`.

-- ── ai_suggestions ──────────────────────────────────────────────────────────
revoke all on table public.ai_suggestions from authenticated, anon, public;
grant select, insert on table public.ai_suggestions to authenticated;

-- ── ai_analysis_runs ────────────────────────────────────────────────────────
revoke all on table public.ai_analysis_runs from authenticated, anon, public;
grant select, insert on table public.ai_analysis_runs to authenticated;

-- ── ai_budget_alerts ────────────────────────────────────────────────────────
revoke all on table public.ai_budget_alerts from authenticated, anon, public;
grant select, insert on table public.ai_budget_alerts to authenticated;

-- La RLS sigue siendo la frontera de FILAS (policies de 0213/0214/0215, intactas).
-- Esta migración cierra la frontera de OPERACIONES, que la RLS no cubre.
