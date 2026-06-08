# TOPS NEXUS — RRHH · R4 E8–E11 EXECUTION PACKAGE v2 (Results, sin NOTICE)

> Validación E8–E11 que devuelve **todo en la pestaña Results** (sin `RAISE NOTICE`). Autocontenido,
> sin placeholders, en `BEGIN … ROLLBACK` (cero persistencia — tablas append-only). Pegar completo en
> el SQL Editor; capturar **una sola pantalla de Results**.
> Precondición: `0056`–`0059` aplicadas; ≥3 usuarios `auth.users` no-admin sin legajo.
> **No ejecutado desde este entorno** (sin acceso); construido contra el esquema real. **Fecha:** 2026-06-07.

---

## Script único (copy/paste → capturar Results)

```sql
BEGIN;

create temp table validation_results (ord int, test text, result text, detail text);

do $all$
declare
  v_uids uuid[]; v_uid_emp uuid; v_uid_sup uuid; v_uid_rrhh uuid;
  v_emp_sup uuid; v_emp_emp uuid; v_sol uuid; v_s2 uuid;
  v_estado text; v_nov int; v_pub text;
begin
  ----------------------------------------------------------------- PRECOND + FIXTURES
  begin
    if not exists (select 1 from public.roles where slug='rrhh_manager') then
      raise exception 'falta rol rrhh_manager (¿0057 aplicado?)'; end if;
    select array_agg(id) into v_uids from (
      select u.id from auth.users u join public.profiles p on p.id=u.id
      where p.role <> 'admin'
        and not exists (select 1 from public.rrhh_empleados e where e.profile_id=u.id)
      order by u.created_at limit 3) q;
    if v_uids is null or array_length(v_uids,1) < 3 then
      raise exception 'se requieren >=3 auth.users no-admin sin legajo'; end if;
    v_uid_emp:=v_uids[1]; v_uid_sup:=v_uids[2]; v_uid_rrhh:=v_uids[3];

    insert into public.rrhh_empleados (apellido_nombre,dni,cuil,fecha_ingreso,profile_id)
      values ('TEST Supervisor','TEST-SUP-DNI','TEST-SUP-CUIL',current_date,v_uid_sup) returning id into v_emp_sup;
    insert into public.rrhh_empleados (apellido_nombre,dni,cuil,fecha_ingreso,profile_id,supervisor_id)
      values ('TEST Empleado','TEST-EMP-DNI','TEST-EMP-CUIL',current_date,v_uid_emp,v_emp_sup) returning id into v_emp_emp;
    insert into public.user_roles (user_id,role_id)
      select v_uid_rrhh,id from public.roles where slug='rrhh_manager' on conflict do nothing;
  exception when others then
    insert into validation_results values (0,'PRECOND','FAIL', sqlerrm);
    return;
  end;

  ----------------------------------------------------------------- E8 — flujo feliz
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_emp)::text, true);
    v_sol := public.rrhh_solicitud_crear(v_emp_emp,'permiso','medico',current_date,current_date,'control médico',1);
    perform public.rrhh_solicitud_enviar(v_sol);
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_sup)::text, true);
    perform public.rrhh_solicitud_aprobar_l1(v_sol,'ok jefe');
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_rrhh)::text, true);
    perform public.rrhh_solicitud_aprobar_l2(v_sol,'aprobado RRHH');
    select estado::text, public_id into v_estado, v_pub from public.rrhh_solicitudes where id=v_sol;
    select count(*) into v_nov from public.rrhh_novedades where origen_solicitud_id=v_sol;
    insert into validation_results values
      (1,'E8', case when v_estado='aprobada' and v_nov=1 then 'PASS' else 'FAIL' end,
       v_pub||' estado='||v_estado||' novedades='||v_nov);
    insert into validation_results values (2,'estado_final', v_estado, null);
    insert into validation_results values (3,'novedades_generadas', v_nov::text, null);
  exception when others then
    insert into validation_results values (1,'E8','FAIL', sqlerrm);
  end;

  ----------------------------------------------------------------- E9 — denegación L1
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_emp)::text, true);
    v_s2 := public.rrhh_solicitud_crear(v_emp_emp,'permiso','otro',current_date,current_date,'x',1);
    perform public.rrhh_solicitud_enviar(v_s2);
    begin
      perform set_config('request.jwt.claims', json_build_object('sub',v_uid_emp)::text, true);
      perform public.rrhh_solicitud_aprobar_l1(v_s2);
      insert into validation_results values (4,'E9','FAIL','aprobar_l1 no lanzó excepción');
    exception when others then
      insert into validation_results values (4,'E9','PASS', sqlstate||' '||sqlerrm);
    end;
  exception when others then
    insert into validation_results values (4,'E9','FAIL','setup: '||sqlerrm);
  end;

  ----------------------------------------------------------------- E10 — denegación L2
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_emp)::text, true);
    v_s2 := public.rrhh_solicitud_crear(v_emp_emp,'permiso','otro',current_date,current_date,'x',1);
    perform public.rrhh_solicitud_enviar(v_s2);
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_sup)::text, true);
    perform public.rrhh_solicitud_aprobar_l1(v_s2,'ok');   -- pendiente_rrhh
    begin
      perform set_config('request.jwt.claims', json_build_object('sub',v_uid_emp)::text, true);
      perform public.rrhh_solicitud_aprobar_l2(v_s2);
      insert into validation_results values (5,'E10','FAIL','aprobar_l2 no lanzó excepción');
    exception when others then
      insert into validation_results values (5,'E10','PASS', sqlstate||' '||sqlerrm);
    end;
  exception when others then
    insert into validation_results values (5,'E10','FAIL','setup: '||sqlerrm);
  end;

  ----------------------------------------------------------------- E11a — DELETE eventos
  begin
    delete from public.rrhh_solicitud_eventos where solicitud_id = v_sol;
    insert into validation_results values (6,'E11a','FAIL','DELETE en eventos permitido');
  exception when others then
    insert into validation_results values (6,'E11a','PASS', sqlstate||' '||sqlerrm);
  end;

  ----------------------------------------------------------------- E11b — UPDATE novedades
  begin
    update public.rrhh_novedades set cantidad = 999 where origen_solicitud_id = v_sol;
    insert into validation_results values (7,'E11b','FAIL','UPDATE en novedades permitido');
  exception when others then
    insert into validation_results values (7,'E11b','PASS', sqlstate||' '||sqlerrm);
  end;
end
$all$;

select test, result, detail from validation_results order by ord;

ROLLBACK;
```

