# FASE 1C · ARCHITECTURE REVIEW

**Fecha:** 2026-05-29
**Scope:** revisión adversarial de toda la documentación FASE 1A + FASE 1B + AMENDMENT ARS.
**Modo:** `NO ASUMIR · VERIFICAR` — cada hallazgo trazado a archivo:línea.
**Objetivo:** intentar romper el diseño antes de codear.
**Restricciones:** sin código, sin migración, sin deploy.

---

## 🟡 Veredicto final

> **🟡 IMPLEMENTAR CON CAMBIOS** — el diseño es **estructuralmente sólido** pero tiene **3 fallas críticas + 4 altas** que deben resolverse en un AMENDMENT V2 antes de comenzar implementación.

**Razón:** la regla de decisión aplicada anteriormente (1 crítico O 2 altos → detener) se activa, pero las fallas son **fixables a nivel diseño** sin rediseño arquitectónico. No se requiere 🔴 REDISEÑAR.

---

## Tabla solicitada — resultados objetivos

| Área | Resultado | Notas |
|------|-----------|-------|
| **Data Model** | 🟡 **PASS con cambios** | Sólido. 3 ajustes menores requeridos (UNIQUE code, redundancia applies_to_tx_id, REFUND semántica) |
| **Billing Engine** | 🔴 **FAIL** | 3 problemas críticos: timeout cron, next_run_date en SKIPPED, splits payment_terms |
| **Account Current** | 🟡 **PASS con cambios** | Funcional. Falta detalle flujo Notas de Crédito + anticipos |
| **Security** | ✅ **PASS** | RLS + RBAC + storage validados; gaps menores en audit forense |
| **Scalability** | 🔴 **FAIL** | No escala más allá de ~200-300 contratos sin re-arquitectura del cron |
| **Operations Fit** | 🟡 **PASS con cambios** | Cubre casos TOPS reales pero falta mid-cycle changes + descuentos |

---

## Hallazgos críticos (3)

### 🚨 C1 — Performance del batch cron supera timeout Netlify

**Evidencia:**
- `FASE-1B-MODULES.md:303` — `WHERE status='ACTIVO' AND next_run_date <= current_date` (loop por cada contrato)
- `FASE-1B-API-DESIGN.md:section 2.4` — batch processing dentro de `runScheduledBatch`
- Netlify Scheduled Functions: **timeout default 10s, hard limit 26s** (verificado en docs Netlify)
- Netlify Background Functions: timeout 15 min (NO Scheduled)

**Cálculo:**
- 1 `runContract()` ≈ 1-2 segundos (estimado del doc: `~30-60s para ~50 contratos` en `FASE-1A-IMPACT.md`)
- 50 contratos × 1.5s = 75s → **excede los 26s del scheduled function**
- 100 contratos = 150s
- 1000 contratos = 25 min (excede incluso background functions)

**Vector de falla real:**
- TOPS hoy tiene 30-50 clientes potenciales con contratos. Si el cron de FASE 1A toma 75s y Netlify mata el proceso a los 26s → quedan ~30 contratos sin procesar.
- Esos contratos quedan con `runs.status='PENDIENTE'` huérfanos (UNIQUE índice viola próximo intento).
- Ruth no se entera porque el email-summary nunca se dispara.

**Impacto:** facturación recurrente parcial → discrepancias con clientes → pérdida de confianza en el sistema.

**Fix propuesto V2:**
1. Cambiar `scheduled function` (26s) a **`background function`** (15 min) — incompatible con cron Netlify nativo, requiere proxy:
   - Scheduled function (26s) dispara HTTP POST a background function (15 min) y retorna inmediato
   - Background function corre el batch real
2. **O:** dividir batch en chunks de 10-15 contratos por invocación + chain scheduled invocations
3. **O:** usar Inngest/Trigger.dev (proveedor de queues serverless)

**Recomendación:** Opción 1 (background function trigger desde scheduled). Sin lock-in adicional.

---

### 🚨 C2 — `next_run_date` no se actualiza en runs SKIPPED → loop infinito

**Evidencia:**
- `FASE-1B-MODULES.md:286` — paso 13 del runContract: `Update recurring_contracts.next_run_date = period-calculator.calcNext(periodo, frequency)` — **dentro del path OK (líneas 286-287)**
- `FASE-1B-MODULES.md:264-269` — validaciones SKIPPED retornan ANTES del paso 13
- **No hay actualización de `next_run_date` en SKIPPED**

