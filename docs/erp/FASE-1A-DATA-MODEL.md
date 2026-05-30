# FASE 1A · DATA MODEL

**Fecha:** 2026-05-29
**Scope:** facturación recurrente + cuenta corriente cliente
**Estado:** DISEÑO · no aplicar · no ejecutar SQL
**Compatibilidad:** aditivo, no toca tablas existentes (`customer_invoices`, `invoice_items`, `invoice_audit` permanecen tal cual)

---

## 0 · Resumen de tablas nuevas

| # | Tabla | Tipo | Propósito |
|---|-------|------|-----------|
| 1 | `payment_terms` | catálogo | Condiciones de pago reutilizables (contado, 30d, 30/60/90, etc.) |
| 2 | `recurring_contracts` | header | Acuerdo recurrente con cliente (frequency, fechas, condición de pago) |
| 3 | `recurring_contract_lines` | items | Conceptos del contrato (m², abonos, descripción libre) |
| 4 | `recurring_runs` | log | Registro de cada ejecución del motor (idempotencia) |
| 5 | `customer_accounts` | header | Estado de cuenta corriente del cliente (saldo agregado, métricas) |
| 6 | `customer_transactions` | movimientos | Append-only: factura, NC, cobro, ajuste, interés |
| 7 | `customer_payments` | header | Cabecera de cobro (puede aplicar a N facturas) |
| 8 | `customer_payment_applications` | M:N | Aplicación de un cobro a una factura (parcial o total) |
| 9 | `late_fees` | config + aplicaciones | Cargos por mora aplicados (catálogo de reglas + instancias) |
| **VIEW** | `customer_balances` | derivada | Saldo agregado real-time por cliente |

---

## 1 · `payment_terms` — catálogo

Condiciones de pago reutilizables. Persistido para que las facturas mantengan el snapshot de la condición usada (no se altera retroactivamente al cambiar el catálogo).

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `code` | text unique | ej. `CASH`, `D30`, `D60`, `D30_60_90`, `CUSTOM` |
| `name` | text | display ("Contado", "30 días", "30/60/90") |
| `is_split` | boolean | true si genera múltiples vencimientos |
| `splits` | jsonb | `[{days:0,pct:50},{days:30,pct:50}]` para condiciones complejas |
| `default_days_to_due` | int | días default si no hay splits (ej 30) |
| `active` | boolean default true | |
| `is_system` | boolean default false | seeds no editables |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | |

**Seeds propuestos:**
- `CASH` — Contado · 0 días
- `D7` — 7 días
- `D15` — 15 días
- `D30` — 30 días · default sistema
- `D60` — 60 días
- `D90` — 90 días
- `D30_60` — 30/60 días · `splits: [{days:30,pct:50},{days:60,pct:50}]`
- `D30_60_90` — 30/60/90 días · 3 partes iguales
- `CUSTOM` — placeholder; obliga a especificar splits inline en el contrato

---

## 2 · `recurring_contracts` — header

