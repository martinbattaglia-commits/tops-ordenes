# DRIVE-FINAL-REDTEAM.md

**Fecha:** 2026-05-29
**Branch base:** working tree sobre `main` (HEAD `a4b24e5`)
**Modo:** `NO ASUMIR · VERIFICAR` · sin deploy · sin merge · sin producción
**Continuación de:** `docs/DRIVE-PREFLIGHT-AUDIT.md` + `docs/DRIVE-HARDENING-REPORT.md`
**Objetivo:** romper deliberadamente el módulo Drive post-H1-H12.

---

## 🟢 ACTUALIZACIÓN POST-REMEDIATION (2026-05-29)

Este documento fue **el detonante** de la remediación. Los hallazgos R1, R2, R3, R4, R15
están **CERRADOS** — ver `docs/DRIVE-REMEDIATION-REPORT.md` para evidencia objetiva.

**Veredicto actualizado:** 🟢 **READY FOR CREDENTIALS**

| ID original | Estado este doc | Estado actual |
|-------------|-----------------|---------------|
| R1 | abierto crítico | ✅ cerrado (`src/lib/drive/client.ts:373`) |
| R2 | abierto crítico | ✅ cerrado (`src/lib/drive/client.ts:491`) |
| R3 | abierto alto | ✅ cerrado (`src/app/api/drive/{list,ping}/route.ts`) |
| R4 | abierto alto | ✅ cerrado con fail-open documentado (`src/lib/rbac/check.ts`) |
| R5–R14 | abiertos varios | sin cambio — NO bloqueantes |
| R15 | abierto alto | ✅ cerrado (`src/app/(app)/drive/DriveBrowser.tsx`) |

El resto del documento queda **como referencia histórica del estado anterior**.

---

## ⚠️ Veredicto original (histórico — superado)

> **🔴 NO READY FOR CREDENTIALS** — bloqueante.

**Regla aplicada:** "Si aparece 1 crítico O 2 altos → detener avance hacia deploy."

**Resultado:**

| Severidad | Cuenta | Estado |
|-----------|--------|--------|
| 🚨 Crítico | **2** (R1, R2) | bloqueante × 2 |
| 🔴 Alto | **3** (R3, R4, R15) | bloqueante × 1.5 |
| 🟡 Medio | 4 (R5, R6, R7, R8) | mitigable post-deploy |
| 🟢 Bajo | 4 (R9, R10, R11, R14) | aceptable |
| ⓘ Informativo | 2 (R12, R13) | nota |

**No deploy hasta resolver al menos R1, R2, R3, R4, R15.** Los fixes están propuestos y son acotados (estimo ≤1 hora de implementación + verificación). En este reporte NO los aplico — esperamos tu visto bueno explícito por la regla "NO MODIFICAR" sin aprobación.

---

## Tabla de hallazgos

| ID | Hallazgo | Severidad | Estado |
|----|----------|-----------|--------|
| R1 | `listChildren` acepta cualquier `folderId` sin validar `isUnderRoot` — bypass de scope para usuarios autenticados | 🚨 Crítico | abierto |
| R2 | `getBreadcrumbs` acepta cualquier `folderId` sin validar scope — leak de paths fuera del root | 🚨 Crítico | abierto |
| R3 | Sin rate-limit en `/api/drive/*` — abuso de cuota Drive API (10k req/100seg/user) | 🔴 Alto | abierto |
| R4 | Sin RBAC en `/api/drive/*` — todos los usuarios autenticados acceden a documentación regulatoria | 🔴 Alto | abierto |
| R5 | `folderCache` crece sin límite en proceso long-running | 🟡 Medio | abierto |
| R6 | `x-request-id` aceptado raw del cliente — log injection con `\n`, `\r` | 🟡 Medio | abierto |
| R7 | Structured logs sin `user.id` ni `user.email` — auditoría incompleta | 🟡 Medio | abierto |
| R8 | Bounded filter incompleto si root tiene >200 hijos directos | 🟡 Medio | abierto |
| R9 | Sin cap de longitud en query de búsqueda — 400 Bad Request de Drive API | 🟢 Bajo | abierto |
| R10 | IDs de Drive expuestos en HTML — info disclosure menor | 🟢 Bajo | aceptable |
| R11 | Service account email visible en UI (ConnectDriveState) — by design | 🟢 Bajo | aceptado |
| R12 | `rootScoped` flag puede ser falsificado por cliente — solo afecta chip UI | ⓘ Informativo | aceptado |
| R13 | Un cliente puede reusar `x-request-id` para confundir forensics | ⓘ Informativo | aceptado |
| R14 | Sin timeout explícito en googleapis (default 30s) | 🟢 Bajo | aceptable v1 |
| R15 | `DriveBrowser` sin AbortController — race conditions en search-as-you-type | 🔴 Alto | abierto |

