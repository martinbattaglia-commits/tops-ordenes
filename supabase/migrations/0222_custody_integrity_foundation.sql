-- =========================================================================
-- 0222 · CUSTODIA IA — FUNDACIÓN (D1 esquema + D2 atestación server-side)
--
-- Depende de: 0001 (clients, profiles, audit_log) · 0005 (current_role)
--             0009 (RBAC, has_permission) · 0030 (logistics_orders)
--             0033 (packing_units) · 0035 (shipments)
--             0036 (custody_events, hash-chain) · 0037 (retención por bucket)
--             0038 (custody_evidence, attach_custody_evidence,
--             verify_custody_chain) · 0221 (valores de enum)
-- Habilita:   0223
--
-- ─── D1 · INSPECCIÓN HUMANA ────────────────────────────────────────────────
-- El CHECK de 0036 enumeraba pares (stage, event_type) y no contemplaba la
-- inspección humana. Se amplía para admitir EXACTAMENTE (despacho,
-- inspeccion_humana). No se relaja ningún otro par.
--
-- Y —hallazgo del DB-C4— el esquema por sí solo no alcanzaba: la ÚNICA vía
-- productiva de captura, `attach_custody_evidence` (0038), rechazaba ese par
-- por su propia lista blanca interna, de modo que la inspección sólo podía
-- fabricarse con INSERT directo. Sin modificar 0038, esta migración REEMPLAZA
-- la función HACIA ADELANTE (misma firma) para que la inspección humana tenga
-- un camino productivo real, con actor, tenant e instante DERIVADOS
-- server-side. Ver §3.
--
-- ─── D2 · ATESTACIÓN DERIVADA ÍNTEGRAMENTE SERVER-SIDE ─────────────────────
-- `verify_custody_chain` devolvía {valid, events_checked, first_error}: no
-- acreditaba SOBRE QUÉ entidad se pronunciaba ni QUÉ eventos cubrió, así que un
-- llamador podía aplicar una verificación de la entidad A a un caso de la
-- entidad B. Ahora la atestación deriva y firma: scope, entity_id,
-- events_checked, verified_event_ids, chain_head y attested_at. Las tres claves
-- originales se preservan porque 0039 las consume.
--
-- CORRECCIÓN DB-C4 · CADENA VACÍA: una entidad sin eventos devolvía
-- `valid = true` (el acumulador nunca se tocaba). Afirmar que una cadena
-- inexistente es válida es exactamente lo contrario de lo que corresponde.
-- Ahora `valid = false`, `status = 'unverifiable'`, `events_checked = 0` y ni
-- `chain_head` ni `attested_at`. CONSECUENCIA CONOCIDA Y QUERIDA: 0039
-- (`get_shipment_custody_summary`) informará `chain_valid = false` para un
-- shipment sin ningún evento de custodia, que es el hecho verdadero.
--
-- La atestación se parte en dos: `custody_chain_attestation` (INTERNA, sin
-- gate de rol, sin auditoría) y `verify_custody_chain` (user-facing, con el
-- gate canónico y la auditoría). El motivo es concreto: la finalización de una
-- evaluación corre bajo el rol interno de servidor, SIN sesión de usuario, y
-- necesita re-derivar la atestación; con un único cuerpo gateado por
-- `current_role()` eso era imposible sin relajar el gate para todos.
--
-- 🔴 HALLAZGO VIGENTE (0009:164) — `has_permission` NO ES NULL-SAFE
--   Devuelve `exists(...) or public.current_role() = 'admin'`. Con rol NULL la
--   expresión es `false or NULL` = NULL, y un guard `if not has_permission(...)`
--   evalúa `not NULL` = NULL: NO dispara y la autorización PASA EN SILENCIO.
--   Acá SIEMPRE se envuelve en `coalesce(..., false)`. Corregir la función en sí
--   afecta a todo el repositorio y sigue siendo decisión de Dirección.
-- =========================================================================

-- =========================================================================
-- 0) D1 · el esquema ya puede representar la inspección humana
-- =========================================================================
alter table public.custody_events drop constraint if exists custody_events_stage_type_chk;
alter table public.custody_events add constraint custody_events_stage_type_chk check (
      (stage = 'packing'    and event_type = 'foto_packing')
   or (stage = 'despacho'   and event_type in ('cargado', 'inspeccion_humana'))
   or (stage = 'transporte' and event_type = 'en_transito')
   or (stage = 'entrega'    and event_type in ('foto_entrega','firmado'))
   or (stage = 'pod'        and event_type = 'pod')
);

-- Permiso RBAC de decisión. Sin fila en `permissions`, `has_permission` sólo
-- podría devolver true por la rama `current_role() = 'admin'`, y la decisión
-- quedaría reservada de hecho a los administradores.
--
-- NOTA DE ALCANCE (§5 · RELEASE ADMIN-ONLY): se crea el PERMISO, y
-- deliberadamente NO se siembra ninguna fila en `role_permissions`. Ni
-- 'operaciones' ni 'supervisor' lo reciben automáticamente. Una delegación
-- futura exige una decisión separada y visible en su propio diff.
insert into public.permissions (slug, module, action, label, description)
values ('wms.custody.decide', 'wms', 'custody_decide',
        'Decidir casos de integridad de custodia',
        'Liberar o poner en cuarentena una unidad tras inspección humana')
on conflict (slug) do nothing;

-- =========================================================================
-- 1) Helpers de scope y tenant
-- =========================================================================

/** Alcance de cliente del usuario. `profiles.client_id` puede estar sin poblar:
    mientras siga así, un rol 'cliente' no verá filas. Es el fallo correcto. */
create or replace function public.current_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.client_id from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.current_client_id() from public, anon, authenticated;
grant execute on function public.current_client_id() to authenticated;

/** Scope real de una evidencia: custody_evidence → custody_events.
    ESTA es la única ruta válida: `custody_evidence` NO tiene columnas de scope,
    su único vínculo es `event_id`. */
