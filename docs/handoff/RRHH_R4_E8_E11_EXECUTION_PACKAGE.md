# TOPS NEXUS — RRHH · R4 E8–E11 EXECUTION PACKAGE

> SQL ejecutable, autocontenido, **sin placeholders**. Corre todo en `BEGIN … ROLLBACK` (cero
> persistencia — obligatorio: las tablas RRHH son append-only). Pegar **completo** en el SQL Editor
> de `arsksytgdnzukbmfgkju`. La evidencia sale en **Messages** (`NOTICE`).
> Precondición: `0056`–`0059` aplicadas; ≥3 usuarios en `auth.users` (no-admin, sin legajo).
> **No ejecutado desde este entorno** (sin acceso); construido contra el esquema real. **Fecha:** 2026-06-07.

---

## Script único (copy/paste directo)

```sql
BEGIN;

do $outer$
declare
  v_uids   uuid[];
  v_uid_emp uuid; v_uid_sup uuid; v_uid_rrhh uuid;
  v_emp_sup uuid; v_emp_emp uuid;
  v_sol uuid; v_s2 uuid;
  v_estado text; v_nov int; v_pub text;
begin
  ---------------------------------------------------------------------------
  -- PRECONDICIONES + FIXTURES (revertidos por ROLLBACK)
  ---------------------------------------------------------------------------
  if not exists (select 1 from public.roles where slug = 'rrhh_manager') then
    raise exception 'PRECOND: falta rol rrhh_manager (¿0057 aplicado?)';
  end if;

  select array_agg(id) into v_uids from (
    select u.id from auth.users u
    join public.profiles p on p.id = u.id
    where p.role <> 'admin'
      and not exists (select 1 from public.rrhh_empleados e where e.profile_id = u.id)
    order by u.created_at
    limit 3
  ) q;
  if v_uids is null or array_length(v_uids,1) < 3 then
    raise exception 'PRECOND: se requieren >=3 auth.users no-admin y sin legajo para el test';
  end if;
  v_uid_emp := v_uids[1]; v_uid_sup := v_uids[2]; v_uid_rrhh := v_uids[3];

  insert into public.rrhh_empleados (apellido_nombre, dni, cuil, fecha_ingreso, profile_id)
  values ('TEST Supervisor', 'TEST-SUP-DNI', 'TEST-SUP-CUIL', current_date, v_uid_sup)
  returning id into v_emp_sup;

  insert into public.rrhh_empleados (apellido_nombre, dni, cuil, fecha_ingreso, profile_id, supervisor_id)
  values ('TEST Empleado', 'TEST-EMP-DNI', 'TEST-EMP-CUIL', current_date, v_uid_emp, v_emp_sup)
  returning id into v_emp_emp;

  insert into public.user_roles (user_id, role_id)
  select v_uid_rrhh, id from public.roles where slug = 'rrhh_manager'
  on conflict do nothing;

  raise notice 'FIXTURES OK: emp=% sup=% rrhh_user=%', v_emp_emp, v_emp_sup, v_uid_rrhh;

  ---------------------------------------------------------------------------
  -- E8 — FLUJO FELIZ: crear -> enviar -> aprobar_l1 -> aprobar_l2
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_emp)::text, true);
  v_sol := public.rrhh_solicitud_crear(v_emp_emp, 'permiso', 'medico', current_date, current_date, 'control médico', 1);
  perform public.rrhh_solicitud_enviar(v_sol);

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_sup)::text, true);
  perform public.rrhh_solicitud_aprobar_l1(v_sol, 'ok jefe');

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_rrhh)::text, true);
  perform public.rrhh_solicitud_aprobar_l2(v_sol, 'aprobado RRHH');

  select estado::text, public_id into v_estado, v_pub from public.rrhh_solicitudes where id = v_sol;
  select count(*) into v_nov from public.rrhh_novedades where origen_solicitud_id = v_sol;

  if v_estado = 'aprobada' and v_nov = 1 then
    raise notice 'E8 PASS: % estado=% novedades=%', v_pub, v_estado, v_nov;
  else
    raise notice 'E8 FAIL: % estado=% novedades=% (esperado aprobada / 1)', v_pub, v_estado, v_nov;
  end if;

  ---------------------------------------------------------------------------
  -- Preparar s2 para denegaciones
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_emp)::text, true);
  v_s2 := public.rrhh_solicitud_crear(v_emp_emp, 'permiso', 'otro', current_date, current_date, 'x', 1);
  perform public.rrhh_solicitud_enviar(v_s2);   -- queda en pendiente_supervisor

  ---------------------------------------------------------------------------
  -- E9 — DENEGACIÓN L1: aprobar_l1 ejecutado por el EMPLEADO (no supervisor)
  ---------------------------------------------------------------------------
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid_emp)::text, true);
    perform public.rrhh_solicitud_aprobar_l1(v_s2);
    raise notice 'E9 FAIL: aprobar_l1 NO lanzó excepción';
  exception when others then
    raise notice 'E9 PASS: % [%]', sqlerrm, sqlstate;
  end;

  -- avanzar s2 a pendiente_rrhh con L1 legítimo (supervisor)
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid_sup)::text, true);
  perform public.rrhh_solicitud_aprobar_l1(v_s2, 'ok');

  ---------------------------------------------------------------------------
  -- E10 — DENEGACIÓN L2: aprobar_l2 por usuario SIN rrhh.edit (el empleado)
  ---------------------------------------------------------------------------
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid_emp)::text, true);
    perform public.rrhh_solicitud_aprobar_l2(v_s2);
    raise notice 'E10 FAIL: aprobar_l2 NO lanzó excepción';
  exception when others then
    raise notice 'E10 PASS: % [%]', sqlerrm, sqlstate;
  end;

  ---------------------------------------------------------------------------
  -- E11 — APPEND-ONLY
  ---------------------------------------------------------------------------
  begin
    delete from public.rrhh_solicitud_eventos where solicitud_id = v_sol;
    raise notice 'E11a FAIL: DELETE en eventos fue permitido';
  exception when others then
    raise notice 'E11a PASS (DELETE eventos): % [%]', sqlerrm, sqlstate;
  end;

  begin
    update public.rrhh_novedades set cantidad = 999 where origen_solicitud_id = v_sol;
    raise notice 'E11b FAIL: UPDATE en novedades fue permitido';
  exception when others then
    raise notice 'E11b PASS (UPDATE novedades): % [%]', sqlerrm, sqlstate;
  end;

  raise notice '=== FIN E8-E11 — se hará ROLLBACK (cero persistencia) ===';
end
$outer$;

ROLLBACK;
```

