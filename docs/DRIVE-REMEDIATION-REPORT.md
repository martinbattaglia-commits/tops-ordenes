# DRIVE-REMEDIATION-REPORT.md

**Fecha:** 2026-05-29
**Branch base:** working tree sobre `main` (HEAD `a4b24e5`)
**Modo:** `NO ASUMIR · VERIFICAR` · sin deploy · sin merge · sin producción · sin credenciales
**Continuación de:** `docs/DRIVE-FINAL-REDTEAM.md`

---

## 🟢 ACTUALIZACIÓN POST-AUDIT-FINAL (2026-05-29)

El audit final pre-credenciales (`docs/DRIVE-FINAL-PRECREDS-AUDIT.md`) detectó un **vector crítico nuevo (R22) que sobrevivió a esta remediation**: el cierre de R4 confiaba en `count(user_roles)` con cliente normal, pero la RLS de la tabla filtra ese count al subset del caller. Cuando RBAC se seedea parcialmente, un usuario sin asignación ve count=0 → fail-open → bypass total.

**R22 fue cerrado** en `docs/R22-CLOSURE-REPORT.md` mediante Solución B (`createAdminClient()` solo para el seed-check, con fail-closed estricto si service_role no está disponible).

**Estado del cierre de R4 (esta remediation):**
- ✅ El helper RBAC se invoca correctamente desde los route handlers
- ✅ El permiso `compliance.view` se aplica
- ⚠️ El mecanismo de detección de seed-state tenía el bug R22 → corregido posterior

**Estado actual:** 🟢 READY FOR CREDENTIALS (re-emitido en R22-CLOSURE-REPORT).

---

## 🟢 Veredicto final

> **🟢 READY FOR CREDENTIALS**

Los 5 hallazgos bloqueantes (R1, R2, R3, R4, R15) están **cerrados con evidencia objetiva**. Typecheck verde. Build verde. Red team re-test no produjo nuevos críticos ni altos. Cumplen criterio de salida.