**Vector de falla real:**

Escenario A — tolerancia ARS 100:
- Contrato C-X tiene línea de "ajuste menor" total = $80 ARS
- Día 1: cron corre → total < 100 → SKIPPED reason='BELOW_TOLERANCE_ARS_100'
- `next_run_date` queda en día 1 (mismo período)
- Día 2: cron corre? **NO porque schedule es día 1**. Pero si ejecutas `MANUAL run` o `BACKFILL`:
  - Cada intento manual → SKIP otra vez
  - UNIQUE `(contract_id, periodo) WHERE status IN ('OK','PENDIENTE')` permite múltiples SKIPPED → tabla crece sin valor
- Mes siguiente: día 1 cron corre → mismo período (porque `next_run_date` quedó en día 1 del mes pasado y `<= current_date` matchea otra vez) — **doble facturación del mismo período**

Escenario B — contrato pausado mid-mes:
- Día 5: usuario pausa contrato
- Día 10: cron NO corre (próximo cron día 1)
- Día 15: usuario reanuda → debate si `next_run_date` se resetea (no documentado claramente)

**Impacto:** doble facturación o loop de SKIPPED dependiendo del flujo.

**Fix propuesto V2:**
1. **SIEMPRE** actualizar `next_run_date` después del run, sea OK / SKIPPED / FAILED
2. Excepción: si SKIPPED por `BELOW_TOLERANCE` → avanzar próximo período pero registrar alerta administrativa para que Ruth ajuste la línea
3. Documentar comportamiento exacto en `FASE-1B-MODULES.md §3.3`

---

### 🚨 C3 — `payment_terms` con `splits` NO crea múltiples transactions

**Evidencia:**
- `FASE-1A-DATA-MODEL.md:62-63` — `payment_terms.splits jsonb` define múltiples vencimientos
- `FASE-1B-MODULES.md:130-135` — `buildDueDates()` retorna `DueDateSlice[]` con N entradas
- `FASE-1B-MODULES.md:283-285` — runContract inserta **UNA** `customer_transactions` con `due_date = first_due_date_from_payment_term`
- `customer_invoices.fch_vto_pago` (mig 0011) es **una sola fecha** (DATE, no array)

**Vector de falla real:**

Cliente paga 30/60/90 días, factura $1.500.000:
- Día emisión: 01/Jun
- Cuotas teóricas: $500k el 01/Jul, $500k el 01/Aug, $500k el 01/Sep
- Sistema actual:
  - 1 customer_invoices con `fch_vto_pago = 01/Jul`
  - 1 customer_transactions type=INVOICE direction=DEBIT amount=$1.5M `due_date = 01/Jul`
- Resultado:
  - Aging muestra factura como "vence 01/Jul" (1 fecha)
  - Si cliente paga $500k el 01/Jul, queda saldo $1M que aparece como "vencido 0d"
  - Pero **realmente vencen $500k el 01/Aug y $500k el 01/Sep, no $1M el 01/Jul**
  - Aging engaña al operador

**Impacto:** mora aplicada incorrectamente (3% sobre $1M cuando solo $500k está realmente vencido). Cobranza distorsionada.

**Fix propuesto V2:**

Opción A — N transactions:
- En lugar de 1 transaction = $1.5M, generar 3 transactions = $500k cada una con `due_date` propio
- Aging funciona correctamente
- `customer_invoices.total = $1.5M` se mantiene (ARCA requiere total único)
- Documentar que la factura ARCA es 1, pero el ledger interno tiene N entries

Opción B — Tabla nueva `customer_invoice_due_dates`:
- 1:N entre invoice y vencimientos
- Aging usa esta tabla en lugar de transactions
- Complejidad adicional pero más limpio

**Recomendación:** Opción A. Más simple, reusa ledger, aging correcto.

---

## Hallazgos altos (4)

### 🔴 H1 — `recurring_contracts.code` UNIQUE global → conflictos UX

**Evidencia:**
- `FASE-1A-MIGRATION-0014.md:134` — `code text not null unique` (sin scope)

