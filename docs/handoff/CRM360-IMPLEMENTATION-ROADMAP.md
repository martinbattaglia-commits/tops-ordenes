# CRM360-IMPLEMENTATION-ROADMAP (Fase 6 + Fase 8 + plan de ejecución)

**Fecha:** 2026-06-08 · Roadmap de implementación. **Nada implementado aún** (auditoría/diseño primero, por indicación).

## Principio rector
Clientify = captación/marketing. **CRM360 = capa operativa** (factibilidad → cotización → rentabilidad → operación → contratación → onboarding → WMS → tesorería). **Una sola fuente por entidad:** el **Deal** ES la oportunidad. No dos CRMs.

## Etapas de implementación (cuando se autorice)

### E1 · Schema mirror (migración `0052`, no aplicar aún)
Agregar a `crm_opportunities` columnas espejo de Clientify (o `clientify_raw jsonb`): `clientify_company_id`, `company_name`, `clientify_contact_id`, `pipeline`, `pipeline_stage`, `owner_name`, `clientify_modified`. Mantiene los campos mínimos pedidos.

### E2 · RPC `crm_ingest_deal` (migración `0053`)
Espejo de `crm_ingest_lead` pero target `crm_opportunities`: upsert por `clientify_deal_id`, mapeo (DATA-FLOW), `crm_stage_history` en cambios de etapa, log en `clientify_sync_log`. Idempotente.

### E3 · Normalizador + webhook deal-aware
`src/lib/clientify/webhook.ts` → `normalizeDeal(payload)`. El handler `POST /api/clientify/webhook/[token]` enruta por `entity`: deal → `crm_ingest_deal`; (lead se mantiene si se usa).

### E4 · Backfill de 172 deals
Script/route one-shot: `listDeals` paginado completo → `crm_ingest_deal` por cada uno. Idempotente y re-ejecutable. Resultado esperado: `crm_opportunities ≈ 172`.

### E5 · Polling de reconciliación
Netlify Scheduled Function (o cron) cada 15 min: `listDeals({ordering:'-modified'})` → ingest. Red de seguridad del webhook.

### E6 · UX — Oportunidades 360 nunca vacía (Fase 6)
- La página `comercial/oportunidades` ya lee `crm_opportunities` (`listOpportunitiesDb`) con fallback a muestra local. Tras E4, mostrará las 172 reales.
- Empty-state honesto sólo si realmente no hay deals en Clientify (no debería ocurrir).
- Indicador "Sincronizado con Clientify · última sync hace Xm" (de `clientify_sync_log`).

### E7 · Deep links (Fase 7)
- Nexus → Clientify: botón en ficha 360 → `app.clientify.com/#/deals/details/{clientify_deal_id}`.
- Clientify → Nexus: nota/custom_field con URL de la ficha (outbound opcional, `CLIENTIFY_WRITE=1`, una sola vez).

### E8 · Operativo
- Actualizar token del MCP `clientify-mcp` (hoy 401).
- Configurar webhook en panel Clientify → URL tokenizada.

## Fase 8 — Roadmap futuro (sólo diseño, NO implementar)
Cadena operativa post-oportunidad, ya modelada en el esquema CRM (0043/0044/0051):
```
crm_opportunities
   ↓  Cotizador        → crm_quotes (+ crm_quote_items)      [tablas existen]
   ↓  Propuesta        → crm_proposals                        [existe]
   ↓  Contrato         → crm_contracts                        [existe]
   ↓  Alta Cliente     → clients (+ cuit)                     [existe]
   ↓  WMS              → recepción/custodia (módulo WMS)      [existe]
   ↓  Tesorería        → customer_current_account / cobranzas [existe]
   ↓  Facturación      → customer_invoices (ARCA)             [existe]
```
La arquitectura ya soporta la cadena (las tablas `crm_quotes/proposals/contracts/onboarding` y los módulos WMS/Tesorería/Facturación existen). La activación es **incremental** y posterior a la Fase 1.

## Orden de ejecución propuesto
`E1 → E2 → E3 → E4 (backfill) → verificar Oportunidades 360 = 172 → E5 → E6 → E7 → E8`.
Cada etapa con typecheck/build PASS y verificación read-only de conteos. **Sin escritura a prod hasta tu autorización por etapa** (mismo criterio conservador que RRHH/Compliance).

## Criterios de aceptación (Fase 1 cerrada cuando)
- Todo Deal de Clientify (incl. los 172) existe en `crm_opportunities` (idempotente, sin duplicados).
- Oportunidades 360 deja de estar vacía.
- Deep link Nexus→Clientify operativo.
- `clientify_sync_log` registra cada ingesta (auditable).
