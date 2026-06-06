# PROD_MIGRATION_IMPACT_MATRIX — Impacto de 0041–0051 sobre PRODUCCIÓN

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Autor:** CTO de Release
**Alcance:** informe de impacto **migración por migración** del set CRM (`0041`–`0051`) sobre Supabase PROD.
**Estado:** **NO ejecutado, NO aplicado.** Solo análisis del contenido real de cada archivo.

> Veredicto global (adelanto): **10 de 11 migraciones son 100% aditivas sobre objetos NUEVOS** (cero impacto en el schema/datos existentes). **Solo `0046` toca tablas pre-existentes**, y lo hace con **seed idempotente** (`on conflict do nothing`) en `permissions`/`role_permissions`. **Ninguna** migración hace `ALTER`/`DROP`/`TRUNCATE`/`DELETE` sobre tablas pre-CRM. Riesgo global: **BAJO**, reversible.

---

## 1. Detalle por migración

### `0041_crm_enums.sql`
| Campo | Valor |
|---|---|
| Tablas creadas | — |
| Enums | **4**: `crm_lead_status_t`, `crm_service_t`, `crm_stage_t`, `crm_committed_state_t` |
| Índices / Triggers / Funciones | — / — / — |
| RLS / RBAC | — |
| Cambios sobre tablas existentes | **Ninguno** |
| ¿100% aditiva? | ✅ **Sí** (tipos nuevos) |
| Rollback | `drop type` de los 4 (o restore). Re-ejecutable (`do $$ … exception when duplicate_object`). |
| Riesgo | 🟢 Nulo |

### `0042_crm_core.sql`
| Campo | Valor |
|---|---|
| Tablas | **2**: `crm_leads`, `crm_opportunities` |
| Enums | — |
| Índices | **8** (sobre las 2 tablas nuevas: status/owner/cuit/estado/service/client/committed) |
| Triggers | **4**: `trg_set_crm_lead_public_id`, `trg_set_crm_opportunity_public_id` (BEFORE INSERT), `trg_crm_leads_touch`, `trg_crm_opp_touch` (BEFORE UPDATE) |
| Funciones | **2**: `set_crm_lead_public_id`, `set_crm_opportunity_public_id` (reusa `tg_touch_updated_at` 0004) |
| RLS | RLS ON + **8 policies** (read/write/update/delete × 2 tablas; `has_permission('comercial.*')`) |
| ALTER | `crm_leads` (FK circular → `crm_opportunities`) + enable RLS — **sobre las tablas NUEVAS** |
| Cambios sobre tablas existentes | **Ninguno** |
| ¿100% aditiva? | ✅ **Sí** (todo sobre objetos nuevos) |
| Rollback | `drop table crm_opportunities, crm_leads cascade` + `drop function` (o restore). Re-ejecutable (`if not exists`). |
| Riesgo | 🟢 Bajo |

### `0043_crm_quotes_proposals.sql`
| Campo | Valor |
|---|---|
| Tablas | **3**: `crm_quotes`, `crm_quote_items`, `crm_proposals` |
| Enums | **3**: `crm_quote_status_t`, `crm_proposal_t`, `crm_proposal_status_t` |
| Índices | 4 · Triggers | 4 (public_id + touch) · Funciones | 2 (public_id) |
| RLS | **4 policies** (`comercial.*`) |
| Cambios sobre tablas existentes | **Ninguno** (FK a `crm_opportunities`/`documents`; `documents` ya existe — solo referencia, no la altera) |
| ¿100% aditiva? | ✅ **Sí** |
| Rollback | `drop table` (cascade) + `drop type` + `drop function`. Re-ejecutable. |
| Riesgo | 🟢 Bajo |

### `0044_crm_contracts_onboarding.sql`
| Campo | Valor |
|---|---|
| Tablas | **3**: `crm_contracts`, `crm_onboarding`, `crm_onboarding_tasks` |
| Enums | **3**: `crm_contract_status_t`, `crm_onboarding_status_t`, `crm_onboarding_task_t` |
| Índices | 6 · Triggers | 4 · Funciones | 2 (public_id) |
| RLS | **4 policies** |
| Detalle | `crm_contracts.opportunity_id` **ON DELETE RESTRICT** (R-G1 — registro legal). Relevante para *cleanup* del E2E (no crear contrato). |
| Cambios sobre tablas existentes | **Ninguno** (FK a `clients`/`documents` — solo referencia) |
| ¿100% aditiva? | ✅ **Sí** |
| Rollback | `drop table` (cascade) + `drop type` + `drop function`. Re-ejecutable. |
| Riesgo | 🟢 Bajo |

