# FASE 1B · BACKLOG TÉCNICO

> ⚠️ **AMENDMENT APLICADO 2026-05-29 — MONEDA ARS ÚNICA**
> **ÉPICA E2 (Exchange Rate) eliminada completamente**. Ver `docs/erp/FASE-1B-AMENDMENT-ARS-ONLY.md`.
> - 4 historias E2.H01-H04 → **ELIMINADAS**
> - PR 3 (`feat/exchange-rate`) → **ELIMINADO** (quedan 10 PRs)
> - Total desarrollo: ~12 semanas (no 14)
> - E1 baja a 2.5 sem, E3 a 2.5, E4 a 1.2, E8 a 4.5 sem
> Resto del documento sigue vigente.

**Scope:** descomposición en épicas → historias → tareas con criterios de aceptación y estimaciones.
**Estado:** diseño · sin código.
**Notación:**
- **T-shirt sizing:** XS (<½ día), S (½-1 día), M (2-3 días), L (1 semana), XL (>1 semana)
- **Criticidad:** ★ crítica · normal
- **Bloqueante de:** lista de IDs que se desbloquean al cerrar este

---

## 0 · Resumen

| Métrica | Valor |
|---------|-------|
| Épicas | 9 |
| Historias | 38 |
| Tareas técnicas | 124 |
| Estimación total | ~14 semanas calendario · 1 dev FT |
| Bloqueantes externos | 3 (backup, RBAC seed, decisiones) |

---

## ÉPICA E0 · Pre-flight (bloqueantes externos)

**Objetivo:** cerrar pre-condiciones antes de codear.

| ID | Historia | Asignable | Estimación |
|----|----------|-----------|------------|
| E0.H01 | Configurar backup externo Supabase (pg_dump → S3/GCS) | DevOps | M |
| E0.H02 | Validar restore en sandbox | DevOps | S |
| E0.H03 | Seedear `user_roles` con Director (JL) + Admin (Ruth) en producción | Admin DB + Usuario | S |
| E0.H04 | Configurar config.toml local Supabase CLI (PARIDAD-3) | DevOps | XS |
| E0.H05 | Crear branch `feature/fase-1a-recurring-billing` desde `4d1dbff` | Dev | XS |
| E0.H06 | Crear sandbox Supabase separado de prod (si no existe) | DevOps | M |
| E0.H07 | Documentar decisiones FASE 1A §8 (7 preguntas) confirmadas | Usuario | DONE (ya aprobadas) |

**Gate de salida:** E0.H01-E0.H06 OK → GATE 0 ✅

---

## ÉPICA E1 · Schema + Data Layer

**Objetivo:** migración 0014 + libs/types/data accessors validados en sandbox.

### E1.H01 ★ Escribir migration 0014 según `FASE-1A-MIGRATION-0014.md` (L)

**Bloqueante de:** E1.H02-H07

| Tarea | Estimación |
|-------|-----------|
| Escribir enums (10) | S |
| Escribir tablas (10) + view (1) | M |
| Escribir índices (~15) | S |
| Escribir triggers (~7) | M |
| Escribir RLS policies (~25) | M |
| Escribir storage buckets + policies (2 nuevos) | S |
| Escribir seeds (payment_terms, late_fee_rules) | XS |
| Escribir down-migration comentada | S |
| Escribir tabla `exchange_rates_log` (nuevo de 1B) | S |
| Escribir publicación realtime (3 tablas) | XS |
| Lint pre-commit (idempotencia) | XS |

### E1.H02 ★ Aplicar 0014 en sandbox + tests T1-T12 (M)

| Tarea | Estimación |
|-------|-----------|
| Aplicar `supabase migration up --linked` | XS |
| Re-aplicar (idempotencia) | XS |
| Ejecutar T1: cliente A no ve contratos B | S |
| Ejecutar T2-T12 | M |
| Documentar resultados en `FASE-1A-SANDBOX-REPORT.md` | S |

### E1.H03 Crear `src/lib/billing/types.ts` (S)

| Tarea | Estimación |
|-------|-----------|
| Espejo TS de tablas 0014 | S |
| Re-exports en `src/lib/billing/index.ts` | XS |

