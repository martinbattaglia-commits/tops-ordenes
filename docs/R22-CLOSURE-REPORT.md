# R22-CLOSURE-REPORT.md

**Fecha:** 2026-05-29
**Commit base verificado:** `4d1dbff03f6f690b828f348fb9dec3e36f5e9610` (corto `4d1dbff`)
**Branch:** `feature/nexus-fullstack`
**Modo:** `NO ASUMIR · VERIFICAR` · sin deploy · sin merge · sin commit · sin credenciales
**Solución aplicada:** 🅑 — Service Role exclusivamente para detectar seed-state global de `user_roles`.

---

## Tabla de tests solicitada

| Test | Resultado | Tipo de evidencia |
|------|-----------|-------------------|
| RBAC Seed Detection | **PASS** | Análisis estático del flujo · file:line · migración SQL |
| Unauthorized User | **PASS** | Trace lógico Caso 1 · evidencia file:line |
| Authorized User | **PASS** | Trace lógico Caso 2 · evidencia file:line |
| RLS Integrity | **PASS** | Migración 0009 sin modificar · helpers sin tocar `user_roles` write |

**Caveat de honestidad:** los 4 PASS están respaldados por análisis estático del código + verificación de tipos/build. **NO se ejecutaron contra Supabase real** porque eso requeriría creds productivas que están explícitamente NO autorizadas. La verificación dinámica end-to-end se hará en el PASO 5 del execution plan (smoke tests con sesiones reales post-deploy). Tabla refleja "PASS por análisis estático" — no "PASS por test runtime contra DB".

---

## Verificaciones base

| Verificación | Resultado |
|--------------|-----------|
| `npm run typecheck` | exit 0, sin errores |
| `npm run build` | ✓ Compiled successfully, 35 pages generadas |
| Tamaño `/drive` bundle | 4.94 kB (sin cambio vs pre-fix) |
| Tamaño Middleware | 82.1 kB (sin cambio) |
| Tamaño `check.ts` | 292 líneas (+85 vs pre-fix) |

---

## 1 · Cambios aplicados

### Modificado: `src/lib/rbac/check.ts`

**Antes (vulnerable):**

```ts
import { createClient } from "@/lib/supabase/server";

// …
const { count: totalAssignments } = await supabase  // ← supabase = createClient() → RLS aplica
  .from("user_roles")
  .select("*", { count: "exact", head: true });
```

**Después (R22 fix):**

```ts
import { createClient, createAdminClient } from "@/lib/supabase/server";

// …
const admin = createAdminClient();  // ← service_role → bypassa RLS
let totalAssignments: number | null = null;

if (admin) {
  const { count, error: countErr } = await admin
    .from("user_roles")
    .select("*", { count: "exact", head: true });
  if (countErr) {
    console.error(/* … */);
    return { ok: false, status: 403, error: "No se pudo verificar permisos" };
  }
  totalAssignments = count ?? 0;
} else {
  // Sin service_role → fail-closed sobre subset propio del usuario
  console.warn(/* … */);
  const { count: selfCount } = await supabase
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);
  totalAssignments = (selfCount ?? 0) > 0 ? 1 : 0;
  if (totalAssignments === 0) {
    return { ok: false, status: 403, error: `Permiso requerido: ${permission}` };
  }
}
```

### Verificaciones del cambio

```bash
$ grep -n "createAdminClient\|createClient" src/lib/rbac/check.ts
35:import { createClient, createAdminClient } from "@/lib/supabase/server";
82:  const supabase = createClient();
122:  const admin = createAdminClient();
```

→ Confirmado: `createAdminClient()` se usa **únicamente** en línea 122 para el seed-check, no en otras partes.

```bash
$ grep -A8 "createAdminClient" src/lib/supabase/server.ts
export function createAdminClient() {
  if (!env.supabase.url || !env.supabase.serviceRoleKey) return null;
  return createServerClient(env.supabase.url, env.supabase.serviceRoleKey, {
    cookies: { get: () => undefined, set: () => undefined, remove: () => undefined },
  });
}
```

