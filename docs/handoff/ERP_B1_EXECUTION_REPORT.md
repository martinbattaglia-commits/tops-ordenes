# ERP_B1_EXECUTION_REPORT

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fase:** ERP-B1 · Fundación de Datos AP — Ejecución en producción
**Fecha:** 2026-06-07
**Producción (fuente de verdad):** `arsksytgdnzukbmfgkju` — PostgreSQL 17.6. **No se usó staging/sandbox.**
**Método:** Management API de Supabase (`/v1/projects/{ref}/database/query`, ejecuta como `postgres`). Cada migración aplicada **por separado** y validada antes de la siguiente.
**Commit base:** `b486344` (rama `feature/erp-b1-ap-foundation`) + correcciones `0058`/`0059` (ver §Incidencias).

---

## 1 · APLICACIÓN DE MIGRACIONES (en orden, una por una)

| Paso | Migración | HTTP | Resultado |
|---|---|---|---|
| 1 | `0056_ap_fiscal_detail.sql` | 201 | OK |
| 2 | `0057_ap_workflow_permissions.sql` | 201 | OK |
| 3 | `0058_ap_rpcs.sql` | 201 | OK (+ corrección de grant, ver Incidencia I1) |
| 4 | `0059_iva_compras_views.sql` | 400 → **201** | Falló por enum/LIKE, corregido y reaplicado (Incidencia I2) |

---

## 2 · VALIDACIÓN POR MIGRACIÓN (evidencia en prod)

### 0056 — detalle fiscal ✅
- Tablas presentes: `supplier_invoice_vat_lines`, `supplier_invoice_other_taxes`, `supplier_invoice_items`.
- Columnas cabecera nuevas: `importe_no_gravado`, `importe_exento`, `tributos`.
- Enum `permission_module_t='cuentas_pagar'` presente.
- Triggers guard: `trg_guard_sivl`, `trg_guard_siot`, `trg_guard_siit`.

### 0057 — workflow + RBAC ✅
- Columna `approval_status` (tipo `ap_approval_status_t`).
- Migración de datos: las 4 facturas reales `status='pendiente'` → `approval_status='cargada'` (sin pérdida).
- Tabla `supplier_invoice_audit` presente (append-only).
- Permisos `cuentas_pagar.{view,create,edit,sign,delete,export}` (6).
- `role_permissions`: admin=6, director_ops=6, operaciones=3, compliance=2.

### 0058 — RPCs ✅
- Funciones: `ap_create_supplier_invoice`, `ap_submit_for_review`, `ap_approve`, `ap_reopen`, `ap_void`, `ap__transition` (interna).
- Grants `execute` a `authenticated`: solo las 5 públicas. `ap__transition` revocada de `authenticated`/`anon` (queda solo `service_role`). Ver I1.

### 0059 — vistas ✅
- Vistas: `supplier_invoice_fiscal` (4 filas), `supplier_ap_status` (4 filas), `libro_iva_compras` (0 filas — correcto: las 4 facturas legacy no tienen detalle por alícuota).

---

## 3 · SMOKE TEST CONTROLADO (BEGIN/ROLLBACK — sin persistir)

Ejecutado bajo impersonación de un usuario admin real (vía `request.jwt.claims`), con `RAISE` final para forzar ROLLBACK.

### 3.1 Camino positivo — **PASS** (1 factura: 2 alícuotas + percepción IIBB)
| Aserción | Esperado | Obtenido |
|---|---|---|
| Total devuelto por la RPC | 1807.50 | **1807.50** ✅ |
| Neto Gravado / IVA / Percepciones | 1500 / 262.50 / 45 | **1500.00 / 262.50 / 45.00** ✅ |
| Reconciliación cabecera↔detalle | total_deriv = total_cab | **1807.50 = 1807.50** ✅ |
| Libro IVA Compras (filas del período) | ≥2 (multi-alícuota) | **2** (21% y 10.5%) ✅ |
| Workflow `submit`→`approve` | approval=aprobada | **aprobada** ✅ |
| Integración Tesorería (pago parcial 807.50) | estado_pago=parcial | **parcial** ✅ |
| Estado operativo combinado | pendiente_pago | **pendiente_pago** ✅ |
| Saldo derivado | 1000.00 | **1000.00** ✅ |
| Allocations creadas | 1 | **1** ✅ |

