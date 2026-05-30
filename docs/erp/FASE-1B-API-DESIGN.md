# FASE 1B · API DESIGN — Contratos REST

> ⚠️ **AMENDMENT APLICADO 2026-05-29 — MONEDA ARS ÚNICA**
> Las secciones que mencionan **endpoints exchange-rate, campos currency/cotizacion en request bodies, código `EXCHANGE_RATE_UNAVAILABLE`** quedan **superseded** por `docs/erp/FASE-1B-AMENDMENT-ARS-ONLY.md`.
> - 3 endpoints `/api/billing/exchange-rate/*` → **ELIMINADOS**
> - Bodies de `recurring/contracts`, `invoices/direct`, `payments` sin campos `currency`, `cotizacion*`
> - Response de `accounts/[clientId]/balance` con campos sin sufijo `_pes` (queda `balance`, `total_debit`, `overdue_*`)
> - Código error `EXCHANGE_RATE_UNAVAILABLE` → **ELIMINADO**
> Resto del documento sigue vigente.

**Scope:** especificación de endpoints REST + request/response + errores + auth.
**Estado:** diseño · sin implementación.
**Patrón base:** REST-ish (no estricto OpenAPI), idéntico al usado por `/api/drive/*` (R22 closure).

---

## 0 · Convenciones globales

### 0.1 Auth pipeline (todos los endpoints excepto webhooks)

```
1. Middleware Supabase auth (mig 0009 helper)
   → si no hay sesión: 401 JSON {ok:false, error:'Auth required'}
2. Rate-limit por IP (60 req/min default, 20 req/min ping)
   → si excede: 429 + Retry-After header
3. requireBillingPermission(req, slug, requestId)
   → si fail-closed: 403 con {ok:false, error:'Permiso requerido: <slug>'}
   → si fail-open (RBAC dormido): warn log + continúa
4. Handler ejecuta
5. Logging estructurado por request
```

### 0.2 Request ID propagation

- Header `x-request-id` aceptado del cliente (sanitizado vía `safeRequestId()`)
- Si no viene, generado server-side: `billing-<timestamp>-<rand>`
- Echoed en response body + header

### 0.3 Response shapes

**Success:**
```json
{
  "ok": true,
  "requestId": "billing-...",
  "data": { ... }
}
```

**Error:**
```json
{
  "ok": false,
  "requestId": "billing-...",
  "error": "Human readable message",
  "code": "BILLING_ERROR_CODE",
  "details": { ... }   // opcional
}
```

### 0.4 Códigos de error semánticos (`BillingError.code`)

| Código | HTTP | Significado |
|--------|------|-------------|
| `AUTH_REQUIRED` | 401 | Sin sesión |
| `PERMISSION_DENIED` | 403 | RBAC denegó |
| `NOT_FOUND` | 404 | Recurso no existe |
| `VALIDATION_ERROR` | 400 | Zod schema fail |
| `RATE_LIMIT_EXCEEDED` | 429 | Bucket lleno |
| `CONTRACT_NOT_ACTIVE` | 409 | Conflicto de estado |
| `ALREADY_RUN_FOR_PERIOD` | 409 | Idempotencia hit |
| `BELOW_TOLERANCE` | 409 | Total < ARS 100 |
| `EXCHANGE_RATE_UNAVAILABLE` | 503 | BCRA + sin fallback |
| `ARCA_ERROR` | 502 | ARCA rechazó |
| `INVOICE_LOCKED` | 423 | Trigger lock blocked |
| `INTERNAL_ERROR` | 500 | Unknown |

### 0.5 Versionado

No versionado de URL todavía (FASE 1B es v1 implícita). Si futuro break: `/api/billing/v2/*`.

---

## 1 · Endpoints — Resumen

