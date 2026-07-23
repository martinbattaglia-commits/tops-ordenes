-- 0178_docs_retrieval_improvements.sql — F5.1-b.0.1 · Retrieval documental sobre metadata
-- ENTREGADA, NO APLICADA (G3). Diagnóstico read-only cerrado 2026-07-03 contra prod
-- arsksytgdnzukbmfgkju (última aplicada: 0177). Verificar numeración antes de aplicar.
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ HACE: mejora cómo el Copilot ENCUENTRA las 797 fichas de metadata ya
-- proyectadas por F5.1-b.0 (0176/0177). NO extrae texto de PDF, NO OCR, NO
-- embeddings, NO pgvector, NO toca Drive/Knowledge drain. 100% ADITIVA /
-- IDEMPOTENTE / REVERSIBLE (ROLLBACK_0178_docs_retrieval_improvements).
--
-- TRES CAMBIOS (todos read-only para el usuario):
--  (1) Enriquecer el `body` de ai_docs_projection con vocabulario de dominio
--      (documento/compliance/contrato/vencimiento/firma) para que el FTS
--      (ai_search_knowledge) matchee lenguaje natural. tsv es columna GENERADA
--      → se re-indexa solo al reproyectar. SIN cambiar title/status/entity_date/
--      public_id/visibility_key (behavior-preserving salvo `body`).
--  (2) ai_contracts_overview(): NUEVA RPC de lectura a GRANO CONTRATO sobre
--      public.contracts (por_vencer/vencidos/vigentes/firmados_recientes/todos).
--      Cierra el hueco raíz: ai_compliance_pending NO cubre contratos, y solo
--      4/57 contratos tienen documentos (los 4 por-vencer tienen 0) → las fichas
--      no alcanzan. Devuelve SOLO metadata (razón social, tipo, estado, fechas);
--      NO cuit, NO contenido. Arregla F-1 (por vencer) y F-2 (último firmado)
--      SIN depender de reproyección.
--  (3) ai_docs_browse(): NUEVA RPC de listado determinista de fichas por tipo +
--      nombre (lee searchable_items), sin depender del FTS frágil. Arregla F-3
--      ("buscame documentos/contratos", "qué documentos hay de X").
--
-- SEGURIDAD (Dirección 2026-07-03 · GO, patrón INVOKER): las 2 RPC nuevas son
-- SECURITY INVOKER (igual que ai_search_knowledge/ai_compliance_pending) → heredan
-- la RLS de la tabla leída. contracts tiene RLS role-based (admin/supervisor/
-- operaciones); los 6 pilotos hoy son staff. Nunca sobre-expone (fail-closed).
-- ─────────────────────────────────────────────────────────────────────────────

