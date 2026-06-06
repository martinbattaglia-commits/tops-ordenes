-- =========================================================================
-- 0048_crm_ingest_lead.sql — CRM Comercial F2.2-1 · Ingesta de leads (inbound)
--
-- ADDITIVE ONLY · SOLO FUNCIÓN. No crea/modifica tablas, enums, columnas, RLS.
-- Implementa la ingesta inbound de leads de Clientify (D-1 inbound-only):
--   · upsert idempotente en crm_leads (clave clientify_id)
--   · deduplicación de PERSONA (clientify_id → email → phone) con D-4 "crear y marcar".
--     CUIT NO es clave de dedup de lead: identifica la CUENTA (empresa) y dos
--     contactos comparten CUIT → enlazar por CUIT a clients ocurre en la promoción.
--   · asignación de owner least-loaded (D-2) entre comerciales activos
--   · auditoría en clientify_sync_log (inbound)
--
-- SECURITY DEFINER (a diferencia del Write-Path 0047, que es INVOKER): el webhook
-- es tráfico de máquina SIN sesión de usuario (no hay auth.uid()), por eso la
-- ingesta corre como owner y la RPC es la ÚNICA puerta — superficie mínima,
-- valida el payload, no se abre service-role a las tablas. search_path fijado.
--
-- Requiere (ya en staging): crm_leads (0042), clientify_sync_log (0045),
--   enum crm_lead_status_t (0041), RBAC roles/user_roles (0009), profiles (0001).
--
-- NO aplicar a Supabase PROD. Solo staging (vrxosunxlhohmqymxots). Sin deploy.
-- =========================================================================