---

## Resultado esperado en **Results**

| test | result | detail |
|------|--------|--------|
| E8 | PASS | SOL-2026-000001 estado=aprobada novedades=1 |
| estado_final | aprobada |  |
| novedades_generadas | 1 |  |
| E9 | PASS | 42501 ACCESS_DENIED: solo el supervisor directo aprueba L1 |
| E10 | PASS | 42501 ACCESS_DENIED: requiere rrhh.edit |
| E11a | PASS | … append-only: DELETE no permitido … |
| E11b | PASS | … append-only: UPDATE no permitido … |

---

## Cierre
- Capturar **una sola pantalla de Results** con la tabla anterior.
- **R4 CLOSED · WORKFLOW FOUNDATION COMPLETE · READY FOR R5** si: E8=PASS (estado_final=aprobada,
  novedades_generadas=1), E9=PASS, E10=PASS, E11a=PASS, E11b=PASS.
- Si aparece fila `PRECOND FAIL` → faltan precondiciones (rol `rrhh_manager` / ≥3 usuarios no-admin
  sin legajo); resolver y re-ejecutar.
- El script termina en `ROLLBACK` → **cero persistencia** (no deja empleados/solicitudes/novedades de
  prueba, que serían imborrables por append-only).

*Paquete v2 — sin NOTICE; evidencia en Results. No ejecutado por mí (sin acceso); correr en tx con ROLLBACK.*