-- =========================================================================
-- 1. Vista de proyección con `body` ENRIQUECIDO (solo cambia `body`).
--    Reutiliza ai_docs_redact / ai_docs_visibility_key de 0176 (sin cambios).
--    Efecto en searchable_items: recién al REPROYECTAR (ai_docs_backfill_apply(),
--    paso de apply aprobado aparte). NO se ejecuta backfill acá.
-- =========================================================================
create or replace view public.ai_docs_projection as
  -- ── Compliance documento ──────────────────────────────────────────────
  select
    'compliance_documento'::text as entity_type,
    cd.id::text                  as entity_id,
    left(public.ai_docs_redact(coalesce(nullif(btrim(cd.titulo), ''), 'Documento de compliance')), 512) as title,
    left(public.ai_docs_redact(
      concat_ws(' · ',
        '[ficha metadata]',
        -- b.0.1 (1): vocabulario de dominio para FTS de lenguaje natural.
        'documento compliance cumplimiento',
        nullif(btrim(cd.titulo), ''),
        nullif(btrim(cd.categoria), ''),
        nullif(btrim(cd.tipo_doc), ''),
        nullif(btrim(cd.organismo), ''),
        nullif(btrim(cd.sede), ''),
        -- 'vencimiento' (sustantivo) + 'vence' (verbo): el stemmer español NO los
        -- unifica; incluir ambos para que "vencimiento" matchee (medido: 0 hits antes).
        case when cd.fecha_vencimiento is not null then 'vencimiento vence ' || to_char(cd.fecha_vencimiento, 'YYYY-MM-DD') end
      )
    ), 8192) as body,
    (coalesce(nullif(btrim(cd.item_id), ''), 'CMP') || '#' || left(cd.id::text, 8)) as public_id,
    nullif(btrim(cd.riesgo), '') as status,
    case when coalesce(cd.fecha_vencimiento, cd.fecha_emision) is not null
         then (coalesce(cd.fecha_vencimiento, cd.fecha_emision)::timestamp at time zone 'America/Argentina/Buenos_Aires')
         else null end as entity_date,
    public.ai_docs_visibility_key('compliance_documento') as visibility_key
  from public.compliance_documents cd

  union all

  -- ── Contrato documento (LEFT JOIN: nunca dropea un doc por FK colgada) ────
  select
    'contrato'::text as entity_type,
    cdo.id::text     as entity_id,
    left(public.ai_docs_redact(
      concat_ws(' — ', nullif(btrim(cdo.titulo), ''), nullif(btrim(c.razon_social), ''))
    ), 512) as title,
    left(public.ai_docs_redact(
      concat_ws(' · ',
        '[ficha metadata]',
        -- b.0.1 (1): vocabulario de dominio.
        'contrato documento acuerdo comercial',
        nullif(btrim(cdo.titulo), ''),
        nullif(btrim(cdo.tipo_doc::text), ''),
        nullif(btrim(c.razon_social), ''),
        nullif(btrim(c.tipo::text), ''),
        nullif(btrim(c.estado), ''),
        nullif(btrim(c.deposito), ''),
        case when c.fecha_fin is not null then 'vencimiento vence ' || to_char(c.fecha_fin, 'YYYY-MM-DD') end,
        -- b.0.1 (1): fecha de firma como METADATA (no contenido) → habilita
        -- "cuándo se firmó el contrato X" para las fichas cubiertas.
        case when c.fecha_firma is not null then 'firmado firma el ' || to_char(c.fecha_firma, 'YYYY-MM-DD') end
      )
    ), 8192) as body,
    (coalesce(nullif(btrim(c.public_id), ''), 'CTR') || '#' || left(cdo.id::text, 8)) as public_id,
    nullif(btrim(c.estado), '') as status,
    case when c.fecha_fin is not null
         then (c.fecha_fin::timestamp at time zone 'America/Argentina/Buenos_Aires')
         else null end as entity_date,
    case when c.id is null then public.ai_docs_visibility_key('__unknown__')
         else public.ai_docs_visibility_key('contrato') end as visibility_key
  from public.contract_documents cdo
  left join public.contracts c on c.id = cdo.contract_id;

revoke all on public.ai_docs_projection from public, anon, authenticated;

