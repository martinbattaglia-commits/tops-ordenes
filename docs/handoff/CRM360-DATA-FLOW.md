# CRM360-DATA-FLOW (Fase 1 + Fase 3 · API Clientify y mapeo Deal → Oportunidad)

**Fecha:** 2026-06-08 · Evidencia real de la API de Clientify (token de la app, read-only).

## Fase 1 — Auditoría técnica de Clientify (evidencia)
| Ítem | Resultado |
|---|---|
| Base API | `https://api.clientify.net/v1` |
| Auth | Header **`Authorization: Token <API_KEY>`** (Bearer da 404) |
| Token de la app (`CLIENTIFY_API_KEY`, 40 chars) | ✅ **válido** — `GET /deals/` → **HTTP 200** |
| Token del MCP `clientify-mcp` | ❌ **inválido** (`401 Invalid token`) — desactualizado vs la app |
| Endpoint de deals | `GET /deals/` · paginado (`count`, `next`, `previous`, `results`) |
| **Total de deals en Clientify** | **172** |
| Pipelines | `GET /deals/pipelines/` (ej. pipeline id 86651) |
| Webhooks | Clientify **no firma** (sin HMAC) → autenticación por token-en-URL |

### Campos reales de un Deal (de `results[0]`)
```
id (int, ej 29957822) · name · owner_name · url ·
contact · contact_name · contact_email · contact_phone · contact_medium · contact_source ·
company · amount ("10000.00") · amount_user · currency ("ARS") ·
status (int) · status_desc · probability (int) · probability_desc ·
pipeline (URL .../pipelines/86651/) · pipeline_desc · pipeline_stage · pipeline_stage_desc ·
tags[] · custom_fields[] · created · modified · expected_closed_date · actual_closed_date · deal_source
```
> Observación: en deals sin vincular, `contact` y `company` vienen **null** (sólo `contact_name`/`owner_name` como texto). El mapeo no puede asumir company_id/contact_id.

## Fase 3 — Mapeo Clientify Deal → `crm_opportunities`

| Campo Clientify | → Columna Nexus | Transformación |
|---|---|---|
| `id` | **`clientify_deal_id`** (unique) | `String(id)` · clave idempotente |
| `amount` | `monto` numeric | `parseFloat` |
| `currency` | `currency` | directo (ARS) |
| `status` + `pipeline_stage_desc` | `estado` (`crm_stage_t`) | tabla de mapeo (abajo) |
| `probability` / `probability_desc` | `probabilidad` (0–100) | normalizar índice→% (usar `probability_desc` o tabla) |
| `pipeline_desc` / tags | `service_type` (`crm_service_t`) | regla: pipeline/tag "ANMAT"→`anmat`, "Oficinas"→`oficinas`, resto→`general` |
| `contact_name` | `contacto` | directo |
| `contact_email` | `email` | directo |
| `contact_phone` | `telefono` | directo |
| `owner_name` | `owner_id` (uuid) | resolver por nombre vs auth.users; si no, null + guardar `owner_name` (col espejo propuesta) |
| `expected_closed_date` | `expected_close` date | directo |
| `created` | `created_at` | directo |
| `modified` | `clientify_modified` (col espejo propuesta) | para reconciliación |
| `company` / `company_name` | `client_id`/`company_name` | si company linkeada → resolver/crear client; si null → `company_name` texto |
| `contact` (id) | `clientify_contact_id` (col espejo) | si presente |
| `pipeline` / `pipeline_stage` | `pipeline` / `pipeline_stage` (cols espejo) | preservar crudo |
| — | `public_id` | generar `OPP-YYYY-####` (secuencia existente) |

### Mapeo de estado (`status` + stage → `crm_stage_t`)
- `status` Clientify: `1=open`, `won`, `lost` (confirmar set completo en implementación).
- Si `status=won` → `ganado` · `status=lost` → `perdido`.
- Si `open`: mapear por `pipeline_stage_desc` → `nuevo_lead | contactado | calificado | visita | propuesta | negociacion` (tabla configurable por pipeline; default `nuevo_lead`).

### Campos mínimos pedidos vs disponibilidad
`clientify_deal_id ✅ · amount ✅ · status/stage ✅ · owner ⚠️(name) · company_id/company_name ⚠️ · contact_id/contact_name ⚠️ · pipeline ❌(col nueva) · created_at ✅ · updated_at ⚠️(clientify_modified col nueva)` → ver columnas espejo propuestas en DATABASE-REVIEW.

## Diagrama de flujo objetivo
```
Lead entra (Google Ads / WhatsApp / Form / Referido)
        ↓
   CLIENTIFY  (marketing, captación, comunicación)  ← se mantiene
        ↓  (Deal creado/modificado)
   ┌─ Webhook tokenizado (tiempo real)
   └─ Polling -modified (backfill + reconciliación)
        ↓
   crm_ingest_deal (RPC, service-role, idempotente por clientify_deal_id)
        ↓
   crm_opportunities  ← Oportunidades 360 (operación Nexus)
        ↓
   Factibilidad → Cotización → Propuesta → Contrato → Onboarding → WMS → Tesorería
```
> Clientify = capa de captación. CRM360 = capa operativa. Una sola fuente por entidad: el **Deal** es la oportunidad.
