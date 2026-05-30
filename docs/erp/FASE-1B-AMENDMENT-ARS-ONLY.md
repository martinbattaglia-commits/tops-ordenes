# FASE 1B · AMENDMENT — Moneda única ARS

**Fecha:** 2026-05-29
**Estado:** AMENDMENT aprobado — supersede secciones específicas de docs FASE 1A/1B.
**Razón:** decisión explícita del usuario: "Moneda en pesos argentinos".
**Alcance:** todo el módulo billing trabaja en ARS. Sin USD contractual. Sin cotización. Sin BCRA.
**Modifica:** `FASE-1A-DATA-MODEL.md`, `FASE-1A-RELATIONS.md`, `FASE-1A-RLS.md`, `FASE-1A-MIGRATION-0014.md`, `FASE-1B-MODULES.md`, `FASE-1B-API-DESIGN.md`, `FASE-1B-BACKLOG.md`, `FASE-1B-ROLLOUT.md`.

---

## 1 · Cambio aprobado

> Moneda contractual y de facturación: **ARS exclusivamente**.

### 1.1 Lo que reemplaza

La decisión anterior aprobada en mensaje previo era:

> USD como moneda contractual. Facturación emitida en ARS utilizando la cotización del día. La cotización utilizada debe quedar auditada y persistida.

**Esta decisión queda anulada y reemplazada por:**

> Toda la facturación recurrente y directa se cotiza, expresa y emite en pesos argentinos. No hay conversión de moneda. No hay cotización del día. No hay integración con BCRA. Los precios m²/m³/abonos se establecen directamente en ARS al firmar el contrato.

### 1.2 Reinterpretación de los casos de negocio

Los ejemplos originales mencionaban USD por compatibilidad con prácticas previas. Quedan reinterpretados:

| Caso original | Reinterpretación ARS |
|---------------|----------------------|
| ANMAT 22 m² × USD 50 | 22 m² × **ARS $X/m²** (precio acordado al firmar contrato en ARS) |
| Cargas Generales 100 m² × USD 10 | 100 m² × **ARS $Y/m²** |
| Oficina privada (sin cambio) | abono mensual fijo en ARS |
| Coworking (sin cambio) | abono mensual fijo en ARS |

**Implicación operativa:** la actualización de precios contractuales por inflación queda como decisión periódica del cliente (revisar contrato y modificar líneas). El flag `apply_indexacion` en `recurring_contract_lines` queda como **placeholder para futura indexación automática IPC**, pero el motor lo ignora en FASE 1A/1B.

---

## 2 · Cambios al modelo de datos (V1.2)

### 2.1 Tablas ELIMINADAS

| Tabla | Status |
|-------|--------|
| `exchange_rates_log` | **ELIMINADA** del modelo |

### 2.2 Campos ELIMINADOS

#### `recurring_contracts`
- ~~`currency text`~~ → ELIMINADO (siempre ARS)
- ~~`cotizacion_source text`~~ → ELIMINADO
- ~~`cotizacion_fija numeric(15,6)`~~ → ELIMINADO

#### `recurring_runs`
- ~~`currency_snapshot text`~~ → ELIMINADO
- ~~`cotizacion_snapshot numeric(15,6)`~~ → ELIMINADO

#### `customer_transactions`
- ~~`currency text`~~ → ELIMINADO (siempre ARS)
- ~~`cotizacion numeric(15,6)`~~ → ELIMINADO
- ~~`amount_pes numeric(15,2) generated`~~ → ELIMINADO; queda solo `amount numeric(15,2)` que YA está en ARS

#### `customer_payments`
- ~~`currency text`~~ → ELIMINADO
- ~~`cotizacion numeric(15,6)`~~ → ELIMINADO
- ~~`amount_pes numeric(15,2) generated`~~ → ELIMINADO; queda solo `amount`

#### `customer_payment_applications`
- ~~`applied_amount_pes numeric(15,2) generated`~~ → ELIMINADO; queda solo `applied_amount`

#### View `customer_balances`
- Renombrar todos los `*_pes` → `*_ars` o eliminar sufijo. Decisión: **eliminar sufijo**, queda `balance`, `total_debit`, `total_credit`, `overdue_*`. Más claro y consistente.

### 2.3 Campos sin cambio

| Tabla | Campos que se mantienen |
|-------|--------------------------|
| `customer_invoices` (mig 0011 existente, NO se toca) | `moneda text default 'PES'` + `cotizacion numeric` ya existen — se mantienen por compatibilidad ARCA pero motor recurrente siempre los setea con `'PES'` y `1` |
| `recurring_contracts` | resto sin cambios |
| `recurring_contract_lines` | sin cambios |
| `payment_terms`, `late_fee_rules`, `customer_late_fee_charges` | sin cambios (todo ARS desde el inicio) |

