# FASE 1A · AUDIT

**Fecha:** 2026-05-29
**Commit base:** `4d1dbff` en `feature/nexus-fullstack`
**Modo:** auditoría de reutilización · sin código · sin tocar producción
**Scope:** facturación recurrente exclusivamente
**Regla aplicada:** `NO ASUMIR · VERIFICAR` — cada hallazgo cita file:line o migración

---

## 1 · Resumen de reutilización

Lo que existe y se **reutiliza tal cual** sin modificar:

| Pieza | Status | Ubicación |
|-------|--------|-----------|
| Migration `0011_arca_billing.sql` | ✅ aplicada (per memoria FASE E1 + GATE 2) | `supabase/migrations/0011_arca_billing.sql` |
| Migration `0013_invoices_storage_isolation.sql` | ✅ aplicada (R4 cerrado, GATE 2) | `supabase/migrations/0013_invoices_storage_isolation.sql` |
| Tabla `customer_invoices` | ✅ schema completo | mig 0011, líneas 133-201 |
| Tabla `invoice_items` | ✅ schema completo | mig 0011, líneas 212-228 |
| Tabla `invoice_audit` | ✅ append-only + RLS | mig 0011, líneas 234-246 |
| Tabla `fiscal_config` (singleton VEROTIN) | ✅ seeded | mig 0011, líneas 69-111 |
| Tabla `puntos_venta` | ✅ seeded (PV 2 y 3) | mig 0011, líneas 116-128 |
| Enums fiscales (`condicion_iva_t`, `comprobante_tipo_t`, `invoice_arca_status_t`, etc.) | ✅ creados | mig 0011, líneas 13-56 |
| Extensión `clients.condicion_iva` + `tipo_doc` + `localidad` | ✅ aplicada | mig 0011, líneas 60-63 |
| Trigger `tg_lock_authorized_invoice` | ✅ activo | mig 0011, líneas 257-281 |
| Lib `src/lib/invoicing/` | ✅ types, data, calc, emit, storage | dir 6 archivos |
| Lib `src/lib/arca/` | ✅ wsaa, wsfev1, cms-forge, soap, qr, mock+production service | dir 10 archivos |
| Buckets storage `invoices` | ✅ multi-tenant isolation aplicada | mig 0013 |
| UI `/billing` | ✅ esqueleto live | `src/app/(app)/billing/page.tsx`, `actions.ts`, `EmitInvoiceButton.tsx` |
| Endpoint `/api/invoices/[id]/pdf` | ✅ existe | dir `src/app/api/invoices/[id]/pdf/` |
| RBAC permissions actuales | ✅ live | `src/lib/rbac/data.ts` |
| RLS de `customer_invoices` | ✅ activa | mig 0011, líneas 314-326 |
| Path canónico Drive | ✅ definido `{client_id|'_global'}/{yyyy}/{mm}/{cbte_tipo}-{pv}-{nro}-{sha8}.pdf` | header de 0013 |

---

## 2 · Lo que NO existe (gap real para FASE 1A)

### 2.1 Modelo de datos

| Tabla / View | Status | Necesidad para FASE 1A |
|--------------|--------|------------------------|
| `recurring_contracts` | ❌ no existe | crítica — núcleo del motor recurrente |
| `recurring_contract_lines` | ❌ no existe | crítica — items contratados (m², abonos, conceptos) |
| `customer_accounts` | ❌ no existe | crítica — header de cuenta corriente por cliente |
| `customer_transactions` | ❌ no existe | crítica — movimientos (factura, NC, cobro, ajuste, interés) |
| `customer_balances` (view) | ❌ no existe | crítica — saldo agregado por cliente |
| `payment_terms` | ❌ no existe | crítica — catálogo de condiciones (contado, 30d, 60d, 30/60/90, custom) |
| `late_fees` (config + aplicaciones) | ❌ no existe | media — para intereses por mora |
| Tabla `recurring_runs` (historial de ejecuciones del motor) | ❌ no existe | crítica para idempotencia |

### 2.2 Lógica de negocio