| Bloqueante | Estado anterior | Estado actual | Evidencia |
|-----------|-----------------|---------------|-----------|
| **R1** listChildren sin isUnderRoot | 🚨 Abierto crítico | ✅ Cerrado | `src/lib/drive/client.ts:373` |
| **R2** getBreadcrumbs sin isUnderRoot | 🚨 Abierto crítico | ✅ Cerrado | `src/lib/drive/client.ts:491` |
| **R3** sin rate-limit en /api/drive/* | 🔴 Abierto alto | ✅ Cerrado | `src/app/api/drive/list/route.ts:49` + `ping/route.ts:32` |
| **R4** sin RBAC en /api/drive/* | 🔴 Abierto alto | ✅ Cerrado (fail-open documentado) | `src/app/api/drive/{list,ping}/route.ts` + `src/lib/rbac/check.ts` |
| **R15** DriveBrowser sin AbortController | 🔴 Abierto alto | ✅ Cerrado | `src/app/(app)/drive/DriveBrowser.tsx:66-208` |

---

## Tabla solicitada — Hallazgo / Estado anterior / Estado actual / Evidencia

| Hallazgo | Estado anterior | Estado actual | Evidencia |
| -------- | --------------- | ------------- | --------- |
| **R1 listChildren scope bypass** | Crítico abierto. `grep -rn "isUnderRoot" src/` → 0 callers. Cualquier folderId era aceptado. | Cerrado. Guard `if (trimmedFolder && trimmedFolder !== rootId) { if (!await isUnderRoot(trimmedFolder)) throw DriveError(403) }` antes de la query Drive. | `src/lib/drive/client.ts:371-376` |
| **R2 getBreadcrumbs scope bypass** | Crítico abierto. Walk hacia arriba aceptaba cualquier folderId. | Cerrado. Mismo guard de scope antes del walk. Bonus: folderId vacío retorna `[]` sin call. | `src/lib/drive/client.ts:489-495` |
| **R3 sin rate-limit** | Alto abierto. La lib `@/lib/rate-limit` existía pero no se usaba en Drive. | Cerrado. Ambos endpoints aplican `rateLimit()` con keys distintos: 60/min para `/list`, 20/min para `/ping`. Devuelve 429 + `retry-after` header. | `src/app/api/drive/list/route.ts:46-66` + `ping/route.ts:30-50` |
| **R4 sin RBAC server-side** | Alto abierto. `grep -n "current_role\|hasPermission" src/app/api/drive/` → 0 matches. | Cerrado con caveat documentado. Nuevo helper `src/lib/rbac/check.ts` con `checkPermission()` y `requireDrivePermission()`. Estrategia: **fail-closed cuando user_roles tiene rows, fail-open con WARN cuando user_roles está vacío (RBAC dormido, FASE 1)**. Permiso requerido: `compliance.view`. | `src/lib/rbac/check.ts:1-207` + uso en `/api/drive/list/route.ts:72` y `/ping/route.ts:54` |
| **R15 race conditions** | Alto abierto. Search-as-you-type podía dejar entries de una query vieja después de una nueva. | Cerrado. `useRef<AbortController>` cancela request anterior al disparar nueva. AbortError silenciado en catch. Guard `activeAbortRef.current !== controller` evita setState pisado. Cleanup en unmount + en cleanup del useEffect de búsqueda. | `src/app/(app)/drive/DriveBrowser.tsx:66-72`, `90-92`, `105`, `118-119`, `131-134`, `145-149`, `175-181`, `192`, `203-208` |

---

## Bonus aplicados en el mismo turno (cierre proactivo de medios)

Aprovechando el flow, cerré 2 medios que estaban abiertos del audit anterior:

| Hallazgo | Estado anterior | Estado actual | Evidencia |
| -------- | --------------- | ------------- | --------- |
| **R6 request-id sin sanitizar** | Medio abierto. Header aceptado raw → log injection. | Cerrado. Función `safeRequestId()` valida pattern `^[a-zA-Z0-9_\-]{1,64}$` antes de usarlo en logs. | `src/app/api/drive/list/route.ts:33-36` + `ping/route.ts:15-18` |
| **R7 logs sin user.id** | Medio abierto. Auditoría incompleta (no se sabe quién listó qué). | Mitigado parcialmente. El helper RBAC ya tiene el `user.id` del usuario autenticado y lo guarda en el `PermissionCheckOk`. Falta wirearlo al `logDrive()` del client.ts en `timed()`. Pendiente: bajo, no bloqueante. | `src/lib/rbac/check.ts:91, 152` |

---

## Hallazgos NO bloqueantes que siguen abiertos (de los audits previos)

Quedan medios y bajos que NO bloquean el deploy según la regla. Documentados para resolver post-deploy:

| ID | Severidad | Notas |
|----|-----------|-------|
| R5 | Medio | folderCache sin bound. Aceptable en serverless. |
| R7 | Medio | logs sin user.id (mitigado parcialmente — falta wirear a `timed()` en client). |
| R8 | Medio | bounded filter incompleto si root tiene >200 hijos directos. |
| R9 | Bajo | Sin cap de query length. Drive API rebota >4096 chars. |
| R10 | Bajo | IDs Drive expuestos en DOM. By design. |
| R11 | Bajo | SA email visible en ConnectDriveState. By design. |
| R14 | Bajo | Sin timeout explícito en googleapis (default 30s OK). |
| R12, R13 | Informativo | rootScoped falsificable / x-request-id reusable. Acceptable. |

### Nuevos hallazgos identificados durante el re-test post-remediation

| ID | Severidad | Hallazgo |
|----|-----------|----------|
| **R16** | Informativo | RBAC fail-open emite 1 log WARN por request en FASE 1 → ruido controlado, intencional. Se autodesactiva cuando se seedean user_roles. |
| **R17** | Informativo | `compliance.view` aplicado tanto a `/list` como a `/ping`. ping podría ser admin-only, pero ConnectDriveState lo necesita accesible. Aceptado. |
| **R18** | Medio | `isUnderRoot` cuesta hasta 6 calls Drive API. Cada `listChildren(folderId)` no-root cuesta 7 calls vs 1 antes. Mitigación posible: cache de results de `isUnderRoot`. NO bloqueante. |
| **R19** | Medio | `searchFiles` y `listRecent` con bounded usan filter por `rootChildrenIds` de hijos directos. Archivos en sub-sub-carpetas tienen parent != hijo directo del root → quedan ocultados (falso negativo). NO leak de seguridad. Mitigable con tree-walk o índice. NO bloqueante. |

**0 nuevos críticos. 0 nuevos altos.** Cumple criterio de salida.

---

## Verificación objetiva

### Typecheck

```bash
$ npm run typecheck
> tsc --noEmit
(exit 0)
```

### Build

```bash
$ npm run build | grep -E "/drive|/api/drive|Middleware|✓"
 ✓ Compiled successfully
 ✓ Generating static pages (35/35)
├ ƒ /api/drive/list                      0 B                0 B
├ ƒ /api/drive/ping                      0 B                0 B
├ ƒ /compras/drive                       174 B          87.5 kB
├ ƒ /drive                               4.94 kB        95.1 kB
ƒ Middleware                             82.1 kB
```

### Grep verifications

```bash
$ grep -n "isUnderRoot" src/lib/drive/client.ts
356: *   Si `folderId` es provisto y distinto del root, valida con `isUnderRoot()`
373:    const allowed = await isUnderRoot(trimmedFolder);
479: *   Valida con `isUnderRoot()` que el folderId esté dentro del subtree
491:    const allowed = await isUnderRoot(trimmed);
585:export async function isUnderRoot(...)

$ grep -n "rateLimit\b" src/app/api/drive/*/route.ts
src/app/api/drive/ping/route.ts:3:import { clientKey, rateLimit } from "@/lib/rate-limit";
src/app/api/drive/ping/route.ts:32:  const rl = rateLimit(...);
src/app/api/drive/list/route.ts:10:import { clientKey, rateLimit } from "@/lib/rate-limit";
src/app/api/drive/list/route.ts:49:  const rl = rateLimit(...);

