# FASE 1A · RELATIONS

**Scope:** mapa de FKs, cardinalidades y lifecycle completo de contratos recurrentes + cuenta corriente.
**Estado:** diseño · no se aplica · referencia para `FASE-1A-MIGRATION-0014.md`.

---

## 1 · Mapa de FK completo

### 1.1 Tablas nuevas con sus FK out (referencias a tablas existentes)

| Tabla nueva | Campo FK | Tabla existente | ON DELETE | Razón |
|-------------|----------|-----------------|-----------|-------|
| `recurring_contracts` | `client_id` | `clients(id)` | RESTRICT | un contrato no puede quedar huérfano de cliente |
| `recurring_contracts` | `payment_term_id` | `payment_terms(id)` | RESTRICT | term no se borra mientras haya contratos |
| `recurring_contracts` | `last_run_invoice_id` | `customer_invoices(id)` | SET NULL | si la factura se anula, se mantiene el contrato |
| `recurring_contracts` | `created_by` | `auth.users(id)` | SET NULL | si el usuario se borra, el contrato sobrevive |
| `recurring_contract_lines` | `contract_id` | `recurring_contracts(id)` | CASCADE | borrar contrato borra sus líneas |
| `recurring_runs` | `contract_id` | `recurring_contracts(id)` | CASCADE | log se borra con el contrato |
| `recurring_runs` | `invoice_id` | `customer_invoices(id)` | SET NULL | factura anulada no rompe el log |
| `recurring_runs` | `triggered_by_user` | `auth.users(id)` | SET NULL | |
| `customer_accounts` | `client_id` | `clients(id)` | CASCADE | si se borra cliente, se borra su cuenta (1:1) |
| `customer_accounts` | `default_payment_term_id` | `payment_terms(id)` | SET NULL | |
| `customer_transactions` | `client_id` | `clients(id)` | RESTRICT | append-only — un cliente con movs no se puede borrar |
| `customer_transactions` | `applies_to_tx_id` | `customer_transactions(id)` | SET NULL | self-ref para pagos→facturas |
| `customer_transactions` | `voided_by` | `auth.users(id)` | SET NULL | |
| `customer_transactions` | `created_by` | `auth.users(id)` | SET NULL | |
| `customer_payments` | `client_id` | `clients(id)` | RESTRICT | |
| `customer_payments` | `tx_id` | `customer_transactions(id)` | SET NULL | |
| `customer_payments` | `created_by` | `auth.users(id)` | SET NULL | |
| `customer_payment_applications` | `payment_id` | `customer_payments(id)` | CASCADE | borrar payment borra sus aplicaciones |
| `customer_payment_applications` | `invoice_id` | `customer_invoices(id)` | RESTRICT | no permitir borrar factura con cobros aplicados |
| `customer_late_fee_charges` | `client_id` | `clients(id)` | CASCADE | |
| `customer_late_fee_charges` | `invoice_id` | `customer_invoices(id)` | CASCADE | si se anula factura se anula la mora |
| `customer_late_fee_charges` | `rule_id` | `late_fee_rules(id)` | RESTRICT | regla no borrable con cargos aplicados |
| `customer_late_fee_charges` | `tx_id` | `customer_transactions(id)` | SET NULL | |

### 1.2 Tablas existentes que reciben FK del nuevo modelo

| Tabla existente | Recibe FK de | Campo (en la nueva) | Comentario |
|-----------------|---------------|---------------------|------------|
| `clients(id)` | 6 tablas nuevas | varias | hub central |
| `customer_invoices(id)` | 4 tablas nuevas | varias | hub de facturas |
| `auth.users(id)` | 5 tablas nuevas | varias (SET NULL) | audit |
| `payment_terms(id)` | `recurring_contracts`, `customer_accounts` | RESTRICT | catálogo |
| `late_fee_rules(id)` | `customer_late_fee_charges` | RESTRICT | catálogo |

### 1.3 NO se agregan FK sobre `customer_invoices` desde 0014

`customer_invoices` ya tiene su schema bloqueado por `tg_lock_authorized_invoice`. Las relaciones desde el motor recurrente hacia las facturas se hacen **en la dirección opuesta**: las tablas nuevas referencian `customer_invoices(id)`.

### 1.4 Identificación inversa contrato→factura

Hay 2 caminos para saber qué contrato generó una factura:

1. **`recurring_runs.invoice_id`** — más explícito, vía log
2. **`customer_invoices.observ` con tag** — se setea al emitir con prefix `[CONTRATO:<code>]` para visibilidad humana

