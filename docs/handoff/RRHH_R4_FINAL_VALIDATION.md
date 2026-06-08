# TOPS NEXUS — RRHH · R4 FINAL WORKFLOW VALIDATION (E8–E11)

> **Tipo:** protocolo de validación runtime del workflow (E8–E11). **No** ejecutado desde este
> entorno (sin acceso a `arsksytgdnzukbmfgkju`: sin link/token/psql/.env). Entrega el **script
> ejecutable + plantilla de captura**; el veredicto se emite con evidencia real.
> **Estado previo:** E1–E7, E12 = PASS (estructura, atestación). Pendientes: **E8–E11** (runtime).
> **Fecha:** 2026-06-07.

---

## 0. ⚠️ Salvaguarda obligatoria: ZERO PERSISTENCE

Las tablas RRHH son **append-only** (`tg_forbid_delete_rrhh`): un empleado/solicitud/novedad de
prueba **no se puede borrar**. Por lo tanto:

- **E8–E11 se ejecutan dentro de una transacción `BEGIN … ROLLBACK`** → cero persistencia (patrón
  E2E de ERP-A: "validación real con cero persistencia"). **No** usar `COMMIT`.
- Alternativa: ejecutar en **staging**, no en producción.
- Las RPCs son `security definer` y validan `auth.uid()`/`has_permission`. Para simular cada actor se
  usa `set_config('request.jwt.claims', json_build_object('sub', <uuid>)::text, true)` dentro de la
  misma tx (así `auth.uid()` devuelve el uuid simulado). Los `user_roles` de prueba se siembran y
  revierten en el mismo ROLLBACK.

> Si el SQL Editor no permite `BEGIN/ROLLBACK` multi-statement, ejecutar el bloque como un único
> `do $$ … raise exception 'ROLLBACK_OK' … $$;` que aborta al final (revierte todo por excepción).

---

## 1. Fixtures de prueba (dentro de la tx que se revierte)

Requiere 3 identidades simuladas (UUIDs cualquiera; **no** necesitan existir en `auth.users` para que
`auth.uid()` los devuelva, pero `rrhh_empleados.profile_id → profiles(id)` **sí** exige que el
`profile_id` exista en `profiles`). Opciones:
- **(a)** usar `profile_id = NULL` en los empleados de prueba y ejercer los caminos por **permiso**
  (no por propiedad) — limita E8 (ownership). 
- **(b, recomendada)** usar 3 `profiles` reales existentes de test (o crearlos en la tx y revertir),
  y asignarles roles temporales.

```sql
-- === EJECUTAR TODO DENTRO DE UNA TRANSACCIÓN QUE SE REVIERTE ===
begin;

-- IDs de prueba (reemplazar por profiles reales de test, o crear+revertir):
--   :uid_emp  = empleado solicitante (profile)
--   :uid_sup  = supervisor directo (profile)
--   :uid_rrhh = usuario RRHH con rol rrhh_manager/admin (profile)

-- Empleados de prueba (profile_id debe existir en profiles):
insert into public.rrhh_empleados (apellido_nombre, dni, cuil, fecha_ingreso, profile_id)
values ('TEST Supervisor', 'TESTSUP', 'TESTSUP', current_date, :uid_sup)
returning id;  -- → :emp_sup

insert into public.rrhh_empleados (apellido_nombre, dni, cuil, fecha_ingreso, profile_id, supervisor_id)
values ('TEST Empleado', 'TESTEMP', 'TESTEMP', current_date, :uid_emp, :emp_sup)
returning id;  -- → :emp_emp

-- Rol RRHH temporal para :uid_rrhh (rrhh_manager → tiene rrhh.edit):
insert into public.user_roles (user_id, role_id)
select :uid_rrhh, r.id from public.roles r where r.slug = 'rrhh_manager'
on conflict do nothing;
```

---

## 2. E8 — Flujo feliz (crear → enviar → aprobar_l1 → aprobar_l2)

```sql
-- (1) crear como EMPLEADO dueño
select set_config('request.jwt.claims', json_build_object('sub', :uid_emp)::text, true);
select public.rrhh_solicitud_crear(:emp_emp, 'permiso', 'medico', current_date, current_date,
  'control médico', 1) as solicitud_id;   -- → :sol

select id, public_id, estado from public.rrhh_solicitudes where id = :sol;  -- estado = borrador

-- (2) enviar (dueño)
select public.rrhh_solicitud_enviar(:sol);
select estado from public.rrhh_solicitudes where id = :sol;  -- estado = pendiente_supervisor

-- (3) aprobar_l1 como SUPERVISOR
select set_config('request.jwt.claims', json_build_object('sub', :uid_sup)::text, true);
select public.rrhh_solicitud_aprobar_l1(:sol, 'ok jefe');
select estado from public.rrhh_solicitudes where id = :sol;  -- estado = pendiente_rrhh

-- (4) aprobar_l2 como RRHH (rrhh_manager)
select set_config('request.jwt.claims', json_build_object('sub', :uid_rrhh)::text, true);
select public.rrhh_solicitud_aprobar_l2(:sol, 'aprobado RRHH');
select estado from public.rrhh_solicitudes where id = :sol;  -- estado = aprobada
```
**Esperado:** `estado = aprobada`; `public_id` con formato `SOL-AAAA-NNNNNN`.

