# FASE 1B · AMENDMENT V2 — Cierre de hallazgos arquitectónicos

**Fecha:** 2026-05-29
**Estado:** AMENDMENT V2 aprobado — capa documental ADITIVA sobre FASE 1A + FASE 1B + AMENDMENT V1 (ARS).
**Razón:** consolidar las soluciones a los hallazgos C1, C2, C3, H1, H2, H3, H4 detectados en `FASE-1C-ARCHITECTURE-REVIEW.md`.
**Naturaleza:** aditivo. **No modifica documentos aprobados.** Los docs FASE 1A/1B permanecen como baseline oficial.
**Supersede:** secciones específicas de FASE 1A/1B se indican explícitamente por cada fix.

---

## Índice

1. [C1 — Cron architecture revisada](#c1)
2. [C2 — Lifecycle formal de SKIPPED](#c2)
3. [C3 — Payment terms multi-cuota → N transactions](#c3)
4. [H1 — `UNIQUE (client_id, code)`](#h1)
5. [H2 — Cleanup automático de runs colgados](#h2)
6. [H3 — Desacople ARCA en 3 etapas](#h3)
7. [H4 — Escalabilidad de `customer_balances`](#h4)
8. [Resumen de cambios al data model V1.3](#datamodel-v13)
9. [Resumen de cambios al API design](#api-changes)
10. [Resumen de cambios al rollout](#rollout-changes)
11. [Impacto en backlog](#backlog-changes)

---

<a id="c1"></a>
## 1 · C1 — Cron architecture revisada

### 1.1 Problema

`FASE-1B-MODULES.md:303` ejecuta `runScheduledBatch()` como loop monolítico dentro de Netlify Scheduled Function (timeout 26s). Con 50 contratos × 1.5s/run = 75s, el proceso muere a los 26s dejando ~30 contratos sin procesar y runs en `PENDIENTE` huérfanos.

### 1.2 Arquitectura nueva (3 capas)

```
┌─────────────────────────────────────────────────────────────────┐
│ CAPA 1 — Scheduled Function (26s hard limit)                    │
│ ──────────────────────────────────────────────────────────────  │
│  cron: 09:00 ART día 1                                          │
│  • Valida secret                                                 │
│  • Crea recurring_batch_jobs row con estado QUEUED               │
│  • POST async a /api/billing/recurring/cron/background           │
│  • Retorna 202 inmediato (idempotente vía batch_id)              │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼ (HTTP POST con batch_id)
┌─────────────────────────────────────────────────────────────────┐
│ CAPA 2 — Background Function (15 min limit, Netlify)            │
│ ──────────────────────────────────────────────────────────────  │
│  • SELECT contratos due en chunks de 10                          │
│  • Para cada chunk: runChunk(batch_id, contract_ids[])           │
│  • Cada chunk usa Promise.all con timeout individual de 25s     │
│  • Update recurring_batch_jobs progress después de cada chunk    │
│  • Si quedan > N chunks pendientes y se acerca al timeout 15min: │
│    re-encolar continuación spawn de otro background function    │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼ (por cada contrato del chunk)
┌─────────────────────────────────────────────────────────────────┐
│ CAPA 3 — runContract() individual (max 25s)                     │
│ ──────────────────────────────────────────────────────────────  │
│  • Lock idempotencia                                             │
│  • Cálculo + creación de invoice BORRADOR                        │
│  • NO emite ARCA aquí (ver H3)                                   │
│  • Insert transactions                                           │
│  • Marca run OK / FAILED / SKIPPED                               │
│  • Actualiza next_run_date (ver C2)                              │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Tabla nueva `recurring_batch_jobs`

Tracking del batch completo para idempotencia + observabilidad:

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | batch_id |
| `triggered_at` | timestamptz default now() | |
| `triggered_by` | enum `run_trigger_t` | CRON / MANUAL |
| `triggered_by_user` | uuid FK auth.users(id) NULL | |
| `target_date` | date | día del mes que dispara |
| `total_contracts_due` | int | SELECT count detected |
| `chunks_total` | int | calculado: ceil(total / chunk_size) |
| `chunks_completed` | int default 0 | |
| `contracts_ok` | int default 0 | |
| `contracts_failed` | int default 0 | |
| `contracts_skipped` | int default 0 | |
| `status` | enum `batch_job_status_t` | `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `STALLED` |
| `started_at` | timestamptz NULL | cuando background function arrancó |
| `completed_at` | timestamptz NULL | |
| `error_summary` | text NULL | |
| `created_at` | timestamptz default now() | |

UNIQUE: `(target_date, status) WHERE status IN ('QUEUED','RUNNING')` — un solo batch activo por día. Evita doble disparo (manual + cron mismo día).

### 1.4 Enum `batch_job_status_t` nuevo

```
batch_job_status_t = QUEUED | RUNNING | COMPLETED | FAILED | STALLED
```

`STALLED` = background function murió a la mitad. Detectado por watchdog (siguiente sección).

### 1.5 Watchdog (cron de monitoreo)

Cron adicional cada hora para detectar batches STALLED:

```
schedule: 0 * * * *   (cada hora UTC)
endpoint: /api/billing/recurring/cron/watchdog

Lógica:
  SELECT * FROM recurring_batch_jobs
  WHERE status='RUNNING'
    AND started_at < now() - interval '20 minutes'

Para cada batch stalled:
  UPDATE recurring_batch_jobs SET status='STALLED', error_summary='watchdog timeout'
  → emit alert: Ruth + JL email
  → opción de resumir manual desde UI admin
```

### 1.6 Endpoints nuevos

```
POST /api/billing/recurring/cron                  scheduled (26s) — solo encola
POST /api/billing/recurring/cron/background       background (15m) — corre chunks
POST /api/billing/recurring/cron/watchdog         scheduled hourly — detecta stalled
GET  /api/billing/recurring/batches               admin — lista batches recientes
GET  /api/billing/recurring/batches/[id]          admin — progreso de batch
POST /api/billing/recurring/batches/[id]/resume   admin — re-encolar batch stalled
```

### 1.7 Capacity en números

- Background function 15 min = 900s
- Chunks de 10 contratos × 1.5s = 15s por chunk
- 900s / 15s = ~60 chunks por background invocation
- 60 × 10 = **600 contratos por background invocation**
- Si quedan más: chain otra background invocation
- Capacidad práctica: **miles de contratos** sin tocar arquitectura

### 1.8 Tests requeridos

| Test | Caso |
|------|------|
| B1 | 5 contratos due → 1 chunk → COMPLETED en <30s |
| B2 | 100 contratos due → 10 chunks → COMPLETED en <3 min |
| B3 | 1000 contratos due → chain de background functions → COMPLETED en <30 min |
| B4 | Background function killed mid-batch → watchdog detecta STALLED en <60 min → alerta |
| B5 | Cron manual + cron auto el mismo día → UNIQUE viola → segundo batch retorna 409 con batch_id existente |
| B6 | Resume batch STALLED desde UI → retoma desde último chunk completado |

### 1.9 Supersede

Este fix **supersede** las siguientes secciones de docs aprobados:
- `FASE-1B-MODULES.md §3.4` (scheduler.ts simplista)
- `FASE-1B-API-DESIGN.md §2.4` (cron único)
- `FASE-1B-ROLLOUT.md §3.1` (cron mensual monolítico)

---

<a id="c2"></a>
## 2 · C2 — Lifecycle formal de SKIPPED

### 2.1 Problema

`FASE-1B-MODULES.md:286` actualiza `next_run_date` solo en path OK (paso 13). Runs SKIPPED no avanzan el período → loop infinito si tolerancia ARS 100 o cliente con `stop_billing` se mantiene mes a mes.

### 2.2 Reglas formales del lifecycle

Cada `RunResult.status` ahora tiene **regla explícita** de qué pasa con `next_run_date`:

| Status | Razón | Avanza `next_run_date`? | Avanza `last_run_at`? | Reintenta automático? | Comentario |
|--------|-------|--------------------------|------------------------|------------------------|------------|
| **OK** | factura creada | ✅ SÍ (+1 período) | ✅ SÍ | N/A | path feliz |
| **SKIPPED** | `BELOW_TOLERANCE_ARS_100` | ✅ SÍ | ✅ SÍ | NO (alerta admin) | total < $100 — el período se "salta" y siguiente cron continúa |
| **SKIPPED** | `CLIENT_STOP_BILLING` | ❌ NO | ❌ NO | sí (cuando se quite stop_billing) | el contrato queda parked hasta que admin desactive stop_billing |
| **SKIPPED** | `CONTRACT_NOT_ACTIVE` | ❌ NO | ❌ NO | sí (al reactivar) | contrato pausado o cancelado |
| **SKIPPED** | `NO_ACTIVE_LINES` | ❌ NO | ❌ NO | sí (al agregar líneas) | error de configuración — operador debe arreglar |
| **SKIPPED** | `OUT_OF_DATE_RANGE` | ❌ NO | ❌ NO | NO (contrato finalizado) | end_date pasada — auto-cierre del contrato a FINALIZADO en watchdog |
| **SKIPPED** | `ALREADY_RUN_FOR_PERIOD` | ❌ NO (ya avanzado) | N/A | N/A | UNIQUE constraint — no duplicar |
| **FAILED** | error técnico (ARCA timeout, etc.) | ❌ NO | ❌ NO | sí (manual o cron retry de FAILED) | requiere intervención |
| **FAILED** | `BCRA_*` | N/A | N/A | N/A | (eliminado por AMENDMENT V1 ARS) |
| **MANUAL_OVERRIDE** | operador forzó | ✅ SÍ | ✅ SÍ | N/A | tratado como OK |

### 2.3 Pseudocódigo actualizado de `runContract`

```
function runContract(contractId, opts):
  // ... pasos 1-12 (sin cambios) ...

  // PASO 13 (revisado): actualizar next_run_date según regla del SKIPPED
  if result.status == OK or result.status == MANUAL_OVERRIDE:
    update recurring_contracts set
      next_run_date = period_calculator.calcNext(periodo, frequency),
      last_run_at = now(),
      last_run_invoice_id = invoice.id

  elif result.status == SKIPPED:
    if skipReason in [BELOW_TOLERANCE_ARS_100]:
      // Avanzar período pero NO crear factura — operador debe ajustar línea
      update recurring_contracts set
        next_run_date = period_calculator.calcNext(periodo, frequency),
        last_run_at = now()
      emit_alert(ADMIN, "below_tolerance", contractId)

    elif skipReason == ALREADY_RUN_FOR_PERIOD:
      // No tocar — el run anterior ya avanzó el contador
      pass

    else:  // CLIENT_STOP_BILLING, CONTRACT_NOT_ACTIVE, NO_ACTIVE_LINES, OUT_OF_DATE_RANGE
      // No avanzar period — esperar acción humana
      pass

      if skipReason == OUT_OF_DATE_RANGE:
        // Auto-finalizar contrato
        update recurring_contracts set status='FINALIZADO'

  elif result.status == FAILED:
    // No avanzar — operador debe reintentar
    pass

  return result
```

### 2.4 Estados del contrato — diagrama enriquecido

```
                  [BORRADOR]
                       │
                       │ activar (validaciones: ≥1 line, payment_term)
                       ▼
                  [ACTIVO] ─────────────────► [PAUSADO]
                       │  ▲                        │
                       │  │                        │ reanudar
                       │  └────────────────────────┘
                       │
                       │ end_date alcanzada (SKIPPED:OUT_OF_DATE_RANGE)
                       │   o cron watchdog detecta y cierra
                       ▼
                  [FINALIZADO]
                       │
                       │ (no retorna)
                       │
   ACTIVO/PAUSADO ─cancelar─► [CANCELADO] (no retorna)
```

### 2.5 Auto-finalización por watchdog

Cron diario `recurring/auto-finalize`:

```
schedule: 0 12 * * *   (09:00 ART diario)

UPDATE recurring_contracts
SET status='FINALIZADO'
WHERE status IN ('ACTIVO','PAUSADO')
  AND end_date IS NOT NULL
  AND end_date < current_date

→ emit alert admin con contratos finalizados ese día
```

### 2.6 Tests requeridos

| Test | Caso |
|------|------|
| L1 | Contrato con total $50 ARS → SKIPPED BELOW_TOLERANCE → next_run_date avanza + alerta | 
| L2 | Cliente con stop_billing=true → SKIPPED CLIENT_STOP_BILLING → next_run_date NO avanza |
| L3 | Quitar stop_billing → próximo run procesa el período pendiente |
| L4 | Contrato sin líneas activas → SKIPPED NO_ACTIVE_LINES → operador agrega línea → próximo run OK |
| L5 | end_date < today → SKIPPED OUT_OF_DATE_RANGE → contrato pasa a FINALIZADO |
| L6 | OK normal → next_run_date += 1 mes |

### 2.7 Supersede

`FASE-1B-MODULES.md §3.3` — pasos 13-14 del runContract reemplazados por esta lógica.

---

<a id="c3"></a>
## 3 · C3 — Payment terms multi-cuota → N transactions

### 3.1 Problema

`FASE-1A-DATA-MODEL.md` y `FASE-1B-MODULES.md` insertan **una sola** `customer_transactions` con `due_date = primera slice`. El aging por cuotas no funciona — facturas 30/60/90 aparecen como vencidas/no-vencidas incorrectamente.

### 3.2 Solución: N transactions por slice

Cuando `payment_term.is_split = true`:
- Por cada `DueDateSlice` de `buildDueDates()` → INSERT 1 `customer_transactions`
- Cada transaction tiene su `due_date` propio
- `amount` de cada transaction = `total_invoice * slice.pct / 100`
- Todas comparten `source_table='customer_invoices'` y `source_id=invoice.id`

### 3.3 Nueva columna `customer_transactions.installment`

| Campo | Tipo | Notas |
|-------|------|-------|
| `installment` | smallint NULL | número de cuota (1, 2, 3...) si la factura está splitada. NULL si pago único o NO es INVOICE |
| `total_installments` | smallint NULL | total de cuotas de la factura origen |

UNIQUE compuesto que reemplaza el actual:
```
UNIQUE (source_table, source_id, type, installment)
WHERE voided=false
```

Esto permite N filas con mismo invoice_id pero distinto installment, y previene duplicados.

### 3.4 Aging recalculado

La view `customer_balances` ahora computa aging por `customer_transactions.due_date` real (no por `customer_invoices.fch_vto_pago` único):

```sql
overdue_0_30 = SUM CASE WHEN t.due_date >= current_date - 30d
                       AND t.due_date < current_date
                       AND t.type='INVOICE' AND NOT t.voided
                       THEN t.amount ELSE 0 END
```

Cada cuota se evalúa individualmente.

### 3.5 Aplicación de pagos a facturas multi-cuota

Cuando se aplica payment a una factura con N cuotas:
- `customer_payment_applications` mantiene M:N entre payments e invoices (no cambia)
- Pero el algoritmo FIFO ahora ordena por **transaction.due_date** (cuotas más viejas primero), no por invoice.fch_vto_pago

Pseudocódigo:
```
function autoApplyFIFO(paymentId):
  payment = get(paymentId)
  remaining = payment.amount
  
  // Buscar cuotas pendientes ordenadas por due_date
  pending_installments = query:
    SELECT t.invoice_id, t.installment, t.amount
      - COALESCE(SUM(apps.applied_amount WHERE apps.installment = t.installment), 0) as pending
    FROM customer_transactions t
    LEFT JOIN customer_payment_applications apps
      ON apps.invoice_id = t.invoice_id AND apps.installment = t.installment
    WHERE t.client_id = payment.client_id
      AND t.type = 'INVOICE'
      AND NOT t.voided
    GROUP BY t.invoice_id, t.installment, t.amount, t.due_date
    HAVING pending > 0
    ORDER BY t.due_date ASC

  for inst in pending_installments:
    apply_amount = min(remaining, inst.pending)
    INSERT customer_payment_applications (
      payment_id, invoice_id, installment, applied_amount
    )
    remaining -= apply_amount
    if remaining == 0: break

  payment.unapplied_amount = remaining
```

### 3.6 Nueva columna `customer_payment_applications.installment`

| Campo | Tipo | Notas |
|-------|------|-------|
| `installment` | smallint NULL | qué cuota de la factura se está pagando. NULL si pago único |

UNIQUE compuesto reemplaza el anterior:
```
UNIQUE (payment_id, invoice_id, installment)
```

### 3.7 UI cambios

- En `<AgedReceivablesTable>`: cada cuota es una fila separada (no la factura completa)
- En wizard de cobros paso 2 (aplicación): mostrar facturas → expandir a cuotas si is_split
- Badge "1/3", "2/3", "3/3" junto al monto de cada cuota

### 3.8 Tests requeridos

| Test | Caso |
|------|------|
| S1 | Factura $1.5M term 30/60/90 → 3 transactions con $500k cada uno, due_dates 30/60/90 |
| S2 | Factura $1.5M term 30/60 con 50/50 → 2 transactions con $750k cada uno |
| S3 | Pago $500k a factura S1 → aplica a cuota #1, deja #2 y #3 pendientes |
| S4 | Aging post-S3: $500k vencido 0d, $500k vence 30d, $500k vence 60d |
| S5 | Anular factura → todas las N transactions se voidan en cascada |
| S6 | Term D30 (no split) → 1 sola transaction con installment=NULL |

### 3.9 Supersede

- `FASE-1A-DATA-MODEL.md §6` — schema customer_transactions amplía con `installment` + `total_installments`
- `FASE-1A-DATA-MODEL.md §8` — customer_payment_applications amplía con `installment`
- `FASE-1B-MODULES.md §3.3 paso 11` — generar N transactions
- `FASE-1B-MODULES.md §6.3 autoApplyFIFO` — ordenar por due_date de cuotas

---

<a id="h1"></a>
## 4 · H1 — UNIQUE compuesto en recurring_contracts

### 4.1 Problema

`FASE-1A-MIGRATION-0014.md:134` define `code text not null unique` globalmente. Conflicto si dos clientes tienen contratos con códigos similares.

### 4.2 Fix

```diff
- code text not null unique,
+ code text not null,
  ...
  -- al final del bloque CREATE TABLE:
+ unique (client_id, code)
```

### 4.3 Ventajas adicionales

- Permite convenciones por cliente (ej. `ANMAT-22M2-2026` puede coexistir entre BIDCOM y BAGÓ)
- UX no requiere "code engineering" defensivo
- Menos friction al duplicar contratos de un cliente para otro similar

### 4.4 Migración de datos (si hubiera datos en sandbox)

Como FASE 1A no se ha implementado todavía, no hay datos a migrar. La migración 0014 se modifica antes de aplicarse.

### 4.5 Supersede

`FASE-1A-MIGRATION-0014.md §4` (recurring_contracts).

---

<a id="h2"></a>
## 5 · H2 — Cleanup automático de runs colgados

### 5.1 Problema

Runs en estado `PENDIENTE` huérfanos (porque background function murió mid-process) bloquean retries por UNIQUE constraint.

### 5.2 Solución: TTL + watchdog cron

#### 5.2.1 Columna nueva `recurring_runs.expires_at`

| Campo | Tipo | Notas |
|-------|------|-------|
| `expires_at` | timestamptz NULL | `now() + interval '1 hour'` al INSERT con status=PENDIENTE; NULL para otros estados |

#### 5.2.2 Cron de cleanup

Endpoint: `POST /api/billing/recurring/cron/cleanup-runs`
Schedule: cada hora

```sql
UPDATE recurring_runs
SET status = 'FAILED',
    error_message = 'orphan_run_cleanup: expired without completion'
WHERE status = 'PENDIENTE'
  AND expires_at IS NOT NULL
  AND expires_at < now()
RETURNING id, contract_id, periodo;

-- Para cada run cleaned-up:
INSERT INTO admin_alerts (severity, kind, payload)
VALUES ('warning', 'orphan_run_cleaned', {run_id, contract_id, periodo});
```

#### 5.2.3 Retry desde UI

Endpoint nuevo: `POST /api/billing/recurring/runs/[id]/retry`

Permisos: `billing.recurring.run`

Lógica:
1. Verificar run.status IN ('FAILED', 'STALLED')
2. Crear nuevo run row con status=PENDIENTE para el mismo periodo (NO viola UNIQUE porque el anterior pasó a FAILED)
3. Disparar `runContract(contractId, {triggeredBy:'MANUAL', periodOverride:periodo})`

### 5.3 Watchdog integrado con C1

Reusar el watchdog del batch architecture (C1 §1.5) — la misma corrida detecta:
- Batches STALLED (>20 min en RUNNING)
- Runs PENDIENTE expired (>1 hora)

Un solo cron `hourly` cubre ambos casos.

### 5.4 Tests requeridos

| Test | Caso |
|------|------|
| W1 | INSERT run PENDIENTE → matar proceso → 1h después: watchdog mueve a FAILED |
| W2 | Run FAILED → POST /retry → nuevo run PENDIENTE creado para mismo periodo |
| W3 | Run PENDIENTE legítimo en progreso (<1h) → watchdog NO toca |
| W4 | UNIQUE no viola después de cleanup (status pasó a FAILED) → permite retry |

### 5.5 Supersede

- `FASE-1A-DATA-MODEL.md §4` — recurring_runs amplía con `expires_at`
- `FASE-1A-MIGRATION-0014.md §6` — agregar expires_at a recurring_runs

---

<a id="h3"></a>
## 6 · H3 — Desacople ARCA en 3 etapas

### 6.1 Problema

`runContract` actual hace todo dentro de un mismo proceso: generación, aprobación implícita, emisión ARCA. Si ARCA tarda 30s, Netlify mata el proceso y deja estado inconsistente.

### 6.2 Solución: 3 fases separadas

```
FASE A — GENERACIÓN (síncrona, rápida, dentro de runContract)
  - Crear customer_invoices BORRADOR
  - Crear customer_transactions
  - Update next_run_date
  - Update recurring_runs OK
  - Email Ruth si requires_approval (sin auto_emit)
  ⏱ Total: <2s

FASE B — APROBACIÓN (manual o auto, async)
  - Si contract.auto_emit=true: skip → directo a FASE C
  - Si false: Ruth aprueba desde /billing/recurrentes/aprobaciones
    - Click "Aprobar y emitir" → marca invoice estado='PENDIENTE_ARCA' + queue para FASE C
    - Click "Rechazar" → invoice estado='ANULADO' + customer_transactions voided
  ⏱ Total: depende de Ruth (minutos a días)

FASE C — EMISIÓN ARCA (asíncrona, retry seguro)
  - Background cron cada 5 min procesa invoices con estado='PENDIENTE_ARCA'
  - Llama emit.ts → ARCA WSFEv1 con timeout 20s
  - Si OK: invoice estado='AUTORIZADO_ARCA' + CAE + QR
  - Si FAIL (timeout, rejection): contador de retries++; si retries < 3 → reintenta en próximo cron; si >= 3 → estado='ERROR_ARCA' + alerta
  ⏱ Total: 1-30 min según ARCA
```

### 6.3 Nueva tabla `arca_emit_queue`

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `invoice_id` | uuid FK customer_invoices(id) on delete cascade | |
| `status` | enum `arca_emit_status_t` | `QUEUED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `MAX_RETRIES` |
| `retries` | int default 0 | |
| `last_error` | text NULL | |
| `next_retry_at` | timestamptz default now() | exponential backoff |
| `queued_at` | timestamptz default now() | |
| `started_at` | timestamptz NULL | |
| `completed_at` | timestamptz NULL | |
| `created_by` | uuid FK auth.users(id) NULL | quien aprobó o motor si auto_emit |

UNIQUE: `(invoice_id) WHERE status IN ('QUEUED','IN_PROGRESS')` — una factura a la vez en queue.

### 6.4 Enum nuevo

```
arca_emit_status_t = QUEUED | IN_PROGRESS | COMPLETED | FAILED | MAX_RETRIES
```

### 6.5 Cron de emisión ARCA

Endpoint: `POST /api/billing/arca/cron/emit-queue`
Schedule: cada 5 minutos

```
schedule: */5 * * * *  (cada 5 min UTC = cada 5 min ART, no afecta TZ)
```

Lógica:
```
SELECT * FROM arca_emit_queue
WHERE status = 'QUEUED'
  AND next_retry_at <= now()
ORDER BY queued_at ASC
LIMIT 10

Para cada row:
  UPDATE row SET status='IN_PROGRESS', started_at=now()
  try:
    result = emit.ts(invoice_id) with timeout 20s
    if OK:
      UPDATE invoice SET estado_arca='AUTORIZADO_ARCA', cae=result.cae, qr_data=result.qr
      UPDATE row SET status='COMPLETED', completed_at=now()
    else:
      throw result.error
  catch (e):
    row.retries++
    if row.retries >= 3:
      UPDATE row SET status='MAX_RETRIES', last_error=e.message
      UPDATE invoice SET estado_arca='ERROR_ARCA', error_msg=e.message
      emit alert: Ruth + JL "ARCA FAILED 3x for invoice <id>"
    else:
      backoff_min = 5 * (2 ^ row.retries)  // 5, 10, 20 min
      UPDATE row SET status='QUEUED', last_error=e.message,
        next_retry_at = now() + interval (backoff_min || ' minutes')
```

### 6.6 Endpoints nuevos

```
GET  /api/billing/arca/queue                 admin — lista queue activa
POST /api/billing/arca/queue/[id]/retry      admin — fuerza retry inmediato
POST /api/billing/arca/cron/emit-queue       scheduled (cada 5 min)
GET  /api/billing/arca/queue/[id]            admin — detalle + log de retries
```

### 6.7 Cambios en `runContract` (Fase A)

```
PASO 10 (revisado): NO emitir ARCA aquí
  if contract.auto_emit == true:
    INSERT arca_emit_queue (invoice_id, status='QUEUED', created_by='system')
  else:
    // Espera aprobación manual de Ruth (FASE B)
    // Email a Ruth con link a /billing/recurrentes/aprobaciones
```

### 6.8 Cambios en UI aprobaciones (Fase B)

`/billing/recurrentes/aprobaciones` página:
- Lista BORRADORES esperando aprobación
- Por cada uno:
  - Preview del PDF
  - Botón "Aprobar y emitir" → INSERT arca_emit_queue + UPDATE invoice estado='PENDIENTE_ARCA'
  - Botón "Rechazar" → UPDATE invoice estado='ANULADO' + voidar transactions

### 6.9 Estados de invoice (revisados)

```
BORRADOR → PENDIENTE_ARCA → IN_PROGRESS → AUTORIZADO_ARCA  (path OK)
                                       ↘
                                        FAILED → PENDIENTE_ARCA (retry < 3)
                                              ↘
                                               ERROR_ARCA (max retries)
                                        
BORRADOR → ANULADO  (Ruth rechaza)
```

Nota: `IN_PROGRESS` aquí refiere a `arca_emit_queue.status`, no a `customer_invoices.estado_arca`. La invoice queda en `PENDIENTE_ARCA` durante toda FASE C hasta completar.

### 6.10 Beneficios del desacople

1. **`runContract` siempre rápido** (<2s) → cron batch puede procesar 100+ contratos cómodamente
2. **ARCA timeout NO mata el batch** → solo afecta a la factura específica
3. **Retry con backoff exponencial** → tolerante a outages de ARCA
4. **Aprobación humana opcional** → flag `auto_emit` controla; default false respeta política Ruth
5. **Trazabilidad completa** → cada retry queda registrado

### 6.11 Tests requeridos

| Test | Caso |
|------|------|
| A1 | runContract auto_emit=true → invoice BORRADOR + queue QUEUED en <2s |
| A2 | cron emit-queue procesa QUEUED → OK → invoice AUTORIZADO_ARCA |
| A3 | ARCA timeout 1ra vez → status QUEUED, next_retry_at += 5 min |
| A4 | ARCA timeout 3 veces → status MAX_RETRIES, invoice ERROR_ARCA, alerta |
| A5 | Ruth aprueba BORRADOR → invoice PENDIENTE_ARCA + queue QUEUED |
| A6 | Ruth rechaza BORRADOR → invoice ANULADO + transactions voided |
| A7 | Admin POST /retry sobre MAX_RETRIES → status QUEUED retries=0 |

### 6.12 Supersede

- `FASE-1B-MODULES.md §3.3 paso 10` — sustituye emisión inline por encolar
- `FASE-1B-MODULES.md` nueva sección `arca-queue/`
- `FASE-1B-API-DESIGN.md` agrega 4 endpoints `/api/billing/arca/*`
- `FASE-1B-ROLLOUT.md` agrega 4to cron (emit-queue cada 5 min)

---

<a id="h4"></a>
## 7 · H4 — Escalabilidad de `customer_balances`

### 7.1 Problema

View dinámica con SUM agregado degrada >1k clientes con muchas transactions (>5s p99).

### 7.2 Solución por etapas

#### Etapa 1 (FASE 1A inicial): View dinámica + cap documentado

- Mantener `customer_balances` como **view** simple
- Documentar cap operacional: **funciona bien hasta ~1k clientes con <500 tx/cliente**
- Para TOPS hoy (30-50 clientes) cap no afecta

#### Etapa 2 (cuando se supere ~700 clientes): cached_balance en customer_accounts

Agregar columnas a `customer_accounts`:

| Campo | Tipo | Notas |
|-------|------|-------|
| `cached_balance` | numeric(15,2) default 0 | mantenido por trigger |
| `cached_overdue_0_30` | numeric(15,2) default 0 | |
| `cached_overdue_30_60` | numeric(15,2) default 0 | |
| `cached_overdue_60_90` | numeric(15,2) default 0 | |
| `cached_overdue_90_plus` | numeric(15,2) default 0 | |
| `cached_at` | timestamptz NULL | última actualización |

Triggers:
- AFTER INSERT/UPDATE on `customer_transactions` → recalcular cached_balance del client_id afectado
- AFTER UPDATE on `customer_transactions` (voiding) → idem
- Cron nightly: recalcular **todos** los caches (reconciliación, ~5 min para 10k clientes)

Listados usan `cached_balance` (rápido, drift aceptable de minutos).
Detalle individual usa view dinámica (preciso, lento ok para 1 cliente).

#### Etapa 3 (>5k clientes): Materialized view + refresh cada 5 min

Si la opción de caches no escala (bug en triggers, contention, etc.), pasar a:

```sql
CREATE MATERIALIZED VIEW customer_balances_mv AS ...;
CREATE UNIQUE INDEX ON customer_balances_mv (client_id);

-- Cron de refresh:
REFRESH MATERIALIZED VIEW CONCURRENTLY customer_balances_mv;
```

Schedule: cada 5 min.

#### Etapa 4 (escala extrema, +50k clientes): Read replicas + cache layer

Out of scope FASE 1A. Documentar como futuro.

### 7.3 Roadmap documentado

| Punto de activación | Acción |
|----------------------|--------|
| <500 clientes activos | View dinámica suficiente |
| 500-1500 clientes | Habilitar `cached_balance` con triggers (Etapa 2) |
| 1500-5000 clientes | Mantener Etapa 2; monitorear p99 |
| >5000 clientes | Migrar a materialized view (Etapa 3) |
| >50000 clientes | Re-arquitectura (Etapa 4) |

### 7.4 Métrica de monitoreo

Endpoint `GET /api/billing/health` incluye:
```json
{
  "customer_balances_p99_ms": 87,
  "active_clients_count": 32,
  "recommended_scale_tier": "etapa_1",
  "next_tier_at": "500 clients"
}
```

Cuando `p99_ms > 500` → alerta a admin para evaluar pasar a Etapa 2.

### 7.5 Tests requeridos

| Test | Caso |
|------|------|
| E1 | 30 clientes × 200 tx → p99 < 100ms (Etapa 1) |
| E2 | 1000 clientes × 500 tx con caches activos → p99 < 200ms (Etapa 2) |
| E3 | 5000 clientes × 1000 tx con materialized view → p99 < 100ms (Etapa 3) |
| E4 | Trigger de update cached_balance → consistente con view dinámica (reconcile) |
| E5 | Refresh materialized view CONCURRENTLY no bloquea reads (Etapa 3) |

### 7.6 Supersede

- `FASE-1A-DATA-MODEL.md §5 customer_accounts` amplía con columnas cached_*
- `FASE-1A-DATA-MODEL.md §10 view customer_balances` documenta cap + etapas
- `FASE-1A-IMPACT.md §7` perf actualiza con tiers
- `FASE-1B-ROLLOUT.md` agrega punto de activación de Etapa 2

---

<a id="datamodel-v13"></a>
## 8 · Resumen de cambios al data model V1.3

### 8.1 Tablas nuevas (2)

| Tabla | Razón |
|-------|-------|
| `recurring_batch_jobs` | Tracking batches del cron (C1) |
| `arca_emit_queue` | Queue async de emisión a ARCA (H3) |

### 8.2 Tabla `admin_alerts` (consolidar con existente `alerts/` propuesto)

Si no existía, crearla:

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid PK | |
| `severity` | enum | `info`, `warning`, `error`, `critical` |
| `kind` | text | `below_tolerance`, `orphan_run_cleaned`, `arca_max_retries`, etc. |
| `payload` | jsonb | datos específicos |
| `acknowledged_at` | timestamptz NULL | si admin marcó como leído |
| `acknowledged_by` | uuid FK auth.users(id) NULL | |
| `created_at` | timestamptz default now() | |

### 8.3 Columnas nuevas en tablas existentes

| Tabla | Columnas |
|-------|----------|
| `recurring_runs` | `expires_at timestamptz NULL` (H2) |
| `customer_transactions` | `installment smallint NULL`, `total_installments smallint NULL`, `created_by_request_id text NULL` (C3, M2) |
| `customer_payment_applications` | `installment smallint NULL` (C3) |
| `customer_accounts` | `cached_balance numeric(15,2)`, `cached_overdue_*` (4 columnas), `cached_at timestamptz NULL` (H4, opcional inicial) |

### 8.4 Columna eliminada

| Tabla | Columna |
|-------|---------|
| `customer_transactions` | `applies_to_tx_id` ELIMINADO (M1, redundante) |

### 8.5 Constraints nuevas

```sql
-- H1: code per-client
ALTER TABLE recurring_contracts DROP CONSTRAINT recurring_contracts_code_key;
ALTER TABLE recurring_contracts ADD CONSTRAINT recurring_contracts_client_code_uq
  UNIQUE (client_id, code);

-- C3: installment unique
DROP INDEX customer_transactions_source_unique;
CREATE UNIQUE INDEX customer_transactions_source_unique
  ON customer_transactions (source_table, source_id, type, COALESCE(installment, 0))
  WHERE NOT voided;

ALTER TABLE customer_payment_applications
  DROP CONSTRAINT customer_payment_applications_payment_invoice_key;
ALTER TABLE customer_payment_applications
  ADD CONSTRAINT cpa_payment_invoice_installment_uq
  UNIQUE (payment_id, invoice_id, COALESCE(installment, 0));

-- C1: una sola batch activa por día
CREATE UNIQUE INDEX recurring_batch_jobs_active_uq
  ON recurring_batch_jobs (target_date)
  WHERE status IN ('QUEUED','RUNNING');

-- H3: una sola factura en queue ARCA a la vez
CREATE UNIQUE INDEX arca_emit_queue_active_uq
  ON arca_emit_queue (invoice_id)
  WHERE status IN ('QUEUED','IN_PROGRESS');
```

### 8.6 Enums nuevos (3)

```
batch_job_status_t = QUEUED | RUNNING | COMPLETED | FAILED | STALLED
arca_emit_status_t = QUEUED | IN_PROGRESS | COMPLETED | FAILED | MAX_RETRIES
alert_severity_t   = info | warning | error | critical
```

### 8.7 Triggers nuevos

1. `tg_update_cached_balance` AFTER INSERT/UPDATE on customer_transactions → recalc cached_balance del client (Etapa 2 H4, opcional inicial)
2. `tg_void_invoice_cascade_transactions` — cuando invoice.anulada cambia a true, voidar todas sus transactions
3. `tg_set_run_expires_at` BEFORE INSERT on recurring_runs → setea expires_at si status=PENDIENTE

### 8.8 Versión final del data model

Documento de baseline: **FASE 1A V1.3**:
- Tablas: **11 + 1 view + 1 ARCA queue + 1 admin alerts** = 14 entidades nuevas (vs. 10 original)
- Triggers: 10 (vs. 7 original)
- Enums: 13 (vs. 10 original)
- RLS policies: ~32 (vs. 25 original)

Crecimiento: +40% en entidades pero todo justificado por requisitos identificados.

---

<a id="api-changes"></a>
## 9 · Resumen de cambios al API design

### 9.1 Endpoints nuevos (10)

```
RECURRING BATCH
GET  /api/billing/recurring/batches                admin
GET  /api/billing/recurring/batches/[id]           admin
POST /api/billing/recurring/batches/[id]/resume    admin

CRON ARCHITECTURE
POST /api/billing/recurring/cron                   scheduled (26s) — solo encola
POST /api/billing/recurring/cron/background        background (15m) — corre chunks
POST /api/billing/recurring/cron/watchdog          scheduled hourly
POST /api/billing/recurring/cron/cleanup-runs      scheduled hourly (puede unificarse con watchdog)
POST /api/billing/recurring/auto-finalize          scheduled diario

RECURRING RUNS
POST /api/billing/recurring/runs/[id]/retry        billing.recurring.run

ARCA QUEUE
GET  /api/billing/arca/queue                       admin
GET  /api/billing/arca/queue/[id]                  admin
POST /api/billing/arca/queue/[id]/retry            admin
POST /api/billing/arca/cron/emit-queue             scheduled (cada 5 min)

ADMIN ALERTS
GET  /api/billing/admin/alerts                     billing.view
POST /api/billing/admin/alerts/[id]/acknowledge    billing.view
```

### 9.2 Endpoints modificados

- `POST /api/billing/recurring/contracts/[id]/run` — response incluye `batch_job_id` si triggered por cron
- `GET /api/billing/health` — incluye métricas de escalabilidad

### 9.3 Response shapes actualizados

`POST /api/billing/recurring/contracts/[id]/run` (path OK con auto_emit=true):
```json
{
  "ok": true,
  "data": {
    "run_id": "uuid",
    "status": "OK",
    "invoice_id": "uuid",
    "estado_arca": "PENDIENTE_ARCA",       ← CAMBIO: no AUTORIZADO_ARCA inmediato
    "arca_queue_id": "uuid",                ← NUEVO: id de la queue
    "total": 1430000,
    "next_run_date": "2026-07-01",
    "transactions_created": 1               ← si is_split=true sería 3 por ej
  }
}
```

---

<a id="rollout-changes"></a>
## 10 · Resumen de cambios al rollout

### 10.1 Cron jobs revisados — 5 totales

| # | Cron | Schedule UTC | Schedule ART | Layer | Propósito |
|---|------|--------------|--------------|-------|-----------|
| 1 | `recurring/cron` | `0 12 1 * *` | 09:00 ART día 1 | Scheduled (26s) | Encolar batch mensual |
| 2 | `recurring/cron/background` | (invocado por #1) | inmediato | Background (15min) | Procesar chunks |
| 3 | `late-fees/cron` | `0 10 * * *` | 07:00 ART diario | Scheduled | Aplicar mora |
| 4 | `arca/cron/emit-queue` | `*/5 * * * *` | cada 5 min | Scheduled | Emitir ARCA pending |
| 5 | `recurring/cron/watchdog` | `0 * * * *` | cada hora | Scheduled | Detectar stalled + cleanup runs |
| 6 | `recurring/auto-finalize` | `0 12 * * *` | 09:00 ART diario | Scheduled | Cerrar contratos con end_date pasada |

### 10.2 Feature flags actualizadas

Sin cambios mayores. Agregar opcionalmente:
- `BILLING_ARCA_QUEUE_DISABLED` (killswitch del cron de emisión)
- `BILLING_BACKGROUND_CRON_DISABLED` (killswitch del batch)

Total: 9 flags (vs. 7 previas).

### 10.3 Plan de rollout actualizado

Inserción de pasos nuevos:

```
Día 0 (deploy 0014):  Schema en prod, todas las queues vacías, todos los crons disabled por flags
Día 1: Activar `BILLING_KPI_WIDGETS_ENABLED`
Día 3: Activar `BILLING_DIRECT_ENABLED`
Día 5: Activar `BILLING_RECURRING_ENABLED` + crear 1 contrato test
Día 6: Activar `recurring/cron` + cron de emisión ARCA (con 1 contrato)
Día 7: Validar end-to-end primer ciclo
Día 14: Onboarding cohorte 2 (3 contratos)
Día 21: Activar `late-fees/cron`
Día 30: cohorte completa
```

---

<a id="backlog-changes"></a>
## 11 · Impacto en backlog

### 11.1 Nuevas historias

| ID | Historia | Estimación |
|----|----------|------------|
| E3.H08 | Implementar `recurring_batch_jobs` tabla + helpers (C1) | M |
| E3.H09 | Implementar background function de processing en chunks (C1) | L |
| E3.H10 | Implementar watchdog cron + cleanup runs (H2) | M |
| E3.H11 | Implementar lifecycle SKIPPED formal (C2) | S |
| E3.H12 | Implementar auto-finalize cron (C2) | S |
| E4.H05 | Implementar inserción de N transactions por payment_term split (C3) | M |
| **NUEVA ÉPICA E12** | **ARCA Emit Queue** | **2 sem** |
| E12.H01 | `arca_emit_queue` tabla + helpers (H3) | S |
| E12.H02 | Endpoint emit-queue cron (H3) | M |
| E12.H03 | UI aprobaciones modificada para encolar (H3) | M |
| E12.H04 | Retry con backoff exponencial (H3) | S |
| E12.H05 | Tests E2E (H3) | M |
| E5.H05 | Implementar cached_balance + triggers (H4 Etapa 2 opt-in) | M |

### 11.2 Historias modificadas

| ID | Cambio |
|----|--------|
| E3.H03 (engine runContract) | Sin emisión ARCA inline; encolar en queue |
| E3.H04 (scheduler) | Reemplazado por trigger encoler + background separate |
| E6.H02 (auto-apply FIFO) | Ordenar por due_date de installments (no fch_vto_pago) |
| E8.H03 (wizard contratos) | Sin cambios mayores |
| E8.H05 (aprobaciones UI) | Botón "Aprobar y emitir" → encola en ARCA queue |
| E8.H08 (CC cliente) | Mostrar cuotas separadas en aging |

### 11.3 Estimación total revisada

| Antes V2 | Después V2 |
|----------|-----------|
| ~12 semanas | **~13.5 semanas** (+1.5 sem por nueva ÉPICA E12 + ajustes) |

El cronograma global pasa de ~12 a ~13.5 semanas. Aceptable para resolver fallas críticas.

---

## 12 · Tests obligatorios consolidados

Total de tests nuevos en V2: **~30 tests** sumados a los existentes.

Cobertura por hallazgo:
- C1 (cron): B1-B6 (6 tests)
- C2 (lifecycle): L1-L6 (6 tests)
- C3 (splits): S1-S6 (6 tests)
- H2 (cleanup): W1-W4 (4 tests)
- H3 (ARCA queue): A1-A7 (7 tests)
- H4 (scalability): E1-E5 (5 tests)

Sumados a los 12 RLS T1-T12 y unit tests por módulo → cobertura total >100 tests.

---

## 13 · Riesgos NUEVOS introducidos por V2

| ID | Riesgo | Severidad | Mitigación |
|----|--------|-----------|------------|
| V2.R01 | Background function tiene su propia surface de ataque (HTTP endpoint público con secret) | 🟡 Medio | Mismo pattern que scheduled (header secret + rate limit) |
| V2.R02 | ARCA queue se llena (>1000 rows pending) por outage prolongado | 🟡 Medio | Alerta admin si queue.length > 50 |
| V2.R03 | Cached_balance drift vs view dinámica (Etapa 2 H4) | 🟡 Medio | Reconcile nightly + métrica de drift |
| V2.R04 | Watchdog ejecuta cleanup demasiado agresivo y mata runs legítimos | 🟢 Bajo | TTL conservador (1h, no minutos) + tests |
| V2.R05 | N transactions por split confunde a contador externo no familiarizado | 🟢 Bajo | Documentar en sub-doc + UI muestra "1/3" badge |

---

## 14 · Lo que NO cambia respecto a baseline aprobado

- Estructura de RBAC (sin tocar permisos ni roles)
- RLS policies de tablas existentes (sin tocar)
- Trigger lock pattern (replicado, no modificado)
- Storage buckets `receipts` y `contracts` (sin cambios)
- Decisión moneda ARS única (AMENDMENT V1 vigente)
- Catálogo de payment_terms (sin cambios)
- Catálogo de categorías (7 categorías incluido oficinas multi-tipo)
- Cron de mora 07:00 ART diario (sin cambios)
- Cron mensual 09:00 ART día 1 (sin cambios — el cambio es interno, sigue siendo día 1 a las 9)

---

## 15 · Restricciones honradas

- 🛑 NO IMPLEMENTAR
- 🛑 NO MIGRAR
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO TOCAR producción · credenciales · Drive · ARCA · RBAC
- 🛑 NO MODIFICAR documentos aprobados FASE 1A/1B/AMENDMENT V1 (este V2 es aditivo)
- 🛑 NO INVENTAR — cada fix trazable a hallazgo de `FASE-1C-ARCHITECTURE-REVIEW.md` con evidencia
