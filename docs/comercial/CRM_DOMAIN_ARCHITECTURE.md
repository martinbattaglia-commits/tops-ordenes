# CRM_DOMAIN_ARCHITECTURE — Dominio CRM Comercial Nexus (completo)

**Estado:** F2.1 (núcleo + capa de negocio) diseñado y migrado **en archivos** · **antes de cualquier ejecución real**
**Rama:** `feature/crm-comercial-f2-1` (aislada, sin merge a main, sin apply, sin deploy)
**Fecha:** 2026-06-04
**Propósito:** mapa único del dominio CRM — tablas, relaciones, enums, RLS, convenciones, integración con el Motor de Capacidad y manifiesto de migraciones. Punto de control previo a ejecutar contra cualquier DB.

**Documentos del dominio:**
[F2.1_ARCHITECTURE](./COMMERCIAL_F2_1_ARCHITECTURE.md) · [MASTER_PLAN](./COMMERCIAL_MODULE_MASTER_PLAN.md) · [DATA_MODEL](./CLIENTIFY_NEXUS_DATA_MODEL.md) · [PIPELINE](./COMMERCIAL_PIPELINE_DESIGN.md) · [ONBOARDING](./ONBOARDING_AUTOMATION_DESIGN.md) · [KPI](./COMMERCIAL_KPI_DASHBOARD.md) · [VACANCY](./VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md)

---

## 1. Manifiesto de migraciones (estado: archivos, NO aplicadas)

| Migración | Contenido | Tablas | Estado |
|---|---|---|---|
| `0041_crm_enums.sql` | enums núcleo | — | ✅ archivo |
| `0042_crm_core.sql` | leads + oportunidades (eje) | `crm_leads`, `crm_opportunities` | ✅ archivo |
| `0043_crm_quotes_proposals.sql` | cotizaciones + propuestas | `crm_quotes`, `crm_quote_items`, `crm_proposals` | ✅ archivo |
| `0044_crm_contracts_onboarding.sql` | contratos + onboarding | `crm_contracts`, `crm_onboarding`, `crm_onboarding_tasks` | ✅ archivo |
| `0045_crm_sync_audit.sql` | auditoría + sync | `crm_stage_history`, `clientify_sync_log` | ✅ archivo |
| `00xx_crm_rbac_seed.sql` | permisos finos + `profiles_public` | — | ⏳ F2.1-3 |

**10 tablas** del dominio. **Ninguna aplicada** a Supabase (PROD prohibido). Validación = conformidad estructural con patrones del repo.

---

## 2. Mapa de entidades (FK graph)

```
                         Clientify (externo)
                              │ webhook/pull → clientify_sync_log
                              ▼
clients ──────┐         crm_leads ──opportunity_id──┐
(0001, cuit)  │            │ lead_id                 │
              │            ▼                         │
              ├──< crm_opportunities (EJE) >─────────┘
              │       │ public_id OPP-YYYY-0001
              │       │ + capacity_feasible/assigned_site/assigned_units/committed_state
              │       ├──< crm_quotes ──< crm_quote_items
              │       │       │ pdf→documents
              │       ├──< crm_proposals (quote_id) · pdf→documents
              │       ├──< crm_contracts (proposal_id, client_id) · pdf→documents
              │       │       │
              │       ├──< crm_onboarding (contract_id) ──< crm_onboarding_tasks · doc→documents
              │       └──< crm_stage_history (append-only)
              ▼
        (cliente activo → orders / logistics_orders / WMS)
```

Anclas a lo existente (no modificadas): `clients` (0001), `documents` (0010), `depot_t` (0004), `auth.users`, helpers RLS (0005), `tg_touch_updated_at` (0004).

---

## 3. Tablas — columnas clave

| Tabla | PK | public_id | Columnas distintivas |
|---|---|---|---|
| `crm_leads` | uuid | LEAD-YYYY-0001 | clientify_id (uniq), status, owner_id, raw jsonb, opportunity_id |
| `crm_opportunities` | uuid | OPP-YYYY-0001 | service_type, m2, estado, probabilidad, monto, clientify_deal_id (uniq), **capacity_feasible, assigned_site, assigned_units, committed_state** |
| `crm_quotes` | uuid | COT-YYYY-0001 | subtotal, descuento_total, iva, total, status, pdf_document_id, payload |
| `crm_quote_items` | uuid | — | concepto, categoria, cantidad, unidad, precio_unit, importe |
| `crm_proposals` | uuid | PROP-YYYY-0001 | tipo, version, status, pdf_document_id, unique(opp,tipo,version) |
| `crm_contracts` | uuid | CON-YYYY-0001 | version, status, signed_at, signature_evidence_id, valid_from/until |
| `crm_onboarding` | uuid | ONB-YYYY-0001 | status, progress_pct, started_at, completed_at |
| `crm_onboarding_tasks` | uuid | — | tipo (rne/croquis/plancheta/accesos/documentacion), status, document_id |
| `crm_stage_history` | bigserial | — | from_stage, to_stage, changed_by, changed_at (append-only) |
| `clientify_sync_log` | bigserial | — | direction, entity, clientify_id, nexus_id, event, status, payload |