create or replace function public.custody_evidence_scope(p_evidence_id uuid)
returns table (packing_unit_id uuid, shipment_id uuid, event_id uuid)
language sql stable security definer set search_path = public as $$
  select evt.packing_unit_id, evt.shipment_id, evt.id
    from public.custody_evidence ev
    join public.custody_events evt on evt.id = ev.event_id
   where ev.id = p_evidence_id;
$$;
-- HELPER INTERNO: sin EXECUTE para authenticated (evita enumeración cross-client).
revoke all on function public.custody_evidence_scope(uuid) from public, anon, authenticated;

/** client_id canónico de una entidad de custodia, vía su pedido. */
create or replace function public.custody_entity_client_id(p_scope text, p_entity_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select lo.client_id
    from public.logistics_orders lo
   where lo.id = case
     when p_scope = 'packing_unit' then (select pu.order_id from public.packing_units pu where pu.id = p_entity_id)
     when p_scope = 'shipment'     then (select s.order_id  from public.shipments s     where s.id = p_entity_id)
   end;
$$;
revoke all on function public.custody_entity_client_id(text, uuid) from public, anon, authenticated;

-- =========================================================================
-- 2) §5 · POLÍTICA ÚNICA DE ACCESO
--
--    Una sola implementación para TODAS las RPC user-facing SECURITY DEFINER
--    de este feature. Antes cada RPC repetía su propia variante y las
--    diferencias eran reales: `upsert_custody_integrity_assessment` no
--    validaba la sesión contra `auth.sessions` ni acotaba por tenant, de modo
--    que un usuario client-bound podía crear casos de OTRO cliente.
--
--    Reglas, en este orden:
--      1. sesión real          → auth.uid() no nulo;
--      2. sesión ACREDITADA    → session_id del token, presente en auth.sessions
--                                y perteneciente a ese usuario;
--      3. permiso requerido    → has_permission(...) SIEMPRE con coalesce;
--      4. rol real             → current_role() no nulo.
--
--    El orden 3→4 no es cosmético: se comprueba el permiso ANTES que el rol
--    justamente para que el guard atraviese el hazard de 0009:164 y quede
--    demostrado que `coalesce` es lo que cierra la puerta. Invertirlo haría
--    que un rol NULL fallara antes de tocar `has_permission` y la protección
--    dejaría de estar probada.
--
--    Cualquier NULL falla CERRADO.
-- =========================================================================
create or replace function public.assert_custody_access(p_permission text)
returns table (actor_id uuid, session_id uuid, actor_role text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid; v_session uuid; v_role text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'sesión inexistente' using errcode = 'insufficient_privilege';
  end if;

  -- session_id REAL del JWT, comprobado contra auth.sessions. No se acepta
  -- auth.uid() como sustituto: una sesión no acreditada no opera.
  v_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if v_session is null then
    raise exception 'sesión no acreditada en el token' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from auth.sessions s where s.id = v_session and s.user_id = v_actor) then
    raise exception 'sesión inválida para el usuario' using errcode = 'insufficient_privilege';
  end if;

  if not coalesce(public.has_permission(p_permission), false) then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  v_role := public.current_role();
  if v_role is null then
    raise exception 'rol no asignado' using errcode = 'insufficient_privilege';
  end if;

  return query select v_actor, v_session, v_role;
end;
$$;
revoke all on function public.assert_custody_access(text) from public, anon, authenticated;

/**
 * §5 · Acotamiento por tenant, con el client_id DERIVADO server-side.
 *
 * Los roles internos globales conservan EXCLUSIVAMENTE la política canónica ya
 * existente en el repositorio (sin scoping por cliente). Un usuario
 * client-bound sólo opera sobre su propio client_id. Un client_id sin resolver
 * —o un `current_client_id()` NULL— falla cerrado.
 */