Contrato de servicios recurrentes con un cliente. NO emite facturas directamente — genera **borradores** que pasan por el flujo de emisión existente.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `client_id` | uuid FK clients(id) ON DELETE RESTRICT | |
| `code` | text | identificador legible "C-ANMAT-22M2-BIDCOM-2026" |
| `descripcion` | text | resumen humano del contrato |
| **`frequency`** | enum `recurring_freq_t` | `MENSUAL`, `TRIMESTRAL`, `SEMESTRAL`, `ANUAL` |
| `start_date` | date | desde cuándo factura |
| `end_date` | date null | null = indefinido |
| `next_run_date` | date | próxima fecha de generación (lo actualiza el motor) |
| `billing_day` | smallint default 1 | día del mes para corte (1-28; >28 cae al último del mes) |
| `payment_term_id` | uuid FK payment_terms(id) | condición de pago para las facturas generadas |
| `auto_emit` | boolean default false | true = emite a ARCA automáticamente; false = deja en borrador para aprobar |
| `concepto_arca` | smallint default 2 | 2=servicios |
| `tipo_comprobante_default` | enum comprobante_tipo_t | se recalcula contra `client.condicion_iva` al emitir; este campo es hint |
| `punto_venta` | int | FK lógica a `puntos_venta.numero` |
| `currency` | text default 'PES' | 'PES' o 'USD' (facturado en ARS al cambio del día) |
| `cotizacion_source` | text default 'BCRA_OFICIAL' | BCRA_OFICIAL, BCRA_MAYORISTA, FIJO (con valor) |
| `cotizacion_fija` | numeric(15,6) null | sólo si `cotizacion_source='FIJO'` |
| `iva_default` | numeric(5,2) default 21 | 0 / 10.5 / 21 / 27 |
| **`status`** | enum `recurring_contract_status_t` | `BORRADOR`, `ACTIVO`, `PAUSADO`, `FINALIZADO`, `CANCELADO` |
| `notas` | text | |
| `signed_at` | timestamptz null | si está firmado por el cliente |
| `signature_path` | text null | path al PDF del contrato en Drive (opcional) |
| `last_run_at` | timestamptz null | última ejecución exitosa del motor |
| `last_run_invoice_id` | uuid FK customer_invoices(id) ON DELETE SET NULL | |
| `created_by` | uuid FK auth.users(id) | |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | |

**Enums necesarios:**

```
recurring_freq_t        = MENSUAL | TRIMESTRAL | SEMESTRAL | ANUAL
recurring_contract_status_t = BORRADOR | ACTIVO | PAUSADO | FINALIZADO | CANCELADO
```

**Constraints:**
- `check (billing_day between 1 and 28)`
- `check (end_date is null or end_date >= start_date)`
- `check ((cotizacion_source='FIJO' and cotizacion_fija is not null) or cotizacion_source<>'FIJO')`

---

## 3 · `recurring_contract_lines` — items contratados

Renglones de servicios. Cada línea genera un `invoice_item` cuando el motor crea la factura.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `contract_id` | uuid FK recurring_contracts(id) ON DELETE CASCADE | |
| `orden` | int default 0 | para mantener orden en facturas |
| `descripcion` | text | "Almacenaje ANMAT — 22 m²" |
| `categoria` | enum `recurring_line_category_t` | `ALMACENAJE_ANMAT`, `ALMACENAJE_GRAL`, `OFICINA`, `COWORK`, `ABONO`, `OTRO` |
| `unidad` | text default 'mes' | 'mes', 'm2', 'unidad' |
| `cantidad` | numeric(12,4) | en USD/ARS según moneda (ej 22 m²) |
| `precio_unitario` | numeric(15,4) | en moneda del contrato (USD 50/m²) |
| `iva_rate` | numeric(5,2) default 21 | override por línea |
| `apply_indexacion` | boolean default false | placeholder para futuras revisiones por inflación |
| `notes` | text | |
| `active` | boolean default true | desactivable sin borrar (queda histórico de períodos anteriores) |

**Validaciones (a nivel app y check):**
- `cantidad > 0`
- `precio_unitario >= 0`
- al menos 1 línea activa para que el motor genere factura

---

## 4 · `recurring_runs` — log de ejecuciones del motor

