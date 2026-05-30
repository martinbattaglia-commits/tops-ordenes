# FASE 1B · MODULES — Especificación por módulo

> ⚠️ **AMENDMENT APLICADO 2026-05-29 — MONEDA ARS ÚNICA**
> Las secciones de este documento que mencionan **moneda USD contractual, cotización, exchange-rate, BCRA** quedan **superseded** por `docs/erp/FASE-1B-AMENDMENT-ARS-ONLY.md`.
> - Módulo `exchange-rate/` → **ELIMINADO**
> - Campos `currency`, `cotizacion_source`, `cotizacion_fija`, `cotizacion_snapshot` → **ELIMINADOS** (todo es ARS)
> - Wizard contratos sin selector de moneda (paso 3 simplificado)
> - Total módulos: 9 (no 10)
> Resto del documento sigue vigente.

**Scope:** descomposición técnica de `src/lib/billing/` + `src/app/(app)/billing/*` + integraciones.
**Estado:** diseño detallado · sin código.
**Base:** docs aprobados FASE 1A + definiciones funcionales aprobadas (catálogo terms, cron 09:00 ART día 1, mora 3% mensual, ~~USD contractual~~ **ARS único** vía AMENDMENT, etc.) + requerimientos nuevos (oficinas multi-tipo, almacenaje m²/m³, **facturación directa obligatoria**).

---

## 0 · Ajustes al modelo de datos FASE 1A → V1.1

Las definiciones aprobadas introducen los siguientes cambios menores al modelo de `FASE-1A-DATA-MODEL.md`:

### 0.1 Enum `recurring_line_category_t` ampliado

```
recurring_line_category_t = 
  ALMACENAJE_ANMAT     -- por m² o m³ según contrato
  ALMACENAJE_GRAL      -- por m² o m³ según contrato
  OFICINA_PRIVADA      -- abono fijo mensual
  OFICINA_COWORKING    -- abono fijo mensual
  OFICINA_TEMPORAL     -- período definido (start/end_date del contrato)
  ABONO                -- abono genérico
  OTRO
```

### 0.2 `recurring_contract_lines.unidad` — ampliar valores válidos

Texto libre con validación a nivel app contra catálogo:
- `'mes'` — abono fijo
- `'m2'` — almacenaje superficie
- `'m3'` — almacenaje volumen ← **NUEVO requerimiento**
- `'unidad'` — pieza
- `'puesto'` — coworking
- `'hora'` — futuros servicios por hora

### 0.3 Nueva tabla `exchange_rates_log` (cotización auditada y persistida)

```
exchange_rates_log
├── id uuid PK
├── source        text   -- 'BCRA_OFICIAL' | 'BCRA_MAYORISTA' | 'FIJO' | 'MANUAL'
├── currency_from text   -- 'USD'
├── currency_to   text   -- 'ARS'
├── rate          numeric(15,6)
├── fetched_at    timestamptz default now()
├── valid_for_date date   -- fecha a la que aplica la cotización
├── fetched_by    uuid FK auth.users(id) null
├── raw_response  jsonb  -- response crudo del proveedor (BCRA API) para auditoría
├── used_in_count int default 0  -- cuántos runs la usaron (mantenido por trigger)
└── created_at    timestamptz default now()
```

**Propósito:** cumplir la directiva "la cotización utilizada debe quedar auditada y persistida". `recurring_runs.cotizacion_snapshot` y `customer_invoices.cotizacion` siguen siendo el snapshot inmutable; este log es el **registro histórico de fuente**.

UNIQUE: `(source, valid_for_date)` — una sola cotización válida por fuente por día.

### 0.4 Constraint nuevo: tolerancia ARS 100

A nivel código (no SQL) — el motor recurrente, al calcular total, si `total < 100 ARS` → no genera factura, dispara alerta administrativa.

### 0.5 Flag `auto_emit` semántica final

Una sola booleana en `recurring_contracts.auto_emit`:
- `false` (default) → factura va a `BORRADOR`, requiere aprobación de Ruth en `/billing/recurrentes/aprobaciones`
- `true` → factura va directo a ARCA (`PENDIENTE_ARCA → AUTORIZADO_ARCA`)

**Aprobadora obligatoria:** Ruth Carrasquero. Implementación:
- `customer_invoices.emitido_por` registra el usuario que aprobó/emitió
- Para `auto_emit=false`: si quien aprueba no es Ruth, el flujo registra warn pero permite (admin puede aprobar en su ausencia)
- Para `auto_emit=true`: campo `emitido_por` registra "system" + reference al `recurring_runs.id`

---

## 1 · Mapa de módulos backend (`src/lib/billing/`)