**Problema:**
- Si BIDCOM tiene contrato `C-ANMAT-22M2-2026` y BAGÓ tiene `C-ANMAT-22M2-2026` (misma estructura, distinto cliente) → conflicto al crear el 2do
- Ruth debe inventar codes únicos artificialmente (`C-ANMAT-22M2-BIDCOM-2026`, `C-ANMAT-22M2-BAGO-2026`)
- Friction UX + inconsistencia (¿qué pasa con clientes nuevos?)

**Fix V2:**
```diff
- code text not null unique,
+ code text not null,
+ unique (client_id, code)
```

Trivial. Sin impacto de performance (UNIQUE compuesto está indexado igual).

---

### 🔴 H2 — Runs colgados en `PENDIENTE` sin mecanismo de cleanup

**Evidencia:**
- `FASE-1B-MODULES.md:245-251` — `runContract` inserta `recurring_runs PENDIENTE` con UNIQUE constraint
- No hay timeout / TTL para passar PENDIENTE → FAILED automáticamente
- `FASE-1A-MIGRATION-0014.md` UNIQUE: `where status in ('OK','PENDIENTE')` — bloquea retries

**Vector real:**
- Cron arranca, INSERT PENDIENTE, llama emit.ts → ARCA cuelga 60s → Netlify mata proceso
- Row PENDIENTE queda huérfana
- Próximo cron / manual run → UNIQUE viola → SKIPPED reason='ALREADY_RUN_FOR_PERIOD'
- Operador ve "ya hay un run" pero la factura nunca se materializó

**Fix V2:**
1. Cron de cleanup: si `recurring_runs.status='PENDIENTE' AND created_at < now() - 1 hour` → update a `FAILED` con error_message='Timeout / orphan run'
2. O: agregar `expires_at` column con default now() + 1h. Cleanup query: WHERE expires_at < now() AND status='PENDIENTE'
3. Endpoint admin `POST /api/billing/recurring/runs/[id]/reset` (force a FAILED para retry)

---

### 🔴 H3 — ARCA timeout durante `runContract` deja estado inconsistente

**Evidencia:**
- `FASE-1B-MODULES.md:285-289` — paso 10 del runContract: `emit.ts dispara ARCA WSFEv1` sin timeout explícito
- `src/lib/arca/*` existente (no modificado) tiene retries pero el timeout no se propaga al engine
- Función Netlify scheduled tiene 26s hard limit

**Vector real:**
- runContract llega a paso 10 (ARCA call)
- ARCA tarda 30s → Netlify mata proceso
- `customer_invoices` ya está creada con `estado_arca='PENDIENTE_ARCA'`
- `recurring_runs.status='PENDIENTE'`
- `customer_transactions` NO se creó (paso 11)
- Resultado: factura "fantasma" en PENDIENTE_ARCA + run huérfano + sin movimiento en CC

**Fix V2:**
1. Wrap ARCA call con `Promise.race([emit, timeout(20s)])` → si timeout, marcar run FAILED + invoice ERROR_ARCA + NO crear transaction
2. Job de retry diario: query invoices PENDIENTE_ARCA con age > 1h → reintentar emit con backoff
3. Mover ARCA call **fuera** del runContract → patrón: runContract crea invoice BORRADOR, queue separate emite ARCA después. Decoupling temporal.

**Recomendación:** Opción 3 — desacoplar creación de factura de emisión ARCA. runContract es síncrono y rápido (creación de invoice). Emisión ARCA es asíncrona (queue).

---

### 🔴 H4 — View `customer_balances` no escala más allá de ~1k clientes

**Evidencia:**
- `FASE-1A-MIGRATION-0014.md` view `customer_balances`: LEFT JOIN customer_transactions + SUM agregado + GROUP BY
- `FASE-1A-IMPACT.md` estimación: 5000 transactions/año @ 30-50 clientes = 100-200 tx/cliente
- Con 1000 clientes × 5 años × 200 tx/cliente = **1M filas en customer_transactions**
- Query GROUP BY agregado sin materialized view → lectura full-scan

**Test conceptual (`p99 < 500ms` declarado en FASE-1A-IMPACT.md):**
- 30 clientes hoy: <50ms p99 ✓
- 100 clientes: <100ms p99 ✓
- 1000 clientes con 200 tx/cliente: ~500-1000ms p99 — **degrada, no falla**
- 10000 clientes con 1000 tx/cliente: >5s p99 — **falla**