### `0045_crm_sync_audit.sql`
| Campo | Valor |
|---|---|
| Tablas | **2**: `crm_stage_history` (bigserial, append-only), `clientify_sync_log` (bigserial) |
| Enums | — · Índices | 3 · Triggers/Funciones | — |
| RLS | **3 policies** (read/insert/delete; ledgers sin UPDATE = inmutables) |
| Cambios sobre tablas existentes | **Ninguno** |
| ¿100% aditiva? | ✅ **Sí** |
| Rollback | `drop table` (cascade). Re-ejecutable. |
| Riesgo | 🟢 Bajo |

### `0046_crm_rbac_seed.sql`  ⚠️ (la única que toca tablas pre-existentes)
| Campo | Valor |
|---|---|
| Tablas creadas | — |
| Vista | **`profiles_public`** (`select id, full_name from profiles where active` — view owner = postgres → bypassa lockdown 0040, expone solo id+nombre, R-G3) |
| **INSERT en tablas existentes** | **`permissions`** (slugs `comercial.view/edit/create/delete/admin` — `on conflict (slug) do nothing`) · **`role_permissions`** (mapea comercial.* → roles `director_ops`, `admin`, `comercial`, `operaciones` — `on conflict do nothing`) |
| RLS | — (usa policies ya creadas en 0042-0045) |
| Cambios sobre tablas existentes | **SÍ — additivo idempotente**: agrega permisos del módulo comercial y sus mapeos a 4 roles. **No** altera estructura; **no** borra; **no** modifica permisos de otros módulos. |
| ¿100% aditiva? | 🟡 **Aditiva (datos)** — agrega filas a `permissions`/`role_permissions`; idempotente. NO es "solo objetos nuevos". |
| Rollback | `delete from role_permissions where permission_id in (comercial.*)` + `delete from permissions where module='comercial'` + `drop view profiles_public`. Reversible. (O restore.) |
| Riesgo | 🟡 Bajo-Medio (modifica seed RBAC de roles existentes; es el efecto deseado para habilitar el módulo comercial en prod) |

### `0047_crm_write_path_fns.sql`
| Campo | Valor |
|---|---|
| Funciones | **3**: `crm_advance_stage`, `crm_reserve_capacity`, `crm_complete_onboarding` — **SECURITY INVOKER** |
| Tablas/Enums/Índices/Triggers | — |
| INSERT | en `crm_stage_history` **en runtime** (dentro de la función; tabla nueva) — no es seed de migración |
| Cambios sobre tablas existentes | **Ninguno** |
| ¿100% aditiva? | ✅ **Sí** (funciones nuevas) |
| Rollback | `drop function`. Re-ejecutable (`create or replace`). |
| Riesgo | 🟢 Bajo |

### `0048_crm_ingest_lead.sql`
| Campo | Valor |
|---|---|
| Funciones | **1**: `crm_ingest_lead` — **SECURITY DEFINER** (grant execute a `service_role`) |
| Cambios sobre tablas existentes | **Ninguno** (escribe `crm_leads`/`clientify_sync_log` en runtime) |
| ¿100% aditiva? | ✅ **Sí** |
| Rollback | `drop function`. Re-ejecutable. |
| Riesgo | 🟢 Bajo (nota: DEFINER — superficie controlada, solo service_role) |

### `0049_crm_list_commercial_users.sql`
| Campo | Valor |
|---|---|
| Funciones | **1**: `crm_list_commercial_users` — **SECURITY DEFINER**, PII-safe (id+nombre), execute a `authenticated/service_role` |
| Cambios sobre tablas existentes | **Ninguno** (solo lee profiles/user_roles/roles) |
| ¿100% aditiva? | ✅ **Sí** |
| Rollback | `drop function`. Re-ejecutable. |
| Riesgo | 🟢 Bajo |

### `0050_crm_promote_lead.sql`
| Campo | Valor |
|---|---|
| Funciones | **1**: `crm_promote_lead` — **SECURITY INVOKER** |
| Cambios sobre tablas existentes | **Ninguno** (escribe `crm_opportunities`/`crm_stage_history` en runtime; lee `clients` para enlace por CUIT) |
| ¿100% aditiva? | ✅ **Sí** |
| Rollback | `drop function`. Re-ejecutable. |
| Riesgo | 🟢 Bajo |