```
src/lib/billing/
├── index.ts                          (re-exports públicos)
├── types.ts                          (DTOs + interfaces TS)
├── format.ts                         (fmtCurrency, fmtPeriod, fmtRate)
├── storage.ts                        (buildReceiptPath, buildContractPath)
├── errors.ts                         (BillingError class + códigos)
├── logger.ts                         (logBilling structured)
│
├── terms/                            ← Catálogo condiciones de pago
│   ├── data.ts                       CRUD payment_terms
│   ├── calc.ts                       buildDueDates(term, fechaEmision) → [{due_date, amount_pct}]
│   └── validation.ts                 zod schemas
│
├── recurring/                        ← Motor recurrente
│   ├── engine.ts                     runContract(contractId, opts) — pieza central
│   ├── scheduler.ts                  runScheduledBatch() — entrypoint del cron
│   ├── period-calculator.ts          calcNext(currentPeriod, freq) + calcServiceDates
│   ├── validation.ts                 zod schemas + business rules
│   ├── data.ts                       CRUD contratos + lines + runs
│   └── notify.ts                     notifica resultado a Ruth + JL
│
├── invoices-direct/                  ← Facturación directa (NUEVO obligatorio)
│   ├── emit.ts                       emite factura sin OS ni contrato
│   ├── from-order.ts                 emite desde OS existente (reutiliza orders.invoice_id)
│   ├── from-contract.ts              wrapper sobre recurring/engine para emisión manual ad-hoc
│   └── validation.ts
│
├── accounts/                         ← Cuenta corriente cliente
│   ├── balance.ts                    queries sobre view customer_balances
│   ├── transactions.ts               append-only inserts + voiding
│   ├── data.ts                       CRUD customer_accounts
│   └── reconcile.ts                  detectar discrepancias balance vs sum(transactions)
│
├── payments/                         ← Cobros
│   ├── data.ts                       CRUD customer_payments + applications
│   ├── auto-apply.ts                 FIFO / LIFO / manual
│   ├── validation.ts                 zod + business rules (suma ≤ amount)
│   └── confirm.ts                    transición BORRADOR → CONFIRMADO con tx insert
│
├── late-fees/                        ← Mora
│   ├── calculator.ts                 calcSimple, calcCompuesto
│   ├── cron.ts                       runDailyLateFeesBatch()
│   ├── data.ts                       CRUD late_fee_rules + charges
│   └── notify.ts                     alerta admin si mora > umbral
│
├── exchange-rate/                    ← Cotización auditada (NUEVO)
│   ├── bcra-client.ts                fetch BCRA API + persiste log
│   ├── cache.ts                      get latest valid para hoy
│   ├── data.ts                       CRUD exchange_rates_log
│   └── fallback.ts                   si BCRA falla → cotizacion_fija
│
├── alerts/                           ← Alertas administrativas
│   ├── data.ts                       CRUD admin_alerts (tabla simple opcional o solo email)
│   └── send.ts                       Resend email + log
│
└── rbac.ts                           requireBillingPermission(req, slug, requestId)
                                       espejo de requireDrivePermission del R22 closure
```

---

## 2 · Módulo: `terms/` — Catálogo condiciones de pago

### 2.1 Responsabilidad

CRUD del catálogo + cálculo de fechas de vencimiento según el `payment_term` aplicado.

### 2.2 Contrato principal

```ts
// terms/calc.ts
export interface DueDateSlice {
  installment: number      // 1, 2, 3 ...
  due_date: string         // YYYY-MM-DD
  pct: number              // 50.00
  amount: number           // calculado del total
}

export function buildDueDates(
  term: PaymentTerm,
  fechaEmision: Date,
  totalAmount: number
): DueDateSlice[]
```

**Reglas:**
- `is_split=false` → 1 slice con `due_date = fechaEmision + default_days_to_due`
- `is_split=true` → N slices según `splits` jsonb, sumando 100% (validar)
- Custom: si `code='CUSTOM'`, el caller pasa `splits` inline

### 2.3 Catálogo aprobado seed

| code | name | days/splits |
|------|------|-------------|
| `CASH` | Contado | 0 días |
| `D7` | 7 días | 7 |
| `D15` | 15 días | 15 |
| `D30` | 30 días | 30 |
| `D60` | 60 días | 60 |
| `D90` | 90 días | 90 |
| `D30_60` | 30/60 días | 50% a 30d + 50% a 60d |
| `D30_60_90` | 30/60/90 días | 33.33/33.33/33.34 a 30/60/90 |

### 2.4 API públicos

- `listPaymentTerms(opts?: { includeInactive?: boolean })`
- `getPaymentTerm(code: string)`
- `createPaymentTerm(input)` — admin only
- `updatePaymentTerm(id, input)` — admin only
- `deactivatePaymentTerm(id)` — admin only (sistema seeds no editables)

---

## 3 · Módulo: `recurring/` — Motor recurrente

### 3.1 Responsabilidad

Generar facturas periódicamente para contratos `ACTIVO`, respetando idempotencia, tolerancia de saldo, auto_emit flag, aprobación obligatoria de Ruth.

