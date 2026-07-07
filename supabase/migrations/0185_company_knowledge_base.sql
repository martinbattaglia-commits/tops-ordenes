-- 0185 · Nexus AI Copilot · Capa 2 — Knowledge Base INSTITUCIONAL de Logística TOPS
-- ─────────────────────────────────────────────────────────────────────────────
-- C1 (Slice C, 2026-07-07): la pirámide de conocimiento tenía la Capa 2
-- (institucional) RUTEADA pero SIN fuente. Esta migración crea la fuente:
--   1. Tabla public.company_knowledge_documents (staging del contenido
--      institucional curado: web, landings, dossiers, propuestas, código de
--      ética, identidad — ingerido desde una carpeta Knowledge Base de Drive).
--   2. RPC public.ai_company_knowledge_search (SECURITY INVOKER → hereda RLS):
--      SOLO documentos VIGENTES e ingeribles; excluye NO_INGESTAR/HISTORICO/
--      BORRADOR/REEMPLAZADO. FTS español + trigram, ranking determinístico.
--
-- PRINCIPIO (decisión Dirección): "NotebookLM investiga · Drive conserva · Nexus
-- indexa · Copilot responde". Tabla SEPARADA del spine operativo (searchable_items):
-- no mezcla conocimiento institucional con datos vivos (contratos/compliance).
--
-- SEGURIDAD:
--   · Lectura: has_permission('knowledge.view') (mismo gate que el spine).
--   · Escritura (curaduría): solo current_role() ∈ (admin, supervisor).
--   · RPC SECURITY INVOKER (RLS del caller); ai_docs_redact sobre texto libre.
--   · Sin service_role. Sin PII estructural (institucional = material público/interno).
--
-- IDEMPOTENTE (patrones del repo): create table if not exists · create index if
--   not exists · create or replace function · drop policy/trigger if exists.
-- NO inserta datos. NO backfill. NO reprojection. NO toca tablas existentes.
-- APLICAR A MANO EN EL SQL EDITOR (G3), SOLO CON OK EXPLÍCITO. NO db push.
-- Rollback: ROLLBACK_0185_company_knowledge_base.md. Kit de validación read-only
--   al final del archivo (comentado).
-- DEPENDE de: 0009 (has_permission, current_role), 0126 (extensión pg_trgm),
--   0176 (ai_docs_redact). Numerada al siguiente archivo libre (0180-0184 ocupados).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════ 1. TABLA ═════════════════════════
create table if not exists public.company_knowledge_documents (
  id             uuid primary key default gen_random_uuid(),
  -- Origen en Drive (biblioteca canónica). Único cuando está presente (índice parcial abajo).
  drive_file_id  text,
  source_ref     text,                                  -- id/ruta original (web url path, doc id)
  title          text not null,
  source_type    text not null,
  business_unit  text not null default 'CORPORATIVO',
  capa           text not null default 'institucional', -- forward-compat con C2 (research)
  url            text,                                  -- link REAL al documento (Drive webViewLink) o web
  summary        text,                                  -- texto curado (cuerpo para FTS + cita)
  content        text,                                  -- texto completo curado (opcional, C3 lo usa)
  estado         text not null default 'BORRADOR',
  confianza      smallint,                              -- 0-100 (confiabilidad de la fuente)
  confidencialidad text not null default 'INTERNO',
  fecha_captura  date,
  responsable    text,
  ingestable     boolean not null default true,         -- "puede ingerirse"
  -- Índice full-text español (título + resumen + contenido). Mismo enfoque que
  -- searchable_items (0126): tsv GENERADO, sin embeddings (pgvector = C3 opcional).
  tsv tsvector generated always as (
    to_tsvector('spanish',
      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(content, ''))
  ) stored,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- CHECK de dominio (estados / tipos / unidades como enum-CHECK, no text libre):
  constraint company_kb_source_type_ck check (source_type in (
    'SITE_COMPLETO','LANDING','DOSSIER','PROPUESTA_MODELO','ARGUMENTARIO','FAQ',
    'CODIGO_ETICA','IDENTIDAD_CORPORATIVA','CAPACITACION','INVESTIGACION')),
  constraint company_kb_business_unit_ck check (business_unit in (
    'ANMAT','CARGAS_GENERALES','CORPORATIVO','REGULADOS','NEXUS','OTRO')),
  constraint company_kb_capa_ck check (capa in ('institucional','research')),
  constraint company_kb_estado_ck check (estado in (
    'VIGENTE','HISTORICO','BORRADOR','NO_INGESTAR','REEMPLAZADO')),
  constraint company_kb_confidencialidad_ck check (confidencialidad in (
    'PUBLICO','INTERNO','CONFIDENCIAL')),
  constraint company_kb_confianza_ck check (confianza is null or confianza between 0 and 100)
);

comment on table public.company_knowledge_documents is
  'C1/Capa 2: conocimiento institucional curado de Logística TOPS (web/landings/dossiers/propuestas/ética/identidad), ingerido desde la Knowledge Base de Drive. Leído por ai_company_knowledge_search. Separado del spine operativo.';

-- ═════════════════════════ 2. ÍNDICES (por tipo de carga) ═════════════════════════
-- GIN sobre tsv (FTS) y trigram sobre title (búsqueda por keyword tolerante).
create index if not exists company_kb_tsv_idx
  on public.company_knowledge_documents using gin (tsv);
