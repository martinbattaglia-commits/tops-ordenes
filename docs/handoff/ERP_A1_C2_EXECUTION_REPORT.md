# ERP-A1 · REPORTE DE EJECUCIÓN — C2 (0053)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A1_C2_EXECUTION_REPORT.md`
**Ejecutado según:** `ERP_A1_EXECUTION_PLAN.md` (alcance C2).
**Fuente de verdad / destino:** **`arsksytgdnzukbmfgkju` (tops-ordenes-prod)** — Postgres 17.6.1, `ACTIVE_HEALTHY`.
**Resultado:** 🟢 **0053 aplicado y validado en producción.**

> Alcance respetado: **solo C2** (commit `0053` + aplicación + validación). **No** `0054`, backend, UI, automatismos, ERP-A2+.

---

## 1. Backup verificado (evidencia)

Management API `GET /v1/projects/arsksytgdnzukbmfgkju/database/backups`:
- **`walg_enabled: true`** (backups físicos automáticos diarios). `pitr_enabled: false`.
- Backups **COMPLETED** los últimos 7 días. Más reciente: **id `836740073`, `COMPLETED`, `2026-06-06T09:16:41Z`**.
- Punto de restauración válido **previo** a ERP-A (predata C1 y C2).

**Mitigación adicional:** `0053` se aplicó dentro de **`BEGIN/COMMIT`** (atómico → cualquier fallo revierte sin estado parcial) y es **puramente aditivo** (crea objetos nuevos + seeds idempotentes; no `ALTER`/`DROP` sobre datos existentes). Condición #1 **satisfecha**.

---

## 2. Commit aplicado (hash exacto)

| Campo | Valor |
|---|---|
| **Hash completo** | **`67d1e089876750c066234b76cce12e4be1d6d912`** |
| Short | **`67d1e08`** |
| Mensaje | `feat(erp-a): 0053 treasury core — C1-C8 + R11 (...)` |
| Archivos | **1** — `supabase/migrations/0053_treasury_core.sql` (711 insertions) |
| Rama | `feature/erp-a-tesoreria` (C1 `c6910af` → C2 `67d1e08`) |
| `git add` | **dirigido** (solo 0053) — verificado 1 archivo |
| Condición #2 pre-aplicación | enum `tesoreria` presente (n=1); tablas treasury ausentes (pre) ✓ |

---

## 3. Resultado de ejecución

**Método:** Management API `POST /v1/projects/.../database/query`, payload `begin; <0053>; commit;` (atómico). **No `db push`.**

| | Resultado |
|---|---|
| Respuesta de la API | **`[]`** (sin error) → transacción **committeada** |
| Estado tras aplicar | 6 tablas + 6 enums + 12 funciones + 19 triggers + 18 policies + bucket + seeds + RBAC creados |

---

## 4. Validación estructural

| Objeto | Esperado | Resultado | OK |
|---|---|---|:--:|
| Enums `treasury_*` | 6 | **6** | ✅ |
| Tablas | 6 | **6** | ✅ |
| Funciones | 12 | **12** | ✅ |
| Triggers | 19 | **19** (bank=3, movements=4, receipts=3, payments=3, recv_alloc=3, pay_alloc=3) | ✅ |
| Policies (público) | 15 | **15** | ✅ |
| Policies (storage) | 3 | **3** | ✅ |
| **Total policies** | **18** | **18** (15+3 = las 18 sentencias `create policy` de 0053) | ✅ |
| RLS habilitada (6 tablas) | true | **true** en las 6 | ✅ |

---

## 5. Validación RBAC

| Verificación | Resultado | OK |
|---|---|:--:|
| Permisos `tesoreria` | 5: `view, create, edit, export, admin` | ✅ |
| `role_permissions` por rol | `admin`→5 · `director_ops`→5 · `compliance`→{export,view} · `operaciones`→{view} | ✅ (matriz exacta) |
| `roles` (total) | **7** (intacto) | ✅ |
| `permissions` (total) | 36 → **41** (+5 tesoreria) | ✅ consistente |
| Regresión RBAC | ninguna (roles/role_permissions previos intactos) | ✅ |

---

## 6. Validación Storage

| Verificación | Resultado | OK |
|---|---|:--:|
| Bucket `treasury` | existe, **`public=false`** (privado) | ✅ |
| Policies `treasury *` (storage.objects) | 3 (read/write/update internas) | ✅ |
| Aislamiento | acceso solo interno (`current_role() in admin/operaciones/supervisor`); sin exposición a `cliente` | ✅ |

---

## 7. Validación Seeds

| Cuenta | account_type | is_system | opening_balance | OK |
|---|---|---|---|:--:|
| **Caja** (Caja Efectivo) | `caja` | **true** | 0.00 | ✅ |
| **Banco Santander** (VEROTIN S.A.) | cuenta_corriente | false | 0.00 | ✅ |
| **Banco Galicia** (VEROTIN S.A.) | cuenta_corriente | false | 0.00 | ✅ |

Total: **3 cuentas** (CAJA protegida por `trg_protect_system_bank_account`).

---

## 8. Auditoría rápida post-aplicación

