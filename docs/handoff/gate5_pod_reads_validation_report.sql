-- =========================================================================
-- GATE 5.3 · CUSTODY POD + READS (0039) — Kit de validación con REPORTE EN FILAS.
-- Para el SQL Editor de Supabase. Correr DESPUÉS de aplicar 0039_custody_pod_reads.sql.
--
-- Mecánica: fixture + RPC bajo BEGIN/ROLLBACK + sentinel '__qa_rollback__' (0 footprint).
--   Mediciones en variables → _qa_podreads_report. Owner bypassa RLS para el fixture.
--
-- COBERTURA (12 casos): 1 POD generado · 2 POD duplicado · 3 timeline correcto ·
--   4 timeline vacío · 5 token packing · 6 token shipment · 7 resumen shipment ·
--   8 PII no expuesta · 9 seguridad de lectura · 10 auditoría · 11 integridad timeline ·
--   12 rollback limpio.
--
-- Resultado esperado: todas 'OK'. 'SKIP' = faltó rol. ⚠️ Requiere 0036+0037+0038+0039 APLICADAS.
-- =========================================================================

drop table if exists _qa_podreads_report;
create temp table _qa_podreads_report (
  seq serial primary key, caso text, chk text, resultado text, detalle text
);

-- =========================================================================
-- CASO 1 — POD generado: delivery_pods POD- + audit custody.pod_generate.
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_sh uuid; v_g jsonb; v_pub text; v_exists boolean; v_audit int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 1','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C1','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    select public.generate_delivery_pod(v_sh, 'Juan Receptor') into v_g;
    v_pub := v_g->>'public_id';
    select exists(select 1 from public.delivery_pods where shipment_id=v_sh) into v_exists;
    select count(*) into v_audit from public.audit_log where action='custody.pod_generate' and entity_id=(v_g->>'pod_id')::uuid;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 1','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 1','POD generado: public_id POD- · fila + audit',
      case when v_pub like 'POD-%' and v_exists and v_audit=1 then 'OK' else 'FALLO' end, format('pub=%s audit=%s', v_pub, v_audit));
  end if;
end $$;

-- =========================================================================
-- CASO 2 — POD duplicado rechazado.
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_sh uuid; v_dup boolean := false; v_badstate boolean := false; v_oid2 uuid; v_sh2 uuid; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 2','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C2','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    perform public.generate_delivery_pod(v_sh, 'R1');
    begin perform public.generate_delivery_pod(v_sh, 'R2');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_dup := true; end if; end;
    -- shipment no despachado/entregado → rechazado
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C2b','preparado') returning id into v_oid2;
    insert into public.shipments (order_id, status) values (v_oid2,'anulado') returning id into v_sh2;
    begin perform public.generate_delivery_pod(v_sh2, 'R3');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_badstate := true; end if; end;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 2','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 2','POD duplicado rechazado · shipment no despachable rechazado',
      case when v_dup and v_badstate then 'OK' else 'FALLO' end, format('dup=%s badstate=%s', v_dup, v_badstate));
  end if;
end $$;

-- =========================================================================
-- CASO 3 — timeline correcto: 2 eventos + POD, ordenado, último nodo type=pod.
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_sh uuid; v_tl jsonb; v_n int; v_last text; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 3','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C3','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    perform public.register_custody_event(null, v_sh, 'despacho','cargado');
    perform public.attach_custody_evidence(null, v_sh, 'entrega','foto_entrega','foto','custody-evidence','custody-evidence/'||v_sh::text||'/e.jpg','s1');
    perform public.generate_delivery_pod(v_sh, 'Juan');
    select public.get_custody_timeline(null, v_sh) into v_tl;
    v_n := jsonb_array_length(v_tl->'nodes');
    v_last := (v_tl->'nodes'->(v_n-1)->>'type');
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 3','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 3','timeline: 3 nodos (2 eventos + POD) · último type=pod',
      case when v_n=3 and v_last='pod' then 'OK' else 'FALLO' end, format('nodos=%s last=%s', v_n, v_last));
  end if;
end $$;