create or replace function public.crm_ingest_lead(
  p_lead  jsonb,
  p_raw   jsonb default null,
  p_event text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clientify_id text;
  v_source       text;
  v_full_name    text;
  v_email        text;   -- normalizado (lower/trim) para match y guardado
  v_phone        text;   -- normalizado (solo dígitos)
  v_cuit_raw     text;   -- guardado tal cual (trim); CUIT no es clave de dedup de lead
  v_company      text;
  v_tags         text[];
  v_raw          jsonb := coalesce(p_raw, p_lead);
  v_match_id     uuid;
  v_match_kind   text;
  v_existing     public.crm_leads;
  v_new_owner    uuid;
  v_lead         public.crm_leads;
  v_action       text;
  v_flag         boolean := false;
begin
  -- ── Extracción + normalización ─────────────────────────────────────────
  v_clientify_id := nullif(trim(p_lead->>'clientify_id'), '');
  v_source       := nullif(trim(p_lead->>'source'), '');
  v_full_name    := nullif(trim(p_lead->>'full_name'), '');
  v_email        := lower(nullif(trim(p_lead->>'email'), ''));
  v_phone        := nullif(regexp_replace(coalesce(p_lead->>'phone',''), '\D', '', 'g'), '');
  v_cuit_raw     := nullif(trim(p_lead->>'cuit'), '');
  v_company      := nullif(trim(p_lead->>'company_name'), '');
  v_tags         := case when jsonb_typeof(p_lead->'tags') = 'array'
                         then array(select jsonb_array_elements_text(p_lead->'tags'))
                         else '{}'::text[] end;

  -- ── Resolución de match de PERSONA (prioridad: clientify_id → email → phone) ─
  -- CUIT NO entra acá (es clave de cuenta, no de persona — ver cabecera).
  if v_clientify_id is not null then
    select id into v_match_id from public.crm_leads
     where clientify_id = v_clientify_id and deleted_at is null limit 1;
    if v_match_id is not null then v_match_kind := 'clientify_id'; end if;
  end if;

  if v_match_id is null and v_email is not null then
    select id into v_match_id from public.crm_leads
     where deleted_at is null and lower(email) = v_email limit 1;
    if v_match_id is not null then v_match_kind := 'email'; end if;
  end if;

  if v_match_id is null and v_phone is not null then
    select id into v_match_id from public.crm_leads
     where deleted_at is null
       and regexp_replace(coalesce(phone,''), '\D', '', 'g') = v_phone limit 1;
    if v_match_id is not null then v_match_kind := 'phone'; end if;
  end if;

  -- ── Asignación de owner (least-loaded entre comerciales activos · D-2) ──
  -- Por servicio/origen requiere una tabla de mapeo equipo→usuario que aún no
  -- existe → se implementa el fallback least-loaded (operativo). Determinista:
  -- menor cantidad de leads abiertos; empate → menor owner_id.
  select u.id into v_new_owner
  from (
    select p.id
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.roles r on r.id = ur.role_id and r.slug = 'comercial'
    where p.active = true
  ) u
  left join lateral (
    select count(*) c from public.crm_leads l
    where l.owner_id = u.id and l.deleted_at is null
      and l.status in ('nuevo','contactado','calificado')
  ) cnt on true
  order by cnt.c asc, u.id asc
  limit 1;

  -- ── Decisión ───────────────────────────────────────────────────────────
  if v_match_id is null then
    -- INSERT nuevo lead
    insert into public.crm_leads
      (clientify_id, source, full_name, email, phone, cuit, company_name, status, owner_id, tags, raw)
    values
      (v_clientify_id, v_source, v_full_name, v_email, v_phone, v_cuit_raw, v_company,
       'nuevo'::public.crm_lead_status_t, v_new_owner, v_tags, v_raw)
    returning * into v_lead;
    v_action := 'inserted';

  elsif v_match_kind = 'clientify_id' then
    -- Upsert idempotente: mismo contacto Clientify → el entrante gana (refresca).
    update public.crm_leads set
      source       = coalesce(v_source, source),
      full_name    = coalesce(v_full_name, full_name),
      email        = coalesce(v_email, email),
      phone        = coalesce(v_phone, phone),
      cuit         = coalesce(v_cuit_raw, cuit),
      company_name = coalesce(v_company, company_name),
      tags         = array(select distinct e from unnest(tags || v_tags) e),
      raw          = v_raw
    where id = v_match_id returning * into v_lead;
    v_action := 'updated';

  else
    -- Match por identidad (cuit/email/phone) sin clientify_id previo.
    select * into v_existing from public.crm_leads where id = v_match_id;

    if v_match_kind in ('email','phone')
       and v_existing.full_name is not null and v_full_name is not null
       and lower(trim(v_existing.full_name)) <> lower(trim(v_full_name)) then
      -- D-4 · conflicto ambiguo → CREAR y MARCAR (nunca mergear en conflicto)
      insert into public.crm_leads
        (clientify_id, source, full_name, email, phone, cuit, company_name, status, owner_id, tags, raw)
      values
        (v_clientify_id, v_source, v_full_name, v_email, v_phone, v_cuit_raw, v_company,
         'nuevo'::public.crm_lead_status_t, v_new_owner,
         array(select distinct e from unnest(v_tags || array['posible_duplicado']) e),
         v_raw || jsonb_build_object('_dedup_conflict_with', v_existing.id))
      returning * into v_lead;
      v_action := 'duplicate_flagged';
      v_flag := true;

    else
      -- Enriquecer/enlazar el existente (merge-safe: solo rellena huecos).
      update public.crm_leads set
        clientify_id = coalesce(clientify_id, v_clientify_id),
        source       = coalesce(source, v_source),
        full_name    = coalesce(full_name, v_full_name),
        email        = coalesce(email, v_email),
        phone        = coalesce(phone, v_phone),
        cuit         = coalesce(cuit, v_cuit_raw),
        company_name = coalesce(company_name, v_company),
        tags         = array(select distinct e from unnest(tags || v_tags) e),
        raw          = v_raw
      where id = v_match_id returning * into v_lead;
      v_action := 'linked';
    end if;
  end if;

  -- ── Auditoría (inbound) ────────────────────────────────────────────────
  insert into public.clientify_sync_log (direction, entity, clientify_id, nexus_id, event, status, payload)
  values ('inbound', 'lead', v_clientify_id, v_lead.id, p_event, 'ok',
          v_raw || jsonb_build_object('_ingest',
            jsonb_build_object('action', v_action, 'owner_id', v_new_owner,
                               'match_kind', v_match_kind, 'flagged', v_flag)));

  return jsonb_build_object(
    'action',      v_action,
    'lead_id',     v_lead.id,
    'public_id',   v_lead.public_id,
    'owner_id',    v_lead.owner_id,
    'status',      v_lead.status,
    'dedup_match', v_match_id,
    'dedup_kind',  v_match_kind,
    'flagged',     v_flag
  );
end;
$$;

-- =========================================================================
-- Grants — SOLO service_role (el webhook llama con cliente service-role).
-- NO authenticated/anon: es una superficie de máquina (asigna owner, bypassa
-- RLS por ser DEFINER). El owner de la función (postgres) ejecuta la escritura.
-- =========================================================================
revoke all on function public.crm_ingest_lead(jsonb, jsonb, text) from public;
grant execute on function public.crm_ingest_lead(jsonb, jsonb, text) to service_role;

notify pgrst, 'reload schema';
