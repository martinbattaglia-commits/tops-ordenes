-- =========================================================================
-- GATE 5.2 · CUSTODY EVIDENCE (0038) — Kit de validación con REPORTE EN FILAS.
-- Para el SQL Editor de Supabase. Correr DESPUÉS de aplicar 0038_custody_evidence.sql.
--
-- Mecánica: fixture (order→shipment/packing_unit) + RPC bajo BEGIN/ROLLBACK +
--   sentinel '__qa_rollback__' (0 footprint). Mediciones en variables → _qa_evidence_report.
--   El SQL Editor corre como owner (bypassa lockdown RLS para armar fixture); las RPC
--   SECURITY DEFINER y los triggers de 0036 aplican igual.
--
-- COBERTURA (10 casos):
--   C1 register_custody_event (CUST- + audit) · C2 register XOR · C3 attach (evento+evidencia,
--   evidence_sha256 ligado, retención, audit) · C4 attach validaciones (bucket/sha256) ·
--   C5 attach path duplicado / redactado · C6 verify cadena válida · C7 verify XOR + vacía ·
--   C8 redact (flip + sha256 preservado + audit + doble-redact rechazado) · C9 redact preserva cadena ·
--   C10 authz (register sin rol · redact admin/supervisor).
--
-- Resultado esperado: todas 'OK'. 'SKIP' = faltó rol. ⚠️ Requiere 0036 + 0037 + 0038 APLICADAS.
-- =========================================================================

drop table if exists _qa_evidence_report;
create temp table _qa_evidence_report (
  seq serial primary key, caso text, chk text, resultado text, detalle text
);

-- =========================================================================
-- CASO 1 — register_custody_event: crea evento (CUST-) + audit custody.event.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_sh uuid; v_ev uuid; v_pub text; v_audit int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 1','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_EVID_C1','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    select public.register_custody_event(null, v_sh, 'transporte','en_transito') into v_ev;
    select public_id into v_pub from public.custody_events where id=v_ev;
    select count(*) into v_audit from public.audit_log where action='custody.event' and entity_id=v_ev;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 1','ejecución','FALLO', v_err);
  else insert into _qa_evidence_report(caso,chk,resultado,detalle) values
    ('Caso 1','register: evento CUST- creado + audit custody.event',
      case when v_pub like 'CUST-%' and v_audit=1 then 'OK' else 'FALLO' end, format('pub=%s audit=%s', v_pub, v_audit));
  end if;
end $$;

-- =========================================================================
-- CASO 2 — register XOR: ambos null / ambos set → rechazado.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_sh uuid; v_pu uuid; v_none boolean := false; v_both boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 2','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_EVID_C2','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    insert into public.packing_units (order_id, status) values (v_oid,'cerrada') returning id into v_pu;
    begin perform public.register_custody_event(null, null, 'transporte','en_transito');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_none := true; end if; end;
    begin perform public.register_custody_event(v_pu, v_sh, 'transporte','en_transito');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_both := true; end if; end;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 2','ejecución','FALLO', v_err);
  else insert into _qa_evidence_report(caso,chk,resultado,detalle) values
    ('Caso 2','register XOR: ambos null y ambos set rechazados',
      case when v_none and v_both then 'OK' else 'FALLO' end, format('none=%s both=%s', v_none, v_both));
  end if;
end $$;

-- =========================================================================
-- CASO 3 — attach: crea evento+evidencia · evidence_sha256 ligado · retención · audit.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_pu uuid; v_g jsonb; v_evid uuid; v_evtid uuid;
  v_evt_sha text; v_ret text; v_audit int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 3','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_EVID_C3','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid,'cerrada') returning id into v_pu;
    select public.attach_custody_evidence(v_pu, null, 'packing','foto_packing','foto',
             'custody-evidence','custody-evidence/pu/'||v_pu::text||'/packing/f.jpg','sha-abc') into v_g;
    v_evtid := (v_g->>'event_id')::uuid; v_evid := (v_g->>'evidence_id')::uuid;
    select evidence_sha256 into v_evt_sha from public.custody_events where id=v_evtid;
    select retention_class into v_ret from public.custody_evidence where id=v_evid;
    select count(*) into v_audit from public.audit_log where action='custody.attach' and entity_id=v_evid;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 3','ejecución','FALLO', v_err);
  else insert into _qa_evidence_report(caso,chk,resultado,detalle) values
    ('Caso 3','attach: evento+evidencia · evidence_sha256 ligado · retención · audit',
      case when v_evtid is not null and v_evid is not null and v_evt_sha='sha-abc' and v_ret='evidence' and v_audit=1 then 'OK' else 'FALLO' end,
      format('evt_sha=%s ret=%s audit=%s', v_evt_sha, v_ret, v_audit));
  end if;
end $$;

