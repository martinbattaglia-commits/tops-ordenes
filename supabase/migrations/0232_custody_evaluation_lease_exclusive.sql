-- =========================================================================
-- 0232 · CUSTODIA IA — LA RESERVA DE EVALUACIÓN PASA A SER EXCLUSIVA
--
-- Depende de: 0222 (tabla de intentos, trigger de transición) · 0223 (begin /
--             complete) · 0224 (endurecimiento de autoridad)
--
-- ─── QUÉ SE ARREGLA ─────────────────────────────────────────────────────
--
-- `begin_custody_integrity_evaluation` (0223) abandonaba SIEMPRE el intento
-- pendiente antes de abrir el suyo:
--
--     update ... set status = 'abandoned' where case_id = c.id and status = 'pending';
--
-- Con eso, la reserva nunca fue exclusiva: dos pedidos concurrentes obtenían
-- ambos un intento válido, ambos llamaban al PROVEEDOR y sólo el último podía
-- finalizar. La base quedaba coherente —un `completed`, un `abandoned`— pero el
-- análisis se ejecutaba DOS veces. Con un proveedor de visión real eso es una
-- segunda llamada facturada por cada doble clic, y una segunda lectura de la
-- evidencia que nadie pidió.
--
-- Acá la reserva pasa a ser lo que su nombre promete: mientras exista un
-- intento pendiente y VIGENTE, nadie más abre otro. El que pierde la carrera
-- vuelve sin haber visto al proveedor.
--
-- ─── LO QUE NO SE ROMPE ─────────────────────────────────────────────────
--
-- Un intento VENCIDO sí se abandona y se reemplaza: la exclusividad no puede
-- convertirse en un bloqueo permanente si un proceso muere. Y para el caso
-- normal —el proceso vive pero no puede finalizar— se agrega una salida
-- explícita, `abandon_custody_integrity_evaluation`, reservada al rol interno
-- de servidor, que devuelve el caso a la operación sin esperar el vencimiento
-- y sin registrar ningún resultado.
--
-- El resto del cuerpo de `begin` es el de 0223, sin alteraciones: política
-- única de acceso, CAS de versión, tenant derivado y contrastado, binding
-- congelado y auditoría.
--
-- Forward-only e idempotente. No toca 0227–0230 (WhatsApp).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) APERTURA con reserva EXCLUSIVA
-- -------------------------------------------------------------------------