### 3.2 Contratos principales

```ts
// recurring/engine.ts
export interface RunOptions {
  triggeredBy: 'CRON' | 'MANUAL' | 'BACKFILL'
  dryRun?: boolean
  periodOverride?: string           // 'YYYY-MM' para forzar período
  userId?: string                   // si MANUAL
}

export interface RunResult {
  runId: string
  status: 'OK' | 'FAILED' | 'SKIPPED'
  invoiceId?: string
  totalEstimado: number
  totalEmitido: number              // en ARS
  cotizacionSnapshot: number
  exchangeRateLogId?: string        // FK a exchange_rates_log
  errorMessage?: string
  skipReason?: SkipReason
}

export type SkipReason =
  | 'CONTRACT_NOT_ACTIVE'
  | 'NO_ACTIVE_LINES'
  | 'CLIENT_STOP_BILLING'
  | 'OUT_OF_DATE_RANGE'
  | 'BELOW_TOLERANCE_ARS_100'        // tolerancia aprobada
  | 'ALREADY_RUN_FOR_PERIOD'         // idempotencia

export async function runContract(
  contractId: string,
  opts: RunOptions
): Promise<RunResult>
```

### 3.3 Flujo interno de `runContract()`

```
1. Validar contractId existe + tipo
2. Calcular periodo (de opts.periodOverride o contract.next_run_date)
3. Lock idempotencia:
   INSERT INTO recurring_runs (contract_id, periodo, status='PENDIENTE',
                                triggered_by, triggered_by_user, dry_run)
   ON CONFLICT (contract_id, periodo) WHERE status IN ('OK','PENDIENTE')
   DO NOTHING RETURNING id
   → si no retorna id, ya hay un run → return SKIPPED reason='ALREADY_RUN_FOR_PERIOD'
4. Validaciones de negocio (devuelven SKIPPED):
   - contract.status !== 'ACTIVO' → CONTRACT_NOT_ACTIVE
   - active_lines.length === 0 → NO_ACTIVE_LINES
   - customer_accounts.stop_billing → CLIENT_STOP_BILLING
   - period fuera de [start_date, end_date] → OUT_OF_DATE_RANGE
5. Obtener cotización:
   - Si contract.currency === 'PES' → cotizacion = 1
   - Si 'USD':
     - Si contract.cotizacion_source === 'FIJO' → contract.cotizacion_fija
     - Si 'BCRA_OFICIAL' → exchange-rate/bcra-client.fetchToday()
       - Si falla → fallback a cotizacion_fija si existe, sino → FAILED
   - Persistir en exchange_rates_log (o reusar la del día) → guardar exchangeRateLogId
6. Calcular total estimado (lib/invoicing/calc + iterate lines):
   - cada line: subtotal = cantidad * precio_unitario
   - total = sum(subtotales) en moneda contrato
   - total_ars = total * cotizacion
7. Si total_ars < 100 → SKIPPED reason='BELOW_TOLERANCE_ARS_100' + log alert admin
8. Si dryRun → update run status=OK, return preview
9. Crear customer_invoices BORRADOR:
   - Snapshot del receptor (client.razon_social, cuit, condicion_iva, etc.)
   - Tipo comprobante: lib/invoicing/calc.resolveTipoComprobante(client, fiscal_config)
   - Items: 1 invoice_item por recurring_contract_line activa
   - periodo, fch_serv_desde, fch_serv_hasta
   - observ con tag: '[CONTRATO:<code>][RUN:<run_id>]'
10. Si contract.auto_emit === true:
    a. lib/invoicing/emit.emitInvoiceToArca(invoice_id)
    b. Si ERROR ARCA → update run FAILED + invoice estado_arca=ERROR_ARCA
    c. Si OK → invoice estado_arca=AUTORIZADO_ARCA, CAE asignado
11. Insertar customer_transactions:
    INSERT (client_id, type='INVOICE', direction='DEBIT',
            amount=total_ars, source_table='customer_invoices', source_id=invoice_id,
            due_date=first_due_date_from_payment_term, period=periodo,
            posted=true)
12. Update recurring_runs status=OK, invoice_id=invoice.id, totales, cotización snapshot
13. Update recurring_contracts.next_run_date = period-calculator.calcNext(periodo, frequency)
14. Update recurring_contracts.last_run_at = now()
15. Notificar (recurring/notify.ts):
    - Si auto_emit y OK → email Ruth con resumen
    - Si BORRADOR pendiente aprobación → email Ruth + link
    - Si FAILED → email Ruth + JL urgente
16. return RunResult
```

### 3.4 `scheduler.ts` — Cron entrypoint