```
PUBLIC (no auth):           — ninguno en billing
INTERNAL (auth + RBAC):

CATÁLOGO
GET    /api/billing/terms                              billing.view
POST   /api/billing/terms                              admin only
PATCH  /api/billing/terms/[id]                         admin only
DELETE /api/billing/terms/[id]                         admin only

EXCHANGE RATE
GET    /api/billing/exchange-rate/today                billing.view
GET    /api/billing/exchange-rate/[date]               billing.view
POST   /api/billing/exchange-rate/refresh              admin only

RECURRING CONTRACTS
GET    /api/billing/recurring/contracts                billing.view
POST   /api/billing/recurring/contracts                billing.recurring.manage
GET    /api/billing/recurring/contracts/[id]           billing.view
PATCH  /api/billing/recurring/contracts/[id]           billing.recurring.manage
DELETE /api/billing/recurring/contracts/[id]           billing.delete
POST   /api/billing/recurring/contracts/[id]/activate  billing.recurring.manage
POST   /api/billing/recurring/contracts/[id]/pause     billing.recurring.manage
POST   /api/billing/recurring/contracts/[id]/resume    billing.recurring.manage
POST   /api/billing/recurring/contracts/[id]/cancel    billing.recurring.manage
POST   /api/billing/recurring/contracts/[id]/run       billing.recurring.run

RECURRING CONTRACT LINES
GET    /api/billing/recurring/contracts/[id]/lines     billing.view
POST   /api/billing/recurring/contracts/[id]/lines     billing.recurring.manage
PATCH  /api/billing/recurring/contracts/[id]/lines/[lineId]  billing.recurring.manage
DELETE /api/billing/recurring/contracts/[id]/lines/[lineId]  billing.recurring.manage

RECURRING RUNS
GET    /api/billing/recurring/runs                     billing.view
GET    /api/billing/recurring/runs/[id]                billing.view
POST   /api/billing/recurring/cron                     (Netlify scheduled function — header secret)

DIRECT INVOICES (NUEVO obligatorio)
POST   /api/billing/invoices/direct                    billing.create
POST   /api/billing/invoices/from-order/[orderId]      billing.create
POST   /api/billing/invoices/from-contract/[contractId] billing.recurring.run

CUSTOMER ACCOUNTS
GET    /api/billing/accounts                           billing.view
GET    /api/billing/accounts/[clientId]                billing.view
PATCH  /api/billing/accounts/[clientId]                admin/supervisor
GET    /api/billing/accounts/[clientId]/balance        billing.view
GET    /api/billing/accounts/[clientId]/transactions   billing.view
POST   /api/billing/accounts/[clientId]/transactions/manual  billing.adjustments.create
POST   /api/billing/accounts/[clientId]/transactions/[txId]/void  billing.adjustments.create
GET    /api/billing/accounts/[clientId]/reconcile      admin

PAYMENTS
GET    /api/billing/payments                           billing.view
POST   /api/billing/payments                           billing.payments.register
GET    /api/billing/payments/[id]                      billing.view
PATCH  /api/billing/payments/[id]                      billing.payments.register
POST   /api/billing/payments/[id]/confirm              billing.payments.register
POST   /api/billing/payments/[id]/void                 billing.delete
POST   /api/billing/payments/[id]/apply                billing.payments.apply
POST   /api/billing/payments/[id]/auto-apply           billing.payments.apply
DELETE /api/billing/payments/[id]/applications/[appId] billing.payments.apply

LATE FEES
GET    /api/billing/late-fees/rules                    billing.view
POST   /api/billing/late-fees/rules                    billing.late_fees.manage
PATCH  /api/billing/late-fees/rules/[id]               billing.late_fees.manage
DELETE /api/billing/late-fees/rules/[id]               billing.late_fees.manage
GET    /api/billing/late-fees/charges                  billing.view
POST   /api/billing/late-fees/cron                     (Netlify scheduled — header secret)

DASHBOARD KPIs
GET    /api/billing/kpi/mrr                            billing.view
GET    /api/billing/kpi/facturacion-mes                billing.view
GET    /api/billing/kpi/cobranza-pendiente             billing.view
GET    /api/billing/kpi/morosos                        billing.view
GET    /api/billing/kpi/proyeccion                     billing.view
```

---

## 2 · Detalle de endpoints clave

### 2.1 `POST /api/billing/recurring/contracts` — Crear contrato

**Permiso:** `billing.recurring.manage`

**Request body:**
```json
{
  "client_id": "uuid",
  "code": "C-ANMAT-22M2-BIDCOM-2026",
  "descripcion": "ANMAT Bidcom 22 m² mensual",
  "frequency": "MENSUAL",
  "start_date": "2026-06-01",
  "end_date": null,
  "billing_day": 1,
  "payment_term_id": "uuid",
  "auto_emit": false,
  "concepto_arca": 2,
  "tipo_comprobante_default": "FACTURA_A",
  "punto_venta": 3,
  "currency": "USD",
  "cotizacion_source": "BCRA_OFICIAL",
  "cotizacion_fija": null,
  "iva_default": 21,
  "notas": null,
  "lines": [
    {
      "orden": 1,
      "descripcion": "Almacenaje ANMAT — 22 m²",
      "categoria": "ALMACENAJE_ANMAT",
      "unidad": "m2",
      "cantidad": 22,
      "precio_unitario": 50,
      "iva_rate": 21
    }
  ]
}
```