### 2.4 Constraint `customer_invoices.moneda='PES'` desde motor recurrente

El motor de `recurring/engine.ts` y `invoices-direct/emit.ts` siempre setea:
- `customer_invoices.moneda = 'PES'`
- `customer_invoices.cotizacion = 1`

Sin opción de USD. Esto es **app-level**, no DB-level (la tabla sigue permitiendo PES o USD para compatibilidad ARCA con futuros tipos de comprobante E).

---

## 3 · Cambios al módulo backend (`src/lib/billing/`)

### 3.1 Módulo ELIMINADO

**`src/lib/billing/exchange-rate/`** — TODO el directorio eliminado:
- ~~`bcra-client.ts`~~
- ~~`cache.ts`~~
- ~~`data.ts`~~
- ~~`fallback.ts`~~

### 3.2 Lógica simplificada en módulos restantes

#### `recurring/engine.ts` — `runContract()` flujo simplificado

**ANTES (con cotización):**
```
1. Validar contractId
2. Calcular periodo
3. Lock idempotencia
4. Validaciones SKIPPED
5. Obtener cotización ← ELIMINADO
6. Calcular total en moneda contrato → convertir a ARS ← SIMPLIFICADO
7. Si total < 100 ARS → SKIPPED
8. Crear customer_invoices BORRADOR
...
```

**DESPUÉS (ARS único):**
```
1. Validar contractId
2. Calcular periodo
3. Lock idempotencia
4. Validaciones SKIPPED
5. Calcular total ARS directamente desde lines
   total = sum(cantidad × precio_unitario) por cada line activa
6. Si total < 100 → SKIPPED (tolerancia)
7. Crear customer_invoices BORRADOR
   - moneda='PES', cotizacion=1
   - items con precio_unitario ARS
...
```

#### `invoices-direct/emit.ts`

Eliminar pasos 4 ("Obtener cotización") y 5 ("Cálculos con cotización"). Total directo en ARS.

#### `recurring/data.ts`

Eliminar de los DTOs:
- `currency`, `cotizacion_source`, `cotizacion_fija` en CreateContractInput
- `cotizacion_snapshot` en RunResult

#### `accounts/balance.ts`

Cambiar nombres de columnas devueltas:
- `balance_pes` → `balance`
- `overdue_30_pes` → `overdue_30`
- etc.

#### `payments/data.ts`

Eliminar de DTOs:
- `currency`, `cotizacion` en CreatePaymentInput
- Solo `amount` en ARS

---

## 4 · Cambios al API design

### 4.1 Endpoints ELIMINADOS

| Endpoint | Acción |
|----------|--------|
| `GET /api/billing/exchange-rate/today` | **ELIMINADO** |
| `GET /api/billing/exchange-rate/[date]` | **ELIMINADO** |
| `POST /api/billing/exchange-rate/refresh` | **ELIMINADO** |

### 4.2 Schemas simplificados

#### `POST /api/billing/recurring/contracts` — body actualizado

**Eliminar campos:**
```diff
- "currency": "USD",
- "cotizacion_source": "BCRA_OFICIAL",
- "cotizacion_fija": null,
```

**Body final:**
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
  "iva_default": 21,
  "notas": null,
  "lines": [
    {
      "orden": 1,
      "descripcion": "Almacenaje ANMAT — 22 m²",
      "categoria": "ALMACENAJE_ANMAT",
      "unidad": "m2",
      "cantidad": 22,
      "precio_unitario": 65000,     ← ARS por m²
      "iva_rate": 21
    }
  ]
}
```

#### `POST /api/billing/recurring/contracts/[id]/run` — response actualizado

**ANTES:**
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
    "exchange_rate_log_id": "uuid"
  }
}
```

**DESPUÉS:**
```json
{
  "ok": true,
  "data": {
    "run_id": "uuid",
    "status": "OK",
    "invoice_id": "uuid",
    "total_estimado": 1430000,
    "total_emitido": 1430000,
    "auto_emitted": false,
    "needs_approval_by": "ruth@logisticatops.com"
  }
}
```

(`total_estimado === total_emitido` porque no hay diferencia por cotización.)

#### `POST /api/billing/invoices/direct` — body actualizado

**Eliminar:**
```diff
- "currency": "USD",
- "cotizacion_source": "BCRA_OFICIAL",
- "cotizacion_manual": null,
```

#### `POST /api/billing/payments` — body actualizado

**Eliminar:**
```diff
- "currency": "PES",
- "cotizacion": 1,
```

