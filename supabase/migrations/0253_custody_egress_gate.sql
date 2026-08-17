-- =========================================================================
-- 0253 · CUSTODIA DIGITAL · LA PUERTA DE EGRESO (S2-3)
--
-- Expediente CUSTODIA-CIERRE-CIRCUITO · bloque 2-B.
-- Aditiva y forward-only. No edita ninguna migración anterior.
--
-- ─── QUÉ FALTABA ─────────────────────────────────────────────────────────
--
-- La Adenda N.º 2 §4.2 exige foto de egreso OBLIGATORIA, comparación contra
-- la de ingreso, y despacho y POD bloqueados hasta que decida el inspector.
--
-- La comparación y el bloqueo ya existían. **La exigencia de la foto no era
-- una condición del gate**: `custody_assert_physical_unit_released` (0252 §7)
-- pide caso, estado `RELEASED`, certificado y cadena no avanzada. La foto de
-- egreso llegaba a ser obligatoria sólo de manera TRANSITIVA —no hay
-- liberación sin evidencia válida, y no hay evidencia válida sin las dos
-- fotos— y una condición transitiva no es una puerta: es una consecuencia
-- que se puede perder sin que nada la extrañe.
--
-- Y como consecuencia práctica: al despachante le llegaba `CUSTODY_HOLD`
-- —«unidad no liberada»— cuando lo único que faltaba era sacar una foto que
-- él tenía en la mano. El motivo correcto es el que el operario puede
-- resolver, y por eso se pide ANTES que el resto.
--
-- ─── LA IA ALERTA; NO DECIDE ─────────────────────────────────────────────
--
-- Nada de esta migración libera nada. `custody_egress_gate_status` es de
-- SOLO LECTURA y no escribe estado, no decide, no emite certificado y no
-- toca la cadena: describe la puerta para que la pantalla pueda mostrarla
-- antes de que el despachante choque contra el trigger. La única liberación
-- posible sigue siendo `decide_custody_integrity_v2`, que exige una persona.
--
-- ─── LOS NIVELES ─────────────────────────────────────────────────────────
--
-- El nivel 1 sale por la misma puerta que en 0252: primera condición, salida
-- total, sin foto de egreso y sin gate. La rama del nivel 2 no pierde ni una
-- condición de las que tenía — se le AGREGA una. La línea roja se respeta en
-- la dirección que importa: lo del nivel 1 no afloja nada del nivel 2.
-- =========================================================================

begin;

-- -------------------------------------------------------------------------
-- 1. La foto de egreso, como condición PROPIA y acotada por nivel
--
-- Nivel 1: retorna sin exigir nada, igual que el gate de 0252 §7. La unidad
-- de nivel 1 NO lleva foto de egreso —la base la rechaza al adjuntarla— así
-- que exigirla acá la dejaría indespachable, que es exactamente el defecto
-- que 2-A corrigió y que esta migración no puede reintroducir.
-- -------------------------------------------------------------------------