create or replace function public.assert_custody_tenant(p_actor_role text, p_client_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_actor_role is null then
    raise exception 'rol no asignado' using errcode = 'insufficient_privilege';
  end if;
  if p_client_id is null then
    raise exception 'tenant no resuelto' using errcode = 'insufficient_privilege';
  end if;
  if p_actor_role in ('admin','operaciones','supervisor') then
    return;
  end if;
  if public.current_client_id() is null or public.current_client_id() <> p_client_id then
    raise exception 'cliente ajeno' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function public.assert_custody_tenant(text, uuid) from public, anon, authenticated;

-- =========================================================================
-- 3) D2 · ATESTACIÓN DE CADENA
--
--    3.a `custody_chain_attestation` — cuerpo INTERNO, sin gate de rol y sin
--        auditoría. Lo consumen `verify_custody_chain` (user-facing) y la
--        finalización de evaluación (rol interno de servidor, sin sesión).
--        Revocada para public/anon/authenticated: no es una superficie.
-- =========================================================================
create or replace function public.custody_chain_attestation(
  p_scope text,
  p_entity_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_total int := 0;
  v_valid boolean := true;
  v_first_error jsonb := null;
  v_expected_prev text := null;
  v_canon text;
  v_expected_row text;
  v_ids uuid[] := '{}';
  v_head text;
  v_status text;
  v_attested timestamptz;
begin
  if p_scope not in ('packing_unit','shipment') or p_entity_id is null then
    raise exception 'scope o entidad inválidos' using errcode = 'check_violation';
  end if;

  for r in
    select * from public.custody_events
    where (p_scope = 'packing_unit' and packing_unit_id = p_entity_id)
       or (p_scope = 'shipment'     and shipment_id     = p_entity_id)
    order by chain_seq asc
  loop
    v_total := v_total + 1;
    v_canon := concat_ws('|',
      coalesce(r.packing_unit_id::text, ''),
      coalesce(r.shipment_id::text, ''),
      r.stage::text,
      r.event_type::text,
      coalesce(r.actor_id::text, ''),
      to_char(r.occurred_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
      coalesce(r.geo_lat::text, ''),
      coalesce(r.geo_lng::text, ''),
      coalesce(r.evidence_sha256, ''),
      coalesce(r.notes, ''));
    v_expected_row := encode(sha256(convert_to(coalesce(v_expected_prev, '') || '||' || v_canon, 'UTF8')), 'hex');

    if r.prev_hash is distinct from v_expected_prev then
      v_valid := false;
      v_first_error := jsonb_build_object('public_id', r.public_id, 'chain_seq', r.chain_seq,
                         'reason', 'prev_hash discontinuo');
      exit;
    end if;
    if r.row_hash <> v_expected_row then
      v_valid := false;
      v_first_error := jsonb_build_object('public_id', r.public_id, 'chain_seq', r.chain_seq,
                         'reason', 'row_hash no coincide (tamper)');
      exit;
    end if;

    -- Sólo se acreditan los eventos EFECTIVAMENTE recorridos y validados.
    v_ids := v_ids || r.id;
    v_expected_prev := r.row_hash;
  end loop;

  -- CORRECCIÓN DB-C4 · Una cadena vacía no es «válida»: es INVERIFICABLE, y
  -- además NO es válida. Devolver valid=true sobre cero eventos habilitaba
  -- afirmar integridad de una entidad sobre la que no se registró nada.
  if v_total = 0 then
    v_status := 'unverifiable';
    v_valid  := false;
  elsif v_valid then
    v_status := 'verified';
  else
    v_status := 'invalid';
  end if;

  if v_status = 'verified' then
    v_head := v_expected_prev;          -- row_hash del último evento recorrido
    v_attested := now();                -- instante SERVER-SIDE, nunca del caller
  end if;

  return jsonb_build_object(
    -- claves originales de 0038 (0039 las consume)
    'valid', v_valid,
    'events_checked', v_total,
    'first_error', v_first_error,
    -- D2: atestación derivada server-side
    'status', v_status,
    'scope', p_scope,
    'entity_id', p_entity_id,
    'verified_event_ids', to_jsonb(v_ids),
    'chain_head', v_head,
    'attested_at', v_attested
  );
end;
$$;
revoke all on function public.custody_chain_attestation(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3.a-bis §4 · EL MISMO advisory lock por entidad que usa la hash-chain.
--
--     `custody_event_hashchain` (0036) serializa la inserción de eventos con
--     `pg_advisory_xact_lock(hashtext('custody_chain:pu:'||id))` —o ':sh:'—.
--     Cualquier lectura que pretenda pronunciarse sobre el HEAD de la cadena
--     debe tomar EXACTAMENTE esa misma llave, o un evento concurrente puede
--     colarse entre el control del head y el commit. La clave se deriva acá,
--     una sola vez, para que no exista la posibilidad de escribir mal la
--     cadena de texto en un segundo lugar y creerse serializado sin estarlo.
--
--     Es `pg_advisory_xact_lock`: se libera con la transacción, nunca antes.
-- ---------------------------------------------------------------------------
create or replace function public.custody_chain_lock(p_scope text, p_entity_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_entity_id is null then
    raise exception 'entidad nula: no hay cadena que serializar' using errcode = 'check_violation';
  end if;
  if p_scope = 'packing_unit' then
    perform pg_advisory_xact_lock(hashtext('custody_chain:pu:' || p_entity_id::text));
  elsif p_scope = 'shipment' then
    perform pg_advisory_xact_lock(hashtext('custody_chain:sh:' || p_entity_id::text));
  else
    raise exception 'scope inválido para el lock de cadena: %', p_scope using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function public.custody_chain_lock(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3.b `verify_custody_chain` — MISMA firma que 0038 (0039 la consume) y mismas
--     tres claves originales, más los hechos que antes no acreditaba. TODO se
--     deriva adentro: el llamador no aporta —ni puede aportar— scope, entidad,
--     head ni instante. Conserva el gate de rol canónico y la auditoría.
-- ---------------------------------------------------------------------------
create or replace function public.verify_custody_chain(
  p_packing_unit_id uuid default null,
  p_shipment_id     uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_scope text;
  v_entity uuid;
  v_att jsonb;
begin
  -- Gate de lectura. `current_role()` NULL entra por la primera condición: la
  -- expresión completa nunca queda en NULL.
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;
  if num_nonnulls(p_packing_unit_id, p_shipment_id) <> 1 then
    raise exception 'indicar exactamente uno de packing_unit_id / shipment_id';
  end if;

  v_scope  := case when p_packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity := coalesce(p_packing_unit_id, p_shipment_id);

  v_att := public.custody_chain_attestation(v_scope, v_entity);

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), v_scope, v_entity, 'custody.chain_verify',
          jsonb_build_object('valid', v_att -> 'valid', 'status', v_att ->> 'status',
                             'events_checked', v_att -> 'events_checked',
                             'first_error', v_att -> 'first_error'));

  return v_att;
end;
$$;

revoke all on function public.verify_custody_chain(uuid,uuid) from public, anon;
grant execute on function public.verify_custody_chain(uuid,uuid) to authenticated, service_role;

-- =========================================================================
-- 4) §3 · CAPTURA PRODUCTIVA DE LA INSPECCIÓN HUMANA
--
--    REEMPLAZO HACIA ADELANTE de `attach_custody_evidence` (0038), con la
--    MISMA firma. 0038 NO se modifica: es histórica e inmutable.
--
--    Qué cambia, y sólo eso:
--      · la lista blanca de pares admite (despacho, inspeccion_humana);
--      · para ESA variante —y sólo para ella— rige la política única de §5,
--        el soporte debe ser 'foto', el tenant se DERIVA de la entidad y el
--        instante autoritativo del evento es `now()`: lo que el cliente pase
--        en `p_occurred_at` NO se usa. `p_captured_at` sí se conserva, porque
--        es metadato descriptivo del archivo (EXIF), no el hecho autoritativo.
--      · `actor_id` y `created_by` quedan en `auth.uid()`, no nulos, y la RPC
--        lo verifica antes de devolver.
--    Para los demás pares se preserva EXACTAMENTE el comportamiento de 0038:
--    endurecer flujos ajenos a este expediente sería un cambio no pedido y con
--    consumidores propios (0039).
--
--    El evento queda incorporado a la hash-chain por el trigger de 0036, con
--    `evidence_sha256` = sha256 del archivo: la evidencia queda plegada en la
--    cadena, no meramente adjunta.
-- =========================================================================
create or replace function public.attach_custody_evidence(
  p_packing_unit_id uuid,
  p_shipment_id     uuid,
  p_stage           custody_stage_t,
  p_event_type      custody_event_type_t,
  p_kind            evidence_kind_t,
  p_bucket          text,
  p_storage_path    text,
  p_sha256          text,
  p_file_name       text default null,
  p_mime_type       text default null,
  p_size_bytes      bigint default null,
  p_captured_at     timestamptz default null,
  p_exif            jsonb default null,
  p_geo_lat         double precision default null,
  p_geo_lng         double precision default null,
  p_geo_accuracy_m  numeric default null,
  p_geo_source      text default null,
  p_device_ref      text default null,
  p_notes           text default null,
  p_occurred_at     timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_evi_id   uuid;
  v_pub      text;
  v_exists_redacted boolean;
  v_ret_class text;
  v_ret_until timestamptz;
  v_is_inspection boolean;
  v_scope text;
  v_entity uuid;
  v_client uuid;
  v_actor uuid; v_session uuid; v_role text;
  v_occurred timestamptz;
  v_redacted boolean;
  v_created_by uuid;
  v_actor_id uuid;
begin
  -- FK válidas: packing_unit_id XOR shipment_id (exactamente uno).
  if num_nonnulls(p_packing_unit_id, p_shipment_id) <> 1 then
    raise exception 'indicar exactamente uno de packing_unit_id / shipment_id';
  end if;

  v_is_inspection := (p_stage = 'despacho' and p_event_type = 'inspeccion_humana');
  v_scope  := case when p_packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity := coalesce(p_packing_unit_id, p_shipment_id);

  if v_is_inspection then
    -- §5 · política única: sesión real y acreditada, permiso y rol reales.
    select a.actor_id, a.session_id, a.actor_role into v_actor, v_session, v_role
      from public.assert_custody_access('wms.edit') a;
    -- El gate de rol canónico de 0038 sigue rigiendo también acá.
    if v_role not in ('admin','operaciones','supervisor') then
      raise exception 'no autorizado' using errcode = 'insufficient_privilege';
    end if;
    -- Soporte CANÓNICO de la inspección humana.
    if p_kind <> 'foto' then
      raise exception 'la inspección humana se acredita con foto, no con %', p_kind
        using errcode = 'check_violation';
    end if;
    -- Tenant DERIVADO de la entidad; jamás recibido del caller.
    v_client := public.custody_entity_client_id(v_scope, v_entity);
    if v_client is null then
      raise exception 'entidad sin client_id resuelto: no se registra inspección'
        using errcode = 'check_violation';
    end if;
    perform public.assert_custody_tenant(v_role, v_client);
    -- Instante AUTORITATIVO server-side. `p_occurred_at` se ignora por diseño.
    v_occurred := now();
  else
    -- Comportamiento preservado de 0038 para todo lo demás.
    if public.current_role() is null
       or public.current_role() not in ('admin','operaciones','supervisor') then
      raise exception 'no autorizado' using errcode = 'insufficient_privilege';
    end if;
    v_occurred := coalesce(p_occurred_at, now());
  end if;

  if p_packing_unit_id is not null
     and not exists (select 1 from public.packing_units where id = p_packing_unit_id) then
    raise exception 'packing_unit % inexistente', p_packing_unit_id using errcode = 'no_data_found';
  end if;
  if p_shipment_id is not null
     and not exists (select 1 from public.shipments where id = p_shipment_id) then
    raise exception 'shipment % inexistente', p_shipment_id using errcode = 'no_data_found';
  end if;

  -- stage / event_type permitido y consistente (mismo dominio que el CHECK de
  -- 0036 tras D1: se AGREGA (despacho, inspeccion_humana) y nada más).
  if not (
        (p_stage = 'packing'    and p_event_type = 'foto_packing')
     or (p_stage = 'despacho'   and p_event_type in ('cargado','inspeccion_humana'))
     or (p_stage = 'transporte' and p_event_type = 'en_transito')
     or (p_stage = 'entrega'    and p_event_type in ('foto_entrega','firmado'))
     or (p_stage = 'pod'        and p_event_type = 'pod')
  ) then
    raise exception 'event_type % no es válido para stage %', p_event_type, p_stage;
  end if;

  -- bucket válido.
  if p_bucket not in ('custody-evidence','custody-pii','custody-pod') then
    raise exception 'bucket % inválido', p_bucket;
  end if;

  -- sha256 presente.
  if p_sha256 is null or length(trim(p_sha256)) = 0 then
    raise exception 'sha256 obligatorio';
  end if;

  -- (bucket, path) no debe estar tomado; NO reutilizar el path de una evidencia REDACTADA.
  select redacted into v_exists_redacted from public.custody_evidence
    where storage_bucket = p_bucket and storage_path = p_storage_path;
  if found then
    if v_exists_redacted then
      raise exception 'el path % ya pertenece a una evidencia REDACTADA — no reutilizable', p_storage_path;
    end if;
    raise exception 'ya existe evidencia en %/%', p_bucket, p_storage_path;
  end if;

  -- Retención tiered por bucket (modelo de 0037; deadlines TENTATIVOS · confirmar marco legal).
  v_ret_class := case p_bucket
                   when 'custody-pii' then 'pii'
                   when 'custody-evidence' then 'evidence'
                   when 'custody-pod' then 'pod' end;
  v_ret_until := coalesce(p_captured_at, now()) + case v_ret_class
                   when 'pii'      then interval '1 year'
                   when 'evidence' then interval '2 years'
                   when 'pod'      then interval '10 years' end;

  -- EVENTO: evidence_sha256 = sha256 del archivo → la hash-chain (trigger 0036) liga el archivo.
  insert into public.custody_events
    (packing_unit_id, shipment_id, stage, event_type, actor_id, occurred_at,
     geo_lat, geo_lng, geo_accuracy_m, geo_source, device_ref, notes, evidence_sha256)
  values
    (p_packing_unit_id, p_shipment_id, p_stage, p_event_type, auth.uid(), v_occurred,
     p_geo_lat, p_geo_lng, p_geo_accuracy_m, p_geo_source, p_device_ref, p_notes, p_sha256)
  returning id, public_id into v_event_id, v_pub;

  -- EVIDENCIA (archivo en Storage).
  insert into public.custody_evidence
    (event_id, kind, storage_bucket, storage_path, file_name, mime_type, size_bytes,
     sha256, captured_at, exif, retention_class, retention_until, created_by)
  values
    (v_event_id, p_kind, p_bucket, p_storage_path, p_file_name, p_mime_type, p_size_bytes,
     p_sha256, p_captured_at, p_exif, v_ret_class, v_ret_until, auth.uid())
  returning id into v_evi_id;

  if v_is_inspection then
    -- Se verifica lo que quedó ESCRITO, no lo que se pretendía escribir:
    -- actor y autor no nulos y coherentes, y evidencia no redactada.
    select e.created_by, e.redacted, ev.actor_id
      into v_created_by, v_redacted, v_actor_id
      from public.custody_evidence e
      join public.custody_events ev on ev.id = e.event_id
     where e.id = v_evi_id;
    if v_actor_id is null or v_created_by is null or v_actor_id <> v_created_by
       or v_actor_id <> v_actor then
      raise exception 'inspección sin actor acreditado' using errcode = 'integrity_constraint_violation';
    end if;
    if v_redacted then
      raise exception 'una inspección no puede nacer redactada' using errcode = 'check_violation';
    end if;
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'custody_evidence', v_evi_id, 'custody.attach',
          jsonb_build_object('event_id', v_event_id, 'event_public_id', v_pub,
                             'kind', p_kind, 'bucket', p_bucket, 'path', p_storage_path,
                             'sha256', p_sha256, 'retention_class', v_ret_class));

  return jsonb_build_object('event_id', v_event_id, 'event_public_id', v_pub, 'evidence_id', v_evi_id);
end;
$$;

revoke all on function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz) from public, anon;
grant execute on function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz) to authenticated, service_role;

-- =========================================================================
-- 5) custody_integrity_cases
-- =========================================================================
create sequence if not exists public.custody_integrity_case_short_id_seq start 1;

