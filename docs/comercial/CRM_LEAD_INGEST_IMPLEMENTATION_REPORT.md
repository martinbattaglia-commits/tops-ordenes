# CRM_LEAD_INGEST_IMPLEMENTATION_REPORT — F2.2-1 · Ingesta de leads

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** F2.2-1 — ingesta de leads (inbound only)
**Estado:** ✅ **implementado y validado en staging — 16/16 PASS (GO)**

> Solo función (additivo). No toca tablas/enums/RLS existentes. Inbound-only: sin outbound, sin write-back a Clientify. Producción, `main`, Netlify, Clientify PROD: intactos.

---

## 1. Entregables

| # | Archivo | Contenido |
|---|---|---|
| 1 | `docs/comercial/CRM_LEAD_INGEST_ARCHITECTURE.md` | Arquitectura de la ingesta |
| 2 | `supabase/migrations/0048_crm_ingest_lead.sql` | RPC `crm_ingest_lead` (`SECURITY DEFINER`) |
| 3 | `scripts/f221-ingest-staging.mjs` | QA: aplica 0048 + 16 asserts en `BEGIN…ROLLBACK` |
| 4 | `docs/comercial/CRM_LEAD_INGEST_STAGING_RESULTS.md` | Evidencia de staging (16/16) |
| 5 | Este documento | Reporte de implementación |

---

## 2. La función `crm_ingest_lead`

`crm_ingest_lead(p_lead jsonb, p_raw jsonb, p_event text) → jsonb` · `plpgsql · security definer · set search_path = public, pg_temp`.

**Flujo (una transacción):**
1. **Extrae + normaliza** del `p_lead`: `clientify_id`, `source`, `full_name`, `email` (lower/trim), `phone` (dígitos), `cuit` (guardado tal cual), `company_name`, `tags[]`.
2. **Resuelve dedup de persona** por prioridad `clientify_id → email → phone`.
3. **Asigna owner least-loaded** (solo si va a crear) entre comerciales activos.
4. **Decide y persiste** en `crm_leads`: `inserted` / `updated` (upsert por clientify_id) / `linked` (enriquece) / `duplicate_flagged` (D-4: crea + `posible_duplicado`).
5. **Audita** en `clientify_sync_log` (inbound, con `_ingest` en payload).
6. **Retorna** `{action, lead_id, public_id, owner_id, status, dedup_match, dedup_kind, flagged}`.

### 2.1 Decisiones de implementación (con justificación)
- **`SECURITY DEFINER`** (no INVOKER): el webhook no tiene sesión de usuario; la RPC es la única puerta, valida el payload, `execute` solo a `service_role`. Contrastado con el Write-Path (INVOKER) en la arquitectura.
- **CUIT fuera del dedup de lead:** identifica la **cuenta**, no la persona (dos contactos comparten CUIT). Se usa para enlazar `clients` en la promoción (F2.2-4), no para colapsar leads. *(Corrección de diseño respecto del borrador de arquitectura, documentada.)*
- **least-loaded sin tabla de puntero:** determinista (menor carga; empate → menor `owner_id`). El routing por servicio/equipo requiere una tabla de mapeo inexistente → queda como mejora additiva.
- **Nunca se pierde un lead:** sin comerciales activos → `owner_id` null pero el lead se crea; conflicto de dedup → crea + marca (no descarta ni mergea).

---

## 3. QA (resumen — detalle en `…_STAGING_RESULTS.md`)

| Capa | Resultado |
|---|---|
| Aplicación de `0048` en staging | ✅ |
| 16 asserts (insert · idempotencia · dedup link/conflict · ownership · sync_log · edge sin-owner) | ✅ 16/16 |
| No destructivo (`BEGIN…ROLLBACK`) | ✅ sin residuos |

**Método:** la RPC se ejercita vía `pg` (la misma función que llamará el handler con cliente service-role). La lógica de negocio queda 100% probada; la verificación HTTP del webhook es F2.2-2.

---

## 4. Integridad / no-duplicación

- Reusa `crm_leads`, `clientify_sync_log`, enum `crm_lead_status_t`, RBAC (`roles/user_roles`), `profiles` — **sin** redefinir nada.
- `public_id` por el trigger existente; `status` default existente; ledger `clientify_sync_log` solo INSERT (append-only respetado).
- No duplica el Write-Path: la ingesta termina en `crm_leads`; la promoción a oportunidad (que sí usa el Write-Path) es F2.2-4.

---

## 5. Frontera (lo que F2.2-1 NO incluye)

- ❌ Handler webhook + verificación de token (F2.2-2).
- ❌ Bandeja `/comercial/leads` (frente aparte — **no avanzar**).
- ❌ Promoción lead→oportunidad (F2.2-4).
- ❌ Outbound / write-back a Clientify (F2.2-6/F2.4).
- ❌ Consolidación del cliente TS (no la requiere la RPC; se hará cuando el handler/outbound la necesiten).

> **F2.2-1 cerrado.** Ingesta validada en staging. Listo para F2.2-2 (handler webhook con token-en-URL) **previa aprobación**.
