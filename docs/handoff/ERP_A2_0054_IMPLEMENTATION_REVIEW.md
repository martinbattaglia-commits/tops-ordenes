# ERP-A2 · REVISIÓN DE IMPLEMENTACIÓN — `0054_treasury_functions.sql`

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A2_0054_IMPLEMENTATION_REVIEW.md`
**Cubre:** `supabase/migrations/0054_treasury_functions.sql` (escrito, **no aplicado, no ejecutado**).
**Base:** modelo `0053` verificado en producción (`arsksytgdnzukbmfgkju`).
**Naturaleza:** escritura del archivo + auditoría adversarial. **No se aplicó/ejecutó `0054`, ni backend, ni UI.**

> **Reglas:** D1–D5 sin cambios · F1 (lock por factura) · F4 (vistas solo `confirmado`) · R2 (`via_rpc` is_local=true). **No** `current_balance`, **no** tablas `*_current_account`.

---

## 1. Resumen de `0054`

Capa de uso sobre `0053`: **4 RPCs transaccionales** + **6 vistas derivadas**. Aditiva (no toca `0052/0053`). Estructura verificada: 4 funciones · 6 vistas · `$$` balanceados (8) · `security definer` + `search_path` en las 4 · `security_invoker=true` en las 6 vistas · `has_permission` en las 4 · `notify pgrst` final.

---

## 2. RPCs implementadas

| RPC | Hace | Permiso |
|---|---|---|
| `tesoreria_register_receipt` | recibo + allocations + movimiento `ingreso` (net); net=0 ⇒ sin movimiento | `tesoreria.create` |
| `tesoreria_register_payment` | pago + allocations + movimiento `egreso` | `tesoreria.create` |
| `tesoreria_register_transfer` | par de movimientos (egreso+ingreso) con `transfer_group_id` | `tesoreria.create` |
| `tesoreria_void_movement` | anulación append-only (receipt/payment/transfer/ajuste) | `tesoreria.edit` |

Todas: `security definer · search_path=public,pg_temp · returns jsonb`, `created_by=auth.uid()`, errores `'CODE: msg'`, guard de moneda ARS, `has_permission` al inicio.

---

## 3. Vistas implementadas

| Vista | Deriva | Tipo |
|---|---|---|
| `treasury_bank_balances` | `opening_balance + Σ(±amount confirmados)` | VIEW (D1) |
| `customer_open_items` | total/pagado/saldo/estado_cobro por factura cliente | VIEW |
| `supplier_open_items` | ídem proveedor | VIEW |
| `customer_current_account` | agregado por cliente | **VIEW (D5, no tabla)** |
| `supplier_current_account` | agregado por proveedor | **VIEW (D5, no tabla)** |
| `treasury_cashflow_projection` | cobros (+) / pagos (−) por vencimiento + acumulado | VIEW |

`create table` en `0054`: **0** ✓. `current_balance`: **0** (solo en comentario de la regla) ✓.

---

## 4. Verificación F1 (lock por factura)

- `register_receipt` (línea 90): `perform 1 from public.customer_invoices where id = any(v_ids) order by id for update;`
- `register_payment` (línea 192): `perform 1 from public.supplier_invoices where id = any(v_ids) order by id for update;`
- **`for update` sobre allocations: 0** (correcto — nunca sobre allocations).
- **`order by id`** ⇒ adquisición de locks en orden determinístico (anti-deadlock).
- La validación de saldo (`total − Σ confirmadas`) ocurre **bajo el lock**. ✅

---

## 5. Verificación F4 (vistas solo `confirmado`)

13 filtros `filter (where <status> = 'confirmado')` en `treasury_bank_balances` (`m.status`), `customer_open_items` (`cr.status`), `supplier_open_items` (`sp.status`). Las cuentas corrientes y el cashflow derivan de los open_items ⇒ **anulados/voided excluidos** en toda la capa. ✅

---

## 6. Verificación R2 (`via_rpc` is_local=true)

`perform set_config('treasury.via_rpc', 'on', true);` al inicio de las **3 RPC de alta** (líneas 53, 166, 251), **antes** de cualquier INSERT protegido (movimientos no-`ajuste` + allocations). `is_local=true` ⇒ scope transacción ⇒ sin fuga por pgbouncer. `void` **no** lo necesita (solo hace UPDATE confirmado→anulado, gobernado por los lock triggers, no por el guard de INSERT). ✅

---

## 7. Auditoría adversarial (intentar romper)

### 🔧 Hallazgo corregido durante la auditoría
- **A2-BUG-1 (corregido):** en `void_movement` (path `receipt`) había `returning id into v_voided` con `v_voided uuid[]` → **type mismatch en runtime** al anular un recibo con movimiento (caso común). **Corregido:** se eliminó el `returning into` (no se usaba) y la variable. Re-verificado: sin `returning … into v_voided` en el archivo.

### Intentos que el diseño RESISTE
| Ataque | Resultado |
|---|---|
| **Doble imputación** (2 cobros a misma factura en paralelo) | El 2º espera el `FOR UPDATE`; al liberarse, recomputa saldo (ya reducido por el 1º) y rechaza con `OVERALLOCATION`. ✅ |
| **Deadlock** (recibo A→B vs B→A) | `order by id for update` ⇒ orden de lock idéntico ⇒ sin deadlock. ✅ |
| **Sobre-imputar una factura** (amt > saldo) | `OVERALLOCATION` (chequeo bajo lock). ✅ |
| **Σ allocations ≠ monto** | `ALLOCATION_SUM_MISMATCH`. ✅ |
| **Imputar a factura de otro cliente/proveedor** | `INVOICE_WRONG_CLIENT/VENDOR`. ✅ |
| **Imputar a factura anulada / no autorizada** | `INVOICE_NOT_PAYABLE` / `INVOICE_VOID`. ✅ |
| **Crear allocation/movimiento por fuera de la RPC** | guards de `0053` (`via_rpc`) lo rechazan; la RPC los habilita solo dentro de su tx. ✅ |
| **Cobranza con `direction` inválida** | la RPC fija `ingreso`/`egreso`; el CHECK de `0053` respalda. ✅ |
| **Transferencia mismo banco / inactivo / no-ARS** | `SAME_ACCOUNT` / `BANK_INACTIVE` / `CURRENCY_UNSUPPORTED`. ✅ |
| **Anular dos veces** | `where status='confirmado'` ⇒ 0 filas ⇒ `NOT_FOUND_OR_ALREADY_VOID`. ✅ |
| **Anular directamente el movimiento de una cobranza** | `void 'movement'` solo aplica a `type='ajuste'` ⇒ rechazado; hay que anular el recibo (que anula ambos). ✅ |
| **Anular recibo con net=0 (sin movimiento)** | el UPDATE del movimiento matchea 0 filas (sin error); el recibo se anula. ✅ |
| **Llamar la RPC sin permiso** | `has_permission` ⇒ `FORBIDDEN` (aunque tenga grant execute). ✅ |
| **`cliente` leyendo vistas** | `security_invoker=true` ⇒ RLS de tablas treasury (internas) niega ⇒ sin datos financieros. ✅ |

### Bordes residuales (no bloquean)
- **Factura duplicada en un mismo recibo** (mismo invoice_id 2 veces): pasa la suma pero el `unique(receipt_id, invoice_id)` aborta la tx (mensaje crudo de constraint). *P3 — pre-validar duplicados.*
- **Decimales > 2** en montos del caller: se redondean a `numeric(15,2)`; la comparación `Σ = monto` podría diferir por redondeo. *P3.*
- **Dependencia de `AUTORIZADO_ARCA`:** `register_receipt` solo imputa a facturas `AUTORIZADO_ARCA`; hoy en prod la emisión real está gated (mock SANDBOX) ⇒ podría no haber facturas imputables hasta activar ARCA. *P2 operativo (no es bug de 0054).*

---

## 8. Riesgos

### 🔴 P0
**Ninguno.** (El único bug —A2-BUG-1— fue detectado y **corregido** en esta misma revisión.)

### 🟠 P1
**Ninguno abierto.** F1/F4/R2 implementados y verificados; D1/D5 intactos.

### 🟡 P2
- **R-0054-1 — Validación bajo carga del orden de lock.** `order by id for update` es el patrón anti-deadlock estándar; conviene validar con prueba de concurrencia real en A5/E2E.
- **R-0054-2 — Vistas heredan RLS de `customer_invoices`/`supplier_invoices`** (existencia de facturas visible a `authenticated`); el dato de pago/cobro sí está gated (allocations/receipts internos). No empeora respecto del estado actual; revisar si se habilita portal cliente.
- **R-0054-3 — Dependencia operativa de ARCA** (`AUTORIZADO_ARCA`) para que existan cobranzas imputables.
- **R-0054-4 — Performance de vistas** a gran volumen (joins por factura) → *materialized view* futura.

### ⚪ P3
- Factura duplicada en allocations (mensaje crudo) · redondeo de decimales · mensajes de error más amigables.

---

## 9. Veredicto

> # 🟢 READY FOR ERP-A3
>
> `0054_treasury_functions.sql` está **escrito, auditado adversarialmente y corregido**:
> - **4 RPCs** (`register_receipt/_payment/_transfer/void_movement`) + **6 vistas derivadas**, coherentes con `0053`.
> - **F1** (lock `FOR UPDATE` por factura, ordenado, nunca sobre allocations) · **F4** (vistas solo `confirmado`) · **R2** (`via_rpc` is_local=true antes de inserts) — **implementados y verificados**.
> - **D1** (saldo bancario derivado, sin `current_balance`) y **D5** (cuenta corriente como **vistas**, sin tablas) — **preservados**.
> - La pasada adversarial resolvió concurrencia, doble imputación, allocations parciales/multi, transferencias y anulaciones; **1 bug encontrado y corregido** (A2-BUG-1).
> - **Sin P0 ni P1 abiertos.**
>
> `0054` queda **listo para revisión/aplicación** en su momento (bajo el procedimiento manual aprobado: `BEGIN/COMMIT`, prod `arsks`). La **aplicación de `0054`** y el avance a **ERP-A3 (backend/UI)** requieren autorización explícita aparte — no se ejecutó nada aquí.
>
> Pendiente: tu autorización para (a) aplicar `0054` a producción y/o (b) iniciar ERP-A3.

---

## Anexo — Verificación estática

| Check | Resultado |
|---|---|
| Funciones / vistas | 4 / 6 |
| `$$` balanceados | 8 (par) |
| `FOR UPDATE` sobre facturas / sobre allocations | 2 / **0** |
| `set_config(via_rpc,'on',true)` | 3 (RPCs de alta) |
| Filtros `status='confirmado'` en vistas | 13 |
| `current_balance` (columna) | 0 (solo comentario) |
| `create table` | 0 |
| `*_current_account` como vista | 2 |
| `security_invoker=true` | 6 |
| `returning … into v_voided` (bug) | 0 (corregido) |

---

*Fin — Revisión de Implementación `0054`. Veredicto: READY FOR ERP-A3. `0054` escrito y auditado; no aplicado, no ejecutado; sin backend/UI.*