create table if not exists public.custody_integrity_cases (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.custody_integrity_case_short_id_seq'),
  public_id text not null unique,

  packing_unit_id uuid references public.packing_units(id) on delete restrict,
  shipment_id     uuid references public.shipments(id)     on delete restrict,

  client_id uuid not null references public.clients(id) on delete restrict,
  version   int  not null default 1,

  state        text not null default 'PENDING_EVIDENCE',
  hold_reasons text[] not null default '{}',

  ingress_evidence_id uuid references public.custody_evidence(id) on delete restrict,
  egress_evidence_id  uuid references public.custody_evidence(id) on delete restrict,

  -- Columnas de evaluación. ÚNICO escritor:
  -- `complete_custody_integrity_evaluation` (0223), ejecutable SÓLO por el rol
  -- interno de servidor y SÓLO contra un intento pendiente previamente
  -- autorizado. No hay GRANT de UPDATE para `authenticated` ni para
  -- `service_role` sobre esta tabla.
  provider text, model text, prompt_version text,
  execution_mode text, outcome text, verdict text,
  model_confidence numeric(4,3), provider_error text,

  -- Atestación de cadena. ÚNICO escritor: la misma RPC, a partir de lo que
  -- devuelve `custody_chain_attestation`. Nunca del caller.
  chain_status         text,
  chain_events_checked int,
  chain_head           text,
  chain_attested_at    timestamptz,

  decision_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint custody_integrity_cases_one_scope_chk check (num_nonnulls(packing_unit_id, shipment_id) = 1),
  constraint custody_integrity_cases_state_chk check (state in ('PENDING_EVIDENCE','REVIEW_REQUIRED','RELEASED','QUARANTINED')),
  constraint custody_integrity_cases_version_chk check (version >= 1),

  constraint custody_integrity_cases_exec_mode_chk check (execution_mode is null or execution_mode in ('real','mock','cached')),
  constraint custody_integrity_cases_outcome_chk check (outcome is null or outcome in ('ok','timeout','unavailable','invalid_response','threw','not_executed')),
  constraint custody_integrity_cases_outcome_needs_mode_chk check (outcome is null or execution_mode is not null),
  constraint custody_integrity_cases_verdict_chk check (verdict is null or verdict in ('coincide','diferencias','posible_dano')),
  constraint custody_integrity_cases_verdict_requires_ok_chk check (verdict is null or outcome = 'ok'),
  constraint custody_integrity_cases_confidence_chk check (model_confidence is null or (model_confidence >= 0 and model_confidence <= 1)),
  constraint custody_integrity_cases_confidence_requires_verdict_chk check (model_confidence is null or verdict is not null),
  -- El error del proveedor es texto AJENO: se acota para que no pueda usarse
  -- como vertedero de payloads (imágenes en base64, trazas con secretos).
  constraint custody_integrity_cases_provider_error_len_chk check (provider_error is null or length(provider_error) <= 500),

  constraint custody_integrity_cases_chain_status_chk check (chain_status is null or chain_status in ('verified','invalid','unverifiable')),
  -- Atestación completa, o no hay 'verified'.
  constraint custody_integrity_cases_chain_attestation_chk check (
    chain_status is distinct from 'verified'
    or (coalesce(chain_events_checked, 0) > 0 and chain_head is not null and chain_attested_at is not null)
  ),

  constraint custody_integrity_cases_evidence_distinct_chk check (
    ingress_evidence_id is null or egress_evidence_id is null or ingress_evidence_id <> egress_evidence_id
  ),

  -- 🔴 REGLA HUMANO–IA acreditada RELACIONALMENTE: un estado terminal existe si
  -- y sólo si existe la fila de decisión humana que lo produjo.
  constraint custody_integrity_cases_terminal_needs_decision_chk check (
    (state in ('RELEASED','QUARANTINED')) = (decision_id is not null)
  )
);

