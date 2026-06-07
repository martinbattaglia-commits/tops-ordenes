# ERP-A2 · DISEÑO DE ARQUITECTURA — RPCs + VISTAS DERIVADAS (`0054`)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A2_ARCHITECTURE_DESIGN.md`
**Base:** modelo de datos `0053` desplegado y **VERIFIED IN PRODUCTION** (`arsksytgdnzukbmfgkju`).
**Naturaleza:** diseño técnico. **No se escribe `0054`, código, backend ni UI.**

> **Congelado (sin cambios):** D1 (saldo derivado) · D2 (allocations N:M) · D3 (numeración) · D4 (retención simple) · D5 (cuenta corriente derivada). **Incorpora:** F1 (lock por factura), F4 (vistas solo `confirmado`), R2 (`via_rpc` con `is_local=true`).

---

## 0. Principios de la capa A2

- **Las RPC son el único escritor** de cobranzas/pagos/transferencias/allocations. Activan el guard de la casa con `select set_config('treasury.via_rpc','on', true);` (**`is_local=true`** → scope transacción, sin fuga por pgbouncer — **R2**).
- **Convención de la casa:** `language plpgsql · security definer · set search_path = public, pg_temp · returns jsonb`; errores `'CODE: mensaje'`.
- **Nada se persiste como saldo** (D1) ni como cuenta corriente (D5): todo se **deriva en vistas** que filtran `status='confirmado'` (F4).
- **`created_by := auth.uid()`** en toda fila creada por RPC.
- **Permisos finos en la RPC** (`has_permission('tesoreria.create'|'.edit')`), además de la RLS de tabla.

---

## 1. RPCs (firma completa · parámetros · validaciones)

### 1.1 `tesoreria_register_receipt` — registrar cobranza
```
tesoreria_register_receipt(
  p_client_id        uuid,
  p_payment_date     date,
  p_payment_method   public.treasury_receipt_method_t,
  p_bank_account_id  uuid,                 -- efectivo ⇒ cuenta CAJA (NOT NULL)
  p_gross_amount     numeric(15,2),
  p_retention_amount numeric(15,2) default 0,
  p_observations     text default null,
  p_attachment       text default null,
  p_allocations      jsonb                 -- [{ "invoice_id": uuid, "amount": numeric }]
) returns jsonb   -- { receipt_id, public_id, movement_id|null, net_amount, allocations }
```
**Validaciones (en orden):**
1. `set_config('treasury.via_rpc','on',true)`; `has_permission('tesoreria.create')` o `raise 'FORBIDDEN'`.
2. `p_gross_amount > 0`; `p_retention_amount between 0 and p_gross_amount`; `net := gross − retention`.
3. `p_allocations` no vacío; **`Σ amount = p_gross_amount`** (imputación total; sin "a cuenta" en A — F9 documentado) o `raise 'ALLOCATION_SUM_MISMATCH'`.
4. Banco: existe, `active`, `currency='ARS'` (guard FX) o `raise 'BANK_INVALID'`. Si `method='efectivo'` ⇒ banco debe ser la cuenta `is_system` CAJA (recomendado; validar).
5. **F1 — lock determinístico:** `select id from customer_invoices where id = any(<ids>) order by id for update;` (serializa y evita deadlock).
6. Por cada factura imputada (bajo lock): pertenece a `p_client_id`; `estado_arca='AUTORIZADO_ARCA'` y `anulada=false` (F8 destino vigente); **`saldo_actual ≥ amount`** computado como `total − Σ(allocations confirmadas)` o `raise 'OVERALLOCATION'`.
7. `insert customer_receipts(...)` (net_amount es GENERATED).
8. `insert receipt_allocations(...)` (N filas) — pasa el guard `via_rpc`.
9. **Movimiento:** si `net > 0` ⇒ `insert treasury_movements(type='cobranza', direction='ingreso', amount=net, bank_account_id=p_bank_account_id, reference_type='customer_receipt', reference_id=receipt.id, status='confirmado', created_by=auth.uid())`. Si `net = 0` (retención 100%) ⇒ **no se crea movimiento** (H9; la deuda igual se cancela por `gross` vía allocations); `movement_id=null`.
**Retorno:** ids + `net_amount`.