create index if not exists company_kb_title_trgm_idx
  on public.company_knowledge_documents using gin (title gin_trgm_ops);
-- Parcial: la query caliente lee SOLO documentos consultables (VIGENTE + ingestable).
create index if not exists company_kb_live_idx
  on public.company_knowledge_documents (capa, business_unit)
  where estado = 'VIGENTE' and ingestable;
-- Único por documento de Drive cuando está presente (evita doble ingesta del mismo file).
create unique index if not exists company_kb_drive_file_uidx
  on public.company_knowledge_documents (drive_file_id)
  where drive_file_id is not null;

-- ═════════════════════════ 3. updated_at automático ═════════════════════════
create or replace function public.company_kb_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists company_kb_touch on public.company_knowledge_documents;
create trigger company_kb_touch
  before update on public.company_knowledge_documents
  for each row execute function public.company_kb_touch_updated_at();

-- ═════════════════════════ 4. RLS ═════════════════════════
-- Lectura: cualquiera con knowledge.view (mismo gate que el spine). Escritura
-- (curaduría de la KB): solo admin/supervisor. current_role() es autoritativo
-- desde profiles.role (0005/0009), nunca del JWT.
alter table public.company_knowledge_documents enable row level security;

drop policy if exists company_kb_read on public.company_knowledge_documents;
create policy company_kb_read on public.company_knowledge_documents
  for select to authenticated
  using (public.has_permission('knowledge.view'));

drop policy if exists company_kb_write on public.company_knowledge_documents;
create policy company_kb_write on public.company_knowledge_documents
  for all to authenticated
  using (public.current_role() = any (array['admin','supervisor']::user_role_t[]))
  with check (public.current_role() = any (array['admin','supervisor']::user_role_t[]));

revoke all on public.company_knowledge_documents from anon;
grant select, insert, update, delete on public.company_knowledge_documents to authenticated;

-- ═════════════════════════ 5. RPC de lectura (SECURITY INVOKER) ═════════════════════════
-- Determinístico: el filtro por estado (solo VIGENTE + ingestable) y el ranking
-- (ts_rank) los hace SQL; el modelo solo narra y cita. Excluye por construcción
-- NO_INGESTAR/HISTORICO/BORRADOR/REEMPLAZADO. INVOKER → hereda la RLS de arriba.
create or replace function public.ai_company_knowledge_search(
  p_query  text default null,
  p_unidad text default null,
  p_capa   text default 'institucional',
  p_limit  int  default 8
) returns table (
  title text, source_type text, business_unit text, url text,
  estado text, fecha_captura date, summary text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with q as (
    select
      nullif(btrim(coalesce(p_query, '')), '')  as query,
      coalesce(nullif(btrim(p_capa), ''), 'institucional') as capa,
      nullif(btrim(coalesce(p_unidad, '')), '') as unidad
  )
  select
    d.title,
    d.source_type,
    d.business_unit,
    d.url,
    d.estado,
    d.fecha_captura,
    public.ai_docs_redact(coalesce(d.summary, '')) as summary,
    public.ai_docs_redact(concat_ws(' · ',
      'Institucional',
      d.business_unit,
      nullif(btrim(d.title), ''),
      nullif(btrim(coalesce(d.summary, '')), '')
    )) as detalle
  from public.company_knowledge_documents d, q
  where d.estado = 'VIGENTE'
    and d.ingestable
    and d.capa = q.capa
    and (q.unidad is null or lower(d.business_unit) = lower(q.unidad))
    and (
      q.query is null
      or d.tsv @@ websearch_to_tsquery('spanish', q.query)
      or d.title   ilike '%' || q.query || '%'
      or d.summary ilike '%' || q.query || '%'
      -- OR por token (paridad con el demoFilter del código): recall para preguntas
      -- comparativas/multi-tema ("diferencia entre ANMAT y cargas generales").
      or exists (
        select 1 from unnest(regexp_split_to_array(lower(q.query), '[^[:alnum:]]+')) as tok
        where length(tok) >= 4
          and (d.title ilike '%'||tok||'%' or d.summary ilike '%'||tok||'%' or d.content ilike '%'||tok||'%')
      )
    )
  order by
    case when q.query is null then 0
         else ts_rank(d.tsv, websearch_to_tsquery('spanish', q.query)) end desc,
    d.updated_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 50)
$$;

revoke all on function public.ai_company_knowledge_search(text, text, text, int) from public, anon;
grant execute on function public.ai_company_knowledge_search(text, text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- KIT DE VALIDACIÓN READ-ONLY (comentado — lo corre Martín; NO muta nada):
--
--   -- estructura y RLS habilitada
--   select relrowsecurity from pg_class where relname = 'company_knowledge_documents';   -- t
--   select count(*) from pg_policies where tablename = 'company_knowledge_documents';    -- 2
--   -- la RPC es INVOKER
--   select prosecdef from pg_proc where proname = 'ai_company_knowledge_search';         -- f
--   -- sin filas todavía (no hay ingesta en esta migración)
--   select count(*) from public.company_knowledge_documents;                             -- 0
--   -- comportamiento RLS sin mutar (excluye estados no-vigentes):
--   begin;
--     set local role authenticated;
--     -- (con una sesión piloto real, ai_company_knowledge_search('servicios')
--     --  debe devolver SOLO filas VIGENTE+ingestable; probar con datos de curaduría)
--   rollback;
-- ─────────────────────────────────────────────────────────────────────────────