create unique index if not exists custody_integrity_cases_evidence_pair_uk
  on public.custody_integrity_cases (ingress_evidence_id, egress_evidence_id)
  where ingress_evidence_id is not null and egress_evidence_id is not null;
create index if not exists custody_integrity_cases_pu_idx     on public.custody_integrity_cases (packing_unit_id);
create index if not exists custody_integrity_cases_ship_idx   on public.custody_integrity_cases (shipment_id);
create index if not exists custody_integrity_cases_client_idx on public.custody_integrity_cases (client_id);

-- =========================================================================
-- 6) §2 · INTENTOS DE EVALUACIÓN — procedencia SERVER-OWNED
--
--    Hallazgo DB-C4: la RPC anterior dejaba que `authenticated` DECLARARA
--    provider, modelo, execution_mode, outcome, verdict y confidence. Un
--    resultado declarado por quien se beneficia de él no acredita nada, y una
--    evaluación así no puede sostener una liberación.
--
--    El flujo pasa a ser de DOS TIEMPOS y durable:
--      1. el usuario autenticado ABRE un intento; el servidor fija actor,
--         sesión, rol, caso, versión, entidad, cliente, evidencias e instante,
--         y el intento nace `pending`;
--      2. el rol interno de servidor lo CIERRA aportando únicamente lo que es
--         un hecho del proveedor. Nada del binding puede cambiar entre 1 y 2.
--
--    La tabla es la que hace durable la autorización: sin fila `pending` no
--    hay finalización posible, y una fila sólo puede cerrarse una vez.
-- =========================================================================
create table if not exists public.custody_integrity_evaluation_attempts (
  id uuid primary key default gen_random_uuid(),

  case_id   uuid not null references public.custody_integrity_cases(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  scope     text not null,
  entity_id uuid not null,
  case_version_at_start int not null,

  ingress_evidence_id uuid references public.custody_evidence(id) on delete restrict,
  egress_evidence_id  uuid references public.custody_evidence(id) on delete restrict,

  -- Procedencia HUMANA del intento, derivada del token en el paso 1.
  requested_by         uuid not null references auth.users(id) on delete restrict,
  requested_session_id uuid not null,
  requested_role       text not null,

  status       text not null default 'pending',
  requested_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  closed_at    timestamptz,
  completed_case_version int,

  -- Resultados del proveedor. SÓLO se escriben dentro de la finalización.
  provider text, model text, prompt_version text,
  execution_mode text, outcome text, verdict text,
  model_confidence numeric(4,3), provider_error text,

  constraint custody_integrity_attempts_scope_chk  check (scope in ('packing_unit','shipment')),
  constraint custody_integrity_attempts_status_chk check (status in ('pending','completed','abandoned')),
  constraint custody_integrity_attempts_version_chk check (case_version_at_start >= 1),
  constraint custody_integrity_attempts_role_chk   check (length(btrim(requested_role)) > 0),
  constraint custody_integrity_attempts_window_chk check (expires_at > requested_at),
  constraint custody_integrity_attempts_closed_chk check ((status = 'pending') = (closed_at is null)),
  constraint custody_integrity_attempts_completed_version_chk check (
    (status = 'completed') = (completed_case_version is not null)
  ),
  constraint custody_integrity_attempts_evidence_distinct_chk check (
    ingress_evidence_id is null or egress_evidence_id is null or ingress_evidence_id <> egress_evidence_id
  ),
  -- Un intento NO cerrado no puede contener resultados: la procedencia de los
  -- resultados es la finalización, y sólo ella.
  constraint custody_integrity_attempts_results_chk check (
    status = 'completed'
    or (provider is null and model is null and prompt_version is null
        and execution_mode is null and outcome is null and verdict is null
        and model_confidence is null and provider_error is null)
  ),
  constraint custody_integrity_attempts_exec_mode_chk check (execution_mode is null or execution_mode in ('real','mock','cached')),
  constraint custody_integrity_attempts_outcome_chk check (outcome is null or outcome in ('ok','timeout','unavailable','invalid_response','threw','not_executed')),
  constraint custody_integrity_attempts_verdict_chk check (verdict is null or verdict in ('coincide','diferencias','posible_dano')),
  constraint custody_integrity_attempts_confidence_chk check (model_confidence is null or (model_confidence >= 0 and model_confidence <= 1)),
  constraint custody_integrity_attempts_provider_error_len_chk check (provider_error is null or length(provider_error) <= 500)
);

-- A lo sumo UN intento pendiente por caso: sin esto, dos intentos abiertos
-- competirían por la misma versión y «cuál vale» sería ambiguo.
create unique index if not exists custody_integrity_attempts_pending_uk
  on public.custody_integrity_evaluation_attempts (case_id)
  where status = 'pending';
create index if not exists custody_integrity_attempts_case_idx  on public.custody_integrity_evaluation_attempts (case_id);
create index if not exists custody_integrity_attempts_actor_idx on public.custody_integrity_evaluation_attempts (requested_by);

-- =========================================================================
-- 7) custody_integrity_decisions — APPEND-ONLY
-- =========================================================================
create table if not exists public.custody_integrity_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.custody_integrity_cases(id) on delete restrict,
  decision text not null,
  actor_user_id    uuid not null references auth.users(id) on delete restrict,
  actor_session_id uuid not null,
  actor_role       text not null,
  client_id        uuid not null references public.clients(id) on delete restrict,
  permission       text not null,
  decided_at   timestamptz not null default now(),
  reason       text not null,
  observations text,
  previous_state text not null,
  new_state      text not null,
  case_version_at_decision int not null,
  chain_head_at_decision   text,
  created_at timestamptz not null default now(),

  constraint custody_integrity_decisions_decision_chk check (decision in ('release','quarantine')),
  constraint custody_integrity_decisions_permission_chk check (permission = 'wms.custody.decide'),
  constraint custody_integrity_decisions_role_chk check (length(btrim(actor_role)) > 0),
  constraint custody_integrity_decisions_reason_chk check (length(btrim(reason)) >= 10),
  constraint custody_integrity_decisions_prev_state_chk check (previous_state = 'REVIEW_REQUIRED'),
  constraint custody_integrity_decisions_new_state_chk check (new_state in ('RELEASED','QUARANTINED')),
  constraint custody_integrity_decisions_coherence_chk check ((decision = 'release') = (new_state = 'RELEASED')),
  constraint custody_integrity_decisions_version_chk check (case_version_at_decision >= 1),
  -- Una liberación sin head de cadena no es defendible.
  constraint custody_integrity_decisions_release_head_chk check (decision <> 'release' or chain_head_at_decision is not null),
  -- §5 · RELEASE ADMIN-ONLY, acreditado en la FILA y no sólo en la RPC: una
  -- liberación registrada por un rol distinto de 'admin' no puede existir.
  constraint custody_integrity_decisions_release_admin_chk check (decision <> 'release' or actor_role = 'admin')
);