(Implícito siempre ARS.)

#### `GET /api/billing/accounts/[clientId]/balance` — response actualizado

```json
{
  "ok": true,
  "data": {
    "client_id": "uuid",
    "client_name": "BIDCOM S.A.",
    "balance": 1420000,
    "total_debit": 6500000,
    "total_credit": 5080000,
    "overdue_0_30": 200000,
    "overdue_30_60": 0,
    "overdue_60_90": 0,
    "overdue_90_plus": 0,
    "credit_limit": 3000000,
    "stop_billing": false,
    "last_payment_date": "2026-05-15",
    "last_invoice_date": "2026-05-01"
  }
}
```

### 4.3 Códigos de error eliminados

| Código | Status |
|--------|--------|
| `EXCHANGE_RATE_UNAVAILABLE` | **ELIMINADO** (no aplica) |

---

## 5 · Cambios al UX

### 5.1 Componentes ELIMINADOS

| Componente | Status |
|------------|--------|
| `<ExchangeRateBadge>` | **ELIMINADO** del catálogo |

### 5.2 Wizard contratos recurrentes — Paso 3 simplificado

**ANTES:**
```
Paso 3 de 5 — Conceptos a facturar
───────────────────────────────────
+ Agregar concepto

┌──────────────────────────────────────────────────────────────┐
│ N° │ Descripción          │ Cat.    │ Cant. │ Precio │ Sub   │
│ 01 │ Almacenaje ANMAT     │ ANMAT▼  │  22.0 │ USD 50 │ U$1.100│
│ 02 │ Cinta perimetral     │ OTRO▼   │   1.0 │ USD 200│ U$ 200 │
└──────────────────────────────────────────────────────────────┘

Moneda contrato: ◉ USD  ○ ARS                   ← ELIMINADO
Cotización al emitir: [BCRA Oficial ▼]           ← ELIMINADO
  (fallback: fijo $1.250)                        ← ELIMINADO

Total estimado/mes: USD 1.300 (~ $ 1.690.000 hoy)
```

**DESPUÉS:**
```
Paso 3 de 5 — Conceptos a facturar
───────────────────────────────────
+ Agregar concepto

┌──────────────────────────────────────────────────────────────┐
│ N° │ Descripción          │ Cat.    │ Cant. │ Precio │ Sub   │
│ 01 │ Almacenaje ANMAT     │ ANMAT▼  │  22.0 │$65.000 │$1.430.000│
│ 02 │ Cinta perimetral     │ OTRO▼   │   1.0 │$80.000 │   $80.000│
└──────────────────────────────────────────────────────────────┘

Total neto/mes:    $ 1.510.000 ARS
IVA 21%:          $   317.100
TOTAL:            $ 1.827.100 ARS
```

Wizard pasa de 5 pasos a **4 pasos** o el paso 3 queda más simple.

### 5.3 Wizard facturación directa — simplificación equivalente

Eliminar campos moneda + cotización en el Paso 3 del `<DirectInvoiceWizard>`. Total y precio unitario son ARS directos.

### 5.4 Card "Facturación mes" — sin cambio

Los KPIs ya eran ARS implícitos en mockups. Sin cambio.

### 5.5 Dashboard ejecutivo

Sin cambio en widgets. Todos ya estaban en ARS implícito.

---

## 6 · Cambios al rollout

### 6.1 Cron ELIMINADO

| Cron | Status |
|------|--------|
| Cron 3 · Exchange rate cache (`08:00 ART lun-vie`) | **ELIMINADO** |

Quedan **2 crons activos:**
1. Recurring batch mensual (09:00 ART día 1)
2. Late fees diario (07:00 ART)

### 6.2 Feature flags eliminados

| Flag | Status |
|------|--------|
| `BILLING_EXCHANGE_RATE_FORCE_FALLBACK` | **ELIMINADA** |

Quedan **7 flags activas.**

### 6.3 Env vars eliminadas

| Var | Status |
|-----|--------|
| BCRA API config (si hubiera) | **N/A** (no se necesitan) |

---

## 7 · Cambios al backlog

### 7.1 ÉPICA ELIMINADA

**ÉPICA E2 · Exchange Rate** — **ELIMINADA completamente.**

| Historia | Status |
|----------|--------|
| ~~E2.H01~~ — Implementar `bcra-client.ts` | ELIMINADA |
| ~~E2.H02~~ — Implementar `cache.ts` + `data.ts` | ELIMINADA |
| ~~E2.H03~~ — Implementar `fallback.ts` | ELIMINADA |
| ~~E2.H04~~ — Endpoints API exchange-rate | ELIMINADA |