---

## Detalle de hallazgos críticos y altos

### 🚨 R1 — `listChildren` no valida scope

**Evidencia (`src/lib/drive/client.ts:343-373`):**

```ts
export async function listChildren(
  folderId?: string,
  opts: { pageSize?: number; pageToken?: string; query?: string } = {}
): Promise<ListChildrenPage> {
  const drive = requireDrive();
  const target =
    folderId && folderId.trim().length > 0
      ? folderId                                       // ← acepta cualquier ID
      : process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!target) throw new DriveError("Sin folder de referencia (root no seteado)", 503);

  // …sigue directo a drive.files.list sin validar isUnderRoot(target)
```

**Verificación:** `grep -rn "isUnderRoot" src/` → no hay calls. La función existe pero está huérfana.

**Vector de ataque:**

1. Usuario autenticado (cualquier role) abre DevTools
2. Identifica un folder ID fuera del scope TOPS (por compartir hecho con la misma SA por error, o adivinando IDs)
3. Ejecuta: `await fetch('/api/drive/list?folderId=<id-de-otra-carpeta-de-la-SA>').then(r => r.json())`
4. Recibe listado de archivos completo

**Impacto:** la SA de TOPS, si tiene acceso a cualquier carpeta fuera del subtree TOPS (por compartir intencional o por error humano), expone esa carpeta a cualquier usuario autenticado de NEXUS.

**Mitigación H4/H5 NO cubre este vector** — esas son para `searchFiles` y `listRecent`, no para navegación directa.

**Fix propuesto (≤15 min, 2 archivos):**

```ts
// src/lib/drive/client.ts — listChildren()
if (folderId && folderId.trim().length > 0) {
  const allowed = await isUnderRoot(folderId.trim());
  if (!allowed) {
    throw new DriveError("Folder fuera del scope autorizado", 403);
  }
  // …continúa con folderId
}
```

```ts
// src/app/api/drive/list/route.ts — capturar 403
if (e instanceof DriveError && e.status === 403) {
  return NextResponse.json(
    { ok: false, error: "Forbidden: folder fuera del scope", requestId },
    { status: 403, headers: { "x-request-id": requestId } }
  );
}
```

---

### 🚨 R2 — `getBreadcrumbs` no valida scope

**Evidencia (`src/lib/drive/client.ts:463-491`):**

```ts
export async function getBreadcrumbs(folderId: string): Promise<DriveBreadcrumb[]> {
  const drive = requireDrive();
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  return timed("getBreadcrumbs", { folderId }, async () => {
    const crumbs: DriveBreadcrumb[] = [];
    let current: string | undefined = folderId;
    let safety = 0;
    while (current && safety < 12) {
      safety += 1;
      const got = await drive.files.get({ fileId: current, ... });
      // …no se chequea si current está en el subtree del root
    }
  });
}
```

**Vector:** mismo que R1. Pasando `folderId=<otro>` se obtiene la ruta de breadcrumbs (incluyendo nombres de carpetas ancestros sensibles).

**Impacto:** info disclosure — el atacante reconstruye la estructura jerárquica de carpetas ajenas.

**Fix propuesto:** misma estrategia que R1 — `if (!await isUnderRoot(folderId)) throw new DriveError("Folder fuera del scope", 403)` antes del walk.

---

### 🔴 R3 — Sin rate-limit en `/api/drive/*`

**Evidencia:** `grep -rn "rateLimit" src/app/api/drive/` → 0 matches.

**Comparación con otros endpoints (que SÍ tienen):**

```bash
$ grep -rn "rateLimit" src/
src/app/(app)/settings/users/actions.ts:8:import { clientKey, rateLimit } from "@/lib/rate-limit";
src/app/(app)/settings/users/actions.ts:28:  const rl = rateLimit(`invite:${clientKey(ip)}`, { limit: 20, windowMs: 60 * 60 * 1000 });
src/app/(app)/orders/new/actions.ts:56:  const rl = rateLimit(clientKey(ip), { limit: 10, windowMs: 60_000 });
src/app/auth/forgot-password/actions.ts: ...
```

La librería `@/lib/rate-limit` existe (`src/lib/rate-limit.ts`) y se usa en 3 lugares. Drive endpoints no la usan.

**Vector de ataque:**