create or replace function public.begin_custody_integrity_evaluation(
  p_case_id uuid,
  p_expected_version int
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.custody_integrity_cases;
  v_actor uuid; v_session uuid; v_role text;
  v_scope text; v_entity uuid; v_client uuid;
  v_attempt uuid;
  v_open public.custody_integrity_evaluation_attempts;
begin
  -- §5 · política única.
  select a.actor_id, a.session_id, a.actor_role into v_actor, v_session, v_role
    from public.assert_custody_access('wms.edit') a;

  if p_expected_version is null or p_expected_version <= 0 then
    raise exception 'versión esperada inválida' using errcode = 'check_violation';
  end if;

  select * into c from public.custody_integrity_cases where id = p_case_id for update;
  if not found then raise exception 'caso inexistente' using errcode = 'no_data_found'; end if;
  if c.decision_id is not null or c.state in ('RELEASED','QUARANTINED') then
    raise exception 'caso ya decidido' using errcode = 'unique_violation';
  end if;
  if c.version <> p_expected_version then
    raise exception 'conflicto de versión' using errcode = 'serialization_failure';
  end if;

  v_scope  := case when c.packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity := coalesce(c.packing_unit_id, c.shipment_id);

  -- Tenant DERIVADO de la entidad y contrastado contra el caso.
  v_client := public.custody_entity_client_id(v_scope, v_entity);
  if v_client is null or v_client <> c.client_id then
    raise exception 'tenant no resuelto o incoherente con el caso'
      using errcode = 'integrity_constraint_violation';
  end if;
  perform public.assert_custody_tenant(v_role, v_client);

  -- ── RESERVA EXCLUSIVA (0232) ──────────────────────────────────────────
  --
  -- Todo esto ocurre bajo el lock de la fila del caso tomado más arriba, así
  -- que dos `begin` concurrentes se serializan acá y el segundo ve el intento
  -- del primero. Un intento VIGENTE gana; uno VENCIDO se abandona.
  --
  -- El mensaje no menciona «versión» a propósito: el llamador lo clasifica por
  -- texto y esto es una reserva tomada, no un conflicto de CAS.
  select * into v_open from public.custody_integrity_evaluation_attempts
   where case_id = c.id and status = 'pending'
   for update;

  if found then
    if now() <= v_open.expires_at then
      raise exception 'ya hay una evaluación en curso para este caso'
        using errcode = 'lock_not_available';
    end if;
    update public.custody_integrity_evaluation_attempts
       set status = 'abandoned', closed_at = now()
     where id = v_open.id and status = 'pending';
  end if;

  insert into public.custody_integrity_evaluation_attempts (
    case_id, client_id, scope, entity_id, case_version_at_start,
    ingress_evidence_id, egress_evidence_id,
    requested_by, requested_session_id, requested_role,
    status, requested_at, expires_at
  ) values (
    c.id, v_client, v_scope, v_entity, c.version,
    c.ingress_evidence_id, c.egress_evidence_id,
    v_actor, v_session, v_role,
    'pending', now(), now() + interval '30 minutes'
  ) returning id into v_attempt;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (v_actor, 'custody_integrity_case', c.id, 'custody.integrity_evaluation_opened',
          jsonb_build_object('attempt_id', v_attempt, 'case_version', c.version,
                             'scope', v_scope, 'role', v_role));

  return v_attempt;
end;
$$;

revoke all on function public.begin_custody_integrity_evaluation(uuid,int) from public, anon, authenticated;
grant execute on function public.begin_custody_integrity_evaluation(uuid,int) to authenticated;

comment on function public.begin_custody_integrity_evaluation(uuid,int) is
  '0232: reserva EXCLUSIVA del intento de evaluación. Un pendiente vigente bloquea; uno vencido se abandona y se reemplaza.';

-- -------------------------------------------------------------------------
-- 2) ABANDONO EXPLÍCITO — sólo rol interno de servidor
--
--    Contrapeso de la exclusividad. No escribe NINGÚN resultado: no toca el
--    caso, no toca provider/verdict/confianza, no altera la atestación. Sólo
--    cierra la reserva para que el caso vuelva a estar disponible.
-- -------------------------------------------------------------------------

create or replace function public.abandon_custody_integrity_evaluation(
  p_attempt_id uuid
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  a public.custody_integrity_evaluation_attempts;
  v_rows int;
begin
  -- Misma barrera de contexto que la finalización: `authenticated` no cierra
  -- reservas ajenas, y `anon` no existe para esto.
  if coalesce(auth.role(), 'anon') in ('anon','authenticated') then
    raise exception 'abandono reservado al rol interno de servidor'
      using errcode = 'insufficient_privilege';
  end if;

  if p_attempt_id is null then
    raise exception 'intento obligatorio' using errcode = 'check_violation';
  end if;

  select * into a from public.custody_integrity_evaluation_attempts
   where id = p_attempt_id for update;
  if not found then
    raise exception 'intento inexistente' using errcode = 'no_data_found';
  end if;

  -- Ya cerrado: no es un error. La finalización pudo haber ganado la carrera.
  if a.status <> 'pending' then
    return false;
  end if;

  update public.custody_integrity_evaluation_attempts
     set status = 'abandoned', closed_at = now()
   where id = a.id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return false;
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (a.requested_by, 'custody_integrity_case', a.case_id,
          'custody.integrity_evaluation_abandoned',
          jsonb_build_object('attempt_id', a.id, 'case_version', a.case_version_at_start));

  return true;
end;
$$;

revoke all on function public.abandon_custody_integrity_evaluation(uuid) from public, anon, authenticated;
grant execute on function public.abandon_custody_integrity_evaluation(uuid) to service_role;

comment on function public.abandon_custody_integrity_evaluation(uuid) is
  '0232: cierra una reserva de evaluación sin registrar resultado. Rol interno de servidor.';