→ Confirmado: `createAdminClient()` usa `SUPABASE_SERVICE_ROLE_KEY` (no anon). Cookies stub. Definido en `src/lib/supabase/server.ts:45-54`.

---

## 2 · Verificación por caso (análisis del flujo)

### CASO 1 — Tabla seedeada, usuario sin permisos → debe 403

**Estado inicial:**
- `user_roles` tiene rows (ej. 5 admin assignments)
- Caller: usuario regular sin row en `user_roles`

**Trace por el código (`src/lib/rbac/check.ts`):**

| Línea | Branch | Evaluación con datos del caso |
|-------|--------|-------------------------------|
| 72 | `demoMode \|\| needsSupabase` | false (Supabase configurado) → skip |
| 82-83 | `createClient()` null? | no, hay client → skip fallback |
| 105-110 | `auth.getUser()` | retorna user válido (sesión OK) |
| 122 | `createAdminClient()` | retorna admin client (service_role configurado) |
| 125 | `if (admin)` | true → entra al branch admin |
| 126-128 | `admin.from("user_roles").select("*", { count: "exact", head: true })` | **service_role bypassa RLS → count = 5** (real, sin filtrado) |
| 144 | `totalAssignments = 5` | |
| 180 | `if (totalAssignments === 0)` | **false (5 ≠ 0)** → skip fallback |
| 203-206 | `supabase.from("user_roles").select(...).eq("user_id", user.id)` | RLS aplica al cliente normal → user solo ve sus rows → rows = [] (no tiene asignación) |
| 232-238 | iterar `rows` → `userPermissions = Set()` | set vacío |
| 240 | `userPermissions.has("compliance.view")` | **false** |
| 250-260 | log warn `check-permission.denied` | sí |
| 261-265 | `return { ok: false, status: 403, error: "Permiso requerido: compliance.view" }` | ✅ **403** |

**Resultado esperado:** 403 con `error: "Permiso requerido: compliance.view"` y log `check-permission.denied`.
**Resultado obtenido (por análisis):** 403 con ese error y log.
→ **PASS** (análisis estático).

**Antes del fix (estado vulnerable):**

| Línea (versión anterior) | Branch | Evaluación con mismos datos |
|--------------------------|--------|-----------------------------|
| count con cliente normal | `supabase.from("user_roles").select("*", { count: "exact", head: true })` | **RLS filtra al subset propio → count = 0 aunque tabla tenga 5** |
| `if (totalAssignments === 0)` | true | → fail-open → **bypass** |

→ confirmación inversa de R22: el bypass existía y el fix lo cierra.

---

### CASO 2 — Tabla seedeada, usuario autorizado → debe 200

**Estado inicial:**
- `user_roles` tiene rows (ej. 5 assignments)
- Caller: usuario con row asignando role `compliance` (que tiene permiso `compliance.view`)

**Trace por el código:**

| Línea | Branch | Evaluación |
|-------|--------|-----------|
| 72 | demo mode | false → skip |
| 82-83 | createClient null | no → skip |
| 105-110 | auth.getUser | user válido |
| 122-144 | seed-check con service_role | count = 5 → totalAssignments = 5 |
| 180 | totalAssignments === 0 | false → skip fallback |
| 203-206 | lookup roles del user (cliente normal con RLS) | RLS permite "self read" → retorna la(s) row(s) del user |
| 232-238 | parsing jerárquico `role → role_permissions → permission.slug` | `userPermissions = Set(["compliance.view", ...])` |
| 240 | `userPermissions.has("compliance.view")` | **true** |
| 241-247 | return `{ ok: true, userId, userEmail, enforced: true, permission }` | ✅ **200** (continúa el flow) |

**Resultado esperado:** `PermissionCheckOk` con `enforced: true`, ruta `/api/drive/list` continúa hasta llegar al listing.
**Resultado obtenido (por análisis):** mismo.
→ **PASS** (análisis estático).