-- =========================================================================
-- 2. ai_contracts_overview — lectura a GRANO CONTRATO. SECURITY INVOKER →
--    hereda RLS role-based de public.contracts. SOLO metadata (sin cuit, sin
--    contenido). razon_social + detalle pasan por ai_docs_redact (defensa PII).
-- =========================================================================
create or replace function public.ai_contracts_overview(
  p_mode  text default 'todos',
  p_dias  int  default 90,
  p_query text default null,
  p_limit int  default 30
) returns table (
  public_id text, razon_social text, tipo text, estado text,
  fecha_firma date, fecha_inicio date, fecha_fin date,
  dias_para_vencer int, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    coalesce(nullif(btrim(c.public_id), ''), 'CTR#' || left(c.id::text, 8)) as public_id,
    public.ai_docs_redact(c.razon_social) as razon_social,
    c.tipo::text  as tipo,
    c.estado      as estado,
    c.fecha_firma, c.fecha_inicio, c.fecha_fin,
    case when c.fecha_fin is not null then (c.fecha_fin - current_date) end as dias_para_vencer,
    public.ai_docs_redact(concat_ws(' · ',
      'Contrato',
      nullif(btrim(c.tipo::text), ''),
      'estado ' || coalesce(nullif(btrim(c.estado), ''), 's/estado'),
      case when c.fecha_firma is not null then 'firmado ' || to_char(c.fecha_firma, 'YYYY-MM-DD') end,
      case when c.fecha_fin   is not null then 'vence '   || to_char(c.fecha_fin,   'YYYY-MM-DD') end,
      case when nullif(btrim(c.deposito), '') is not null then 'depósito ' || c.deposito end
    )) as detalle
  from public.contracts c
  where
    (
      p_query is null or btrim(p_query) = ''
      or c.razon_social ilike '%' || btrim(p_query) || '%'
      or c.public_id    ilike '%' || btrim(p_query) || '%'
      -- tipo es un ENUM de contrato (p.ej. 'ANMAT'): "contrato de ANMAT" filtra por tipo,
      -- no por razón social (validado en vivo: 41 firmados tipo='ANMAT').
      or c.tipo::text   ilike '%' || btrim(p_query) || '%'
    )
    and case coalesce(nullif(btrim(p_mode), ''), 'todos')
      when 'por_vencer' then (
        c.fecha_fin is not null
        and c.fecha_fin >= current_date
        and c.fecha_fin <= current_date + make_interval(days => least(greatest(coalesce(p_dias, 90), 1), 365))
      )
      when 'vencidos'   then (c.fecha_fin is not null and c.fecha_fin < current_date)
      when 'vigentes'   then (c.fecha_fin is null or c.fecha_fin >= current_date)
      when 'firmados_recientes' then (c.fecha_firma is not null)
      else true  -- 'todos'
    end
  order by
    case when coalesce(nullif(btrim(p_mode), ''), 'todos') = 'firmados_recientes' then c.fecha_firma end desc nulls last,
    case when coalesce(nullif(btrim(p_mode), ''), 'todos') in ('por_vencer', 'vencidos', 'vigentes') then c.fecha_fin end asc nulls last,
    c.fecha_fin asc nulls last,
    c.razon_social asc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

revoke all on function public.ai_contracts_overview(text, int, text, int) from public, anon;
grant execute on function public.ai_contracts_overview(text, int, text, int) to authenticated;

-- =========================================================================
-- 3. ai_docs_browse — listado determinista de FICHAS por tipo + nombre.
--    SECURITY INVOKER → hereda RLS de searchable_items (visibility_key). Acotado
--    a los 2 entity_types documentales (nunca lista otras entidades del spine).
-- =========================================================================
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
    select case lower(coalesce(btrim(p_tipo), ''))
      when 'compliance'            then 'compliance_documento'
      when 'compliance_documento'  then 'compliance_documento'
      when 'contrato'              then 'contrato'
      when 'contratos'             then 'contrato'
      else null
    end as et
  )
  select
    s.entity_type, s.entity_id, s.public_id, s.title,
    left(coalesce(s.body, ''), 400) as excerpt,
    s.status, s.entity_date
  from public.searchable_items s, t
  where s.entity_type in ('compliance_documento', 'contrato')
    and (t.et is null or s.entity_type = t.et)
    and (p_query is null or btrim(p_query) = '' or s.title ilike '%' || btrim(p_query) || '%')
  order by s.entity_date desc nulls last, s.title asc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

revoke all on function public.ai_docs_browse(text, text, int) from public, anon;
grant execute on function public.ai_docs_browse(text, text, int) to authenticated;

-- =========================================================================
-- 4. Recargar cache de esquema de PostgREST.
-- =========================================================================
select pg_notify('pgrst', 'reload schema');
