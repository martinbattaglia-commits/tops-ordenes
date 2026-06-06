# P0.1 — Fix de middleware: webhook Clientify tokenizado accesible

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Prioridad:** P0.1 (bloqueante de producción del inbound, hallado en el E2E de aceptación)
**Estado:** ✅ **CERRADO** — fix aplicado y validado E2E. tsc/lint/build verdes.

> Objetivo: permitir `/api/clientify/webhook/[token]` sin autenticación de sesión, **manteniendo** la protección del resto de rutas, el token-en-URL y la arquitectura actual.

---

## 1. Diagnóstico

- **Síntoma (E2E):** `GET/POST /api/clientify/webhook/<token>` → **HTTP 401**, devuelto por el **middleware**, antes de llegar al handler.
- **Causa raíz** (`src/lib/supabase/middleware.ts`): la allowlist pública usaba **match exacto**
  `pathname === "/api/clientify/webhook"` — la ruta **vieja sin token** (hoy deshabilitada con 404). El handler real (F2.2-2) vive en la ruta **tokenizada** `/api/clientify/webhook/[token]`, que **no** iguala el match exacto → el middleware la trataba como privada → 401.
- **Impacto:** en producción, el POST de Clientify habría recibido 401 y `crm_ingest_lead` **nunca** se habría ejecutado → inbound muerto.
- **Inconsistencia secundaria:** comentario stale ("Clientify firma con HMAC") — Clientify **no firma** (token-en-URL).

---

## 2. Implementación (mínima, sin cambiar arquitectura)

`src/lib/supabase/middleware.ts` — allowlist pública:

```diff
-    pathname === "/api/clientify/webhook" ||
+    pathname === "/api/clientify/webhook" ||
+    pathname.startsWith("/api/clientify/webhook/") ||
```

- **Cubre** la ruta tokenizada `/api/clientify/webhook/<token>` (y conserva la vieja `=== "/api/clientify/webhook"`, que responde 404 por su propio handler).
- **NO** abre `/api/clientify/ping` ni `/api/clientify/sync-contacts`/`sync-deals` (no empiezan con `.../webhook/`) → **siguen privados**.
- La **autenticación real del webhook** la sigue haciendo el **token-en-URL** dentro del handler (`verifyWebhookToken`, timing-safe, fail-closed) — el middleware solo deja de bloquear el tránsito.
- Comentario actualizado: token-en-URL (no HMAC).

> Cambio aditivo de 1 línea (+ comentario). No toca el handler, ni el token-en-URL, ni el resto de la allowlist.

---

## 3. QA

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx next lint` (middleware) | ✅ sin warnings |
| `npm run build` | ✅ `Compiled successfully` · Middleware bundleado |

---

## 4. Evidencia E2E (server local, en vivo)

Probes (fetch same-origin, `redirect: manual`):

| Endpoint | Método | Status | Body | Quién responde | Veredicto |
|---|---|---|---|---|---|
| `/api/clientify/webhook/sample-token` | GET | **200** | `{ok:true,info:"…Use POST."}` | **handler** | ✅ middleware ya no bloquea |
| `/api/clientify/webhook/sample-token` | POST | **401** | `{ok:false,error:"Unauthorized"}` | **handler** (token inválido, fail-closed) | ✅ token-en-URL intacto |
| `/api/clientify/sync-contacts` | GET | **401** | `{ok:false,error:"Auth required"}` | **middleware** | ✅ sigue privado |
| `/api/clientify/ping` | GET | **401** | `{ok:false,error:"Auth required"}` | **middleware** | ✅ sigue privado |
| `/comercial/leads` | GET | redirect | → `/login` | **middleware** | ✅ páginas gated |

> La distinción de mensajes es la prueba clave: **`"Unauthorized"` = handler** (el webhook pasó el middleware y lo gobierna su token); **`"Auth required"` = middleware** (los demás endpoints siguen protegidos).

**Screenshots:** `docs/comercial/e2e-screenshots/`
- `02-webhook-public-get.png` — **antes** (401, bloqueado por middleware).
- `03-webhook-reachable-after-fix.png` — **después** (200, handler alcanzable).

---

## 5. GO / NO-GO actualizado

| Nivel | Antes (E2E inicial) | Ahora (post P0.1) |
|---|---|---|
| **Inbound webhook (reachability)** | ⛔ NO-GO (middleware 401) | ✅ **GO** — webhook alcanzable; token-en-URL operativo |
| **Protección del resto de rutas** | ✅ | ✅ **mantenida** (ping/sync-*/páginas privados) |
| **E2E de navegador (9 flujos) contra staging** | ⛔ NO-GO | ⛔ **NO-GO** (sin cambios) — precondiciones de entorno (app→PROD, sin claves supabase-js de staging, auth, datos). Es el **smoke de Fase E** post-deploy. |
| **Lógica de negocio (RPC/DB)** | ✅ GO | ✅ GO |

**P0.1: ✅ CERRADO.** El bloqueante de inbound en producción está resuelto y verificado E2E.

**Pendiente para "en vivo"** (no son P0.1): `CLIENTIFY_WEBHOOK_SECRET` real en Netlify + URL del webhook en Clientify + aplicar 0041-0050 a PROD + deploy + smoke (Fase E del `PRODUCTION_EXECUTION_PLAN.md`).

---

## 6. Frontera

- Solo se modificó `src/lib/supabase/middleware.ts` (1 línea + comentario).
- Sin funcionalidades nuevas, sin cambios de arquitectura, sin desplegar, sin tocar PROD.
- Cambio **sin commitear** (igual que el resto del flujo: commit cuando se autorice).

> No avanzar a Producción estaba condicionado a cerrar P0.1 → **P0.1 cerrado.** El siguiente gate es la autorización de Dirección + Fases C-F del plan de producción.