### 1.2 `tesoreria_register_payment` — registrar pago a proveedor
```
tesoreria_register_payment(
  p_vendor_id        uuid,
  p_payment_date     date,
  p_payment_method   public.treasury_payment_method_t,
  p_bank_account_id  uuid,
  p_amount           numeric(14,2),
  p_operation_number text default null,
  p_observations     text default null,
  p_attachment       text default null,
  p_allocations      jsonb                 -- [{ "supplier_invoice_id": uuid, "amount": numeric }]
) returns jsonb   -- { payment_id, public_id, movement_id, allocations }
```
**Validaciones:** ídem 1.1 con: `p_amount>0`; `Σ allocations = p_amount`; **F1 lock** `supplier_invoices ... order by id for update`; cada factura pertenece a `p_vendor_id`, `status <> 'anulada'`, `saldo ≥ amount`; banco ARS; `has_permission('tesoreria.create')`. Inserta pago + `payment_allocations` + **un** movimiento `type='pago_proveedor', direction='egreso', amount=p_amount, reference_type='supplier_payment'`. (Sin caso net=0; sin retención del lado pago en A.)

### 1.3 `tesoreria_register_transfer` — transferencia interna
```
tesoreria_register_transfer(
  p_date                  date,
  p_from_bank_account_id  uuid,
  p_to_bank_account_id    uuid,
  p_amount                numeric(15,2),
  p_description           text default null
) returns jsonb   -- { transfer_group_id, movement_out_id, movement_in_id }
```
**Validaciones:** `from <> to`; `p_amount>0`; ambos bancos existen/`active`/ARS; `has_permission('tesoreria.create')`. `v_group := gen_random_uuid()`. Inserta **2** movimientos `type='transferencia'`, `reference_type='transfer'`, `reference_id=null`, `transfer_group_id=v_group`: egreso (from) + ingreso (to). (El CHECK `type↔direction` admite ambas direcciones para `transferencia`.)

### 1.4 `tesoreria_void_movement` — anular (append-only)
```
tesoreria_void_movement(
  p_target_type text,    -- 'receipt' | 'payment' | 'transfer' | 'movement'(ajuste)
  p_target_id   uuid,    -- receipt/payment/movement id, o transfer_group_id
  p_reason      text
) returns jsonb   -- { voided: [ ...ids... ] }
```
**Validaciones:** `has_permission('tesoreria.edit')`; `p_reason` no vacío; target existe y está `confirmado` (no ya `anulado`) o `raise 'ALREADY_VOID'`.
**Acción (cumple los lock triggers: confirmado→anulado + `voided_*`, sin tocar datos):**
- `receipt` ⇒ `update customer_receipts set status='anulado', voided_at=now(), voided_by=auth.uid(), void_reason=p_reason`; ídem su movimiento (`reference_type='customer_receipt'`).
- `payment` ⇒ análogo (movimiento `reference_type='supplier_payment'`).
- `transfer` ⇒ anula **ambos** movimientos del `transfer_group_id`.
- `movement` (ajuste) ⇒ anula ese movimiento.
> Las `allocations` permanecen (inmutables); quedan **excluidas** de saldos porque su recibo/pago pasó a `anulado` (las vistas filtran por estado del padre — F4). El recálculo de saldo banco/factura es **automático** (derivado).

---

## 2. Vistas derivadas (SQL conceptual · F4: solo `status='confirmado'`)

### 2.1 `treasury_bank_balances` — saldo por banco (D1)
```sql
create or replace view public.treasury_bank_balances as
select ba.id  as bank_account_id, ba.bank_name, ba.account_name, ba.account_type,
       ba.currency, ba.is_system, ba.opening_balance,
       ba.opening_balance
         + coalesce(sum(case when m.direction='ingreso' then m.amount else -m.amount end)
                    filter (where m.status='confirmado'), 0) as balance
from public.bank_accounts ba
left join public.treasury_movements m on m.bank_account_id = ba.id
group by ba.id;
```

### 2.2 `customer_open_items` — saldo por factura cliente
```sql
create or replace view public.customer_open_items as
select ci.id as invoice_id, ci.client_id, ci.numero_comprobante, ci.total,
       coalesce(sum(ra.amount) filter (where cr.status='confirmado'), 0) as pagado,
       ci.total - coalesce(sum(ra.amount) filter (where cr.status='confirmado'), 0) as saldo,
       case
         when ci.anulada or ci.estado_arca='ANULADO' then 'anulada'
         when ci.total - coalesce(sum(ra.amount) filter (where cr.status='confirmado'),0) <= 0 then 'cobrada'
         when coalesce(sum(ra.amount) filter (where cr.status='confirmado'),0) > 0 then 'parcial'
         when ci.fch_vto_pago is not null and ci.fch_vto_pago < current_date then 'vencida'
         else 'pendiente'
       end as estado_cobro,
       ci.fch_vto_pago
from public.customer_invoices ci
left join public.receipt_allocations ra on ra.customer_invoice_id = ci.id
left join public.customer_receipts cr   on cr.id = ra.receipt_id
where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false   -- F7 vigentes
group by ci.id;
```