| Función | Status | Reutilizable? |
|---------|--------|---------------|
| Cálculo de neto + IVA + total por línea | ✅ existe en `src/lib/invoicing/calc.ts` | **SÍ** |
| Emisión ARCA (request + CAE) | ✅ existe en `src/lib/invoicing/emit.ts` (12.7 KB) | **SÍ** (reusar tal cual) |
| Almacenamiento PDF en bucket `invoices` con path canónico | ✅ existe en `src/lib/invoicing/storage.ts` (`buildInvoicePdfPath`) | **SÍ** |
| Snapshot del receptor (cuit/razón social/condición IVA al momento) | ✅ patrón ya en `customer_invoices` | **SÍ** |
| Motor de scheduling recurrente (cron) | ❌ no existe | **NUEVO** |
| Cálculo de saldo por cliente | ❌ no existe | **NUEVO** |
| Aplicación de pagos parciales a facturas (orden FIFO o configurable) | ❌ no existe | **NUEVO** |
| Cálculo de intereses por mora | ❌ no existe | **NUEVO** |
| Generación de borrador de factura desde contrato | ❌ no existe | **NUEVO** |

### 2.3 UI

| Pantalla | Status | Decisión |
|----------|--------|----------|
| `/billing` listado de facturas | ✅ live (esqueleto) | refactorizar a sub-shell con tabs |
| `/billing/recurrentes` | ❌ no existe | **NUEVO** |
| `/clients/[id]/cuenta-corriente` | ❌ no existe | **NUEVO** |
| `/billing/cobros` | ❌ no existe | **NUEVO** |
| `/billing/vencimientos` | ❌ no existe | **NUEVO** |
| Dashboard ejecutivo widgets financieros (MRR/ARR/morosos) | ❌ no existe | **NUEVO** (sólo añadir widgets a `/ejecutivo`) |

### 2.4 APIs

| Endpoint | Status | Decisión |
|----------|--------|----------|
| `POST /api/billing/invoices/emit` (vía actions.ts) | ✅ existe | reutilizar |
| `POST /api/billing/recurring/templates` | ❌ no existe | NUEVO |
| `POST /api/billing/recurring/run` (manual run) | ❌ no existe | NUEVO |
| `GET /api/billing/customer-accounts/[clientId]` | ❌ no existe | NUEVO |
| `POST /api/billing/payments/apply` | ❌ no existe | NUEVO |
| Cron Netlify scheduled function para corridas mensuales | ❌ no existe | NUEVO |

### 2.5 RBAC

Permisos actuales relacionados (`src/lib/rbac/data.ts` líneas 38, 71-78):
- `compras.*` (view/create/edit/sign/export/delete)
- `servicios.*` (view/create/sign)
- `compliance.view`
- **No hay `billing.*`** — FASE 1A debe crear: `billing.view`, `billing.create`, `billing.recurring.manage`, `billing.payments.register`

---

## 3 · Pre-condiciones técnicas verificadas

| Pre-condición | Status | Evidencia |
|---------------|--------|-----------|
| Tabla `clients` con `condicion_iva` + `tipo_doc` + `localidad` | ✅ | mig 0011 líneas 60-63 |
| `customer_invoices` permite `periodo text` ('YYYY-MM') | ✅ | mig 0011 línea 155 |
| `customer_invoices.fch_serv_desde/hasta` para servicios mensuales | ✅ | mig 0011 líneas 152-153 |
| Trigger lock-on-authorized funciona | ✅ | activo desde GATE 2 |
| RLS multi-tenant invoices (cliente ve sólo lo suyo) | ✅ | mig 0011 líneas 316-321 |
| RBAC funcionando con fail-closed bajo service_role (R22 closure) | ✅ | `src/lib/rbac/check.ts:122` |
| Storage bucket `invoices` multi-tenant aislado | ✅ | mig 0013 (R4 closure) |
| Path canónico Drive definido | ✅ | `src/lib/invoicing/storage.ts` |
| ARCA en SANDBOX + GATE 3 cerrado | ✅ | per memoria persistente |

---

## 4 · Componentes reutilizables identificados

### 4.1 Para el motor recurrente

**Reusar de `src/lib/invoicing/calc.ts`:**
- Cálculo de IVA por alícuota
- Redondeo fiscal
- Conversión moneda

**Reusar de `src/lib/invoicing/emit.ts`:**
- Flujo `BORRADOR → PENDIENTE_ARCA → AUTORIZADO_ARCA`
- Lógica de selección de tipo de comprobante según condición IVA del receptor (A/B/C)
- Snapshot del receptor al momento de emitir

