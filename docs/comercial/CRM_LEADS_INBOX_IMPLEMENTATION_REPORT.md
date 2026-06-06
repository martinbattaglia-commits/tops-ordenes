# CRM_LEADS_INBOX_IMPLEMENTATION_REPORT — F2.2-3 · Bandeja de leads

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** F2.2-3 — bandeja de leads
**Estado:** ✅ **implementado · 7/7 PASS (DB) · tsc/lint/build verdes**

> Inbound-only. Sin promoción a oportunidad, sin outbound. Producción/`main`/Netlify/Clientify PROD: intactos.

---

## 1. Entregables

| # | Archivo |
|---|---|
| 1 | `docs/comercial/CRM_LEADS_INBOX_ARCHITECTURE.md` (arquitectura) |
| 2 | `page.tsx` + `LeadsInboxView.tsx` + `leads-data.ts` + `leads-supabase.ts` + `lead-actions.ts` + `crm-types.ts` + `0049_crm_list_commercial_users.sql` (implementación) |
| 3 | `scripts/f223-leads-staging.mjs` (QA) |
| 4 | `docs/comercial/CRM_LEADS_INBOX_STAGING_RESULTS.md` (evidencia) |
| 5 | Este documento (reporte) |

---

## 2. Qué se implementó (mapa al alcance)

| Alcance | Implementación |
|---|---|
| **Listado de `crm_leads`** | `listLeadsDb` (RLS `comercial.view`) + fallback a muestra local |
| **Filtros** | búsqueda libre, estado, owner (incl. "sin asignar"), fuente, posible-duplicado |
| **Ownership** | `owner_id` → nombre vía `profiles_public` (sin email) |
| **Posible duplicado** | derivado de `tags`; badge "dup" + filtro + KPI |
| **Reasignación** | dropdown de comerciales activos (`crm_list_commercial_users`, RPC 0049) → `reassignLead` |
| **Calificación** | `setLeadStatus` (nuevo/contactado/calificado/descartado/reactivar) — **sin** `promovido` |
| **Indicadores** | 6 KPIs (total, nuevos, contactados, calificados, sin asignar, posibles duplicados) |

### 2.1 Decisiones
- **Migración 0049 (`crm_list_commercial_users`, `SECURITY DEFINER`, PII-safe):** necesaria para poblar el dropdown de reasignación de forma RLS-safe (leer roles de otros usuarios bajo RLS de sesión puede no resolver). Additiva, validada en staging.
- **Calificación ≠ promoción:** la bandeja cambia `status` pero NO crea la oportunidad (F2.2-4). `setLeadStatus` rechaza `promovido` y no toca leads ya promovidos.
- **Acciones `SECURITY INVOKER` (sesión de usuario):** UPDATE directo de una sola tabla bajo RLS `comercial.edit` (sin RPC; no hay atomicidad multi-tabla). Contrasta con la ingesta (`crm_ingest_lead`, DEFINER) que sí es tráfico de máquina.
- **Gate de escritura UI** (`source==='supabase'`) coherente con RA-1.

---

## 3. QA (detalle en `…_STAGING_RESULTS.md`)

- **tsc / lint / build:** verdes; `/comercial/leads` bundlea (3.53 kB).
- **7/7 PASS** en staging: helper PII-safe, reasignación bajo RLS, calificación, guard promovido, RLS por rol (0 filas sin permiso), owner resolution.
- **Limitación honesta:** el render interactivo no se prueba contra staging (ruta auth-gated + runtime apunta a PROD; sin credenciales reales). Cubierto por build + validación DB de las operaciones de las acciones.

---

## 4. Integridad / frontera

- Reusa `crm_leads`, `profiles_public`, RBAC; mapper consistente con `opportunities-mapper` (snake→camel). No duplica lógica.
- ❌ Promoción a oportunidad (F2.2-4) · ❌ outbound/write-back · ❌ producción/`main`/Netlify/Clientify PROD/Supabase PROD.

> **F2.2-3 cerrado.** La bandeja es el primer lugar donde Comercial ve leads reales de Clientify. Próximo: F2.2-4 (promoción) o F2.2-5 (pull), **previa aprobación**.
