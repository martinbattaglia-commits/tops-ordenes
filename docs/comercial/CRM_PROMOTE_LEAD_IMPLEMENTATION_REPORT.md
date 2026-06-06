# CRM_PROMOTE_LEAD_IMPLEMENTATION_REPORT — F2.2-4

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** F2.2-4 — promoción Lead → Opportunity
**Estado:** ✅ **implementado · 14/14 PASS · tsc/lint verdes**

> Sin outbound, sin write-back. Producción/`main`/Netlify/Clientify PROD: intactos.

---

## 1. Entregables

| # | Archivo |
|---|---|
| 1 | `docs/comercial/CRM_PROMOTE_LEAD_ARCHITECTURE.md` (arquitectura) |
| 2 | `supabase/migrations/0050_crm_promote_lead.sql` (RPC) + `lead-actions.ts::promoteLead` (app-layer) |
| 3 | `scripts/f224-promote-staging.mjs` (QA) |
| 4 | `docs/comercial/CRM_PROMOTE_LEAD_STAGING_RESULTS.md` (evidencia) |
| 5 | Este documento (reporte) |

---

## 2. Qué se implementó (mapa al alcance)

| Alcance | Implementación |
|---|---|
| **RPC `crm_promote_lead`** | `SECURITY INVOKER`, atómica |
| **Creación de `crm_opportunities`** | `estado='calificado'`, `committed_state=none` |
| **Herencia de owner** | `owner_id` ← lead |
| **Herencia de datos de contacto** | `contacto/email/telefono/cuit` ← lead |
| **Enlace lead ↔ opportunity** | `crm_leads.opportunity_id` ↔ `crm_opportunities.lead_id` |
| **Status → promovido** | `crm_leads.status='promovido'` |
| **stage_history inicial** | `(null → calificado)`, `changed_by=auth.uid()` |

Extra coherente con el diseño: **enlace a `clients` por CUIT** (cuenta canónica) — el punto donde el CUIT del lead se usa, como se anticipó en F2.2-1.

### 2.1 Decisiones
- **`SECURITY INVOKER`** (vs ingesta DEFINER): la promoción tiene usuario → RLS de sesión + `auth.uid()`. Mantiene R-G2.
- **Guarda de negocio** (service_type + CUIT/cliente): toda oportunidad nace con datos mínimos (PIPELINE §5.2).
- **Idempotencia** por `opportunity_id`/`status='promovido'` → re-promover es no-op.
- **No duplica el Write-Path:** la promoción deja la opp en `calificado`; de ahí mandan `advanceStage`/`reserveCapacity` (F2.1).
- **`promoteLead` (server action)** es la superficie lista para el disparador en la bandeja; el botón con selección de servicio es glue de UI (se evalúa antes de F2.2-5).

---

## 3. QA

- **14/14 PASS** en staging: promoción feliz (todas las herencias/enlaces/ledger), idempotencia, y 4 guards (missing-data, descartado, invalid-service, RLS).
- **Manejo de tx:** savepoints en el harness para validar los `raise` esperados sin abortar la corrida.
- **tsc/lint:** verdes.

---

## 4. Frontera

- ❌ Outbound / write-back a Clientify.
- ❌ Botón de promoción en la bandeja (glue de UI).
- ❌ Producción/`main`/Netlify/Clientify PROD/Supabase PROD.

> **F2.2-4 cerrado.** Ver `CRM_INBOUND_CYCLE_STATUS.md` para evaluar el ciclo inbound antes de pasar a F2.2-5.
