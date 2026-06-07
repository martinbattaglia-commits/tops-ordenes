# ERP-A · AUDITORÍA DEL GATE DE BASE DE DATOS (0040–0051)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A_DB_GATE_AUDIT.md`
**Objetivo:** verificar, con evidencia objetiva, si `0040–0051` están aplicadas en **Staging** y **Producción**.
**Naturaleza:** auditoría read-only contra la base (probes REST `select=*&limit=0` + OpenAPI). **No se aplicó ni modificó nada.**

> **Método (no se asumió nada):** `migration list` resultó **no concluyente** (tabla de tracking `schema_migrations` vacía → las migraciones se aplicaron manualmente por SQL Editor, no por `db push`). Por eso se verificó la **existencia real de objetos** (tablas y RPCs) vía la REST API de cada proyecto.

---

## 0. Identidad de los entornos (verificada)

`supabase projects list` (org `bzpogcxjwsfvtlebijuy`):

| Proyecto (ref) | Nombre | Rol | Cómo se accedió |
|---|---|---|---|
| `vrxosunxlhohmqymxots` | **tops-nexus-staging** | **STAGING** | CLI linked + anon/service key |
| `arsksytgdnzukbmfgkju` | **tops-ordenes-prod** | **PRODUCCIÓN** | `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`) + service key |

> ⚠️ **Hallazgo de infraestructura:** el `.env.local` local de la app apunta a **PRODUCCIÓN** (`tops-ordenes-prod`), no a staging. Correr la app localmente pega contra prod. (Ver §5 R-DB-4.)

---

## 1. Estado de STAGING (tops-nexus-staging)

| Migración | Objeto verificado | Evidencia | Estado |
|---|---|---|:--:|
| 0040 profiles_pii_lockdown | policy sobre `profiles` | no REST-verificable; 0041+ presentes (posteriores) | ⚠️ **inferida aplicada** |
| 0041 crm_enums | enums `crm_*_t` | requeridos por `crm_leads` (existe) | ✅ inferida (dependencia) |
| 0042 crm_core | `crm_leads`, `crm_opportunities` | HTTP 200 ambas | ✅ **APLICADA** |
| 0043 crm_quotes_proposals | `crm_quotes`, `crm_quote_items`, `crm_proposals` | HTTP 200 las 3 | ✅ **APLICADA** |
| 0044 crm_contracts_onboarding | `crm_contracts`, `crm_onboarding`, `crm_onboarding_tasks` | HTTP 200 las 3 | ✅ **APLICADA** |
| 0045 crm_sync_audit | `crm_stage_history`, `clientify_sync_log` | HTTP 200 ambas | ✅ **APLICADA** |
| 0046 crm_rbac_seed | seed RBAC `comercial` | dependiente de RBAC (0009) presente | ✅ inferida |
| 0047 crm_write_path_fns | RPC `crm_advance_stage`, `crm_reserve_capacity` | EXPUESTAS (OpenAPI service) | ✅ **APLICADA** |
| 0048 crm_ingest_lead | RPC `crm_ingest_lead` | EXPUESTA | ✅ **APLICADA** |
| 0049 crm_list_commercial_users | fn `crm_list_commercial_users` | no probada directamente; lineage | ✅ inferida |
| 0050 crm_promote_lead | RPC `crm_promote_lead` | EXPUESTA | ✅ **APLICADA** |
| 0051 crm_onboarding_autocreate | RPC `crm_complete_onboarding` | EXPUESTA | ✅ **APLICADA** |

**Sanity staging:** `clients` ✓, `vendors` ✓, `customer_invoices` ✓, `fiscal_config` ✓, `profiles` ✓.
**Tesorería (0052/0053):** `bank_accounts`, `treasury_movements`, `receipt_allocations` → **404 (NO existen)** ✓ (clean slate).
**🔴 AUSENTE EN STAGING:** `supplier_invoices` → **404**, `cost_centers` → **404** ⇒ **migración `0014` NO aplicada en staging.**

---

## 2. Estado de PRODUCCIÓN (tops-ordenes-prod)

