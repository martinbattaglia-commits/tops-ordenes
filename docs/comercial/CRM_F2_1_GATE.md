# CRM_F2_1_GATE — Validación estructural del dominio (pre-staging, pre-capacidad)

**Módulo:** CRM Comercial Nexus · **Etapa:** F2.1-GATE · **Fecha:** 2026-06-04
**Objetivo:** validación completa del dominio CRM **antes** de activar capacidad (`committed_m2`) y **antes** de staging.
**Alcance:** solo validación. **Sin código nuevo · sin migraciones nuevas · sin activar `committed_m2`.**
**Base verificada:** migraciones `0041`–`0046` (extracción directa del SQL).
**Relacionado:** [DOMAIN](./CRM_DOMAIN_ARCHITECTURE.md) · [F2.1_ARCHITECTURE](./COMMERCIAL_F2_1_ARCHITECTURE.md) · [UX_REVIEW](./CRM_UX_REVIEW.md).

---

## 1. ERD completo

10 tablas · 10 enums. Cardinalidades (1—N salvo indicación):

```
                         ┌────────────┐         ┌──────────────┐
 auth.users ──owner──▶   │  clients   │         │  documents   │ (pdf/anexos)
 (8 FK set null)         │ (cuit uniq)│         └──────┬───────┘
                         └─────┬──────┘                │ (4 FK, NO ACTION)
                               │ client_id (NO ACTION) │
   ┌──────────┐   lead_id      ▼                       │
   │ crm_leads │◀────set null── crm_opportunities ◀────┘ pdf refs
   │ (espejo)  │──opportunity──▶   (EJE)  public_id OPP-
   └──────────┘   (set null,        │ + capacity_feasible/assigned_site/
     LEAD-        circular)         │   assigned_units/committed_state
                                    │
        ┌───────────────┬───────────┼───────────┬──────────────┬────────────┐
        ▼ (cascade)     ▼ (cascade) ▼ (cascade) ▼ (cascade)    ▼ (cascade)   │
   crm_quotes      crm_proposals  crm_contracts crm_onboarding  crm_stage_   │
   COT- │            PROP-          CON-          ONB- │         history     │
        ▼ (cascade)    ▲ quote_id    ▲ proposal_id     ▼ (cascade)(bigserial)│
   crm_quote_items     │ (set null)  │ (set null)  crm_onboarding_tasks      │
                       └─ crm_quotes │ crm_proposals  (rne/croquis/…)        │
                                     │                                       │
                          contract_id (set null) ◀── crm_onboarding          │
                                                                             │
   clientify_sync_log (bigserial, append-only) ◀── webhook/pull ────────────┘
   profiles ──(vista)──▶ profiles_public(id, full_name)  [sin email]
```

**Columnas clave por tabla:** ver [CRM_DOMAIN_ARCHITECTURE §3](./CRM_DOMAIN_ARCHITECTURE.md). Resumen de identidad/control:

| Tabla | PK | public_id | soft-delete | ledger |
|---|---|---|---|---|
| crm_leads | uuid | LEAD-YYYY-NNNN | ✅ deleted_at | — |
| crm_opportunities | uuid | OPP-YYYY-NNNN | ✅ | — |
| crm_quotes | uuid | COT-YYYY-NNNN | ✅ | — |
| crm_quote_items | uuid | — | ✅ | — |
| crm_proposals | uuid | PROP-YYYY-NNNN | ✅ | — |
| crm_contracts | uuid | CON-YYYY-NNNN | ✅ | — |
| crm_onboarding | uuid | ONB-YYYY-NNNN | ⚠️ NO | — |
| crm_onboarding_tasks | uuid | — | ⚠️ NO | — |
| crm_stage_history | bigserial | — | — | ✅ append-only |
| clientify_sync_log | bigserial | — | — | ✅ append-only |

---

## 2. FK graph completo (con on-delete · verificado en SQL)

