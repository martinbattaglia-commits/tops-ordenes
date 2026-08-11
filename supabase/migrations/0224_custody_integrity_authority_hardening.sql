-- =========================================================================
-- 0224 · CUSTODIA IA — CONTENCIÓN DE AUTORIDAD Y COTA TEMPORAL (W22-BIS)
--
-- Depende de: 0001 (profiles) · 0005 (policies + is_admin) · 0036 (custody_events,
--             custody_evidence) · 0038 · 0222 · 0223
-- Habilita:   decisión de custodia que no descansa sobre un atributo
--             autoescribible, ni sobre una inspección anterior a la anomalía.
--
-- ESTA MIGRACIÓN ES FORWARD-ONLY. No edita ningún archivo histórico ya
-- aplicado: 0005, 0036, 0038, 0039, 0222 y 0223 quedan byte-invariantes.
--
-- ─── PROCEDENCIA (DB-C4 · W22) ────────────────────────────────────────────
-- Se remedian tres causas raíz del informe:
--
--   B-1 · ESCALADA DE profiles.role
--         La policy "profiles update own or admin" (0005) autoriza el UPDATE
--         por `id = auth.uid()` SIN acotar columnas. Un usuario authenticated
--         podía ejecutar `update profiles set role='admin' where id=auth.uid()`
--         y, acto seguido, `has_permission()` (0009:164) devolvía true por su
--         rama `current_role() = 'admin'`. Toda la autoridad del feature —y del
--         repositorio— colgaba de una columna que el propio sujeto escribía.
--
--         La migración 0202 de una rama NO integrada se consultó SÓLO como
--         evidencia histórica: no se copia, no se cherry-pickea y no se
--         referencia. La contención de acá se deriva del esquema y de los
--         consumidores VIGENTES en este árbol.
--
--   M-1 · ACL DE custody_events / custody_evidence
--         RLS (0036) sólo define policies de SELECT, de modo que INSERT/UPDATE/
--         DELETE quedaban denegados por ausencia de policy. Pero los PRIVILEGIOS
--         SQL son un control SEPARADO: el bootstrap de plataforma concede
--         `grant all on tables` a anon/authenticated/service_role, y `TRUNCATE`
--         —incluido en ALL— NO pasa por RLS. Un rol de API podía vaciar la
--         cadena de custodia entera sin violar una sola policy.
--
--   M-3/M-4 · COTA TEMPORAL DE LA INSPECCIÓN (una sola causa raíz)
--         `decide_custody_integrity` (0223) exigía que la inspección estuviera
--         DENTRO del tramo atestado (cota superior) pero no que fuera POSTERIOR
--         a las evidencias de ingreso y egreso efectivamente comparadas (cota
--         inferior). Una inspección histórica, anterior a la anomalía, acreditaba
--         una liberación sobre una carga que nadie miró después del hecho.
-- =========================================================================

-- =========================================================================
-- B-1 · LAS COLUMNAS DE AUTORIDAD DE UN PERFIL DEJAN DE SER AUTOESCRIBIBLES
--
-- Contención por TRIGGER y no por privilegios de columna. El motivo es concreto
-- y no estético: `revoke update (role,...) from authenticated` cerraría también
-- la puerta al ADMINISTRADOR LEGÍTIMO, que opera /settings/users con la misma
-- sesión `authenticated` (src/app/(app)/settings/users/actions.ts). El requisito
-- es doble —bloquear la autoelevación Y preservar al administrador válido— y
-- sólo un control que distinga QUIÉN escribe puede cumplir ambos.
--
-- `public.is_admin()` (0005) es SECURITY DEFINER y lee `profiles` bypasseando
-- RLS. En un trigger BEFORE UPDATE lee el estado ANTERIOR a la sentencia: quien
-- intenta elevarse todavía no es admin cuando se evalúa el guard, y por eso el
-- guard no puede ser sorteado por la propia sentencia que pretende habilitarlo.
-- La escalada en dos pasos tampoco existe: cada paso enfrenta el mismo guard.
--
-- `auth.uid() is null` cubre los caminos SIN usuario final —rol interno de
-- servidor, seeds y las propias migraciones—: ahí no hay sujeto que se eleve, y
-- exigir un admin rompería el alta de perfiles de `handle_new_user()`.
-- =========================================================================
create or replace function public.guard_profile_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sin cambio en las columnas de autoridad no hay nada que custodiar: una
  -- edición legítima de perfil (nombre, etc.) atraviesa el guard sin costo.
  if new.id        is not distinct from old.id
     and new.role      is not distinct from old.role
     and new.client_id is not distinct from old.client_id
     and new.active    is not distinct from old.active then
    return new;
  end if;

  -- Contexto sin usuario final: no hay autoelevación posible.
  if auth.uid() is null then
    return new;
  end if;

  if coalesce(public.is_admin(), false) then
    return new;
  end if;

  raise exception
    'no autorizado: id/role/client_id/active de un perfil sólo los modifica un administrador'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.guard_profile_authority() from public, anon, authenticated;