**Fix V2:**
1. Documentar límite ~1k clientes para FASE 1A
2. Cuando supere → migrar a **materialized view + refresh cada 5 min**
3. Backstop: agregar `customer_accounts.cached_balance numeric(15,2)` mantenido por trigger; usar para listados (acepta drift de unos minutos), view solo para detalle

---

## Hallazgos medios (6)

### 🟡 M1 — `applies_to_tx_id` redundante con `customer_payment_applications`

**Evidencia:**
- `FASE-1A-DATA-MODEL.md:tabla customer_transactions` campo `applies_to_tx_id` (self-ref)
- `FASE-1A-DATA-MODEL.md:section 8` — `customer_payment_applications` ya modela M:N pagos↔facturas

**Problema:** dos fuentes de verdad para "este payment paga esta factura". Confusión semántica.

**Fix V2:** eliminar `applies_to_tx_id` de `customer_transactions`. Usar solo `customer_payment_applications`.

---

### 🟡 M2 — Audit forense limitado (sin IP, sin request_id en transactions)

**Evidencia:**
- `FASE-1A-DATA-MODEL.md customer_transactions` campos audit: `created_by`, `voided_by`, `created_at`, `voided_at`, `voided_reason`
- Faltan: `created_by_ip`, `request_id` para correlación con logs

**Impacto:** si hay sospecha de fraude o manipulación, no se puede correlacionar transactions con requests específicos sin recurrir a logs Netlify.

**Fix V2:** agregar `created_by_request_id text` para correlación con `logBilling` structured logs.

---

### 🟡 M3 — Flujo de Notas de Crédito incompleto

**Evidencia:**
- `customer_invoices.comprobante_asociado_id` (mig 0011) existe → permite emitir NC vinculada
- `customer_transactions.type='CREDIT_NOTE'` enum existe
- Pero NO está detallado: ¿cómo se desaplican payments existentes? ¿Qué pasa con late_fee_charges ya aplicados a la factura anulada?

**Fix V2:** agregar sub-doc `FASE-1A-CREDIT-NOTE-FLOW.md` con secuencia detallada.

---

### 🟡 M4 — Anticipos (unapplied_amount) no tienen flujo de aplicación futura

**Evidencia:**
- `customer_payments.unapplied_amount` queda como anticipo
- NO está detallado: ¿cómo Ruth "toma" del anticipo para una nueva factura? No hay endpoint específico ni UX.

**Fix V2:** definir endpoint `POST /api/billing/payments/[id]/applications` permite aplicar payment EXISTENTE a una nueva factura → reduce unapplied_amount + crea application + crea transaction.

---

### 🟡 M5 — Mid-cycle changes a contratos no abordados

**Evidencia:**
- Caso real: cliente BIDCOM agrega 50 m² adicional el 15 de mes
- Modelo: edita `recurring_contract_lines` → próximo run del 01 incluye el ajuste
- Pero NO está claro: ¿se cobra proporcional desde el 15? ¿O desde el 01 del mes siguiente?
- UX wizard no aborda "ajuste mid-cycle" como acción explícita

**Fix V2:** documentar política operativa:
- Opción A: cambios siempre prorratean desde fecha de cambio (requiere lógica adicional)
- Opción B: cambios efectivos desde próximo período (simple, recomendado)
- Agregar flag `effective_from date` en `recurring_contract_lines` para tracking

---

### 🟡 M6 — REFUND vs ADJUSTMENT vs CREDIT_NOTE semántica confusa

**Evidencia:**
- `customer_transaction_t` enum tiene: INVOICE | CREDIT_NOTE | DEBIT_NOTE | PAYMENT | ADJUSTMENT | LATE_FEE | REFUND
- 3 tipos para "ajuste/reverso" sin distinción clara cuándo usar cuál

**Fix V2:** documentar en sección comentarios:
- CREDIT_NOTE: solo si hay NC fiscal emitida (vinculada a `customer_invoices.comprobante_asociado_id`)
- REFUND: devolución de dinero al cliente (típico en cancelación de servicio)
- ADJUSTMENT: ajuste contable interno sin documento fiscal (corrección de error)

---

## Hallazgos bajos (4)

