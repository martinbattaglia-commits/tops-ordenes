# RBAC-EXECUTIVE-ACCESS-MATRIX

**Fecha:** 2026-06-08 · **Modo:** auditoría read-only (no se ejecutó nada, no se tocó producción).
**Fuente:** Supabase productivo `arsksytgdnzukbmfgkju` (auth.users, profiles, roles, permissions, user_roles).

---

## 1) Resumen Ejecutivo

- **Estado actual del RBAC:** `user_roles = 0` → **fail-open**: hoy todo usuario autenticado ve todo (sin importar su rol). El control real recién existirá tras la activación (ver `RBAC-ACTIVATION-PLAN.md`).
- **Coexisten DOS sistemas de rol:**
  1. **`profiles.role`** (legacy 3-tier: `admin` / `supervisor` / `operaciones`) — lo que cada usuario tiene asignado HOY; lo usan guards/RLS legacy.
  2. **RBAC** (`roles` 11 slugs + `user_roles` 0 filas) — el modelo nuevo, **vacío de asignaciones**.
- **Roles objetivo (6) NO existen aún** en la DB. Este informe proyecta cómo quedaría cada usuario **si** se aplica el plan de activación.
- **7 usuarios reales.** 2 sin confirmar / nunca logueados (`martin.battaglia@`, `despachos-lujan@`). El super_admin activo real es **`martin@`**.
- **`natalia@` (del ejemplo) NO existe** → la de Administración y Finanzas es **`ruth@`**.

---

## 2) Usuarios (estado real)

| Email | Nombre | Estado cuenta | Último login | Rol ACTUAL (profiles.role) | Permisos RBAC actuales |
|---|---|---|---|---|---|
| martin@logisticatops.com | (Presidencia) | ✅ confirmado | 2026-06-07 | `admin` | ninguno (fail-open) |
| martin.battaglia@logisticatops.com | (Presidencia/operador) | ⚠️ **sin confirmar** | **nunca** | `operaciones` | ninguno (fail-open) |
| joseluis@logisticatops.com | José Luis | ✅ confirmado | 2026-05-27 | `operaciones` | ninguno (fail-open) |
| cynthia@logisticatops.com | Cynthia Alba | ✅ confirmado | 2026-05-28 | `supervisor` | ninguno (fail-open) |
| martinrinas@logisticatops.com | Martin Rinas | ✅ confirmado | 2026-05-26 | `supervisor` | ninguno (fail-open) |
| ruth@logisticatops.com | Ruth Carrasquero | ✅ confirmado | 2026-05-26 | `supervisor` | ninguno (fail-open) |
| despachos-lujan@logisticatops.com | Jorge Merino | ⚠️ **sin confirmar** | **nunca** | `operaciones` | ninguno (fail-open) |

> Todos `active=true`, `depot=null` en profiles. **Permisos RBAC actuales = ninguno para todos** (tabla `user_roles` vacía) ⇒ efectivamente fail-open.
> **No existe usuario para JEFE_DEP_CENTRAL** (Juan C. Reynoso / Magaldi).

---

## 3) Roles

### Legacy en `profiles.role` (3-tier, en uso hoy)
`admin` · `supervisor` · `operaciones` (+ `cliente`).

### Legacy en tabla `roles` (11, con 141 grants pero 0 asignaciones en user_roles)
`admin` · `comercial` · `director_ops` · `operaciones` · `seguridad` · `cliente_b2b` · `compliance` · `rrhh_admin` · `rrhh_manager` · `rrhh_viewer` · `employee_self_service`.

### Roles OBJETIVO (6 — aún NO en DB)
`super_admin` · `admin_operativo` · `gerencia_comercial` · `administracion_finanzas` · `jefe_deposito_central` · `jefe_deposito_anexa`.

---

## 4) Matriz Completa de Acceso (PROYECTADA post-activación)

Leyenda: ✅ total · 🟡 solo lectura/parcial · ❌ sin acceso

| Usuario | Rol Objetivo | Cockpit | CRM | Compras | Operac. | WMS | Finanzas | RRHH | Analytics | Google WS | Admin Usuarios | Seguridad | Mi Espacio |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| martin@ | SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| martin.battaglia@ | SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| joseluis@ | ADMIN_OPERATIVO | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ❌ | ❌ | ✅ |
| cynthia@ | GERENCIA_COMERCIAL | 🟡 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | 🟡 | ❌ | ❌ | ✅ |
| martinrinas@ | GERENCIA_COMERCIAL | 🟡 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | 🟡 | ❌ | ❌ | ✅ |
| ruth@ | ADMIN_FINANZAS | 🟡 | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | 🟡 | ❌ | ❌ | ✅ |
| despachos-lujan@ (Merino) | JEFE_DEP_ANEXA (LUJAN) | 🟡 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | 🟡 | ❌ | ❌ | ✅ |
| *(sin usuario)* | JEFE_DEP_CENTRAL (MAGALDI) | 🟡 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | 🟡 | ❌ | ❌ | ✅ |

