-- =========================================================================
-- GATE 5.1 · CUSTODY STORAGE (0037) — Kit de validación con REPORTE EN FILAS.
-- Para el SQL Editor de Supabase. Correr DESPUÉS de aplicar 0037_custody_storage.sql.
--
-- Mecánica:
--   · Los buckets y policies son objetos PERSISTENTES creados por 0037 → el kit
--     SOLO LOS LEE (0 footprint sobre Storage/catálogo).
--   · Los tests de emit_custody_signed_url arman fixture (order→shipment→event→
--     evidence) e invocan la RPC bajo BEGIN/ROLLBACK + sentinel '__qa_rollback__'
--     (el INSERT en audit_log se deshace por savepoint → 0 footprint).
--   · Mediciones en variables PL/pgSQL (sobreviven al rollback) → _qa_storage_report.
--
-- COBERTURA (9 casos):
--   C1 buckets privados (3) · C2 storage policies · C3 columnas de retención ·
--   C4 emit autorizado + grant + auditoría custody.access · C5 emit inexistente rechazado ·
--   C6 emit sobre redactada rechazado · C7 emit sin rol rechazado · C8 gating PII (estricto) ·
--   C9 contenido de la auditoría (bucket/path/reason).
--
-- Resultado esperado: todas 'OK'. 'SKIP' = faltó rol/posición para el fixture.
-- ⚠️ Requiere 0010 + 0036 + 0037 APLICADAS.
-- =========================================================================

drop table if exists _qa_storage_report;
create temp table _qa_storage_report (
  seq serial primary key, caso text, chk text, resultado text, detalle text
);

-- =========================================================================
-- CASO 1 — 3 buckets privados existen (public=false).
-- =========================================================================
do $$
declare v_n int; v_priv boolean; v_err text := null;
begin
  begin
    select count(*), coalesce(bool_and(public = false), false) into v_n, v_priv
      from storage.buckets where id in ('custody-evidence','custody-pii','custody-pod');
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 1','ejecución','FALLO', v_err);
  else
    insert into _qa_storage_report(caso,chk,resultado,detalle) values
      ('Caso 1','3 buckets custody PRIVADOS existen',
        case when v_n = 3 and v_priv then 'OK' else 'FALLO' end, format('n=%s privados=%s', v_n, v_priv));
  end if;
end $$;

-- =========================================================================
-- CASO 2 — storage.objects policies de custody presentes (5).
-- =========================================================================
do $$
declare v_n int; v_err text := null;
begin
  begin
    select count(*) into v_n from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname in ('custody evidence/pod read','custody pii read strict',
                           'custody write internal','custody update internal','custody delete admin');
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 2','ejecución','FALLO', v_err);
  else
    insert into _qa_storage_report(caso,chk,resultado,detalle) values
      ('Caso 2','5 policies de storage.objects para custody',
        case when v_n = 5 then 'OK' else 'FALLO' end, format('policies=%s', v_n));
  end if;
end $$;

-- =========================================================================
-- CASO 3 — columnas de retención en custody_evidence.
-- =========================================================================
do $$
declare v_n int; v_err text := null;
begin
  begin
    select count(*) into v_n from information_schema.columns
      where table_schema='public' and table_name='custody_evidence'
        and column_name in ('retention_class','retention_until');
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 3','ejecución','FALLO', v_err);
  else
    insert into _qa_storage_report(caso,chk,resultado,detalle) values
      ('Caso 3','modelo de retención: retention_class + retention_until',
        case when v_n = 2 then 'OK' else 'FALLO' end, format('columnas=%s', v_n));
  end if;
end $$;

-- =========================================================================
-- CASO 4 — emit autorizado: devuelve grant (bucket/path) + registra custody.access.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_sh uuid; v_ev uuid; v_evi uuid;
  v_grant jsonb; v_audit int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 4','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_STOR_C4','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    insert into public.custody_events (shipment_id, stage, event_type) values (v_sh,'entrega','foto_entrega') returning id into v_ev;
    insert into public.custody_evidence (event_id, kind, storage_bucket, storage_path, sha256)
      values (v_ev,'foto','custody-evidence','custody-evidence/sh/'||v_sh::text||'/entrega/f.jpg','h1') returning id into v_evi;

    select public.emit_custody_signed_url(v_evi, 'descarga test', '127.0.0.1') into v_grant;
    select count(*) into v_audit from public.audit_log
      where action='custody.access' and entity_id = v_evi;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 4','ejecución','FALLO', v_err);
  else
    insert into _qa_storage_report(caso,chk,resultado,detalle) values
      ('Caso 4','emit OK: grant con bucket/path · audit custody.access registrado',
        case when v_grant->>'bucket'='custody-evidence' and (v_grant->>'path') is not null and v_audit=1 then 'OK' else 'FALLO' end,
        format('bucket=%s path=%s audit=%s', v_grant->>'bucket', left(coalesce(v_grant->>'path',''),24), v_audit));
  end if;
end $$;

-- =========================================================================
-- CASO 5 — emit sobre evidencia inexistente → rechazado.
-- =========================================================================
do $$
declare v_uid uuid; v_rej boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    begin perform public.emit_custody_signed_url(gen_random_uuid(), 'x', null);
      exception when others then if sqlerrm<>'__qa_rollback__' then v_rej := true; end if; end;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 5','ejecución','FALLO', v_err);
  else
    insert into _qa_storage_report(caso,chk,resultado,detalle) values
      ('Caso 5','emit sobre evidencia inexistente → rechazado',
        case when v_rej then 'OK' else 'FALLO' end, format('rejected=%s', v_rej));
  end if;
end $$;

