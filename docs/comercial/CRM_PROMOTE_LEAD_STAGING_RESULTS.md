# CRM_PROMOTE_LEAD_STAGING_RESULTS — F2.2-4 · Evidencia

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Entorno:** `tops-nexus-staging` · ref **`vrxosunxlhohmqymxots`**
**Harness:** `scripts/f224-promote-staging.mjs` · tsc/lint del app-layer

## Resultado

> ## ✅ GO — 14/14 PASS · tsc ✅ · lint ✅
> `0050` aplicada. Promoción Lead→Opportunity validada end-to-end en staging. ROLLBACK — sin residuos.

---

## 1. Detalle (14 asserts · todos PASS)

| # | Escenario | Resultado | Detalle |
|---|---|---|---|
| 0 | `crm_promote_lead` existe y es SECURITY INVOKER | ✅ | prosecdef=false |
| 1 | promote → `action=promoted` + OPP creado | ✅ | OPP-2026-NNNN |
| 1 | opp `estado=calificado` + `public_id` OPP- | ✅ | |
| 1 | **herencia owner** | ✅ | owner=U1 |
| 1 | **herencia contacto/email/teléfono** | ✅ | María Pérez |
| 1 | **enlace `clients` por CUIT** | ✅ | client_id linkeado |
| 1 | `opp.lead_id` = lead | ✅ | |
| 1 | **lead `status=promovido` + `opportunity_id`** | ✅ | |
| 1 | **stage_history inicial** (null→calificado, changed_by=comercial) | ✅ | |
| 2 | Idempotencia → `already_promoted`, sin opp nueva | ✅ | opps=1 |
| 3 | Sin CUIT/cliente → `MISSING_BUSINESS_DATA` + lead intacto | ✅ | |
| 4 | Lead descartado → `LEAD_DISCARDED` | ✅ | |
| 5 | `service_type` inválido → `INVALID_SERVICE` | ✅ | |
| 6 | Sin comercial → `LEAD_NOT_FOUND` (RLS de lectura) | ✅ | |

**TOTAL 14 · PASS 14 · FAIL 0.**

---

## 2. Compilación (app-layer)

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx next lint` (lead-actions.ts con `promoteLead`) | ✅ sin warnings |

---

## 3. Método y nota

- **Cubierto:** la RPC completa (creación, herencias, enlaces, status, ledger, guards, idempotencia, RLS) vía `pg` impersonando comercial — la misma función que invoca `promoteLead`. El manejo de transacción usa **savepoints** para recuperar tras cada `raise` esperado y seguir validando (sin residuos: ROLLBACK final).
- **App-layer:** `promoteLead` compila/lintea; su prueba HTTP corresponde a un entorno autenticado con `crm_*` (no hay claves supabase-js de staging; runtime apunta a PROD).
- **No destructivo:** `BEGIN…ROLLBACK`; fixtures (usuarios, client, 4 leads) no persisten.

---

## 4. Estado de producción

- **PROD / `main` / Netlify / Clientify PROD:** intactos.
- **Staging:** `0050` aplicada (función additiva). Sin datos de prueba (rollback).

> **F2.2-4 GO.** Promoción operativa. Ver `CRM_INBOUND_CYCLE_STATUS.md` para la evaluación del ciclo inbound antes de F2.2-5.