create unique index if not exists custody_integrity_decisions_case_uk on public.custody_integrity_decisions (case_id);
create index if not exists custody_integrity_decisions_actor_idx on public.custody_integrity_decisions (actor_user_id);

do $$ begin
  alter table public.custody_integrity_cases
    add constraint custody_integrity_cases_decision_fk
    foreign key (decision_id) references public.custody_integrity_decisions(id)
    deferrable initially deferred;
exception when duplicate_object then null; end $$;

create or replace function public.prevent_custody_integrity_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'tabla append-only: % no está permitido', tg_op using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_custody_integrity_decisions_immutable on public.custody_integrity_decisions;
create trigger trg_custody_integrity_decisions_immutable
  before update or delete on public.custody_integrity_decisions
  for each row execute function public.prevent_custody_integrity_mutation();

drop trigger if exists trg_custody_integrity_decisions_no_truncate on public.custody_integrity_decisions;
create trigger trg_custody_integrity_decisions_no_truncate
  before truncate on public.custody_integrity_decisions
  for each statement execute function public.prevent_custody_integrity_mutation();

-- =========================================================================
-- 8) Evidencias de inspección — puente con integridad referencial
-- =========================================================================
create table if not exists public.custody_integrity_inspection_evidence (
  decision_id uuid not null references public.custody_integrity_decisions(id) on delete restrict,
  evidence_id uuid not null references public.custody_evidence(id) on delete restrict,
  primary key (decision_id, evidence_id)
);

