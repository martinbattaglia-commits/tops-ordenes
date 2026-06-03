-- =========================================================================
-- GATE 5 · CUSTODY CORE (0036) — Kit de validación con REPORTE EN FILAS.
-- Para el SQL Editor de Supabase. Correr DESPUÉS de aplicar 0036_custody_core.sql.
--
-- Misma mecánica que gate4*/gate4b1/gate4c_*_report.sql:
--   · Cada caso arma su fixture (logistics_order → packing_unit/shipment) e inserta
--     custody_events DIRECTAMENTE (el SQL Editor corre como owner → bypassa el
--     lockdown RLS; los triggers de integridad/inmutabilidad SÍ se aplican a todos).
--   · Todo bajo BEGIN/ROLLBACK + sentinel '__qa_rollback__' (0 footprint; los INSERT
--     se deshacen por savepoint, NO por DELETE → no choca con el append-only).
--   · Mediciones en variables PL/pgSQL (sobreviven al rollback) → filas en _qa_custody_report.
--
-- COBERTURA (10 casos):
--   C1 alta evento + public_id CUST- + row_hash · C2 hash-chain (prev_hash enlaza) ·
--   C3 doble FK CHECK (exclusividad) · C4 inmutabilidad evento (UPDATE/DELETE rechazados) ·
--   C5 stage/event_type CHECK · C6 evidence (sha256 not null · redacción flip · UPDATE/DELETE) ·
--   C7 delivery_pods (POD- · unique shipment) · C8 custody_token en packing_units/shipments ·
--   C9 PostGIS geom generado · C10 hash-chain determinístico (recompute coincide).
--
-- Resultado esperado: todas 'OK'. 'SKIP' = faltó posición/rol para el fixture.
-- ⚠️ Requiere 0024/0026/0030/0033/0035 + 0036 APLICADAS.
-- =========================================================================

drop table if exists _qa_custody_report;
create temp table _qa_custody_report (
  seq serial primary key, caso text, chk text, resultado text, detalle text
);

-- =========================================================================
-- CASO 1 — alta de evento: public_id CUST-, row_hash no nulo, prev_hash null (primero).
-- =========================================================================
do $$
declare
  v_oid uuid; v_pu uuid; v_ev uuid; v_pub text; v_rh text; v_ph text; v_err text := null;
begin
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CUST_C1','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid, 'cerrada') returning id into v_pu;
    insert into public.custody_events (packing_unit_id, stage, event_type, occurred_at)
      values (v_pu, 'packing','foto_packing', now()) returning id, public_id, row_hash, prev_hash into v_ev, v_pub, v_rh, v_ph;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_custody_report(caso,chk,resultado,detalle) values ('Caso 1','ejecución','FALLO', v_err);
  else
    insert into _qa_custody_report(caso,chk,resultado,detalle) values
      ('Caso 1','evento: public_id CUST- · row_hash presente · prev_hash null (primero)',
        case when v_pub like 'CUST-%' and v_rh is not null and v_ph is null then 'OK' else 'FALLO' end,
        format('public_id=%s row_hash=%s prev=%s', v_pub, left(coalesce(v_rh,''),12), coalesce(v_ph,'null')));
  end if;
end $$;

-- =========================================================================
-- CASO 2 — hash-chain: el 2.º evento de la misma entidad enlaza al 1.º.
-- =========================================================================
do $$
declare
  v_oid uuid; v_pu uuid; v_rh1 text; v_rh2 text; v_ph2 text; v_err text := null;
begin
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CUST_C2','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid, 'cerrada') returning id into v_pu;
    insert into public.custody_events (packing_unit_id, stage, event_type) values (v_pu,'packing','foto_packing') returning row_hash into v_rh1;
    insert into public.custody_events (packing_unit_id, stage, event_type) values (v_pu,'packing','foto_packing') returning row_hash, prev_hash into v_rh2, v_ph2;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_custody_report(caso,chk,resultado,detalle) values ('Caso 2','ejecución','FALLO', v_err);
  else
    insert into _qa_custody_report(caso,chk,resultado,detalle) values
      ('Caso 2','2.º evento.prev_hash = 1.º evento.row_hash (cadena enlaza)',
        case when v_ph2 = v_rh1 and v_rh2 <> v_rh1 then 'OK' else 'FALLO' end,
        format('rh1=%s prev2=%s', left(v_rh1,12), left(coalesce(v_ph2,''),12)));
  end if;
