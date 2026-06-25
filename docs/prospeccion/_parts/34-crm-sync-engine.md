# CRM Sync Engine — Reglas (normativo)

> **Refina la Decisión 5.** Motor de sincronización a CRM genérico, event-driven, outbound-first. Normativo. El dominio nunca conoce el CRM concreto; todo vive detrás de `CrmSyncPort` + adapters.

## CRM-1 — Contrato del `CrmSyncPort` (canónico)
El puerto expone operaciones **canónicas y CRM-agnósticas**: `upsertContact`, `upsertCompany`, `upsertDeal`, `findDuplicate`, `mapFields(canonical→crm)` y `getRemote` (reservado para bidireccional futuro). El dominio **NO** invoca el puerto directo: emite el evento/comando `crm.sync.requested` y el **engine** resuelve el adapter por configuración. Las rarezas de cada CRM **NO DEBEN** filtrarse al puerto.

## CRM-2 — Un adapter por CRM (YAGNI estricto)
Un adapter por CRM. **Solo se implementa `ClientifyCrmAdapter` ahora**; HubSpot/Salesforce/Zoho/Dynamics/Pipedrive son **contratos, no código**. Cada adapter encapsula: auth, rate limits, IDs de custom fields (por config), mapeo de payload y **normalización de errores** (transitorio vs permanente). Ningún tipo del SDK del CRM cruza el adapter (ACL — HEX-3/DG-3).

## CRM-3 — Idempotencia
Cada operación outbound lleva una **idempotency key determinista** (`prospect_id` + CRM destino + operación). El engine registra `(prospect_id, crm_provider, crm_contact_id/crm_deal_id)` en `prospeccion_crm_refs` (provider-agnostic, CC-6) y el constraint `unique(prospect_id, crm_provider)` impide duplicados — **nunca** columnas específicas de un proveedor en la fila raíz. Reejecutar un sync ya realizado es **no-op** (verifica `remote_id` + checksum del payload).

## CRM-4 — Dedup previo (no crear duplicados existentes)
Antes de crear, el engine **DEBE** buscar en el CRM destino (por email/CUIT) **y** reconciliar contra `crm_leads` (patrón `reconcile.ts`). Si hay match → **update (upsert)**, no create. La dedup de persona canónica es `clientify_id→email→phone`; CUIT identifica la cuenta/empresa.

## CRM-5 — Gate de aprobación (regla dura)
El push **solo** ocurre desde el estado `aprobado` + permiso de sync. `crm.sync.requested` lo emite **únicamente** el caso de uso de aprobación. La RPC/caso de uso **valida el estado** y **rechaza** si no está `aprobado`. (Nota de prod: `permission_action_t` no tiene `'sync'` → el permiso usará `action='export'` o se extenderá el enum en F5; en F0 no existe.)

## CRM-6 — Mapeo de campos y custom fields
Tabla de mapeo **canónico→CRM por adapter**. `score`, enriquecimiento y resumen IA van como **custom fields**; sus IDs son **específicos del tenant** → se resuelven por **configuración/descubrimiento**, **nunca hardcode**. Un custom field requerido ausente → el sync **falla fuerte** (no se descarta en silencio).

## CRM-7 — Reversibilidad (definición honesta)
"Reversible" = **acciones compensatorias vía eventos** (`crm.sync.reverted`) + **soft-undo** donde el CRM lo permita (archivar/flag), **NO** borrado duro garantizado. Cada sync escribe un **journal reversible** (qué se creó/actualizó remotamente, con `remote_id`) para habilitar compensación. El hard-delete externo es best-effort + logueado. No se promete deshacer lo que el CRM externo no permite deshacer.

## CRM-8 — Auditabilidad
Todo intento outbound + resultado se registra en **`clientify_sync_log`** (reuso) con `direction='outbound'`, `entity='prospect'`, `correlation_id`, checksum del payload, `remote_id`, `status`, `error`. Rastro completo, inmutable (DG-7).

## CRM-9 — Resiliencia
**Circuit Breaker + Rate Limiter por adapter de CRM** (EVT-10); **timeout por operación**; errores transitorios → retry vía outbox (EVT-2); permanentes → DLQ + alerta (EVT-3). Respetar los rate limits de la API del CRM con un limiter **persistido** (no in-memory).

## CRM-10 — Canonical Mapping / ACL bidireccional
El engine **nunca** envía entidades de dominio: mapea **Canonical DTO → payload CRM** en el adapter. El camino inbound (bidireccional futuro) mapea **CRM → Canonical DTO → dominio**, nunca payload externo directo al dominio (DG-3).

## CRM-11 — Disparador del 2º adapter ("regla de tres")
El 2º adapter de CRM se construye ante una **necesidad de negocio concreta** (un cliente/tenant sobre HubSpot, etc.), no especulativamente. Construir el 2º adapter **valida la abstracción**: si encaja sin cambiar `CrmSyncPort`, el puerto está probado genérico; si no encaja, se **refactoriza el puerto** en ese momento (con su ADR). Hasta entonces: solo contratos.

## CRM-12 — Roadmap bidireccional (diferido)
Outbound en **F5**; inbound/reconcile/resolución de conflictos en **F7**. Política de conflicto (cuando haya bidireccional): **fuente de verdad por campo documentada** (ej. campos de enriquecimiento = Nexus; etapa de pipeline = CRM) + last-write-wins por timestamp como desempate. Reusa el webhook + `reconcile.ts` existentes.

---

**Objetivo** — Sincronizar prospectos aprobados a cualquier CRM sin acoplar el dominio, de forma idempotente, auditable y reversible.
**Alcance** — `CrmSyncPort` + adapters; el adapter Clientify (F5); el inbound bidireccional (F7).
**Decisiones tomadas** — CRM-1..CRM-12: puerto canónico; un adapter por CRM con solo Clientify ahora (YAGNI); idempotencia + dedup previo; gate de aprobación duro; custom fields por config; reversibilidad por compensación; auditoría en `clientify_sync_log`; circuit breaker + rate limiter; ACL bidireccional; regla de tres para el 2º adapter; bidireccional diferido a F7 con fuente de verdad por campo.
**Decisiones descartadas** — acoplar a Clientify directo (lock-in); iPaaS/API unificada (dependencia + costo + igual hay mapeo); construir 6 adapters ya (YAGNI); bidireccional en F5 (complejidad prematura); reversibilidad como borrado duro garantizado (irreal en CRMs externos).
**Justificación** — Desacopla donde importa (frontera CRM), reusa activos de prod (`crm_ingest_lead`, `clientify_sync_log`), y difiere la parte difícil (bidireccional) con escalonamiento claro.
**Riesgos** — Abstracción que filtra → mitigación: regla de tres (CRM-11) + rarezas en adapter. Duplicados/custom-fields → CRM-3/4/6. Reversibilidad limitada → CRM-7 honesto.
**Impacto sobre la arquitectura** — Define la frontera de salida comercial de la plataforma por años; el puerto canónico es el contrato que todo CRM futuro respeta; condiciona el evento `crm.sync.*` y su auditoría.
