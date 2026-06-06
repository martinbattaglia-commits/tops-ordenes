# CRM_PULL_RECONCILIATION_IMPLEMENTATION_REPORT — F2.2-5

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** F2.2-5 — reconciliación por pull (backbone de resiliencia inbound)
**Estado:** ✅ **implementado · 10/10 PASS · tsc/lint/build verdes**

> Inbound-only. Sin outbound, sin write-back. Sin migración nueva (reusa 0048).

---

## 1. Entregables

| # | Archivo |
|---|---|
| 1 | `docs/comercial/CRM_PULL_RECONCILIATION_ARCHITECTURE.md` (arquitectura) |
| 2 | `src/lib/clientify/reconcile.ts` + `src/app/api/clientify/sync-contacts/route.ts` (implementación) |
| 3 | `scripts/f225-reconcile-staging.mts` (QA) |
| 4 | `docs/comercial/CRM_PULL_RECONCILIATION_STAGING_RESULTS.md` (evidencia) |
| 5 | Este documento (reporte) |

---

## 2. Qué se implementó (mapa al alcance)

| Alcance | Implementación |
|---|---|
| **Persistencia** | re-ingesta → `crm_leads` + `clientify_sync_log(event='pull')` |
| **Reconciliación** | `reconcileContacts(contacts, ingest)` sobre la ventana reciente |
| **Detección de divergencias** | `recovered`/`recoveredIds` (inserted durante pull) |
| **Recuperación ante webhook perdido** | contacto sin lead → insertado por el pull |
| **Idempotencia** | `crm_ingest_lead` por `clientify_id` (re-correr no duplica) |

### 2.1 Decisiones
- **Pull de contactos** (no de deals): el webhook inbound es contacto→lead, así que la resiliencia recupera contactos. `sync-deals` (deals→oportunidades) es un pull hermano fuera del inbound de leads. → ruta nueva `/api/clientify/sync-contacts`.
- **`ingest` inyectable:** la lógica (`reconcileContacts`) es agnóstica del transporte → el route usa `supabase.rpc`; el QA usa `pg`. Permite validar la lógica real contra staging sin claves supabase-js.
- **Sin migración:** reutiliza la RPC idempotente 0048; la reconciliación es re-ingesta.
- **Read-only sobre Clientify:** `listContacts`; jamás escribe (inbound-only).

---

## 3. QA

- **10/10 PASS** en staging: recuperación (webhook perdido), refresco, skip, persistencia (+1), idempotencia (pull#2 sin duplicados), log `pull`, divergencia recuperada.
- **tsc/lint/build verdes.**
- **Limitación honesta:** la capa HTTP (Clientify read + service-role) no se ejercita contra staging (runtime→PROD; sin claves staging) → cubierta por build + validación de la lógica con `ingest` inyectado.

---

## 4. Frontera

- ❌ Outbound / write-back a Clientify.
- ❌ Mirror de deals→oportunidades (pertenece a `sync-deals`/outbound, fuera del inbound).
- ❌ Producción/`main`/Netlify/Clientify PROD/Supabase PROD.

> **F2.2-5 cerrado.** El inbound queda con su backbone de resiliencia. Cierre formal del ciclo en `CLIENTIFY_INBOUND_CLOSURE.md`.