```ts
export async function runScheduledBatch(req: Request): Promise<BatchResult> {
  // 1. Validar header secret de Netlify Scheduled Function
  //    if (req.headers.get('X-Netlify-Scheduled-Function') !== expected) → 401
  // 2. Detectar contratos due:
  //    SELECT id FROM recurring_contracts
  //    WHERE status='ACTIVO' AND next_run_date <= current_date
  // 3. Para cada contractId:
  //    try { result = await runContract(id, {triggeredBy:'CRON'}) }
  //    catch (e) { result = {status:'FAILED', errorMessage: e.message} }
  //    results.push(result)
  // 4. Summary email a Ruth + JL:
  //    - X facturas OK
  //    - Y SKIPPED (con razones agregadas)
  //    - Z FAILED (con detalle de cada uno)
  // 5. log estructurado completo
  // 6. return BatchResult
}
```

### 3.5 `period-calculator.ts`

```ts
export function calcNextRunDate(currentDate: Date, freq: RecurringFreq, billingDay: number): Date
export function calcServiceDates(periodo: string, freq: RecurringFreq): {desde: string, hasta: string}
export function periodToString(date: Date, freq: RecurringFreq): string  // 'YYYY-MM' | 'YYYY-Q1' | etc.
```

Lógica:
- `MENSUAL` + billingDay=1 → próximo día 1 del mes siguiente
- `TRIMESTRAL` → cada 3 meses
- `SEMESTRAL` → cada 6 meses
- `ANUAL` → cada 12 meses
- Edge case: si billingDay=31 y mes tiene 30 días → usar último día del mes

---

## 4 · Módulo: `invoices-direct/` — Facturación directa (NUEVO OBLIGATORIO)

### 4.1 Responsabilidad

Permitir emisión de facturas independiente del motor recurrente y de las órdenes de servicio. Cubre 3 orígenes:
1. Manual (operador carga cliente + ítems libres)
2. Desde OS (ya existente vía `orders.invoice_id` — solo wrapper)
3. Desde contrato (manual one-off del recurring sin esperar cron)

### 4.2 Contrato API

```ts
// invoices-direct/emit.ts
export interface DirectInvoiceInput {
  client_id: string
  payment_term_id: string
  tipo_comprobante?: ComprobanteTipo  // si no se da, se calcula del client.condicion_iva
  punto_venta: number
  concepto: 1 | 2 | 3                 // 1 prod, 2 serv, 3 ambos
  fch_serv_desde?: string             // requerido si concepto in [2,3]
  fch_serv_hasta?: string
  periodo?: string                    // 'YYYY-MM' opcional
  currency: 'PES' | 'USD'
  cotizacion_source: 'BCRA_OFICIAL' | 'FIJO' | 'MANUAL'
  cotizacion_manual?: number          // si MANUAL
  items: Array<{
    descripcion: string
    cantidad: number
    precio_unitario: number
    alicuota_iva: number
    unidad?: string                   // m2, m3, mes, etc.
  }>
  observ?: string
  emit_to_arca?: boolean              // default false → queda BORRADOR
}

export interface DirectInvoiceResult {
  invoice_id: string
  estado_arca: InvoiceArcaStatus
  total_ars: number
  cae?: string
  exchange_rate_log_id?: string
}

export async function emitDirectInvoice(
  input: DirectInvoiceInput,
  userId: string
): Promise<DirectInvoiceResult>
```

### 4.3 Flujo

```
1. Validar input con zod (todos los campos requeridos según concepto)
2. Validar payment_term existe y está activo
3. Resolver tipo_comprobante:
   - Si no provisto → lib/invoicing/calc.resolveTipoComprobante(client, fiscal_config)
   - Si provisto → validar coherencia con condicion_iva del cliente
4. Obtener cotización:
   - Si currency='PES' → 1
   - Si 'USD':
     - cotizacion_source='MANUAL' → cotizacion_manual (requerido)
     - 'FIJO' → tomar del fiscal_config o config global
     - 'BCRA_OFICIAL' → exchange-rate/bcra-client.fetchToday()
   - Persistir en exchange_rates_log
5. Calcular totales con lib/invoicing/calc
6. Crear customer_invoices BORRADOR
   - Snapshot del receptor
   - Items insertados como invoice_items
   - observ con tag '[DIRECT][BY:<userId>]'
7. Si emit_to_arca=true:
   - lib/invoicing/emit.emitInvoiceToArca(invoice_id) → CAE
8. Insertar customer_transactions INSERT type=INVOICE
9. Aplicar payment_term: insertar 1 transaction por slice de venc si is_split
   (alternativa: 1 transaction única con due_date = primera slice; el resto se trackea como tags)
10. return result
```

### 4.4 Diferencia con el motor recurrente

| Aspecto | Recurring engine | Direct invoice |
|---------|------------------|----------------|
| Origen | Contrato + cron | Llamada API directa |
| Idempotencia | UNIQUE (contract, period) | No (cada emisión es independiente) |
| Items | De `recurring_contract_lines` | Inline en input |
| Cotización | Snapshot por run | Snapshot por emisión |
| Aprobación | Ruth si auto_emit=false | Siempre operador (input.emit_to_arca controla) |
| Tag observ | `[CONTRATO:<code>]` | `[DIRECT][BY:<user>]` |
| Reporting | Aparece en `recurring_runs` | Aparece sólo en `customer_invoices` |

