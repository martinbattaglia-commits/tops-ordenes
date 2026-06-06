# CLIENTIFY_WEBHOOK_HANDLER_ARCHITECTURE — F2.2-2 · Handler del webhook

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** F2.2-2 — handler real del webhook Clientify (inbound only)
**Base:** `CLIENTIFY_WEBHOOK_AUTH_RESEARCH.md` (no HMAC → token-en-URL) · `CRM_LEAD_INGEST_*` (RPC F2.2-1)

> Inbound-only. Sin outbound, sin write-back a Clientify, sin producción. Validado en staging.

---

## 1. Flujo del handler

```
Clientify ──POST /api/clientify/webhook/<token>──►  route handler
   │ 1. verifyWebhookToken(token)  ── timing-safe vs CLIENTIFY_WEBHOOK_SECRET → 401 si falla
   │ 2. body = JSON.parse(rawText) ── 400 si inválido
   │ 3. normalizeLead(body)        ── null (sin identidad) → 200 {skipped}
   │ 4. createAdminClient().rpc('crm_ingest_lead', { p_lead, p_raw, p_event })
   │      ├─ error  → log clientify_sync_log(status=error) + 502 (Clientify reintenta)
   │      └─ ok     → 200 { ok, action, leadId }
   ▼
crm_leads (+ clientify_sync_log)  ← persistencia/dedup/owner/log en la RPC (F2.2-1)
```

---

## 2. Componentes

| Pieza | Archivo | Rol |
|---|---|---|
| **Verificación + normalización** (puro) | `src/lib/clientify/webhook.ts` | `verifyWebhookToken`, `normalizeLead` |
| **Handler tokenizado** | `src/app/api/clientify/webhook/[token]/route.ts` | POST real (auth → normaliza → RPC) |
| **Endpoint legacy** | `src/app/api/clientify/webhook/route.ts` | **deshabilitado** (404 → apunta al tokenizado) |
| **Env** | `src/lib/env.ts` | `clientify.webhookSecret` / `webhookConfigured` |
| **Ingesta** | `0048_crm_ingest_lead.sql` (F2.2-1) | upsert + dedup + owner + log |

---

## 3. Autenticación — token-en-URL

- El token va en el **path** (`/[token]`), no en query → menor fuga por logs de proxies/referrers.
- `verifyWebhookToken(provided, secret)` compara **timing-safe** (`crypto.timingSafeEqual`); **fail-closed**: si el secret no está configurado o el token no coincide → `false` → **401**.
- El secret (`CLIENTIFY_WEBHOOK_SECRET`) es un token de alta entropía, nunca logueado, rotable (cambiar env + URL en Clientify).
- **No es HMAC** (Clientify no firma). La integridad/anti-replay se compensa con **idempotencia** (RPC, `clientify_id` unique) + **reconciliación por pull** (F2.2-5).

---

## 4. Normalización del payload

`normalizeLead(body)` es **defensivo** (la forma exacta del webhook Clientify no está documentada y puede variar):
- **Desenvuelve** el objeto contacto de `data/object/contact/payload/result` o usa el body plano (la API devuelve el contacto al tope).
- **Mapea** al lead canónico:
  - `clientify_id` ← `id` / `contact_id` / `object_id`
  - `full_name` ← `full_name`/`name` o `first_name`+`last_name`
  - `email` ← primer `emails[].email` o `email`
  - `phone` ← primer `phones[].phone` o `phone`
  - `cuit` ← `taxpayer_identification_number` / `identification_number` / `cuit`
  - `source` ← `contact_source`/`medium`/`channel`/`source`
  - `tags` ← `tags[]`
- **`event`** ← `event` o `object_type[.action]`.
- **Identidad mínima** (clientify_id, email o phone). Sin ella → `null` → el handler responde `200 {skipped}` (sin reintentos).

> Forma confirmada contra el tipo real `ClientifyContact` (`emails[]`, `phones[]`, `taxpayer_identification_number`, `first/last_name`, `contact_source`, `tags[]`). Los fixtures reales se afinan al capturar un webhook (F2.2-0 §3.4).

---

## 5. Idempotencia y reintentos

- **Idempotencia:** delegada a la RPC (upsert por `clientify_id`). Reentregas de Clientify → `action=updated`, sin duplicar.
- **Códigos HTTP pensados para el retry de Clientify:**
  - `200` ok / skipped → no reintenta.
  - `401` token inválido → no reintenta (no es transitorio).
  - `400` JSON inválido → no reintenta.
  - `502` error de DB/RPC → **reintenta** (transitorio).
  - `503` service-role no configurado → reintenta.

---

## 6. Observabilidad

- **Éxito:** la RPC escribe `clientify_sync_log` (inbound, con `_ingest{action,owner,match_kind,flagged}`); el handler loguea `event/action/leadId`.
- **Error de RPC:** el handler escribe `clientify_sync_log(status=error, error)` best-effort (la RPC revierte su propio log al fallar) + loguea.
- **Skipped:** log de info (sin persistir).

---

## 7. Seguridad / frontera

- Solo el handler (server) importa `webhook.ts`; el secret no es `NEXT_PUBLIC` → no se bundlea al cliente.
- La RPC corre `SECURITY DEFINER` con `execute` solo a `service_role`; el handler la invoca con `createAdminClient()`.
- **Endpoint sin token deshabilitado** (404) → no queda puerta de ingesta sin autenticar.
- ❌ Sin outbound, sin write-back, sin tocar producción/`main`/Netlify/Clientify PROD.

*Arquitectura del handler. Implementación, QA y evidencia en los docs hermanos.*