**Reusar de `src/lib/invoicing/storage.ts`:**
- `buildInvoicePdfPath` para guardar PDFs
- `INVOICES_BUCKET`

**Reusar de `src/lib/arca/`:**
- WSFEv1 client (cuando se emita)
- QR fiscal generator
- Mock service para tests locales

### 4.2 Para cuenta corriente

**Reusar de `customer_invoices`:**
- `total`, `fch_vto_pago`, `estado_arca`, `periodo`
- ya hay índices por `client_id` y `created_at`

**Reusar de patrones existentes:**
- Trigger `tg_lock_authorized_invoice` como modelo para triggers de `customer_transactions` (append-only para movimientos posteados)
- RLS pattern de mig 0011 líneas 316-321 (cliente ve sólo lo suyo)
- Append-only pattern de `invoice_audit` para `customer_transactions`

### 4.3 Para UI

**Reusar de `src/app/(app)/billing/page.tsx`:**
- Listado existente como base del tab "Facturas"
- Filtros + paginación

**Reusar de `src/components/shell/Sidebar.tsx`:**
- Patrón de dominio "Facturación · CRM" para agregar items recurrente / cuenta corriente

**Reusar de `src/components/compras/`:**
- Tablas paginadas
- Cards de KPI
- Patrón Sparkline para mini-gráficos en cuenta corriente

**Reusar del Compliance Alert Engine recién hecho:**
- Pattern de score + buckets por severidad → aplicable a "Clientes morosos" (rojo 90+ d, amarillo 30-89, verde al día)

---

## 5 · Convenciones aplicables (no negociables)

Heredadas del proyecto, deben cumplirse en FASE 1A:

| Convención | Origen | Aplicación FASE 1A |
|------------|--------|---------------------|
| Migration idempotente (`if not exists`, `do$$ begin … exception …$$`) | FASE 0 governance DB | obligatoria para 0014 |
| Down-migration comentada al final | FASE 0 governance DB | obligatoria |
| Registro en `schema_migrations` tracker (no via bootstrap) | PARIDAD-3 closure | obligatoria |
| Path canónico Drive | mig 0013 + invoicing/storage | reutilizar para futuros docs PDF de recurrentes |
| RLS pattern "internos ven todo + cliente ve su client_id" | mig 0011 líneas 316-321 | replicar para nuevas tablas |
| Trigger lock para datos fiscales | mig 0011 líneas 257-281 | replicar para `customer_transactions` posteadas |
| Snapshot del receptor en factura (no JOIN) | `customer_invoices` columnas 137-142 | mantener para facturas generadas por motor recurrente |
| `numeric(15,2)` para importes | mig 0011 líneas 168-176 | obligatorio en `customer_transactions`, balances |
| RBAC server-side con `requireDrivePermission()` pattern | R22 closure | replicar como `requireBillingPermission()` |
| Logging estructurado JSON | Drive `logDrive` | replicar como `logBilling` para auditoría operativa |

---

## 6 · Hallazgos importantes del audit

### 6.1 ✅ Hallazgo positivo: el snapshot de receptor ya existe

`customer_invoices` guarda `cuit_cliente`, `razon_social`, `condicion_iva`, `domicilio_cliente`, `doc_tipo` como **snapshot al momento de emitir** (mig 0011 líneas 137-142). Esto es exactamente lo que necesitamos para la facturación recurrente: si el cliente cambia datos fiscales después, las facturas emitidas conservan la verdad histórica.

→ **No necesitamos rediseñar el receptor.**

### 6.2 ✅ Hallazgo positivo: campo `periodo` ya está

`customer_invoices.periodo text` (mig 0011 línea 155) acepta 'YYYY-MM'. Perfecto para identificar facturas mensuales recurrentes. El motor recurrente lo va a setear automáticamente.

### 6.3 ✅ Hallazgo positivo: fechas de servicio ya están

`customer_invoices.fch_serv_desde / fch_serv_hasta` (mig 0011 líneas 152-153) son obligatorias en ARCA para `concepto=2` (servicios). El motor recurrente las completa con el primer y último día del período.

### 6.4 ⚠️ Hallazgo de fricción: condición IVA del receptor determina tipo de comprobante

Lógica actual (en `emit.ts`): el tipo de comprobante (A/B/C) se decide al emitir según `client.condicion_iva` + `fiscal_config.condicion_iva`. **El motor recurrente debe llamar a esa lógica al generar borradores**, no decidir él mismo.