**Notas de la matriz:**
- **Cockpit 🟡** (Comercial/Finanzas/Depósitos) = ven el **Cockpit operativo** (Vacancia, Accesos Google, CCTV, Tracking, Organigrama); **NO** los bloques financieros/ejecutivos (gate `cockpit.view`, solo super_admin + admin_operativo).
- **Finanzas (ADMIN_FINANZAS) ✅** = vía módulo **Tesorería/AP** (`tesoreria.*`, `cuentas_pagar.*`), no vía cockpit financiero.
- **Google WS 🟡** = "Accesos Google"/`/workspace` (operativo, sin gate). **Drive TOPS documental** (`compliance.view`) solo lo tienen super_admin + admin_operativo.
- **Mi Espacio ✅** = intención de diseño; **⚠️ aún NO enforced** (el permiso `mi_espacio.view` no existe en DB y `/rrhh/mi-espacio` se gatea hoy por RRHH — ver §6 y §7-Riesgos).
- **Analytics 🟡** para Comercial/Depósitos = en realidad ❌ del Analytics **ejecutivo** (`analytics.view` no concedido); se marca 🟡 solo por reportes comerciales dentro de su módulo. ADMIN_OPERATIVO/FINANZAS sí tienen `analytics.view` (✅).

---

## 4-bis) Matriz Ejecutiva Resumida

```
martin@logisticatops.com            → SUPER_ADMIN
martin.battaglia@logisticatops.com  → SUPER_ADMIN   (⚠️ cuenta sin confirmar / nunca logueó)
joseluis@logisticatops.com          → ADMIN_OPERATIVO
cynthia@logisticatops.com           → GERENCIA_COMERCIAL
martinrinas@logisticatops.com       → GERENCIA_COMERCIAL
ruth@logisticatops.com              → ADMIN_FINANZAS
despachos-lujan@logisticatops.com   → JEFE_DEP_ANEXA (Luján)  (⚠️ sin confirmar / nunca logueó)
(sin usuario)                       → JEFE_DEP_CENTRAL (Magaldi)  ❗ falta crear cuenta (Reynoso)
```

---

## 5) Cockpit — widgets por rol

| Rol | VE | NO VE |
|---|---|---|
| **SUPER_ADMIN** | Todo: Salud corporativa, Alertas, **Cash Flow (KPI maestro)**, Facturación, Cobranza, Ocupación, Vacancia, Leads, Vehículos, Cámaras, módulos estratégicos (incl. Analytics) | — |
| **ADMIN_OPERATIVO** | Todo el cockpit (igual que super_admin a nivel cockpit) | — (a nivel cockpit; sí pierde RBAC/seguridad fuera del cockpit) |
| **GERENCIA_COMERCIAL** | ✅ Vacancia · ✅ Accesos Google · ✅ Centro Monitoreo (CCTV) · ✅ Tracking · ✅ Organigrama · KPIs operativos/comerciales | ❌ Dashboard/Cash Flow · ❌ Facturación · ❌ Cobranza · ❌ EBITDA · ❌ Analytics Ejecutivo |
| **ADMIN_FINANZAS** | ✅ Vacancia · ✅ Accesos Google · ✅ CCTV · ✅ Tracking · ✅ Organigrama · KPIs operativos | ❌ bloques financieros DEL COCKPIT (Cash Flow/EBITDA estratégico) — su financiero lo ve en el **módulo Tesorería**, no en el cockpit |
| **JEFE_DEP_CENTRAL / ANEXA** | ✅ Vacancia · ✅ Accesos Google · ✅ CCTV · ✅ Tracking · ✅ Organigrama | ❌ todo lo financiero/ejecutivo · ❌ Analytics · ❌ CRM · ❌ Dashboard Ejecutivo |

> Implementación real: el gate es `cockpit.view` (lo tienen solo super_admin + admin_operativo). Los demás ven los bloques operativos (no gateados) y se les ocultan los financieros + los ítems exec del sidebar (`/ejecutivo`, `/analytics`).

---

## 6) RRHH

| Acceso | Usuarios |
|---|---|
| **RRHH total** (empleados, legajos, novedades, gestión) | SUPER_ADMIN (martin@, martin.battaglia@) |
| **RRHH solo lectura** | ADMIN_OPERATIVO (joseluis@) |
| **Solo "Mi Espacio"** (legajo propio) | gerencia_comercial (cynthia@, martinrinas@), administracion_finanzas (ruth@), jefes de depósito (Merino + Reynoso pendiente) |
| **Sin acceso a datos de terceros** | todos salvo los dos primeros grupos |

> ⚠️ **Gap de implementación:** "Mi Espacio" como permiso independiente **no existe en la DB** (`mi_espacio.view` fue solo código, revertido el split; `/rrhh/mi-espacio` hoy depende del módulo RRHH). Con los grants del plan, Comercial/Finanzas/Depósitos **no tienen `rrhh.*`** → quedarían **sin acceso ni a su propio Mi Espacio** salvo que: (a) se cree `mi_espacio.view` y se gatee `/rrhh/mi-espacio` por él, o (b) se les conceda `rrhh.view`. **Decisión pendiente antes de activar.**