drop trigger if exists trg_profiles_authority_guard on public.profiles;
create trigger trg_profiles_authority_guard
  before update on public.profiles
  for each row execute function public.guard_profile_authority();

-- Defensa en profundidad, sin costo para el administrador: `anon` no tiene
-- ninguna razón para escribir perfiles, y el bootstrap de plataforma le concede
-- `all` por default privileges. Se le deja EXCLUSIVAMENTE lo que las policies
-- de 0005/0040 ya acotan por fila.
revoke insert, update, delete, truncate on public.profiles from anon;

comment on function public.guard_profile_authority() is
  'W22-BIS/B-1: impide que un usuario authenticated modifique sus propios atributos de autoridad (role, client_id, active, id). El control de decisión de custodia deja de depender de una columna autoescribible.';

-- =========================================================================
-- M-1 · PRIVILEGIOS SQL DE LA CADENA DE CUSTODIA
--
-- RLS y GRANT son controles separados y acá se cierran los dos. Todo ingreso
-- válido pasa por `attach_custody_evidence` (0222) y toda redacción por
-- `redact_custody_evidence` (0038): ambas son SECURITY DEFINER, propiedad del
-- rol que aplica las migraciones, y por lo tanto NO dependen de estos grants.
-- Retirar el DML crudo no le quita ninguna capacidad al camino productivo.
--
-- TRUNCATE es el motivo por el que esto no era sólo higiene: no lo filtra RLS.
-- =========================================================================
revoke all on public.custody_events   from public, anon, authenticated, service_role;
revoke all on public.custody_evidence from public, anon, authenticated, service_role;

-- Lectura: la conservan `authenticated` y `service_role`, acotada por las
-- policies de SELECT de 0036. `anon` no lee la cadena de custodia.
grant select on public.custody_events   to authenticated, service_role;
grant select on public.custody_evidence to authenticated, service_role;

-- =========================================================================
-- M-3/M-4 · UN ÚNICO PREDICADO CON AMBAS COTAS
--
-- El predicado de 0223 recibía las fronteras por parámetro y sólo aplicaba la
-- superior. Acá el predicado DERIVA todo del caso: el llamador aporta la
-- evidencia y el caso, nada más. Es la misma función que usan la SELECCIÓN de
-- evidencia candidata y la DECISIÓN final, de modo que no puede existir un
-- camino que ofrezca una evidencia que el otro rechace —ni al revés—.
--
-- Cotas, ambas obligatorias:
--   · INFERIOR — la inspección debe ser POSTERIOR a las DOS evidencias
--     comparadas (ingreso y egreso), en `chain_seq` y en `occurred_at`. Una
--     inspección anterior a la anomalía no acredita nada sobre ella.
--   · SUPERIOR — la inspección debe caer dentro del tramo ATESTADO, es decir
--     en `chain_seq <= chain_seq(chain_head)`. Un evento posterior al head
--     existe en la tabla pero la atestación no lo recorrió.
--
-- Todo NULL falla CERRADO: sin head, sin ingreso o sin egreso resueltos, el
-- predicado es false.
--
-- La firma de 5 argumentos de 0223 se ELIMINA. Dejarla viva mantendría un
-- predicado MÁS DÉBIL disponible para cualquier consumidor futuro, y ese es
-- exactamente el patrón que el DB-C4 castigó.
-- =========================================================================
drop function if exists public.is_custody_inspection_evidence(uuid, uuid, uuid, uuid, uuid);