### 4.5 UI cliente

- `/billing/directa/nueva` — wizard 4 steps (Cliente, Conceptos, Vencimiento, Confirmación)
- Botón `+ Nueva Factura Directa` en tab "Emitidas" del `/billing` shell
- Acceso desde `/billing/clientes/[id]` con cliente pre-seleccionado

### 4.6 Wrappers

```ts
// invoices-direct/from-order.ts
export async function emitInvoiceFromOrder(orderId: string, userId: string): Promise<DirectInvoiceResult>
// → mapea order.services a items + cliente del order + emite

// invoices-direct/from-contract.ts
export async function emitInvoiceAdHocFromContract(
  contractId: string,
  periodOverride: string,
  userId: string
): Promise<DirectInvoiceResult>
// → wrapper sobre recurring/engine.runContract({triggeredBy:'MANUAL'})
```

---

## 5 · Módulo: `accounts/` — Cuenta corriente

### 5.1 Responsabilidad

Exponer saldo + movimientos + reconciliación. Insertar transactions de forma controlada.

### 5.2 Contratos

```ts
export async function getCustomerBalance(clientId: string): Promise<CustomerBalance>
export async function listCustomerTransactions(
  clientId: string,
  opts: { from?: string, to?: string, type?: CustomerTransactionType, page?: number }
): Promise<TransactionListResult>
export async function insertTransaction(input: InsertTransactionInput): Promise<Transaction>
export async function voidTransaction(txId: string, reason: string, userId: string): Promise<Transaction>
export async function reconcileBalance(clientId: string): Promise<ReconcileResult>
```

### 5.3 `reconcile.ts`

Detecta drift entre `customer_balances.balance_pes` (view) y `sum(transactions where not voided)`. Si difiere → log error + alerta admin. Útil para detectar bugs en triggers.

### 5.4 Inserts controlados

`insertTransaction()` valida:
- `source_table in ('customer_invoices','customer_payments','customer_late_fee_charges','manual')`
- Si `source_table !== 'manual'` → `source_id` requerido + verificar exists
- Si type=PAYMENT y applies_to_tx_id → verificar es type=INVOICE
- Si type=ADJUSTMENT y manual → requerir `created_by` y `description`

---

## 6 · Módulo: `payments/` — Cobros

### 6.1 Responsabilidad

CRUD cobros + aplicación a facturas + auto-FIFO.

### 6.2 Contratos

```ts
export async function createPayment(input: CreatePaymentInput): Promise<Payment>
export async function confirmPayment(paymentId: string, userId: string): Promise<Payment>
// → status BORRADOR → CONFIRMADO + insert customer_transactions type=PAYMENT

export async function applyToInvoice(
  paymentId: string,
  invoiceId: string,
  amount: number
): Promise<PaymentApplication>

export async function autoApplyFIFO(paymentId: string): Promise<PaymentApplication[]>
// → aplica a facturas más viejas pendientes hasta agotar amount o facturas

export async function voidPayment(paymentId: string, reason: string, userId: string): Promise<Payment>
// → status → ANULADO + inserta ADJUSTMENT DEBIT por mismo monto

export async function getUnappliedBalance(clientId: string): Promise<number>
// → suma de payments.unapplied_amount del cliente
```

### 6.3 Auto-FIFO

```
1. Buscar facturas pendientes del cliente:
   SELECT i.* FROM customer_invoices i
   WHERE i.client_id = payment.client_id
     AND i.estado_arca = 'AUTORIZADO_ARCA'
     AND NOT i.anulada
   ORDER BY i.fch_vto_pago ASC, i.created_at ASC
2. Para cada factura, calcular pendiente:
   pendiente = i.total - sum(applications.applied_amount)
3. Iterar:
   - amount_to_apply = min(remaining_payment, pendiente)
   - INSERT customer_payment_applications (payment_id, invoice_id, amount_to_apply)
   - remaining_payment -= amount_to_apply
   - si remaining_payment == 0 → break
4. payment.unapplied_amount = remaining_payment
5. return applications
```

---

## 7 · Módulo: `late-fees/` — Mora

### 7.1 Responsabilidad

Cron diario que detecta facturas vencidas + aplica regla configurada por cliente (o default 3% mensual).

### 7.2 `calculator.ts`

```ts
export function calcLateFee(opts: {
  principal: number              // saldo pendiente de la factura
  daysOverdue: number
  rateMonthly: number            // 0.03 = 3%
  compounding: 'SIMPLE' | 'COMPUESTO'
}): number {
  if (compounding === 'SIMPLE') {
    // fee = principal * rateMonthly * (daysOverdue / 30)
    return Math.round(principal * rateMonthly * (daysOverdue / 30) * 100) / 100
  } else {
    // compuesto mensual
    const months = daysOverdue / 30
    return Math.round((principal * (Math.pow(1 + rateMonthly, months) - 1)) * 100) / 100
  }
}
```

