# TOPS NEXUS — SECURITY HARDENING AUDIT (Gate 5.5)

> Auditoría de seguridad/autorización **grounded en código real** (no asunción). Repo `~/CODE/tops-ordenes`,
> rama `main`. Fecha: 2026-06-04. Modo: auditor (sin features nuevas, sin tocar lógica WMS/Custody).
> Disparada por hallazgos del E2E (F-01/F-02/F-03). **Corrección importante:** la investigación refuta F-01
> tal como fue reportado y reubica el riesgo real (ver §0).

---

## 0. Corrección de F-01 (no asumir — probado)

**F-01 reportado:** "rol `operaciones` accede a `/settings/users`, ve usuarios/emails/invitación/roles".

**Veredicto tras investigar el código y re-probar: FALSO POSITIVO a nivel de página/acción.**

Evidencia:
- `src/app/(app)/settings/users/page.tsx` (líneas 40–57): consulta `profiles.role` del usuario autenticado y, si `role !== 'admin'`, **renderiza "Acceso restringido"** (no muestra la tabla).
- `src/app/(app)/settings/users/actions.ts` (`inviteUser`, líneas 39–46): re-verifica `profiles.role === 'admin'` server-side antes de invitar. Rate-limit + audit_log incluidos.
- En el E2E la tabla **sí** se renderizó → el guard vio `profiles.role === 'admin'` → **la sesión usada ERA admin**.

**Por qué el E2E creyó ser "operaciones":** el shell/topbar deriva el rol de
`user_metadata.role || "Operaciones"` (`src/app/(app)/layout.tsx` línea 21), **no** de `profiles.role`.
Ese metadato estaba ausente/desactualizado → fallback "Operaciones". Es decir, **etiqueta de rol engañosa**
(display), no un bypass de autorización. Los guards reales usan `profiles.role` / `current_role()`.

**Pero la preocupación de fondo (PII de usuarios) SÍ es real — en otra capa.** Ver F-01-R abajo.

---

## 1. Modelo de autorización (cómo funciona realmente)

| Capa | Mecanismo | Fuente de verdad |
|---|---|---|
| **Middleware** (`src/lib/supabase/middleware.ts`) | Solo **autenticación** (¿hay `user`?). Redirige a `/login` o 401 en `/api/*`. **No** verifica rol. | sesión Supabase |
| **Guard de página** (server component) | Algunas páginas consultan `profiles.role` y degradan si no es admin. **Inconsistente** (ver §3). | `profiles.role` |
| **Server Actions** | Algunas re-verifican `profiles.role === 'admin'` (users, fiscal). Otras solo `getUser()`. | `profiles.role` |
| **RPC SECURITY DEFINER** (WMS/Custody) | `current_role()` (= `profiles.role` vía `auth.uid()`) ∈ {admin,operaciones,supervisor}. **Sólido.** | `profiles.role` |
| **RLS** | Lockdown de tablas; lectura por `is_staff()`/`is_admin()`; escritura solo RPC. | `profiles.role` |
| **RBAC granular** (`roles/permissions/user_roles`, 0009) | **Dormido / no aplicado** en la DB en uso; `checkPermission` hace **fail-open** cuando `user_roles` está vacía. Solo lo usan los route handlers de Drive. | (inoperante) |
| **Shell/topbar label** | `user_metadata.role || "Operaciones"` — **NO autoritativo**, solo display. | metadata (divergente) |

Funciones clave (migración `0005`): `current_role()`, `is_admin()` (`role='admin'`),
**`is_staff()` = `role IN ('admin','operaciones','supervisor')`** — todas SECURITY DEFINER, leen `profiles`.

---

## 2. Inventario de rutas / superficie

### 2.1 Rutas públicas (sin sesión) — middleware §`isPublic`
`/login`, `/auth/forgot-password`, `/auth/reset-password`, `/api/auth/*`, `/api/whatsapp/webhook`,
`/api/clientify/webhook`, `/api/tracking/ingest` (token propio), `/compras/validar/*` (QR público),
y assets (`/_next`, `/icons`, `/fonts`, manifest, sw, favicon). **Correcto** y documentado (post DRIVE-PREFLIGHT-AUDIT 2026-05-29).
- ⚠️ `/api/whatsapp/webhook` y `/api/clientify/webhook` son públicos pero **la verificación de firma HMAC está pendiente** (`TODO F2.7`/`F3`) → endpoints falsificables (ver §3, S-05).

### 2.2 Rutas privadas (requieren sesión) — todo el resto
Autenticación garantizada por middleware. **La autorización por rol NO está en el middleware** → depende de cada página/acción.

### 2.3 Rutas privadas **sin guard de rol** (acceso = cualquier usuario autenticado)
La mayoría del producto es de uso general del staff (WMS/Pedidos/Compras/Cockpit) y su escritura está
protegida por RPC/RLS, por lo que "sin guard de rol en la página" es aceptable ahí. **Los casos sensibles** se listan en §3.

---

## 3. Hallazgos

### 🔴 F-01-R · PII de usuarios expuesta vía RLS a TODO el staff (riesgo real detrás de F-01)
- **Qué:** `profiles` SELECT RLS = `id = auth.uid() OR is_staff()`, e `is_staff()` incluye `operaciones` y `supervisor`.
- **Impacto:** cualquier usuario staff (no solo admin) puede leer **toda la tabla `profiles`** (emails, nombres, roles de los 7 usuarios) consultando directamente la API PostgREST (`/rest/v1/profiles?select=email,role`) con su sesión — **aunque la página `/settings/users` lo bloquee**. Exposición de PII a non-admin.
- **Evidencia:** `0005_fix_rls_recursion.sql` líneas 36–48, 74–76.
- **Severidad:** P1 (PII / defensa en profundidad ausente).