### E1.H04 Crear `src/lib/billing/errors.ts` + `logger.ts` (XS)

| Tarea | Estimación |
|-------|-----------|
| `BillingError` class | XS |
| Códigos enum | XS |
| `logBilling()` structured | XS |

### E1.H05 Crear `src/lib/billing/storage.ts` (S)

| Tarea | Estimación |
|-------|-----------|
| `buildReceiptPath(clientId, payment)` | XS |
| `buildContractPath(clientId, contract)` | XS |
| Unit tests path canónico | S |

### E1.H06 ★ Crear `src/lib/billing/rbac.ts` con `requireBillingPermission()` (S)

| Tarea | Estimación |
|-------|-----------|
| Helper espejo de `requireDrivePermission` (R22 closure) | S |
| Unit tests fail-open/fail-closed | S |

### E1.H07 Data accessors básicos (M)

| Tarea | Estimación |
|-------|-----------|
| `terms/data.ts` CRUD | S |
| `recurring/data.ts` CRUD contracts + lines + runs | M |
| `accounts/data.ts` CRUD customer_accounts | S |
| `accounts/transactions.ts` insertTransaction + listTransactions | M |
| `payments/data.ts` CRUD payments + applications | M |
| `late-fees/data.ts` CRUD rules + charges | S |

**Total E1:** ~3 semanas

**GATE 1:** schema validado en sandbox + libs base testeadas. **→ aprobación usuario**

---

## ÉPICA E2 · Exchange Rate (cotización auditada)

**Objetivo:** integración BCRA + cache + fallback.

### E2.H01 ★ Implementar `bcra-client.ts` (M)

| Tarea | Estimación |
|-------|-----------|
| HTTP client + auth (sin auth, endpoint público) | XS |
| Parser de response BCRA | S |
| Retries con backoff | S |
| Mock service para tests | S |
| Unit tests | S |

### E2.H02 ★ Implementar `cache.ts` + `data.ts` exchange_rates_log (S)

| Tarea | Estimación |
|-------|-----------|
| `getRateForDate(date, source)` con UNIQUE en log | S |
| `recordRate(rate, source, raw)` insert | XS |
| Unit tests | S |

### E2.H03 Implementar `fallback.ts` (S)

| Tarea | Estimación |
|-------|-----------|
| `resolveCotizacion(contract, date)` con fallback a cotizacion_fija | S |
| Unit tests edge cases | S |

### E2.H04 Endpoints API exchange-rate (S)

| Tarea | Estimación |
|-------|-----------|
| `GET /api/billing/exchange-rate/today` | XS |
| `GET /api/billing/exchange-rate/[date]` | XS |
| `POST /api/billing/exchange-rate/refresh` (admin) | S |
| Tests funcionales | S |

**Total E2:** ~1 semana

---

## ÉPICA E3 · Motor recurrente

**Objetivo:** generar facturas según contrato.

### E3.H01 ★ Implementar `recurring/validation.ts` (S)

| Tarea | Estimación |
|-------|-----------|
| zod schemas para create/update contract + lines | S |
| Business rules (lines ≥1 al activar, etc.) | S |

### E3.H02 ★ Implementar `period-calculator.ts` (M)

| Tarea | Estimación |
|-------|-----------|
| `calcNextRunDate(currentDate, freq, billingDay)` | S |
| `calcServiceDates(periodo, freq)` | S |
| `periodToString(date, freq)` | XS |
| Unit tests edge cases (Feb, fin de mes, año bisiesto) | M |

### E3.H03 ★ Implementar `recurring/engine.ts` — `runContract()` (XL)

**Bloqueante de:** E3.H04, E5.*, E6.*

| Tarea | Estimación |
|-------|-----------|
| Lock idempotencia (INSERT recurring_runs) | S |
| Validaciones SKIPPED (5 razones) | S |
| Resolución de cotización | S |
| Cálculo de total + tolerancia ARS 100 | S |
| Creación de customer_invoices BORRADOR | M |
| Auto-emit a ARCA si flag | M |
| Insert customer_transactions | S |
| Update recurring_contracts.next_run_date | S |
| Notify Ruth | XS |
| Unit + integration tests | L |