Idempotencia crítica. Cada ejecución se registra antes de crear la factura.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `contract_id` | uuid FK recurring_contracts(id) ON DELETE CASCADE | |
| `periodo` | text NOT NULL | `YYYY-MM` para mensual, `YYYY-Q1..Q4` para trimestral, etc. |
| `run_date` | date | fecha en que corrió |
| `intended_for_date` | date | fecha de "facturación" objetivo (puede no coincidir si fue manual o retraso) |
| `status` | enum `recurring_run_status_t` | `PENDIENTE`, `OK`, `FAILED`, `SKIPPED`, `MANUAL_OVERRIDE` |
| `invoice_id` | uuid FK customer_invoices(id) ON DELETE SET NULL | factura generada |
| `total_estimado` | numeric(15,2) | suma calculada antes de emitir |
| `currency_snapshot` | text | PES/USD copiado del contrato |
| `cotizacion_snapshot` | numeric(15,6) | si aplica |
| `error_message` | text null | si FAILED |
| `dry_run` | boolean default false | true = no crea factura, solo simula |
| `triggered_by` | enum `run_trigger_t` | `CRON`, `MANUAL`, `BACKFILL` |
| `triggered_by_user` | uuid FK auth.users(id) ON DELETE SET NULL | |
| `created_at` | timestamptz default now() | |

**UNIQUE clave de idempotencia:** `(contract_id, periodo, status) where status in ('OK','PENDIENTE')` — impide doble emisión del mismo período por el mismo contrato.

---

## 5 · `customer_accounts` — header de cuenta corriente

1 fila por cliente. Almacena métricas derivadas para queries rápidas. El saldo "real" en `customer_balances` view.

| Campo | Tipo | Notas |
|-------|------|-------|
| `client_id` | uuid PK FK clients(id) ON DELETE CASCADE | 1:1 con cliente |
| `credit_limit` | numeric(15,2) default 0 | límite de crédito; 0 = sin límite |
| `default_payment_term_id` | uuid FK payment_terms(id) NULL | term default para nuevas facturas (override del global) |
| `default_late_fee_rate` | numeric(6,4) NULL | tasa de mora % mensual; null = usar global |
| `late_fee_grace_days` | smallint default 0 | días de gracia post-vencimiento antes de cargar mora |
| `stop_billing` | boolean default false | true = motor recurrente skipea este cliente |
| `last_invoice_at` | timestamptz NULL | mantenido por trigger |
| `last_payment_at` | timestamptz NULL | mantenido por trigger |
| `last_balance_calc_at` | timestamptz NULL | última vez que se recalculó view |
| `notes` | text | |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | |

---

## 6 · `customer_transactions` — movimientos append-only

Tabla más crítica. Cada movimiento es una **fila inmutable** una vez `posted=true`. Audit-grade.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `client_id` | uuid FK clients(id) ON DELETE RESTRICT | |
| **`type`** | enum `customer_transaction_t` | `INVOICE`, `CREDIT_NOTE`, `DEBIT_NOTE`, `PAYMENT`, `ADJUSTMENT`, `LATE_FEE`, `REFUND` |
| `direction` | enum `direction_t` | `DEBIT` (deuda del cliente sube) o `CREDIT` (baja) — semántica explícita |
| `amount` | numeric(15,2) | siempre positivo; signo va por `direction` |
| `currency` | text default 'PES' | |
| `cotizacion` | numeric(15,6) default 1 | |
| `amount_pes` | numeric(15,2) | derivado: amount * cotizacion |
| `tx_date` | date | fecha del movimiento |
| `due_date` | date NULL | sólo para INVOICE / DEBIT_NOTE / LATE_FEE |
| `period` | text NULL | YYYY-MM, opcional para clasificación |
| **`source_table`** | text | `customer_invoices`, `customer_payments`, `late_fees`, `manual` |
| **`source_id`** | uuid | FK lógica al record origen |
| `applies_to_tx_id` | uuid FK customer_transactions(id) NULL | para PAYMENT/CREDIT_NOTE indicando a qué factura aplican (opcional, también via `customer_payment_applications`) |
| `description` | text | |
| `posted` | boolean default true | si false = pending review (uso futuro) |
| `voided` | boolean default false | anulación lógica |
| `voided_at` | timestamptz NULL | |
| `voided_reason` | text NULL | |
| `voided_by` | uuid FK auth.users(id) NULL | |
| `created_by` | uuid FK auth.users(id) NULL | |
| `created_at` | timestamptz default now() | append-only |