**Response 201:**
```json
{
  "ok": true,
  "requestId": "billing-...",
  "data": {
    "id": "uuid",
    "status": "BORRADOR",
    "next_run_date": null,
    "code": "C-ANMAT-22M2-BIDCOM-2026"
  }
}
```

**Errors:**
- 400 `VALIDATION_ERROR` (campo inválido, code duplicado, lines vacías)
- 403 `PERMISSION_DENIED`
- 422 `INVALID_PAYMENT_TERM` (term inactivo)
- 422 `INVALID_CLIENT` (client_id no existe)

---

### 2.2 `POST /api/billing/recurring/contracts/[id]/activate`

**Permiso:** `billing.recurring.manage`

**Body:** (vacío o `{ "force_next_run_date": "YYYY-MM-DD" }`)

**Lógica:**
1. Verificar contrato existe + status='BORRADOR' o 'PAUSADO'
2. Verificar al menos 1 line activa
3. Calcular `next_run_date`:
   - Si `force_next_run_date` provisto → usar
   - Si no → primera fecha futura matching `billing_day` >= max(today, start_date)
4. Update status='ACTIVO', next_run_date

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "status": "ACTIVO",
    "next_run_date": "2026-06-01"
  }
}
```

---

### 2.3 `POST /api/billing/recurring/contracts/[id]/run`

**Permiso:** `billing.recurring.run`

**Body:**
```json
{
  "dry_run": false,
  "period_override": "2026-06",  // opcional
  "force_emit": false              // si true y contract.auto_emit=false, igual emite a ARCA
}
```

**Response 200 (OK):**
```json
{
  "ok": true,
  "data": {
    "run_id": "uuid",
    "status": "OK",
    "invoice_id": "uuid",
    "total_estimado_usd": 1100,
    "total_emitido_ars": 1430000,
    "cotizacion_snapshot": 1300.000000,
    "exchange_rate_log_id": "uuid",
    "auto_emitted": false,
    "needs_approval_by": "ruth@logisticatops.com"
  }
}
```

**Response 200 (SKIPPED):**
```json
{
  "ok": true,
  "data": {
    "run_id": "uuid",
    "status": "SKIPPED",
    "skip_reason": "ALREADY_RUN_FOR_PERIOD",
    "existing_invoice_id": "uuid"
  }
}
```

**Response 409 (FAILED por idempotencia hard):**
- Si concurrent INSERT viola UNIQUE → retornar 409 `ALREADY_RUN_FOR_PERIOD` con el run ID existente

**Response 503 (cotización no disponible):**
```json
{
  "ok": false,
  "code": "EXCHANGE_RATE_UNAVAILABLE",
  "error": "BCRA API caída y contrato sin cotizacion_fija configurada"
}
```

---

### 2.4 `POST /api/billing/recurring/cron`

**Auth:** **NO RBAC normal** — header `X-Netlify-Scheduled-Function: true` + verificación de signature secret.

**Permiso interno:** equivale a `service_role`.

**Lógica:**
1. Verificar header secret (env `NETLIFY_SCHEDULED_FUNCTION_SECRET`)
2. Sin secret → 401
3. Detectar contratos due (status='ACTIVO' AND next_run_date<=today)
4. Loop runContract para cada → resultados acumulados
5. Email summary a Ruth + JL
6. Return batch summary

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "batch_run_at": "2026-06-01T09:00:00-03:00",
    "contracts_processed": 14,
    "results": {
      "OK": 11,
      "FAILED": 1,
      "SKIPPED": 2
    },
    "failures": [
      { "contract_id": "uuid", "code": "C-X-2026", "error": "ARCA rejected: ..." }
    ],
    "skipped": [
      { "contract_id": "uuid", "code": "C-Y-2026", "reason": "CLIENT_STOP_BILLING" }
    ]
  }
}
```

**Schedule (`netlify.toml`):**
```toml
[[scheduled.functions]]
  path = "/api/billing/recurring/cron"
  schedule = "0 12 1 * *"   # 12:00 UTC = 09:00 ART día 1 de cada mes
```