## 3. E8b — Novedad (exactamente 1 fila asociada)
```sql
select count(*) as novedades, max(tipo) as tipo, max(cantidad) as cantidad
from public.rrhh_novedades where origen_solicitud_id = :sol;
```
**Esperado:** `novedades = 1`, `tipo = permiso`, `cantidad = 1`.

## 4. E9 — Denegación L1 (usuario que NO es el supervisor)
```sql
-- nueva solicitud llevada a pendiente_supervisor, luego intentar L1 como el propio empleado
select set_config('request.jwt.claims', json_build_object('sub', :uid_emp)::text, true);
select public.rrhh_solicitud_crear(:emp_emp,'permiso','otro',current_date,current_date,'x',1) as s2;
select public.rrhh_solicitud_enviar(:s2);
-- intentar aprobar_l1 como el empleado (no es supervisor):
select public.rrhh_solicitud_aprobar_l1(:s2);
```
**Esperado:** `ERROR: ACCESS_DENIED … solo el supervisor directo aprueba L1` (errcode 42501).

## 5. E10 — Denegación L2 (sin rrhh.edit)
```sql
-- llevar :s2 a pendiente_rrhh (aprobar L1 como supervisor), luego L2 como el empleado (sin rrhh.edit)
select set_config('request.jwt.claims', json_build_object('sub', :uid_sup)::text, true);
select public.rrhh_solicitud_aprobar_l1(:s2);
select set_config('request.jwt.claims', json_build_object('sub', :uid_emp)::text, true);
select public.rrhh_solicitud_aprobar_l2(:s2);
```
**Esperado:** `ERROR: ACCESS_DENIED … requiere rrhh.edit` (errcode 42501).

## 6. E11 — Append-only
```sql
-- DELETE sobre eventos (debe fallar)
delete from public.rrhh_solicitud_eventos where solicitud_id = :sol;
-- → ERROR: RRHH es append-only: DELETE no permitido en rrhh_solicitud_eventos

-- UPDATE sobre novedades (debe fallar)
update public.rrhh_novedades set cantidad = 999 where origen_solicitud_id = :sol;
-- → ERROR: RRHH append-only: UPDATE no permitido en rrhh_novedades
```
**Esperado:** ambos ERROR (`restrict_violation`).

## 7. Cierre de la transacción
```sql
rollback;   -- OBLIGATORIO: cero persistencia (las tablas son append-only)
```

---

## 8. Plantilla de captura de evidencia (a completar por quien ejecuta)

| Prueba | Esperado | Resultado real | PASS/FAIL |
|--------|----------|----------------|-----------|
| E8 estado final | `aprobada` | _____ | ☐ |
| E8 public_id formato | `SOL-AAAA-NNNNNN` | _____ | ☐ |
| E8b novedad | 1 fila (permiso, 1) | _____ | ☐ |
| E9 aprobar_l1 (no supervisor) | ACCESS_DENIED 42501 | _____ | ☐ |
| E10 aprobar_l2 (sin rrhh.edit) | ACCESS_DENIED 42501 | _____ | ☐ |
| E11 DELETE eventos | ERROR append-only | _____ | ☐ |
| E11 UPDATE novedades | ERROR append-only | _____ | ☐ |
| Transacción | `ROLLBACK` (cero persistencia) | _____ | ☐ |

---

## 9. Veredicto

> **PENDIENTE DE EJECUCIÓN — no se puede declarar sin evidencia.**

No tengo acceso a `arsksytgdnzukbmfgkju` desde este entorno, por lo que **no ejecuté E8–E11 ni
fabriqué resultados**. El protocolo está listo para correr (en tx con ROLLBACK, o staging).

- **Si E8–E11 PASS** (evidencia adjunta) → `WORKFLOW FOUNDATION COMPLETE · READY FOR R5`.
- **Si alguno FALLA** → `R4 OPEN` + documentar causa.

> Para que yo ejecute y capture E8–E11 directamente: habilitar acceso (link + `SUPABASE_ACCESS_TOKEN`,
> o connection string). Aun así, correría en **tx con ROLLBACK** (sin persistir) por el append-only.

---
*Protocolo de validación R4 — no ejecutado, sin tocar producción. Veredicto pendiente de evidencia real.*
