# CRM360-WEBHOOK-ARCHITECTURE (Fase 4 + Fase 5 + Fase 7)

**Fecha:** 2026-06-08 · Diseño de sincronización, idempotencia y deep links. **No implementado.**

## Infraestructura existente (reutilizable)
- `POST /api/clientify/webhook/[token]` — handler **tokenizado** (token-en-URL, fail-closed) que hoy normaliza y llama `crm_ingest_lead`. ✅ se reutiliza el mecanismo de auth y el patrón.
- `POST /api/clientify/webhook` — placeholder deshabilitado (404). ✅ correcto.
- `GET /api/clientify/sync-deals` — snapshot read-only (no persiste). 🔧 se evoluciona a persistencia (backfill).
- `src/lib/clientify/client.ts` (`listDeals`, `listPipelines`), `mappers.ts` (`mapDeal`), `webhook.ts` (`verifyWebhookToken`, `normalizeLead`). ✅ base.
- `clientify_sync_log` — auditoría inbound/outbound. ✅ se reutiliza.

## Fase 4 — Estrategia de sincronización: **HÍBRIDA (webhook + polling)**

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| Solo Webhook | Tiempo real, bajo costo | Clientify **no firma** ni garantiza entrega; sin replay → **pierde eventos**; no resuelve los 172 históricos | Insuficiente solo |
| Solo Polling | Simple, confiable, backfill | Latencia; consumo de API; "casi real-time" | Insuficiente solo |
| **Híbrida** | Webhook = baja latencia para nuevos/cambios · Polling = backfill de 172 + red de seguridad/reconciliación | Dos caminos a mantener (mitigado por idempotencia) | ✅ **Elegida** |

**Justificación:** como la entrega del webhook no está garantizada y hay 172 deals preexistentes, el webhook **solo** dejaría huecos. El polling `ordering=-modified` cubre backfill inicial y reconciliación periódica; el webhook da inmediatez. Ambos convergen en la **misma RPC idempotente** → ejecutarlos en paralelo es seguro.

### Componentes
1. **Webhook (tiempo real):** `POST /api/clientify/webhook/[token]` → `normalizeDeal(payload)` → **`crm_ingest_deal`** (nueva RPC). Eventos: `deal.created`, `deal.updated`, `deal.stage_changed`, `deal.won/lost`.
2. **Polling (backfill + reconciliación):** cron (Netlify Scheduled Function / `CronCreate`) cada **15 min** → `listDeals({ordering:'-modified', page_size:200})` paginado → `crm_ingest_deal` por cada uno. Backfill inicial: recorrer las 172 (sin filtro de fecha) una vez.
3. **RPC `crm_ingest_deal`** (a crear, espejo de `crm_ingest_lead` pero target `crm_opportunities`): upsert por `clientify_deal_id`, mapeo de campos (ver DATA-FLOW), log en `clientify_sync_log`.

## Fase 5 — Deduplicación, loops, reintentos, idempotencia
- **Cero duplicados:** `crm_opportunities.clientify_deal_id` **UNIQUE** → `insert … on conflict (clientify_deal_id) do update` (upsert). Webhook y polling sobre el mismo deal convergen a una fila.
- **Idempotencia:** la RPC es determinística por `clientify_deal_id`; reejecutar N veces = mismo estado. `updated` sólo si `clientify_modified` cambió (evita writes y historial ruidoso).
- **Cero loops:** **outbound deshabilitado** (`CLIENTIFY_WRITE=0`, `write_enabled:false`). Nexus NO escribe a Clientify en el flujo de ingesta → no hay eco webhook→write→webhook. El deep link saliente (Fase 7) es opcional y aislado.
- **Reintentos seguros:** fallo de ingesta → fila `status='error'` en `clientify_sync_log` con `payload`; el polling siguiente reintenta (idempotente). Backoff en el cliente HTTP ante 429/5xx de Clientify.
- **Reconciliación:** comparar `count` Clientify (172) vs `count(crm_opportunities where clientify_deal_id is not null)`; alertar divergencia.

## Fase 7 — Deep links bidireccionales
- **Nexus → Clientify** (abrir Deal): `https://app.clientify.com/#/deals/details/{clientify_deal_id}` (patrón `…/deals/details/{id}` verificado). Botón en la ficha 360 de la oportunidad. Sin escritura.
- **Clientify → Nexus** (abrir ficha CRM360): escribir en el Deal (custom_field o nota) la URL `https://<nexus>/comercial/oportunidades/{opp_id}`. **Outbound opcional** → requiere `CLIENTIFY_WRITE=1` y se hace **una sola vez** al crear la oportunidad (marcado en `clientify_sync_log` para no repetir → sin loop).

## Seguridad
- Token-en-URL del webhook (fail-closed) ya implementado; rothar el token y guardarlo server-side.
- Service-role solo en RPC server-side; nunca expuesto al cliente.
- El `CLIENTIFY_API_KEY` válido vive en env server (no `NEXT_PUBLIC`).

## Pendiente operativo detectado
- El **MCP `clientify-mcp` tiene token inválido (401)** → actualizar su key o apuntarlo al `CLIENTIFY_API_KEY` válido de la app (no bloquea la integración server-side, que usa el token correcto).
- Configurar el **webhook en el panel de Clientify** apuntando a la URL tokenizada (sin esto, el tiempo real no funciona).