-- =========================================================================
-- CASO 6 — emit sobre evidencia REDACTADA → rechazado.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_sh uuid; v_ev uuid; v_evi uuid; v_rej boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_STOR_C6','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    insert into public.custody_events (shipment_id, stage, event_type) values (v_sh,'entrega','foto_entrega') returning id into v_ev;
    insert into public.custody_evidence (event_id, kind, storage_bucket, storage_path, sha256)
      values (v_ev,'foto','custody-evidence','custody-evidence/sh/'||v_sh::text||'/entrega/g.jpg','h2') returning id into v_evi;
    update public.custody_evidence set redacted=true, redacted_at=now() where id=v_evi;  -- flip permitido
    begin perform public.emit_custody_signed_url(v_evi, 'x', null);
      exception when others then if sqlerrm<>'__qa_rollback__' then v_rej := true; end if; end;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 6','ejecución','FALLO', v_err);
  else
    insert into _qa_storage_report(caso,chk,resultado,detalle) values
      ('Caso 6','emit sobre evidencia redactada → rechazado',
        case when v_rej then 'OK' else 'FALLO' end, format('rejected=%s', v_rej));
  end if;
end $$;

-- =========================================================================
-- CASO 7 — emit SIN rol (jwt vacío) → rechazado (insufficient_privilege).
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_sh uuid; v_ev uuid; v_evi uuid; v_blocked boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 7','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_STOR_C7','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    insert into public.custody_events (shipment_id, stage, event_type) values (v_sh,'entrega','foto_entrega') returning id into v_ev;
    insert into public.custody_evidence (event_id, kind, storage_bucket, storage_path, sha256)
      values (v_ev,'foto','custody-evidence','custody-evidence/sh/'||v_sh::text||'/entrega/h.jpg','h3') returning id into v_evi;

    perform set_config('request.jwt.claims', '', true);   -- sin claims → current_role() null
    begin perform public.emit_custody_signed_url(v_evi, 'x', null);
      exception when insufficient_privilege then v_blocked := true;
               when others then if sqlerrm<>'__qa_rollback__' then v_blocked := true; end if; end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 7','ejecución','FALLO', v_err);
  else
    insert into _qa_storage_report(caso,chk,resultado,detalle) values
      ('Caso 7','emit sin rol → rechazado',
        case when v_blocked then 'OK' else 'FALLO' end, format('blocked=%s', v_blocked));
  end if;
end $$;

-- =========================================================================
-- CASO 8 — gating PII estricto: emit sobre custody-pii OK sólo si rol ∈ (admin,supervisor).
-- =========================================================================
do $$
declare
  v_uid uuid; v_role text; v_oid uuid; v_sh uuid; v_ev uuid; v_evi uuid;
  v_ok boolean := false; v_expected boolean; v_err text := null;
begin
  select id, role into v_uid, v_role from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 8','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  v_expected := (v_role in ('admin','supervisor'));
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_STOR_C8','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    insert into public.custody_events (shipment_id, stage, event_type) values (v_sh,'entrega','firmado') returning id into v_ev;
    insert into public.custody_evidence (event_id, kind, storage_bucket, storage_path, sha256)
      values (v_ev,'firma','custody-pii','custody-pii/sh/'||v_sh::text||'/entrega/firma.png','h4') returning id into v_evi;
    begin perform public.emit_custody_signed_url(v_evi, 'pii', null); v_ok := true;
      exception when others then if sqlerrm<>'__qa_rollback__' then v_ok := false; end if; end;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 8','ejecución','FALLO', v_err);
  else
    insert into _qa_storage_report(caso,chk,resultado,detalle) values
      ('Caso 8','PII gating: emit OK ⇔ rol ∈ (admin,supervisor)',
        case when v_ok = v_expected then 'OK' else 'FALLO' end,
        format('rol=%s emit_ok=%s esperado=%s', v_role, v_ok, v_expected));
  end if;
end $$;

-- =========================================================================
-- CASO 9 — contenido de la auditoría: payload con bucket/path/reason.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_sh uuid; v_ev uuid; v_evi uuid; r record; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 9','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_STOR_C9','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    insert into public.custody_events (shipment_id, stage, event_type) values (v_sh,'entrega','foto_entrega') returning id into v_ev;
    insert into public.custody_evidence (event_id, kind, storage_bucket, storage_path, sha256)
      values (v_ev,'foto','custody-evidence','custody-evidence/p/q/r.jpg','h5') returning id into v_evi;
    perform public.emit_custody_signed_url(v_evi, 'motivo-x', '10.0.0.1');
    select user_id, entity, entity_id, action, payload, ip into r
      from public.audit_log where action='custody.access' and entity_id=v_evi order by ts desc limit 1;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then
    insert into _qa_storage_report(caso,chk,resultado,detalle) values ('Caso 9','ejecución','FALLO', v_err);
  else
    insert into _qa_storage_report(caso,chk,resultado,detalle) values
      ('Caso 9','auditoría: usuario/entity_id/bucket/path/motivo registrados',
        case when r.user_id = v_uid and r.entity='custody_evidence'
                  and r.payload->>'bucket'='custody-evidence'
                  and (r.payload->>'path') is not null
                  and r.payload->>'reason'='motivo-x' then 'OK' else 'FALLO' end,
        format('user_ok=%s bucket=%s reason=%s', (r.user_id=v_uid), r.payload->>'bucket', r.payload->>'reason'));
  end if;
end $$;

-- =========================================================================
-- REPORTE FINAL — FALLO/SKIP primero, luego OK. Esperado: todo 'OK'.
-- =========================================================================
select seq, caso, chk, resultado, detalle
from _qa_storage_report
order by (resultado = 'OK'), seq;