-- §3/§4 · ANTI-REPLAY ESTRUCTURAL: una misma foto de inspección no puede
-- acreditar dos decisiones. La PK compuesta sólo impedía repetirla DENTRO de
-- una decisión; esta unicidad la impide ENTRE decisiones, que es el caso que
-- permitía liberar dos casos con la misma inspección.
create unique index if not exists custody_integrity_inspection_evidence_uk
  on public.custody_integrity_inspection_evidence (evidence_id);

drop trigger if exists trg_custody_integrity_inspection_immutable on public.custody_integrity_inspection_evidence;
create trigger trg_custody_integrity_inspection_immutable
  before update or delete on public.custody_integrity_inspection_evidence
  for each row execute function public.prevent_custody_integrity_mutation();

drop trigger if exists trg_custody_integrity_inspection_no_truncate on public.custody_integrity_inspection_evidence;
create trigger trg_custody_integrity_inspection_no_truncate
  before truncate on public.custody_integrity_inspection_evidence
  for each statement execute function public.prevent_custody_integrity_mutation();

-- =========================================================================
-- 9) Intentos: inmutables salvo el cierre, que ocurre UNA sola vez
-- =========================================================================
create or replace function public.guard_custody_integrity_attempt()
returns trigger language plpgsql as $$
begin
  if tg_op in ('DELETE','TRUNCATE') then
    raise exception 'los intentos de evaluación no se borran: % no está permitido', tg_op
      using errcode = 'restrict_violation';
  end if;

  -- Binding CONGELADO: lo que el servidor fijó al abrir el intento no puede
  -- reescribirse después, que es justamente lo que haría inútil el intento.
  if new.id <> old.id
     or new.case_id <> old.case_id
     or new.client_id <> old.client_id
     or new.scope <> old.scope
     or new.entity_id <> old.entity_id
     or new.case_version_at_start <> old.case_version_at_start
     or new.ingress_evidence_id is distinct from old.ingress_evidence_id
     or new.egress_evidence_id  is distinct from old.egress_evidence_id
     or new.requested_by <> old.requested_by
     or new.requested_session_id <> old.requested_session_id
     or new.requested_role <> old.requested_role
     or new.requested_at <> old.requested_at
     or new.expires_at <> old.expires_at then
    raise exception 'el binding del intento es inmutable'
      using errcode = 'restrict_violation';
  end if;

  -- Transiciones admitidas: pending → completed | abandoned. Nada más.
  if old.status <> 'pending' then
    raise exception 'intento ya cerrado (%): no admite más transiciones', old.status
      using errcode = 'restrict_violation';
  end if;
  if new.status not in ('completed','abandoned') then
    raise exception 'transición de intento inválida: % → %', old.status, new.status
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_custody_integrity_attempt_guard on public.custody_integrity_evaluation_attempts;
create trigger trg_custody_integrity_attempt_guard
  before update or delete on public.custody_integrity_evaluation_attempts
  for each row execute function public.guard_custody_integrity_attempt();

drop trigger if exists trg_custody_integrity_attempt_no_truncate on public.custody_integrity_evaluation_attempts;
create trigger trg_custody_integrity_attempt_no_truncate
  before truncate on public.custody_integrity_evaluation_attempts
  for each statement execute function public.prevent_custody_integrity_mutation();