end $$;

-- =========================================================================
-- CASO 3 — doble FK CHECK de exclusividad: ambos null / ambos set → rechaza; uno → OK.
-- =========================================================================
do $$
declare
  v_oid uuid; v_pu uuid; v_sh uuid;
  v_both_rej boolean := false; v_none_rej boolean := false; v_one_ok boolean := false; v_err text := null;
begin
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CUST_C3','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid, 'cerrada') returning id into v_pu;
    insert into public.shipments (order_id, status) values (v_oid, 'despachado') returning id into v_sh;

    begin insert into public.custody_events (stage,event_type) values ('packing','foto_packing');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_none_rej := true; end if; end;
    begin insert into public.custody_events (packing_unit_id, shipment_id, stage, event_type) values (v_pu, v_sh, 'packing','foto_packing');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_both_rej := true; end if; end;
    begin insert into public.custody_events (shipment_id, stage, event_type) values (v_sh, 'entrega','foto_entrega'); v_one_ok := true;
      exception when others then if sqlerrm<>'__qa_rollback__' then v_one_ok := false; end if; end;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_custody_report(caso,chk,resultado,detalle) values ('Caso 3','ejecución','FALLO', v_err);
  else
    insert into _qa_custody_report(caso,chk,resultado,detalle) values
      ('Caso 3','exclusividad doble FK: ambos null/set rechazados · uno OK',
        case when v_none_rej and v_both_rej and v_one_ok then 'OK' else 'FALLO' end,
        format('none_rej=%s both_rej=%s one_ok=%s', v_none_rej, v_both_rej, v_one_ok));
  end if;
end $$;

-- =========================================================================
-- CASO 4 — inmutabilidad: UPDATE y DELETE sobre custody_events rechazados.
-- =========================================================================
do $$
declare
  v_oid uuid; v_pu uuid; v_ev uuid; v_upd boolean := false; v_del boolean := false; v_err text := null;
begin
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CUST_C4','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid, 'cerrada') returning id into v_pu;
    insert into public.custody_events (packing_unit_id, stage, event_type) values (v_pu,'packing','foto_packing') returning id into v_ev;
    begin update public.custody_events set notes='x' where id=v_ev; exception when others then if sqlerrm<>'__qa_rollback__' then v_upd := true; end if; end;
    begin delete from public.custody_events where id=v_ev; exception when others then if sqlerrm<>'__qa_rollback__' then v_del := true; end if; end;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_custody_report(caso,chk,resultado,detalle) values ('Caso 4','ejecución','FALLO', v_err);
  else
    insert into _qa_custody_report(caso,chk,resultado,detalle) values
      ('Caso 4','custody_events append-only: UPDATE y DELETE rechazados',
        case when v_upd and v_del then 'OK' else 'FALLO' end, format('update_blocked=%s delete_blocked=%s', v_upd, v_del));
  end if;
end $$;

-- =========================================================================
-- CASO 5 — CHECK stage/event_type: combinación inválida rechazada.
-- =========================================================================
do $$
declare
  v_oid uuid; v_pu uuid; v_rej boolean := false; v_err text := null;
begin
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CUST_C5','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid, 'cerrada') returning id into v_pu;
    begin insert into public.custody_events (packing_unit_id, stage, event_type) values (v_pu,'packing','foto_entrega'); -- inválida
      exception when others then if sqlerrm<>'__qa_rollback__' then v_rej := true; end if; end;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_custody_report(caso,chk,resultado,detalle) values ('Caso 5','ejecución','FALLO', v_err);
  else
    insert into _qa_custody_report(caso,chk,resultado,detalle) values
      ('Caso 5','CHECK stage/event_type: packing+foto_entrega rechazado',
        case when v_rej then 'OK' else 'FALLO' end, format('rejected=%s', v_rej));
  end if;