Sin agregar columna nueva a `customer_invoices` (evita romper trigger lock).

---

## 2 · Cardinalidades

```
                            ┌────────────────────────────────┐
                            │       payment_terms             │
                            │       (catálogo)                │
                            └─────────────┬──────────────────┘
                                          │ 1:N
                                          ▼
clients (1) ───┬──── (1) customer_accounts ────┐
               │                                │  default_payment_term_id (N:1)
               │                                ▼
               │                        payment_terms
               │
               ├──── (N) recurring_contracts ────────┐
               │           │                          │  payment_term_id (N:1)
               │           │                          ▼
               │           │                  payment_terms
               │           │
               │           ├──── (N) recurring_contract_lines
               │           │
               │           ├──── (N) recurring_runs ─────────────┐
               │           │                                       │  invoice_id (N:1)
               │           │                                       ▼
               │           │                            customer_invoices
               │           │
               │           └──── (N) customer_invoices  (via runs/observ tag)
               │
               ├──── (N) customer_invoices  (ya existente)
               │           │
               │           ├──── (N) invoice_items  (ya existente)
               │           │
               │           ├──── (N) invoice_audit  (ya existente)
               │           │
               │           ├──── (1) customer_transactions  (type=INVOICE)
               │           │
               │           ├──── (N) customer_payment_applications
               │           │
               │           └──── (N) customer_late_fee_charges
               │
               ├──── (N) customer_transactions ──── self-ref (applies_to_tx_id)
               │
               ├──── (N) customer_payments
               │           │
               │           ├──── (N) customer_payment_applications
               │           │
               │           └──── (1) customer_transactions  (type=PAYMENT)
               │
               └──── (N) customer_late_fee_charges
                           │
                           └──── (1) customer_transactions  (type=LATE_FEE)

late_fee_rules (1) ─── (N) customer_late_fee_charges
```

---

## 3 · Lifecycle completo — Contrato recurrente

### Estados del contrato

```
              [BORRADOR]
                  │
                  │  user "Activar"
                  ▼
              [ACTIVO] ──────────► [PAUSADO] ──┐
                  │                   ▲          │
                  │  user "Pausar"    │          │
                  │                   │          │
                  │  user "Reanudar"  │          │
                  │       ◄───────────┘          │
                  │                              │
   end_date llega ▼                              │
              [FINALIZADO]              ◄────────┘  (puede cancelarse desde pausado)
                                                       │
                                                       ▼
                                                  [CANCELADO]
```

**Reglas:**
- BORRADOR → ACTIVO: requiere ≥1 línea activa, payment_term seteado, próximo run calculado
- ACTIVO → PAUSADO: no genera más runs hasta reanudar
- PAUSADO → ACTIVO: recalcula `next_run_date` desde hoy en adelante
- ACTIVO → FINALIZADO: automático cuando `current_date > end_date` (cron lo cierra)
- ACTIVO/PAUSADO → CANCELADO: manual; ya no se reactiva

### Estados de un run

```
       [PENDIENTE]
            │
       cron arranca
            │
       ┌────┴────┐
       ▼         ▼
     [OK]   [FAILED]
                │
        operador retry
                │
                ▼
             [OK]
```

- `PENDIENTE`: el motor reservó este período para no doble-emitir
- `OK`: factura BORRADOR generada (no autoemitida) o AUTORIZADA (autoemit)
- `FAILED`: error de validación/ARCA; queda log + permite reintento
- `SKIPPED`: contrato pausado / cliente con `stop_billing=true`
- `MANUAL_OVERRIDE`: operador emitió manualmente esa factura sin cron

### Lifecycle factura desde contrato

```
contrato.next_run_date
        │
        ▼ (cron Netlify scheduled, 09:00 ART día 1 cada mes)
        │
recurring_runs.PENDIENTE crea record
        │
        ├─ validación: contrato ACTIVO, lines activas, cliente no stop_billing
        │       │
        │       ▼ NOK
        │   SKIPPED + log
        │
        ▼ OK
calcular total con calc.ts + cotización del día
        │
        ▼
customer_invoices BORRADOR
        │
        ├─ contrato.auto_emit=false  (default)
        │       │
        │       ▼
        │   espera aprobación manual
        │
        ▼ auto_emit=true (excepción)
emit.ts dispara ARCA WSFEv1 (sandbox o prod según fiscal_config.ambiente)
        │
        ├─ ERROR → estado_arca=ERROR_ARCA + run.FAILED
        │
        ▼ OK
customer_invoices AUTORIZADO_ARCA (CAE + QR)
        │
        ▼
customer_transactions INSERT (type=INVOICE, direction=DEBIT)
        │
        ▼
customer_accounts.last_invoice_at update via trigger
        │
        ▼
customer_balances view refleja saldo nuevo
        │
        ▼
PDF render + upload → bucket invoices (path canónico) + Drive (cuando se quiera)
        │
        ▼
email al cliente con PDF adjunto (reusar email service existente)
        │
        ▼
recurring_runs OK + recurring_contracts.next_run_date += freq
```

