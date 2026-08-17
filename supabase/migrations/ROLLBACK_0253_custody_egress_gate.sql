-- =========================================================================
-- ROLLBACK LÓGICO · 0253 · LA PUERTA DE EGRESO
--
-- Inversa lógica e IDEMPOTENTE de 0253. NO es forward.
--
-- Devuelve `custody_assert_physical_unit_released` a su cuerpo de 0252 §7
-- —el gate por unidad SIN la exigencia propia de la foto de egreso— y retira
-- las dos superficies que 0253 agregó.
--
-- ─── LO QUE NO DESHACE, A PROPÓSITO ──────────────────────────────────────
--
-- No borra ningún evento `foto_egreso` ya registrado. La cadena de custodia es
-- append-only y una inversa que borrara evidencia sería exactamente el ataque
-- del que el módulo protege. Al revertir, esas fotos dejan de ser EXIGIDAS por
-- el gate; siguen existiendo, ligadas y verificables.
--
-- No toca la excepción de nivel: es de 0252 y su inversa es la de 0252.
-- =========================================================================

begin;

-- -------------------------------------------------------------------------
-- 1. El gate por unidad vuelve al cuerpo de 0252 §7, sin el delta de 0253
-- -------------------------------------------------------------------------

create or replace function public.custody_assert_physical_unit_released(p_physical_unit_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  c public.custody_integrity_cases;
  rc public.custody_release_certificates;
  v_head text;
  v_level smallint;
begin
  select custody_level into v_level from public.custody_physical_units
   where id=p_physical_unit_id;
  if v_level is null then
    raise exception 'unidad física inexistente' using errcode='no_data_found';
  end if;
  -- 0252 · D3. Nivel 1: evidencia defensiva, sin gate de despacho.
  if v_level < 2 then return; end if;

  select * into c from public.custody_integrity_cases
   where physical_unit_id=p_physical_unit_id for share;
  if not found then raise exception 'CUSTODY_CASE_MISSING' using errcode='check_violation'; end if;
  perform public.custody_chain_lock('physical_unit',p_physical_unit_id);
  if c.state<>'RELEASED' or c.decision_id is null then
    raise exception 'CUSTODY_HOLD: unidad física no liberada' using errcode='check_violation';
  end if;
  select * into rc from public.custody_release_certificates
     where case_id=c.id and decision_id=c.decision_id and physical_unit_id=p_physical_unit_id
     and basis in('vision_policy','human_override');
  if not found then raise exception 'CUSTODY_RELEASE_CERTIFICATE_MISSING' using errcode='check_violation'; end if;
  select row_hash into v_head from public.custody_events
   where physical_unit_id=p_physical_unit_id order by chain_seq desc limit 1;
  if v_head is null or rc.chain_head_at_release is distinct from v_head then
    raise exception 'CUSTODY_CHAIN_ADVANCED_AFTER_RELEASE' using errcode='check_violation';
  end if;
end;
$$;
revoke all on function public.custody_assert_physical_unit_released(uuid)
  from public,anon,authenticated,service_role;


-- -------------------------------------------------------------------------
-- 2. Se retiran las dos superficies que 0253 agregó
-- -------------------------------------------------------------------------

drop function if exists public.custody_egress_gate_status(uuid);
drop function if exists public.custody_assert_egress_evidence(uuid);

commit;