end $$;

-- =========================================================================
-- CASO 6 — custody_evidence: sha256 not null · redacción flip permitida · UPDATE/DELETE.
-- =========================================================================
do $$
declare
  v_oid uuid; v_sh uuid; v_ev uuid; v_evi uuid;
  v_sha_rej boolean := false; v_redact_ok boolean := false; v_upd_rej boolean := false; v_del_rej boolean := false; v_err text := null;
begin
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CUST_C6','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid, 'despachado') returning id into v_sh;
    insert into public.custody_events (shipment_id, stage, event_type) values (v_sh,'entrega','firmado') returning id into v_ev;

    -- sha256 obligatorio
    begin insert into public.custody_evidence (event_id, kind, storage_bucket, storage_path) values (v_ev,'firma','custody-pii','custody-pii/x/y/z.png');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_sha_rej := true; end if; end;

    -- alta válida
    insert into public.custody_evidence (event_id, kind, storage_bucket, storage_path, sha256)
      values (v_ev,'firma','custody-pii','custody-pii/sh/'||v_sh::text||'/entrega/f.png','abc123') returning id into v_evi;

    -- redacción flip (false→true) permitida
    begin update public.custody_evidence set redacted=true, redacted_at=now() where id=v_evi; v_redact_ok := true;
      exception when others then if sqlerrm<>'__qa_rollback__' then v_redact_ok := false; end if; end;

    -- UPDATE de otra columna rechazado
    begin update public.custody_evidence set file_name='otro' where id=v_evi;
      exception when others then if sqlerrm<>'__qa_rollback__' then v_upd_rej := true; end if; end;

    -- DELETE rechazado
    begin delete from public.custody_evidence where id=v_evi;
      exception when others then if sqlerrm<>'__qa_rollback__' then v_del_rej := true; end if; end;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_custody_report(caso,chk,resultado,detalle) values ('Caso 6','ejecución','FALLO', v_err);
  else
    insert into _qa_custody_report(caso,chk,resultado,detalle) values
      ('Caso 6','evidence: sha256 obligatorio · redacción flip OK · UPDATE/DELETE rechazados',
        case when v_sha_rej and v_redact_ok and v_upd_rej and v_del_rej then 'OK' else 'FALLO' end,
        format('sha_rej=%s redact_ok=%s upd_rej=%s del_rej=%s', v_sha_rej, v_redact_ok, v_upd_rej, v_del_rej));
  end if;
end $$;

-- =========================================================================
-- CASO 7 — delivery_pods: public_id POD- · unique(shipment_id).
-- =========================================================================
do $$
declare
  v_oid uuid; v_sh uuid; v_pod uuid; v_pub text; v_dup_rej boolean := false; v_err text := null;
begin
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CUST_C7','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid, 'despachado') returning id into v_sh;
    insert into public.delivery_pods (shipment_id, receiver_name) values (v_sh, 'Juan Receptor') returning id, public_id into v_pod, v_pub;
    begin insert into public.delivery_pods (shipment_id, receiver_name) values (v_sh, 'Otro');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_dup_rej := true; end if; end;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_custody_report(caso,chk,resultado,detalle) values ('Caso 7','ejecución','FALLO', v_err);
  else
    insert into _qa_custody_report(caso,chk,resultado,detalle) values
      ('Caso 7','POD: public_id POD- · 2.º POD del mismo shipment rechazado',
        case when v_pub like 'POD-%' and v_dup_rej then 'OK' else 'FALLO' end,
        format('public_id=%s dup_rej=%s', v_pub, v_dup_rej));
  end if;
end $$;

-- =========================================================================
-- CASO 8 — custody_token: presente, único y no nulo en packing_units / shipments.
-- =========================================================================
do $$
declare
  v_oid uuid; v_pu uuid; v_sh uuid; v_tpu uuid; v_tsh uuid; v_err text := null;
