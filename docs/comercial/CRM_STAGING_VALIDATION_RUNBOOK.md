# CRM_STAGING_VALIDATION_RUNBOOK

**Objetivo:** validar el dominio CRM Comercial completo en **staging**, sin tocar producción, de forma que **cualquier técnico** pueda ejecutarlo paso a paso sin contexto histórico.
**Script:** `supabase/tests/CRM_STAGING_VALIDATION.sql`
**Fecha:** 2026-06-04 · **Etapa:** post F2.1-GATE, pre F2.1-4.

> Reglas: **NO producción. NO activar `committed_m2`. NO crear tablas nuevas. NO modificar migraciones.** El script es **no destructivo** (corre en una transacción que termina en `ROLLBACK`).

---

## 0. Qué se valida (resumen)

| Sección | Verifica |
|---|---|
| 0 Preflight | 10 tablas, 10 enums, vista `profiles_public`, RLS habilitada |
| 1 public_id | triggers LEAD-/OPP-/COT-/PROP-/CON-/ONB- |
| 2 FK | insert con `opportunity_id` inexistente → rechazado |
| 3 Contract restrict (R-G1) | borrar oportunidad **con contrato** → bloqueado |
| 4 Cascade | borrar oportunidad **sin contrato** → cascada a hijos |
| 5 Enums / Unique | enum inválido y duplicados rechazados |
| 6 Fixtures RBAC | crea 5 usuarios de prueba (comercial/sin-perm/admin/operaciones/cliente) + diagnóstico RLS de tablas RBAC |
| 7 RBAC (R-G2) | `has_permission()` por usuario: comercial=✓ · sin-perm=✗ · admin=✓(bypass) · **operaciones=✓** · **cliente=✗** |
| 8 RLS enforcement | **comercial** insert✓ · sin-perm insert✗ · **operaciones** insert✓ / delete✗(solo admin) · **cliente** insert✗ / SELECT=0 · comercial SELECT>0 |
| 9 Ledger | UPDATE en `crm_stage_history` bloqueado (inmutable) |
| 10 profiles_public (R-G3) | sin email + legible por `authenticated` |
| 11 Hook capacidad | `committed_state` default `none`, enum 4 capas, sin trigger que lo auto-mueva (hook inactivo) |

---

## 1. Prerrequisitos

1. Entorno **STAGING** de Supabase (NUNCA producción). Confirmá el proyecto antes de continuar.
2. Migraciones base **0001–0040 ya aplicadas** en staging (es el estado normal de staging).
3. Acceso al **SQL Editor** de Supabase staging (rol `postgres`) o `psql` con la connection string de staging.
4. Las migraciones CRM `0041`–`0046` disponibles en el repo (rama `feature/crm-comercial-f2-1`).

---

## 2. Paso 1 — Aplicar las migraciones CRM (orden estricto)

Aplicar **en este orden** (cada una depende de la anterior). Vía Supabase CLI o pegando el contenido en el SQL Editor:

```
0041_crm_enums.sql            # enums
0042_crm_core.sql             # crm_leads, crm_opportunities (+ FK circular por ALTER)
0043_crm_quotes_proposals.sql # crm_quotes (+items), crm_proposals
0044_crm_contracts_onboarding.sql  # crm_contracts (restrict), crm_onboarding (+tasks)
0045_crm_sync_audit.sql       # crm_stage_history, clientify_sync_log (ledgers)
0046_crm_rbac_seed.sql        # permisos comercial.* + vista profiles_public
```

Con Supabase CLI (recomendado si staging está linkeado):
```
supabase db push   # aplica las migraciones pendientes a la DB linkeada (verificá que sea STAGING)
```
O manual: abrir cada archivo y ejecutarlo en orden en el SQL Editor. Cada uno termina con `notify pgrst, 'reload schema';`.

**Checkpoint:** ninguna debe arrojar error. Si 0042 falla por la FK circular, confirmar que se ejecutó **completa** (la FK `crm_leads.opportunity_id` se agrega con un `ALTER` al final).

---

## 3. Paso 2 — Ejecutar la validación

Pegar y ejecutar **todo** `supabase/tests/CRM_STAGING_VALIDATION.sql` en el SQL Editor de staging (o `psql -f`).

- Corre dentro de `BEGIN … ROLLBACK`: **no deja datos**.
- Al final imprime **dos resultados**:
  1. Tabla detallada: `section | test | resultado(PASS/FAIL) | detail`.
  2. Resumen: `total | passed | failed`.

---

## 4. Paso 3 — Interpretar resultados

**Criterio de éxito:** `failed = 0`. Revisar fila por fila las que digan `FAIL`.

### Tests críticos (no pueden fallar)
| Test | Significado si FALLA |
|---|---|
| **7 · has_permission(view)=TRUE para comercial [R-G2]** | 🔴 El RLS comercial NO funciona (las tablas RBAC no son legibles bajo `authenticated`). **Bloquea el gate.** Ver §6. |
| **7 · =TRUE para operaciones / =FALSE para cliente** | 🔴 El mapeo de roles RBAC (0046) no quedó bien, o has_permission falla. |
| **8 · INSERT permitido a comercial/operaciones** | 🔴 Mismo origen que R-G2 (has_permission falla) o falta grant. |
| **8 · INSERT denegado a sin-permiso/cliente** | 🔴 La RLS no está enforcando (riesgo de seguridad). |
| **8 · DELETE denegado a operaciones** | 🟠 El delete debe ser solo admin; si pasa, la RLS de delete está mal. |
| **8 · SELECT cliente = 0 filas** | 🔴 Un cliente NO debe ver datos comerciales (fuga). |
| **3 · delete opp con contrato bloqueado** | 🔴 R-G1 no quedó en `restrict` (revisar 0044). |
| **9 · UPDATE ledger bloqueado** | 🟠 Los ledgers no son inmutables. |
| **10 · authenticated lee profiles_public [R-G3]** | 🟠 La vista no es SECURITY DEFINER → devuelve 0 filas. Ver §7. |
| **11 · committed_state default=none / sin trigger** | 🟠 El hook de capacidad NO está dormido en la capa de datos (no debe haber auto-movimiento antes de F2.1-4). |