create or replace function public.is_custody_inspection_evidence(
  p_evidence_id uuid,
  p_case_id     uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.custody_integrity_cases;
  v_entity      uuid;
  v_scope       text;
  v_head_seq    bigint;
  v_cmp_seq     bigint;   -- chain_seq del MÁS TARDÍO de ingreso/egreso
  v_cmp_at      timestamptz;
  v_cmp_n       int;
  v_seq         bigint;
  v_at          timestamptz;
  v_ok          boolean;
begin
  if p_evidence_id is null or p_case_id is null then
    return false;
  end if;

  select * into c from public.custody_integrity_cases where id = p_case_id;
  if not found then
    return false;
  end if;

  v_entity := coalesce(c.packing_unit_id, c.shipment_id);
  v_scope  := case when c.packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  if v_entity is null or c.client_id is null then
    return false;
  end if;

  -- Frontera SUPERIOR: el evento cuyo row_hash es el head atestado.
  if c.chain_head is null then
    return false;
  end if;
  select ev.chain_seq into v_head_seq
    from public.custody_events ev
   where coalesce(ev.packing_unit_id, ev.shipment_id) = v_entity
     and ev.row_hash = c.chain_head;
  if v_head_seq is null then
    return false;
  end if;

  -- Frontera INFERIOR: AMBAS evidencias comparadas tienen que existir y
  -- resolverse a un evento de la MISMA entidad. Si falta una, no hay
  -- comparación que fechar y el caso no libera.
  select count(*), max(ev.chain_seq), max(ev.occurred_at)
    into v_cmp_n, v_cmp_seq, v_cmp_at
    from public.custody_evidence e
    join public.custody_events ev on ev.id = e.event_id
   where e.id in (c.ingress_evidence_id, c.egress_evidence_id)
     and coalesce(ev.packing_unit_id, ev.shipment_id) = v_entity;
  if coalesce(v_cmp_n, 0) <> 2 or v_cmp_seq is null or v_cmp_at is null then
    return false;
  end if;

  select ev.chain_seq, ev.occurred_at into v_seq, v_at
    from public.custody_evidence e
    join public.custody_events ev on ev.id = e.event_id
   where e.id = p_evidence_id;
  if v_seq is null or v_at is null then
    return false;
  end if;

  select exists (
    select 1
      from public.custody_evidence e
      join public.custody_events ev on ev.id = e.event_id
     where e.id = p_evidence_id
       -- tipo y etapa CANÓNICOS de la inspección humana (D1)
       and ev.event_type = 'inspeccion_humana'
       and ev.stage      = 'despacho'
       -- soporte: foto, no redactada
       and e.kind = 'foto'
       and e.redacted = false
       -- PROCEDENCIA HUMANA acreditada y coherente
       and ev.actor_id is not null
       and e.created_by is not null
       and e.created_by = ev.actor_id
       -- misma entidad y mismo cliente que el caso
       and coalesce(ev.packing_unit_id, ev.shipment_id) = v_entity
       and public.custody_entity_client_id(v_scope, v_entity) = c.client_id
       -- distinta de las evidencias comparadas por la IA
       and e.id is distinct from c.ingress_evidence_id
       and e.id is distinct from c.egress_evidence_id
  ) into v_ok;

  if not v_ok then
    return false;
  end if;

  -- COTA INFERIOR (M-3/M-4): estrictamente posterior a ingreso Y egreso.
  if v_seq <= v_cmp_seq or v_at < v_cmp_at then
    return false;
  end if;

  -- COTA SUPERIOR: dentro del tramo efectivamente atestado.
  if v_seq > v_head_seq then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.is_custody_inspection_evidence(uuid, uuid) from public, anon, authenticated;

comment on function public.is_custody_inspection_evidence(uuid, uuid) is
  'W22-BIS/M-3/M-4: predicado ÚNICO de admisibilidad de una evidencia de inspección. Deriva del caso ambas cotas temporales —posterior a ingreso y egreso, dentro del tramo atestado— sin recibir ninguna del llamador.';

-- ---------------------------------------------------------------------------
-- SELECCIÓN de evidencia candidata, con EXACTAMENTE el mismo predicado.
--
-- Existe para que la superficie que ofrece evidencias y la que decide no puedan
-- divergir. Es de sólo lectura y reutiliza la política única de acceso: quien
-- no puede decidir tampoco enumera candidatas.
-- ---------------------------------------------------------------------------
create or replace function public.custody_inspection_candidates(p_case_id uuid)
returns table (evidence_id uuid, event_id uuid, occurred_at timestamptz, chain_seq bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.custody_integrity_cases;
  v_role text;
begin
  select a.actor_role into v_role from public.assert_custody_access('wms.custody.decide') a;

  select * into c from public.custody_integrity_cases where id = p_case_id;
  if not found then
    raise exception 'caso inexistente' using errcode = 'no_data_found';
  end if;
  perform public.assert_custody_tenant(v_role, c.client_id);

  return query
    select e.id, ev.id, ev.occurred_at, ev.chain_seq
      from public.custody_evidence e
      join public.custody_events ev on ev.id = e.event_id
     where coalesce(ev.packing_unit_id, ev.shipment_id)
             = coalesce(c.packing_unit_id, c.shipment_id)
       and public.is_custody_inspection_evidence(e.id, c.id)
       and not exists (
         select 1 from public.custody_integrity_inspection_evidence i
          where i.evidence_id = e.id
       )
     order by ev.chain_seq asc;
end;
$$;

revoke all on function public.custody_inspection_candidates(uuid) from public, anon, authenticated;
grant execute on function public.custody_inspection_candidates(uuid) to authenticated;

-- =========================================================================
-- DECISIÓN — reemplazo hacia adelante de la de 0223.
--
-- Cambia SÓLO el bloque 8: el predicado pasa a ser el de dos argumentos, que ya
-- trae ambas cotas adentro, y desaparece la derivación local del head, que era
-- justamente donde vivía la cota superior huérfana. El resto del cuerpo es el
-- de 0223, sin alteraciones: CAS, advisory lock, release admin-only, política
-- conservadora, append-only y auditoría siguen exactamente iguales.
-- =========================================================================
create or replace function public.decide_custody_integrity(
  p_case_id uuid,
  p_expected_version int,
  p_decision text,
  p_reason text,
  p_observations text default null,
  p_inspection_evidence_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.custody_integrity_cases;
  v_role text; v_new_state text; v_decision_id uuid; v_evidence uuid;
  v_session uuid; v_actor uuid; v_entity uuid; v_scope text; v_rows int; v_updated uuid;
  v_live_head text;
  v_seen uuid[] := '{}';
begin
  -- 1. §5 · política única: sesión real y acreditada, permiso y rol reales.
  select a.actor_id, a.session_id, a.actor_role into v_actor, v_session, v_role
    from public.assert_custody_access('wms.custody.decide') a;

  -- 2. Forma del comando.
  if p_decision not in ('release','quarantine') then
    raise exception 'decisión inválida' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'motivo insuficiente' using errcode = 'check_violation';
  end if;
  if p_expected_version is null or p_expected_version <= 0 then
    raise exception 'versión esperada inválida' using errcode = 'check_violation';
  end if;

  -- 3. Lock de fila + CAS.
  select * into c from public.custody_integrity_cases where id = p_case_id for update;
  if not found then raise exception 'caso inexistente' using errcode = 'no_data_found'; end if;
  if c.decision_id is not null or c.state in ('RELEASED','QUARANTINED') then
    raise exception 'caso ya decidido' using errcode = 'unique_violation';
  end if;
  if c.state <> 'REVIEW_REQUIRED' then
    raise exception 'estado no decidible: %', c.state using errcode = 'check_violation';
  end if;
  if c.version <> p_expected_version then
    raise exception 'conflicto de versión' using errcode = 'serialization_failure';
  end if;

  -- 4. §5 · tenant.
  perform public.assert_custody_tenant(v_role, c.client_id);

  v_new_state := case when p_decision = 'release' then 'RELEASED' else 'QUARANTINED' end;
  v_scope  := case when c.packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity := coalesce(c.packing_unit_id, c.shipment_id);

  -- 5. §4 · MISMO advisory lock por entidad que usa la hash-chain (0036).
  perform public.custody_chain_lock(v_scope, v_entity);

  -- 6. D3 · política conservadora de liberación.
  if p_decision = 'release' then
    if v_role <> 'admin' then
      raise exception 'liberación reservada a admin en la fase inicial (rol: %)', v_role
        using errcode = 'insufficient_privilege';
    end if;

    if not (c.hold_reasons @> array['NO_CALIBRATED_THRESHOLD']
            and array_length(c.hold_reasons,1) = 1) then
      raise exception 'liberación bloqueada: retenciones distintas de NO_CALIBRATED_THRESHOLD'
        using errcode = 'check_violation';
    end if;
    if c.chain_status is distinct from 'verified' or coalesce(c.chain_events_checked,0) <= 0
       or c.chain_head is null or c.chain_attested_at is null then
      raise exception 'liberación bloqueada: cadena no verificada' using errcode = 'check_violation';
    end if;

    select ev.row_hash into v_live_head
      from public.custody_events ev
     where coalesce(ev.packing_unit_id, ev.shipment_id) = v_entity
     order by ev.chain_seq desc limit 1;
    if c.chain_head is distinct from v_live_head then
      raise exception 'liberación bloqueada: la cadena avanzó desde la atestación'
        using errcode = 'check_violation';
    end if;
    if now() - c.chain_attested_at > interval '60 minutes' then
      raise exception 'liberación bloqueada: atestación de cadena vencida' using errcode = 'check_violation';
    end if;

    if c.outcome is distinct from 'ok' or c.execution_mode is distinct from 'real'
       or c.verdict is distinct from 'coincide'
       or c.model_confidence is null or c.model_confidence < 0 or c.model_confidence > 1 then
      raise exception 'liberación bloqueada: evaluación no apta' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.custody_integrity_evaluation_attempts t
       where t.case_id = c.id and t.status = 'completed'
         and t.completed_case_version = c.version
    ) then
      raise exception 'liberación bloqueada: evaluación sin intento confiable'
        using errcode = 'check_violation';
    end if;
    if c.ingress_evidence_id is null or c.egress_evidence_id is null then
      raise exception 'liberación bloqueada: evidencias incompletas' using errcode = 'check_violation';
    end if;
    if coalesce(array_length(p_inspection_evidence_ids,1),0) = 0 then
      raise exception 'liberación bloqueada: sin evidencia de inspección' using errcode = 'check_violation';
    end if;
  end if;

  -- 7. Decisión append-only.
  insert into public.custody_integrity_decisions
    (case_id, decision, actor_user_id, actor_session_id, actor_role, client_id, permission,
     reason, observations, previous_state, new_state, case_version_at_decision, chain_head_at_decision)
  values
    (c.id, p_decision, v_actor, v_session, v_role, c.client_id, 'wms.custody.decide',
     btrim(p_reason), nullif(btrim(coalesce(p_observations,'')),''),
     c.state, v_new_state, c.version, c.chain_head)
  returning id into v_decision_id;

  -- 8. W22-BIS · admisibilidad de cada evidencia de inspección con el predicado
  --    ÚNICO, que ya incorpora tipo/etapa/soporte, procedencia humana, entidad,
  --    cliente, distinción respecto de las comparadas y AMBAS COTAS TEMPORALES.
  --    Acá sólo queda lo que el predicado no puede saber: repetición dentro de
  --    esta misma llamada y consumo previo en otra decisión.
  foreach v_evidence in array coalesce(p_inspection_evidence_ids,'{}') loop
    if v_evidence = any(v_seen) then
      raise exception 'evidencia de inspección repetida' using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_evidence;

    if exists (
      select 1 from public.custody_integrity_inspection_evidence i
       where i.evidence_id = v_evidence
    ) then
      raise exception 'evidencia de inspección ya utilizada en otra decisión'
        using errcode = 'unique_violation';
    end if;

    if not public.is_custody_inspection_evidence(v_evidence, c.id) then
      raise exception 'evidencia de inspección inválida: tipo/etapa/soporte, actor, entidad, cliente, duplicación con las comparadas, o fuera del intervalo [posterior a ingreso y egreso, dentro de la cadena atestada]'
        using errcode = 'check_violation';
    end if;

    insert into public.custody_integrity_inspection_evidence (decision_id, evidence_id)
    values (v_decision_id, v_evidence);
  end loop;

  -- 9. Cierre del caso.
  update public.custody_integrity_cases
     set state = v_new_state, decision_id = v_decision_id,
         version = c.version + 1, updated_at = now()
   where id = c.id and version = p_expected_version and decision_id is null
   returning id into v_updated;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 or v_updated is null then
    raise exception 'cierre del caso no aplicado; decisión revertida' using errcode = 'serialization_failure';
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (v_actor, 'custody_integrity_case', c.id, 'custody.integrity_decided',
          jsonb_build_object('decision', p_decision, 'new_state', v_new_state,
                             'decision_id', v_decision_id, 'role', v_role));

  return v_decision_id;
end;
$$;

revoke all on function public.decide_custody_integrity(uuid,int,text,text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.decide_custody_integrity(uuid,int,text,text,text,uuid[]) to authenticated;

notify pgrst, 'reload schema';