(Netlify scheduled functions usa cron UTC; ART = UTC-3, así que 09:00 ART = 12:00 UTC.)

---

### 2.5 `POST /api/billing/invoices/direct` — Facturación directa (NUEVO)

**Permiso:** `billing.create`

**Request body:**
```json
{
  "client_id": "uuid",
  "payment_term_id": "uuid",
  "tipo_comprobante": "FACTURA_A",      // opcional, se calcula si null
  "punto_venta": 3,
  "concepto": 2,
  "fch_serv_desde": "2026-06-01",
  "fch_serv_hasta": "2026-06-30",
  "periodo": "2026-06",
  "currency": "USD",
  "cotizacion_source": "BCRA_OFICIAL",
  "cotizacion_manual": null,
  "items": [
    {
      "descripcion": "Almacenaje extraordinario",
      "cantidad": 50,
      "precio_unitario": 10,
      "alicuota_iva": 21,
      "unidad": "m3"
    },
    {
      "descripcion": "Manipulación de cargas",
      "cantidad": 1,
      "precio_unitario": 200,
      "alicuota_iva": 21,
      "unidad": "unidad"
    }
  ],
  "observ": "Servicio especial mayo",
  "emit_to_arca": false
}
```

**Response 201:**
```json
{
  "ok": true,
  "data": {
    "invoice_id": "uuid",
    "estado_arca": "BORRADOR",
    "total_ars": 910000,
    "exchange_rate_log_id": "uuid",
    "cotizacion_used": 1300.000000,
    "fch_vto_pago": "2026-07-01"
  }
}
```

**Errors:**
- 400 `VALIDATION_ERROR` (items vacíos, fechas servicio faltantes si concepto=2/3)
- 422 `INVALID_TIPO_COMPROBANTE` (incoherente con condicion_iva)
- 502 `ARCA_ERROR` (si `emit_to_arca=true` y ARCA rechaza)
- 503 `EXCHANGE_RATE_UNAVAILABLE`

---

### 2.6 `POST /api/billing/invoices/from-order/[orderId]`

**Permiso:** `billing.create`

**Body:**
```json
{
  "payment_term_id": "uuid",
  "emit_to_arca": false
}
```

**Lógica:**
1. Get order + order_services
2. Build items desde services
3. Cliente del order
4. Mismo flow que direct

**Response:** idéntico a 2.5

---

### 2.7 `GET /api/billing/accounts/[clientId]/balance`

**Permiso:** `billing.view` (o cliente de su propio balance)

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "client_id": "uuid",
    "client_name": "BIDCOM S.A.",
    "balance_pes": 1420000,
    "total_debit_pes": 6500000,
    "total_credit_pes": 5080000,
    "overdue_0_30_pes": 200000,
    "overdue_30_60_pes": 0,
    "overdue_60_90_pes": 0,
    "overdue_90_plus_pes": 0,
    "credit_limit": 3000000,
    "stop_billing": false,
    "last_payment_date": "2026-05-15",
    "last_invoice_date": "2026-05-01"
  }
}
```

---

### 2.8 `GET /api/billing/accounts/[clientId]/transactions`

**Query params:**
- `from=YYYY-MM-DD` (default: 90 días atrás)
- `to=YYYY-MM-DD` (default: today)
- `type=INVOICE|PAYMENT|LATE_FEE|...` (filter)
- `page=1`
- `pageSize=50` (max 200)

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "client_id": "uuid",
    "rows": [
      {
        "id": "uuid",
        "type": "PAYMENT",
        "direction": "CREDIT",
        "amount": 800000,
        "currency": "PES",
        "amount_pes": 800000,
        "tx_date": "2026-05-15",
        "description": "Transferencia Galicia ref 81928",
        "source_table": "customer_payments",
        "source_id": "uuid",
        "voided": false
      }
      // ...
    ],
    "page": 1,
    "pageSize": 50,
    "total": 87,
    "nextPageToken": null
  }
}
```

---

### 2.9 `POST /api/billing/payments` — Crear cobro

**Permiso:** `billing.payments.register`

**Body:**
```json
{
  "client_id": "uuid",
  "payment_date": "2026-05-28",
  "amount": 800000,
  "currency": "PES",
  "cotizacion": 1,
  "method": "TRANSFERENCIA",
  "reference": "81928",
  "bank": "Galicia",
  "notes": null
}
```