begin
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CUST_C8','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid, 'cerrada') returning id into v_pu;
    insert into public.shipments (order_id, status) values (v_oid, 'despachado') returning id into v_sh;
    select custody_token into v_tpu from public.packing_units where id=v_pu;
    select custody_token into v_tsh from public.shipments where id=v_sh;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_custody_report(caso,chk,resultado,detalle) values ('Caso 8','ejecución','FALLO', v_err);
  else
    insert into _qa_custody_report(caso,chk,resultado,detalle) values
      ('Caso 8','custody_token autogenerado en packing_unit y shipment (distintos)',
        case when v_tpu is not null and v_tsh is not null and v_tpu <> v_tsh then 'OK' else 'FALLO' end,
        format('pu=%s sh=%s', left(v_tpu::text,8), left(v_tsh::text,8)));
  end if;
end $$;

-- =========================================================================
-- CASO 9 — PostGIS: geom generado de lat/lng (SRID 4326, ST_X = lng, ST_Y = lat).
-- =========================================================================
do $$
declare
  v_oid uuid; v_pu uuid; v_ev uuid; v_x double precision; v_y double precision; v_srid int; v_err text := null;
begin
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CUST_C9','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid, 'cerrada') returning id into v_pu;
    insert into public.custody_events (packing_unit_id, stage, event_type, geo_lat, geo_lng, geo_source)
      values (v_pu,'packing','foto_packing', -34.603700, -58.381600, 'device') returning id into v_ev;
    select extensions.ST_X(geom), extensions.ST_Y(geom), extensions.ST_SRID(geom) into v_x, v_y, v_srid
      from public.custody_events where id=v_ev;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_custody_report(caso,chk,resultado,detalle) values ('Caso 9','ejecución','FALLO', v_err);
  else
    insert into _qa_custody_report(caso,chk,resultado,detalle) values
      ('Caso 9','geom generado: ST_X=lng · ST_Y=lat · SRID 4326',
        case when round(v_x::numeric,4) = -58.3816 and round(v_y::numeric,4) = -34.6037 and v_srid = 4326 then 'OK' else 'FALLO' end,
        format('x=%s y=%s srid=%s', v_x, v_y, v_srid));
  end if;
end $$;

-- =========================================================================
-- CASO 10 — hash-chain determinístico: recompute manual coincide con row_hash.
-- =========================================================================
do $$
declare
  v_oid uuid; v_pu uuid; v_ev uuid;
  v_rh text; v_canon text; v_recompute text;
  r record; v_err text := null;
begin
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CUST_C10','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid, 'cerrada') returning id into v_pu;
    insert into public.custody_events (packing_unit_id, stage, event_type, notes)
      values (v_pu,'packing','foto_packing','nota-x') returning id into v_ev;
    select * into r from public.custody_events where id=v_ev;
    v_canon := concat_ws('|',
      coalesce(r.packing_unit_id::text,''), coalesce(r.shipment_id::text,''),
      r.stage::text, r.event_type::text, coalesce(r.actor_id::text,''),
      to_char(r.occurred_at at time zone 'UTC','YYYYMMDD"T"HH24MISS.US'),
      coalesce(r.geo_lat::text,''), coalesce(r.geo_lng::text,''),
      coalesce(r.evidence_sha256,''), coalesce(r.notes,''));
    v_recompute := encode(sha256(convert_to(coalesce(r.prev_hash,'') || '||' || v_canon,'UTF8')),'hex');
    v_rh := r.row_hash;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_custody_report(caso,chk,resultado,detalle) values ('Caso 10','ejecución','FALLO', v_err);
  else
    insert into _qa_custody_report(caso,chk,resultado,detalle) values
      ('Caso 10','row_hash determinístico: recompute manual coincide',
        case when v_rh = v_recompute then 'OK' else 'FALLO' end,
        format('match=%s', (v_rh = v_recompute)));
  end if;
end $$;

-- =========================================================================
-- REPORTE FINAL — FALLO/SKIP primero, luego OK. Esperado: todo 'OK'.
-- =========================================================================
select seq, caso, chk, resultado, detalle
from _qa_custody_report
order by (resultado = 'OK'), seq;
