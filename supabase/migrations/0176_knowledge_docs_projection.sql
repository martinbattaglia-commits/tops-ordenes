-- 0176_knowledge_docs_projection.sql — F5.1-b.0 · Proyección de METADATA documental
-- ENTREGADA, NO APLICADA (G3). Aprobada por Dirección 2026-07-03 (D1–D6, GO implementación local).
-- Verificar numeración contra prod arsksytgdnzukbmfgkju antes de aplicar (última aplicada: 0175).
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ HACE: proyecta la METADATA ya existente de compliance_documents (569) y
-- contract_documents (228, join a contracts) hacia searchable_items, para que el
-- Copilot F5.2-lite (ai_search_knowledge) encuentre documentos por título/categoría/
-- tipo/vencimiento/cliente. NO proyecta contenido de PDF, NO lee Drive, NO embeddings.
--
-- 100% ADITIVA · IDEMPOTENTE · REVERSIBLE (ROLLBACK_0176_0177). NO toca DDL existente.
-- Toda escritura a searchable_items va por funciones SECURITY DEFINER (0126: la tabla
-- solo tiene policy SELECT; el owner salta RLS). RLS de lectura ya existe (0126) y NO se toca.
--
-- FIXES DE REVISIÓN ADVERSARIAL (verificados en vivo 2026-07-03):
--   B1  public_id: item_id NULL en 485/569 → coalesce (no bare `||`).
--   B2  entity_date: `date AT TIME ZONE` daba timestamp-sin-tz y corría el día;
--       fix = `<date>::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'`
--       (verificado: 2026-07-03 → 2026-07-03 03:00:00+00, determinista).
--   H1  riesgo vacío en los 569 → status = nullif(btrim(riesgo),'') (será NULL; honesto).
--   H3  apply CONVERGENTE: borra huérfanos (fuente desaparecida) en la misma tx.
--   H4  ai_docs_redact NO copia guardrails.ts: redacta corridas de ≥7 dígitos SIN
--       anclar a \b (DNI/CUIT pegados en nombres de archivo sí se redactan).
--   VK  visibility_key de FUENTE ÚNICA (ai_docs_visibility_key): apply y triggers usan
--       la MISMA derivación; NO se usa knowledge_visibility_for (que da 'staff' a contratos).
--   TRG triggers fail-safe (exception→raise log; jamás abortan el write de negocio, G11),
--       dirty-check por WHEN, y trigger en `contracts` (razon_social/estado/fecha_fin).
-- ─────────────────────────────────────────────────────────────────────────────

-- =========================================================================
-- 1. Redacción PII en el WRITE PATH (D4 / H4). IMMUTABLE → usable en la vista.
--    Más estricta que guardrails.ts (que ancla a \b y es ciega a PII pegada en
--    nombres de archivo). Doble red: se redacta al ESCRIBIR y F5.2-lite redacta
--    de nuevo en retrieval. cuit/cbu/dni NUNCA se incluyen como campo; esto cubre
--    el caso de PII embebida en texto libre (títulos como 'DenunciaDNI16112445...').
-- =========================================================================
create or replace function public.ai_docs_redact(p text)
returns text
language sql
immutable
as $$
  select case when p is null then null else
    regexp_replace(
      -- 5) colapsar marcadores contiguos
      regexp_replace(
        -- 4) cualquier corrida de 7+ dígitos contiguos (DNI/CUIT/CBU/expedientes), SIN anclar
        regexp_replace(
          -- 3) CUIT/DNI PUNTUADO: grupos de dígitos sep. por . / espacio / - (33.604.896.889,
          --    12.345.678). Exige >=2 grupos de 3 → no pisa precios de miles (1.234). Cierra el
          --    leak confirmado en review (CUIT societaria punteada atravesaba la redacción).
          regexp_replace(
            -- 2) email de terceros
            regexp_replace(
              -- 1) CUIT/CUIL con separadores - o pegado
              regexp_replace(p, '(20|23|24|25|26|27|30|33|34)-?[0-9]{8}-?[0-9]', '[dato redactado]', 'g'),
            '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[dato redactado]', 'g'),
          '[0-9]{1,3}([.[:space:]-][0-9]{3}){2,}([.[:space:]-][0-9]{1,3})?', '[dato redactado]', 'g'),
        '[0-9]{7,}', '[dato redactado]', 'g'),
      '(\[dato redactado\])(\s*\[dato redactado\])+', '[dato redactado]', 'g')
  end
