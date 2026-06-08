# RBAC-BLOCKERS-RESOLUTION

**Fecha:** 2026-06-08 · **Modo:** read-only. **No se ejecutó nada, no se activó RBAC, no se tocó producción.**
**Complementa:** `RBAC-ACTIVATION-PLAN.md` y `RBAC-EXECUTIVE-ACCESS-MATRIX.md`.

---

## 1) Resolución de usuarios — SUPER_ADMIN

Asignar `super_admin` a **ambas** cuentas:

| Email | Estado (auth.users) | Decisión |
|---|---|---|
| martin@logisticatops.com | ✅ confirmado · último login 2026-06-07 | `super_admin` (cuenta administrativa **primaria/activa**) |
| martin.battaglia@logisticatops.com | ⚠️ **sin confirmar · sin login histórico** | `super_admin` (cuenta administrativa **redundante/contingencia**) |

**Documentado:** `martin.battaglia@` se mantiene prevista como **super_admin redundante** pese a estar sin confirmar y sin login. 
**Nota de seguridad (no bloqueante, informativa):** mientras esté sin confirmar no puede iniciar sesión, por lo que el privilegio queda **latente**; conviene confirmarla/activarla cuando se vaya a usar, y revisar periódicamente que una segunda cuenta super_admin durmiente no sea un vector ocioso.

```sql
-- (reemplaza el bloque de super_admin del plan §3)
insert into public.user_roles (user_id, role_id)
select u.id, r.id
from auth.users u, public.roles r
where r.slug='super_admin'
  and u.email in ('martin@logisticatops.com','martin.battaglia@logisticatops.com')
on conflict (user_id, role_id) do nothing;
```

---

## 2) Resolución de depósitos

| Email | Estado (auth.users) | Rol | depot | Acción |
|---|---|---|---|---|
| despachos-lujan@logisticatops.com | ⚠️ sin confirmar · sin login | `jefe_deposito_anexa` | **LUJAN** | **Confirmado** mapeo (asignable ya) |
| despachos-magaldi@logisticatops.com | ❌ **NO existe en auth.users** | `jefe_deposito_central` | **MAGALDI** | **Crear la cuenta primero**, luego asignar |

> Verificación: de los 7 usuarios actuales, `despachos-magaldi@` **no está**. El rol `jefe_deposito_central` se crea igual; la asignación queda pendiente del alta del usuario.

```sql
-- JEFE_DEP_ANEXA (asignable ya)
insert into public.user_roles (user_id, role_id, depot)
select u.id, r.id, 'LUJAN'
from auth.users u, public.roles r
where u.email='despachos-lujan@logisticatops.com' and r.slug='jefe_deposito_anexa'
on conflict (user_id, role_id) do nothing;

-- JEFE_DEP_CENTRAL — EJECUTAR SOLO DESPUÉS de crear despachos-magaldi@logisticatops.com
insert into public.user_roles (user_id, role_id, depot)
select u.id, r.id, 'MAGALDI'
from auth.users u, public.roles r
where u.email='despachos-magaldi@logisticatops.com' and r.slug='jefe_deposito_central'
on conflict (user_id, role_id) do nothing;
```

### Matriz ejecutiva actualizada
```
martin@logisticatops.com            → SUPER_ADMIN (primaria, activa)
martin.battaglia@logisticatops.com  → SUPER_ADMIN (redundante; sin confirmar / sin login)
joseluis@logisticatops.com          → ADMIN_OPERATIVO
cynthia@logisticatops.com           → GERENCIA_COMERCIAL
martinrinas@logisticatops.com       → GERENCIA_COMERCIAL
ruth@logisticatops.com              → ADMIN_FINANZAS
despachos-lujan@logisticatops.com   → JEFE_DEP_ANEXA  (Luján)
despachos-magaldi@logisticatops.com → JEFE_DEP_CENTRAL (Magaldi)  ❗ crear cuenta antes de asignar
```

---

## 3) Estado real de "Mi Espacio"

Auditoría de las 5 dimensiones:

