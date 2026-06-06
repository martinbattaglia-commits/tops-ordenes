-- =========================================================================
-- 0050_crm_promote_lead.sql — CRM Comercial F2.2-4 · Promoción Lead → Opportunity
--
-- ADDITIVE ONLY · SOLO FUNCIÓN. Promueve un lead calificado a oportunidad,
-- atómicamente (crea crm_opportunities + enlaza el lead + status='promovido' +
-- stage_history inicial). Enchufa con el Write-Path F2.1 (de acá en adelante
-- mandan advanceStage/reserveCapacity, sin duplicar lógica de etapas).
--
-- SECURITY INVOKER (a diferencia de la ingesta 0048, DEFINER): la calificación
-- la ejecuta un usuario comercial (hay auth.uid()) → la RLS de sesión gobierna
-- (R-G2 intacto). changed_by/created_by = auth.uid(). search_path fijado.
--
-- Frontera Clientify↔Nexus (PIPELINE §2/§5.2): al calificar se promueve. Guarda:
-- requiere service_type + CUIT (o un client enlazable). CUIT enlaza a clients
-- (clave de cuenta canónica) — es acá donde el CUIT del lead se usa.
--
-- Requiere: crm_leads (0042), crm_opportunities (0042), crm_stage_history (0045),
--   enums crm_service_t/crm_stage_t (0041), clients (0001). NO PROD. Solo staging.
-- =========================================================================

create or replace function public.crm_promote_lead(
  p_lead   uuid,
  p_fields jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_lead       public.crm_leads;
  v_service    text;
  v_cuit       text;       -- guardado (trim)
  v_cuit_dig   text;       -- dígitos para match con clients
  v_m2         numeric(12,2);
  v_deposito   public.depot_t;
  v_client_id  uuid;
  v_opp        public.crm_opportunities;
begin
  -- Lock del lead (RLS SELECT = comercial.view). Excluye soft-deleted.
  select * into v_lead from public.crm_leads
   where id = p_lead and deleted_at is null
   for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND: lead % inexistente o sin permisos', p_lead
      using errcode = 'no_data_found';
  end if;

  -- Idempotencia: ya promovido → no-op (devuelve la oportunidad existente).
  if v_lead.opportunity_id is not null or v_lead.status = 'promovido' then
    return jsonb_build_object(
      'action', 'already_promoted',
      'lead_id', v_lead.id,
      'opportunity_id', v_lead.opportunity_id);
  end if;

  -- No se promueve un lead descartado.
  if v_lead.status = 'descartado' then
    raise exception 'LEAD_DISCARDED: el lead está descartado; reactivalo antes de promover'
      using errcode = 'check_violation';
  end if;

  -- service_type (requerido, del payload).
  v_service := nullif(trim(p_fields->>'service_type'), '');
  if v_service is null or v_service not in ('anmat','general','oficinas') then
    raise exception 'INVALID_SERVICE: service_type requerido (anmat|general|oficinas)'
      using errcode = 'check_violation';
  end if;

  -- CUIT: del payload o heredado del lead. Guarda (§5.2): debe haber CUIT o client.
  v_cuit     := coalesce(nullif(trim(p_fields->>'cuit'), ''), v_lead.cuit);
  v_cuit_dig := nullif(regexp_replace(coalesce(v_cuit,''), '\D', '', 'g'), '');

  -- Enlace a clients por CUIT (cuenta canónica). Best-effort bajo RLS.
  if v_cuit_dig is not null then
    select id into v_client_id from public.clients
     where regexp_replace(coalesce(cuit,''), '\D', '', 'g') = v_cuit_dig limit 1;
  end if;

  if v_cuit is null and v_client_id is null then
    raise exception 'MISSING_BUSINESS_DATA: se requiere CUIT o un cliente enlazable para calificar'
      using errcode = 'check_violation';
  end if;

  -- Campos opcionales del payload.
  v_m2 := case when (p_fields ? 'm2') and nullif(p_fields->>'m2','') is not null
               then (p_fields->>'m2')::numeric(12,2) else null end;
  v_deposito := case when nullif(trim(p_fields->>'deposito'),'') in ('MAGALDI','LUJAN')
                     then (p_fields->>'deposito')::public.depot_t else null end;

  -- Crear la oportunidad (estado='calificado'; hereda owner + contacto del lead).
  insert into public.crm_opportunities
    (client_id, cuit, lead_id, contacto, email, telefono, service_type, m2, deposito,
     estado, owner_id, created_by)
  values
    (v_client_id, v_cuit, v_lead.id, v_lead.full_name, v_lead.email, v_lead.phone,
     v_service::public.crm_service_t, v_m2, v_deposito,
     'calificado'::public.crm_stage_t, v_lead.owner_id, auth.uid())
  returning * into v_opp;

  -- Enlazar el lead ↔ oportunidad + status='promovido'.
  update public.crm_leads
     set opportunity_id = v_opp.id,
         status = 'promovido'::public.crm_lead_status_t
   where id = v_lead.id;

  -- stage_history inicial (alta en 'calificado').
  insert into public.crm_stage_history (opportunity_id, from_stage, to_stage, changed_by, note)
  values (v_opp.id, null, 'calificado'::public.crm_stage_t, auth.uid(),
          'Promovido desde lead ' || coalesce(v_lead.public_id, v_lead.id::text));

  return jsonb_build_object(
    'action', 'promoted',
    'lead_id', v_lead.id,
    'opportunity_id', v_opp.id,
    'opportunity_public_id', v_opp.public_id,
    'owner_id', v_opp.owner_id,
    'client_id', v_client_id
  );
end;
$$;

revoke all on function public.crm_promote_lead(uuid, jsonb) from public;
grant execute on function public.crm_promote_lead(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