### E3.H04 ★ Implementar `recurring/scheduler.ts` (M)

| Tarea | Estimación |
|-------|-----------|
| Cron entrypoint con verificación de secret | S |
| Loop con catch individual + error aggregation | S |
| Email summary a Ruth + JL | S |
| Integration tests | M |

### E3.H05 Implementar `recurring/notify.ts` (S)

| Tarea | Estimación |
|-------|-----------|
| Template MJML para "factura recurrente generada" | S |
| Template "run failed" | XS |
| Reuse Resend service | XS |

### E3.H06 Endpoints API recurring (M)

| Tarea | Estimación |
|-------|-----------|
| GET/POST `/api/billing/recurring/contracts` | S |
| GET/PATCH/DELETE `/api/billing/recurring/contracts/[id]` | S |
| POST `/api/billing/recurring/contracts/[id]/activate|pause|resume|cancel` | S |
| POST `/api/billing/recurring/contracts/[id]/run` | M |
| GET/POST `/api/billing/recurring/contracts/[id]/lines` + edit | S |
| PATCH/DELETE `/api/billing/recurring/contracts/[id]/lines/[lineId]` | S |
| GET `/api/billing/recurring/runs` + [id] | S |
| POST `/api/billing/recurring/cron` con secret | S |
| Tests funcionales | M |

### E3.H07 Configurar Netlify scheduled function (XS)

| Tarea | Estimación |
|-------|-----------|
| Editar `netlify.toml` con cron schedule (12:00 UTC = 09:00 ART) | XS |
| Setear secret env var | XS |
| Smoke test invocación manual | S |

**Total E3:** ~3 semanas

**GATE 2:** motor funcional en sandbox + idempotencia validada. **→ aprobación usuario**

---

## ÉPICA E4 · Facturación directa (NUEVO obligatorio)

**Objetivo:** emisión sin OS ni contrato.

### E4.H01 ★ Implementar `invoices-direct/emit.ts` (L)

| Tarea | Estimación |
|-------|-----------|
| Validación zod input | S |
| Resolución tipo_comprobante | S |
| Cotización + total ARS | S |
| Crear customer_invoices BORRADOR | M |
| Auto-emit a ARCA si flag | S |
| Insert customer_transactions | XS |
| Aplicar payment_term para due dates | S |
| Tests | M |

### E4.H02 Implementar `from-order.ts` wrapper (S)

| Tarea | Estimación |
|-------|-----------|
| Mapeo orders → items | S |
| Tests con order existente | S |

### E4.H03 Implementar `from-contract.ts` wrapper (XS)

| Tarea | Estimación |
|-------|-----------|
| Wrapper sobre engine.runContract con triggeredBy=MANUAL | XS |
| Tests | XS |

### E4.H04 Endpoints API (S)

| Tarea | Estimación |
|-------|-----------|
| `POST /api/billing/invoices/direct` | S |
| `POST /api/billing/invoices/from-order/[orderId]` | S |
| `POST /api/billing/invoices/from-contract/[contractId]` | XS |
| Idempotency-Key support | S |
| Tests | M |

**Total E4:** ~1.5 semanas

---

## ÉPICA E5 · Cuenta corriente cliente

**Objetivo:** balance + transactions + reconciliación.

### E5.H01 Implementar `accounts/balance.ts` (S)

| Tarea | Estimación |
|-------|-----------|
| Query view `customer_balances` | XS |
| Tests RLS (cliente ve solo su saldo) | S |

### E5.H02 ★ Implementar `accounts/transactions.ts` (M)

| Tarea | Estimación |
|-------|-----------|
| `insertTransaction()` con validación polimórfica | M |
| `voidTransaction()` | S |
| `listCustomerTransactions()` con paginación | S |
| Tests trigger lock | M |

### E5.H03 Implementar `accounts/reconcile.ts` (S)

| Tarea | Estimación |
|-------|-----------|
| Comparar view.balance vs sum(transactions) | S |
| Alert si drift > $1 | XS |
| Tests | S |