**Response 201:**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "status": "BORRADOR",
    "unapplied_amount": 800000,
    "amount_pes": 800000
  }
}
```

---

### 2.10 `POST /api/billing/payments/[id]/auto-apply`

**Permiso:** `billing.payments.apply`

**Body:** (vacío)

**Lógica:** FIFO contra facturas pendientes del cliente.

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "payment_id": "uuid",
    "applied_count": 3,
    "applications": [
      {"invoice_id": "uuid-A", "applied_amount": 240000},
      {"invoice_id": "uuid-B", "applied_amount": 380000},
      {"invoice_id": "uuid-C", "applied_amount": 180000}
    ],
    "unapplied_amount": 0
  }
}
```

---

### 2.11 `POST /api/billing/payments/[id]/apply` — Aplicación manual

**Permiso:** `billing.payments.apply`

**Body:**
```json
{
  "invoice_id": "uuid",
  "amount": 240000
}
```

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "application_id": "uuid",
    "applied_amount": 240000,
    "payment_remaining_unapplied": 560000
  }
}
```

**Errors:**
- 400 `VALIDATION_ERROR` (amount > payment.unapplied o > invoice.pending)
- 409 `INVOICE_FULLY_PAID`

---

### 2.12 `POST /api/billing/payments/[id]/confirm`

**Permiso:** `billing.payments.register`

**Body:** (vacío)

**Lógica:**
1. Verificar status='BORRADOR'
2. Crear `customer_transactions` (PAYMENT, CREDIT, amount, etc.)
3. Update payment.status='CONFIRMADO', payment.tx_id=tx.id
4. Trigger lock activa

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "status": "CONFIRMADO",
    "tx_id": "uuid"
  }
}
```

---

### 2.13 `POST /api/billing/late-fees/cron`

**Auth:** Netlify scheduled (header secret)

**Schedule:** `0 10 * * *` (07:00 ART)

**Response:**
```json
{
  "ok": true,
  "data": {
    "batch_run_at": "2026-05-29T07:00:00-03:00",
    "invoices_overdue": 12,
    "charges_created": 8,
    "charges_skipped": 4,
    "total_fee_ars": 145000
  }
}
```

---

### 2.14 `GET /api/billing/exchange-rate/today`

**Permiso:** `billing.view`

**Response 200 (cache hit):**
```json
{
  "ok": true,
  "data": {
    "source": "BCRA_OFICIAL",
    "currency_from": "USD",
    "currency_to": "ARS",
    "rate": 1300.500000,
    "valid_for_date": "2026-05-29",
    "fetched_at": "2026-05-29T08:00:00Z",
    "log_id": "uuid"
  }
}
```

**Response 503 (BCRA caído + sin cache):**
```json
{
  "ok": false,
  "code": "EXCHANGE_RATE_UNAVAILABLE",
  "error": "BCRA API no responde y no hay cotización del día en cache"
}
```

---

### 2.15 `POST /api/billing/exchange-rate/refresh`

**Permiso:** admin only

**Body:**
```json
{
  "source": "BCRA_OFICIAL",
  "force": true   // si false y existe cache del día → return existente
}
```

Response: idéntico a 2.14.

---

### 2.16 Endpoints de KPI

**`GET /api/billing/kpi/mrr`**

```json
{
  "ok": true,
  "data": {
    "mrr_ars_current": 9500000,
    "mrr_ars_previous_month": 9200000,
    "delta_pct": 3.26,
    "active_contracts_count": 14,
    "new_contracts_this_month": 3,
    "cancelled_this_month": 1,
    "arr_ars_extrapolated": 114000000
  }
}
```

**`GET /api/billing/kpi/cobranza-pendiente`**

```json
{
  "ok": true,
  "data": {
    "total_pendiente_ars": 2330000,
    "facturas_count": 27,
    "clientes_count": 18,
    "vencido_ars": 540000,
    "por_vencer_7d_ars": 820000,
    "vigente_ars": 970000
  }
}
```

**`GET /api/billing/kpi/morosos`**

```json
{
  "ok": true,
  "data": {
    "morosos_count": 4,
    "total_mora_ars": 540000,
    "top_moroso": {
      "client_id": "uuid",
      "client_name": "Distribuidora Norte",
      "saldo_total": 800000,
      "vencido_pes": 240000,
      "max_days_overdue": 67
    },
    "buckets": {
      "0_30": 1,
      "30_60": 1,
      "60_90": 1,
      "90_plus": 1
    }
  }
}
```