| Dimensión | Estado | Evidencia |
|---|---|---|
| **Permiso (RBAC)** | ❌ **NO existe** | `permissions` no tiene `mi_espacio.*` (52 perms, ninguno mi_espacio). Solo está como tipo en `src/lib/rbac/types.ts` (código). |
| **Ruta** | ✅ **Existe (x2)** | `src/app/(app)/workspace/page.tsx` y `src/app/(app)/rrhh/mi-espacio/page.tsx`. |
| **Guard** | ❌ **NO tiene** | Ninguna de las dos páginas llama `checkPermission` ni valida permiso. |
| **Menú** | ✅ **Existe** | Sidebar: "Accesos Google" → `/workspace`; "Mi espacio" → `/rrhh/mi-espacio`. |
| **Backend** | 🟡 **Página sí, permiso no** | Existe la page (UI); referencias a `mi_espacio` solo en `types.ts` + comentario. No hay permiso/endpoint RBAC dedicado. |

### Respuestas explícitas

> **¿Mi Espacio existe realmente?**
> **Parcialmente.** Existe como **ruta + menú + página** (`/rrhh/mi-espacio`, `/workspace`). **NO existe como permiso RBAC** (`mi_espacio.view` no está en la DB) ni tiene guard.

> **¿Está operativo?**
> **Como superficie navegable: sí** — hoy es accesible para cualquier usuario autenticado (no tiene gate; con RBAC fail-open, todos entran).
> **Como permiso RBAC controlable: no** — no se puede conceder ni restringir por rol porque el permiso no existe y la ruta no está gateada.

> **¿O forma parte únicamente de la matriz conceptual?**
> El **permiso** `mi_espacio.view` es **conceptual** (solo en código, revertido del split, ausente en DB). La **funcionalidad/página** es real pero **sin control de acceso**.

### Implicación para la activación (importante)
- Como `/rrhh/mi-espacio` **no tiene guard**, al activar `RBAC_ENFORCE=1` **nadie pierde** Mi Espacio (sigue abierto). → El "bloqueante Mi Espacio" del informe previo **se relaja**: no hay riesgo de subpermiso para el legajo propio.
- **Pero** el reverso: el **módulo RRHH completo** (`/rrhh/empleados`, `/rrhh/novedades`, etc.) **tampoco tiene guards** (cobertura `checkPermission` ≈ solo analytics/cuentas_pagar/drive). Por lo tanto, hoy un rol limitado **podría ver TODO RRHH**, no solo Mi Espacio. La restricción "solo Mi Espacio" **no es enforceable** hasta agregar guards a las páginas/APIs de RRHH.

---

## 4) Recomendación final

**Para activar (orden sugerido):**
1. **Crear `despachos-magaldi@logisticatops.com`** (Reynoso) antes de la activación, o activar dejando `jefe_deposito_central` sin usuario (función Magaldi sin responsable hasta el alta).
2. **Confirmar `despachos-lujan@`** (Merino) y, si la cuenta `martin.battaglia@` se va a usar, confirmarla; si es solo contingencia, dejarla documentada como super_admin latente.
3. Aplicar roles + grants + asignaciones (plan §1-§3 con los bloques SQL de arriba ya resueltos).

**Sobre Mi Espacio — elegir UNA política antes de enforce:**
- **Opción A (recomendada):** crear el permiso `mi_espacio.view`, gatear `/rrhh/mi-espacio` (y `/workspace`) por él, y **gatear el resto de `/rrhh/*` por `rrhh.*`**. Así "solo Mi Espacio" para roles limitados queda **realmente enforced**. (Requiere agregar guards = trabajo de código, no solo SQL.)
- **Opción B (interino):** dejar Mi Espacio abierto (como hoy) y **agregar guards a las páginas sensibles de RRHH** (`rrhh.view`/`rrhh.admin`) para que los limitados no vean datos de terceros. Mi Espacio queda accesible a todos (aceptable).

**Expectativa honesta de la activación:** el RBAC será efectivo **solo donde hay guard**. Hoy RRHH (y ~19-20/23 APIs) **no** tienen guard → activar `RBAC_ENFORCE=1` **no** restringe esas superficies. La activación de roles/asignaciones es correcta y necesaria, pero **el enforcement real requiere además agregar guards** (fase de código posterior).

> **No se ejecutó nada.** Pendiente tu aprobación + las 2 decisiones: (a) alta de `despachos-magaldi@`, (b) política de Mi Espacio/RRHH (Opción A vs B).