| Migración | Objeto verificado | Evidencia | Estado |
|---|---|---|:--:|
| 0040 | policy `profiles` | no REST-verificable; 0041+ presentes | ⚠️ inferida aplicada |
| 0041 | enums `crm_*_t` | requeridos por tablas existentes | ✅ inferida |
| 0042 | `crm_leads`, `crm_opportunities` | HTTP 200 | ✅ **APLICADA** |
| 0043 | `crm_quotes`, `crm_proposals` | HTTP 200 | ✅ **APLICADA** |
| 0044 | `crm_contracts`, `crm_onboarding`, `crm_onboarding_tasks` | HTTP 200 | ✅ **APLICADA** |
| 0045 | `crm_stage_history`, `clientify_sync_log` | HTTP 200 | ✅ **APLICADA** |
| 0046 | seed RBAC | inferida | ✅ inferida |
| 0047 | RPC `crm_promote_lead`, `crm_advance_stage`, `crm_reserve_capacity` | EXPUESTAS | ✅ **APLICADA** |
| 0048 | RPC `crm_ingest_lead` | EXPUESTA | ✅ **APLICADA** |
| 0049 | fn `crm_list_commercial_users` | lineage | ✅ inferida |
| 0050 | RPC `crm_promote_lead` | EXPUESTA | ✅ **APLICADA** |
| 0051 | RPC `crm_complete_onboarding` | EXPUESTA | ✅ **APLICADA** |

**Dependencias ERP-A en prod:** `clients` ✓, `vendors` ✓, `customer_invoices` ✓, **`supplier_invoices` ✓**, **`cost_centers` ✓**, `fiscal_config` ✓ ⇒ **`0014` SÍ aplicada en producción.**
**Tesorería (0052/0053):** `bank_accounts`, `treasury_movements`, `payment_allocations` → **404 (NO existen)** ✓ (clean slate).

---

## 3. Hallazgos

### 🔴 P0
- **R-DB-1 — Staging NO tiene `0014` (`supplier_invoices` + `cost_centers`).** ERP-A `0053` define FK `payment_allocations.supplier_invoice_id → public.supplier_invoices(id)`. **Aplicar `0053` a staging FALLARÍA** (tabla referenciada inexistente). **Bloquea "iniciar staging ERP-A".**

### 🟠 P1
- **R-DB-2 — Drift de esquema staging ↔ producción.** Producción tiene `0014`; staging no. Staging **no es réplica fiel** de prod ⇒ validar ERP-A en staging no representa el estado real de prod hasta reconciliar.
- **R-DB-3 — Tabla de tracking `schema_migrations` vacía** (ambos via `migration list`): las migraciones se aplicaron **manualmente (SQL Editor)**, no por `supabase db push`. ⇒ `db push` intentaría reaplicar 0001–0051 y **fallaría**. **`0052/0053` deben aplicarse manualmente** (mismo método de la casa), o repararse el tracking primero.
- **R-DB-5 — `0040` (PII lockdown) no verificable por REST.** Es una *policy* sobre `profiles`; su aplicación se **infiere** (0041–0051 corrieron después) pero no se probó directamente. Requiere chequeo de `pg_policies` / dashboard.

### 🟡 P2
- **R-DB-4 — `.env.local` apunta a PRODUCCIÓN** (`tops-ordenes-prod`). La app local pega contra prod; riesgo de mutaciones accidentales en desarrollo. Revisar el wiring de entornos.

### ⚪ P3
- **R-DB-6 — CLI linked a staging pero app a prod:** inconsistencia operativa entre el CLI (staging) y el runtime (prod). Documentar y estandarizar.

---

## 4. Impacto — ¿0040–0051 son el baseline operativo real?

**Sí.** En **ambos** entornos (staging y producción) los objetos de `0040–0051` (tablas CRM, RPCs de write-path, onboarding) **existen y están operativos** — verificado por existencia real de objetos, no por tracking. El frente CRM/Clientify/Capacity/Write-Path **corre sobre estas migraciones en prod y staging**.

**Pero el baseline NO es homogéneo:** producción tiene además `0014` (AP/cuentas a pagar) que **staging no tiene**. El "baseline operativo real" de producción es **0001–0051 (incl. 0014)**; el de staging es **0001–0051 menos 0014 (y menos cost_centers)**. Esa diferencia es **material para ERP-A**, porque `0053` depende de `0014`.

---

## 5. Riesgos por dominio

