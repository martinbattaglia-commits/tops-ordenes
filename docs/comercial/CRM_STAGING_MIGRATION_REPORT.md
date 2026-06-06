# CRM_STAGING_MIGRATION_REPORT — CRM Comercial F2.1

**Fase:** 2 — Aplicación de migraciones · **Entorno:** staging `tops-nexus-staging` (ref `vrxosunxlhohmqymxots`) · **NUNCA producción**
**Fecha:** 2026-06-06 · **Método:** aplicación directa vía `pg` (cada migración en su propia transacción `BEGIN/COMMIT`).

---

## 1. Resultado por migración

| Migración | Tiempo | Resultado | Warnings |
|---|---|---|---|
| `0041_crm_enums` | 211 ms | ✅ OK | — |
| `0042_crm_core` | 376 ms | ✅ OK | benignos (`drop trigger if exists` sobre objetos nuevos; `pgcrypto already exists`) |
| `0043_crm_quotes_proposals` | 190 ms | ✅ OK | benignos (ídem) |
| `0044_crm_contracts_onboarding` | 176 ms | ✅ OK | benignos (ídem) |
| `0045_crm_sync_audit` | 155 ms | ✅ OK | benignos (`drop policy if exists` sobre policies nuevas) |
| `0046_crm_rbac_seed` | 171 ms | ✅ OK | — |
| **Total** | **~1,28 s** | **6/6 OK** | 0 errores |

## 2. Naturaleza de los warnings

Todos los warnings son **esperados e inofensivos**, propios de migraciones idempotentes:
- `extension "pgcrypto" already exists, skipping` — la extensión ya estaba.
- `trigger/policy "..." does not exist, skipping` — los `drop ... if exists` previos al `create` (no existían porque es la primera aplicación).

**Ningún warning indica un problema.** No hubo errores.

## 3. Estado post-aplicación (verificado)

- **10 tablas CRM** presentes en staging: `crm_leads, crm_opportunities, crm_quotes, crm_quote_items, crm_proposals, crm_contracts, crm_onboarding, crm_onboarding_tasks, crm_stage_history, clientify_sync_log`.
- **10 enums** `crm_*` creados.
- **Vista** `profiles_public` creada.
- **RLS habilitada** en las 10 tablas.
- **Sin datos residuales** (la validación posterior corre en transacción con rollback): `crm_opportunities = 0`.

## 4. Veredicto Fase 2

✅ **Las 6 migraciones del CRM se aplicaron correctamente en staging, sin errores.** El dominio quedó materializado para la validación. Producción intacta.