**Estimación ahorrada:** ~1 semana de desarrollo.

### 7.2 Re-numeración épicas

Las épicas siguen con sus IDs originales (E1, E3, E4, ..., E11) para mantener trazabilidad. E2 queda como "skipped/cancelled" en el tracking.

### 7.3 Resumen actualizado del backlog

| Épica | Estimación previa | Estimación actual |
|-------|-------------------|--------------------|
| E0 — Pre-flight | 1-2 sem | 1-2 sem |
| E1 — Schema | 3 sem | **2.5 sem** (sin `exchange_rates_log`) |
| ~~E2 — Exchange Rate~~ | ~~1 sem~~ | **0 (ELIMINADA)** |
| E3 — Motor recurrente | 3 sem | **2.5 sem** (sin cotización en engine) |
| E4 — Facturación directa | 1.5 sem | **1.2 sem** |
| E5 — Cuenta corriente | 1 sem | 1 sem |
| E6 — Cobros | 1.5 sem | 1.4 sem |
| E7 — Mora | 1 sem | 1 sem |
| E8 — UI | 5 sem | **4.5 sem** (un paso menos en wizards) |
| E9 — Dashboard | 1 sem | 1 sem |
| E10 — Deploy | 0.5 sem | 0.5 sem |
| E11 — Supervisión | 30 días cal | 30 días cal |
| **TOTAL** | **~14 sem** | **~12 sem** |

**Reducción neta:** ~2 semanas de desarrollo.

### 7.4 PRs actualizados

PR original 3 (`feat/exchange-rate`) — **ELIMINADO.**

Quedan **10 PRs** en lugar de 11.

---

## 8 · Cambios al risks

### 8.1 Riesgos ELIMINADOS (ya no aplican)

| ID | Riesgo | Status |
|----|--------|--------|
| F1.R05 | Cotización USD/ARS incorrecta al emitir | **ELIMINADO** (no hay USD) |
| F1.R19 | Cotización source `BCRA_OFICIAL` cae → run FAILED | **ELIMINADO** (no hay BCRA) |

### 8.2 Riesgos NUEVOS introducidos por ARS único

| ID | Riesgo | Severidad | Mitigación |
|----|--------|-----------|------------|
| **F1.R26** | Contratos firmados en USD informalmente no se reflejan correctamente como ARS en el sistema | 🟡 Medio | UI muestra warning si precio_unitario parece desactualizado vs catálogo; revisión trimestral con Ruth |
| **F1.R27** | Inflación ARS erosiona valor real del contrato sin indexación | 🟡 Medio | Flag `apply_indexacion` ya existe (placeholder); operador puede modificar línea cuando cliente acepta nuevo precio |
| **F1.R28** | Cliente con histórico USD/m² espera ver USD en factura nueva | 🟢 Bajo | Comunicar cambio a clientes vigentes (Ruth) antes de primera factura ARS |

### 8.3 Conteo de riesgos final

- 🚨 Críticos: **5** (sin cambio)
- 🔴 Altos: **4** (3 originales + 0 nuevos; R05/R14 eran USD-related — F1.R05 eliminado, R14 sigue)
- 🟡 Medios: 5 (3 originales + R26 + R27)
- 🟢 Bajos: 1 (R28)

---

## 9 · Cambios al impact analysis

### 9.1 Impacto en infraestructura — REDUCIDO

| Recurso | Antes | Después | Delta |
|---------|-------|---------|-------|
| Tablas Supabase | 10 | **9** | -1 (exchange_rates_log) |
| Triggers | 7 | 7 | 0 |
| RLS policies | ~25 | ~23 | -2 |
| Scheduled functions Netlify | 3 (recurring+mora+exchange) | **2** | -1 |
| Integraciones externas | 6 (incluía BCRA) | **5** | -1 |

### 9.2 Impacto en costos — NULO (ya era $0)

BCRA API era gratuita. No hay ahorro monetario. Sí hay ahorro de complejidad y tiempo de mantenimiento.

### 9.3 Impacto en seguridad — REDUCIDO

| Vector | Antes | Después |
|--------|-------|---------|
| Endpoints `/api/billing/exchange-rate/*` | sí | **ELIMINADOS** |
| Tabla `exchange_rates_log` con RLS | sí | **ELIMINADA** |
| Dependencia de BCRA API caída | sí (con fallback) | **ELIMINADA** |

---

## 10 · Cambios a las preguntas abiertas FASE 1A §8