### 7.3 `cron.ts` — Daily batch

```ts
export async function runDailyLateFeesBatch(req: Request): Promise<LateFeesResult> {
  // 1. Validar Netlify scheduled secret
  // 2. Resolver regla por cliente:
  //    - customer_accounts.default_late_fee_rate si está
  //    - else: late_fee_rules where is_default=true
  // 3. Para cada cliente con default_late_fee_rate o si hay default global:
  //    a. Buscar facturas vencidas:
  //       SELECT i.id, i.total, sum(apps.applied_amount) as paid, i.fch_vto_pago
  //       FROM customer_invoices i
  //       LEFT JOIN customer_payment_applications apps ON apps.invoice_id=i.id
  //       WHERE i.client_id = X
  //         AND i.estado_arca='AUTORIZADO_ARCA' AND NOT i.anulada
  //         AND i.fch_vto_pago < current_date - rule.grace_days
  //       GROUP BY i.id
  //       HAVING (i.total - coalesce(sum, 0)) > 0
  //    b. Para cada factura morosa:
  //       - daysOverdue = current_date - fch_vto_pago
  //       - principal = total - paid
  //       - period = current YYYY-MM
  //       - Si ya hay charge para (invoice_id, period) → SKIP (UNIQUE)
  //       - fee = calcLateFee(...)
  //       - INSERT customer_late_fee_charges
  //       - INSERT customer_transactions type=LATE_FEE direction=DEBIT
  //       - source_table='customer_late_fee_charges', source_id=charge_id
  // 4. Notificar Ruth con resumen
  // 5. return result
}
```

Cron: `0 7 * * *` (07:00 ART todos los días).

---

## 8 · Módulo: `exchange-rate/` — Cotización auditada (NUEVO)

### 8.1 Responsabilidad

Obtener cotización USD/ARS, persistir log auditable, fallback a cotización fija.

### 8.2 `bcra-client.ts`

```ts
const BCRA_USD_OFICIAL_URL = 'https://api.bcra.gob.ar/estadisticas/v2.0/PrincipalesVariables'

export async function fetchBcraOficial(forDate?: Date): Promise<{
  rate: number
  rawResponse: unknown
} | null> {
  // GET BCRA API
  // Parse "Tipo de Cambio Mayorista" o "Oficial"
  // Return rate + raw response
  // Return null si falla
}
```

### 8.3 `cache.ts`

```ts
export async function getRateForDate(
  date: Date,
  source: 'BCRA_OFICIAL' | 'BCRA_MAYORISTA'
): Promise<ExchangeRateLog> {
  // 1. SELECT FROM exchange_rates_log WHERE valid_for_date=date AND source=source LIMIT 1
  // 2. Si existe → return
  // 3. Si no → fetch BCRA + INSERT log
  // 4. Si fetch falla → throw (caller decide fallback)
}
```

### 8.4 `fallback.ts`

```ts
export function resolveCotizacion(
  contractCotizacionSource: string,
  contractCotizacionFija: number | null,
  date: Date
): Promise<{ rate: number, source: string, logId?: string }> {
  // Si source='FIJO' → return (contractCotizacionFija, 'FIJO', null)
  // Si source='BCRA_OFICIAL':
  //   try cache.getRateForDate → return con logId
  //   catch:
  //     si contractCotizacionFija → return (cotizacionFija, 'FALLBACK_FIJO', null) + log warn
  //     sino → throw BillingError 'EXCHANGE_RATE_UNAVAILABLE'
}
```

---

## 9 · Módulo: `alerts/` — Alertas administrativas

### 9.1 Casos de alerta (FASE 1A aprobada)

| Trigger | Destinatario | Severidad | Canal |
|---------|--------------|-----------|-------|
| Total recurrente < ARS 100 (tolerancia) | Ruth | info | email |
| Run FAILED | Ruth + JL | high | email |
| Cliente entra en stop_billing | Ruth + JL | high | email |
| Cliente supera credit_limit | Ruth | medium | email |
| Saldo discrepante en reconcile | Ruth + JL | critical | email |
| Cotización BCRA caída | Ruth | high | email |
| Mora cron generó cargos > $X | Ruth | info | email diario summary |

### 9.2 Implementación

Reutiliza `src/lib/email.ts` (Resend ya integrado). Template MJML por tipo de alerta. Persistencia opcional en tabla `admin_alerts` para historial.

---

## 10 · Módulo: `rbac.ts`

Helper `requireBillingPermission()` — espejo de `requireDrivePermission()` (R22 closure):