### E5.H04 Endpoints API accounts (S)

| Tarea | Estimación |
|-------|-----------|
| GET `/api/billing/accounts` + `[clientId]` | S |
| PATCH `/api/billing/accounts/[clientId]` | XS |
| GET balance/transactions | S |
| POST manual adjustment | S |
| POST void transaction | S |
| GET reconcile | XS |
| Tests | M |

**Total E5:** ~1 semana

---

## ÉPICA E6 · Cobros

**Objetivo:** registrar pagos + aplicar a facturas + FIFO.

### E6.H01 Implementar `payments/data.ts` (S)

| Tarea | Estimación |
|-------|-----------|
| CRUD customer_payments | S |
| CRUD customer_payment_applications | S |
| Tests trigger lock CONFIRMADO | S |

### E6.H02 ★ Implementar `payments/auto-apply.ts` (M)

| Tarea | Estimación |
|-------|-----------|
| Query facturas pendientes ordenadas FIFO | S |
| Loop aplicación con remaining | S |
| Update unapplied_amount | XS |
| Unit tests edge (1 factura paga 3 cobros, pago > suma, etc.) | M |

### E6.H03 Implementar `payments/confirm.ts` (S)

| Tarea | Estimación |
|-------|-----------|
| Transición BORRADOR → CONFIRMADO | S |
| Insert customer_transactions PAYMENT | XS |
| Tests | S |

### E6.H04 Endpoints API payments (S)

| Tarea | Estimación |
|-------|-----------|
| GET/POST `/api/billing/payments` | S |
| GET/PATCH `/api/billing/payments/[id]` | S |
| POST confirm/void | S |
| POST apply/auto-apply | S |
| DELETE application | XS |
| Tests | M |

**Total E6:** ~1.5 semanas

---

## ÉPICA E7 · Mora

**Objetivo:** cron diario que aplica intereses por mora.

### E7.H01 Implementar `late-fees/calculator.ts` (S)

| Tarea | Estimación |
|-------|-----------|
| calcSimple, calcCompuesto | S |
| Unit tests (3% mensual, 30 días, etc.) | S |

### E7.H02 ★ Implementar `late-fees/cron.ts` (M)

| Tarea | Estimación |
|-------|-----------|
| Query facturas vencidas (descontando pagos aplicados) | M |
| Resolver rule por cliente (default vs override) | S |
| Loop con UNIQUE (invoice_id, period) | S |
| Insert charges + transactions | S |
| Email summary diario | S |
| Tests integration | M |

### E7.H03 Endpoints API late-fees (S)

| Tarea | Estimación |
|-------|-----------|
| GET/POST/PATCH/DELETE rules | S |
| GET charges | XS |
| POST cron (secret) | S |
| Tests | S |

### E7.H04 Configurar cron Netlify (XS)

| Tarea | Estimación |
|-------|-----------|
| `0 10 * * *` (07:00 ART) | XS |

**Total E7:** ~1 semana

---

## ÉPICA E8 · UI Facturación

**Objetivo:** todas las pantallas + wizards + UX premium.

### E8.H01 Shell `/billing` con tabs + KPIs top (M)

| Tarea | Estimación |
|-------|-----------|
| Refactor page.tsx a shell | M |
| Tabs: Emitidas/Recurrentes/Clientes/Cobros/Vencimientos/Directa | S |
| `<BillingTopKpis>` con 4 cards (MRR/Facturado/Pendiente/Mora) | S |
| Sidebar nav update | XS |
| Tests | S |

### E8.H02 Tab "Emitidas" (mover existente) (XS)

| Tarea | Estimación |
|-------|-----------|
| Mover `/billing/page.tsx` actual → `/billing/emitidas/page.tsx` | XS |

### E8.H03 ★ Wizard nuevo contrato recurrente (5 pasos) (XL)

| Tarea | Estimación |
|-------|-----------|
| Paso 1: cliente picker | S |
| Paso 2: frecuencia + plazos + payment_term | S |
| Paso 3: conceptos (líneas) con cálculo live | M |
| Paso 4: punto venta + ARCA params | S |
| Paso 5: revisión + activar/borrador | S |
| Validación + server action | M |
| Tests RTL | M |