| Origen (columna) | → Destino | on delete | Nota |
|---|---|---|---|
| `crm_opportunities.client_id` | clients(id) | **NO ACTION** (restrict) | no se borra un cliente con oportunidades |
| `crm_opportunities.lead_id` | crm_leads(id) | set null | |
| `crm_opportunities.created_by/owner_id` | auth.users(id) | set null | |
| `crm_leads.opportunity_id` | crm_opportunities(id) | set null | **FK circular** (vía ALTER) |
| `crm_leads.owner_id` | auth.users(id) | set null | |
| `crm_quotes.opportunity_id` | crm_opportunities(id) | **cascade** | |
| `crm_quotes.pdf_document_id` | documents(id) | NO ACTION | |
| `crm_quote_items.quote_id` | crm_quotes(id) | **cascade** | |
| `crm_proposals.opportunity_id` | crm_opportunities(id) | **cascade** | |
| `crm_proposals.quote_id` | crm_quotes(id) | set null | |
| `crm_proposals.pdf_document_id` | documents(id) | NO ACTION | |
| `crm_contracts.opportunity_id` | crm_opportunities(id) | **restrict** | ✅ R-G1 resuelto — protege el registro legal |
| `crm_contracts.proposal_id` | crm_proposals(id) | set null | |
| `crm_contracts.client_id` | clients(id) | NO ACTION | |
| `crm_contracts.pdf_document_id` | documents(id) | NO ACTION | |
| `crm_onboarding.opportunity_id` | crm_opportunities(id) | **cascade** | |
| `crm_onboarding.contract_id` | crm_contracts(id) | set null | |
| `crm_onboarding.client_id` | clients(id) | NO ACTION | |
| `crm_onboarding_tasks.onboarding_id` | crm_onboarding(id) | **cascade** | |
| `crm_onboarding_tasks.document_id/assignee_id` | documents/auth.users | NO ACTION / set null | |
| `crm_stage_history.opportunity_id` | crm_opportunities(id) | **cascade** | |
| `crm_stage_history.changed_by` | auth.users(id) | set null | |

**Conteo:** auth.users ×8 (set null) · clients ×3 (restrict) · documents ×4 (restrict) · crm_opportunities ×5 cascade +1 set null · resto interno.

---

## 3. Matriz RLS consolidada (verificada)

Gating canónico: `has_permission('comercial.view'|'comercial.edit')` (con **bypass admin** vía `current_role()='admin'`); delete = `is_admin()`.

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| crm_leads | view | edit | edit | is_admin |
| crm_opportunities | view | edit | edit | is_admin |
| crm_quotes | view | edit | edit | is_admin |
| crm_quote_items | view | edit | edit | is_admin |
| crm_proposals | view | edit | edit | is_admin |
| crm_contracts | view | edit | edit | is_admin |
| crm_onboarding | view | edit | edit | is_admin |
| crm_onboarding_tasks | view | edit | edit | is_admin |
| crm_stage_history | view | edit | **— (deny)** | is_admin |
| clientify_sync_log | view | edit | **— (deny)** | is_admin |
| `profiles_public` (vista) | grant select → authenticated/service_role | — | — | — |

- **RLS deny-by-default:** las 10 tablas tienen RLS habilitada; los ledgers no tienen policy UPDATE → **inmutables** (correcto).
- **Mapeo de roles (0046):** `director_ops`/`admin` (RBAC) → todo `comercial`; `comercial` → view+edit+create; `operaciones` → view+edit. Admin (user_role_t) bypassa.

---

## 4. Simulación de flujo end-to-end

Recorrido de una fila por las 8 etapas (committed inactivo → `committed_state` queda en `none`/`reservado`/`comprometido` como marca, sin descontar capacidad real):