### Lifecycle cobro

```
cliente paga (transferencia, cheque, etc.)
        │
        ▼
operador abre /billing/cobros → "Nuevo cobro"
        │
        ▼
customer_payments BORRADOR
        │
        ▼
operador aplica a 1..N facturas vía /billing/cobros/<id>/aplicar
        │
        ▼
customer_payment_applications INSERT por factura
        │
        ▼
operador "Confirmar"
        │
        ▼
customer_payments CONFIRMADO
        │
        ▼
customer_transactions INSERT (type=PAYMENT, direction=CREDIT)
        │
        ▼ (trigger)
customer_accounts.last_payment_at update
        │
        ▼
customer_balances refleja saldo bajado
        │
        ▼
si payment.unapplied_amount > 0 → queda como "anticipo" disponible para próximas facturas
```

### Lifecycle mora

```
diariamente (cron):
        │
        ▼
find customer_invoices donde:
  - estado_arca = AUTORIZADO_ARCA
  - anulada = false
  - fch_vto_pago < current_date - rule.grace_days
  - saldo_pendiente > 0 (calculado vía sum applications)
        │
        ▼
para cada factura morosa:
  │
  └─ ya hay charge para current_period? → SKIP
  │
  ▼
calcular fee_amount = saldo_pendiente * rule.rate_monthly * (días/30 si SIMPLE)
        │
        ▼
customer_late_fee_charges INSERT
        │
        ▼
customer_transactions INSERT (type=LATE_FEE, direction=DEBIT)
        │
        ▼
notificación opcional al cliente
```

---

## 4 · Lifecycle de anulación

### Anular factura recurrente generada

1. operador identifica error → emite **Nota de Crédito** (NO update)
2. NC se asocia vía `customer_invoices.comprobante_asociado_id` (campo existente, mig 0011 línea 186)
3. nuevo `customer_transactions` type=CREDIT_NOTE, direction=CREDIT con monto de la NC
4. `customer_invoices.anulada=true` (campo existente)
5. trigger `tg_lock_authorized_invoice` permite estos cambios; NO permite borrar fila
6. si la factura tiene cobros aplicados → primero **desaplicar** o ajustar con NC parcial
7. `recurring_runs.invoice_id` puede quedar apuntando a una factura anulada — no se rompe (FK SET NULL si la factura se borrara, que no debería)

### Anular cobro confirmado

1. NO se borra `customer_payments` ni transactions
2. `customer_payments.status='ANULADO'`
3. nuevo `customer_transactions` type=ADJUSTMENT direction=DEBIT por el monto del cobro (revierte el saldo)
4. `customer_payment_applications` quedan como histórico (`applied_amount` no se anula, queda audit)

### Pausar contrato

- estado → PAUSADO
- `next_run_date` queda como está (puede ser pasada — cron lo skipea)
- líneas no se borran
- al reanudar: operador decide si emite "atrasada" (períodos perdidos) o sólo desde hoy

---

## 5 · Reglas de integridad cross-tabla (a implementar como triggers o constraints)

| Regla | Implementación propuesta |
|-------|--------------------------|
| Suma aplicaciones de un payment = amount - unapplied_amount | trigger BEFORE INSERT/UPDATE en `customer_payment_applications` |
| Suma aplicaciones por factura ≤ factura.total | mismo trigger |
| Una factura no puede tener LATE_FEE para el mismo período más de 1 vez | UNIQUE (`invoice_id`, `period`) en `customer_late_fee_charges` |
| Un run no puede crear 2 facturas para el mismo contract + period | UNIQUE (`contract_id`, `period`) WHERE status IN ('OK','PENDIENTE') |
| `customer_transactions.posted=true` → lock | trigger BEFORE UPDATE replicando `tg_lock_authorized_invoice` |
| `payment.status='CONFIRMADO'` → no se permite modificar amount ni method | trigger BEFORE UPDATE en `customer_payments` |
| `recurring_contracts.status='FINALIZADO'` → no se permiten cambios excepto `notes` | trigger BEFORE UPDATE en `recurring_contracts` |
| `clients.stop_billing` heredada de `customer_accounts.stop_billing` (sí en CA, no en C) | flag vive en CA; motor lo chequea |