1. Usuario autenticado abre tab y bucle: `setInterval(() => fetch('/api/drive/list'), 100)`
2. 10 requests/seg = 600 req/min = 36k req/hora
3. **Drive API limit:** 1.000 queries por usuario por 100 segundos. Se rompe en 10 segundos del bucle.
4. **Resultado:** Drive API responde 429/403 a TODOS los usuarios de TOPS (cuota compartida por la SA)
5. **Compliance Engine deja de funcionar para toda la organización**

**Fix propuesto (≤10 min):**

```ts
// src/app/api/drive/list/route.ts — al inicio del GET
import { clientKey, rateLimit } from "@/lib/rate-limit";
// …
const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
const rl = rateLimit(`drive:${clientKey(ip)}`, { limit: 60, windowMs: 60_000 });
if (!rl.ok) {
  return NextResponse.json(
    { ok: false, error: "Rate limit excedido", retryAfterMs: rl.retryAfterMs, requestId },
    { status: 429, headers: { "x-request-id": requestId, "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } }
  );
}
```

Aplicar igual a `/api/drive/ping` con límite menor (`limit: 20`).

---

### 🔴 R4 — Sin RBAC en `/api/drive/*`

**Evidencia:** `grep -n "current_role\|hasPermission\|requireRole" src/app/api/drive/*/route.ts` → 0 matches.

**Contexto:** la migración `0009_rbac.sql` define 22 permisos. Existe el módulo `compliance` con `compliance.view` (visto en `src/lib/rbac/data.ts:38`). El sidebar coloca Drive TOPS bajo "Compliance · ANMAT". Pero el route handler no chequea el permiso.

**Vector de ataque:**

1. Crear usuario con rol mínimo (ej. `deposito.operario`)
2. Loggearse en NEXUS
3. Navegar `/drive` — UI se renderiza (no hay gate de role)
4. Listar contenido sensible de Drive corporativo (contratos, habilitaciones, info legal)

**Roles que DEBERÍAN tener acceso (según semántica del módulo):**

- `director_ops` — sí
- `admin` — sí
- `compliance` — sí
- `operaciones` — discutible (solo si necesitan ver OC PDFs)
- `seguridad` — no
- `deposito` — no
- `comercial` — no

**Fix propuesto (≤30 min — depende de wiring RBAC server-side):**

```ts
// src/app/api/drive/list/route.ts
import { hasPermission } from "@/lib/rbac/permissions"; // crear si no existe

const allowed = await hasPermission(req, "compliance.view");
if (!allowed) {
  return NextResponse.json(
    { ok: false, error: "Permiso compliance.view requerido", requestId },
    { status: 403, headers: { "x-request-id": requestId } }
  );
}
```

**Caveat:** según `docs/ERP-FASE1-PARIDAD.md` el RBAC está dormido (user_roles=0). Hasta que se seedean asignaciones reales, este fix debe degradar a "permitir cualquier autenticado" para no bloquear el módulo. Documentar.

---

### 🔴 R15 — `DriveBrowser` sin AbortController

**Evidencia:** `grep -n "AbortController\|signal:" src/app/(app)/drive/DriveBrowser.tsx` → 0 matches.

**Código relevante (`src/app/(app)/drive/DriveBrowser.tsx:157-170`):**

```tsx
// Búsqueda con debounce
useEffect(() => {
  if (!configured) return;
  const term = search.trim();
  if (!term) {
    void load({ folderId: currentFolderId });
    return;
  }
  const t = window.setTimeout(() => void load({ search: term }), 280);
  return () => window.clearTimeout(t);
}, [search, configured]);
```

**Problema:** el debounce de 280ms evita disparar requests por cada keystroke, **pero si el usuario tipea más rápido que la respuesta del servidor**, los requests viajan en paralelo y el orden de llegada NO se controla. Ejemplo:

1. T=0ms: usuario tipea "TOPS" en 200ms → cancela 1 timer, dispara request al final
2. T=280ms: request "TOPS" sale
3. T=300ms: usuario tipea "TOPS NEXUS"
4. T=580ms: request "TOPS NEXUS" sale
5. T=900ms: respuesta de "TOPS NEXUS" llega → setEntries(NEXUS results)
6. T=1200ms: respuesta de "TOPS" llega tarde → **setEntries(TOPS results)** ← STALE OVERRIDE
7. Usuario ve resultados de "TOPS" pero el input dice "TOPS NEXUS"

**Vector adicional (DOS lógico interno):** tipear y borrar rápido dispara N requests sin cancelarlos. Si una API call cuesta 500ms y el usuario tipea 10 chars en 1seg, hay 5 requests in-flight.

**Fix propuesto (≤20 min):**

