# TOPS NEXUS — RRHH · R5 EXECUTION PACKAGE v1 (E1–E12, Results, sin NOTICE)

> Validación E1–E12 de R5 (Documents & Storage). Autocontenido, sin placeholders, en `BEGIN … ROLLBACK`
> (cero persistencia — append-only). Evidencia en **Results** vía función `RETURNS TABLE` (patrón R4 v3).
> Precondición: `0056`–`0060` aplicadas; ≥4 usuarios `auth.users` no-admin sin legajo; rol `rrhh_admin`
> con permisos (0057). **No ejecutado por mí** (sin acceso); construido contra el esquema real. **2026-06-07.**

---

## Script único (copy/paste → capturar Results)

```sql
BEGIN;

create or replace function public.rrhh_r5_validate()
returns table(ord int, test text, result text, detail text)
language plpgsql as $fn$
declare
  v_uids uuid[]; v_uid_emp uuid; v_uid_sup uuid; v_uid_rrhh uuid; v_uid_ops uuid;
  v_emp_sup uuid; v_emp_emp uuid;
  d_dni uuid; d_cap uuid; d_adj uuid; d_salud uuid; d_contrato uuid;
  v_grant jsonb; v_int int; v_fail int; v_audit int;
begin
  -- E1 buckets
  begin
    select count(*) into v_int from storage.buckets where id in ('rrhh-legajo','rrhh-health');
    ord:=1; test:='E1'; result:=case when v_int=2 then 'PASS' else 'FAIL' end; detail:='buckets='||v_int; return next;
  exception when others then ord:=1;test:='E1';result:='FAIL';detail:=sqlerrm;return next; end;

  -- E2 tablas
  begin
    if to_regclass('public.rrhh_documents') is not null and to_regclass('public.rrhh_document_audit') is not null
      then ord:=2;test:='E2';result:='PASS';detail:='rrhh_documents + rrhh_document_audit';
      else ord:=2;test:='E2';result:='FAIL';detail:='falta tabla'; end if; return next;
  exception when others then ord:=2;test:='E2';result:='FAIL';detail:=sqlerrm;return next; end;

  -- E3 RPC
  begin
    if to_regprocedure('public.emit_rrhh_signed_url(uuid,text)') is not null
      then ord:=3;test:='E3';result:='PASS';detail:='emit_rrhh_signed_url';
      else ord:=3;test:='E3';result:='FAIL';detail:='RPC ausente'; end if; return next;
  exception when others then ord:=3;test:='E3';result:='FAIL';detail:=sqlerrm;return next; end;

  -- FIXTURES
  begin
    select array_agg(id) into v_uids from (
      select u.id from auth.users u join public.profiles p on p.id=u.id
      where p.role<>'admin' and not exists (select 1 from public.rrhh_empleados e where e.profile_id=u.id)
      order by u.created_at limit 4) q;
    if v_uids is null or array_length(v_uids,1)<4 then raise exception 'se requieren >=4 auth.users no-admin sin legajo'; end if;
    v_uid_emp:=v_uids[1]; v_uid_sup:=v_uids[2]; v_uid_rrhh:=v_uids[3]; v_uid_ops:=v_uids[4];

    insert into public.rrhh_empleados(apellido_nombre,dni,cuil,fecha_ingreso,profile_id)
      values('TEST Supervisor','TEST-SUP-DNI','TEST-SUP-CUIL',current_date,v_uid_sup) returning id into v_emp_sup;
    insert into public.rrhh_empleados(apellido_nombre,dni,cuil,fecha_ingreso,profile_id,supervisor_id)
      values('TEST Empleado','TEST-EMP-DNI','TEST-EMP-CUIL',current_date,v_uid_emp,v_emp_sup) returning id into v_emp_emp;
    insert into public.user_roles(user_id,role_id) select v_uid_rrhh,id from public.roles where slug='rrhh_admin' on conflict do nothing;

    insert into public.rrhh_documents(empleado_id,doc_class,storage_bucket,storage_path,sha256)
      values(v_emp_emp,'dni','rrhh-legajo','test/dni.pdf','h') returning id into d_dni;
    insert into public.rrhh_documents(empleado_id,doc_class,storage_bucket,storage_path,sha256)
      values(v_emp_emp,'capacitacion','rrhh-legajo','test/cap.pdf','h') returning id into d_cap;
    insert into public.rrhh_documents(empleado_id,doc_class,storage_bucket,storage_path,sha256)
      values(v_emp_emp,'adjunto_solicitud','rrhh-legajo','test/adj.pdf','h') returning id into d_adj;
    insert into public.rrhh_documents(empleado_id,doc_class,storage_bucket,storage_path,sha256)
      values(v_emp_emp,'contrato','rrhh-legajo','test/contrato.pdf','h') returning id into d_contrato;
    insert into public.rrhh_documents(empleado_id,doc_class,storage_bucket,storage_path,sha256)
      values(v_emp_emp,'estudio','rrhh-health','test/salud.pdf','h') returning id into d_salud;
  exception when others then
    ord:=0;test:='FIXTURES';result:='FAIL';detail:=sqlerrm; return next; return;
  end;

  -- E4 empleado accede a su propio DNI (success = PASS)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_emp)::text, true);
    perform public.emit_rrhh_signed_url(d_dni);
    ord:=4;test:='E4';result:='PASS';detail:='empleado accede a su DNI'; return next;
  exception when others then ord:=4;test:='E4';result:='FAIL';detail:=sqlerrm; return next; end;

  -- E5 supervisor accede a adjunto_solicitud + capacitacion de su equipo
  begin
    v_fail:=0;
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_sup)::text, true);
    begin perform public.emit_rrhh_signed_url(d_adj); exception when others then v_fail:=v_fail+1; end;
    begin perform public.emit_rrhh_signed_url(d_cap); exception when others then v_fail:=v_fail+1; end;
    ord:=5;test:='E5';result:=case when v_fail=0 then 'PASS' else 'FAIL' end;
    detail:='fallos='||v_fail||' (esperado 0)'; return next;
  exception when others then ord:=5;test:='E5';result:='FAIL';detail:=sqlerrm; return next; end;

  -- E6 supervisor BLOQUEADO para dni/contrato/salud (accesos indebidos = 0)
  begin
    v_int:=0;
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_sup)::text, true);
    begin perform public.emit_rrhh_signed_url(d_dni); v_int:=v_int+1; exception when others then null; end;
    begin perform public.emit_rrhh_signed_url(d_contrato); v_int:=v_int+1; exception when others then null; end;
    begin perform public.emit_rrhh_signed_url(d_salud); v_int:=v_int+1; exception when others then null; end;
    ord:=6;test:='E6';result:=case when v_int=0 then 'PASS' else 'FAIL' end;
    detail:='accesos indebidos='||v_int||' (esperado 0)'; return next;
  exception when others then ord:=6;test:='E6';result:='FAIL';detail:=sqlerrm; return next; end;

  -- E7 RRHH admin acceso total (legajo + salud)
  begin
    v_fail:=0;
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_rrhh)::text, true);
    begin perform public.emit_rrhh_signed_url(d_dni); exception when others then v_fail:=v_fail+1; end;
    begin perform public.emit_rrhh_signed_url(d_salud); exception when others then v_fail:=v_fail+1; end;
    ord:=7;test:='E7';result:=case when v_fail=0 then 'PASS' else 'FAIL' end;
    detail:='RRHH accede legajo+salud (fallos='||v_fail||')'; return next;
  exception when others then ord:=7;test:='E7';result:='FAIL';detail:=sqlerrm; return next; end;

  -- E8 operaciones acceso nulo
  begin
    v_int:=0;
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_ops)::text, true);
    begin perform public.emit_rrhh_signed_url(d_dni); v_int:=v_int+1; exception when others then null; end;
    begin perform public.emit_rrhh_signed_url(d_adj); v_int:=v_int+1; exception when others then null; end;
    ord:=8;test:='E8';result:=case when v_int=0 then 'PASS' else 'FAIL' end;
    detail:='accesos operaciones='||v_int||' (esperado 0)'; return next;
  exception when others then ord:=8;test:='E8';result:='FAIL';detail:=sqlerrm; return next; end;

  -- E9 salud solo admin + dueño
  begin
    v_fail:=0;
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_rrhh)::text, true);
    begin perform public.emit_rrhh_signed_url(d_salud); exception when others then v_fail:=v_fail+1; end;
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_emp)::text, true);
    begin perform public.emit_rrhh_signed_url(d_salud); exception when others then v_fail:=v_fail+1; end;
    ord:=9;test:='E9';result:=case when v_fail=0 then 'PASS' else 'FAIL' end;
    detail:='admin+dueño OK (fallos='||v_fail||'); supervisor bloqueado en E6'; return next;
  exception when others then ord:=9;test:='E9';result:='FAIL';detail:=sqlerrm; return next; end;

  -- E10 auditoría: cada lectura generó fila
  begin
    select count(*) into v_audit from public.rrhh_document_audit
      where document_id in (d_dni,d_cap,d_adj,d_salud,d_contrato);
    ord:=10;test:='E10';result:=case when v_audit>0 then 'PASS' else 'FAIL' end;
    detail:='filas de auditoría='||v_audit; return next;
  exception when others then ord:=10;test:='E10';result:='FAIL';detail:=sqlerrm; return next; end;

  -- E11 signed url grant correcto
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_emp)::text, true);
    v_grant := public.emit_rrhh_signed_url(d_dni,'test');
    ord:=11;test:='E11';
    result:=case when v_grant->>'bucket'='rrhh-legajo' and (v_grant->>'path') is not null then 'PASS' else 'FAIL' end;
    detail:='bucket='||coalesce(v_grant->>'bucket','-')||' path='||coalesce(v_grant->>'path','-'); return next;
  exception when others then ord:=11;test:='E11';result:='FAIL';detail:=sqlerrm; return next; end;

  -- E12 buckets privados + sin lectura directa storage.objects para rrhh-*
  begin
    select count(*) into v_int from storage.buckets where id in ('rrhh-legajo','rrhh-health') and public=false;
    select count(*) into v_fail from pg_policies where schemaname='storage' and tablename='objects'
      and cmd in ('SELECT','ALL')
      and (coalesce(qual,'') ilike '%rrhh-%' or coalesce(with_check,'') ilike '%rrhh-%');
    ord:=12;test:='E12';result:=case when v_int=2 and v_fail=0 then 'PASS' else 'FAIL' end;
    detail:='privados='||v_int||' policies_lectura_rrhh='||v_fail; return next;
  exception when others then ord:=12;test:='E12';result:='FAIL';detail:=sqlerrm; return next; end;

  return;
end
$fn$;

select test, result, detail from public.rrhh_r5_validate() order by ord;

ROLLBACK;
```

> `ROLLBACK` revierte la función, los fixtures (empleados/docs/rol temporal) y la auditoría de prueba
> → **cero persistencia** (las tablas son append-only; un `COMMIT` dejaría datos imborrables).

---

## Resultado esperado en **Results**
| test | result |
|------|--------|
| E1 | PASS |
| E2 | PASS |
| E3 | PASS |
| E4 | PASS |
| E5 | PASS |
| E6 | PASS |
| E7 | PASS |
| E8 | PASS |
| E9 | PASS |
| E10 | PASS |
| E11 | PASS |
| E12 | PASS |

Fila `FIXTURES FAIL` ⇒ faltan precondiciones (rol `rrhh_admin` / ≥4 usuarios no-admin sin legajo) o
`0056`–`0060` no aplicadas.

*Paquete v1 (estilo R4 v3) — Results, sin NOTICE. No ejecutado por mí; correr en tx con ROLLBACK.*
