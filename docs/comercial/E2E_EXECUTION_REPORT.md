# E2E_EXECUTION_REPORT — Aceptación funcional CRM + Clientify Inbound

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha de ejecución:** 2026-06-06
**Entorno:** local (`npm run dev`, puerto 3030) · Playwright
**Plan:** `E2E_TEST_PLAN.md` · Screenshots: `docs/comercial/e2e-screenshots/`

---

## 0. Veredicto

> ## ⛔ NO-GO (E2E de navegador)
> El E2E de navegador de los 9 flujos **no es ejecutable** en el entorno actual, y la corrida fiel **encontró un defecto que bloquearía el inbound en producción** (middleware bloquea el webhook tokenizado con 401). **No se fabricaron resultados.**
>
> ⚠️ Distinción importante: la **lógica de negocio** sigue **validada a nivel RPC/DB** (≈162 asserts en staging, 0 fallos). El NO-GO es de la **capa de navegador / configuración de entorno**, no de la lógica del producto.

---

## 1. Qué se ejecutó realmente (con evidencia)

| Paso | Acción | Resultado real | Evidencia |
|---|---|---|---|
| 1 | `GET /comercial/leads` | **Redirige a `/login?from=%2Fcomercial%2Fleads`** — auth gate operativo | `e2e-screenshots/01-login-gate-from-leads.png` · título "Iniciar sesión · TOPS NEXUS" |
| 2 | `GET /api/clientify/webhook/sample-token` | **HTTP 401** (bloqueado por **middleware**, no por el handler) | `e2e-screenshots/02-webhook-public-get.png` · consola: `401 (Unauthorized)` |

> Consola: 0 errores en la página de login (2 warnings menores, no críticos); 1 error (401) en el intento de webhook.

---

## 2. Flujos 1–9: por qué NO se pudieron ejecutar end-to-end

Bloqueados por precondiciones de entorno (no por defectos de producto), **verificadas en el repo**:

| Bloqueo | Verificación |
|---|---|
| **App → Supabase PROD** (sin `crm_*`) | `NEXT_PUBLIC_SUPABASE_URL` = `arsksytgdnzukbmfgkju` → la UI cae a "muestra local" y las RPC fallan (`OPP_NOT_FOUND`) |
| **Auth obligatoria** (`DEMO_MODE=0`) | `/comercial/*` redirige a `/login`; sin credenciales (y no se debe loguear contra PROD) |
| **Sin claves supabase-js de staging** | solo `STAGING_DB_URL` (pg crudo) → la app no puede re-apuntarse a staging vía supabase-js |
| **Staging sin datos `crm_*`** | las validaciones usaron tx+ROLLBACK → sin datos residuales para recorrer en UI |

Por estas 4 razones, recorrer Lead Inbox → Calificación → Promoción → Ficha 360° → Reserva → Ganado → Onboarding → Ocupado → Dashboard **vía navegador** no es posible hoy. Se documenta sin simular.

---

## 3. 🔴 Defecto encontrado (bloqueante de producción)

**El webhook tokenizado de Clientify está bloqueado por el middleware (401).**

- **Síntoma:** `GET/POST /api/clientify/webhook/<token>` → **401** del middleware, **antes** de llegar al handler (que en GET devuelve 200).
- **Causa raíz** (`src/lib/supabase/middleware.ts`): la allowlist pública usa **match exacto** `pathname === "/api/clientify/webhook"` (ruta **vieja, sin token**, hoy deshabilitada con 404). El handler **real** (F2.2-2) vive en `/api/clientify/webhook/**[token]**`, que **no** iguala el match exacto → se trata como ruta protegida → 401.
- **Impacto:** en producción, el **POST de Clientify recibiría 401** y `crm_ingest_lead` **nunca** se ejecutaría → **el inbound queda muerto**.
- **Inconsistencia adicional:** el comentario del middleware dice *"Clientify firma con HMAC y postea acá"* — stale: Clientify **no firma** (ver `CLIENTIFY_WEBHOOK_AUTH_RESEARCH.md`) y la ruta es tokenizada.
- **Fix (fuera de este alcance — solo validar):** match por prefijo `pathname.startsWith("/api/clientify/webhook")` + actualizar el comentario. **Tarea de fix generada** (chip en sesión). 1 línea, sin abrir superficie nueva (la ruta sin token ya responde 404).

> Este es el tipo de hallazgo que el E2E debe producir: una integración (F2.2-2) y una configuración (middleware) que quedaron **desincronizadas**. La validación por `pg` (F2.2) no podía detectarlo porque no pasa por el middleware HTTP.

---

## 4. Lo que SÍ quedó confirmado en esta corrida

- ✅ **Auth gate funciona:** las rutas comerciales exigen login (sin fuga).
- ✅ **Las rutas compilan y se sirven** (dev server levanta; build verde previo).
- 🔴 **Webhook tokenizado inalcanzable** por middleware (defecto §3).
- ⚠️ **E2E de navegador no ejecutable** contra staging por precondiciones de entorno (§2).

---

## 5. Inconsistencias / warnings registrados

| # | Hallazgo | Severidad |
|---|---|---|
| I-1 | Middleware bloquea webhook tokenizado (401) — **bloqueante de inbound en prod** | 🔴 Alta |
| I-2 | Comentario middleware stale ("HMAC") + ruta vieja en allowlist | 🟡 Baja |
| I-3 | App runtime → PROD sin `crm_*` (RA-1): la UI cae a muestra local | 🟠 Media (resuelve al desplegar a entorno con `crm_*`) |
| I-4 | No hay claves supabase-js de staging → E2E de navegador contra staging no configurable | 🟠 Media |

---

## 6. GO / NO-GO

| Nivel | Veredicto |
|---|---|
| **E2E de navegador (9 flujos) contra staging** | ⛔ **NO-GO** — precondiciones de entorno no cumplidas (§2) |
| **Inbound webhook en producción** | ⛔ NO-GO inicial (defecto I-1) → ✅ **RESUELTO en P0.1** (`P0_1_MIDDLEWARE_FIX.md`): webhook alcanzable, validado E2E |
| **Lógica de negocio (RPC/DB)** | ✅ **GO** — ≈162 asserts en staging, 0 fallos (validación previa, no por navegador) |

**Condición para pasar el E2E de navegador a GO:**
1. Corregir I-1 (middleware → prefijo) — tarea generada.
2. Cumplir P-1…P-4 del plan: claves supabase-js de staging + login `comercial` + datos sembrados, **o** ejecutar el E2E **post-deploy** contra el entorno real con `crm_*` (Fase E del `PRODUCTION_EXECUTION_PLAN.md`).

> **Recomendación CTO de Release:** el E2E de navegador de los 9 flujos es, en la práctica, el **smoke de Fase E** del plan de producción — debe correrse **post-deploy** (o en un staging re-apuntado con claves supabase-js). Antes de eso, **corregir I-1 es obligatorio**, o el inbound no funcionará en vivo.

---

*Ejecución fiel. No se desplegó, no se tocó producción, no se fabricaron resultados. Defecto I-1 derivado a tarea de fix (fuera del alcance "solo validar").*