### 3.2 Guardas negativas — **PASS (4/4)** (cada una abortó con el error correcto)
| Test | Esperado | Obtenido |
|---|---|---|
| N1 · insert directo en detalle | bloqueo via_rpc | `AP_DETAIL_VIA_RPC_ONLY` ✅ |
| N2 · total declarado ≠ derivado | validación dura | `TOTAL_MISMATCH: 9999 <> 1210.00` ✅ |
| N3 · alícuota inválida (7/99) | CHECK | `sivl_alic_pair_chk` ✅ |
| N4 · anular factura con pago confirmado | guarda integración | `INVOICE_HAS_PAYMENTS (1210.00)` ✅ |

### 3.3 No-persistencia + ERP-A intacto — **VERIFICADO**
Conteos tras todos los tests: `supplier_invoices=4, vat_lines=0, other_taxes=0, audit=0` (nada persistió) · `supplier_payments=1, payment_allocations=1` (ERP-A sin cambios) · `supplier_open_items=4` (vista ERP-A operativa).

---

## 4 · INTEGRACIÓN TESORERÍA (verificación)

- `ap_void` **lee** `payment_allocations`+`supplier_payments` y bloquea anulación con pago confirmado (N4 ✅).
- `tesoreria_register_payment` se ejecutó sin modificación, imputó a una factura AP y `supplier_open_items` derivó `parcial` correctamente.
- **Cero cambios** a `supplier_payments`, `payment_allocations`, `tesoreria_register_payment`, `supplier_open_items` (no se hizo CREATE OR REPLACE/ALTER sobre ellos). Única escritura compartida: `ap_void` espeja `supplier_invoices.status='anulada'` (valor existente, requerido por la vista ERP-A) — verificada por diseño, no ejercida sobre datos reales.

---

## 5 · INCIDENCIAS Y CORRECCIONES (durante la ejecución)

**I1 — `ap__transition` ejecutable por `authenticated` (P1 seguridad).** Supabase otorga EXECUTE a `authenticated`/`anon` por DEFAULT PRIVILEGES en funciones nuevas; `revoke ... from public` no alcanzaba. La helper interna (sin `has_permission`) quedaba invocable por clientes → bypass de RBAC. **Corregido en prod y en el archivo 0058**: `revoke all ... from public, authenticated, anon`. Verificado: solo `service_role` (backend confiable) la ejecuta.

**I2 — `LIKE` sobre columna enum en 0059 (error de aplicación).** `tax_kind like 'PERCEPCION_%'` falla en `ap_other_tax_t` (`operator does not exist: ap_other_tax_t ~~ unknown`). **Corregido**: `tax_kind::text like ...`. 0059 reaplicada con éxito. (En 0058 el mismo patrón opera sobre texto JSON, no requiere cast.)

Ambas correcciones quedan reflejadas en los archivos de migración (paridad archivo↔producción).

---

## 6 · ESTADO POST-EJECUCIÓN

- ERP-B1 desplegado y verificado en `arsksytgdnzukbmfgkju`.
- ERP-A intacto y operativo.
- Sin datos de prueba persistidos.
- Capa lista para que B-backend/UI consuma `ap_*` RPCs y vistas `supplier_ap_status`/`libro_iva_compras`/`supplier_invoice_fiscal`.

> Nota: backend/UI (server actions, pantallas) aún leen el `status` legacy; migrarlos a `approval_status`/`supplier_ap_status` es trabajo de fase posterior (no bloquea: aditivo). OCR avanzado (llenar `vat_lines`/`other_taxes`) = ERP-B2.

---

## VEREDICTO

# ✅ ERP-B1 COMPLETADO

Las 4 migraciones (0056→0059) fueron aplicadas y verificadas en producción `arsksytgdnzukbmfgkju`, una por una. El smoke test controlado pasó 9/9 aserciones positivas y 4/4 guardas negativas, sin persistir datos y sin alterar ERP-A. Las 2 incidencias detectadas en ejecución fueron corregidas y reverificadas.

**Queda habilitado: ERP-B2 (OCR avanzado).**

> Restricciones cumplidas: no se tocó ERP-A (supplier_payments / payment_allocations / tesoreria_register_payment / supplier_open_items sin cambios). No se inició ERP-B2, ni Libro IVA UI, ni Analytics.