### E8.H04 Detalle contrato `/billing/recurrentes/[id]` (M)

| Tarea | Estimación |
|-------|-----------|
| Header con resumen | XS |
| Tab Líneas (editor inline) | M |
| Tab Runs (timeline) | S |
| Tab Facturas (filtradas por contract via observ tag) | S |
| Tab Auditoría | S |
| Acciones: pausar/reanudar/cancelar/run manual/duplicar | M |
| Real-time subscription a runs | S |
| Tests | M |

### E8.H05 Pantalla "Aprobaciones" `/billing/recurrentes/aprobaciones` (S)

| Tarea | Estimación |
|-------|-----------|
| Lista BORRADORES pendientes | S |
| Botón "Aprobar y emitir" → ARCA | S |
| Botón "Rechazar" → anular borrador | S |
| Logging de approver = Ruth | XS |

### E8.H06 ★ Wizard facturación directa (4 pasos) `/billing/directa/nueva` (L)

| Tarea | Estimación |
|-------|-----------|
| Paso 1: cliente + tipo comprobante + PV | S |
| Paso 2: items inline editor (cantidad, precio, unidad m²/m³/etc) | M |
| Paso 3: vencimiento + moneda + cotización preview | S |
| Paso 4: revisión + flag auto-emit | S |
| Validación + action | S |
| Tests | M |

### E8.H07 Lista clientes `/billing/clientes` (M)

| Tarea | Estimación |
|-------|-----------|
| Tabla con saldo + buckets de mora | M |
| Filtros (al día / morosos / stop_billing) | S |
| Export CSV | S |
| Tests | S |

### E8.H08 ★ Detalle CC cliente `/billing/clientes/[clientId]` (L)

| Tarea | Estimación |
|-------|-----------|
| Header `<CustomerAccountSummary>` con saldo + vencimientos | M |
| Tab Movimientos `<TransactionLedger>` | M |
| Tab Facturas | S |
| Tab Cobros | S |
| Tab Contratos | S |
| Tab Auditoría | S |
| Real-time subscription | S |
| Acciones: nuevo cobro / ajuste manual / editar credit_limit | M |
| Tests | M |

### E8.H09 ★ Wizard cobros (3 pasos) `/billing/cobros/nuevo` (M)

| Tarea | Estimación |
|-------|-----------|
| Paso 1: cliente + monto + método | S |
| Paso 2: aplicación FIFO sugerida + manual | M |
| Paso 3: revisión + confirmar | S |
| Validación + action | S |
| Tests | M |

### E8.H10 Detalle cobro `/billing/cobros/[id]` (S)

| Tarea | Estimación |
|-------|-----------|
| Header + status badge | XS |
| Tabla aplicaciones | S |
| Acciones (anular, agregar app) | S |
| Tests | S |

### E8.H11 Vencimientos `/billing/vencimientos` (M)

| Tarea | Estimación |
|-------|-----------|
| Buckets crítico/atención/próximo | M |
| Acciones por factura (recordatorio, aplicar mora, ver) | S |
| Filtros por cliente | S |
| Tests | S |

### E8.H12 Config `/billing/config/*` (M)

| Tarea | Estimación |
|-------|-----------|
| CRUD payment_terms | S |
| CRUD late_fee_rules + asignación por cliente | M |
| Link a puntos_venta (existente en settings) | XS |
| Tests | S |

### E8.H13 Componentes reutilizables (M)

| Tarea | Estimación |
|-------|-----------|
| `<RecurringContractWizard>` | (cubierto en H03) |
| `<RecurringLineEditor>` | (cubierto en H03) |
| `<DirectInvoiceWizard>` | (cubierto en H06) |
| `<CustomerAccountSummary>` | M |
| `<AgedReceivablesTable>` | M |
| `<TransactionLedger>` | M |
| `<PaymentWizard>` | (cubierto en H09) |
| `<PaymentApplicationTable>` | S |
| `<DueDateBucket>` | S |
| `<RunStatusTimeline>` | M |
| `<ExchangeRateBadge>` | S |
| Badges: contract status, run status | S |