---

## 3 · Server actions (alternativa a algunos POST)

Para wizards interactivos, usar **Next.js server actions** en lugar de POST endpoints separados:

```
src/app/(app)/billing/recurrentes/nuevo/actions.ts
  - createRecurringContract(formData) → server action
src/app/(app)/billing/directa/nueva/actions.ts
  - createDirectInvoice(formData)
src/app/(app)/billing/cobros/nuevo/actions.ts
  - createPayment(formData) → bordeador
  - confirmPayment(paymentId)
  - applyToInvoice(paymentId, invoiceId, amount)
src/app/(app)/billing/clientes/[clientId]/actions.ts
  - createManualAdjustment(clientId, formData)
  - voidTransaction(txId, reason)
```

**Decisión:** server actions para mutaciones desde forms internos; API routes para integraciones futuras (mobile, externa, webhooks, scheduled functions).

---

## 4 · Webhooks (futuros, no en FASE 1B)

Reservar paths para fase futura:
- `POST /api/billing/webhooks/payment-confirmation` (Mercado Pago, manual)
- `POST /api/billing/webhooks/arca-event` (si AFIP envía notificaciones)

---

## 5 · Convenciones de paginación

Patrón heredado del Drive module post-hardening:

**Request:**
```
GET /api/billing/...?page=1&pageSize=50&pageToken=xxx
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "rows": [...],
    "page": 1,
    "pageSize": 50,
    "total": 234,
    "nextPageToken": "opaque-token-or-null"
  }
}
```

- `page` para offset simple (CC del cliente, contracts list)
- `pageToken` para cursor cuando hay >10k filas (transactions histórico)

---

## 6 · Real-time subscriptions

Tablas con realtime habilitado (mig 0014):
- `customer_transactions`
- `recurring_runs`
- `customer_payments`

**Patrón cliente:**
```ts
supabase.channel('billing-cc-<clientId>')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'customer_transactions',
    filter: `client_id=eq.${clientId}`
  }, payload => refreshLedger())
  .subscribe()
```

**Uso UI:**
- `/billing/clientes/[clientId]` se subscribe a CC en vivo
- `/billing/recurrentes/[id]` se subscribe a runs en vivo
- `/billing/cobros/[id]` se subscribe a applications en vivo

---

