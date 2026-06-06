# CLIENTIFY_WEBHOOK_HANDLER_IMPLEMENTATION_REPORT — F2.2-2

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** F2.2-2 — handler real del webhook Clientify (inbound only)
**Estado:** ✅ **implementado · 19/19 PASS · tsc/lint/build verdes**

> Inbound-only. Sin outbound, sin write-back a Clientify, sin producción/`main`/Netlify.

---

## 1. Entregables

| # | Archivo | Contenido |
|---|---|---|
| 1 | `docs/comercial/CLIENTIFY_WEBHOOK_HANDLER_ARCHITECTURE.md` | Arquitectura del handler |
| 2 | `src/lib/clientify/webhook.ts` + `src/app/api/clientify/webhook/[token]/route.ts` + `env.ts` | Implementación |
| 2b | `src/app/api/clientify/webhook/route.ts` | Endpoint legacy **deshabilitado** (404) |
| 3 | `scripts/f222-webhook-staging.mts` | QA (unit + integración) |
| 4 | `docs/comercial/CLIENTIFY_WEBHOOK_HANDLER_STAGING_RESULTS.md` | Evidencia (19/19) |
| 5 | Este documento | Reporte |

---

## 2. Qué se implementó (mapa al alcance)

| Alcance | Implementación |
|---|---|
| **token-en-URL** | Route dinámica `/webhook/[token]`; token en path |
| **Validación de autenticación** | `verifyWebhookToken` timing-safe (`crypto.timingSafeEqual`), **fail-closed**; 401 si falla |
| **Normalización de payload** | `normalizeLead` defensivo (envoltorios + `ClientifyContact` real → lead canónico) |
| **Llamada a `crm_ingest_lead`** | `createAdminClient().rpc(...)` con `p_lead/p_raw/p_event` |
| **Observabilidad** | RPC loguea éxito; handler loguea + escribe `clientify_sync_log(status=error)` en fallo; `console.info` por evento |
| **Idempotencia** | delegada a la RPC (`clientify_id` unique); reentregas → `updated` |

### 2.1 Decisiones de implementación
- **Token en path, no query** → menor exposición en logs.
- **Códigos HTTP alineados al retry de Clientify:** 200 ok/skipped, 401 token, 400 JSON, 502 error DB (reintenta), 503 sin service-role.
- **Endpoint sin token deshabilitado** (404) → elimina la puerta de ingesta sin autenticar (era placeholder).
- **`env.ts`:** `webhookSecret`/`webhookConfigured` (additivo).
- **`webhook.ts` sin `server-only`:** justificado — funciones puras testeables aisladas; el secret no es `NEXT_PUBLIC` y ningún client lo importa → no se filtra. (Mismo criterio que `clientify/client.ts`.)

---

## 3. QA (resumen — detalle en `…_STAGING_RESULTS.md`)

- **tsc / lint / build:** verdes; rutas `/api/clientify/webhook` y `/api/clientify/webhook/[token]` bundleadas.
- **19/19 PASS:** token (5), normalización (10), integración normalizador→RPC en staging (4).
- **Método:** las piezas puras se testean con los módulos reales; el contrato normalizador↔RPC se valida contra staging vía `pg` (la RPC es la misma que invoca el handler).
- **Limitación honesta:** la capa HTTP del route con cliente service-role no se ejercita contra staging (runtime apunta a PROD; sin claves supabase-js de staging) → cubierta por build + unit + integración. Prueba HTTP real = entorno con `crm_*` + webhook configurado en Clientify.

---

## 4. Integridad / frontera

- Reusa la RPC `crm_ingest_lead` (F2.2-1) y `clientify_sync_log`; **no** agrega migraciones ni duplica lógica.
- No toca el cliente de lectura `clientify/client.ts` ni el huérfano (consolidación T-1 sigue diferida; el handler no la necesita).
- ❌ Sin outbound / write-back; ❌ sin bandeja (F2.2-3); ❌ sin promoción (F2.2-4); ❌ sin pull (F2.2-5).
- ❌ Producción, `main`, Netlify, Clientify PROD, Supabase PROD: intactos.

> **F2.2-2 cerrado.** Webhook operativo (token-en-URL → normalización → ingesta) y validado en staging. Próximo: F2.2-3 (bandeja) o F2.2-5 (pull), **previa aprobación**.