---

## Resultado esperado (en *Messages*)

```
NOTICE:  FIXTURES OK: emp=… sup=… rrhh_user=…
NOTICE:  E8 PASS: SOL-2026-000001 estado=aprobada novedades=1
NOTICE:  E9 PASS: ACCESS_DENIED: solo el supervisor directo aprueba L1 [42501]
NOTICE:  E10 PASS: ACCESS_DENIED: requiere rrhh.edit [42501]
NOTICE:  E11a PASS (DELETE eventos): RRHH es append-only: DELETE no permitido en rrhh_solicitud_eventos [2F004/restrict_violation]
NOTICE:  E11b PASS (UPDATE novedades): RRHH append-only: UPDATE no permitido en rrhh_novedades [restrict_violation]
NOTICE:  === FIN E8-E11 — se hará ROLLBACK (cero persistencia) ===
ROLLBACK
```

---

## Evidencia a capturar (pegar la salida real)

| Prueba | Esperado | NOTICE real | PASS/FAIL |
|--------|----------|-------------|-----------|
| E8 flujo feliz | `E8 PASS … estado=aprobada novedades=1` | _____ | ☐ |
| E9 denegación L1 | `E9 PASS … ACCESS_DENIED [42501]` | _____ | ☐ |
| E10 denegación L2 | `E10 PASS … ACCESS_DENIED [42501]` | _____ | ☐ |
| E11a DELETE eventos | `E11a PASS … append-only` | _____ | ☐ |
| E11b UPDATE novedades | `E11b PASS … append-only` | _____ | ☐ |
| Cierre | `ROLLBACK` (sin persistencia) | _____ | ☐ |

---

## Notas
- **ROLLBACK es obligatorio.** No cambiar por `COMMIT`: dejaría empleados/solicitudes/novedades de
  prueba imposibles de borrar (append-only).
- Si aparece `PRECOND: …` → faltan precondiciones (rol `rrhh_manager` o ≥3 usuarios no-admin sin
  legajo); resolver antes de re-ejecutar.
- Las denegaciones (E9/E10) y el append-only (E11) se capturan con `BEGIN/EXCEPTION` para que un error
  esperado **no aborte** el resto del script.
- Si **E8–E11 = PASS** → `WORKFLOW FOUNDATION COMPLETE · READY FOR R5`. Si alguno FALLA → `R4 OPEN` +
  documentar causa.

*Paquete E8–E11 — no ejecutado por mí (sin acceso a la base). Construido contra el esquema real; correr en tx con ROLLBACK.*
