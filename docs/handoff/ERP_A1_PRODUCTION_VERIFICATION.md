# ERP-A1 · VERIFICACIÓN INDEPENDIENTE EN PRODUCCIÓN

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A1_PRODUCTION_VERIFICATION.md`
**Objetivo:** confirmar, con consulta fresca e independiente, que ERP-A1 existe en producción exactamente como se reportó.
**Destino:** **`arsksytgdnzukbmfgkju` (tops-ordenes-prod)** — única fuente de verdad.
**Método:** **solo lectura** — consultas nuevas al catálogo de producción vía Management API (`/database/query`). **No** se reutilizó ningún resultado ni reporte previo. **No** se ejecutó ninguna escritura.

> **Veredicto (adelanto):** ✅ **VERIFIED IN PRODUCTION.** Los 7 grupos de verificación coinciden con lo reportado; **ningún elemento reportado falta**.

---

## 1. Tablas (6/6)

Consulta `information_schema.tables` (lista real, no count):
`bank_accounts` · `customer_receipts` · `payment_allocations` · `receipt_allocations` · `supplier_payments` · `treasury_movements` → **6 presentes** ✅

---

## 2. Enums `treasury_*` (6/6)

Consulta `pg_type`:
`treasury_direction_t` · `treasury_doc_status_t` · `treasury_movement_type_t` · `treasury_payment_method_t` · `treasury_receipt_method_t` · `treasury_status_t` → **6 presentes** ✅

---

## 3. Funciones / Triggers / RLS

**Funciones (12/12)** — `pg_proc`:
`guard_allocation_insert`, `guard_treasury_movement_insert`, `set_customer_receipt_public_id`, `set_supplier_payment_public_id`, `set_treasury_movement_public_id`, `tg_forbid_delete_financial`, `tg_forbid_update_allocation`, `tg_lock_bank_account_basis`, `tg_lock_customer_receipt`, `tg_lock_supplier_payment`, `tg_lock_treasury_movement`, `tg_protect_system_bank_account` → **12 presentes** ✅

**Triggers (19/19)** — `information_schema.triggers`:
`bank_accounts`=3 · `treasury_movements`=4 · `customer_receipts`=3 · `supplier_payments`=3 · `receipt_allocations`=3 · `payment_allocations`=3 → **19 presentes** ✅

**Policies RLS (18/18)** — `pg_policies`:
público=**15** + storage=**3** = **18 presentes** ✅

---

## 4. Bucket `treasury` (1/1)

Consulta `storage.buckets`:
`id=treasury`, `name=treasury`, **`public=false`** (privado) → **presente** ✅

---

## 5. Seeds — CAJA / Santander / Galicia (3/3)

Consulta `public.bank_accounts`:
| bank_name | account_type | is_system | opening_balance |
|---|---|---|---|
| **Caja** | `caja` | **true** | 0.00 |
| **Banco Santander** | cuenta_corriente | false | 0.00 |
| **Banco Galicia** | cuenta_corriente | false | 0.00 |

→ **3 presentes** ✅

---

## 6. RBAC

**Permisos `tesoreria` (5/5)** — `public.permissions`:
`tesoreria.view`, `tesoreria.create`, `tesoreria.edit`, `tesoreria.export`, `tesoreria.admin` → **5 presentes** ✅

**`role_permissions` por rol** — `public.role_permissions`:
| Rol | nº permisos tesoreria |
|---|---|
| `admin` | **5** |
| `director_ops` | **5** |
| `compliance` | **2** (export, view) |
| `operaciones` | **1** (view) |

→ matriz **consistente con el diseño** ✅

---

## 7. Protecciones (catálogo, read-only — sin ejecutar escrituras)

| Protección | Evidencia (triggers) | Estado |
|---|---|---|
| **Append-only — DELETE prohibido** | `trg_forbid_delete_*` (BEFORE DELETE) en `treasury_movements`, `customer_receipts`, `supplier_payments`, `receipt_allocations`, `payment_allocations` (**5**) | ✅ |
| **Append-only — UPDATE lock** | `trg_lock_*` (BEFORE UPDATE) en `treasury_movements`, `customer_receipts`, `supplier_payments` (**3**) | ✅ |
| **Lock `opening_balance` (R11)** | `trg_lock_bank_account_basis` — BEFORE UPDATE en `bank_accounts` | ✅ |
| **Guard allocations** | `trg_guard_receipt_allocation_insert`, `trg_guard_payment_allocation_insert` — BEFORE INSERT (**2**) | ✅ |
| **Guard movimientos (F6)** | `trg_guard_treasury_movement_insert` — BEFORE INSERT en `treasury_movements` | ✅ |

> Verificación por catálogo (timing/evento/tabla), **sin** ejecutar inserts/updates de prueba (restricción solo-lectura respetada).

---

## Contraste con `ERP_A1_C2_EXECUTION_REPORT.md`

Se verificó **cada elemento** afirmado en el reporte de C2 contra producción real. **Resultado: 100% de coincidencia. Ningún elemento reportado está ausente.**

| Elemento reportado | ¿Existe en prod? |
|---|---|
| 6 tablas | ✅ sí |
| 6 enums | ✅ sí |
| 12 funciones | ✅ sí |
| 19 triggers | ✅ sí |
| 18 policies (15+3) | ✅ sí |
| bucket treasury privado | ✅ sí |
| 3 cuentas (CAJA/Santander/Galicia) | ✅ sí |
| 5 permisos tesoreria + matriz | ✅ sí |
| append-only / R11 / guards | ✅ sí |

**Ningún hallazgo de discrepancia.**

---

## Veredicto

> # ✅ VERIFIED IN PRODUCTION
>
> ERP-A1 existe en **`arsksytgdnzukbmfgkju`** exactamente como fue reportado: 6 tablas, 6 enums, 12 funciones, 19 triggers, 18 policies RLS, bucket `treasury` privado, seeds CAJA/Santander/Galicia, RBAC (5 permisos + matriz por rol), y todas las protecciones (append-only DELETE/UPDATE, lock `opening_balance` R11, guard de allocations, guard de movimientos F6).
>
> Verificación **independiente** (consulta fresca al catálogo de producción, sin reutilizar resultados previos, solo lectura). **Sin elementos faltantes ni discrepancias.**
>
> ERP-A1 queda **confirmado en producción**. (La capa de uso —`0054` RPCs, backend, UI— permanece fuera de A1 y no se inició.)

---

## Anexo — Fuentes de evidencia (todas read-only, prod arsks)

| # | Catálogo consultado |
|---|---|
| 1 | `information_schema.tables` |
| 2 | `pg_type` |
| 3 | `pg_proc`, `information_schema.triggers`, `pg_policies` |
| 4 | `storage.buckets` |
| 5 | `public.bank_accounts` |
| 6 | `public.permissions`, `public.role_permissions`, `public.roles` |
| 7 | `information_schema.triggers` (timing/evento por trigger) |

---

*Fin — Verificación Independiente en Producción ERP-A1. Veredicto: VERIFIED IN PRODUCTION. Solo lectura; no se modificó ni aplicó nada.*