```ts
import { checkPermission } from "@/lib/rbac/check"

export async function requireBillingPermission(
  req: NextRequest,
  permission: string,           // 'billing.view', 'billing.create', etc.
  requestId: string
): Promise<NextResponse | PermissionCheckOk> {
  // Mismo pattern que requireDrivePermission
}
```

Permission slugs (de FASE-1A-RLS.md §4):
- `billing.view`
- `billing.create`
- `billing.recurring.manage`
- `billing.recurring.run`
- `billing.payments.register`
- `billing.payments.apply`
- `billing.late_fees.manage`
- `billing.adjustments.create`
- `billing.delete`

---

## 11 · Mapa de módulos frontend (`src/app/(app)/billing/`)

```
billing/
├── page.tsx                          (shell con tabs + KPIs top)
├── layout.tsx                        (compartido del (app) layout)
│
├── emitidas/
│   ├── page.tsx                      lista actual con filtros
│   └── [id]/page.tsx                 detalle factura existente
│
├── directa/
│   ├── nueva/page.tsx                wizard 4 steps facturación directa
│   └── actions.ts
│
├── recurrentes/
│   ├── page.tsx                      lista contratos
│   ├── nuevo/page.tsx                wizard 5 steps contrato
│   ├── aprobaciones/page.tsx         BORRADORES pendientes Ruth
│   ├── [id]/
│   │   ├── page.tsx                  detalle con tabs
│   │   ├── editar/page.tsx
│   │   └── actions.ts
│   └── actions.ts
│
├── clientes/
│   ├── page.tsx                      lista con saldos
│   ├── [clientId]/page.tsx           CC detalle
│   └── actions.ts
│
├── cobros/
│   ├── page.tsx                      lista
│   ├── nuevo/page.tsx                wizard 3 steps
│   ├── [id]/page.tsx                 detalle + applications
│   └── actions.ts
│
├── vencimientos/
│   └── page.tsx                      buckets de morosidad
│
└── config/                           (subset de /settings/facturacion)
    ├── condiciones-pago/page.tsx     CRUD payment_terms
    ├── mora/page.tsx                 CRUD late_fee_rules + por cliente
    └── puntos-venta/page.tsx         CRUD puntos_venta (link a /settings)
```

---

## 12 · Componentes UI nuevos (catálogo definitivo)

| Componente | Ubicación | Reúsa |
|------------|-----------|-------|
| `<BillingShell>` | `components/billing/Shell.tsx` | layout + tabs |
| `<BillingTopKpis>` | `components/billing/TopKpis.tsx` | KPI cards |
| `<RecurringContractWizard>` | `components/billing/RecurringContractWizard.tsx` | pattern NewPoWizard |
| `<RecurringLineEditor>` | `components/billing/RecurringLineEditor.tsx` | tabla editable inline |
| `<DirectInvoiceWizard>` | `components/billing/DirectInvoiceWizard.tsx` | similar a NewPoWizard |
| `<CustomerAccountSummary>` | `components/billing/CustomerAccountSummary.tsx` | hero card |
| `<AgedReceivablesTable>` | `components/billing/AgedReceivablesTable.tsx` | tabla |
| `<TransactionLedger>` | `components/billing/TransactionLedger.tsx` | append-only tabla |
| `<PaymentWizard>` | `components/billing/PaymentWizard.tsx` | wizard |
| `<PaymentApplicationTable>` | `components/billing/PaymentApplicationTable.tsx` | tabla apply |
| `<DueDateBucket>` | `components/billing/DueDateBucket.tsx` | cards por bucket |
| `<RunStatusTimeline>` | `components/billing/RunStatusTimeline.tsx` | timeline |
| `<MRRWidget>` | `components/billing/widgets/MRRWidget.tsx` | KPI cockpit |
| `<FacturacionMesWidget>` | `components/billing/widgets/FacturacionMesWidget.tsx` | KPI |
| `<CobranzaPendienteWidget>` | `components/billing/widgets/CobranzaPendienteWidget.tsx` | KPI |
| `<ClientesMorososWidget>` | `components/billing/widgets/ClientesMorososWidget.tsx` | KPI con pattern Compliance Engine |
| `<ExchangeRateBadge>` | `components/billing/ExchangeRateBadge.tsx` | pill con cotización del día |
| `<ContractStatusBadge>` | `components/billing/ContractStatusBadge.tsx` | badge variante |
| `<RunStatusBadge>` | `components/billing/RunStatusBadge.tsx` | badge variante |

---

## 13 · Integraciones externas

| Integración | Estado | Cambio FASE 1B |
|-------------|--------|----------------|
| ARCA WSFEv1 (lib `arca/`) | sandbox + GATE 3 cerrado | reutilizar para `emitDirectInvoice` y motor recurrente |
| Resend (email) | live | reutilizar para alerts + envío facturas + recordatorios |
| Drive | 🟢 READY post-credentials | sin cambio |
| Clientify | live | sin cambio |
| **BCRA API** (nueva) | no implementada | nueva integración en `exchange-rate/bcra-client.ts` |
| Supabase realtime | live | añadir 3 publicaciones (mig 0014 §14) |