→ **No duplicar lógica fiscal — invocar emit.ts/calc.ts.**

### 6.5 ⚠️ Hallazgo de gap operativo: no hay cuenta corriente todavía

Hoy `customer_invoices` se lista pero no se agrega por cliente como saldo. Los cobros tampoco existen. FASE 1A debe introducir esta capa.

### 6.6 ⚠️ Hallazgo de riesgo: trigger lock vs anulación lógica

El trigger `tg_lock_authorized_invoice` (mig 0011 líneas 257-281) permite cambios a `anulada=true` pero NO a campos fiscales. **Importante para FASE 1A:** cuando el motor recurrente genera una factura mensual, debe respetar este lock. Si se equivoca y la factura ya tiene CAE, la corrección debe ser vía NC, no via UPDATE.

### 6.7 ✅ Hallazgo positivo: ARCA factory ya soporta retries y mocks

`src/lib/arca/production-service.ts` + `mock-service.ts` separan claramente prod vs sandbox. El motor recurrente puede usar `mock-service` durante FASE 1A para tests sin tocar ARCA.

---

## 7 · Lo que NO se modifica en FASE 1A

| Componente | Razón |
|------------|-------|
| `customer_invoices` schema | Lock-on-authorized + factura electrónica vigente. Ampliar via tablas relacionadas (recurrente y CC), no via columnas. |
| `invoice_items` schema | Patrón estable. Items recurrentes van en `recurring_contract_lines`. |
| `fiscal_config` | Singleton ya cargado con VEROTIN. |
| ARCA WSFEv1 lib | Sandbox + GATE 3. No tocar hasta FASE 5. |
| RBAC core (mig 0009) | Sólo agregar nuevos slugs vía 0014 sin alterar existentes. |
| Drive integration | 🟢 READY independiente. |
| Trigger `tg_lock_authorized_invoice` | Garantía fiscal. No tocar. |

---

## 8 · Inputs externos que aún no tengo y los voy a necesitar

| Input | Pregunta abierta | Decisión propuesta default |
|-------|------------------|----------------------------|
| Catálogo de **condiciones de pago** | ¿Qué opciones reales hay? | Contado · 7d · 15d · 30d · 60d · 90d · 30/60 · 30/60/90 |
| **Día de corte** para facturación mensual | ¿Día 1 del mes? ¿Último día del mes anterior? | Día 1 a las 09:00 ART; ventana de gracia hasta día 5 |
| **Tasa de interés por mora** | ¿% mensual? ¿Tasa BCRA? | 3% mensual lineal · configurable por cliente |
| **Tolerancia de saldo "cancelado"** | ¿Diferencias <$X se ignoran? | Cents (saldo <$100 → notificar pero no facturar) |
| Moneda primaria recurrente | ¿USD o ARS? Casos del prompt mencionan USD | **USD facturado y emitido en ARS con cotización del día** (ARCA exige PES para FA tipo A nacional) |
| Quién aprueba antes de emitir | ¿Ruth siempre? ¿Auto si <$X? | Default: aprobación manual; opción auto-emisión si flag `auto_emit=true` en contrato |

→ Estas decisiones quedan **abiertas para Entregable 9 (plan de implementación)**.

---

## 9 · Conclusión del audit

| Aspecto | Estado |
|---------|--------|
| Infraestructura fiscal | ✅ sólida (mig 0011/0013, libs invoicing+arca) |
| Reutilización posible | ✅ alta (~70% del módulo se construye sobre piezas existentes) |
| Modelo de datos requerido | ❌ totalmente nuevo (8 tablas + 1 view) |
| Tabla a nuevamente | Migration 0014 |
| Riesgo arquitectónico | bajo (todo aditivo, sin cambios destructivos) |
| Riesgo operativo | medio (motor de scheduling + idempotencia bien hechos) |
| Riesgo fiscal | bajo (reutilizar emit + lock + audit existentes) |

**Veredicto del audit:** ⚙️ **VIABLE** — FASE 1A se construye sobre infraestructura sólida + idempotencia.

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR — este es solo el audit
- 🛑 NO TOCAR código existente
- 🛑 NO SQL ejecutable
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO TOCAR ARCA / RBAC / Drive
- 🛑 NO TOCAR producción
- 🛑 NO INVENTAR — toda evidencia citada de file:line o migración
