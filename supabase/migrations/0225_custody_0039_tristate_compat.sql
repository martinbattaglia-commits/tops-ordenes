-- =========================================================================
-- 0225 · CUSTODIA IA — COMPATIBILIDAD TRI-STATE CON 0039 (W22-TER-B · M5)
--
-- Depende de: 0036 (custody_events / packing_units.shipment_id) · 0038 ·
--             0039 (las cuatro RPC de lectura) · 0222 (custody_chain_attestation)
--
-- FORWARD-ONLY. No edita 0039 ni ninguna migración histórica aplicada; 0221,
-- 0222, 0223 y 0224 quedan byte-invariantes. Redefine EXCLUSIVAMENTE
-- `get_shipment_custody_summary`, conservando su firma pública
-- `(p_shipment_id uuid) returns jsonb` y todas sus claves.
--
-- ─── DEFECTO REMEDIADO (DB-C4 · W22 · M-5) ────────────────────────────────
--
-- 0039 resolvía la integridad del shipment con
-- `verify_custody_chain(null, p_shipment_id)`, que atesta ÚNICAMENTE la cadena
-- DIRECTA del shipment. En el modelo real de 0036 la evidencia vive en los
-- eventos de las PACKING UNITS: un despacho perfectamente íntegro cuyos eventos
-- cuelgan de sus bultos no tiene ningún evento con `shipment_id`, la atestación
-- devolvía `events_checked = 0`, y desde el DB-C4 —que corrigió que una cadena
-- vacía no es válida— eso se traducía en `chain_valid = false`.
--
-- El resultado impreso era «CADENA INVÁLIDA» en el POD y «ROTA» en la UI para
-- un envío que nadie había roto. Acusar de adulteración a una cadena que
-- simplemente no fue interrogada donde vive su evidencia es, en un producto de
-- custodia, un defecto más caro que el falso negativo inverso.
--
-- ─── POR QUÉ TRES ESTADOS Y NO UN BOOLEANO ────────────────────────────────
--
-- `verified` / `invalid` / `unverifiable` no son un matiz de presentación: son
-- tres hechos distintos. «La cadena está rota» y «no hay evidencia suficiente
-- para pronunciarse» exigen acciones opuestas —investigar un fraude o completar
-- la captura— y colapsarlos en un booleano obliga a inventar uno de los dos.
-- `chain_valid` se conserva por compatibilidad, y vale `true` EXCLUSIVAMENTE
-- cuando `chain_status = 'verified'`: fail-closed, sin excepciones.
--
-- ─── REGLA DE AGREGACIÓN ──────────────────────────────────────────────────
--
-- Cadenas REQUERIDAS de un shipment:
--   · la de CADA packing unit que le pertenece;
--   · la propia del shipment SÓLO si tiene eventos propios.
--
-- Resolución, con prioridad `invalid > unverifiable > verified`:
--   · ninguna cadena requerida            → `unverifiable`
--   · alguna requerida inválida           → `invalid`
--   · alguna vacía / no atestable         → `unverifiable`
--   · todas verificables y válidas        → `verified`
--
-- Una cadena vacía NUNCA se presenta como válida.
-- =========================================================================

