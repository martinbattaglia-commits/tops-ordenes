-- 0179_docs_browse_fts.sql — F5.1-b.0.1.2 · ai_docs_browse con búsqueda FTS tokenizada
-- ENTREGADA, NO APLICADA (G3). Verificar numeración contra prod arsksytgdnzukbmfgkju
-- (última aplicada: 0178) antes de aplicar.
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ HACE: reescribe SOLO la RPC de lectura ai_docs_browse para que la búsqueda de
-- fichas no dependa de un ILIKE de substring ÚNICO (que falla con consultas multi-
-- palabra: "residuos nacion" no matchea "Residuos Peligrosos Nación"; acentos), sino
-- del FTS en español ya existente (searchable_items.tsv), con fallback ILIKE por título.
--
-- 100% ADITIVA sobre la RPC (create or replace) · REVERSIBLE (ROLLBACK_0179). NO toca
-- searchable_items, NO reproyecta, NO cambia ai_docs_projection, NO extrae texto de PDF.
--
-- SEGURIDAD (igual que 0178): SECURITY INVOKER → hereda la RLS de searchable_items
-- (has_permission('knowledge.view') + visibility_key). NO service_role. Mismo contrato
-- de salida (7 columnas). excerpt = left(body,400) del body YA redactado (ai_docs_redact
-- en la proyección); FTS/ILIKE operan sobre título/body redactados → sin PII nueva.
--
-- VALIDADO read-only en vivo 2026-07-03 (lógica FTS+ILIKE vs ILIKE-solo):
--   residuos nacion 1 (era 0) · impacto ambiental lujan 33 (0) · plancheta habilitacion
--   lujan 2 (0) · plancheta 24 (3) · CAA Magaldi 3 (0) · certificado ambiental 6 (2).
--   Listado ("archivos/documentos compliance") va por tipo sin query (path aparte).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ai_docs_browse(
  p_tipo  text default null,
  p_query text default null,
  p_limit int  default 30
) returns table (
  entity_type text, entity_id text, public_id text, title text,
  excerpt text, status text, entity_date timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with t as (
    -- Filtro por tipo: compliance | compliance_documento → compliance_documento;
    -- contrato | contratos → contrato; cualquier otra cosa / null → ambos (todos).
    select case lower(coalesce(btrim(p_tipo), ''))
      when 'compliance'            then 'compliance_documento'
      when 'compliance_documento'  then 'compliance_documento'
      when 'contrato'              then 'contrato'
      when 'contratos'             then 'contrato'
      else null
    end as et
  ),
  q as (
    -- raw = query normalizada (null si vacía → listado); tsq = tsquery español
    -- (el stemmer español quita acentos: 'nacion' matchea 'Nación').
    select
      nullif(btrim(coalesce(p_query, '')), '') as raw,
      websearch_to_tsquery('spanish', coalesce(nullif(btrim(coalesce(p_query, '')), ''), '')) as tsq
  )
  select
    s.entity_type, s.entity_id, s.public_id, s.title,
    left(coalesce(s.body, ''), 400) as excerpt,   -- body YA redactado en la proyección
    s.status, s.entity_date
  from public.searchable_items s
  cross join t
  cross join q
  where s.entity_type in ('compliance_documento', 'contrato')   -- nunca otras entidades del spine
    and (t.et is null or s.entity_type = t.et)
    and (
      q.raw is null                          -- sin query → listado completo por tipo
      or s.tsv @@ q.tsq                       -- FTS tokenizado (multi-palabra, acentos)
      or s.title ilike '%' || q.raw || '%'    -- fallback substring exacto sobre título
    )
  order by
    -- rank FTS desc (0 en listado y en matches sólo-ILIKE) → luego fecha, luego título.
    case when q.raw is null then 0::real else ts_rank(s.tsv, q.tsq) end desc,
    s.entity_date desc nulls last,
    s.title asc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)   -- cap defensivo
$$;

revoke all on function public.ai_docs_browse(text, text, int) from public, anon;
grant execute on function public.ai_docs_browse(text, text, int) to authenticated;

-- Recargar cache de esquema de PostgREST.
select pg_notify('pgrst', 'reload schema');