### 🟢 L1 — `triggered_by='BACKFILL'` sin caso documentado

**Evidencia:** `recurring_runs.triggered_by` enum tiene BACKFILL pero no se describe caso de uso.

**Fix:** documentar (carga histórica de períodos pasados) o eliminar.

### 🟢 L2 — Rotación de secret del cron no documentada

**Evidencia:** `FASE-1B-ROLLOUT.md` menciona `NETLIFY_SCHEDULED_FUNCTION_SECRET` pero no plan de rotación.

**Fix:** documentar rotación trimestral.

### 🟢 L3 — Descuentos comerciales / bonificaciones no modelados

**Evidencia:** `recurring_contract_lines.precio_unitario` directo. No hay campo `discount_pct`.

**Fix:** dejar como follow-up FASE 1B-bis si Ruth lo necesita. Workaround actual: línea negativa.

### 🟢 L4 — `compounding_t = COMPUESTO` raramente usado en mora ARS

**Evidencia:** late_fee_rules.compounding enum.

**Fix:** mantener (coste cero). Documentar default SIMPLE.

---

## Revisión por área detallada

### Data Model — 🟡 PASS con cambios

**Aspectos verificados PASS:**
- ✅ 10 tablas + 1 view sin redundancia estructural mayor
- ✅ Enums bien definidos (10 tipos)
- ✅ Cardinalidades coherentes (`FASE-1A-RELATIONS.md`)
- ✅ Índices apropiados (~15 incluidos)
- ✅ Snapshot del receptor en `customer_invoices` evita drift
- ✅ Append-only via trigger lock pattern (replica `tg_lock_authorized_invoice`)
- ✅ UNIQUE en `(invoice_id, period)` evita doble mora del mismo mes
- ✅ Patrones polimórficos con `source_table + source_id` documentados

**Cambios requeridos:**
- 🟡 H1: `code` UNIQUE → `unique(client_id, code)`
- 🟡 M1: eliminar `applies_to_tx_id` (redundante)
- 🟡 M2: agregar `created_by_request_id`

### Billing Engine — 🔴 FAIL

**Aspectos verificados PASS:**
- ✅ Idempotencia con UNIQUE en runs
- ✅ Separación contrato → run → invoice clara
- ✅ Lógica de cálculo encapsulada
- ✅ Approval flow (Ruth) bien diseñado
- ✅ Auto-emit opt-in

**Fallas críticas:**
- 🚨 C1: Timeout cron (bloqueante)
- 🚨 C2: `next_run_date` en SKIPPED (bloqueante)
- 🚨 C3: Splits payment_terms (bloqueante)
- 🔴 H2: Runs colgados en PENDIENTE
- 🔴 H3: ARCA timeout durante runContract

### Account Current — 🟡 PASS con cambios

**Aspectos verificados PASS:**
- ✅ Ledger append-only fundamentado
- ✅ Trigger lock posted
- ✅ Aging con buckets 0-30, 30-60, 60-90, 90+
- ✅ Reconcile placeholder
- ✅ View RLS-bound

**Cambios requeridos:**
- 🟡 M3: Flujo de NC incompleto
- 🟡 M4: Flujo de anticipos no detallado
- 🟡 M6: Semántica REFUND/ADJUSTMENT/CREDIT_NOTE

### Security — ✅ PASS

**Aspectos verificados PASS:**
- ✅ RLS patterns replicados de mig 0011/0013 (validados en GATE 2)
- ✅ RBAC con R22 closure (service_role solo para seed-check)
- ✅ Storage multi-tenant con `split_part(name,'/',1)`
- ✅ Trigger lock impide tampering post-posted
- ✅ Append-only ledger
- ✅ Audit trail vía `invoice_audit` reusado + nuevos triggers

**Gaps menores:**
- 🟢 L2: Rotación de secret no documentada
- 🟡 M2: Audit forense sin request_id

### Scalability — 🔴 FAIL

**Aspectos verificados PASS:**
- ✅ Hasta ~100 clientes: funciona sin issues
- ✅ Hasta ~300 clientes: funciona con margen apretado
- ✅ Storage Drive escala 10-20 GB/año cómodo

**Fallas:**
- 🚨 C1: Batch cron no escala (≥50 contratos riesgo timeout)
- 🔴 H4: View customer_balances degrada >1k clientes