### `0051_crm_onboarding_autocreate.sql`
| Campo | Valor |
|---|---|
| Funciones | **1**: `crm_tg_create_onboarding_on_won` — **SECURITY DEFINER** (trigger fn) |
| Triggers | **1**: `trg_crm_create_onboarding_on_won` — AFTER UPDATE OF estado **ON `crm_opportunities`** (tabla NUEVA), WHEN entra a 'ganado' |
| Cambios sobre tablas existentes | **Ninguno** (el trigger está sobre una tabla CRM nueva; inserta en `crm_onboarding`/`_tasks` en runtime) |
| ¿100% aditiva? | ✅ **Sí** |
| Rollback | `drop trigger` + `drop function`. Re-ejecutable. |
| Riesgo | 🟢 Bajo |

---

## 2. Matriz de riesgo (resumen)

| Mig | Objetos nuevos | Toca tablas existentes | 100% aditiva | Rollback | Riesgo |
|---|---|---|---|---|---|
| 0041 | 4 enums | No | ✅ | drop type | 🟢 Nulo |
| 0042 | 2 tablas, 8 idx, 4 trg, 2 fn, 8 RLS | No | ✅ | drop table cascade | 🟢 Bajo |
| 0043 | 3 tablas, 3 enums, 4 idx, 4 trg, 2 fn, 4 RLS | No | ✅ | drop table/type | 🟢 Bajo |
| 0044 | 3 tablas, 3 enums, 6 idx, 4 trg, 2 fn, 4 RLS | No | ✅ | drop table/type | 🟢 Bajo |
| 0045 | 2 tablas, 3 idx, 3 RLS | No | ✅ | drop table | 🟢 Bajo |
| **0046** | 1 vista | **SÍ** (seed idempotente en `permissions`/`role_permissions`) | 🟡 datos | delete seed + drop view | 🟡 Bajo-Medio |
| 0047 | 3 funciones (INVOKER) | No | ✅ | drop function | 🟢 Bajo |
| 0048 | 1 función (DEFINER) | No | ✅ | drop function | 🟢 Bajo |
| 0049 | 1 función (DEFINER) | No | ✅ | drop function | 🟢 Bajo |
| 0050 | 1 función (INVOKER) | No | ✅ | drop function | 🟢 Bajo |
| 0051 | 1 trigger + 1 fn (DEFINER) | No | ✅ | drop trigger/function | 🟢 Bajo |

**Totales (objetos nuevos en PROD):** 10 tablas · 10 enums · 21 índices · ~17 triggers · ~10 funciones · 1 trigger de negocio · 1 vista · 23 RLS policies · seed RBAC comercial (idempotente).

---

## 3. Hechos de seguridad verificados (no asumidos)

- ❌ **Ninguna** migración `ALTER`/`DROP`/`TRUNCATE`/`DELETE` sobre tablas pre-CRM (grep verificado).
- ✅ Las `ALTER` de 0042 son sobre `crm_leads`/`crm_opportunities` (creadas en la misma migración).
- ✅ Único contacto con tablas existentes: `0046` → INSERT **idempotente** (`on conflict do nothing`) en `permissions`/`role_permissions`. No altera estructura ni borra; no toca permisos de otros módulos.
- ✅ Todas re-ejecutables (`if not exists` / `create or replace` / `on conflict` / `exception when duplicate_object`) → aplicar dos veces no rompe.
- ✅ Validadas íntegras en staging (≈162 + 9 asserts, 0 fallos).

---

## 4. Riesgos NO-migración a tener presentes (separados del schema)

Estos no son de las migraciones sino de **correr el E2E con datos de prueba en PROD** (ver `PROD_WRITE_E2E_AUDIT_PLAN.md`):
- Datos de prueba (lead/opp/onboarding) en el CRM productivo → **cleanup** obligatorio.
- El `committed_state` de la opp de prueba altera la **vacancia del Dashboard en vivo** hasta el cleanup.

---

## 5. Conclusión

- **Aplicar `0041`–`0051` a PROD es de riesgo BAJO y reversible.** 10/11 son aditivas puras sobre objetos nuevos; `0046` agrega seed RBAC idempotente. Nada destructivo, nada altera el schema existente.
- **Rollback disponible** en dos niveles: por-objeto (drop/delete idempotente) y total (backup Supabase→Drive productivo).
- **Recomendación de secuencia:** backup fresco → aplicar 0041→0051 en orden por **SQL Editor** → verificación post (conteos) → recién entonces el Write E2E con cleanup.

> Informe de impacto entregado. **No se ejecutó ni aplicó nada.** Pendiente tu autorización para aplicar (con backup) por SQL Editor.