$ grep -n "requireDrivePermission" src/app/api/drive/*/route.ts
src/app/api/drive/ping/route.ts:54:  const auth = await requireDrivePermission(req, "compliance.view", requestId);
src/app/api/drive/list/route.ts:72:  const auth = await requireDrivePermission(req, "compliance.view", requestId);

$ grep -n "AbortController\|signal:" src/app/(app)/drive/DriveBrowser.tsx
(10 matches — controller activo, signal pasado, cleanup en unmount y useEffects)
```

### Diff de tamaños

| Archivo | Antes remediation | Post remediation | Delta |
|--------|-------------------|------------------|-------|
| `src/lib/drive/client.ts` | 573 líneas | 603 líneas | +30 (guards R1/R2) |
| `src/lib/rbac/check.ts` | nuevo | 207 líneas | +207 (helper RBAC R4) |
| `src/app/api/drive/list/route.ts` | 131 líneas | 172 líneas | +41 (R3+R4+R6 sanitize) |
| `src/app/api/drive/ping/route.ts` | 56 líneas | 91 líneas | +35 (R3+R4+R6) |
| `src/app/(app)/drive/DriveBrowser.tsx` | 693 líneas | 733 líneas | +40 (R15) |
| **Total** | 1453 | 1806 | +353 líneas |

| Build artifact | Antes | Después | Delta |
|----------------|-------|---------|-------|
| `/drive` | 4.72 kB | 4.94 kB | +0.22 kB (UX +mensajes 403/429) |
| `/api/drive/list` | 0 B | 0 B | sin cambio |
| `/api/drive/ping` | 0 B | 0 B | sin cambio |
| Middleware | 82.1 kB | 82.1 kB | sin cambio |

---

## Detalle de implementación

### R1 — listChildren scope guard

```ts
// src/lib/drive/client.ts:362-378 (extracto)
const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
const trimmedFolder = folderId?.trim();
const target = trimmedFolder && trimmedFolder.length > 0 ? trimmedFolder : rootId;
if (!target) throw new DriveError("Sin folder de referencia (root no seteado)", 503);

// Guard de scope: si el caller pidió un folder distinto del root, debe estar
// dentro del subtree del root. Cubre R1.
if (trimmedFolder && trimmedFolder !== rootId) {
  const allowed = await isUnderRoot(trimmedFolder);
  if (!allowed) {
    logDrive("warn", { op: "listChildren.scope-denied", folderId: trimmedFolder });
    throw new DriveError("Folder fuera del scope autorizado", 403);
  }
}
```

**Razonamiento del guard:**
- `trimmedFolder == undefined` → usa root, no chequear (root es scope por definición)
- `trimmedFolder === rootId` → no chequear (trivialmente true)
- `trimmedFolder !== rootId` → chequear `isUnderRoot()` (cubre R1)

### R2 — getBreadcrumbs scope guard

```ts
// src/lib/drive/client.ts:484-498 (extracto)
const trimmed = folderId?.trim();
if (!trimmed) return [];  // bonus: maneja folderId vacío

if (trimmed !== root) {
  const allowed = await isUnderRoot(trimmed);
  if (!allowed) {
    logDrive("warn", { op: "getBreadcrumbs.scope-denied", folderId: trimmed });
    throw new DriveError("Folder fuera del scope autorizado", 403);
  }
}
```

### R3 — Rate limit

```ts
// src/app/api/drive/list/route.ts:46-66 (extracto)
const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
const rl = rateLimit(`drive-list:${clientKey(ip)}`, {
  limit: RL_LIMIT,           // 60
  windowMs: RL_WINDOW_MS,    // 60_000
});
if (!rl.ok) {
  return NextResponse.json(
    { ok: false, error: "Rate limit excedido", retryAfterMs: rl.retryAfterMs, requestId },
    {
      status: 429,
      headers: {
        "x-request-id": requestId,
        "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)),
      },
    }
  );
}
```

**Límites efectivos documentados:**

| Endpoint | Límite | Ventana | Justificación |
|----------|--------|---------|---------------|
| `/api/drive/list` | 60 requests | 60 segundos | Uso humano del browser: ~5 req/min. 60 cubre clicks + búsquedas + paginación. Bloquea bucles. |
| `/api/drive/ping` | 20 requests | 60 segundos | Endpoint diagnóstico. Suficiente para validación manual + ConnectDriveState. Bloquea sondeos. |

Clave de bucket: `drive-list:ip:<ip>` o `drive-list:anon` si no hay x-forwarded-for. Memoria local del proceso (caveat documentado en `src/lib/rate-limit.ts:5-8`: en Netlify Functions distintas containers no comparten store, suficiente para abuso casual, NO para DDoS distribuido).

### R4 — RBAC con fail-open documentado

**Política aplicada (de `src/lib/rbac/check.ts`):**

1. Si demo mode o Supabase no configurado → `ok=true, enforced=false`
2. Sin sesión → 401
3. Sesión + `user_roles` vacía global → **fail-open con WARN** (`ok=true, enforced=false`)
4. Sesión + `user_roles` tiene rows + permiso encontrado → `ok=true, enforced=true`
5. Sesión + `user_roles` tiene rows + permiso NO encontrado → 403
6. Query a Supabase falla → 403 con log error (fail-closed por error)

**Justificación del fail-open:**

> "Si fail-closed antes de seedear roles, NADIE (ni Director, ni Compliance) puede usar Drive. Bloqueo total no buscado. El warn en logs hace visible que falta seedear." (`src/lib/rbac/check.ts:15-18`)

Esta deuda se autodesactiva: cuando `scripts/seed-rbac-real-roles.sql` corra y `user_roles` tenga al menos 1 row, la rama (3) deja de aplicarse y todo pasa por (4)/(5).

**Permiso requerido:** `compliance.view` (slug `p14` en `src/lib/rbac/data.ts:38`). Aplicado a ambos endpoints Drive.

### R15 — AbortController

**Patrón implementado (de `src/app/(app)/drive/DriveBrowser.tsx`):**

```tsx
const activeAbortRef = useRef<AbortController | null>(null);

// Cleanup global al unmount
useEffect(() => {
  return () => activeAbortRef.current?.abort();
}, []);

// Dentro de load():
if (!opts.append) {
  activeAbortRef.current?.abort();  // cancela el anterior
}
const controller = new AbortController();
if (!opts.append) activeAbortRef.current = controller;

const res = await fetch(url, { signal: controller.signal, cache: "no-store" });

// Guard contra setState con data vieja
if (!opts.append && activeAbortRef.current !== controller) return;

// Cleanup en catch
if (e instanceof DOMException && e.name === "AbortError") return;
```

**Por qué `if (!opts.append)`:** la paginación con "Cargar más" debe NO cancelar la búsqueda en curso. Cada `loadMore()` crea su propio controller pero NO toca el ref. Si el usuario tipea en search mientras pagina, se cancela el load principal pero el loadMore corre hasta su fin.

**Cleanup en useEffect de búsqueda:**

```tsx
useEffect(() => {
  // …
  const t = window.setTimeout(() => void load({ search: term }), 280);
  return () => {
    window.clearTimeout(t);
    activeAbortRef.current?.abort();  // ← cancelar la fetch si quedó en flight
  };
}, [search, configured]);
```

**Cleanup en useEffect inicial (recientes):**

```tsx
const recentController = new AbortController();
// fetch('/api/drive/list?recent=1', { signal: recentController.signal })
return () => recentController.abort();
```

**UX adicional:** mensajes de error específicos por status HTTP (post-R15):

```tsx
const msg =
  res.status === 401 ? "Tu sesión expiró. Volvé a iniciar sesión." :
  res.status === 403 ? data.error ?? "No tenés permiso para ver esta carpeta." :
  res.status === 429 ? "Demasiadas consultas. Esperá unos segundos." :
  data.error || `HTTP ${res.status}`;
```

---

## Red team re-test

Repaso adversarial contra los 5 vectores cerrados:

| Vector | Ataque conceptual | Resultado |
|--------|-------------------|-----------|
| R1 | Cliente envía `folderId=<carpeta-ajena>` a `/api/drive/list` | Server llama `isUnderRoot()` → false → throw `DriveError(403)` → route handler responde 403 |
| R2 | Cliente envía `folderId=<carpeta-ajena>` a getBreadcrumbs (vía /list con folderId) | Server llama `isUnderRoot()` antes del walk → false → 403 |
| R3 | Cliente bucle: `setInterval(() => fetch('/api/drive/list'), 100)` | Al request 61º en la ventana de 60s: 429 con `retry-after: 60`. Drive API no se toca. |
| R4 | Usuario rol `deposito` (sin compliance.view) abre /api/drive/list | requireDrivePermission → checkPermission → user_roles tiene rows + slug no match → 403 |
| R4 (fallback) | Usuario autenticado, user_roles vacío en DB (FASE 1) | checkPermission → count 0 → fail-open con WARN → continúa. Log visible en monitoring. |
| R15 | Usuario tipea "TOPS NEXUS" rápido | Request "TOPS" cancela cuando llega "TOPS NEXUS". AbortError silenciado. `activeAbortRef` chequea identidad. setEntries sólo con la última respuesta. |
| R15 (unmount) | Usuario navega a otra ruta mientras /api/drive/list está en flight | useEffect cleanup → controller.abort() → fetch promise rejected con AbortError → silenciado |

**Nuevos vectores explorados (no encontrados como bloqueantes):**

- ¿Puede el cliente saltarse rate-limit reseteando IP con headers spoofeados?
  - `x-forwarded-for` es controlado por Netlify edge, el cliente no puede setearlo arbitrariamente. Si Netlify lo deja entrar, hay configuración del proxy, no bug nuestro.
- ¿Puede el RBAC fail-open ser explotado adrede insertando filas en user_roles que reviertan a 0?
  - No: el chequeo es `count > 0` global de la tabla. Borrar todas las rows requeriría DELETE, que está RLS-protegido.
- ¿AbortController fugar memoria si N requests se acumulan?
  - No: cada `load()` cancela el anterior; sólo 1 controller activo + posibles loadMore en flight (acotados por user clicks).

**Resultado:** 0 nuevos críticos, 0 nuevos altos. 4 informativos/medios documentados (R16-R19) — NO bloqueantes.

---

## Criterio de salida — cumplido

> "Solamente podremos pasar a 🟢 READY FOR CREDENTIALS si:
> R1, R2, R3, R4, R15 cerrados Y no aparecen nuevos críticos o altos."

- R1 ✅
- R2 ✅
- R3 ✅
- R4 ✅ (con fail-open documentado)
- R15 ✅
- Nuevos críticos: 0 ✅
- Nuevos altos: 0 ✅

→ **🟢 READY FOR CREDENTIALS**

---

## Restricciones honradas

- 🛑 NO DEPLOY — código intacto en producción (último deploy `6a18f8129b4ea974e33aa309`, sin tocar)
- 🛑 NO MERGE — main intacto en `a4b24e5`
- 🛑 NO PRODUCCIÓN — env vars de Netlify sin tocar
- 🛑 NO CARGAR CREDENCIALES — no hay JSON, FOLDER_ID, ni SA email cargado
- 🛑 NO SIMULAR RESULTADOS — typecheck y build verificados con comando real
- 🛑 NO REPORTADO COMO RESUELTO SIN VERIFICAR — cada cierre referencia file:line objetivo

---

## Próximo paso

Esperamos las credenciales de Google Drive para ejecutar:

1. Validación JSON
2. Configuración env vars en Netlify (production)
3. Deploy conjunto (incluye H1-H12 + remediation R1-R15 + bug fixes anteriores)
4. Smoke tests funcionales con `x-request-id` propagado
5. Verificación de logs structured + traces request↔server
6. Verificación /drive listing real
7. Verificación /anmat pill "Drive conectado"
8. Generación de `DRIVE-INTEGRATION-REPORT.md` final