create or replace function public.custody_assert_egress_evidence(p_physical_unit_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_level smallint;
begin
  select custody_level into v_level from public.custody_physical_units
   where id=p_physical_unit_id;
  if v_level is null then
    raise exception 'unidad física inexistente' using errcode='no_data_found';
  end if;
  -- Nivel 1: fuera de la puerta. Ver 0252 §7 y contrato §9.8.
  if v_level < 2 then return; end if;

  if not exists(
    select 1 from public.custody_events
     where physical_unit_id=p_physical_unit_id
       and stage='despacho' and event_type='foto_egreso'
  ) then
    raise exception 'CUSTODY_EGRESS_PHOTO_MISSING: falta la foto de egreso'
      using errcode='check_violation';
  end if;
end;
$$;
revoke all on function public.custody_assert_egress_evidence(uuid)
  from public,anon,authenticated,service_role;

comment on function public.custody_assert_egress_evidence(uuid) is
  'Adenda §4.2 · la foto de egreso es obligatoria en nivel 2. El nivel 1 no la lleva.';


-- -------------------------------------------------------------------------
-- 2. El gate por unidad exige la foto de egreso
--
-- El cuerpo se reproduce de 0252 §7 SIN NINGÚN OTRO CAMBIO. El delta es una
-- sola sentencia, y va después de la salida por nivel y antes del resto:
--
--   · después de la salida por nivel, para que el nivel 1 no la vea nunca;
--   · antes de `CUSTODY_HOLD`, para que el motivo que se le informa al
--     despachante sea el que él puede resolver, y no uno posterior que lo
--     manda a buscar a un inspector cuando lo que falta es una foto.
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

  -- 0253 · Adenda §4.2. La foto de egreso es condición propia del gate.
  perform public.custody_assert_egress_evidence(p_physical_unit_id);

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
-- 3. La puerta, LEGIBLE desde la aplicación
--
-- Sin esto la puerta existe pero sólo se manifiesta como excepción: el
-- despachante se entera de que no puede despachar cuando ya apretó el botón,
-- y se entera en el idioma de PostgreSQL. Esta función devuelve el mismo
-- juicio ANTES, para que la pantalla lo muestre.
--
-- SOLO LECTURA por construcción: `stable`, sin `insert`/`update`/`delete`,
-- sin `perform` de nada que escriba, y sin tocar la cadena. No decide.
-- -------------------------------------------------------------------------

create or replace function public.custody_egress_gate_status(p_physical_unit_id uuid)
returns table(
  custody_level smallint,
  requires_egress_photo boolean,
  case_exists boolean,
  has_ingress_photo boolean,
  has_egress_photo boolean,
  case_state text,
  decision_kind text,
  hold_reasons text[],
  release_certificate_issued boolean,
  chain_advanced_after_release boolean,
  dispatch_allowed boolean
)
language plpgsql stable security definer set search_path=public as $$
declare
  v_level smallint;
  v_client uuid;
  v_role text;
  c public.custody_integrity_cases;
  v_cert boolean := false;
  v_head text;
  v_advanced boolean := false;
  v_ing boolean;
  v_egr boolean;
  v_decision text := null;
begin
  select a.actor_role into v_role from public.assert_custody_access('wms.view') a;

  select u.custody_level, u.client_id into v_level, v_client
    from public.custody_physical_units u where u.id=p_physical_unit_id;
  if v_level is null then
    raise exception 'unidad física inexistente' using errcode='no_data_found';
  end if;
  perform public.assert_custody_tenant(v_role,v_client);

  select exists(select 1 from public.custody_events e
      where e.physical_unit_id=p_physical_unit_id
        and e.stage='recepcion' and e.event_type='foto_ingreso'),
         exists(select 1 from public.custody_events e
      where e.physical_unit_id=p_physical_unit_id
        and e.stage='despacho' and e.event_type='foto_egreso')
    into v_ing, v_egr;

  -- Nivel 1: la puerta no aplica. Se informa el estado real de la evidencia
  -- —la foto de ingreso puede existir— pero no condiciona nada.
  if v_level < 2 then
    return query select
      v_level, false, false, v_ing, v_egr,
      null::text, null::text, array[]::text[], false, false, true;
    return;
  end if;

  select * into c from public.custody_integrity_cases
   where physical_unit_id=p_physical_unit_id;

  if found then
    if c.decision_id is not null then
      select d.decision into v_decision from public.custody_integrity_decisions d
       where d.id=c.decision_id;
    end if;
    select exists(select 1 from public.custody_release_certificates rc
       where rc.case_id=c.id and rc.decision_id=c.decision_id
         and rc.physical_unit_id=p_physical_unit_id
         and rc.basis in('vision_policy','human_override')) into v_cert;
    if v_cert then
      select rc2.chain_head_at_release into v_head
        from public.custody_release_certificates rc2
       where rc2.case_id=c.id and rc2.decision_id=c.decision_id
         and rc2.physical_unit_id=p_physical_unit_id limit 1;
      v_advanced := v_head is distinct from (
        select e.row_hash from public.custody_events e
         where e.physical_unit_id=p_physical_unit_id
         order by e.chain_seq desc limit 1);
    end if;
  end if;

  return query select
    v_level,
    true,
    found,
    v_ing,
    v_egr,
    c.state::text,
    v_decision,
    coalesce(c.hold_reasons, array[]::text[]),
    v_cert,
    v_advanced,
    (found and v_egr and v_ing and c.state='RELEASED'
      and c.decision_id is not null and v_cert and not v_advanced);
end;
$$;
revoke all on function public.custody_egress_gate_status(uuid)
  from public,anon,service_role;
grant execute on function public.custody_egress_gate_status(uuid) to authenticated;

comment on function public.custody_egress_gate_status(uuid) is
  'Adenda §4.2 · lectura de la puerta de egreso. NO decide, NO libera, NO escribe.';

commit;