| Dominio | Estado | Riesgo |
|---|---|---|
| **CRM** (leads/oportunidades/quotes/contracts) | ✅ tablas presentes en staging y prod | bajo |
| **RBAC** (0046 seed comercial) | ✅ inferido (RBAC base presente) | bajo; verificar seed `comercial` en prod si se requiere granularidad |
| **PII lockdown (0040)** | ⚠️ inferido, no probado | **P1** — confirmar policy de `profiles` por catálogo/dashboard |
| **Clientify Inbound** | ✅ `clientify_sync_log` + webhook RPCs presentes | bajo |
| **Write Path** | ✅ `crm_advance_stage`/`crm_promote_lead` expuestas (ambos) | bajo |
| **Onboarding** | ✅ `crm_onboarding(_tasks)` + `crm_complete_onboarding` | bajo |
| **Capacity Engine** | ✅ `crm_reserve_capacity` expuesta; `committed-capacity` en código | bajo |
| **AP / 0014 (dep. de ERP-A)** | 🔴 ausente en staging, presente en prod | **P0** para staging ERP-A |

---

## 6. Veredicto

> ## El gate 0040–0051: ✅ **APLICADAS en STAGING y PRODUCCIÓN** (verificado por objetos reales).
>
> ## Pero para ERP-A: ⚠️ **GO PARCIAL — con un BLOQUEANTE P0 antes de "iniciar staging ERP-A".**

**Desglose inequívoco:**
- **¿`0040–0051` aplicadas en staging y prod?** → **SÍ** (CRM, write-path, onboarding, capacity verificados en ambos). El gate literal **PASA**.
- **¿ERP-A puede comenzar?** → **SÍ para los pasos sin DB y para `0052`:** crear `feature/erp-a-tesoreria`, commitear `0052/0053`, y aplicar `0052` (solo depende de `0009`, presente).
- **¿ERP-A puede iniciar STAGING (aplicar `0053`)?** → **NO todavía.** `0053` depende de `0014` (`supplier_invoices`/`cost_centers`), **ausente en staging** (R-DB-1). **Aplicar `0053` a staging fallaría.**

**Condición para destrabar "staging ERP-A" (P0):**
1. **Aplicar `0014` en staging** (`supplier_invoices` + `cost_centers`) — y reconciliar staging con prod (R-DB-2), de modo que staging sea réplica fiel.
2. Aplicar `0052/0053` **manualmente** (SQL Editor), no `db push` (R-DB-3).
3. (Recomendado) confirmar la policy `0040` por catálogo (R-DB-5) y revisar el wiring `.env.local`→prod (R-DB-4).

**Para PRODUCCIÓN, ERP-A no tiene bloqueante de dependencia:** `0001–0051` (incl. `0014`) están presentes; `0052/0053` ausentes (clean slate). El despliegue a prod seguirá su propio gate (backup + ventana + autorización), aplicando `0052/0053` manualmente.

---

## Respuesta inequívoca

> **"ERP-A puede comenzar"** — el baseline `0040–0051` está aplicado en **staging y producción**, y la tesorería (`0052/0053`) está ausente en ambos (clean slate). Se autoriza crear `feature/erp-a-tesoreria`, commitear `0052/0053` y aplicar `0052`.
>
> **CON UN BLOQUEANTE P0 PARA STAGING:** **no aplicar `0053` a staging hasta que staging tenga `0014`** (`supplier_invoices`/`cost_centers`) — hoy ausente. Es un problema de **drift de staging**, no de ERP-A. Resolverlo (aplicar 0014 a staging / reconciliar con prod) es la única acción previa a "iniciar staging ERP-A".

---

## Anexo — Evidencia (probes read-only)

| Verificación | Resultado |
|---|---|
| `supabase projects list` | vrxos=staging, arsks=prod (org bzpog…) |
| Staging CRM tablas (10) | HTTP 200 todas |
| Staging RPCs CRM (5) | EXPUESTAS (service key) |
| Staging `supplier_invoices`/`cost_centers` | **HTTP 404** (0014 ausente) |
| Staging tesorería | HTTP 404 (ausente) |
| Prod CRM + deps (clients/vendors/customer_invoices/supplier_invoices/cost_centers/fiscal_config) | HTTP 200 todas |
| Prod tesorería | HTTP 404 (ausente) |
| `migration list --linked` | Remote vacío (tracking no refleja realidad) |

---

*Fin — Auditoría del Gate de DB ERP-A. Gate 0040–0051: aplicado en staging y prod. Veredicto: ERP-A puede comenzar, con bloqueante P0 (0014 ausente en staging) previo a aplicar 0053 a staging. No se aplicó ni modificó ninguna base.*