| # | Acción | Tabla(s) | RLS exigida | Integridad |
|---|---|---|---|---|
| 1 | Webhook Clientify crea lead | `crm_leads` insert | comercial.edit | `clientify_id` uniq idempotente; public_id LEAD- por trigger |
| 2 | Vendedor califica → crea oportunidad | `crm_opportunities` insert + `crm_leads.opportunity_id` update; `crm_stage_history` insert (→calificado) | comercial.edit | FK lead_id ok; OPP- por trigger; `capacity_feasible` se setea por app (findAvailability) |
| 3 | Capacidad | (sin escritura) lee motor `findAvailability` | — | `assigned_site`/`assigned_units` se guardan en la oportunidad |
| 4 | Cotiza | `crm_quotes` (+`crm_quote_items`) insert | comercial.edit | FK opportunity_id (cascade); COT- por trigger; total = subtotal−desc+iva |
| 5 | Propuesta | `crm_proposals` insert (pdf→documents) | comercial.edit | unique(opp,tipo,version); PROP-; `committed_state→reservado` (marca) |
| 6 | Negociación | `crm_opportunities` update (estado, probabilidad); `crm_stage_history` insert | comercial.edit | history append-only |
| 7 | Ganado + contrato firmado | `crm_contracts` insert/update(firmado); `crm_opportunities`(estado=ganado); `crm_stage_history` | comercial.edit | CON-; `committed_state→comprometido` (marca) |
| 8 | Onboarding | `crm_onboarding` + `crm_onboarding_tasks` (RNE/croquis/plancheta/accesos/doc) | comercial.edit | ONB-; al completar → `clients.activo=true` (futuro) + `committed_state→ocupado` |
| 9 | Borrado | delete | **is_admin** | soft-delete preferido; hard-delete cascada (R-G1) |

> **Capacidad:** en este gate, los cambios de `committed_state` son **marcas de estado**, NO descuentan capacidad (`COMMITTED_M2_ENABLED=false`). La activación es F2.1-4, post-staging.

**Resultado de la simulación:** el flujo es **consistente** — cada paso tiene su tabla, su RLS y su integridad referencial; los public_id se generan por trigger; los ledgers registran sin mutar.

---

## 5. Riesgos estructurales detectados

| # | Riesgo | Sev. | Recomendación |
|---|---|---|---|
| **R-G1** | ~~Cascade-delete de `crm_opportunities` borra contratos firmados~~ | ✅ **RESUELTO** | **Aplicado:** `crm_contracts.opportunity_id` → `on delete restrict` (0044). Ahora el borrado de una oportunidad **con contrato** queda **bloqueado** (no se pierde documentación legal). Los demás hijos (quotes/proposals/onboarding/stage_history) siguen en cascade |
| **R-G2** | **`has_permission()` es `language sql stable` (no security definer)** → lee `user_roles/role_permissions/permissions` con privilegios del caller. Si esas tablas RBAC bloquean el self-read por RLS, **todo el RLS comercial falla** (solo admin por bypass) | 🔴 **Alta** | **Verificar en staging** que un usuario rol `comercial` puede leer/escribir (que las tablas RBAC son legibles o la función está elevada). Es el riesgo #1 del gate |
| **R-G3** | **`profiles_public`**: si la vista quedara `security_invoker`, devolvería 0 filas a no-admin (lockdown 0040) | 🟠 Media | Verificar en staging que la vista es SECURITY DEFINER (owner postgres) y retorna id+full_name a `authenticated` |
| **R-G4** | `crm_onboarding`/`_tasks` **sin `deleted_at`** (inconsistente con el resto) | 🟡 Baja | Decidir: agregar `deleted_at` por consistencia o gobernar por `status`. No bloquea |
| **R-G5** | `crm_opportunities.estado` default `'nuevo_lead'` pero se crea en `'calificado'` | 🟡 Baja | La app debe setear `estado` explícito; el default es una trampa semántica leve |
| **R-G6** | FK circular leads↔opportunities depende del orden de apply (0042 lo resuelve por ALTER) | 🟡 Baja | Aplicar 0042 íntegra; no parcial |
| **R-G7** | `public_id` usa secuencia global (no resetea por año) → COT-2027-0501 | ⚪ Info | Cosmético; sin acción |
| **R-G8** | FKs a `clients`/`documents` con NO ACTION (restrict) | ⚪ Info | Protege borrados; comportamiento esperado |