-- =========================================================================
-- CASO 4 — timeline vacío: shipment sin eventos → nodes [].
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_sh uuid; v_tl jsonb; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 4','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C4','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    select public.get_custody_timeline(null, v_sh) into v_tl;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 4','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 4','timeline vacío: nodes []',
      case when jsonb_array_length(v_tl->'nodes')=0 then 'OK' else 'FALLO' end, format('nodos=%s', jsonb_array_length(v_tl->'nodes')));
  end if;
end $$;

-- =========================================================================
-- CASO 5 — resolución por token packing_unit → scope packing_unit · BLT-.
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_pu uuid; v_tok uuid; v_res jsonb; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C5','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid,'cerrada') returning id into v_pu;
    select custody_token into v_tok from public.packing_units where id=v_pu;
    select public.get_custody_by_token(v_tok) into v_res;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 5','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 5','token packing → scope packing_unit · public_id BLT-',
      case when v_res->>'scope'='packing_unit' and (v_res->>'public_id') like 'BLT-%' then 'OK' else 'FALLO' end,
      format('scope=%s pub=%s', v_res->>'scope', v_res->>'public_id'));
  end if;
end $$;

-- =========================================================================
-- CASO 6 — resolución por token shipment → scope shipment · DSP- · pod_present.
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_sh uuid; v_tok uuid; v_res jsonb; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C6','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'entregado') returning id into v_sh;
    perform public.generate_delivery_pod(v_sh, 'Juan');
    select custody_token into v_tok from public.shipments where id=v_sh;
    select public.get_custody_by_token(v_tok) into v_res;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 6','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 6','token shipment → scope shipment · DSP- · pod_present',
      case when v_res->>'scope'='shipment' and (v_res->>'public_id') like 'DSP-%' and (v_res->>'pod_present')::boolean then 'OK' else 'FALLO' end,
      format('scope=%s pub=%s pod=%s', v_res->>'scope', v_res->>'public_id', v_res->>'pod_present'));
  end if;
end $$;

-- =========================================================================
-- CASO 7 — resumen shipment: events/evidences/pod/chain_valid/last_activity.
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_sh uuid; v_s jsonb; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 7','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C7','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    perform public.register_custody_event(null, v_sh, 'despacho','cargado');
    perform public.attach_custody_evidence(null, v_sh, 'entrega','foto_entrega','foto','custody-evidence','custody-evidence/'||v_sh::text||'/s.jpg','s1');
    perform public.generate_delivery_pod(v_sh, 'Juan');
    select public.get_shipment_custody_summary(v_sh) into v_s;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 7','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 7','resumen: 2 eventos · 1 evidencia · pod_present · chain_valid · last_activity',
      case when (v_s->>'events')::int=2 and (v_s->>'evidences')::int=1 and (v_s->>'pod_present')::boolean
                and (v_s->>'chain_valid')::boolean and (v_s->>'last_activity') is not null then 'OK' else 'FALLO' end,
      format('ev=%s evi=%s pod=%s chain=%s', v_s->>'events', v_s->>'evidences', v_s->>'pod_present', v_s->>'chain_valid'));
  end if;
end $$;

-- =========================================================================
-- CASO 8 — PII no expuesta en get_custody_by_token (sin receiver_name/document).
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_sh uuid; v_tok uuid; v_res jsonb; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 8','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C8','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'entregado') returning id into v_sh;
    perform public.generate_delivery_pod(v_sh, 'NombreSecretoX', 'DOC-99999999');
    select custody_token into v_tok from public.shipments where id=v_sh;
    select public.get_custody_by_token(v_tok) into v_res;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 8','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 8','by_token NO expone PII (sin nombre/documento del receptor)',
      case when not (v_res ? 'receiver_name') and not (v_res ? 'receiver_document')
                and position('NombreSecretoX' in v_res::text) = 0
                and position('DOC-99999999' in v_res::text) = 0 then 'OK' else 'FALLO' end,
      format('keys=%s', (select string_agg(k,',') from jsonb_object_keys(v_res) k)));
  end if;
end $$;