-- =========================================================================
-- 10) Coherencia en AMBAS direcciones (constraint triggers diferidos)
-- =========================================================================
create or replace function public.assert_custody_integrity_case_coherence()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.custody_integrity_cases;
  d public.custody_integrity_decisions;
  v_entity_client uuid;
  v_scope text;
  v_entity uuid;
begin
  select * into c from public.custody_integrity_cases where id = new.id;
  if not found then return null; end if;

  v_scope  := case when c.packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity := coalesce(c.packing_unit_id, c.shipment_id);

  v_entity_client := public.custody_entity_client_id(v_scope, v_entity);
  if v_entity_client is null or v_entity_client <> c.client_id then
    raise exception 'client_id del caso % no coincide con el de su entidad', c.public_id
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Pertenencia de las evidencias comparadas, vía custody_events.
  if exists (
    select 1
      from public.custody_evidence e
      join public.custody_events ev on ev.id = e.event_id
     where e.id in (c.ingress_evidence_id, c.egress_evidence_id)
       and coalesce(ev.packing_unit_id, ev.shipment_id) is distinct from v_entity
  ) then
    raise exception 'evidencia ajena a la entidad del caso %', c.public_id
      using errcode = 'integrity_constraint_violation';
  end if;

  if c.state in ('RELEASED','QUARANTINED') then
    select * into d from public.custody_integrity_decisions where id = c.decision_id;
    if not found then
      raise exception 'caso % terminal sin fila de decisión', c.public_id using errcode = 'integrity_constraint_violation';
    end if;
    if d.case_id <> c.id or d.new_state <> c.state or d.client_id <> c.client_id then
      raise exception 'decisión incoherente con el caso %', c.public_id using errcode = 'integrity_constraint_violation';
    end if;
    if d.decision = 'release' and not exists (
      select 1 from public.custody_integrity_inspection_evidence i where i.decision_id = d.id
    ) then
      raise exception 'liberación del caso % sin evidencia de inspección', c.public_id
        using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  return null;
end;
$$;

/** Dirección inversa: ninguna decisión puede quedar huérfana ni apuntar a un
    caso que no la referencia. */
create or replace function public.assert_custody_integrity_decision_coherence()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.custody_integrity_cases;
begin
  select * into c from public.custody_integrity_cases where id = new.case_id;
  if not found then
    raise exception 'decisión huérfana: caso inexistente' using errcode = 'integrity_constraint_violation';
  end if;
  if c.decision_id is distinct from new.id then
    raise exception 'decisión no referenciada por su caso' using errcode = 'integrity_constraint_violation';
  end if;
  if c.client_id <> new.client_id or c.state <> new.new_state then
    raise exception 'decisión incoherente con el caso' using errcode = 'integrity_constraint_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_custody_integrity_case_coherence on public.custody_integrity_cases;
create constraint trigger trg_custody_integrity_case_coherence
  after insert or update on public.custody_integrity_cases
  deferrable initially deferred for each row
  execute function public.assert_custody_integrity_case_coherence();

drop trigger if exists trg_custody_integrity_decision_coherence on public.custody_integrity_decisions;
create constraint trigger trg_custody_integrity_decision_coherence
  after insert on public.custody_integrity_decisions
  deferrable initially deferred for each row
  execute function public.assert_custody_integrity_decision_coherence();

-- =========================================================================
-- 11) RLS + privilegios explícitos
--
--    Sólo SELECT para `authenticated` Y para `service_role`: sin
--    INSERT/UPDATE/DELETE, toda escritura pasa obligatoriamente por las RPC
--    SECURITY DEFINER de 0223. Una policy permisiva no alcanza si no hay GRANT.
--
--    §2 · El rol interno de servidor TAMPOCO escribe directamente: su única
--    potestad extra es EJECUTAR la finalización de un intento ya autorizado.
--    Sin esta revocación, el bootstrap de Supabase (ALTER DEFAULT PRIVILEGES
--    ... GRANT ALL ON TABLES TO service_role) le habría dado INSERT/UPDATE
--    directos y el intento sería decorativo.
-- =========================================================================
alter table public.custody_integrity_cases                enable row level security;
alter table public.custody_integrity_decisions            enable row level security;
alter table public.custody_integrity_inspection_evidence  enable row level security;
alter table public.custody_integrity_evaluation_attempts  enable row level security;

revoke all on public.custody_integrity_cases               from public, anon, authenticated, service_role;
revoke all on public.custody_integrity_decisions           from public, anon, authenticated, service_role;
revoke all on public.custody_integrity_inspection_evidence from public, anon, authenticated, service_role;
revoke all on public.custody_integrity_evaluation_attempts from public, anon, authenticated, service_role;

grant select on public.custody_integrity_cases               to authenticated, service_role;
grant select on public.custody_integrity_decisions           to authenticated, service_role;
grant select on public.custody_integrity_inspection_evidence to authenticated, service_role;
grant select on public.custody_integrity_evaluation_attempts to authenticated, service_role;

drop policy if exists "custody_integrity_cases read" on public.custody_integrity_cases;
create policy "custody_integrity_cases read" on public.custody_integrity_cases
  for select to authenticated
  using (
    coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
    or client_id = public.current_client_id()
  );

drop policy if exists "custody_integrity_decisions read" on public.custody_integrity_decisions;
create policy "custody_integrity_decisions read" on public.custody_integrity_decisions
  for select to authenticated
  using (
    coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
    or client_id = public.current_client_id()
  );

drop policy if exists "custody_integrity_attempts read" on public.custody_integrity_evaluation_attempts;
create policy "custody_integrity_attempts read" on public.custody_integrity_evaluation_attempts
  for select to authenticated
  using (
    coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
    or client_id = public.current_client_id()
  );

drop policy if exists "custody_integrity_inspection read" on public.custody_integrity_inspection_evidence;
create policy "custody_integrity_inspection read" on public.custody_integrity_inspection_evidence
  for select to authenticated
  using (exists (
    select 1 from public.custody_integrity_decisions d
     where d.id = decision_id
       and (coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
            or d.client_id = public.current_client_id())
  ));

notify pgrst, 'reload schema';