| Verificación | Resultado |
|---|---|
| **D1** saldo derivado | sin columna `current_balance` mutable (0) ✓ |
| **D2** allocations N:M | `receipt_allocations` + `payment_allocations` presentes ✓ |
| **D3** numeración | sequences + triggers `set_*_public_id` (12 fns) ✓ |
| **D4** retención simple | solo `retention_amount`; sin regimen/certificate ✓ |
| **D5** cuenta corriente derivada | sin tablas `*_current_account` ✓ |
| **H1** append-only UPDATE | `tg_lock_*` (3) presentes ✓ |
| **H2** allocations protegidas | `guard_allocation_insert` + `tg_forbid_update_allocation` ✓ |
| **H3** CAJA / efectivo | `account_type='caja'`, `is_system=true` ✓ |
| **H4** RLS write=admin | policies write `current_role()='admin'` ✓ |
| **H5** RLS read internos | `current_role() in (admin,operaciones,supervisor)` ✓ |
| **H6** type↔direction | `treasury_movements_type_direction_ck` + `reference_type_ck` ✓ |
| **H12/C8** numeric(15,2) | `customer_receipts.gross_amount` precision 15 scale 2; `net_amount` GENERATED ALWAYS ✓ |
| **R11** base inmutable | `trg_lock_bank_account_basis` presente ✓ |
| Guard F6 | `trg_guard_treasury_movement_insert` presente ✓ |
| Enum `treasury_movement_type_t` | {cobranza, pago_proveedor, transferencia, ajuste} ✓ |

**Sin regresiones** sobre objetos preexistentes (CRM/ARCA/compras/RBAC base intactos).

---

## 9. Riesgos remanentes

### 🟠 P1
- **R-C2-1 — Tracking de migraciones desincronizado.** `0052/0053` se aplicaron por Management API (manual), no por `supabase migrations`; `schema_migrations` no los registra (igual que el resto del baseline). Un futuro `db push` seguiría fuera de sync. *Convivir con el método manual de la casa.*
- **R-C2-2 — Rama local no pusheada + no mergeada a main.** Los archivos `0052/0053` están commiteados en `feature/erp-a-tesoreria` (local), pero **producción ya los tiene aplicados** y **main (`710ae33`) aún no los incluye**. Recomendado: **pushear la rama** (durabilidad) y planificar su merge a main (PR) para alinear el árbol con la DB. *(Fuera del alcance C2.)*

### 🟡 P2
- **R-C2-3 — Punto de restauración previo a hoy.** El backup físico más reciente es de las 09:16 UTC de hoy; PITR off → un restore perdería operaciones de prod posteriores. Mitigado por la naturaleza aditiva/atómica de `0053` (restore solo ante catástrofe).
- **R-C2-4 — Staging drift.** Staging sigue sin `0014`/`0052`/`0053`. No es referencia (directiva: prod es fuente de verdad); normalizar si alguna vez se autoriza usar staging.

### ⚪ P3
- **R-C2-5 — C3 (docs) pendiente.** El commit de documentación ERP-A (12 archivos untracked) no es parte del alcance C2; queda como follow-up administrativo.
- **R-C2-6 — Capa de uso (0054/A2-A5) ausente** por diseño: las tablas/triggers existen pero no hay RPCs/UI todavía. Las RPC (`0054`) deben setear `treasury.via_rpc='on'` (is_local) para operar; hasta entonces las allocations/cobros/pagos no pueden crearse (guard activo) — **esperado** en A1.

---

## 10. Veredicto final

> # 🟢 ERP-A1 COMPLETADO
>
> El **modelo de datos de Tesorería** está **desplegado y validado en producción (`arsksytgdnzukbmfgkju`)**:
> - **C1 (`0052`, `c6910af`):** enum `tesoreria` creado ✓.
> - **C2 (`0053`, `67d1e08`):** 6 enums · 6 tablas · 12 funciones · 19 triggers · 18 policies · bucket `treasury` · RBAC (5 permisos + matriz) · seeds (CAJA/Santander/Galicia) — **todo creado y verificado**.
> - **D1–D5, H1–H6, H12, R11** confirmados a nivel DB.
> - **RBAC intacto** (roles=7; permissions 36→41; sin regresiones). **RLS activa** en las 6 tablas.
> - Aplicado **atómicamente** (`BEGIN/COMMIT`) con **backup restaurable confirmado**.
>
> **ERP-A1 (modelo de datos) queda CERRADO.** No se avanzó a `0054`, backend, UI ni ERP-A2+.
>
> **Follow-ups (no bloquean A1, requieren autorización aparte):** commit C3 (docs), push de `feature/erp-a-tesoreria` + plan de merge a main (R-C2-2). La **capa de uso** (RPCs `0054`, backend, UI) es fase siguiente, fuera de A1.

---

## Anexo — Evidencia (Management API, prod `arsksytgdnzukbmfgkju`)

| Verificación | Resultado |
|---|---|
| Backup más reciente | `COMPLETED` 2026-06-06T09:16Z (id 836740073) |
| Apply `0053` (begin/commit) | `[]` (sin error) |
| Enums/Tablas/Funciones/Triggers | 6 / 6 / 12 / 19 |
| Policies | 15 público + 3 storage = 18 |
| RLS en 6 tablas | true |
| Permisos tesoreria | 5 (matriz exacta) |
| permissions/roles | 41 / 7 |
| Bucket treasury | privado |
| Seeds | CAJA(is_system)/Santander/Galicia |
| D1/H3/H6/H12/R11 | OK |
| Commit C2 | `67d1e089876750c066234b76cce12e4be1d6d912` |
| main intacto | `710ae33` |

---

*Fin — Reporte de Ejecución C2 (0053). Veredicto: ERP-A1 COMPLETADO. Modelo de datos de Tesorería desplegado y validado en producción. No se avanzó a 0054/backend/UI/ERP-A2+.*