**Total E8:** ~5 semanas

**GATE 3:** UI completa en sandbox. **→ aprobación usuario + Ruth**

---

## ÉPICA E9 · Dashboard ejecutivo

**Objetivo:** widgets en `/ejecutivo`.

### E9.H01 ★ Widget MRR/ARR (S)

| Tarea | Estimación |
|-------|-----------|
| Endpoint `/api/billing/kpi/mrr` | S |
| Component `<MRRWidget>` con animación nexus-page-fade | S |
| Tests | S |

### E9.H02 Widget Facturación mes (S)

| Tarea | Estimación |
|-------|-----------|
| Endpoint `/api/billing/kpi/facturacion-mes` | S |
| Component con sparkline (reuse existente) | S |
| Tests | S |

### E9.H03 Widget Cobranza pendiente (S)

| Tarea | Estimación |
|-------|-----------|
| Endpoint `/api/billing/kpi/cobranza-pendiente` | S |
| Component con breakdown | S |
| Tests | S |

### E9.H04 ★ Widget Clientes morosos (M)

| Tarea | Estimación |
|-------|-----------|
| Endpoint `/api/billing/kpi/morosos` | S |
| Component con pattern Compliance Engine (score + buckets) | M |
| Drill-down a top moroso | S |
| Tests | S |

### E9.H05 Widget Proyección futura (S)

| Tarea | Estimación |
|-------|-----------|
| Endpoint `/api/billing/kpi/proyeccion` (3 meses) | S |
| Component con preview | S |
| Tests | S |

### E9.H06 Integración en `/ejecutivo/page.tsx` (S)

| Tarea | Estimación |
|-------|-----------|
| Nueva `<section>` con grid de 5 widgets | S |
| Sin tocar widgets existentes | XS |
| Tests | S |

**Total E9:** ~1 semana

**GATE 4:** dashboard listo. **→ aprobación JL**

---

## ÉPICA E10 · Deploy a producción

**Objetivo:** subir todo a prod con rollback validado.

### E10.H01 ★ Pre-flight prod (S)

| Tarea | Estimación |
|-------|-----------|
| Confirmar backup externo verificado | XS |
| Confirmar RBAC seedeado | XS |
| Confirmar tests sandbox 100% PASS últimos 7 días | XS |
| Confirmar plan de rollback validado | S |

### E10.H02 ★ Aplicar 0014 en producción (M)

| Tarea | Estimación |
|-------|-----------|
| Horario madrugada acordado | XS |
| `supabase migration up --linked` en prod | XS |
| Verificar `migration list` | XS |
| Smoke tests post-migration (insert/select cada tabla) | S |
| Plan B: rollback con down-migration | S |

### E10.H03 ★ Deploy Netlify (S)

| Tarea | Estimación |
|-------|-----------|
| `npm run build` local | XS |
| `npx netlify deploy --prod --dir=.next` | XS |
| Smoke tests prod | S |
| Verificar scheduled functions configuradas | S |

### E10.H04 ★ Smoke tests prod (S)

| Tarea | Estimación |
|-------|-----------|
| RLS T1-T12 en prod | M |
| Crear contrato test | XS |
| Dry-run | XS |
| Confirmar cobro test | XS |
| Verificar dashboard widgets | XS |

**Total E10:** ~3 días

**GATE 5:** producción viva. **→ aprobación DevOps + Usuario**

---

## ÉPICA E11 · Operación supervisada (30 días)

**Objetivo:** monitorear, ajustar, cerrar FASE 1A.

### E11.H01 Monitoring & alertas (S)

| Tarea | Estimación |
|-------|-----------|
| Alerts por run FAILED | S |
| Alerts por reconcile drift | S |
| Dashboard ops privado | M |

### E11.H02 Validación semanal con Ruth (recurrente)

| Tarea | Estimación |
|-------|-----------|
| Reunión semanal × 4 | XS cada vez |
| Documentar discrepancias | XS |

### E11.H03 Ajustes según feedback (S, recurrente)