---

## 7) Resultado esperado (respuestas explícitas)

**1. Cómo quedaría cada usuario** → ver §4 / §4-bis (proyección por rol objetivo).

**2. Qué módulos vería cada uno:**
- SUPER_ADMIN: todos.
- ADMIN_OPERATIVO: todos los funcionales (Cockpit, CRM, Compras, Operaciones, WMS, Finanzas, Analytics, Drive) + RRHH lectura.
- GERENCIA_COMERCIAL: CRM, Compras, Operaciones, WMS, Cockpit operativo, Mi Espacio.
- ADMIN_FINANZAS: Tesorería/Finanzas, Compras, Operaciones, WMS, Analytics, Cockpit operativo, Mi Espacio.
- JEFE_DEP_*: Operaciones, WMS, Pedidos, Cockpit operativo, Mi Espacio.

**3. Qué módulos NO vería:**
- ADMIN_OPERATIVO: ❌ Administración de Usuarios / Seguridad (sistema); ❌ editar RRHH.
- GERENCIA_COMERCIAL: ❌ Finanzas/Tesorería, ❌ Analytics ejecutivo, ❌ financiero del cockpit, ❌ Sistema/Seguridad, ❌ RRHH.
- ADMIN_FINANZAS: ❌ CRM/Comercial, ❌ financiero del cockpit ejecutivo, ❌ Sistema/Seguridad, ❌ RRHH.
- JEFE_DEP_*: ❌ CRM, ❌ Finanzas, ❌ Analytics, ❌ Compras, ❌ Sistema/Seguridad, ❌ RRHH.

**4. Riesgos:**
- 🔴 **Cuenta operadora `martin.battaglia@` sin confirmar / nunca logueó.** Asignarle `super_admin` crea un **super_admin durmiente** (riesgo de seguridad) y, si fuera la cuenta de login real, **no puede entrar** (sin confirmar). El super_admin activo es `martin@`. → Confirmar qué cuenta usás realmente; quizá no asignar super_admin a una cuenta inactiva.
- 🔴 **Cobertura de enforcement parcial:** solo ~3 páginas + Drive/cuentas_pagar tienen guard. Con enforce ON, ~19-20/23 APIs y la mayoría de rutas **no** bloquean por permiso → el RBAC será efectivo solo donde hay guard.
- 🟠 **Mi Espacio no enforced** (gap §6) → roles limitados podrían perder acceso a su propio legajo.
- 🟠 **Merino (jefe_anexa) sin confirmar / nunca logueó** → asignación válida pero el usuario aún no operó.
- 🟠 **JEFE_DEP_CENTRAL sin usuario** → función de Magaldi sin responsable en el sistema.

**5. Conflictos:**
- 🔴 **Doble sistema de rol:** `profiles.role` (legacy) seguirá en `admin/supervisor/operaciones` aunque se asignen los roles RBAC nuevos. Guards/RLS que usan `current_role()`/`profiles.role` (legacy) pueden **divergir** del RBAC (`user_roles`). Ej.: ruth@ será `administracion_finanzas` en RBAC pero `supervisor` en profiles → comportamiento inconsistente en áreas gateadas por el sistema viejo. → Definir si se sincroniza `profiles.role` o se deprecia.
- 🟠 `depot` vacío en profiles para Merino, pero el plan asigna `LUJAN` en `user_roles` → revisar qué fuente usa el scoping por depósito.

**6. Usuarios SOBREPERMISADOS:**
- **Hoy: TODOS** (fail-open ⇒ todos ven todo).
- Post-activación: `martin.battaglia@` con `super_admin` (cuenta inactiva) = sobrepermiso/superficie de riesgo. 2 cuentas super_admin.
- ADMIN_OPERATIVO (joseluis@) tiene acceso casi total (Finanzas incluida) — verificar si Operaciones debe ver Finanzas completa.

**7. Usuarios SUBPERMISADOS (vs hoy fail-open):**
- cynthia@, martinrinas@ (supervisor→GERENCIA_COMERCIAL): pierden Finanzas/Analytics/Sistema (intencional).
- ruth@ (supervisor→ADMIN_FINANZAS): pierde CRM (intencional).
- Merino (operaciones→JEFE_DEP_ANEXA): sin cambios operativos relevantes; gana Pedidos/WMS.
- **Riesgo de subpermiso accidental:** cualquiera de los limitados respecto de **Mi Espacio** (gap §6) y respecto de rutas hoy sin guard que mañana podrían gatearse.

---

### Conclusión para aprobación
La activación es viable y de bajo riesgo de rollback, pero **antes de aplicar** conviene decidir 3 cosas: (a) qué hacer con `martin.battaglia@` (cuenta inactiva con super_admin), (b) cómo se resuelve **Mi Espacio** para roles limitados, (c) si se sincroniza/deprecia `profiles.role` legacy para evitar divergencia con el RBAC. Todo lo demás (roles, grants, asignaciones) está mapeado a usuarios reales en `RBAC-ACTIVATION-PLAN.md`. **No se ejecutó ningún cambio.**