### 🔴 F-04 · `/settings/roles*` sin guard de rol (broken access control latente)
- **Qué:** `/settings/roles`, `/settings/roles/new`, `/settings/roles/[slug]` **no verifican rol**. Hoy quedan ocultas porque las tablas RBAC (0009) no están aplicadas → muestran `ModuleUnavailable`. **Si 0009 se aplicara**, cualquier usuario autenticado vería la matriz RBAC completa (incluye emails de asignaciones vía join a `profiles`) y podría abrir "Nuevo rol"/editar roles.
- **Evidencia:** `settings/roles/page.tsx` (sin chequeo de rol; solo try/catch), `roles/new/page.tsx` (sin guard).
- **Severidad:** P1 (latente; se activa al aplicar 0009).

### 🟠 F-05 · `/settings/centros-costo` sin guard de rol en página ni (aparentemente) en mutaciones
- **Qué:** la página no chequea rol; `centros-costo/actions.ts` solo hace `getUser()` (auth) sin verificar `admin`. La protección efectiva depende de la RLS de `cost_centers` (no auditada en esta pasada).
- **Severidad:** P2 (datos de configuración, no PII; confirmar RLS de `cost_centers`).

### 🟠 F-02 · RBAC granular no operativo (dormido / no aplicado)
- **Qué:** las tablas `roles/permissions/role_permissions/user_roles` **existen en la migración `0009_rbac`** pero `/settings/roles` lanza error (`listRoles` falla) → **0009 no está aplicada (o falla) en la DB en uso**. `checkPermission` (lib/rbac/check.ts) trata `user_roles` vacía como "RBAC dormido" → **fail-open** (permite, con WARN). Solo lo consumen los route handlers de Drive.
- **Conclusión (probado):** el control de acceso **real y operativo** es el de 4 roles (`profiles.role`) + RLS + `current_role()` en RPC. El RBAC granular es **scaffolding inactivo** y, mientras esté dormido, **no enforce nada** (y fail-open).
- **Severidad:** P2 (no es un agujero por sí mismo porque el modelo de 4 roles cubre; pero es deuda + el fail-open es riesgoso si se cablea a más rutas sin seed).

### 🟠 F-03 · DEV/PROD misma DB + PITR off + Storage backup indefinido
- **Qué:** `.env.local` apunta a Supabase de producción (`arsksytgdnzukbmfgkju`); el E2E escribió datos reales. PITR off; backup de Storage (B3) sin definir.
- **Severidad:** P1 operativo (sin red de recuperación ante egreso/erasure/borrado).

### 🟡 F-06 · Etiqueta de rol engañosa en el shell
- **Qué:** `layout.tsx` muestra `user_metadata.role || "Operaciones"`, divergente de `profiles.role` (autoritativo). Indujo el falso F-01 y puede confundir a operadores sobre sus privilegios. **No** afecta autorización (los guards usan `profiles.role`).
- **Severidad:** P2 (correctness/observabilidad de seguridad).

### 🟡 S-05 · Webhooks públicos sin verificación de firma
- **Qué:** `/api/clientify/webhook` (`TODO F2.7` HMAC) y `/api/whatsapp/webhook` (`TODO F3`) son públicos y no validan firma → spoofing/replay.
- **Severidad:** P2 (hoy no persisten estado crítico; cerrar antes de cablear automatizaciones).

### 🟢 Controles correctos (verificados)
- Middleware fail-safe: sin sesión → 401/redirect; `/login` redirige a `/dashboard` si ya logueado.
- `/settings/users` page + `inviteUser` action: **guard admin server-side correcto** + rate-limit + audit.
- `/settings/fiscal`: guard admin server-side (read-only para no-admin) en page y en `actions.ts`.
- WMS/Custody: mutaciones **solo** por RPC SECURITY DEFINER con `current_role()`; tablas en RLS lockdown; ledger/custody append-only por trigger (probado en el E2E: `Cadena Íntegra`, egreso irreversible).
- Custody PII: `custody-pii` gateado a admin/supervisor; binarios solo por `emit_custody_signed_url` (auditado).
- `checkPermission` usa service-role **solo** para el seed-count (head=true), nunca para autorizar (R22).

---

## 4. Resumen de exposición

| Vector | ¿Expuesto? | Detalle |
|---|---|---|
| Rutas públicas filtrando datos | No | Lista pública acotada y revisada |
| PII (emails de usuarios) a non-admin | **Sí** | F-01-R: RLS `profiles` permite a todo staff |
| Escalación de privilegios vía `/settings/users` | No | Page + action guardan admin (F-01 falso positivo) |
| Escalación vía `/settings/roles*` | **Latente** | F-04: sin guard; oculto solo porque 0009 no aplicada |
| RPC inseguras (WMS/Custody) | No | SECURITY DEFINER + `current_role()` |
| Server Actions inseguras | Parcial | users/fiscal OK; centros-costo sin chequeo de rol (F-05) |
| Componentes visibles sin autorización | Parcial | `/settings/roles*` (F-04); shell muestra link "Roles & permisos" a todos |
| RBAC enforce | No | F-02: dormido + fail-open |
| Webhooks | Parcial | S-05: sin HMAC |
| Backup / recuperación | **No** | F-03: PITR off, sin backup Storage |

---

> **FIN — Auditoría.** Plan de remediación priorizado en `SECURITY_REMEDIATION_PLAN.md`;
> estado productivo en `PRODUCTION_READINESS_REPORT.md`.