**Trigger guard:** una vez `posted=true`, NO se permite UPDATE de campos económicos. Sólo `voided=true` + razón. Pattern de `tg_lock_authorized_invoice`.

**UNIQUE para evitar duplicados:** `(source_table, source_id, type) where voided=false` — impide doble registro del mismo origen.

---

## 7 · `customer_payments` — header de cobro

Una cobranza puede pagar 0..N facturas. Permite recibos por cobro parcial, anticipos, mix de medios de pago.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `client_id` | uuid FK clients(id) ON DELETE RESTRICT | |
| `payment_date` | date | |
| `amount` | numeric(15,2) | monto total del recibo |
| `currency` | text default 'PES' | |
| `cotizacion` | numeric(15,6) default 1 | |
| `amount_pes` | numeric(15,2) | derivado |
| **`method`** | enum `payment_method_t` | `TRANSFERENCIA`, `CHEQUE`, `ECHEQ`, `EFECTIVO`, `TARJETA`, `MERCADOPAGO`, `OTRO` |
| `reference` | text | número de transferencia, cheque, etc. |
| `bank` | text NULL | banco origen si aplica |
| `receipt_path` | text NULL | path al comprobante en Drive |
| `unapplied_amount` | numeric(15,2) | monto del recibo no aplicado a ninguna factura (anticipo) |
| `status` | enum `payment_status_t` | `BORRADOR`, `CONFIRMADO`, `RECHAZADO`, `ANULADO` |
| `tx_id` | uuid FK customer_transactions(id) NULL | el movimiento PAYMENT generado |
| `notes` | text | |
| `created_by` | uuid FK auth.users(id) | |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | |

**Notas:**
- Cuando un payment se `CONFIRMADO`, se crea un `customer_transactions` PAYMENT con `amount = sum(applications) + unapplied_amount`.
- `payment_method_t` se diseña en FASE 1A pero **NO conecta con Tesorería todavía** (sólo registra). FASE 3 enlazará a `treasury_movements`.

---

## 8 · `customer_payment_applications` — M:N pagos↔facturas

Aplica un payment a una factura, parcial o total.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `payment_id` | uuid FK customer_payments(id) ON DELETE CASCADE | |
| `invoice_id` | uuid FK customer_invoices(id) ON DELETE RESTRICT | |
| `applied_amount` | numeric(15,2) | en moneda del payment |
| `applied_amount_pes` | numeric(15,2) | con cotización del pago |
| `applied_at` | timestamptz default now() | |
| `notes` | text | |

**Constraints:**
- `applied_amount > 0`
- `unique(payment_id, invoice_id)` — una aplicación por par
- Trigger de validación: `sum(applications.applied_amount) + payment.unapplied_amount == payment.amount`
- Trigger de validación: `sum(applications.applied_amount per invoice) <= invoice.total` (no sobrepagar)

---

## 9 · `late_fees` — cargos por mora

Doble propósito: catálogo de **reglas** + instancias de **aplicaciones**.

### 9.1 `late_fee_rules` (catálogo)

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `name` | text | "Mora estándar 3% mensual" |
| `rate_monthly` | numeric(6,4) | 0.03 = 3% mensual |
| `compounding` | enum `compounding_t` | `SIMPLE` o `COMPUESTO` |
| `grace_days` | smallint default 0 | días de gracia post-vencimiento antes de empezar a contar |
| `active` | boolean default true | |
| `is_default` | boolean | true en una sola fila |
| `created_at` | timestamptz default now() | |

### 9.2 `customer_late_fee_charges` (aplicaciones)

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `client_id` | uuid FK clients(id) ON DELETE CASCADE | |
| `invoice_id` | uuid FK customer_invoices(id) ON DELETE CASCADE | |
| `rule_id` | uuid FK late_fee_rules(id) ON DELETE RESTRICT | |
| `days_overdue` | int | cuántos días pasaron del vencimiento |
| `principal` | numeric(15,2) | saldo de factura sobre el que se calcula |
| `fee_amount` | numeric(15,2) | cargo calculado |
| `applied_at` | date | fecha en que se aplica el cargo |
| `period` | text | YYYY-MM cuando se devengó |
| `tx_id` | uuid FK customer_transactions(id) NULL | movimiento LATE_FEE generado |
| `notes` | text | |
| `created_at` | timestamptz default now() | |