-- =========================================================================
-- CASO 4 — attach validaciones: bucket inválido / sha256 ausente → rechazados.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_pu uuid; v_bad_bucket boolean := false; v_no_sha boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 4','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_EVID_C4','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid,'cerrada') returning id into v_pu;
    begin perform public.attach_custody_evidence(v_pu,null,'packing','foto_packing','foto','bucket-malo','p/x.jpg','s1');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_bad_bucket := true; end if; end;
    begin perform public.attach_custody_evidence(v_pu,null,'packing','foto_packing','foto','custody-evidence','custody-evidence/p/y.jpg', null);
      exception when others then if sqlerrm<>'__qa_rollback__' then v_no_sha := true; end if; end;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 4','ejecución','FALLO', v_err);
  else insert into _qa_evidence_report(caso,chk,resultado,detalle) values
    ('Caso 4','attach: bucket inválido y sha256 ausente rechazados',
      case when v_bad_bucket and v_no_sha then 'OK' else 'FALLO' end, format('bad_bucket=%s no_sha=%s', v_bad_bucket, v_no_sha));
  end if;
end $$;

-- =========================================================================
-- CASO 5 — attach: path duplicado rechazado · path de evidencia redactada rechazado.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_pu uuid; v_g jsonb; v_evid uuid;
  v_dup boolean := false; v_redpath boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_EVID_C5','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid,'cerrada') returning id into v_pu;
    select public.attach_custody_evidence(v_pu,null,'packing','foto_packing','foto','custody-evidence','custody-evidence/dup/a.jpg','s1') into v_g;
    -- mismo path → duplicado
    begin perform public.attach_custody_evidence(v_pu,null,'packing','foto_packing','foto','custody-evidence','custody-evidence/dup/a.jpg','s2');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_dup := true; end if; end;
    -- redacta y reintenta el mismo path → rechazado por "redactada"
    v_evid := (v_g->>'evidence_id')::uuid;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    update public.custody_evidence set redacted=true, redacted_at=now() where id=v_evid;  -- simula redacción (owner)
    begin perform public.attach_custody_evidence(v_pu,null,'packing','foto_packing','foto','custody-evidence','custody-evidence/dup/a.jpg','s3');
      exception when others then if sqlerrm<>'__qa_rollback__' then v_redpath := true; end if; end;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 5','ejecución','FALLO', v_err);
  else insert into _qa_evidence_report(caso,chk,resultado,detalle) values
    ('Caso 5','attach: path duplicado y path redactado rechazados',
      case when v_dup and v_redpath then 'OK' else 'FALLO' end, format('dup=%s redpath=%s', v_dup, v_redpath));
  end if;
end $$;

-- =========================================================================
-- CASO 6 — verify_custody_chain: cadena VÁLIDA (register + attach) → valid=true.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_sh uuid; v_res jsonb; v_audit int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_EVID_C6','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    perform public.register_custody_event(null, v_sh, 'despacho','cargado');
    perform public.attach_custody_evidence(null, v_sh, 'entrega','foto_entrega','foto','custody-evidence','custody-evidence/ch/'||v_sh::text||'/e.jpg','sc1');
    perform public.register_custody_event(null, v_sh, 'transporte','en_transito');
    select public.verify_custody_chain(null, v_sh) into v_res;
    select count(*) into v_audit from public.audit_log where action='custody.chain_verify' and entity_id=v_sh;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 6','ejecución','FALLO', v_err);
  else insert into _qa_evidence_report(caso,chk,resultado,detalle) values
    ('Caso 6','verify: cadena válida (3 eventos) · first_error null · audit',
      case when (v_res->>'valid')::boolean and (v_res->>'events_checked')::int = 3 and (v_res->'first_error') = 'null'::jsonb and v_audit=1 then 'OK' else 'FALLO' end,
      format('valid=%s n=%s', v_res->>'valid', v_res->>'events_checked'));
  end if;
end $$;

-- =========================================================================
-- CASO 7 — verify XOR + entidad sin eventos (vacía → valid=true, 0 eventos).
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_sh uuid; v_xor boolean := false; v_res jsonb; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 7','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_EVID_C7','preparado') returning id into v_oid;
    insert into public.shipments (order_id, status) values (v_oid,'despachado') returning id into v_sh;
    begin perform public.verify_custody_chain(null, null);  -- XOR inválido
      exception when others then if sqlerrm<>'__qa_rollback__' then v_xor := true; end if; end;
    select public.verify_custody_chain(null, v_sh) into v_res;  -- sin eventos
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 7','ejecución','FALLO', v_err);
  else insert into _qa_evidence_report(caso,chk,resultado,detalle) values
    ('Caso 7','verify: XOR inválido rechazado · entidad vacía válida (0 eventos)',
      case when v_xor and (v_res->>'valid')::boolean and (v_res->>'events_checked')::int = 0 then 'OK' else 'FALLO' end,
      format('xor=%s valid=%s n=%s', v_xor, v_res->>'valid', v_res->>'events_checked'));
  end if;
end $$;

-- =========================================================================
-- CASO 8 — redact: flip + redacted_by + sha256 preservado + audit · doble-redact rechazado.
-- =========================================================================
do $$
declare
  v_uid uuid; v_role text; v_oid uuid; v_pu uuid; v_g jsonb; v_evid uuid;
  v_red boolean; v_by uuid; v_sha text; v_exists boolean; v_audit int; v_dbl boolean := false;
  v_can_redact boolean; v_err text := null;