**Test conceptual de simulación:**

| Escala | Batch cron 1 contrato/2s | View balance p99 | Veredicto |
|--------|--------------------------|-------------------|-----------|
| 100 clientes | 200s total · OK con chunks | <100ms | ✅ OK con C1 fix |
| 1000 clientes | 2000s · necesita queue | ~500ms | 🟡 marginal |
| 10000 clientes | 5.5h · imposible sin queues | >5s | 🔴 falla |

TOPS hoy = 30-50 clientes potenciales. FASE 1A cubierta. Pero el diseño DEBE documentar el cap.

### Operations Fit — 🟡 PASS con cambios

**Casos reales TOPS verificados:**

| Caso | Soporte modelo | Status |
|------|----------------|--------|
| ANMAT 22 m² | `categoria=ALMACENAJE_ANMAT, unidad='m2', cantidad=22` | ✅ |
| ANMAT 50 m² | idem | ✅ |
| ANMAT 100 m² | idem | ✅ |
| ANMAT 100 m³ | `unidad='m3'` | ✅ (post-AMENDMENT V1.1) |
| Cargas Generales m² | `categoria=ALMACENAJE_GRAL, unidad='m2'` | ✅ |
| Cargas Generales m³ | idem `unidad='m3'` | ✅ |
| Oficinas privadas | `categoria=OFICINA_PRIVADA, cantidad=1, unidad='mes'` | ✅ |
| Coworking | `categoria=OFICINA_COWORKING, cantidad=N, unidad='puesto'` | ✅ |
| Oficina temporal | `categoria=OFICINA_TEMPORAL, end_date set` | ✅ |
| Servicio recurrente sin OS | `recurring_contracts` directo | ✅ |
| Abono mensual fijo | `categoria=ABONO` | ✅ |
| Facturación directa | `invoices-direct/emit.ts` | ✅ |
| Desde OS existente | `invoices-direct/from-order.ts` | ✅ |

**Cambios requeridos:**
- 🟡 M5: Mid-cycle changes (operador agrega 50 m² mid-mes)
- 🟢 L3: Descuentos comerciales (no urgente)

---

## Sobre-ingeniería detectada

### ❌ NO sobre-ingeniería significativa

**Análisis:**

| Componente | ¿Sobre-ingeniería? | Justificación |
|------------|---------------------|---------------|
| Separación `customer_accounts` vs `clients` | NO | Separation of concerns |
| `customer_transactions` ledger | NO | Fuente única de verdad |
| `customer_payments` + applications M:N | NO | Casos reales lo requieren |
| `late_fee_rules` tabla vs config | NO | Permite reglas por cliente |
| `recurring_runs` tabla | NO | Idempotencia crítica |
| `exchange_rates_log` | ELIMINADA ✓ | (AMENDMENT ARS) |
| `compounding_t=COMPUESTO` | LEVE | Coste casi cero, mantener |
| `triggered_by=BACKFILL` | LEVE | Documentar o eliminar (L1) |
| 9 permisos RBAC granulares | NO | Real-world segregation of duties |

**Verdict:** diseño bien dimensionado. Sin pruning agresivo necesario.

---

## Tablas innecesarias detectadas

❌ **NINGUNA tabla innecesaria detectada.**

Cada tabla justifica su existencia:
- `payment_terms` → catálogo configurable
- `recurring_contracts` → header + metadata
- `recurring_contract_lines` → items
- `recurring_runs` → idempotencia + audit
- `customer_accounts` → config por cliente
- `customer_transactions` → ledger
- `customer_payments` → header de cobro
- `customer_payment_applications` → M:N
- `late_fee_rules` → catálogo
- `customer_late_fee_charges` → instancias

---

## Módulos redundantes detectados

❌ **NINGÚN módulo redundante** post-AMENDMENT ARS (`exchange-rate/` ya eliminado).

---

## APIs innecesarias detectadas

| Endpoint | ¿Necesaria? | Notas |
|----------|-------------|-------|
| `POST /api/billing/recurring/contracts/[id]/duplicate` | NO crítica | Mencionada en UX pero no en API design. Si se implementa, hacerla server action no API. |
| `GET /api/billing/health` | SÍ | Para monitoring |

❌ **Sin APIs sobrantes.**

---

## Lock-in detectado