### 2.3 `supplier_open_items` — saldo por factura proveedor
```sql
create or replace view public.supplier_open_items as
select si.id as invoice_id, si.vendor_id, si.public_id, si.total,
       coalesce(sum(pa.amount) filter (where sp.status='confirmado'), 0) as pagado,
       si.total - coalesce(sum(pa.amount) filter (where sp.status='confirmado'), 0) as saldo,
       case
         when si.status='anulada' then 'anulada'
         when si.total - coalesce(sum(pa.amount) filter (where sp.status='confirmado'),0) <= 0 then 'pagada'
         when coalesce(sum(pa.amount) filter (where sp.status='confirmado'),0) > 0 then 'parcial'
         when si.fecha_vencimiento is not null and si.fecha_vencimiento < current_date then 'vencida'
         else 'pendiente'
       end as estado_pago,
       si.fecha_vencimiento
from public.supplier_invoices si
left join public.payment_allocations pa on pa.supplier_invoice_id = si.id
left join public.supplier_payments sp   on sp.id = pa.payment_id
where si.status <> 'anulada'
group by si.id;
```

### 2.4 `customer_current_account` — cuenta corriente cliente (VISTA, D5)
```sql
create or replace view public.customer_current_account as
select client_id,
       count(*) filter (where saldo > 0)        as facturas_abiertas,
       sum(total)                                as total_facturado,
       sum(pagado)                               as total_cobrado,
       sum(saldo)                                as saldo_cuenta,
       min(fch_vto_pago) filter (where saldo>0)  as proxima_vencimiento
from public.customer_open_items
group by client_id;
```

### 2.5 `supplier_current_account` — cuenta corriente proveedor (VISTA, D5)
```sql
-- análoga sobre supplier_open_items, agrupando por vendor_id
```

### 2.6 `treasury_cashflow_projection` — flujo de fondos
```sql
-- UNION de:
--   próximos COBROS  : customer_open_items (saldo>0) por fch_vto_pago      (signo +)
--   próximos PAGOS   : supplier_open_items (saldo>0) por fecha_vencimiento (signo −)
-- + saldo bancario actual (Σ treasury_bank_balances.balance) como punto de partida,
--   con saldo proyectado acumulado por fecha (window sum order by fecha).
```
> Todas las vistas son **read-only**, derivadas, sin estado persistido. La cuenta corriente y los saldos **no son tablas ni columnas** (D1, D5 intactos).

---

## 3. Concurrencia (locks · orden de ejecución)

| Escenario | Riesgo | Resolución |
|---|---|---|
| **Doble imputación** (2 cobros/pagos a la misma factura) | sobre-pasar el saldo | **F1:** `select ... from customer_invoices/supplier_invoices where id = any(ids) order by id for update;` **antes** de validar saldo. El segundo proceso espera el lock, re-computa `saldo` (ya reducido) y rechaza si excede (`OVERALLOCATION`). |
| **Cobros simultáneos a facturas distintas** | ninguno | filas distintas ⇒ sin contención. |
| **Pagos simultáneos** | ídem cobros | mismo lock sobre `supplier_invoices`. |
| **Deadlock** (recibo multi-factura A→B vs B→A) | bloqueo cruzado | **orden determinístico** `order by id` al lockear ⇒ todos adquieren en el mismo orden. |
| **Saldo bancario concurrente** | ninguno | D1 derivado: la suma se computa al leer; inserts concurrentes de movimientos no corrompen el saldo. **Sin lock** necesario. |
| **Fuga de `via_rpc` por pgbouncer** | guard desactivado en requests ajenos | **R2:** `set_config(...,true)` (is_local=true) ⇒ scope transacción, se limpia al COMMIT. |