| Tarea | Estimación |
|-------|-----------|
| Hot-fixes no críticos | XS-S |
| UX tweaks | XS |

### E11.H04 Reporte de cierre `FASE-1A-CLOSURE-REPORT.md` (S)

| Tarea | Estimación |
|-------|-----------|
| Métricas vs target | S |
| Lecciones aprendidas | S |
| Próximos pasos (FASE 1B follow-up o FASE 2) | XS |

**Total E11:** 30 días calendario (mostly passive)

**GATE 6:** FASE 1A cerrada. **→ firma JL + Ruth**

---

## Sumario por estimación

| Épica | Cantidad H | Estimación |
|-------|------------|------------|
| E0 — Pre-flight | 7 | 1-2 sem (bloqueante externo) |
| E1 — Schema | 7 | 3 sem |
| E2 — Exchange Rate | 4 | 1 sem |
| E3 — Motor recurrente | 7 | 3 sem |
| E4 — Facturación directa | 4 | 1.5 sem |
| E5 — Cuenta corriente | 4 | 1 sem |
| E6 — Cobros | 4 | 1.5 sem |
| E7 — Mora | 4 | 1 sem |
| E8 — UI Facturación | 13 | 5 sem |
| E9 — Dashboard | 6 | 1 sem |
| E10 — Deploy | 4 | 0.5 sem |
| E11 — Operación supervisada | 4 | 30 días (calendario, no FT) |
| **TOTAL desarrollo** | **64 H · 124 tareas** | **~14 semanas calendario** |

---

## Dependencias críticas

```
E0 (pre-flight)
  │
  ▼
E1 (schema)
  │
  ├─► E2 (exchange-rate)
  │       │
  │       ▼
  ├─► E3 (motor recurrente) ◄─── E2
  │       │
  │       ▼
  ├─► E4 (facturación directa) ◄── E2
  │       │
  │       ▼
  ├─► E5 (cuenta corriente)
  │       │
  │       ▼
  ├─► E6 (cobros)
  │       │
  │       ▼
  └─► E7 (mora)
          │
          ▼
       E8 (UI) ◄── E3, E4, E5, E6, E7
          │
          ▼
       E9 (dashboard) ◄── E1-E7
          │
          ▼
       E10 (deploy)
          │
          ▼
       E11 (operación)
```

**Critical path:** E0 → E1 → E3 → E8 → E10 → E11 ≈ 12 semanas mínimo.

---

## Bloqueantes externos (NO codificables)

| Bloqueante | Owner | Estado |
|------------|-------|--------|
| Backup externo Supabase configurado | DevOps | ❌ |
| RBAC seedeado | Admin DB + Usuario | ❌ |
| Decisiones FASE 1A §8 | Usuario | ✅ APROBADAS |

---

## Riesgos del backlog

| Riesgo | Mitigación |
|--------|------------|
| E3.H03 (engine) subestimado por idempotencia + cotización + emit | Buffer 30% en sizing |
| E8 (UI) explota por componentes nuevos no estimados individualmente | Diseño detallado en H13 antes de empezar |
| E11 (30 días) no es código pero bloquea cierre | Aceptado como gate |
| Ruth no disponible para approvals en E8 GATE 3 | Backup admin con permisos |
| BCRA API cambia formato (E2) | Mock + fallback ya planeado |

---

## Convención de tickets (cuando se convierta a Jira/Linear/GitHub Issues)

```
[FASE-1A][Eipca-N.HXX] Título corto

Descripción del scope.

Criterios de aceptación:
- [ ] Item 1
- [ ] Item 2
- [ ] Tests pasan
- [ ] Documentación actualizada

Bloqueantes: [E0.H03]
Bloquea a: [E3.H03]

Definition of Done:
- [ ] Code review aprobado
- [ ] Tests verde en CI
- [ ] Typecheck + build verdes
- [ ] Sin warnings nuevos
- [ ] Doc actualizada si aplica
```

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR — todo el backlog es planning
- 🛑 NO ABRIR tickets reales
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO INVENTAR estimaciones — todas basadas en alcance verificable