| Dependencia | Severidad | Mitigación |
|-------------|-----------|------------|
| **Supabase RLS** | media | Migrar a Postgres nativo requiere reescribir `auth.uid()`/`auth.role()`. Aceptable (~1 semana). |
| **Netlify Scheduled Functions** | media | Migrar a Vercel cron / Cloudflare workers requiere reescribir entrypoints. Aceptable. |
| **Netlify Background Functions** (si se adopta fix C1) | media | Idem. |
| **ARCA WSFEv1** | alta | Inevitable — es el estándar legal AR. |
| **Resend** | baja | Reemplazable por cualquier SMTP en 1 día. |
| **BCRA API** | N/A | Ya eliminada por AMENDMENT |

**Verdict:** lock-in razonable. Sin nada bloqueante.

---

## Problemas de mantenimiento detectados

| # | Problema | Severidad |
|---|----------|-----------|
| 1 | 7 triggers nuevos = alta carga cognitiva | 🟡 medio |
| 2 | ~25 RLS policies sin script de validación periódica | 🟡 medio |
| 3 | 2 crons sin dashboard de health centralizado | 🟡 medio |
| 4 | Idempotency keys sin TTL documentado (si se implementa) | 🟢 bajo |

**Mitigación recomendada:**
- Script `npm run check-rls` que valide policies vs `FASE-1A-RLS.md` esperado
- Dashboard ops privado con últimos N runs de cada cron
- Documentar troubleshooting playbook

---

## Riesgos operativos detectados

| # | Riesgo | Severidad | Mitigación |
|---|--------|-----------|------------|
| 1 | Ruth aplica un cobro a factura errónea por confusión UX | 🟡 medio | Confirmación con texto a tipear |
| 2 | Operador edita line de contrato mid-cycle sin entender impacto | 🟡 medio | UI warning + audit log |
| 3 | Cron Netlify falla silenciosamente (sin alerta) | 🔴 alto | Health endpoint + alerta si último run > 32 días |
| 4 | Cliente sin email recibe NC pero no se entera | 🟢 bajo | Validación pre-emisión + log |
| 5 | Discrepancia entre `customer_invoices.total` y `customer_transactions.amount` | 🔴 alto | Trigger de consistencia o test diario |

---

## Plan de cambios para AMENDMENT V2

Antes de implementar, generar `FASE-1B-AMENDMENT-V2-FIXES.md` con:

### Cambios al data model (V1.3)

1. **C2 fix:** Documentar que `next_run_date` SE ACTUALIZA en todos los runs (OK + SKIPPED tolerance). Para SKIPPED por error técnico (CONTRACT_NOT_ACTIVE, etc.), NO actualizar.
2. **C3 fix:** `runContract` y `emitDirectInvoice` insertan N transactions cuando `payment_term.is_split=true`. Una transaction por cada slice con `due_date` propio.
3. **H1 fix:** `recurring_contracts.code` cambia a `unique(client_id, code)`.
4. **M1 fix:** Eliminar `customer_transactions.applies_to_tx_id`. Solo `customer_payment_applications`.
5. **M2 fix:** Agregar `customer_transactions.created_by_request_id text`.

### Cambios al motor recurrente

6. **C1 fix:** Arquitectura nueva del cron:
   - Scheduled function (26s) recibe trigger, retorna inmediato
   - Spawn de **background function** con chain de chunks de 15 contratos
   - Background function tiene 15min para procesar todo
7. **H2 fix:** Cron de cleanup diario: SET FAILED en runs PENDIENTE > 1 hora.
8. **H3 fix:** ARCA call con timeout 20s. Si timeout → run FAILED + invoice ERROR_ARCA. Job separado retry ARCA con backoff.
9. **C2 fix:** Update `next_run_date` siempre, excepto en FAILED genuino.

### Cambios al API design

10. Agregar `POST /api/billing/payments/[id]/applications` (anticipos)
11. Agregar `POST /api/billing/recurring/runs/[id]/reset` (admin)
12. Agregar `GET /api/billing/health`
13. Eliminar campos `applies_to_tx_id` de schemas Zod

### Cambios al UX

14. **M5 fix:** En wizard edición de líneas, opción "Efectivo desde": Próximo período (default) o Período actual (con warning + proration)
15. Documentar acción "Aplicar anticipo a nueva factura" desde CC cliente