---

## 4. Enums (8)

| Enum | Valores |
|---|---|
| `crm_lead_status_t` | nuevo · contactado · calificado · descartado · promovido |
| `crm_service_t` | anmat · general · oficinas |
| `crm_stage_t` | nuevo_lead · contactado · calificado · visita · propuesta · negociacion · ganado · perdido |
| `crm_committed_state_t` | none · reservado · comprometido · ocupado |
| `crm_quote_status_t` | borrador · enviada · aceptada · rechazada · vencida |
| `crm_proposal_t` | anmat · general |
| `crm_proposal_status_t` | borrador · enviada · aceptada · rechazada |
| `crm_contract_status_t` | borrador · enviado · firmado · vigente · vencido · rescindido |
| `crm_onboarding_status_t` | pendiente · en_curso · bloqueado · completado |
| `crm_onboarding_task_t` | rne · croquis · plancheta · accesos · documentacion |

(El módulo `comercial` ya existe en `permission_module_t` desde 0009 — no se agrega.)

---

## 5. Convenciones aplicadas (conformidad con el repo)

- **PK** `uuid default gen_random_uuid()`; ledgers (`crm_stage_history`, `clientify_sync_log`) en `bigserial`.
- **ID humano** `short_id` (secuencia) + `public_id` por trigger BEFORE INSERT (patrón 0030).
- **Timestamps** `created_at`/`updated_at` con `tg_touch_updated_at()` (0004).
- **Auditoría** `created_by → auth.users on delete set null`.
- **Soft-delete** `deleted_at` (patrón documents 0010); delete físico solo admin.
- **RLS** habilitada en las 10 tablas: lectura `is_staff() OR role='comercial'`; escritura `admin/operaciones/supervisor/comercial`; delete `is_admin()`. Helpers de 0005.

---

## 6. Integración con el Motor Corporativo de Capacidad

`crm_opportunities` es la **unidad de compromiso** que el motor (`corporate-capacity.ts`) leerá:

| Campo | Rol |
|---|---|
| `capacity_feasible` | resultado de `findAvailability({category, m2})` al calificar |
| `assigned_site` / `assigned_units` | sede/sector/cubículo/isla sugeridos por el motor |
| `committed_state` | `none → reservado → comprometido → ocupado` (2 capas, F-2/3) |

**Ciclo:** reservado (propuesta/negociación) → comprometido (ganado) → ocupado (onboarding completado; **sale del committed** — su m² ya vive en la ocupación física del Digital Twin: regla anti-doble-conteo). Activación en F2.1-4 (`COMMITTED_M2_ENABLED=true`). Hoy committed=0.

```
vacancia_comercial  = comercializable − ocupado − comprometido(ganado no onboardeado)
vacancia_proyectada = vacancia_comercial − reservado(propuesta/negociación)
```

---

## 7. Lo que falta para "ejecución real" (checklist previo al apply)

| # | Ítem | Fase |
|---|---|---|
| 1 | RBAC seed (`comercial.create/delete/admin`) + vista `profiles_public` | F2.1-3 |
| 2 | Validar migraciones contra **staging** (no PROD) en el proceso de gates | pre-apply |
| 3 | Activar hook capacidad (`COMMITTED_M2_ENABLED`, `committedFor()` lee `crm_opportunities`) | F2.1-4 |
| 4 | Webhook Clientify HMAC + persistencia (`crm_leads`, `clientify_sync_log`) | F2.1-5 |
| 5 | UI `/comercial/oportunidades` + persistencia cotizaciones/propuestas | F2.1-6/7 |
| 6 | Server actions de transición de etapa (escriben `crm_stage_history` + side-effects) | F2.1-6 |

> **Ninguna migración se aplica** hasta autorización explícita y validación en staging. Este documento es el punto de control del dominio antes de cualquier ejecución real.

---

## 8. Estado del dominio

- ✅ **Modelo de datos completo** (10 tablas, 10 enums, RLS, triggers) en archivos.
- ✅ **Integración con capacidad** diseñada y con columnas en su lugar.
- ✅ **Flujo end-to-end** definido (Clientify → … → Onboarding → Operación).
- ⏳ Sin aplicar · sin RBAC seed · sin UI · sin webhook productivo.

**Sin apply · sin Supabase PROD · sin deploy · sin main · sin Netlify.**