### 13.1 BCRA API — primera integración nueva

- Endpoint público gratuito: `https://api.bcra.gob.ar/...`
- Sin auth requerida
- Rate limit BCRA: ~60 req/min (más que suficiente para 1 query/día)
- Mock service para tests
- Fallback config: `cotizacion_fija` por contrato

---

## 14 · Contratos internos entre módulos

### 14.1 Dependencias

```
recurring/engine
  ├── invoicing/calc       (cálculo IVA, redondeo fiscal)
  ├── invoicing/emit       (emit a ARCA si auto_emit)
  ├── invoicing/storage    (path canónico PDF)
  ├── arca/*               (transitivo)
  ├── exchange-rate/       (cotización persistida)
  ├── accounts/transactions (insert tx)
  ├── recurring/data       (CRUD recurring_runs)
  ├── alerts/send          (notificaciones)
  └── rbac.ts              (gate)

invoices-direct/emit
  ├── invoicing/calc, emit, storage  (mismo)
  ├── exchange-rate/                  (mismo)
  ├── accounts/transactions
  ├── alerts/send
  └── rbac.ts

payments/confirm
  ├── accounts/transactions
  ├── alerts/send
  └── rbac.ts

late-fees/cron
  ├── late-fees/calculator
  ├── accounts/transactions
  ├── alerts/send
  └── rbac.ts (allow service role)
```

### 14.2 Acoplamiento controlado

- `recurring/engine` NO importa de `payments/` ni `late-fees/` (one-way)
- `accounts/transactions` es la única vía para insertar `customer_transactions`
- `exchange-rate/` es la única vía para obtener cotización (single source)
- `alerts/send` es la única vía para enviar emails admin (centralizado)
- UI nunca importa directo libs server-side (siempre via API routes o server actions)

---

## 15 · Logging y observabilidad

Cada módulo emite logs estructurados via `logBilling`:

```ts
logBilling('info', {
  mod: 'billing',
  op: 'recurring.runContract',
  contractId, periodo, status, ms, ok,
  exchangeRateLogId, totalArs,
  userId, requestId,
})
```

Compatible con el formato de `logDrive` del Drive module (preparado para Sentry/Logflare).

---

## 16 · Tests por módulo

| Módulo | Tipo de test | Coverage objetivo |
|--------|--------------|-------------------|
| `terms/` | unit | 90% |
| `recurring/engine` | unit + integration | 100% (crítico) |
| `recurring/scheduler` | integration | 80% |
| `recurring/period-calculator` | unit (edge cases) | 100% |
| `invoices-direct/emit` | unit + integration | 90% |
| `accounts/balance` | unit + sandbox SQL | 80% |
| `accounts/reconcile` | unit | 90% |
| `payments/auto-apply` | unit (FIFO + LIFO + edge) | 100% |
| `payments/confirm` | integration | 90% |
| `late-fees/calculator` | unit (SIMPLE + COMPUESTO) | 100% |
| `late-fees/cron` | integration | 80% |
| `exchange-rate/bcra-client` | mock + retries | 80% |
| `exchange-rate/cache` | unit | 90% |
| `alerts/send` | mock email | 70% |
| RLS T1-T12 | sandbox SQL | 100% |

---

## 17 · Decisiones explícitas FASE 1B sobre 1A

| Tema | 1A (propuesta) | 1B (aprobado / refinado) |
|------|----------------|--------------------------|
| Categorías de línea | 6 categorías | **7** (oficina dividida en privada/cowork/temporal) |
| Unidades | mes/m2/unidad | **+m3 + puesto + hora** (catálogo extensible) |
| Cotización audit | sólo snapshot en factura | **+ tabla `exchange_rates_log`** con raw response |
| Tolerancia ARS 100 | mencionada en preguntas | **SKIP factura + alerta** (motor implementa) |
| Auto emit | flag boolean | **OFF default** + UI advertencia activarlo |
| Aprobación obligatoria | Ruth (sugerida) | **Ruth Carrasquero confirmada** + log si otra persona aprueba |
| Facturación directa | mencionada | **MÓDULO PROPIO** `invoices-direct/` |
| Catálogo terms | abierto | **CERRADO con 8 entries** |
| Cron run mensual | día 1 sugerido | **CONFIRMADO: día 1 09:00 ART** |
| Cron mora diario | propuesto | **CONFIRMADO: 07:00 ART todos los días** |

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR
- 🛑 NO EJECUTAR MIGRACIONES · NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO TOCAR producción · credenciales · Drive · ARCA · RBAC core
- 🛑 NO INVENTAR — toda especificación trazable a docs FASE 1A + decisiones aprobadas