begin
  select id, role into v_uid, v_role from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 8','setup','SKIP','sin rol'); return; end if;
  v_can_redact := (v_role in ('admin','supervisor'));
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_EVID_C8','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid,'cerrada') returning id into v_pu;
    select public.attach_custody_evidence(v_pu,null,'packing','foto_packing','foto','custody-evidence','custody-evidence/red/'||v_pu::text||'/f.jpg','shaRED') into v_g;
    v_evid := (v_g->>'evidence_id')::uuid;

    if not v_can_redact then
      -- rol operaciones: redact debe rechazar
      begin perform public.redact_custody_evidence(v_evid, 'x'); v_red := false;
        exception when others then if sqlerrm<>'__qa_rollback__' then v_red := true; end if; end;  -- v_red=true == rechazado correctamente
      insert into _qa_evidence_report(caso,chk,resultado,detalle) values
        ('Caso 8','redact: rol operaciones → rechazado (gating estricto)',
          case when v_red then 'OK' else 'FALLO' end, format('rol=%s rechazado=%s', v_role, v_red));
    else
      perform public.redact_custody_evidence(v_evid, 'motivo legal');
      select redacted, redacted_by, sha256, true into v_red, v_by, v_sha, v_exists
        from public.custody_evidence where id=v_evid;
      select count(*) into v_audit from public.audit_log where action='custody.redact' and entity_id=v_evid;
      begin perform public.redact_custody_evidence(v_evid, 'x');
        exception when others then if sqlerrm<>'__qa_rollback__' then v_dbl := true; end if; end;
      insert into _qa_evidence_report(caso,chk,resultado,detalle) values
        ('Caso 8','redact: flip + redacted_by + sha256 preservado + audit · doble rechazado',
          case when v_red and v_by=v_uid and v_sha='shaRED' and v_exists and v_audit=1 and v_dbl then 'OK' else 'FALLO' end,
          format('red=%s by_ok=%s sha=%s audit=%s dbl=%s', v_red, (v_by=v_uid), v_sha, v_audit, v_dbl));
    end if;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 8','ejecución','FALLO', v_err); end if;
end $$;

-- =========================================================================
-- CASO 9 — redact preserva la cadena: verify sigue valid=true tras redactar.
-- =========================================================================
do $$
declare
  v_uid uuid; v_role text; v_oid uuid; v_pu uuid; v_g jsonb; v_evid uuid; v_res jsonb; v_err text := null;
begin
  select id, role into v_uid, v_role from public.profiles where role in ('admin','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 9','setup','SKIP','sin admin/supervisor'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_EVID_C9','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid,'cerrada') returning id into v_pu;
    select public.attach_custody_evidence(v_pu,null,'packing','foto_packing','foto','custody-pii','custody-pii/'||v_pu::text||'/firma.png','shaP') into v_g;
    v_evid := (v_g->>'evidence_id')::uuid;
    perform public.redact_custody_evidence(v_evid, 'erasure');
    select public.verify_custody_chain(v_pu, null) into v_res;
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 9','ejecución','FALLO', v_err);
  else insert into _qa_evidence_report(caso,chk,resultado,detalle) values
    ('Caso 9','redact preserva la cadena: verify valid=true tras redactar',
      case when (v_res->>'valid')::boolean then 'OK' else 'FALLO' end, format('valid=%s', v_res->>'valid'));
  end if;
end $$;

-- =========================================================================
-- CASO 10 — authz: register/attach SIN rol → rechazados.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_pu uuid; v_reg boolean := false; v_att boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 10','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_EVID_C10','preparado') returning id into v_oid;
    insert into public.packing_units (order_id, status) values (v_oid,'cerrada') returning id into v_pu;
    perform set_config('request.jwt.claims', '', true);  -- sin rol
    begin perform public.register_custody_event(v_pu,null,'packing','foto_packing');
      exception when insufficient_privilege then v_reg := true; when others then if sqlerrm<>'__qa_rollback__' then v_reg := true; end if; end;
    begin perform public.attach_custody_evidence(v_pu,null,'packing','foto_packing','foto','custody-evidence','custody-evidence/z/z.jpg','s');
      exception when insufficient_privilege then v_att := true; when others then if sqlerrm<>'__qa_rollback__' then v_att := true; end if; end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then insert into _qa_evidence_report(caso,chk,resultado,detalle) values ('Caso 10','ejecución','FALLO', v_err);
  else insert into _qa_evidence_report(caso,chk,resultado,detalle) values
    ('Caso 10','authz: register y attach sin rol → rechazados',
      case when v_reg and v_att then 'OK' else 'FALLO' end, format('reg=%s att=%s', v_reg, v_att));
  end if;
end $$;

-- =========================================================================
-- REPORTE FINAL — FALLO/SKIP primero, luego OK. Esperado: todo 'OK'.
-- =========================================================================
select seq, caso, chk, resultado, detalle
from _qa_evidence_report
order by (resultado = 'OK'), seq;