**UNIQUE:** `(invoice_id, period)` — un solo cargo por mora por período por factura.

---

## 10 · `customer_balances` — view materializada

Saldo agregado real-time por cliente. **Vista** (no tabla) para reflejar transactions vivas sin lag.

**Pseudo-SQL:**

```sql
create or replace view public.customer_balances as
select
  ca.client_id,
  c.razon as client_name,
  ca.credit_limit,
  ca.stop_billing,

  -- Totales por dirección
  coalesce(sum(case when t.direction='DEBIT'  and not t.voided then t.amount_pes else 0 end), 0)
    as total_debit_pes,
  coalesce(sum(case when t.direction='CREDIT' and not t.voided then t.amount_pes else 0 end), 0)
    as total_credit_pes,

  -- Saldo = debit - credit
  coalesce(sum(case when t.direction='DEBIT'  and not t.voided then t.amount_pes
                    when t.direction='CREDIT' and not t.voided then -t.amount_pes
                    else 0 end), 0)
    as balance_pes,

  -- Buckets de mora
  coalesce(sum(case when t.type='INVOICE' and not t.voided
                    and t.due_date is not null
                    and t.due_date >= current_date - interval '30 days'
                    and t.due_date < current_date
                    then t.amount_pes else 0 end), 0)
    as overdue_30_pes,
  -- ... overdue_60_pes, overdue_90_pes, overdue_90_plus_pes

  -- KPIs MRR / ARR (sólo recurrentes activos)
  coalesce(sum(case when t.source_table='customer_invoices'
                    and t.period >= to_char(current_date, 'YYYY-MM')
                    then t.amount_pes else 0 end), 0)
    as mrr_pes_current_month,

  max(t.tx_date) filter (where t.type='PAYMENT' and not t.voided)
    as last_payment_at,
  max(t.tx_date) filter (where t.type='INVOICE' and not t.voided)
    as last_invoice_at

from public.customer_accounts ca
join public.clients c on c.id = ca.client_id
left join public.customer_transactions t on t.client_id = ca.client_id
group by ca.client_id, c.razon, ca.credit_limit, ca.stop_billing;
```

**Alternativa materialized view** si performance no alcanza: refresh por trigger o cron.

---

## 11 · Convenciones de tipo + naming

| Convención | Aplicación |
|------------|------------|
| `numeric(15,2)` para ARS | importes |
| `numeric(15,4)` para tasas | precio_unitario USD/m² con 4 decimales |
| `numeric(6,4)` para porcentajes | rate_monthly (`0.0300` = 3%) |
| `text` para `period` | formato `YYYY-MM` (string compatible con ARCA) |
| `enum` para estados | tipados estrictos |
| `uuid` para PKs nuevos | excepto `payment_terms.code` que también es key humana |
| `timestamptz default now()` | `created_at`/`updated_at` |
| `xxx_id` para FKs | snake_case consistente con migraciones existentes |
| Append-only via trigger | `customer_transactions.posted=true` lock |

---

## 12 · Resumen de enums a crear en 0014