-- =========================================================================
-- 1) Helper INTERNO de agregación
--
--    NO es SECURITY DEFINER: no lo necesita. Se invoca desde
--    `get_shipment_custody_summary`, que sí lo es, de modo que corre con los
--    privilegios del dueño y puede llamar a `custody_chain_attestation` —cuyo
--    EXECUTE está revocado para los roles de API desde 0222—. Concederle
--    privilegios propios sería ampliar la superficie sin ninguna necesidad.
--
--    `custody_chain_attestation` y no `verify_custody_chain` a propósito: la
--    segunda AUDITA en cada llamada, y auditar una vez por bulto convertiría un
--    resumen en N asientos. La auditoría del resumen es una sola y agregada,
--    y la escribe el llamador.
-- =========================================================================
create or replace function public.custody_shipment_chain_rollup(p_shipment_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  r record;
  v_att jsonb;
  v_status text;
  v_required int := 0;
  v_invalid int := 0;
  v_unverifiable int := 0;
  v_verified int := 0;
  v_events int := 0;
  v_final text;
begin
  if p_shipment_id is null then
    return jsonb_build_object(
      'chain_status', 'unverifiable',
      'chain_valid', false,
      'chain_events_checked', 0,
      'chains_required', 0,
      'chains_verified', 0,
      'chains_invalid', 0,
      'chains_unverifiable', 0
    );
  end if;

  for r in
    -- Cada bulto del despacho: su cadena SIEMPRE es requerida, incluso vacía.
    -- Un bulto sin eventos es precisamente el caso que vuelve inverificable el
    -- conjunto, y omitirlo sería declarar íntegro lo que no se miró.
    select 'packing_unit'::text as scope, pu.id as entity_id
      from public.packing_units pu
     where pu.shipment_id = p_shipment_id
    union all
    -- La cadena directa del shipment sólo cuenta si existe: exigirla siempre
    -- volvería inverificable a todo despacho que registre en sus bultos, que es
    -- justamente el modelo canónico de 0036.
    select 'shipment'::text, p_shipment_id
     where exists (
       select 1 from public.custody_events e where e.shipment_id = p_shipment_id
     )
  loop
    v_required := v_required + 1;
    v_att := public.custody_chain_attestation(r.scope, r.entity_id);
    v_status := v_att ->> 'status';
    -- Suma HONESTA: eventos efectivamente recorridos por la atestación, también
    -- en las cadenas que terminaron en error.
    v_events := v_events + coalesce((v_att ->> 'events_checked')::int, 0);

    if v_status = 'invalid' then
      v_invalid := v_invalid + 1;
    elsif v_status = 'verified' then
      v_verified := v_verified + 1;
    else
      v_unverifiable := v_unverifiable + 1;
    end if;
  end loop;

  if v_required = 0 then
    v_final := 'unverifiable';
  elsif v_invalid > 0 then
    v_final := 'invalid';
  elsif v_unverifiable > 0 then
    v_final := 'unverifiable';
  else
    v_final := 'verified';
  end if;

  return jsonb_build_object(
    'chain_status', v_final,
    -- Compatibilidad legacy: `true` SÓLO con 'verified'.
    'chain_valid', v_final = 'verified',
    'chain_events_checked', v_events,
    'chains_required', v_required,
    'chains_verified', v_verified,
    'chains_invalid', v_invalid,
    'chains_unverifiable', v_unverifiable
  );
end;
$$;

-- Helper interno: no es una RPC pública y no se expone a NINGÚN rol de API.
-- Se revoca también a `service_role`: nadie lo invoca directamente —sólo lo
-- llama `get_shipment_custody_summary`, que es SECURITY DEFINER y corre como el
-- dueño— así que conservarle el EXECUTE que conceden los default privileges de
-- la plataforma sería superficie sin uso.
revoke all on function public.custody_shipment_chain_rollup(uuid)
  from public, anon, authenticated, service_role;

comment on function public.custody_shipment_chain_rollup(uuid) is
  'W22-TER-B/M5: agrega el estado de cadena de un shipment sobre TODAS sus cadenas requeridas (packing units + cadena propia si tiene eventos). Prioridad invalid > unverifiable > verified. Helper interno, sin EXECUTE para roles de API.';

-- =========================================================================
-- 2) `get_shipment_custody_summary` — MISMA firma, mismas claves, más la
--    verdad que antes no cabía en un booleano.
--
--    Se conserva íntegro el gate de rol canónico de 0039 y el conteo de
--    eventos/evidencias, que ya contemplaban los bultos del despacho. Lo único
--    que cambia es de dónde sale el veredicto de integridad, y que ahora se
--    publica `chain_status`.
-- =========================================================================
create or replace function public.get_shipment_custody_summary(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_events int;
  v_evidences int;
  v_pod boolean;
  v_roll jsonb;
  v_last timestamptz;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select exists(select 1 from public.shipments where id = p_shipment_id) into v_exists;
  if not v_exists then
    raise exception 'shipment % inexistente', p_shipment_id using errcode = 'no_data_found';
  end if;

  -- Eventos (del shipment + de sus packing_units) y evidencias ligadas.
  select count(*) into v_events
    from public.custody_events e
    where e.shipment_id = p_shipment_id
       or e.packing_unit_id in (select pu.id from public.packing_units pu where pu.shipment_id = p_shipment_id);

  select count(*) into v_evidences
    from public.custody_evidence ce
    join public.custody_events e on e.id = ce.event_id
    where e.shipment_id = p_shipment_id
       or e.packing_unit_id in (select pu.id from public.packing_units pu where pu.shipment_id = p_shipment_id);

  select exists(select 1 from public.delivery_pods where shipment_id = p_shipment_id) into v_pod;

  -- M5 · integridad agregada sobre TODAS las cadenas requeridas.
  v_roll := public.custody_shipment_chain_rollup(p_shipment_id);

  -- Última actividad (evento más reciente o firma del POD).
  select greatest(
           (select max(occurred_at) from public.custody_events
              where shipment_id = p_shipment_id
                 or packing_unit_id in (select pu.id from public.packing_units pu where pu.shipment_id = p_shipment_id)),
           (select max(signed_at) from public.delivery_pods where shipment_id = p_shipment_id)
         ) into v_last;

  -- UNA sola auditoría, agregada. Sin PII: sólo el veredicto y los conteos.
  -- No se audita por hijo: el resumen es un acto de lectura, no N actos.
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'shipment', p_shipment_id, 'custody.shipment_summary',
          jsonb_build_object(
            'chain_status', v_roll ->> 'chain_status',
            'chain_valid', (v_roll ->> 'chain_valid')::boolean,
            'chain_events_checked', (v_roll ->> 'chain_events_checked')::int,
            'chains_required', (v_roll ->> 'chains_required')::int,
            'chains_invalid', (v_roll ->> 'chains_invalid')::int,
            'chains_unverifiable', (v_roll ->> 'chains_unverifiable')::int,
            'events', v_events,
            'evidences', v_evidences));

  return jsonb_build_object(
    'shipment_id', p_shipment_id,
    'events', v_events,
    'evidences', v_evidences,
    'pod_present', v_pod,
    -- M5 · el hecho nuevo.
    'chain_status', v_roll ->> 'chain_status',
    -- Compatibilidad 0039: booleano legacy, true SÓLO si 'verified'.
    'chain_valid', (v_roll ->> 'chain_valid')::boolean,
    'chain_events_checked', (v_roll ->> 'chain_events_checked')::int,
    'last_activity', v_last
  );
end;
$$;

-- Grants IDÉNTICOS a los de 0039: la superficie pública no cambia.
revoke all on function public.get_shipment_custody_summary(uuid) from public, anon;
grant execute on function public.get_shipment_custody_summary(uuid) to authenticated, service_role;

comment on function public.get_shipment_custody_summary(uuid) is
  'W22-TER-B/M5: resumen de custodia de un despacho con estado de cadena TRI-STATE (verified/invalid/unverifiable) agregado sobre sus packing units. `chain_valid` se conserva como compatibilidad legacy y es true sólo con verified.';

notify pgrst, 'reload schema';