---

## 6 · Performance / índices a crear

```
recurring_contracts:
  - idx_recurring_contracts_client_id (client_id)
  - idx_recurring_contracts_next_run_date_status (next_run_date, status) WHERE status='ACTIVO'
  - idx_recurring_contracts_code (code) UNIQUE

recurring_contract_lines:
  - idx_lines_contract_id (contract_id)

recurring_runs:
  - idx_runs_contract_period (contract_id, period) UNIQUE WHERE status IN ('OK','PENDIENTE')
  - idx_runs_run_date (run_date desc)
  - idx_runs_status (status) WHERE status='PENDIENTE'

customer_accounts:
  - PK is client_id (ya index)

customer_transactions:
  - idx_tx_client_id (client_id)
  - idx_tx_due_date (due_date) WHERE direction='DEBIT' AND voided=false
  - idx_tx_source (source_table, source_id)
  - idx_tx_created_at (created_at desc)
  - idx_tx_period (period) WHERE period IS NOT NULL

customer_payments:
  - idx_payments_client_id (client_id)
  - idx_payments_status (status)
  - idx_payments_payment_date (payment_date desc)

customer_payment_applications:
  - idx_apps_payment_id (payment_id)
  - idx_apps_invoice_id (invoice_id)
  - UNIQUE (payment_id, invoice_id)

customer_late_fee_charges:
  - idx_late_invoice_id (invoice_id)
  - idx_late_client_id (client_id)
  - UNIQUE (invoice_id, period)
```

---

## 7 · Convenciones para FK polimórficas

`customer_transactions.source_table + source_id` referencia polimórficamente a:
- `customer_invoices` (type=INVOICE | CREDIT_NOTE | DEBIT_NOTE)
- `customer_payments` (type=PAYMENT | REFUND)
- `customer_late_fee_charges` (type=LATE_FEE)
- `manual` (type=ADJUSTMENT, source_id NULL permitido)

No hay FK formal a cada tabla (sino sería excluyente). Se valida con **trigger BEFORE INSERT**:

```pseudo
if source_table = 'customer_invoices':
  assert exists(customer_invoices where id = source_id)
elif source_table = 'customer_payments':
  assert exists(customer_payments where id = source_id)
elif source_table = 'customer_late_fee_charges':
  assert exists(customer_late_fee_charges where id = source_id)
elif source_table = 'manual':
  assert source_id is null or created_by is not null  -- manual exige actor
else:
  raise 'source_table inválido'
```

---

## 8 · Resumen visual del FK graph

```
                        clients ◄────────────────┐
                          │                       │
                          │ 1:1                   │
                          ▼                       │
                   customer_accounts              │
                          │                       │
                          │ N:1 default           │
                          ▼                       │
                    payment_terms ◄───────────────┤
                          ▲                       │
                          │ N:1                   │
                          │                       │
                   recurring_contracts            │
                       │       │                  │
                       │       ▼                  │
                       │   recurring_contract_lines
                       │       │
                       ▼       │
                  recurring_runs                  │
                       │                          │
                       │ N:1 (SET NULL)           │
                       ▼                          │
                  customer_invoices ──────────────┤
                       │  ▲                       │
                       │  │ ya existente          │
                       │  │                       │
                       │  ├── invoice_items       │
                       │  └── invoice_audit       │
                       │                          │
                       │ source                   │
                       ▼                          │
                  customer_transactions ◄─────────┤
                       ▲                          │
                       │ source                   │
                       │                          │
                  customer_payments ◄─────────────┤
                       │                          │
                       │ N:M                      │
                       ▼                          │
                customer_payment_applications     │
                       ▲                          │
                       │                          │
                  customer_invoices  ─────────────┘
                       ▲
                       │
                  customer_late_fee_charges
                       ▲
                       │ N:1
                       │
                  late_fee_rules
```

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR
- 🛑 NO SQL ejecutable
- 🛑 NO TOCAR producción
- 🛑 NO MODIFICAR tablas existentes
