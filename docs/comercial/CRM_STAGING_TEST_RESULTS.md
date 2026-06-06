# CRM_STAGING_TEST_RESULTS — CRM Comercial F2.1

**Fase:** 3 — Ejecución de `CRM_STAGING_VALIDATION.sql` · **Entorno:** staging (no destructivo, `BEGIN…ROLLBACK`)
**Fecha:** 2026-06-06

---

## 1. Resumen

| Corrida | Total | PASS | FAIL | Estado |
|---|---|---|---|---|
| **1ª** (harness original) | 45 | 36 | 9 | choque con trigger `handle_new_user` (§3) |
| **2ª** (harness Opción A) | **46** | **46** | **0** | ✅ **`failed = 0`** |

> **Resultado final autoritativo: 46/46 PASS (`failed = 0`).** La 1ª corrida detectó que el **script de validación** chocaba con el trigger `on_auth_user_created → handle_new_user` de staging (no era defecto del dominio). Corregido el **harness** (Opción A: insertar `auth.users`, dejar que el trigger cree el profile, `UPDATE` del role), la 2ª corrida pasó completa, **confirmando R-G2**.

### Re-ejecución (2ª corrida) — confirmaciones clave
- `6-fixtures`: **5/5 profiles** ✅
- `7-rbac` **[R-G2]**: comercial `val=true` ✅ · operaciones `true` · admin `true` (bypass) · sin-permiso `false` · cliente `false`
- `8-rls`: INSERT permitido a comercial **y** operaciones ✅ · DELETE denegado a operaciones · cliente insert✗ / SELECT=0 · comercial SELECT=7 filas

> El resto de esta sección documenta la **1ª corrida** (trazabilidad de cómo se detectó y resolvió el problema del harness).

## 2. Resultados por sección

| Sección | PASS | FAIL | Detalle |
|---|---|---|---|
| 0 · Preflight (tablas/enums/vista/RLS) | 13 | 0 | 10 tablas + 10 enums + vista + RLS×10 ✅ |
| 1 · public_id triggers | 6 | 0 | LEAD-2026-0001, OPP-, COT-, PROP-, CON-, ONB- ✅ |
| 2 · FK integridad | 1 | 0 | quote con opp inexistente → rechazado ✅ |
| 3 · Contract RESTRICT (R-G1) | 1 | 0 | delete opp con contrato → **bloqueado** ✅ |
| 4 · Cascade | 1 | 0 | delete opp sin contrato → cascada ✅ |
| 5 · Enums / Unique | 3 | 0 | enum inválido + 2 uniques rechazados ✅ |
| 6 · Fixtures RBAC | 1 | **1** | diag RBAC ✅ · **creación de fixtures FALLA** (causa raíz) |
| 7 · RBAC has_permission | 0 | **5** | **inconcluso** (sin fixtures) — incl. R-G2 |
| 8 · RLS enforcement | 4 | **3** | denegaciones ✅; permisos a comercial/operaciones inconclusos |
| 9 · Ledger inmutable | 1 | 0 | update crm_stage_history → 0 filas ✅ |
| 10 · profiles_public (R-G3) | 2 | 0 | sin email + 5 filas legibles ✅ |
| 11 · Hook capacidad | 3 | 0 | committed_state=none, enum 4 capas, sin trigger ✅ |

## 3. Causa raíz de los 9 FAIL (confirmada)

**Staging tiene el trigger `on_auth_user_created → handle_new_user` en `auth.users`**, que **auto-crea una fila en `profiles`** al insertar un usuario. El script de validación inserta `auth.users` (5) y **luego** `profiles` (5) explícitamente → el trigger ya creó esos 5 profiles → **colisión `duplicate key ... profiles_pkey`** → la sección 6 (fixtures) aborta y revierte sus inserts.

**Consecuencia en cadena:** sin los 5 usuarios de prueba, las secciones 7 (RBAC) y los tests de "permitido" de la sección 8 **no pueden evaluarse**:
- Sección 7: `has_permission()` se evalúa contra usuarios inexistentes → devuelve `null` (el bypass `current_role()='admin'` es `null` sin profile) → los 5 tests fallan.
- Sección 8: "INSERT permitido a comercial/operaciones" → denegado (sus permisos no existen) → fallan; "SELECT comercial >0" → 0 filas.

> **Importante:** esto es un defecto del **harness de validación** frente a la configuración de `auth` de staging (el trigger `handle_new_user`). **NO es un defecto del dominio CRM, ni de las migraciones, ni del RLS.** Las denegaciones de la sección 8 (sin-permiso/cliente) **sí pasaron**, lo que confirma que la RLS **deniega** correctamente.

## 4. Detalle de los 9 FAIL

| Sección | Test | Detalle del error |
|---|---|---|
| 6-fixtures | fixtures creados | `duplicate key value violates unique constraint "profiles_pkey"` |
| 7-rbac | has_permission TRUE comercial **[R-G2]** | sin fixture → `null` |
| 7-rbac | has_permission TRUE operaciones | sin fixture → `null` |
| 7-rbac | has_permission TRUE admin (bypass) | sin fixture → `null` (sin profile, current_role()=null) |
| 7-rbac | has_permission FALSE sin-permiso | devolvió `null`, no `false` |
| 7-rbac | has_permission FALSE cliente | devolvió `null`, no `false` |
| 8-rls | INSERT permitido a comercial | `new row violates RLS` (permiso inexistente) |
| 8-rls | INSERT permitido a operaciones | `new row violates RLS` (permiso inexistente) |
| 8-rls | SELECT comercial ve filas (>0) | `filas=0` (permiso inexistente) |

## 5. Dato clave para el análisis (R-G2)

El diagnóstico de la sección 6 reportó: **`tablas RBAC con RLS = 3`** (`user_roles`, `role_permissions`, `permissions` tienen RLS habilitada). Esto significa que **R-G2 es un riesgo real y vigente**: `has_permission()` (que no es `security definer`) podría no leer esas tablas bajo el rol `authenticated`. **R-G2 quedó SIN VERIFICAR** porque los fixtures no se crearon — debe re-testearse tras corregir el harness.

## 6. Tests que SÍ se validaron en staging (verde)

- ✅ Estructura: 10 tablas, 10 enums, vista, RLS habilitada.
- ✅ **public_id** (los 6).
- ✅ **R-G1** (contract RESTRICT).
- ✅ FK, cascade, enums, uniques.
- ✅ **Ledgers inmutables**.
- ✅ **R-G3** (profiles_public sin email, legible por authenticated — 5 filas).
- ✅ **Hook de capacidad dormido** (committed_state=none, sin trigger).
- ✅ RLS **deniega** a sin-permiso y a cliente (insert✗, SELECT=0).