```tsx
const load = useCallback(async (opts, signal?: AbortSignal) => {
  // …
  const res = await fetch(`/api/drive/list?${params}`, { cache: "no-store", signal });
  // …
}, [configured]);

useEffect(() => {
  if (!configured) return;
  const controller = new AbortController();
  const t = window.setTimeout(() => void load({ search: term }, controller.signal), 280);
  return () => {
    window.clearTimeout(t);
    controller.abort();  // ← cancela request en flight si la query cambia
  };
}, [search, configured]);
```

---

## Detalle de hallazgos medios (mitigables post-deploy)

### 🟡 R5 — `folderCache` sin bound

**Evidencia (`src/lib/drive/client.ts:36`):**

```ts
const folderCache = new Map<string, string>();
```

`folderCache.set(cacheKey, folderId)` en línea 185 sin política de eviction. En serverless cold-start mitiga, pero un worker long-running puede consumir RAM.

**Fix:** LRU cap a 1000 entries, o usar `lru-cache` (ya en el ecosistema Next.js).

---

### 🟡 R6 — `x-request-id` sin sanitización

**Evidencia (`src/app/api/drive/ping/route.ts:18-19`):**

```ts
const requestId =
  req.headers.get("x-request-id") ??
  `drive-ping-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
```

**Ataque de log injection:** cliente envía `x-request-id: foo\n{"level":"info","fake":"bar"}`. Log parsers que parten por `\n` ven dos entries.

**Fix:**

```ts
const raw = req.headers.get("x-request-id");
const requestId = raw && /^[a-zA-Z0-9_\-]{1,64}$/.test(raw)
  ? raw
  : `drive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
```

---

### 🟡 R7 — Logs sin user.id ni email

**Evidencia:** `logDrive` se llama con `op`, `folderId`, `ms` — pero no con el user.

**Vector:** auditoría imposible. Si alguien lista una carpeta sensible, no podés decir quién fue. Compliance regulatorio (ANMAT, AGC) puede requerir esta info.

**Fix:** pasar `user.id` al `timed()`/`logDrive()` desde la route handler.

---

### 🟡 R8 — Bounded filter incompleto >200 hijos

**Evidencia (`src/lib/drive/client.ts:417, 530`):**