---

### CASO 3 — Tabla vacía (sistema sin seed) → fallback documentado

**Estado inicial:**
- `user_roles` totalmente vacía a nivel global (FASE 1)
- Caller: cualquier usuario autenticado

**Trace por el código:**

| Línea | Branch | Evaluación |
|-------|--------|-----------|
| 72 | demo mode | false → skip |
| 82-83 | createClient null | no → skip |
| 105-110 | auth.getUser | user válido |
| 122-144 | seed-check con service_role | **service_role ve estado real → count = 0** |
| 180 | totalAssignments === 0 | **true** → entra a fallback |
| 181-191 | log warn `check-permission.fallback-allow` con `reason: "user_roles table empty globally (RBAC dormido, FASE 1)"` | sí, log emitido |
| 192-198 | return `{ ok: true, userId, userEmail, enforced: false, permission }` | ✅ **200 con `enforced: false`** |

**Comportamiento documentado:**
- Permiso concedido (fail-open intencional documentado en el header del archivo línea 28-30)
- `enforced: false` → el route handler puede saber que el RBAC está dormido
- Log warn `fallback-allow` queda en monitoring para visibilidad

**Resultado esperado:** 200 con `enforced: false` + log warn fallback-allow.
**Resultado obtenido (por análisis):** mismo.
→ **PASS** (análisis estático).

**Nota:** la diferencia respecto al estado pre-R22 es que **el count es ahora real** (con service_role), no filtrado por RLS. Caso 3 tiene el mismo output que antes solo porque `count global = 0` y `count filtrado = 0` coinciden. Es Caso 1 el que cambia drásticamente con el fix.

---

### CASO 4 — RLS Integrity (sigue funcionando para writes y otras lecturas)

**Verificación 1:** la migración SQL **no fue modificada**:

```bash
$ grep -B1 -A5 "user_roles read self or admin" supabase/migrations/0009_rbac.sql
drop policy if exists "user_roles read self or admin" on public.user_roles;
create policy "user_roles read self or admin"
  on public.user_roles for select
  using (user_id = auth.uid() or public.current_role() in ('admin','supervisor'));

drop policy if exists "user_roles admin write" on public.user_roles;
create policy "user_roles admin write"
  on public.user_roles for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');
```

→ Sin cambios en la RLS. El fix vive 100% en el helper TS, no en SQL.

**Verificación 2:** el cliente normal `supabase` sigue siendo el que se usa para todo lo demás:
- Auth (`supabase.auth.getUser()`) — línea 107
- Lookup de mis permisos (`supabase.from("user_roles").select(...).eq("user_id", user.id)`) — línea 203-206
- Self-count fallback (sin service_role) — línea 164-167

`createAdminClient()` se invoca **solo 1 vez** en todo el archivo (línea 122) y se usa **solo para una query `head: true` que no devuelve filas** — solo el contador.

**Verificación 3:** no hay writes con service_role en este flujo:

```bash
$ grep -n "\.insert\|\.update\|\.delete\|\.upsert" src/lib/rbac/check.ts
(sin resultados — solo SELECT con head:true)
```

→ Confirmado: ninguna mutación con privilegios elevados. Principio de menor privilegio honrado.

**Verificación 4:** RLS sigue aplicando a todas las otras tablas, todas las otras funciones, y a `user_roles` desde cualquier otro punto del código:

```bash
$ grep -rn "from(\"user_roles\")" src/ --include="*.ts" --include="*.tsx"
src/lib/rbac/check.ts:127:      .from("user_roles")
src/lib/rbac/check.ts:165:      .from("user_roles")
src/lib/rbac/check.ts:204:      .from("user_roles")
src/lib/rbac/data.ts:130:      .from("user_roles")
```

| File:line | Cliente usado | RLS aplica? |
|-----------|---------------|--------------|
| `check.ts:127` | `admin` (service_role) | **NO** — solo cuenta global |
| `check.ts:165` | `supabase` (normal) | sí |
| `check.ts:204` | `supabase` (normal) | sí |
| `data.ts:130` | `supabase` (verificable abajo) | sí (es el data layer general) |