| Pregunta original | Status post-amendment |
|-------------------|----------------------|
| 1. Catálogo terms | ✅ APROBADO (sin cambio) |
| 2. Día corte | ✅ APROBADO (sin cambio) |
| 3. Mora | ✅ APROBADO (sin cambio) |
| 4. Tolerancia | ✅ APROBADO (sin cambio) |
| **5. Moneda** | ✅ **AMENDED: ARS único** |
| 6. Auto-emit | ✅ APROBADO (sin cambio) |
| 7. Aprobador | ✅ APROBADO (sin cambio) |

---

## 11 · Beneficios de la simplificación

| Beneficio | Detalle |
|-----------|---------|
| **Menos código** | ~600 líneas SQL + ~800 líneas TS + ~150 líneas UI eliminadas |
| **Menos complejidad** | Eliminación de toda la capa de cotización (single point of complexity) |
| **Menos riesgos** | -2 riesgos críticos/altos relacionados con cotización |
| **Menos dependencias** | Sin BCRA API → sin dependencia externa |
| **Menos cron jobs** | 2 en lugar de 3 |
| **Menos features flags** | 7 en lugar de 8 |
| **Cronograma más corto** | ~12 semanas en lugar de ~14 |
| **UX más simple** | Wizards sin campos moneda/cotización |
| **Predictibilidad** | Facturación 100% predecible (sin variabilidad por cotización) |
| **Auditoría más simple** | Sin necesidad de auditar fuente de cotización |

---

## 12 · Implicaciones operativas para Ruth

| Antes (USD contractual) | Ahora (ARS único) |
|--------------------------|---------------------|
| Veía USD en contrato + cotización del día al revisar borradores | Ve ARS directo en contrato y factura |
| Tenía que entender BCRA para validar cotización | No necesita entender BCRA |
| Si BCRA fallaba, había que decidir fallback | No aplica |
| Updates de precios contractuales eran "movimiento de USD vs ARS" | Updates de precios son **decisión explícita** de revisar contrato |

**Recomendación operativa:** establecer **revisión trimestral de precios contractuales** con cliente para ajustar por inflación. Documentar en `recurring_contracts.notas`.

---

## 13 · Comunicación recomendada a clientes vigentes

Si BIDCOM, BAGÓ u otros clientes tenían precios USD acordados verbalmente:

1. **Mes de transición:** Ruth contacta cliente, comunica:
   > "A partir del próximo período facturamos en ARS al equivalente actual de USD X/m² = ARS Y/m². Si querés actualizar, decímelo."
2. **Confirmación del cliente:** documentar en `notas` del contrato + `recurring_contract_lines.notes`
3. **Primer ciclo ARS:** generar contrato + factura test, validar con cliente antes de auto-emit

---

## 14 · Estado de los docs FASE 1A/1B post-amendment

| Doc | Status |
|-----|--------|
| `FASE-1A-AUDIT.md` | sin cambio (audit del estado pre-FASE 1A no afectado) |
| `FASE-1A-DATA-MODEL.md` | **superseded en sección moneda** por este AMENDMENT |
| `FASE-1A-RELATIONS.md` | superseded en referencias a exchange_rates_log |
| `FASE-1A-RLS.md` | sin cambio significativo |
| `FASE-1A-MIGRATION-0014.md` | **superseded en sección exchange_rates_log + campos currency** |
| `FASE-1A-UX.md` | superseded en wizards (campos moneda eliminados) |
| `FASE-1A-RISKS.md` | superseded en F1.R05 + R19 + nuevos R26-R28 |
| `FASE-1A-IMPACT.md` | superseded en métricas de infra |
| `FASE-1A-IMPL-PLAN.md` | superseded en estimaciones |
| `FASE-1B-MODULES.md` | **superseded en módulo exchange-rate/** + simplificaciones |
| `FASE-1B-API-DESIGN.md` | **superseded en endpoints exchange-rate** + bodies simplificados |
| `FASE-1B-BACKLOG.md` | **superseded en ÉPICA E2** + estimaciones |
| `FASE-1B-ROLLOUT.md` | superseded en Cron 3 + Feature flags |

Los 4 docs FASE 1B serán anotados con un banner al inicio apuntando a este AMENDMENT (pattern usado en docs anteriores tipo `DRIVE-FINAL-REDTEAM.md`).

---

## 15 · Restricciones honradas

- 🛑 NO IMPLEMENTAR este cambio en código
- 🛑 NO MODIFICAR los docs originales FASE 1A/1B (auditoría histórica preservada)
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO TOCAR producción · credenciales · Drive · ARCA · RBAC
- 🛑 NO INVENTAR — todo el cambio trazable a la directiva explícita del usuario
- 🛑 Trazabilidad mantenida — docs originales quedan vigentes salvo donde este AMENDMENT supersede explícitamente