**Orden de ejecución dentro de cada RPC (transacción única):**
```
1. set_config('treasury.via_rpc','on',true)   2. has_permission()   3. validar entradas
4. FOR UPDATE de facturas (order by id)        5. validar destino + saldo bajo lock
6. insert documento (receipt/payment)          7. insert allocations
8. insert movimiento(s) (si aplica)            9. return jsonb     (COMMIT libera lock + limpia GUC)
```

---

## 4. Integridad financiera

- **Retención (D4):** movimiento = `net`; allocations imputan `gross`; `net=0` ⇒ sin movimiento (la deuda se cancela por `gross`). La diferencia `gross−net` (retención) es crédito fiscal → **ERP-F**, no tesorería.
- **type↔direction:** garantizado por CHECK de `0053` + la RPC setea la dirección correcta.
- **Σ allocations = monto** del documento: validado en RPC (el esquema no lo respalda — enforcement RPC-only, aceptado y documentado).
- **No sobre-imputación por factura:** garantizada por el lock F1 + chequeo de saldo bajo lock.
- **Append-only:** las RPC nunca borran ni editan importes; `void` solo transiciona `confirmado→anulado` con `voided_*` (cumple los lock triggers de `0053`).
- **Saldos / cuenta corriente:** 100% derivados (D1/D5); el `void` se refleja solo por excluir al padre `anulado` (F4).
- **Moneda:** guard `currency='ARS'` en RPC (FX fuera de A).
- **Trazabilidad:** `created_by=auth.uid()` en altas; `voided_by/at/reason` en anulaciones.

---

## 5. Riesgos

### 🔴 P0
**Ninguno** (diseño coherente con `0053` desplegado).

### 🟠 P1
- **R-A2-1 — Lock en la entidad correcta.** F1 debe lockear la **fila de la factura** (`customer_invoices`/`supplier_invoices`), no la allocation; si se lockea mal, reaparece la doble imputación. *(Verificar en `0054`.)*
- **R-A2-2 — `via_rpc` con `is_local=true`.** Obligatorio (R2). Setearlo session-level reintroduce la fuga por pooler.
- **R-A2-3 — Guard antes de insertar.** El `set_config` debe ejecutarse **antes** de los inserts de movimiento/allocations (si no, el guard los rechaza).

### 🟡 P2
- **R-A2-4 — Retención 100% (net=0):** sin movimiento bancario; la deuda se cancela igual. Correcto, pero debe documentarse para el usuario (no es un "cobro" en caja).
- **R-A2-5 — Conjunto "vigente" de facturas** en las vistas: clientes filtran `estado_arca='AUTORIZADO_ARCA'`. Facturas en otros estados (mock SANDBOX) no aparecen como cuenta corriente. Confirmar criterio con producción.
- **R-A2-6 — Performance de vistas** a gran volumen (joins por factura). Mitigable con *materialized view* refrescada por las RPC (sin cambiar la fuente de verdad).
- **R-A2-7 — Sin pago/cobro "a cuenta"** (Σ allocations = monto): anticipos no soportados en A (F9 → ERP-D).

### ⚪ P3
- **R-A2-8 — Anulación de factura con allocations confirmadas:** política de bloqueo/compensación → ERP-C/D.
- **R-A2-9 — Cheque/Echeq** se confirman inmediatos (clearing futuro con `status='pendiente'`).

---

## 6. Veredicto

> # 🟢 READY FOR 0054
>
> El diseño de A2 (4 RPCs + 6 vistas derivadas) es **completo, coherente con el modelo `0053` ya desplegado en producción**, y **preserva D1–D5**: saldos bancarios y cuenta corriente siguen **derivados** (sin tablas ni columnas de saldo); allocations N:M soportan parciales/multi-factura/multi-recibo.
>
> **Incorpora** F1 (lock determinístico por factura → sin doble imputación ni deadlock), F4 (vistas filtran `status='confirmado'`), R2 (`via_rpc` con `is_local=true`). La concurrencia (cobros/pagos simultáneos, doble imputación) y la integridad financiera (retención, type↔direction, append-only) están resueltas a nivel de diseño.
>
> Sin P0; los P1 son directivas de implementación a respetar en `0054` (lock en la factura, `is_local=true`, guard antes de insertar).
>
> Pendiente: **autorización explícita** para escribir `0054_treasury_functions.sql`. Este documento es solo diseño.

---

*Fin — Diseño de Arquitectura ERP-A2 (RPCs + Vistas). Veredicto: READY FOR 0054. No se escribió `0054`, código, backend ni UI.*