```ts
const rootKids = await drive.files.list({
  q: `'${escapeDriveQuery(rootId)}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`,
  fields: "files(id)",
  pageSize: PAGE_SIZE_MAX,  // ← 200, sin paginar
  ...
});
```

**Problema:** si el root tiene >200 carpetas hijas directas, las excedentes NO se incluyen en `rootChildrenIds`. Archivos de esas carpetas excedentes pasan el filter como "fuera de root" y se ocultan en search/recent.

**No es leak**, es ocultamiento. Pero degrada la promesa de bounded.

**Fix:** paginar rootKids hasta consumir todas, o cachear el set en memoria (con TTL).

---

## QA Stress — proyección por escala

| Carpetas en root | `/drive` carga inicial | Search bounded | listRecent bounded | Riesgo cuota Drive |
|------------------|----------------------|----------------|---------------------|---------------------|
| **1** | 1 call, <500ms | 1+1 calls, <1s | 1+1 calls, <1s | nulo |
| **100** | 2 calls (paginado 50+50), <1s, 1 click "Cargar más" | 2 calls, <1s | 2 calls, <1s | nulo |
| **1.000** | 20 páginas, UX degrada sin scroll virtual | 2 calls, <2s | 2 calls, <2s | bajo |
| **10.000** | 200 páginas, UX no usable. ⚠️ Si bounded: rootChildrenIds incompleto (R8). | 2 calls, <3s. ⚠️ Drive throttle posible. | 2 calls, ⚠️ con `pageSize * 4` busca 60 archivos sin filtros previos | medio: 200+ calls en burst si usuario impaciente |

**Conclusión QA:** la implementación actual soporta operativamente **hasta ~1.000 carpetas** sin degradación notoria. Sobre 1.000 conviene scroll virtual y bound infinito en el cache. Sobre 10.000 hay que rediseñar (índice precomputado + búsqueda externa tipo Algolia/Typesense).

---

## Compliance Review

| Principio | Estado | Evidencia |
|-----------|--------|-----------|
| **Mínimo privilegio (scopes)** | ✅ PASS | H2 aplicado: `drive.readonly` + `drive.file` (`src/lib/drive/client.ts:39-42`) |
| **Manejo de credenciales** | ⚠️ PARTIAL | Env var marcada secret en setup (Netlify), pero falta verificar que no se loguee en error paths. Línea 56 logguea solo el message del error de parse, no el contenido. ✅ |
| **Exposición de secretos** | ✅ PASS | `private_key` nunca se serializa al cliente. `client_email` se expone deliberadamente en `/drive` connect state. |
| **Auditoría** | ❌ FAIL (R7) | Logs sin user.id. Impossible saber quién accedió a qué. Bloqueante para ANMAT/AGC. |
| **Trazabilidad request↔log** | ✅ PASS | x-request-id propagado. ⚠️ Pero sin sanitización (R6). |
| **PII en logs** | ✅ PASS | `logDrive()` solo registra meta operativa. No emite contenido de archivos. |
| **Rotación de credenciales** | 🟡 PARTIAL | `resetDriveCache()` exportada (H8) pero no hay endpoint admin para invocar. Rotar SA requiere redeploy del proceso. |

---

## Hallazgos bajos / informativos (detalle compacto)

### 🟢 R9 — Sin cap en query length
- `searchFiles` acepta `query` de cualquier longitud
- Drive API: 4096 chars max — por encima → 400 Bad Request
- Fix: `if (query.length > 200) return { entries: [], bounded, rootScoped: false };` o similar

### 🟢 R10 — IDs Drive en HTML
- React keys + dataset incluyen IDs. Visible en DOM/screencast.
- Aceptable: los IDs no son secretos (URLs públicas si la carpeta es pública en Drive).

### 🟢 R11 — Email SA en UI
- By design: cuando Drive no está configurado, ConnectDriveState muestra el email para que el admin lo copie.
- Solo se ve después del login (post-H1).

### 🟢 R14 — Sin timeout explícito en googleapis
- Default de googleapis: 30s.
- Aceptable v1. Recomendado v2: `timeout: 10000` en cada call para fallar rápido y dejar al usuario reintentar.

### ⓘ R12 — `rootScoped` flag puede ser falsificado
- El cliente DEBE confiar en el chip que muestra. Pero como el server respeta `bounded=true` server-side, no hay vuln real.

### ⓘ R13 — Reuso de `x-request-id`
- Un atacante puede mandar el mismo ID en N requests para enturbiar forensics.
- Aceptable porque los logs tienen timestamp; correlación cliente↔servidor en el primer request basta.

---

## Resumen ejecutivo

### Lo que está bien (no tocar)
- Build verde, typecheck verde
- Manejo de errores completo (todas las rutas con `DriveError` tipado)
- Structured logging (post-H7)
- Paginación implementada (post-H3)
- Escape de queries Drive (post-H9 anterior)
- Compliance Engine se enchufa automático

### Lo que está mal y debe fijarse antes de deploy
1. **R1, R2** — validar scope con `isUnderRoot()` en `listChildren` y `getBreadcrumbs`
2. **R3** — rate-limit con la lib existente `@/lib/rate-limit`
3. **R4** — RBAC con `compliance.view` (con degradación temporal si user_roles vacío)
4. **R15** — AbortController en DriveBrowser

### Lo que puede esperar post-deploy
- R5, R6, R7, R8 — calidad operativa, no exposición
- R9, R10, R11, R14 — bajo impacto

---

## Próximos pasos sugeridos

**Opción A — aplicar fixes R1-R4-R15 ahora (1h estimada):**
1. R1+R2 → 15 min, 2 archivos
2. R3 → 10 min, 2 archivos
3. R4 → 30 min, requiere helper de RBAC server-side
4. R15 → 20 min, AbortController en DriveBrowser
5. Verificar typecheck + build
6. Quedar en estado 🟢 **READY FOR CREDENTIALS**

**Opción B — esperar credenciales y aplicar fixes en el mismo ciclo:**
- Mismo trabajo pero comprimido en un solo redeploy
- Riesgo: cuando lleguen las creds, el módulo sigue vulnerable hasta el deploy

**Opción C — deploy con riesgos abiertos:**
- ❌ NO recomendado. La regla del usuario bloquea esto explícitamente.

---

## Restricciones honradas

- 🛑 NO DEPLOY — código intacto en producción
- 🛑 NO MERGE — main intacto en `a4b24e5`
- 🛑 NO PRODUCCIÓN — env vars de Netlify sin tocar
- 🛑 NO CREDENCIALES tocadas
- 🛑 NO INVENTAR — todos los hallazgos referencian file:line verificables
- 🛑 NO APROBADO ESPÚREO — el módulo se reporta 🔴 NOT READY honestamente

---

## Cierre

El red team encontró **2 vectores críticos y 3 altos** que la regla de decisión clasifica como bloqueantes. **No avanzamos hacia deploy.** Necesito tu decisión entre las opciones A/B/C arriba para continuar.

Independiente de tu elección, **NO aplicar credenciales reales hasta resolver al menos R1, R2** — el riesgo de cross-folder access es concreto y trivial de explotar.
