# CRM360-CLIENTIFY-INTEGRATION-PLAN (Maestro · Fase 1)

**Fecha:** 2026-06-08 · **Auditoría + arquitectura. NO se implementó nada. Sin escritura en prod.**
Documentos asociados: `CRM360-DATA-FLOW.md` · `CRM360-WEBHOOK-ARCHITECTURE.md` · `CRM360-DATABASE-REVIEW.md` · `CRM360-IMPLEMENTATION-ROADMAP.md`.

## Objetivo
Que **toda oportunidad (Deal) que entre por Clientify llegue automáticamente a CRM360** y se gestione operativamente desde Nexus. Clientify queda como capa de captación/marketing; CRM360 como **capa operativa** (factibilidad, cotización, rentabilidad, contratación, onboarding, WMS, tesorería). **Un solo CRM lógico**, dos planos.

## Evidencia (resumen)
| Hallazgo | Evidencia |
|---|---|
| Clientify operativo, **172 deals** | `GET /deals/` (token app) → 200 · `count=172` |
| Auth correcta | `Authorization: Token <key>` (Bearer→404); `CLIENTIFY_API_KEY` (40c) **válido** |
| MCP `clientify-mcp` con token **inválido** | `401 Invalid token` (independiente de la app) |
| Esquema CRM **aplicado** en prod | tablas `crm_*` responden 200 |
| Pero **todo en 0** | `crm_leads/opportunities/quotes/proposals/contracts/onboarding = 0` |
| `clientify_deal_id` UNIQUE ya existe | `crm_opportunities` (0042) |
| Inbound actual = **lead-centric** | webhook → `crm_ingest_lead` → `crm_leads`; no toca oportunidades |
| `sync-deals` no persiste | snapshot read-only |
| Sin backfill ni polling | 172 deals nunca ingestados; sin cron |

## Causa raíz (por qué Oportunidades 360 está vacía)
1. La regla pedida es **Deal → oportunidad directa**, pero el pipeline existente va **Deal → lead → (promoción) → oportunidad**. Falta `crm_ingest_deal`.
2. El webhook **no dispara** (crm_leads también 0) → no está configurado en Clientify.
3. **No hay backfill** de los 172 deals históricos.

## Decisiones de arquitectura (justificadas)
1. **Entidad principal = Deal** (no contacto/empresa). Se ingesta directo a `crm_opportunities` keyeado por `clientify_deal_id`. *(Alinea con la regla del usuario y con la columna unique ya existente.)*
2. **Sincronización HÍBRIDA** (webhook tiempo real + polling backfill/reconciliación). *(El webhook de Clientify no está firmado ni garantiza entrega y hay 172 históricos → webhook solo deja huecos.)* Ver WEBHOOK-ARCHITECTURE.
3. **Idempotencia por `clientify_deal_id` UNIQUE + upsert**. Webhook y polling convergen sin duplicar. *(Cero duplicados, reintentos seguros.)*
4. **Sin write-back en la ingesta** (`CLIENTIFY_WRITE=0`). *(Cero loops.)* Deep link saliente opcional y aislado.
5. **Reutilizar** lo construido: handler tokenizado, `clientify/client.ts`, `clientify_sync_log`, patrón de `crm_ingest_lead`. *(No crear procesos paralelos ni un segundo CRM.)*
6. **No sincronizar primero contactos/empresas**: se resuelven/derivan desde el Deal (company/contact often null) → columnas espejo o `clientify_raw`.

## Fases (estado)
- **Fase 1 · Auditoría técnica Clientify** → ✅ hecha (DATA-FLOW).
- **Fase 2 · Auditoría de datos crm_*** → ✅ hecha (DATABASE-REVIEW).
- **Fase 3 · Mapeo Deal → oportunidad** → ✅ diseñado (DATA-FLOW).
- **Fase 4 · Estrategia de sync** → ✅ decidida: híbrida (WEBHOOK-ARCHITECTURE).
- **Fase 5 · Deduplicación/idempotencia** → ✅ diseñada (WEBHOOK-ARCHITECTURE).
- **Fase 6 · UX nunca vacía** → diseñada (ROADMAP E6).
- **Fase 7 · Deep links** → diseñados (WEBHOOK-ARCHITECTURE).
- **Fase 8 · Roadmap futuro (cotizador→…→facturación)** → diseñado, no implementar (ROADMAP).

## Campos mínimos (contrato del Deal → oportunidad)
`clientify_deal_id · company_id/company_name · contact_id/contact_name · owner · pipeline · stage · amount · status · created_at · updated_at` → cobertura y gaps detallados en DATA-FLOW + DATABASE-REVIEW (se proponen columnas espejo en migración `0052`).

## Qué falta para activar (no ejecutado)
1. Migración `0052` (columnas espejo) + `0053` (`crm_ingest_deal`).
2. `normalizeDeal` + ruteo del webhook por entidad.
3. Backfill one-shot de 172 deals (idempotente).
4. Polling de reconciliación (cron 15 min).
5. Configurar webhook en panel Clientify + actualizar token del MCP.
6. Deep links bidireccionales.

## Próximo paso
Revisar estos 5 documentos y aprobar el **orden de ejecución** del ROADMAP (E1→E8). La implementación será **incremental, con typecheck/build PASS y verificación read-only por etapa**, y **sin escritura a prod hasta autorización por etapa** (mismo criterio que RRHH/Compliance). No se inició ninguna implementación. Sin commit/push.