```bash
$ sed -n '125,135p' src/lib/rbac/data.ts
```

Inspección manual confirma que `data.ts:130` usa el cliente normal (`createClient()`).

→ **PASS** — RLS sigue siendo el mecanismo principal de control de acceso a `user_roles`. La excepción es **exactamente 1 query**: el conteo global cero-vs-no-cero usado para distinguir FASE 1 de RBAC activo.

---

## 3 · Camino edge: prod sin `SUPABASE_SERVICE_ROLE_KEY`

Para no introducir un nuevo bypass por falta de configuración, agregué un branch fail-closed cuando `createAdminClient()` retorna null:

**Trace (`src/lib/rbac/check.ts:145-176`):**

| Línea | Branch | Evaluación |
|-------|--------|-----------|
| 122 | `createAdminClient()` | null (service_role NO configurada) |
| 125 | `if (admin)` | false → entra al fallback |
| 149-160 | log warn `check-permission.no-admin-client` con razón explícita | sí |
| 164-167 | `supabase.from("user_roles").select(...).eq("user_id", user.id)` | RLS aplica + filtro por user.id → retorna solo MIS rows |
| 168 | `totalAssignments = (selfCount > 0) ? 1 : 0` | binario: tengo asignación o no |
| 169-175 | si `totalAssignments === 0` → **return 403** (fail-closed) | ✅ |

→ Sin service_role, fail-closed. Más estricto que el original — durante FASE 1 sin service_role NADIE pasa por compliance.view. Pero el caso real (prod) **sí tiene service_role** porque ya está usado en otras partes (audit Supabase, etc.), entonces este camino edge no debería activarse en producción.

```bash
$ grep -n "serviceRoleKey" src/lib/env.ts
20:    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
```

→ Variable expuesta vía `env.supabase.serviceRoleKey`. En el `.env.local` del usuario ya está configurada (verificado en sesión anterior con memoria). En Netlify production también debería estar.

**Verificación en Netlify production (pendiente, no ejecutar):** confirmar con `netlify env:list --context production | grep SUPABASE_SERVICE_ROLE_KEY` — si está presente, el camino admin se activa. Si no, el camino fallback fail-closed se activa.

---

## 4 · Re-test rápido de los otros hallazgos del audit final

| ID | Cambio post-R22 | Estado |
|----|-----------------|--------|
| R20 | sin tocar middleware | sigue 🟢 Bajo abierto |
| R21 | **CERRADO** en este turno (warn log agregado, línea 84-94) | ✅ |
| R23 | sin tocar route handler de pageSize | sigue 🟢 Bajo abierto |
| R24 | sin tocar rate-limit | sigue 🟢 Bajo abierto |
| R25 | sin tocar rate-limit | sigue 🟢 Bajo abierto |
| R26 | sin tocar isUnderRoot | sigue 🟡 Medio abierto |
| R27 | sin tocar maxDepth | sigue 🟡 Medio abierto |

→ ningún hallazgo NO-bloqueante se rompió. R21 cerrado de regalo. Resto del audit final sigue como estaba.

---

## 5 · Veredicto

**R22:** ✅ **CERRADO** mediante Solución B aplicada en `src/lib/rbac/check.ts:122-176`.

**Resumen de cierre:**
- `createAdminClient()` se usa exclusivamente para el count global (sin lectura de filas, sin writes).
- Cliente normal con RLS para todo lo demás (auth, mis roles, mis permisos).
- Si service_role no está disponible → fail-closed estricto (más seguro que fallar abierto).
- RLS sin modificar a nivel SQL.
- Build verde + typecheck verde.

**Hallazgos restantes:**
- 🚨 Críticos: 0
- 🔴 Altos: 0
- 🟡 Medios: 6 (R5, R7, R8, R26, R27 + previo)
- 🟢 Bajos: varios — no bloqueantes
- ⓘ Informativos: 2

