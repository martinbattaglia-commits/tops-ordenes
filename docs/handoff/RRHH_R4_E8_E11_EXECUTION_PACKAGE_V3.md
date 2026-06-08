# TOPS NEXUS — RRHH · R4 E8–E11 EXECUTION PACKAGE v3 (RETURNS TABLE)

> Fix de v2 (`ERROR 42P01 validation_results does not exist`): los objetos **temp** no sobreviven
> entre sentencias en el SQL Editor. v3 usa una **función `public` que `RETURNS TABLE`** (visible al
> `SELECT` final dentro de la tx) y `ROLLBACK` revierte función + fixtures (DDL transaccional).
> Misma lógica E8–E11, solo cambia el mecanismo de salida. Cero persistencia. **No ejecutado por mí.**
> **Fecha:** 2026-06-07.

---

## Script único (copy/paste → capturar Results)

```sql
BEGIN;

create or replace function public.rrhh_r4_validate()
returns table(ord int, test text, result text, detail text)
language plpgsql as $fn$
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
    ord:=0; test:='PRECOND'; result:='FAIL'; detail:=sqlerrm; return next; return;
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
    ord:=1; test:='E8';
    result := case when v_estado='aprobada' and v_nov=1 then 'PASS' else 'FAIL' end;
    detail := v_pub||' estado='||v_estado||' novedades='||v_nov; return next;
    ord:=2; test:='estado_final';        result:=v_estado;     detail:=null; return next;
    ord:=3; test:='novedades_generadas'; result:=v_nov::text;  detail:=null; return next;
  exception when others then
    ord:=1; test:='E8'; result:='FAIL'; detail:=sqlerrm; return next;
  end;

  ----------------------------------------------------------------- E9 — denegación L1
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid_emp)::text, true);
    v_s2 := public.rrhh_solicitud_crear(v_emp_emp,'permiso','otro',current_date,current_date,'x',1);
    perform public.rrhh_solicitud_enviar(v_s2);
    begin
      perform set_config('request.jwt.claims', json_build_object('sub',v_uid_emp)::text, true);
      perform public.rrhh_solicitud_aprobar_l1(v_s2);
      ord:=4; test:='E9'; result:='FAIL'; detail:='aprobar_l1 no lanzó excepción'; return next;
    exception when others then
      ord:=4; test:='E9'; result:='PASS'; detail:=sqlstate||' '||sqlerrm; return next;
    end;
  exception when others then
    ord:=4; test:='E9'; result:='FAIL'; detail:='setup: '||sqlerrm; return next;
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
      ord:=5; test:='E10'; result:='FAIL'; detail:='aprobar_l2 no lanzó excepción'; return next;
    exception when others then
      ord:=5; test:='E10'; result:='PASS'; detail:=sqlstate||' '||sqlerrm; return next;
    end;
  exception when others then
    ord:=5; test:='E10'; result:='FAIL'; detail:='setup: '||sqlerrm; return next;
  end;

  ----------------------------------------------------------------- E11a — DELETE eventos
  begin
    delete from public.rrhh_solicitud_eventos where solicitud_id = v_sol;
    ord:=6; test:='E11a'; result:='FAIL'; detail:='DELETE en eventos permitido'; return next;
  exception when others then
    ord:=6; test:='E11a'; result:='PASS'; detail:=sqlstate||' '||sqlerrm; return next;
  end;

  ----------------------------------------------------------------- E11b — UPDATE novedades
  begin
    update public.rrhh_novedades set cantidad = 999 where origen_solicitud_id = v_sol;
    ord:=7; test:='E11b'; result:='FAIL'; detail:='UPDATE en novedades permitido'; return next;
  exception when others then
    ord:=7; test:='E11b'; result:='PASS'; detail:=sqlstate||' '||sqlerrm; return next;
  end;

  return;
end
$fn$;

select test, result, detail from public.rrhh_r4_validate() order by ord;

ROLLBACK;
```

> `ROLLBACK` revierte la función `rrhh_r4_validate` **y** todos los fixtures/escrituras hechos durante
> el `SELECT` → cero persistencia. (En Postgres, `CREATE FUNCTION` es transaccional.)

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
- Capturar **una sola pantalla de Results**.
- Si E8/E9/E10/E11a/E11b = **PASS** (estado_final=aprobada, novedades_generadas=1) →
  **R4 CLOSED · WORKFLOW FOUNDATION COMPLETE · READY FOR R5**.
- Fila `PRECOND FAIL` → faltan precondiciones (rol `rrhh_manager` / ≥3 usuarios no-admin sin legajo).
- Termina en `ROLLBACK` → no deja datos (append-only ⇒ serían imborrables si se hiciera COMMIT).

> Si aún diera error de "función no existe" en el `SELECT`, el editor estaría ejecutando cada sentencia
> en transacciones separadas (pooling en modo transacción). En ese caso, ejecutar el bloque
> `BEGIN…ROLLBACK` como **una sola corrida** (no seleccionar líneas sueltas); es el modo en que el SQL
> Editor mantiene la transacción.

*Paquete v3 — RETURNS TABLE; evidencia en Results. No ejecutado por mí (sin acceso); cero persistencia.*