-- =========================================================================
-- CASO 9 — seguridad de lectura: sin rol → timeline y by_token rechazados.
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_sh uuid; v_tok uuid; v_tl boolean := false; v_tk boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 9','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C9','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    select custody_token into v_tok from public.shipments where id=v_sh;
    perform set_config('request.jwt.claims', '', true);  -- sin rol
    begin perform public.get_custody_timeline(null, v_sh);
      exception when insufficient_privilege then v_tl := true; when others then if sqlerrm<>'__qa_rollback__' then v_tl := true; end if; end;
    begin perform public.get_custody_by_token(v_tok);
      exception when insufficient_privilege then v_tk := true; when others then if sqlerrm<>'__qa_rollback__' then v_tk := true; end if; end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 9','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 9','seguridad: timeline y by_token sin rol → rechazados',
      case when v_tl and v_tk then 'OK' else 'FALLO' end, format('timeline=%s token=%s', v_tl, v_tk));
  end if;
end $$;

-- =========================================================================
-- CASO 10 — auditoría: custody.pod_generate + custody.token_resolve registrados.
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_sh uuid; v_tok uuid; v_g jsonb; v_apod int; v_atok int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 10','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C10','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    select public.generate_delivery_pod(v_sh, 'Juan') into v_g;
    select custody_token into v_tok from public.shipments where id=v_sh;
    perform public.get_custody_by_token(v_tok);
    select count(*) into v_apod from public.audit_log where action='custody.pod_generate' and entity_id=(v_g->>'pod_id')::uuid;
    select count(*) into v_atok from public.audit_log where action='custody.token_resolve' and entity_id=v_sh;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 10','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 10','auditoría: pod_generate + token_resolve registrados',
      case when v_apod=1 and v_atok=1 then 'OK' else 'FALLO' end, format('pod=%s token=%s', v_apod, v_atok));
  end if;
end $$;

-- =========================================================================
-- CASO 11 — integridad timeline: resumen reporta chain_valid=true para cadena real.
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid; v_sh uuid; v_s jsonb; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 11','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PODR_C11','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    perform public.register_custody_event(null, v_sh, 'despacho','cargado');
    perform public.register_custody_event(null, v_sh, 'transporte','en_transito');
    perform public.attach_custody_evidence(null, v_sh, 'entrega','foto_entrega','foto','custody-evidence','custody-evidence/'||v_sh::text||'/i.jpg','si');
    select public.get_shipment_custody_summary(v_sh) into v_s;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_podreads_report(caso,chk,resultado,detalle) values ('Caso 11','ejecución','FALLO', v_err);
  else insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 11','integridad: chain_valid=true · 3 eventos verificados',
      case when (v_s->>'chain_valid')::boolean and (v_s->>'chain_events_checked')::int=3 then 'OK' else 'FALLO' end,
      format('valid=%s checked=%s', v_s->>'chain_valid', v_s->>'chain_events_checked'));
  end if;
end $$;

-- =========================================================================
-- CASO 12 — rollback limpio: ningún fixture persiste (0 footprint).
-- =========================================================================
do $$
declare v_pod int; v_evt int; v_ord int;
begin
  -- Fuera de cualquier sub-bloque: los casos anteriores hicieron ROLLBACK por savepoint.
  select count(*) into v_ord from public.logistics_orders where client_name like 'TEST_QA_PODR_%';
  select count(*) into v_pod from public.delivery_pods dp
    join public.shipments s on s.id=dp.shipment_id
    join public.logistics_orders o on o.id=s.order_id where o.client_name like 'TEST_QA_PODR_%';
  select count(*) into v_evt from public.custody_events e
    where e.shipment_id in (select s.id from public.shipments s join public.logistics_orders o on o.id=s.order_id where o.client_name like 'TEST_QA_PODR_%');
  insert into _qa_podreads_report(caso,chk,resultado,detalle) values
    ('Caso 12','rollback limpio: 0 footprint (orders/pods/eventos de prueba = 0)',
      case when v_ord=0 and v_pod=0 and v_evt=0 then 'OK' else 'FALLO' end,
      format('orders=%s pods=%s eventos=%s', v_ord, v_pod, v_evt));
end $$;

-- =========================================================================
-- REPORTE FINAL — FALLO/SKIP primero, luego OK. Esperado: todo 'OK'.
-- =========================================================================
select seq, caso, chk, resultado, detalle
from _qa_podreads_report
order by (resultado = 'OK'), seq;