```
recurring_freq_t              = MENSUAL | TRIMESTRAL | SEMESTRAL | ANUAL
recurring_contract_status_t   = BORRADOR | ACTIVO | PAUSADO | FINALIZADO | CANCELADO
recurring_line_category_t     = ALMACENAJE_ANMAT | ALMACENAJE_GRAL | OFICINA | COWORK | ABONO | OTRO
recurring_run_status_t        = PENDIENTE | OK | FAILED | SKIPPED | MANUAL_OVERRIDE
run_trigger_t                 = CRON | MANUAL | BACKFILL
customer_transaction_t        = INVOICE | CREDIT_NOTE | DEBIT_NOTE | PAYMENT | ADJUSTMENT | LATE_FEE | REFUND
direction_t                   = DEBIT | CREDIT
payment_method_t              = TRANSFERENCIA | CHEQUE | ECHEQ | EFECTIVO | TARJETA | MERCADOPAGO | OTRO
payment_status_t              = BORRADOR | CONFIRMADO | RECHAZADO | ANULADO
compounding_t                 = SIMPLE | COMPUESTO
```

**Nota:** `payment_method_t` se crea en 0014 pero FASE 3 (Tesorería) lo va a expandir / reemplazar con sus propios métodos. La separación es intencional — FASE 1A registra cobros sin tesorería.

---

## 13 · Decisiones de diseño explícitas

| Decisión | Opción elegida | Alternativa descartada |
|----------|---------------|------------------------|
| Saldo real-time | View `customer_balances` | tabla `customer_accounts.balance` con trigger — más rápido pero riesgo de drift |
| Movimientos | Append-only en `customer_transactions` | Update mutable — pierde auditoría |
| Aplicación pago↔factura | Tabla M:N `customer_payment_applications` | Inline en payment — no permite mix multi-factura |
| Identificación del período | text `YYYY-MM` | int o date — texto es compatible con ARCA + flexible para trimestral `YYYY-Q1` |
| Currency en USD para contratos | Sí (con cotización al emitir) | obligar PES — pierde realidad del negocio TOPS |
| Late fees como tabla separada | Sí | columnas en `customer_invoices` — rompe encapsulación |
| Trigger lock en transactions | Sí (mismo pattern que invoices) | sin lock — riesgo de tampering |
| Snapshot del receptor en factura | Sí (reutiliza patrón actual) | live join — pierde verdad histórica |
| Numeración de contratos | `code` text human-readable | UUID + alias — perdemos UX |

---

## 14 · Lo que NO entra en este modelo (FASE 1A)

- **Conexión a Tesorería** (treasury_movements) → FASE 3
- **Conexión a Contabilidad** (journal_entries automáticos) → FASE 4
- **Indexación por inflación** (ajustes IPC, dólar de pago) → flag `apply_indexacion` queda en `recurring_contract_lines` pero motor lo ignora hasta FASE futura
- **Reportes IVA libros** → FASE 4
- **Cobranza automatizada** (emails recordatorios, links de pago) → FASE 1B opcional
- **Portal de cliente self-service** → fuera de scope

---

## 15 · Cardinalidades resumen

```
clients (1) ─── (1) customer_accounts
clients (1) ─── (N) recurring_contracts
clients (1) ─── (N) customer_invoices         [ya existe]
clients (1) ─── (N) customer_transactions
clients (1) ─── (N) customer_payments
clients (1) ─── (N) customer_late_fee_charges

recurring_contracts (1) ─── (N) recurring_contract_lines
recurring_contracts (1) ─── (N) recurring_runs
recurring_contracts (1) ─── (N) customer_invoices    (via invoice metadata)

customer_invoices (1) ─── (N) invoice_items          [ya existe]
customer_invoices (1) ─── (1) customer_transactions  (type=INVOICE)
customer_invoices (1) ─── (N) customer_payment_applications

customer_payments (1) ─── (N) customer_payment_applications
customer_payments (1) ─── (1) customer_transactions  (type=PAYMENT)

late_fee_rules (1) ─── (N) customer_late_fee_charges
customer_late_fee_charges (1) ─── (1) customer_transactions  (type=LATE_FEE)
```

Diagrama formal de FK en `FASE-1A-RELATIONS.md`.

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR — diseño puro
- 🛑 NO SQL ejecutable (signatures + descripciones)
- 🛑 NO TOCAR tablas existentes
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