> **Bloqueante del gate:** **R-G2** debe verificarse en staging antes de confiar el RLS. **R-G1 ya resuelto** (restrict aplicado en 0044).

---

## 6. Checklist de staging

**Pre-requisitos:** entorno **staging** (NO PROD), con 0001–0040 ya aplicadas. Aplicar en orden y verificar.

### 6.1 Aplicación (orden estricto)
- [ ] `0041_crm_enums.sql` → verificar `select` de los 10 tipos enum.
- [ ] `0042_crm_core.sql` → tablas `crm_leads`/`crm_opportunities`, secuencias, FK circular (ALTER), triggers public_id/updated_at, RLS.
- [ ] `0043` · `0044` · `0045` → tablas de negocio + ledgers + RLS.
- [ ] `0046_crm_rbac_seed.sql` → permisos `comercial.create/delete/admin`, mapeos, vista `profiles_public`.
- [ ] `notify pgrst` recargó el schema (PostgREST ve las tablas).

### 6.2 Verificaciones funcionales (smoke)
- [ ] **R-G2:** con un usuario rol `comercial` (RBAC), `insert`/`select` sobre `crm_opportunities` **funciona** (has_permission resuelve). Con un usuario sin permiso → **denegado**.
- [ ] **Bypass admin:** un user `profiles.role='admin'` puede todo sin mapeo.
- [ ] **R-G3:** `select * from profiles_public` como usuario normal devuelve `id, full_name` (sin email) y **no** está vacío.
- [ ] **public_id:** insertar lead/opp/quote/etc. genera `LEAD-/OPP-/COT-/PROP-/CON-/ONB-` correctos.
- [ ] **Triggers updated_at:** un `update` toca `updated_at`.
- [ ] **Ledgers inmutables:** `update` sobre `crm_stage_history`/`clientify_sync_log` → **denegado**.
- [ ] **FK integridad:** insertar quote con `opportunity_id` inexistente → falla; borrar opp **con contrato** (admin) → **bloqueado** (restrict, R-G1); borrar opp **sin contrato** → cascada a quotes/proposals/onboarding/stage_history.
- [ ] **Enums:** insertar `service_type='oficinas'`, `committed_state='reservado'`, etc. válidos; valor inválido → falla.
- [ ] **Unique:** `clientify_deal_id`/`clientify_id` duplicado → falla; `(opportunity_id,tipo,version)` en proposals → falla en duplicado.

### 6.3 Salida del gate
- [ ] R-G2 verde (RLS comercial funciona) → **gate aprobado para staging persistente**.
- [ ] R-G1 decidido (restrict vs soft-delete) → **antes de producción** (no bloquea staging).
- [ ] Recién entonces: **F2.1-4** (activar `committed_m2`).

---

## 7. Veredicto del gate

| Dimensión | Estado |
|---|---|
| ERD / FK graph | ✅ coherente, sin huérfanos ni ciclos no resueltos |
| RLS | ✅ consistente (has_permission + bypass), ledgers inmutables — **pendiente verificación R-G2 en staging** |
| Flujo end-to-end | ✅ simulado sin rupturas |
| Riesgos | R-G1 ✅ resuelto (restrict) · 1 alto (R-G2, verificable en staging) · resto bajo/info |

**Recomendación:** **proceder a staging** con el checklist §6, priorizando R-G2. No activar `committed_m2` (F2.1-4) hasta que el gate cierre en verde.

> **Cierre F2.1-GATE (2026-06-04):** R-G1 ajustado a `on delete restrict` (0044). Gate cerrado; autorizada la validación en staging.