### Cambios al rollout

16. Agregar **3rd cron**: `recurring/cleanup` diario (8:00 ART) — limpia runs PENDIENTE huérfanos
17. Documentar **límite ~1k clientes** en FASE 1A → migrar a materialized view cuando se supere
18. Agregar **dashboard ops** con health de los 3 crons

### Cambios al risks

19. Eliminar/refactor F1.R01 (doble facturación) — el fix C2 lo cierra
20. Agregar nuevos riesgos del fix C1 (background function ≠ scheduled — vector ataque distinto)

### Total estimado

- ~3-4 días de re-documentación V2
- ~1 semana de impacto en backlog (E3 + E8 modificados)
- Cronograma global se mantiene en ~12 semanas (los fixes son focales)

---

## Tabla resumen de fallas

| ID | Severidad | Hallazgo | Fix V2 |
|----|-----------|----------|--------|
| C1 | 🚨 Crítico | Timeout cron en batch | Background function |
| C2 | 🚨 Crítico | `next_run_date` no actualizado en SKIPPED | Update siempre |
| C3 | 🚨 Crítico | `splits` no crea N transactions | Loop por slice |
| H1 | 🔴 Alto | `code` UNIQUE global | `unique(client_id, code)` |
| H2 | 🔴 Alto | Runs PENDIENTE huérfanos | Cleanup cron |
| H3 | 🔴 Alto | ARCA timeout deja estado inconsistente | Desacoplar ARCA call |
| H4 | 🔴 Alto | View balance no escala >1k clientes | Documentar cap + materialized |
| M1 | 🟡 Medio | `applies_to_tx_id` redundante | Eliminar |
| M2 | 🟡 Medio | Audit forense sin request_id | Agregar columna |
| M3 | 🟡 Medio | Flujo NC incompleto | Sub-doc |
| M4 | 🟡 Medio | Anticipos sin flujo | Endpoint + UX |
| M5 | 🟡 Medio | Mid-cycle changes | Política + flag |
| M6 | 🟡 Medio | REFUND/ADJUSTMENT/CREDIT_NOTE | Documentar |
| L1 | 🟢 Bajo | BACKFILL sin caso | Documentar |
| L2 | 🟢 Bajo | Rotación secret | Documentar |
| L3 | 🟢 Bajo | Descuentos | Follow-up |
| L4 | 🟢 Bajo | COMPUESTO mora | Mantener |

**Total:** 3 críticos + 4 altos + 6 medios + 4 bajos.

---

## Veredicto final con evidencia

| Criterio | Resultado | Cumplido? |
|----------|-----------|-----------|
| Diseño estructuralmente sólido | sí | ✅ |
| Sin redundancia mayor | sí | ✅ |
| Sin sobre-ingeniería | sí | ✅ |
| Sin tablas innecesarias | sí | ✅ |
| Casos TOPS cubiertos | sí (con M5 follow-up) | ✅ |
| Escala 30-300 clientes (hoy) | sí | ✅ |
| Escala >1k clientes (futuro) | no sin re-arq | 🟡 |
| Cron robusto | no (C1/C2/C3) | 🔴 |
| Idempotencia robusta | no (H2/H3) | 🔴 |
| Security validada | sí | ✅ |
| Mantenibilidad razonable | sí | ✅ |
| Lock-in aceptable | sí | ✅ |

**Decisión:** 🟡 **IMPLEMENTAR CON CAMBIOS**

**Pasos siguientes (requieren tu autorización):**

1. **Aprobar este review** o pedirme profundizar áreas específicas
2. **Autorizar generación de `FASE-1B-AMENDMENT-V2-FIXES.md`** con los 17 ajustes propuestos
3. Una vez V2 generada → review final → si OK → autorizar implementación

**No avanzar a implementación sin AMENDMENT V2.** Los 3 críticos rompen funcionalidad en producción si se ignoran.

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR · NO MIGRAR · NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT · NO PRODUCCIÓN
- 🛑 NO TOCAR Drive · ARCA · RBAC · credenciales
- 🛑 NO INVENTAR — cada hallazgo trazado a file:line de documentos aprobados
- 🛑 Aplicada regla "NO ASUMIR · VERIFICAR" — re-leí docs en lugar de confiar en memoria