$$;

-- =========================================================================
-- 2. visibility_key: FUENTE ÚNICA para apply + triggers (VK). D1/D2.
--    compliance → perm:compliance.view · contrato → perm:comercial.view.
--    Fail-safe (M3): cualquier otro → 'perm:compliance.admin' (slug administrativo;
--    ningún NO-admin lo tiene → filas mal proyectadas quedan invisibles al piloto).
--    NUNCA devuelve 'public_auth' ni 'staff'. NO usa knowledge_visibility_for.
-- =========================================================================
create or replace function public.ai_docs_visibility_key(p_entity_type text)
returns text
language sql
immutable
as $$
  select case p_entity_type
    when 'compliance_documento' then 'perm:compliance.view'
    when 'contrato'             then 'perm:comercial.view'
    else 'perm:compliance.admin'
  end
$$;

-- =========================================================================
-- 3. Vista de proyección (DRY): 1 sola definición del mapping, reutilizada por
--    dry-run, apply y triggers. Bloqueada a roles no privilegiados (se consume
--    solo desde funciones SECURITY DEFINER que corren como owner).
--    - Marcador [ficha metadata] al inicio del body (visible en el excerpt=left(body,400)).
--    - Excluye cuit/hashes/drive_file_id/url/extracted_text (D4). razon_social incluida (D4).
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
        nullif(btrim(cd.titulo), ''),
        nullif(btrim(cd.categoria), ''),
        nullif(btrim(cd.tipo_doc), ''),
        nullif(btrim(cd.organismo), ''),
        nullif(btrim(cd.sede), ''),
        case when cd.fecha_vencimiento is not null then 'vence ' || to_char(cd.fecha_vencimiento, 'YYYY-MM-DD') end
      )
    ), 8192) as body,
    -- B1: item_id NULL en 85% → coalesce; entity_id corto garantiza public_id 1:1.
    (coalesce(nullif(btrim(cd.item_id), ''), 'CMP') || '#' || left(cd.id::text, 8)) as public_id,
    -- H1: riesgo vacío en los 569 (y estado también) → status NULL honesto, future-proof.
    nullif(btrim(cd.riesgo), '') as status,
    -- B2: cast a timestamp ANTES del AT TIME ZONE (determinista, mismo día calendario).
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
        nullif(btrim(cdo.titulo), ''),
        nullif(btrim(cdo.tipo_doc::text), ''),
        nullif(btrim(c.razon_social), ''),
        nullif(btrim(c.tipo::text), ''),
        nullif(btrim(c.estado), ''),
        nullif(btrim(c.deposito), ''),
        case when c.fecha_fin is not null then 'vence ' || to_char(c.fecha_fin, 'YYYY-MM-DD') end
      )
    ), 8192) as body,
    -- public_id ÚNICO por documento (sufijo id corto): evita que los N docs de un
    -- mismo contrato compartan la misma cita [S#] (hallazgo review: 228 docs → 4 ids).
    (coalesce(nullif(btrim(c.public_id), ''), 'CTR') || '#' || left(cdo.id::text, 8)) as public_id,
    nullif(btrim(c.estado), '') as status,
    case when c.fecha_fin is not null
         then (c.fecha_fin::timestamp at time zone 'America/Argentina/Buenos_Aires')
         else null end as entity_date,
    -- Si el contrato padre no existe (FK colgada) → visibilidad más restrictiva.
    case when c.id is null then public.ai_docs_visibility_key('__unknown__')
         else public.ai_docs_visibility_key('contrato') end as visibility_key
  from public.contract_documents cdo
  left join public.contracts c on c.id = cdo.contract_id;

revoke all on public.ai_docs_projection from public, anon, authenticated;

-- =========================================================================
-- 4. DRY-RUN (M5): mismo SELECT que apply (la vista) + anti-join a searchable_items
--    para duplicados/huérfanos. SOLO LECTURA — no escribe una sola fila.
-- =========================================================================
create or replace function public.ai_docs_backfill_dryrun()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with p as (select * from public.ai_docs_projection)
  select jsonb_build_object(
    'compliance_total',   (select count(*) from public.compliance_documents),
    'contratos_total',    (select count(*) from public.contract_documents),
    'proyectados',        (select count(*) from p),
    'por_tipo',           (select jsonb_object_agg(entity_type, n) from (select entity_type, count(*) n from p group by 1) t),
    'con_public_id_null', (select count(*) from p where public_id is null),
    'con_title_null',     (select count(*) from p where title is null or btrim(title) = ''),
    'con_entity_date_null', (select count(*) from p where entity_date is null),   -- H2: ~559 esperados (cobertura ~30%)
    'con_status_null',    (select count(*) from p where status is null),          -- H1: 569 compliance esperados
    'distribucion_visibility_key', (select jsonb_object_agg(visibility_key, n) from (select visibility_key, count(*) n from p group by 1) t),
    'visibility_key_no_permitida', (select count(*) from p where visibility_key not in ('perm:compliance.view','perm:comercial.view')),  -- debe ser 0
    'contratos_visibility_staff',  (select count(*) from p where entity_type = 'contrato' and visibility_key = 'staff'),                 -- debe ser 0 (VK)
    'contratos_sin_padre',(select count(*) from public.contract_documents cdo left join public.contracts c on c.id = cdo.contract_id where c.id is null),
    -- H4: 0 tras redacción, INCLUYENDO números punteados (33.604.896.889) — el métrico
    -- anterior (solo [0-9]{7,}) era ciego a la CUIT punteada; ahora cubre ambas formas.
    'pii_residual_en_body', (select count(*) from p where body ~ '[0-9]{7,}' or body ~ '[0-9]{1,3}([.[:space:]-][0-9]{3}){2,}'),
    -- H5 (heurístico ADVISORY, no bloqueante — D4 permite razon_social): sólo cuenta contratos
    -- que EFECTIVAMENTE proyectan documentos y cuya razón social parece nombre de persona.
    -- El regex tiene falsos positivos (etiquetas de depósito tipo LUJAN/MAGALDI) → ver sample.
    'razon_social_persona_probable', (select count(distinct c.id)
        from public.contract_documents cdo join public.contracts c on c.id = cdo.contract_id
        where c.razon_social !~* '(s\.?\s?a\.?|s\.?r\.?l|sas|s\.?c\.?|coop|asoc|fundac|ltda|inc|corp|group|logistic|transport|servic|lujan|magaldi|deposito|clientes)'),
    'razon_social_flagged_sample', (select jsonb_agg(distinct c.razon_social)
        from public.contract_documents cdo join public.contracts c on c.id = cdo.contract_id
        where c.razon_social !~* '(s\.?\s?a\.?|s\.?r\.?l|sas|s\.?c\.?|coop|asoc|fundac|ltda|inc|corp|group|logistic|transport|servic|lujan|magaldi|deposito|clientes)'),
    'duplicados_ya_en_index', (select count(*) from p join public.searchable_items si on si.entity_type = p.entity_type and si.entity_id = p.entity_id),
    'orphans_actuales',   (select count(*) from public.searchable_items si
        where si.entity_type in ('compliance_documento','contrato')
          and not exists (select 1 from p where p.entity_type = si.entity_type and p.entity_id = si.entity_id)),
    'footprint_bytes_body', (select coalesce(sum(length(body)), 0) from p),
    'sample', (select jsonb_agg(row_to_json(x)) from (
        select entity_type, public_id, title, left(body, 140) as body_preview, status, entity_date, visibility_key
        from p order by entity_type, entity_id limit 6) x)
  )
$$;

revoke all on function public.ai_docs_backfill_dryrun() from public, anon, authenticated;
grant execute on function public.ai_docs_backfill_dryrun() to service_role;

-- =========================================================================
-- 5. Reproyección de UNA fila (usada por los triggers). SECURITY DEFINER (owner
--    escribe searchable_items saltando RLS; la tabla solo tiene policy SELECT).
-- =========================================================================
create or replace function public.ai_docs_reproject(p_entity_type text, p_entity_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.searchable_items
    (entity_type, entity_id, title, body, public_id, status, entity_date, visibility_key)
  select entity_type, entity_id, title, body, public_id, status, entity_date, visibility_key
  from public.ai_docs_projection
  where entity_type = p_entity_type and entity_id = p_entity_id
  on conflict (entity_type, entity_id) do update set
    title = excluded.title, body = excluded.body, public_id = excluded.public_id,
    status = excluded.status, entity_date = excluded.entity_date, visibility_key = excluded.visibility_key,
    updated_at = now();
end;
$$;

revoke all on function public.ai_docs_reproject(text, text) from public, anon, authenticated;

-- =========================================================================
-- 6. APPLY (backfill real, CONVERGENTE). Idempotente (upsert por unique) +
--    reconciliación de huérfanos (H3) en pasada completa. Ventana opcional
--    (p_limit/p_offset) por tanda; la reconciliación SOLO corre sin ventana.
--    La ejecuta A MANO Dirección (G3) DESPUÉS del dry-run aprobado.
--    PRECONDICIÓN (review): searchable_items sólo tiene policy SELECT; el write
--    depende de que estas funciones SECURITY DEFINER queden OWNED por el dueño de
--    la tabla (postgres). Aplicar la migración COMO postgres. Verificar upserted=797.
-- =========================================================================
create or replace function public.ai_docs_backfill_apply(p_limit int default null, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_upserted int := 0;
  v_del_cmp  int := 0;
  v_del_ctr  int := 0;
begin
  with src as (
    select * from public.ai_docs_projection
    order by entity_type, entity_id
    limit p_limit offset coalesce(p_offset, 0)
  ),
  up as (
    insert into public.searchable_items
      (entity_type, entity_id, title, body, public_id, status, entity_date, visibility_key)
    select entity_type, entity_id, title, body, public_id, status, entity_date, visibility_key
    from src
    on conflict (entity_type, entity_id) do update set
      title = excluded.title, body = excluded.body, public_id = excluded.public_id,
      status = excluded.status, entity_date = excluded.entity_date, visibility_key = excluded.visibility_key,
      updated_at = now()
    returning 1
  )
  select count(*) into v_upserted from up;

  -- H3: reconciliación convergente (solo pasada completa). Scope ESTRICTO a los
  -- 2 entity_types de b.0 → nunca toca connect_incident/task/etc.
  if p_limit is null then
    delete from public.searchable_items si
     where si.entity_type = 'compliance_documento'
       and not exists (select 1 from public.compliance_documents d where d.id::text = si.entity_id);
    get diagnostics v_del_cmp = row_count;

    delete from public.searchable_items si
     where si.entity_type = 'contrato'
       and not exists (select 1 from public.contract_documents d where d.id::text = si.entity_id);
    get diagnostics v_del_ctr = row_count;
  end if;

  return jsonb_build_object(
    'upserted', v_upserted,
    'orphans_deleted', v_del_cmp + v_del_ctr,
    'window_limit', p_limit,
    'window_offset', p_offset
  );
end;
$$;

revoke all on function public.ai_docs_backfill_apply(int, int) from public, anon, authenticated;
grant execute on function public.ai_docs_backfill_apply(int, int) to service_role;

-- =========================================================================
-- 7. Triggers incrementales (TRG). DEFENSIVOS (G11): exception→raise log; JAMÁS
--    abortan el write de negocio / el Drive sync. Dirty-check por WHEN (solo
--    reproyectan si cambió un campo proyectado). Guard to_regclass (idempotente).
-- =========================================================================

-- 7.1 compliance_documents
create or replace function public.tg_ai_docs_compliance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if tg_op = 'DELETE' then
      delete from public.searchable_items
       where entity_type = 'compliance_documento' and entity_id = OLD.id::text;
    else
      perform public.ai_docs_reproject('compliance_documento', NEW.id::text);
    end if;
  exception when others then
    raise log 'AiDocsProjectFailed %', json_build_object(
      'src', 'compliance_documents', 'op', tg_op,
      'pk', coalesce(NEW.id, OLD.id)::text, 'error', sqlerrm);
  end;
  return null;
end;
$$;

-- 7.2 contract_documents
create or replace function public.tg_ai_docs_contract()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if tg_op = 'DELETE' then
      delete from public.searchable_items
       where entity_type = 'contrato' and entity_id = OLD.id::text;
    else
      perform public.ai_docs_reproject('contrato', NEW.id::text);
    end if;
  exception when others then
    raise log 'AiDocsProjectFailed %', json_build_object(
      'src', 'contract_documents', 'op', tg_op,
      'pk', coalesce(NEW.id, OLD.id)::text, 'error', sqlerrm);
  end;
  return null;
end;
$$;

-- 7.3 contracts (padre): al cambiar razon_social/estado/fecha_fin/tipo/deposito/public_id
--     se reproyectan TODOS sus contract_documents (si no, quedarían stale).
create or replace function public.tg_ai_docs_contract_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.ai_docs_reproject('contrato', d.id::text)
      from public.contract_documents d
     where d.contract_id = NEW.id;
  exception when others then
    raise log 'AiDocsProjectFailed %', json_build_object(
      'src', 'contracts', 'op', tg_op, 'pk', NEW.id::text, 'error', sqlerrm);
  end;
  return null;
end;
$$;

do $$
begin
  if to_regclass('public.compliance_documents') is not null then
    drop trigger if exists tg_ai_docs_compliance_ins on public.compliance_documents;
    drop trigger if exists tg_ai_docs_compliance_upd on public.compliance_documents;
    drop trigger if exists tg_ai_docs_compliance_del on public.compliance_documents;
    create trigger tg_ai_docs_compliance_ins
      after insert on public.compliance_documents
      for each row execute function public.tg_ai_docs_compliance();
    create trigger tg_ai_docs_compliance_upd
      after update on public.compliance_documents
      for each row when (
        OLD.titulo           is distinct from NEW.titulo
        or OLD.categoria     is distinct from NEW.categoria
        or OLD.tipo_doc      is distinct from NEW.tipo_doc
        or OLD.organismo     is distinct from NEW.organismo
        or OLD.sede          is distinct from NEW.sede
        or OLD.riesgo        is distinct from NEW.riesgo
        or OLD.item_id       is distinct from NEW.item_id
        or OLD.fecha_vencimiento is distinct from NEW.fecha_vencimiento
        or OLD.fecha_emision is distinct from NEW.fecha_emision
      ) execute function public.tg_ai_docs_compliance();
    create trigger tg_ai_docs_compliance_del
      after delete on public.compliance_documents
      for each row execute function public.tg_ai_docs_compliance();
  end if;

  if to_regclass('public.contract_documents') is not null then
    drop trigger if exists tg_ai_docs_contract_ins on public.contract_documents;
    drop trigger if exists tg_ai_docs_contract_upd on public.contract_documents;
    drop trigger if exists tg_ai_docs_contract_del on public.contract_documents;
    create trigger tg_ai_docs_contract_ins
      after insert on public.contract_documents
      for each row execute function public.tg_ai_docs_contract();
    create trigger tg_ai_docs_contract_upd
      after update on public.contract_documents
      for each row when (
        OLD.titulo       is distinct from NEW.titulo
        or OLD.tipo_doc  is distinct from NEW.tipo_doc
        or OLD.contract_id is distinct from NEW.contract_id
      ) execute function public.tg_ai_docs_contract();
    create trigger tg_ai_docs_contract_del
      after delete on public.contract_documents
      for each row execute function public.tg_ai_docs_contract();
  end if;

  if to_regclass('public.contracts') is not null then
    drop trigger if exists tg_ai_docs_contract_parent_upd on public.contracts;
    create trigger tg_ai_docs_contract_parent_upd
      after update on public.contracts
      for each row when (
        OLD.razon_social is distinct from NEW.razon_social
        or OLD.estado    is distinct from NEW.estado
        or OLD.fecha_fin is distinct from NEW.fecha_fin
        or OLD.tipo      is distinct from NEW.tipo
        or OLD.deposito  is distinct from NEW.deposito
        or OLD.public_id is distinct from NEW.public_id
      ) execute function public.tg_ai_docs_contract_parent();
  end if;
end $$;

-- =========================================================================
-- 8. Recargar cache de esquema de PostgREST.
-- =========================================================================
select pg_notify('pgrst', 'reload schema');