## 7 · Rate limiting por endpoint

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /api/billing/*` lectura | 120 req/min | por IP |
| `POST /api/billing/*` escritura | 30 req/min | por IP |
| `POST /api/billing/recurring/contracts/[id]/run` | 5 req/min | por IP (manual trigger costoso) |
| `POST /api/billing/invoices/direct` | 10 req/min | por IP |
| `POST /api/billing/payments/[id]/confirm` | 20 req/min | por IP |
| `GET /api/billing/exchange-rate/today` | 60 req/min | por IP |
| `POST /api/billing/recurring/cron` | sin rate-limit | secret header valida |
| `POST /api/billing/late-fees/cron` | sin rate-limit | secret header valida |

---

## 8 · Idempotencia

### 8.1 Idempotency-Key header (opcional)

Para endpoints sensibles donde el cliente puede reintenter (red flaky):

```
POST /api/billing/payments
Idempotency-Key: pay-bidcom-2026-05-28-abc123
```

Server cachea response por 24h. Reintentos con misma key retornan misma response sin re-crear.

Aplica a:
- `POST /api/billing/payments`
- `POST /api/billing/payments/[id]/confirm`
- `POST /api/billing/invoices/direct`
- `POST /api/billing/recurring/contracts/[id]/run`

Cache implementación: Redis si disponible, sino tabla `idempotency_keys` Supabase con TTL.

### 8.2 Idempotencia natural (recurring runs)

`recurring/engine` ya tiene UNIQUE (contract_id, periodo) → no necesita idempotency-key.

---

## 9 · Headers globales de response

| Header | Valor | Notas |
|--------|-------|-------|
| `x-request-id` | echo del request | siempre |
| `cache-control` | `private, no-cache, no-store` | siempre (datos financieros) |
| `retry-after` | seconds | sólo en 429 |
| `content-type` | `application/json; charset=utf-8` | siempre |

---

## 10 · CORS y origen

- Sin CORS habilitado (todo es internal NEXUS UI)
- Si futuro: mobile app necesitará origen autorizado en mig nueva

---

## 11 · Logging por endpoint

Cada request emite 2-3 log lines:

```json
{ "ts": "...", "level": "info", "mod": "billing", "op": "POST /api/billing/payments",
  "requestId": "...", "userId": "...", "permission": "billing.payments.register",
  "ms_auth": 12, "ok": true }

{ "ts": "...", "level": "info", "mod": "billing", "op": "payment.create",
  "requestId": "...", "userId": "...", "client_id": "...", "amount": 800000,
  "currency": "PES", "ms": 45, "ok": true }

{ "ts": "...", "level": "info", "mod": "billing", "op": "RESPONSE",
  "requestId": "...", "status": 201, "ms_total": 78 }
```

---

## 12 · Tests por endpoint (RLS + funcional)

Por cada endpoint, mínimo 3 tests:
1. **Auth required** — sin sesión → 401
2. **RBAC** — usuario sin permiso → 403
3. **Happy path** — usuario con permiso → 200/201 + payload válido

Adicionales por endpoint sensible:
- Idempotencia (replay request con misma Idempotency-Key)
- Rate-limit (61er request → 429)
- RLS cross-tenant (cliente A consulta cliente B → 404 o 403)

---

## 13 · Esquemas zod (resumen)

Cada endpoint tiene schema zod en `src/lib/billing/<modulo>/validation.ts`. Ejemplo:

```ts
// recurring/validation.ts
export const createRecurringContractSchema = z.object({
  client_id: z.string().uuid(),
  code: z.string().min(1).max(80),
  descripcion: z.string().nullable(),
  frequency: z.enum(['MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  billing_day: z.number().int().min(1).max(28),
  payment_term_id: z.string().uuid(),
  auto_emit: z.boolean().default(false),
  concepto_arca: z.number().int().min(1).max(3),
  punto_venta: z.number().int().positive(),
  currency: z.enum(['PES','USD']),
  cotizacion_source: z.enum(['BCRA_OFICIAL','BCRA_MAYORISTA','FIJO']),
  cotizacion_fija: z.number().positive().nullable(),
  iva_default: z.number().min(0).max(50),
  lines: z.array(z.object({
    orden: z.number().int().nonnegative(),
    descripcion: z.string().min(1),
    categoria: z.enum([
      'ALMACENAJE_ANMAT','ALMACENAJE_GRAL',
      'OFICINA_PRIVADA','OFICINA_COWORKING','OFICINA_TEMPORAL',
      'ABONO','OTRO'
    ]),
    unidad: z.string(),
    cantidad: z.number().positive(),
    precio_unitario: z.number().nonnegative(),
    iva_rate: z.number().min(0).max(50),
  })).min(1, 'Al menos 1 línea requerida'),
})
.refine(d => d.end_date === null || d.end_date >= d.start_date, {
  message: 'end_date debe ser >= start_date'
})
.refine(d => d.cotizacion_source !== 'FIJO' || d.cotizacion_fija !== null, {
  message: 'cotizacion_fija requerida si source=FIJO'
})
```

---

## 14 · Decisiones explícitas API

| Decisión | Elegida | Alternativa descartada |
|----------|---------|------------------------|
| REST vs GraphQL | REST-ish | GraphQL — overkill para FASE 1B |
| Server actions para forms | Sí (Next 14 pattern existente) | Sólo API routes — más verbose |
| OpenAPI spec formal | No (descripción suficiente) | OpenAPI + Swagger UI — agrega complejidad |
| Versionado URL | No (v1 implícita) | `/v1/` — flexibilidad futura sin costo si no rompemos |
| Idempotency-Key header | Sí para 4 endpoints | Sin idempotencia — riesgo de duplicados |
| Cron via Netlify scheduled | Sí | Inngest/Trigger.dev — agrega proveedor |
| Realtime para 3 tablas | Sí | Polling cada 5s — costoso |
| Errors codes semánticos | Sí (`BILLING_X`) | Sólo HTTP status — pierde granularidad |
| Pagination opaque token | Sí en transactions | Sólo offset — falla con >100k rows |
| Permission check before rate-limit | No (rate-limit primero) | Permission primero — gasta query DB |

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR
- 🛑 NO CREAR endpoints todavía
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO INVENTAR — todo trazable a `FASE-1A-*` aprobados