### Tests informativos
- **6 · [diag] tablas RBAC con RLS:** si es `>0`, significa que `user_roles`/`permissions`/`role_permissions` tienen RLS; entonces el test 7 confirma si `authenticated` igualmente puede leerlas (si 7 pasa, está bien). Si 7 falla y el diag es `>0`, ese es el origen.

---

## 5. Troubleshooting — Fixtures RBAC (sección 6 del script)

Si la fila **"6 · fixtures creados"** sale `FAIL` con un error de `auth.users`:
- El esquema de `auth.users` varía entre versiones de Supabase (columnas NOT NULL distintas).
- Ajustá el `insert into auth.users (...)` de la sección 6 del SQL para incluir las columnas que tu staging exige (p. ej. `confirmation_token`, `recovery_token` con `''`). El `detail` de la fila muestra el `SQLERRM` exacto.
- Las secciones 0–5 (preflight, public_id, FK, restrict, cascade, enums, unique) **no dependen de fixtures** y deben pasar igual.

---

## 6. Si R-G2 falla (has_permission bajo `authenticated`)

Causa: `has_permission()` es `language sql stable` (no `security definer`); lee `user_roles/role_permissions/permissions` con privilegios del caller. Si esas tablas tienen RLS que **no** deja al usuario ver sus propias filas, devuelve `false`.

Remediación (a decidir, **fuera de este runbook** — no se modifica nada acá):
- **Opción 1:** marcar `has_permission()` como `SECURITY DEFINER` (cambio en una migración nueva, con su gate).
- **Opción 2:** agregar policies de lectura en `user_roles/role_permissions/permissions` que permitan al usuario leer sus propias asignaciones.
- Cuál corresponde depende de cómo esté hoy el RBAC en staging (lo revela el diagnóstico de la sección 6).

> Esto es exactamente lo que el gate quería descubrir **antes** de producción.

---

## 7. Si R-G3 falla (profiles_public vacía para authenticated)

La vista debe ser **SECURITY DEFINER** (owner `postgres`) para saltar el lockdown de `profiles` (0040) y exponer solo `id, full_name`. Si tu Supabase crea vistas con `security_invoker=true` por default, devolverá 0 filas a no-admin.
- Remediación (migración nueva, fuera de este runbook): `alter view public.profiles_public set (security_invoker = false);` o recrearla con el owner adecuado.

---

## 8. Criterios de salida (gate a F2.1-4)

| Condición | Estado requerido |
|---|---|
| `failed = 0` en el resumen | ✅ obligatorio |
| Test R-G2 (has_permission comercial + operaciones) | ✅ PASS |
| RLS por rol (comercial/operaciones/cliente) | ✅ PASS |
| Acceso cliente (insert✗ / SELECT=0) | ✅ PASS |
| Test R-G1 (contract restrict) | ✅ PASS |
| Tests RLS enforcement (8) | ✅ PASS |
| Ledger inmutable (9) | ✅ PASS |
| profiles_public (10) | ✅ PASS |
| Hook capacidad dormido (11) | ✅ PASS |

- **Si todo PASS:** el dominio CRM está validado en staging → **autorizar F2.1-4** (activar `committed_m2`).
- **Si hay FAIL:** corregir vía **migración nueva** (no editar las 0041–0046 ya aplicadas en staging; agregar `0047_*` correctivo), re-validar, y recién entonces avanzar.

---

## 9. Seguridad y alcance

- ✅ **No destructivo:** todo en `BEGIN … ROLLBACK`; los datos de prueba (incluidos los 3 usuarios `*@crmval.test`) **no persisten**.
- ✅ **No toca producción** (ejecutar solo en staging).
- ✅ **No activa `committed_m2`** ni crea tablas nuevas.
- ✅ Reejecutable las veces que haga falta (idempotente por el rollback).

---

## 10. Checklist rápido (para pegar en el ticket)

```
[ ] Confirmado entorno = STAGING (no PROD)
[ ] Aplicadas 0041 → 0046 en orden, sin error
[ ] Ejecutado CRM_STAGING_VALIDATION.sql
[ ] Resumen: failed = 0
[ ] R-G2 (has_permission comercial + operaciones) = PASS
[ ] RLS comercial / operaciones / cliente = PASS
[ ] Acceso cliente bloqueado (insert✗ / SELECT=0) = PASS
[ ] R-G1 (contract restrict) = PASS
[ ] RLS enforcement (insert/delete allow/deny) = PASS
[ ] Ledger inmutable = PASS
[ ] profiles_public legible y sin email = PASS
[ ] Hook capacidad dormido (committed_state=none) = PASS
[ ] (si falla algo) → migración correctiva 0047_* + re-validar
[ ] Gate verde → autorizar F2.1-4 (committed_m2)
```