**Cumple criterio de salida:**
- ✅ R22 cerrado con evidencia
- ✅ Sin nuevos críticos
- ✅ Sin nuevos altos
- ✅ Build verde
- ✅ Typecheck verde

→ **🟢 READY FOR CREDENTIALS** (re-emitido).

---

## 6 · Cambio de estado oficial

| Flag | Antes | Después |
|------|-------|---------|
| Módulo Drive | 🔴 NOT READY | 🟢 **READY FOR CREDENTIALS** |
| Deploy | 🟡 NOT AUTHORIZED | 🟡 NOT AUTHORIZED |
| Commit / Push / Merge / Producción | 🟡 NOT AUTHORIZED | 🟡 NOT AUTHORIZED |
| Credenciales | retenidas | **listo para recibir** |

---

## 7 · Verificación end-to-end pendiente (no ejecutar todavía)

Cuando llegue el momento del PASO 5 del execution plan (smoke tests post-deploy con creds reales), la batería incluirá:

```javascript
// Caso 1 — usuario sin asignación
fetch('/api/drive/list', {...}).then(r => expect(r.status).toBe(403));

// Caso 2 — usuario con compliance.view
fetch('/api/drive/list', {...}).then(r => {
  expect(r.status).toBe(200);
  return r.json();
}).then(d => expect(d.ok).toBe(true));

// Caso 3 — RBAC dormido (verificar antes de seedear)
fetch('/api/drive/list', {...}).then(r => {
  expect(r.status).toBe(200);
  // Log de Netlify debe mostrar "fallback-allow" warn
});

// Caso 4 — RLS integrity probada indirectamente: cualquier usuario que pasa caso 2 ve solo SUS roles, no los de otros
fetch('/api/drive/list', {...}).then(r => r.json()).then(d => {
  // implícito: no hay endpoint que revele user_roles, RLS sigue activa
});
```

Estos tests requieren sesión real + creds productivas + tabla user_roles seedeada → no ejecutables en este momento (pre-credentials, freeze de producción).

---

## 8 · Restricciones honradas

- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT · NO PRODUCCIÓN · NO CARGAR CREDENCIALES
- 🛑 NO MODIFICAR VARIABLES PRODUCTIVAS (no toqué env de Netlify)
- 🛑 NO INVENTAR — los 4 PASS están explícitos como "análisis estático", no como "test runtime contra DB"
- 🛑 RLS sin modificar en SQL — el fix vive en TS
- 🛑 `createAdminClient()` invocado en exactamente 1 lugar para 1 query head-only, sin writes

---

## Anexos

### Anexo A — Lecturas vs writes con admin client en todo el codebase

```bash
$ grep -rn "createAdminClient" src/ --include="*.ts" --include="*.tsx"
src/lib/rbac/check.ts:35:import { createClient, createAdminClient } from "@/lib/supabase/server";
src/lib/rbac/check.ts:122:  const admin = createAdminClient();
src/lib/supabase/server.ts:45:export function createAdminClient() {
(otros usos existentes pre-R22 quedan fuera del scope Drive)
```

→ En `check.ts`, la SOLA línea que invoca `createAdminClient()` es la 122. Y la SOLA operación que hace con ese cliente es la línea 126-128: `select count(*) head:true`. Cero lecturas de filas. Cero writes.

### Anexo B — Diff de tamaño post-R22

| Archivo | Antes R22 | Después R22 | Delta |
|---------|-----------|-------------|-------|
| `src/lib/rbac/check.ts` | 207 líneas | 292 líneas | +85 |
| `/drive` bundle | 4.94 kB | 4.94 kB | sin cambio (no afecta cliente) |
| Middleware | 82.1 kB | 82.1 kB | sin cambio |

### Anexo C — Update a DRIVE-FINAL-PRECREDS-AUDIT.md

Pendiente en mismo turno: agregar bloque con cierre de R22 y revertir veredicto a 🟢.
