# AUDITORÍA CONTABLE E IMPOSITIVA — SISTEMA OPERATIVO NEXUS

> **Empresa:** Logística TOPS / Verotín S.A. (3PL)
> **Sistema auditado:** TOPS NEXUS (Next.js App Router + Supabase/PostgreSQL)
> **Fecha de auditoría:** 2026-06-20
> **Auditor:** Auditoría funcional + criterio de contador senior + arquitectura ERP
> **Alcance:** Capa impositiva, contable y de cierre anual de balance
> **Naturaleza del documento:** DIAGNÓSTICO Y PROPUESTA. No ejecuta migraciones, no toca producción, no modifica ARCA. Auditar → documentar → proponer.

---

## 0. Cómo leer este informe

Esta auditoría es **crítica y sin maquillaje**, según lo pedido. La conclusión de una línea es:

> **Nexus tiene una capa FISCAL (IVA compras, IVA ventas, facturación ARCA, tesorería) sólida y bien construida, pero NO tiene una capa CONTABLE (plan de cuentas, asientos por partida doble, mayor, balance). Hoy es un sistema de gestión fiscal-operativa, no un sistema contable. No puede, por sí solo, producir un balance anual ni la posición mensual de IVA consolidada.**

Esto corrige una de las premisas del pedido: la sospecha de "si hay IVA compras debería haber IVA ventas, y quizás no existe" es **incorrecta en los hechos**. IVA ventas **sí existe** y está razonablemente bien resuelto. La brecha verdadera, y más grave, está un nivel más arriba: **no hay contabilidad** y **no hay una vista única de posición mensual de IVA**.

---

## 1. Resumen ejecutivo

### 1.1. Veredicto

| Pilar | Estado | Nota |
|---|---|---|
| **Plan de cuentas** | ❌ No existe | Solo diseñado en doc, nunca implementado |
| **IVA Compras (crédito fiscal)** | ✅ Maduro | Multi-alícuota, percepciones/retenciones desglosadas, RPC-first, libro IVA |
| **IVA Ventas (débito fiscal)** | ✅ Existe / 🟡 con brechas | Débito discriminado y libro IVA OK; **percepciones de venta sin desglose** |
| **Posición mensual de IVA** | ❌ No consolidada | Existen libros por separado; falta la vista que reste débito − crédito − percep. − retenc. |
| **Asientos contables / partida doble** | ❌ No existe | Ninguna operación genera asiento |
| **Mayor / balance de sumas y saldos / EERR** | ❌ No existe | Imposible cerrar balance desde el sistema |
| **Cuentas por cobrar / pagar (subledgers)** | ✅ Como vistas | Derivadas de facturas + imputaciones (no hay tabla-libro persistente) |
| **Tesorería (cobros/pagos/banco)** | ✅ MVP sólido | Append-only, imputaciones a facturas, conciliación bancaria parcial |
| **Retenciones practicadas a proveedores** | ❌ No existe | `supplier_payments` no tiene `retention_amount` |
| **Períodos fiscales / cierre y bloqueo** | ❌ No existe | El "período" es un `to_char(fecha,'YYYY-MM')`, no una entidad gobernable |

### 1.2. Lo bueno (para no maquillar en la otra dirección)

La capa fiscal está **genuinamente bien hecha**, con patrones de ingeniería que muchos ERP comerciales no respetan:

- **Detalle fiscal canónico, cabecera como caché reconciliada.** El IVA vive en tablas de líneas por alícuota (`supplier_invoice_vat_lines`, `customer_invoice_vat_lines`); la cabecera es un resumen que el sistema **reconcilia y valida** (identidad `total = neto + iva + no_gravado + exento + percepciones + tributos ± 0,02`).
- **RPC-first con guards.** Toda escritura fiscal pasa por funciones `SECURITY DEFINER` con `set_config('...via_rpc','on')`; triggers rechazan inserts directos. No se puede corromper el detalle fiscal por la puerta de atrás.
- **Append-only e inmutabilidad.** Comprobantes autorizados se bloquean; anulaciones son lógicas; auditoría insert-only.
- **Signo de notas de crédito** correctamente aplicado en libros IVA (las NC restan).
- **Aritmética exacta** (numeric, centavos enteros en la capa de cuenta corriente).

El problema **no es la calidad de lo construido**, sino **el alcance**: se construyó la mitad fiscal-operativa de un ERP financiero y se dejó sin construir la mitad contable, que es justamente la que el objetivo de esta auditoría (cierre de balance) necesita.

### 1.3. Prioridad #1

Para el objetivo declarado — **cierre anual de balance + posición mensual de IVA + trazabilidad contable** — el sistema **hoy no alcanza**. Faltan, en orden de criticidad:

1. **Vista de posición mensual de IVA** (consolidar lo que ya existe). *Esfuerzo bajo, valor inmediato.*
2. **Plan de cuentas + motor de asientos + mayor** (capa contable). *Esfuerzo alto, es el corazón del balance.*
3. **Reportes de cierre** (EERR, sumas y saldos, libros IVA exportables, CxC/CxP). *Depende de 2, salvo libros IVA que ya existen.*
4. **Retenciones practicadas y períodos fiscales.** *Tapan agujeros impositivos concretos.*

---

## 2. Diagnóstico actual (mapa de lo que existe)

### 2.1. Arquitectura de capas — estado real vs. objetivo

El documento maestro `ERP-FINANCE-ARCHITECTURE.md` definió un backbone de 4 capas. Este es el estado **real** de implementación:

```
CAPA 0 — MAESTROS Y CATÁLOGOS
  clients ✅ · vendors ✅ · products ✅ · services_catalog ✅
  cost_centers ✅ (tabla existe, integración parcial)
  chart_of_accounts ❌ · tax_rates ❌ · fiscal_periods ❌      ← NUNCA IMPLEMENTADO (era "0012")

CAPA 1 — DOCUMENTOS OPERATIVOS
  orders (OS) ✅ · purchase_orders (OC) ✅
  customer_invoices ✅ (+ vat_lines ✅)
  supplier_invoices ✅ (+ vat_lines ✅ + other_taxes ✅)
  logistics_orders ✅ (pero NO conectado a facturación)

CAPA 2 — SUBLEDGERS (cuenta corriente)
  ar_ledger / ap_ledger ❌ como TABLA
  customer_open_items / supplier_open_items ✅ como VISTA derivada
  customer_current_account / supplier_current_account ✅ como VISTA

CAPA 3 — TESORERÍA
  bank_accounts ✅ · treasury_movements ✅
  customer_receipts ✅ · supplier_payments ✅ (sin retenciones)
  receipt_allocations ✅ · payment_allocations ✅
  conciliación bancaria 🟡 (parsers + matching listos; persistencia sin aplicar)

CAPA 4 — CONTABILIDAD GENERAL
  journal_entries / journal_entry_lines ❌      ← NO EXISTE
  estado de resultados / balance ❌             ← NO EXISTE
```

**Lectura del diagnóstico:** se construyeron las capas 1, 2 (como vistas) y 3. La **capa 0 contable** (plan de cuentas, períodos, alícuotas maestras) y **toda la capa 4** (contabilidad) **no existen**. La capa 4 es exactamente la que produce el balance.

### 2.2. Inventario de tablas relevantes (evidencia)

**Compras / Cuentas por pagar (AP)** — migraciones 0008, 0014, 0015, 0056, 0057, 0058, 0059, 0071:
- `vendors`, `products`, `purchase_orders`, `po_items`, `po_events`
- `cost_centers` (0014)
- `supplier_invoices` (cabecera; estados `approval_status`: cargada→en_revision→aprobada→anulada)
- `supplier_invoice_vat_lines` (IVA crédito por alícuota; pares AFIP validados)
- `supplier_invoice_other_taxes` (percepciones IVA/IIBB/Ganancias, impuesto interno, otro; IIBB exige jurisdicción)
- `supplier_invoice_items`, `supplier_invoice_audit` (append-only)
- Vistas: `supplier_invoice_fiscal`, `libro_iva_compras`, `supplier_ap_status`, `supplier_open_items`

**Ventas / Facturación / Cuentas por cobrar (AR)** — migraciones 0011, 0072, 0073, 0071:
- `fiscal_config` (datos de Verotín S.A., ambiente SANDBOX/PRODUCCION), `puntos_venta`
- `customer_invoices` (cabecera; `estado_arca`: BORRADOR→…→AUTORIZADO_ARCA; CAE, QR, períodos de servicio)
- `customer_invoice_vat_lines` (IVA débito por alícuota; **paridad con compras**)
- `invoice_items` (link opcional `order_id`), `invoice_audit`
- Vistas: `customer_invoice_fiscal`, `libro_iva_ventas`, `customer_open_items`, `customer_current_account`

**Tesorería** — migraciones 0053, 0054, 0055:
- `bank_accounts` (incluye CAJA de sistema), `treasury_movements` (append-only, MOV-YYYY-NNNNNN)
- `customer_receipts` (REC-…, con `retention_amount` sufrida y `net_amount` generado)
- `supplier_payments` (PAG-…, **sin** `retention_amount`)
- `receipt_allocations` (cobro→factura cliente), `payment_allocations` (pago→factura proveedor)
- Vistas: `treasury_bank_balances`, `customer/supplier_current_account`

**Órdenes operativas** — migraciones 0001, 0030:
- `orders` + `order_services` (Flujo A; tienen `total` y `rate`, **sin IVA discriminado**; el IVA se calcula al emitir)
- `logistics_orders` + `order_items` (3PL; **sin** vínculo a facturación)

**Contabilidad** — **ninguna tabla**. Confirmado por barrido exhaustivo de `supabase/migrations/*.sql`: no existen `chart_of_accounts`, `journal_entries`, `journal_entry_lines`, `fiscal_periods`, `tax_rates`, `ar_ledger`, `ap_ledger`. El documento `docs/MIGRATION-0012-DESIGN-REVIEW.md` los diseña conceptualmente pero **declara explícitamente que no crea SQL**.

### 2.3. Lo que el sistema SÍ puede producir hoy

- Libro IVA Compras por período y alícuota (vista `libro_iva_compras` + export CSV/XLSX).
- Libro IVA Ventas por período y alícuota (vista `libro_iva_ventas`).
- Cuentas por cobrar y por pagar abiertas (vistas `*_open_items` / `*_current_account`).
- Saldos bancarios derivados (vista `treasury_bank_balances`).
- Facturación electrónica con CAE/QR (en SANDBOX; producción gated por credenciales X.509).

### 2.4. Lo que el sistema NO puede producir hoy

- **Posición mensual de IVA** (débito − crédito − percepciones sufridas − retenciones, saldo a pagar / a favor). *Los insumos existen; falta la vista que los una.*
- **Estado de resultados**, **balance de sumas y saldos**, **balance general**, **mayor contable**. *Falta toda la capa contable.*
- **Asiento de ninguna operación.** Una factura, un cobro o un pago no impactan en ninguna cuenta contable.
- **Retenciones practicadas** a proveedores (impositivamente obligatorias).
- **Cierre y bloqueo de período** contable/fiscal.

---

## 3. Auditoría por punto obligatorio

### 3.1. Plan de cuentas

| Pregunta | Respuesta |
|---|---|
| ¿Existe un plan de cuentas? | **No.** No hay tabla `chart_of_accounts`. |
| ¿Está bien estructurado? | N/A — no existe. Solo hay un diseño en `ERP-FINANCE-ARCHITECTURE.md §6.1` y `docs/MIGRATION-0012-DESIGN-REVIEW.md`. |
| ¿Permite clasificar activo/pasivo/PN/ingresos/costos/gastos/impuestos/IVA CF/IVA DF/percep./retenc.? | **No.** Esa clasificación no existe en ninguna tabla. El "tipo" de una operación hoy se infiere del módulo donde vive (compra, venta, tesorería), no de una cuenta contable. |
| ¿Faltan cuentas clave? | Faltan **todas**. |

**Severidad: CRÍTICO.** Sin plan de cuentas no hay contabilidad posible. Es el cimiento.

**Propuesta de plan de cuentas mínimo viable (3PL — Logística TOPS / Verotín S.A.):** ver §8.1.

---

### 3.2. IVA Compras

| Pregunta | Respuesta |
|---|---|
| ¿Registra IVA crédito fiscal? | **Sí**, en `supplier_invoice_vat_lines` (`base_neto`, `importe_iva` por alícuota). |
| ¿Contempla distintas alícuotas? | **Sí.** Pares AFIP validados: 0% / 2,5% / 5% / 10,5% / 21% / 27%, una fila por alícuota por comprobante. |
| ¿Percepciones / retenciones / imp. internos / otros? | **Sí**, en `supplier_invoice_other_taxes` con `tax_kind` ∈ {PERCEPCION_IVA, PERCEPCION_IIBB (requiere jurisdicción), PERCEPCION_GANANCIAS, IMPUESTO_INTERNO, OTRO}, base, alícuota, importe. |
| ¿Datos disponibles para reportes mensuales? | **Sí.** Vistas `supplier_invoice_fiscal` y `libro_iva_compras` agregan por período/alícuota, con signo de NC y filtro de anuladas. Export CSV/XLSX implementado. |

**Severidad: BAJO (módulo maduro).** Observaciones menores:
- **Falta imputación contable** (`chart_account_id` por línea) → necesario para asientos automáticos.
- **Falta UI para el workflow de aprobación**: los RPC `ap_submit_for_review / ap_approve / ap_reopen / ap_void` existen, pero no hay pantalla que los dispare (workflow "dormido" en UI). **Severidad: MEDIO** (operativo).

---

### 3.3. IVA Ventas

> **Corrección a la premisa del pedido:** IVA Ventas **sí existe**. La brecha sospechada no es real en lo estructural.

| Pregunta | Respuesta |
|---|---|
| ¿Existe IVA ventas en facturación/comercial? | **Sí.** `customer_invoices` + `customer_invoice_vat_lines`. |
| ¿Se calcula IVA débito fiscal? | **Sí**, por alícuota, con el mismo rigor que compras (identidad y pares AFIP validados; trigger diferido exige ≥1 línea IVA y cuadre con cabecera ±0,02). |
| ¿Se discrimina IVA en comprobantes? | **Sí**, en líneas por alícuota; cabecera con `subtotal`, `iva`, `no_gravado`, `exento`, `total`. |
| ¿Se obtiene la posición/ libro mensual? | Libro IVA Ventas: **sí** (vista `libro_iva_ventas` por período/alícuota). Posición mensual consolidada (compras+ventas): **no** (ver §3.4). |
| ¿Las OS tienen campos de IVA? | **No directamente.** `orders`/`order_services` tienen `rate`/`total` sin IVA; el IVA se calcula en el motor `emitInvoice` al facturar. Es un diseño aceptable (la OS es operativa, la factura es fiscal). |

**Brecha real (Severidad: ALTO):** **Percepciones de venta sin desglose.** A diferencia de compras, ventas **no tiene** `customer_invoice_other_taxes`. Las percepciones/tributos viven solo como totales planos en la cabecera (`percepciones`, `tributos`). Impacto: si Verotín actúa como **agente de percepción** (IIBB, IVA), no puede discriminar ni reportar el detalle de lo percibido por jurisdicción → problema para DDJJ de percepciones y para el régimen informativo.

**Dependencia (Severidad: ALTO operativo):** la emisión real a ARCA está **gated** por certificado X.509 + clave privada + `fiscal_config.ambiente = PRODUCCION`. Hoy opera en SANDBOX con servicio mock. Hasta no levantar ese freeze, no hay débito fiscal "real" facturado por el sistema.

---

### 3.4. Posición mensual de IVA

| Componente requerido | ¿Disponible? |
|---|---|
| Total IVA compras (crédito fiscal) | ✅ `libro_iva_compras.iva_credito_fiscal` |
| Total IVA ventas (débito fiscal) | ✅ `libro_iva_ventas.iva_debito_fiscal` |
| Saldo técnico (DF − CF) | ❌ No hay vista que lo calcule |
| Percepciones sufridas (compras) | 🟡 Existen en `supplier_invoice_other_taxes`, pero no entran a una posición |
| Retenciones sufridas | 🟡 Parcial: `customer_receipts.retention_amount` (sufridas en cobros) |
| Retenciones practicadas | ❌ No existe (sin campo en `supplier_payments`) |
| Saldo a pagar / a favor | ❌ No se calcula |

**Severidad: CRÍTICO para el objetivo.** Es la brecha de **mayor relación valor/esfuerzo**: los dos insumos pesados (libros IVA compras y ventas) ya existen y están bien hechos. **Falta una sola vista de consolidación** `v_posicion_iva` (ver §8.4) que reste y exponga el saldo del período. Es la primera cosa que recomendamos construir.

---

### 3.5. Balance anual

| Pregunta | Respuesta |
|---|---|
| ¿La info permite alimentar un balance anual? | **Parcialmente, y solo manualmente.** Hay facturas, cobros y pagos con montos correctos, pero **sin imputación contable**. Un contador externo podría reconstruir el balance a mano desde los libros IVA + tesorería, pero el sistema **no lo produce**. |
| ¿Las operaciones tienen imputación contable? | **No.** Ninguna operación referencia una cuenta contable. |
| ¿Ingresos/costos/gastos/compras/ventas/impuestos registrados? | Registrados como **documentos fiscales y operativos**, **no como movimientos contables**. No hay separación ingreso/costo/gasto a nivel de cuenta. |
| ¿Qué falta para el contador externo? | Plan de cuentas, asientos, mayor, EERR, balance de sumas y saldos, libros IVA exportables (existen), CxC/CxP (existen como vistas), reporte de impuestos (falta posición IVA). |

**Severidad: CRÍTICO.** El sistema **no está preparado** para cierre anual de balance de forma autónoma. Reportes mínimos propuestos: §9.

---

### 3.6. Integración entre módulos

**Lo que SÍ está integrado (bien):**
- `supplier_invoices` ←→ `purchase_orders` (conciliación OC↔Factura, FK opcional).
- `customer_invoices` ←→ `orders` (FK `invoice_id` en orders + `invoice_items.order_id`; hardening H4 evita refacturar una OS ya facturada).
- Tesorería ←→ facturas: `receipt_allocations.customer_invoice_id` y `payment_allocations.supplier_invoice_id` imputan cobros/pagos a comprobantes; las cuentas corrientes se derivan de ahí. **El cobro baja la CxC y el pago baja la CxP correctamente.**
- Cobro/pago → `treasury_movements` → saldo bancario derivado.

**Lo que NO está integrado (brechas):**
- **Ninguna operación genera un asiento contable** (no hay a dónde imputar). El flujo se corta antes de la capa contable.
- `logistics_orders` (3PL) **no tiene vínculo con facturación** → ingresos logísticos que no nacen de `orders` quedan fuera del circuito de facturación/ventas.
- `cost_centers` **no está en `customer_invoices` ni en `treasury_movements`** → la rentabilidad por unidad de negocio (ANMAT, cargas generales, oficinas, coworking, transporte) no se puede armar del lado de ingresos ni de tesorería.
- Facturación recurrente (Flujo B: contratos→tarifas→corrida mensual) **no implementada** → almacenaje/alquileres se facturan a mano.

**Flujo ideal (objetivo) vs. real:**

| Flujo ideal | Estado real |
|---|---|
| Factura proveedor → IVA compras → cuenta contable → cuenta por pagar | IVA compras ✅ · cuenta por pagar ✅ (vista) · **cuenta contable ❌** |
| Factura cliente/OS facturada → IVA ventas → cuenta contable → cuenta por cobrar | IVA ventas ✅ · cuenta por cobrar ✅ (vista) · **cuenta contable ❌** |
| Cobranza → baja CxC → banco/caja | ✅ Completo (allocations + treasury_movements) · **falta asiento** |
| Pago proveedor → baja CxP → banco/caja | ✅ Completo · **falta asiento + retención practicada** |

**Severidad: ALTO.** La cañería operativa→tesorería está bien; **falta el último tramo hacia contabilidad** y dos conexiones (logistics→facturación, cost_center→ventas/tesorería).

---

### 3.7. Auditoría técnica (base de datos)

- **81 migraciones** numeradas y ordenadas; estilo idempotente (`create ... if not exists`, `on conflict`), patrón consistente.
- **RLS habilitada** en todas las tablas fiscales y de tesorería. Predicado típico: lectura para roles internos (`admin/operaciones/supervisor`) o cliente sobre lo suyo; escritura restringida; auditoría insert-only con triggers anti-delete.
- **RBAC granular** (`permissions`/`roles`/`role_permissions`/`user_roles`) con módulos `cuentas_pagar`, `tesoreria`, y roles financieros (`administracion_finanzas`, `gerencia_comercial` en 0070). **Falta** un módulo `contabilidad`/`finanzas.accounting`.
- **Enums fiscales** bien modelados (tipos de comprobante, condición IVA, `tax_kind`, métodos de pago, direcciones de movimiento).
- **Funciones RPC `SECURITY DEFINER`** con `set search_path` y guards `via_rpc` — patrón correcto y seguro.
- **Conciliación bancaria** (`src/lib/tesoreria/conciliacion/`): parsers (Galicia/Santander), normalización con validación de saldo continuo, motor de matching en 5 capas con scoring e IA determinística. **Pero las tablas de persistencia (`bank_statements`, `bank_statement_lines`, `bank_reconciliation_matches`) están diseñadas y NO aplicadas** (migraciones 0078–0080 pendientes), y faltan los RPC de ingest/accept/reject. Estado: **motor listo, persistencia y UI sin cerrar.**

**Tablas/relaciones faltantes (resumen):** `chart_of_accounts`, `account_types`, `journal_entries`, `journal_entry_lines`, `fiscal_periods`, `tax_rates` (opcional), `customer_invoice_other_taxes`, `retention_amount` en `supplier_payments`, `cost_center_id` en `customer_invoices` y `treasury_movements`, y las tablas de conciliación bancaria.

**Propuesta de migraciones: §8 (NO ejecutar sin aprobación).**

---

## 4. Hallazgos consolidados

| # | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| H1 | No existe plan de cuentas (`chart_of_accounts`) | Barrido de migraciones; solo diseño en docs | **Crítico** |
| H2 | No existe motor de asientos ni mayor (partida doble) | No hay `journal_entries`/`journal_entry_lines` | **Crítico** |
| H3 | No hay posición mensual de IVA consolidada | Existen libros separados, falta vista de saldo | **Crítico** |
| H4 | No hay EERR / balance de sumas y saldos / balance general | Ninguna vista contable | **Crítico** |
| H5 | Ninguna operación genera asiento contable | Falta capa 4; sin `chart_account_id` en documentos | **Crítico** |
| H6 | Percepciones de venta sin desglose (sin `customer_invoice_other_taxes`) | Solo totales en cabecera | **Alto** |
| H7 | Retenciones practicadas a proveedores no modeladas | `supplier_payments` sin `retention_amount` | **Alto** |
| H8 | No hay períodos fiscales gobernables ni cierre/bloqueo | "período" = `to_char(fecha)` | **Alto** |
| H9 | `logistics_orders` (3PL) no se conecta a facturación | Sin link a `customer_invoices` | **Alto** |
| H10 | `cost_centers` ausente en ventas y tesorería | Solo en compras/órdenes | **Medio** |
| H11 | Workflow de aprobación AP sin UI | RPC existen, falta pantalla | **Medio** |
| H12 | Conciliación bancaria sin persistencia ni UI aplicada | Motor listo, migraciones 0078–80 pendientes | **Medio** |
| H13 | Facturación recurrente (Flujo B) no implementada | Sin `contracts/recurring_services/tariffs/billing_runs` | **Medio** |
| H14 | Alícuotas en constraints, no en tabla maestra `tax_rates` | Hardcode validado por CHECK | **Bajo** |
| H15 | Emisión ARCA en SANDBOX (freeze de producción) | `fiscal_config.ambiente`, servicio mock | **Alto** (operativo, fuera de scope contable) |

---

## 5. Brechas detectadas (qué falta, concretamente)

1. **Capa contable completa**: plan de cuentas, tipos de cuenta, asientos, líneas de asiento, mayor, períodos fiscales.
2. **Vista de posición mensual de IVA** que consolide débito, crédito, percepciones y retenciones, y compute saldo a pagar / a favor.
3. **Motor de asientos automáticos** disparado por estado de documento (factura autorizada → asiento de venta; factura proveedor aprobada → asiento de compra; cobro/pago → asiento de tesorería).
4. **Desglose de percepciones de venta** (`customer_invoice_other_taxes`).
5. **Retenciones practicadas** en pagos a proveedores.
6. **Imputación contable y centro de costo** en los documentos clave (ventas, tesorería).
7. **Reportes de cierre**: EERR, balance de sumas y saldos, mayor por cuenta, exportables de libros IVA, CxC/CxP, facturación, impuestos.
8. **Conexión `logistics_orders` → facturación** (o decisión explícita de que el 3PL factura por contrato vía Flujo B).
9. **Cierre/bloqueo de período** para impedir asientos sobre meses ya presentados.

---

## 6. Riesgos (impacto operativo, contable, impositivo y técnico)

| Riesgo | Clasif. | Impacto |
|---|---|---|
| **No se puede cerrar balance desde el sistema** | Crítico | Contable: dependencia total del contador externo y de planillas manuales. Operativo: re-trabajo y errores de transcripción. Técnico: sin única fuente de verdad contable. |
| **Posición de IVA se arma a mano** | Crítico | Impositivo: riesgo de error en DDJJ mensual de IVA (F2002), saldos a favor/pagar mal calculados, multas. |
| **Sin trazabilidad documento↔asiento** | Crítico | Auditoría: imposible justificar un saldo de balance hacia atrás hasta el comprobante. Riesgo ante inspección AFIP/auditoría externa. |
| **Percepciones de venta sin desglose** | Alto | Impositivo: si es agente de percepción, no puede presentar el detalle por jurisdicción/régimen. |
| **Retenciones practicadas fuera del sistema** | Alto | Impositivo: SICORE/IIBB mal soportados; el pago "neto" al proveedor no refleja la retención → diferencias de CxP y de DDJJ. |
| **Sin cierre de período** | Alto | Contable: un usuario puede registrar/anular sobre un mes ya presentado, descuadrando lo declarado. |
| **Ingresos 3PL fuera de facturación** | Alto | Contable/impositivo: subdeclaración de ventas si el almacenaje/alquiler no se factura por sistema. |
| **Doble carga manual (sistema + Excel contable)** | Medio | Operativo: inconsistencias entre lo operativo y lo contable. |
| **Conciliación bancaria sin cerrar** | Medio | Operativo: conciliación manual; el motor existe pero no se usa en producción. |
| **Sin rentabilidad por unidad de negocio** | Medio | Gestión: no se puede medir margen por ANMAT/cargas/oficinas/coworking. |
| **Emisión ARCA en freeze** | Alto (operativo) | Si se factura por fuera, el sistema no es la fuente fiscal real. (Fuera del scope contable estricto, pero condiciona todo.) |

**Prioridad de corrección (qué primero):**
1. **Posición mensual de IVA** (vista de consolidación) — *quick win crítico*.
2. **Plan de cuentas + tipos** (cimiento).
3. **Motor de asientos + mayor** (corazón del balance).
4. **EERR + balance de sumas y saldos** (entregable al contador).
5. **Percepciones de venta + retenciones practicadas + períodos fiscales** (cierre impositivo).
6. **cost_center en ventas/tesorería + logistics→facturación** (gestión e integridad de ingresos).

---

## 7. Recomendaciones

1. **No reinventar lo fiscal: consolidarlo.** La capa de IVA está bien. La primera entrega debe ser **solo una vista** `v_posicion_iva` sobre `libro_iva_compras` + `libro_iva_ventas` + percepciones/retenciones. Bajo riesgo, alto valor.
2. **Construir contabilidad como reflejo, no como fuente.** Mantener el principio "el subledger manda, el GL refleja": las facturas/cobros/pagos siguen siendo la fuente; el asiento es un derivado automático y auditable, con `origen_tipo`/`origen_id` apuntando al documento.
3. **Asientos por trigger de estado, idempotentes y reversibles.** Factura autorizada → asiento; anulación → asiento de reversa (nunca delete). Un documento, un asiento, con UNIQUE por `(origen_tipo, origen_id)`.
4. **Cerrar las brechas impositivas concretas** (percepciones de venta, retenciones practicadas, períodos fiscales) en paralelo, porque son de bajo esfuerzo y alto riesgo legal.
5. **Imputación por defecto + override.** Cada tipo de operación mapea a cuentas contables por reglas (tabla de mapeo), con posibilidad de override manual por línea. Evita pedirle al usuario que sepa contabilidad.
6. **Centro de costo obligatorio en ventas y tesorería** para habilitar rentabilidad por unidad de negocio.
7. **Decidir el destino de `logistics_orders`**: o se facturan por Flujo B (contratos/tarifas) o se conectan a `customer_invoices`. No dejar ingresos fuera del circuito.
8. **No tocar lo que funciona.** Todo lo nuevo es **aditivo** (nuevas tablas/columnas/vistas), sin alterar el detalle fiscal canónico ya validado.
9. **Validación contable obligatoria con el contador externo** antes de dar por bueno el plan de cuentas y las reglas de imputación. La contabilidad es normativa; el diseño técnico debe seguir el criterio profesional, no al revés.
10. **Staging primero.** Toda migración se prueba en staging con datos reales anonimizados y se valida el cuadre (Σ debe = Σ haber, libros IVA = posición, etc.) antes de producción.

---

## 8. Modelo de datos propuesto (DISEÑO — NO ejecutar sin aprobación)

> Todas las propuestas son **aditivas**. No modifican ni borran tablas existentes. Numeración tentativa a partir de la última migración del repo. Patrones obligatorios: idempotencia, RLS, auditoría append-only, `SECURITY DEFINER set search_path`, FK explícitas.

### 8.1. Plan de cuentas mínimo viable — 3PL (Logística TOPS / Verotín S.A.)

```
1  ACTIVO
   1.1  Activo Corriente
        1.1.01  Caja
        1.1.02  Bancos (1.1.02.01 Santander · 1.1.02.02 Galicia)
        1.1.03  Deudores por Ventas (CxC)                 ← subledger AR
        1.1.04  Deudores Morosos / En Gestión
        1.1.05  IVA Crédito Fiscal
        1.1.06  Percepciones IVA sufridas
        1.1.07  Percepciones IIBB sufridas
        1.1.08  Retenciones sufridas (Ganancias / IVA / IIBB / SUSS)
        1.1.09  Anticipos a Proveedores
   1.2  Activo No Corriente
        1.2.01  Bienes de Uso (Rodados · Instalaciones · Equipos de depósito)
        1.2.02  Amortización Acumulada Bienes de Uso (regularizadora)
2  PASIVO
   2.1  Pasivo Corriente
        2.1.01  Proveedores (CxP)                          ← subledger AP
        2.1.02  IVA Débito Fiscal
        2.1.03  IVA Saldo a Pagar (posición)
        2.1.04  Percepciones IVA a depositar (como agente)
        2.1.05  Percepciones IIBB a depositar
        2.1.06  Retenciones practicadas a depositar (Gan./IVA/IIBB/SUSS)
        2.1.07  Cargas Sociales a Pagar
        2.1.08  Sueldos a Pagar
        2.1.09  Anticipos de Clientes
   2.2  Pasivo No Corriente
        2.2.01  Deudas Financieras LP
3  PATRIMONIO NETO
   3.1.01  Capital Social
   3.2.01  Resultados No Asignados
   3.3.01  Resultado del Ejercicio
4  INGRESOS
   4.1.01  Ventas – Almacenaje Cargas Generales
   4.1.02  Ventas – Almacenaje ANMAT
   4.1.03  Ventas – Alquiler de Oficinas
   4.1.04  Ventas – Coworking
   4.1.05  Ventas – Servicios Logísticos (OS / 3PL)
   4.1.06  Ventas – Transporte / Distribución
   4.2.01  Descuentos y Bonificaciones (regularizadora)
5  COSTOS
   5.1.01  Costo de Servicios Logísticos
   5.1.02  Costo de Transporte (combustible, peajes, fletes)
   5.1.03  Costo de Depósito (alquiler, expensas, energía)
   5.1.04  Costo de Personal Operativo
6  GASTOS
   6.1.01  Gastos de Administración
   6.1.02  Gastos Comerciales
   6.1.03  Gastos de Personal (Administración/Comercial)
   6.1.04  Impuestos y Tasas (IIBB, tasas municipales, sellos)
   6.1.05  Gastos Bancarios y Financieros (Ley 25.413, comisiones, SIRCREB)
   6.1.06  Amortizaciones del Ejercicio
   6.1.07  Servicios (luz, agua, internet, telefonía)
   6.1.08  Honorarios Profesionales
   6.1.09  Seguros
7  RESULTADOS FINANCIEROS Y POR TENENCIA
   7.1.01  Intereses Ganados · 7.2.01  Intereses Perdidos · 7.3.01  Diferencias de Cambio
```

Reglas: cada cuenta con `tipo` (activo/pasivo/pn/ingreso/costo/gasto/resultado_financiero), `imputable boolean` (solo hojas reciben asientos), `is_system boolean` (protege estructurales), `codigo` jerárquico, `parent_id`. Seedeado pero gestionable. **A validar con el contador externo.**

### 8.2. Tablas contables nuevas (capa 0 + capa 4)

```
-- Migración propuesta A: catálogos contables
account_types        (id, code 'activo|pasivo|pn|ingreso|costo|gasto|rf', signo_normal +/-, naturaleza)
chart_of_accounts    (id, codigo UNIQUE, nombre, tipo account_type, parent_id, imputable bool,
                      is_system bool, active bool, created_at/by)
fiscal_periods       (id, periodo 'YYYY-MM' UNIQUE, estado 'abierto|cerrado|bloqueado',
                      fecha_apertura, fecha_cierre, cerrado_por, created_at)
tax_rates            (id, codigo, descripcion, alic_iva_id, alicuota, vigente_desde, vigente_hasta)  -- opcional

-- Migración propuesta B: motor de asientos (partida doble)
journal_entries      (id, numero bigserial-por-período, fecha, fiscal_period_id → fiscal_periods,
                      origen_tipo 'customer_invoice|supplier_invoice|customer_receipt|supplier_payment|manual|ajuste',
                      origen_id uuid, descripcion, estado 'borrador|registrado|anulado',
                      reversa_de uuid NULL → journal_entries, created_at/by,
                      UNIQUE(origen_tipo, origen_id) WHERE origen_tipo <> 'manual')   -- idempotencia
journal_entry_lines  (id, journal_entry_id → journal_entries CASCADE,
                      chart_account_id → chart_of_accounts RESTRICT (solo imputables),
                      cost_center_id → cost_centers NULL,
                      debe numeric(15,2) DEFAULT 0, haber numeric(15,2) DEFAULT 0,
                      detalle text,
                      CHECK (debe>=0 AND haber>=0 AND NOT (debe>0 AND haber>0)))
-- Invariante por trigger diferido: SUM(debe) = SUM(haber) por asiento.
```

### 8.3. Cambios aditivos sobre tablas existentes

```
customer_invoices    + cost_center_id uuid NULL → cost_centers       -- rentabilidad por unidad
treasury_movements   + cost_center_id uuid NULL → cost_centers       -- imputación de gastos bancarios
supplier_payments    + retention_amount numeric(14,2) DEFAULT 0      -- retenciones practicadas
                     + net_amount GENERATED (amount - retention_amount)
customer_invoice_other_taxes (NUEVA, espejo de supplier_invoice_other_taxes)
                      (id, invoice_id → customer_invoices, tax_kind, jurisdiction, base, alicuota, importe)
-- Reglas de imputación contable (mapeo operación → cuentas):
accounting_rules     (id, origen_tipo, condicion jsonb, cuenta_debe, cuenta_haber, prioridad)
```

### 8.4. Vista de posición mensual de IVA (quick win — no requiere capa contable)

```
v_posicion_iva (por periodo):
  periodo
  iva_debito_fiscal        = Σ libro_iva_ventas.iva_debito_fiscal
  iva_credito_fiscal       = Σ libro_iva_compras.iva_credito_fiscal
  saldo_tecnico            = iva_debito_fiscal − iva_credito_fiscal
  percepciones_sufridas    = Σ supplier_invoice_other_taxes (PERCEPCION_IVA) del período
  retenciones_sufridas     = Σ customer_receipts.retention_amount (IVA) del período
  saldo_posicion           = saldo_tecnico − percepciones_sufridas − retenciones_sufridas
  resultado                = 'a_pagar' si > 0 ; 'a_favor' si < 0
```

### 8.5. Reglas de registración (motor de asientos)

| Evento disparador | Asiento |
|---|---|
| `customer_invoice` → AUTORIZADO_ARCA | DEBE 1.1.03 Deudores (total) / HABER 4.x Ventas (neto, por cost_center) + 2.1.02 IVA Débito (iva) + 2.1.04/05 Percep. a depositar |
| `supplier_invoice` → aprobada | DEBE 5.x/6.x Gasto/Costo (neto) + 1.1.05 IVA Crédito (iva) + 1.1.06/07 Percep. sufridas / HABER 2.1.01 Proveedores (total) |
| Nota de crédito (cualquiera) | Asiento inverso, nunca delete del original |
| `customer_receipt` confirmado | DEBE 1.1.01/02 Caja-Bancos (neto) + 1.1.08 Retenc. sufridas / HABER 1.1.03 Deudores (total) |
| `supplier_payment` confirmado | DEBE 2.1.01 Proveedores (total) / HABER 1.1.01/02 Caja-Bancos (neto) + 2.1.06 Retenc. practicadas |

### 8.6. RBAC y RLS

- Nuevo módulo RBAC `contabilidad` con permisos `contabilidad.view`, `contabilidad.entry.create`, `contabilidad.coa.edit`, `contabilidad.period.close`, `contabilidad.export`.
- RLS en todas las tablas nuevas: lectura roles internos / `has_permission('contabilidad.*')`; asientos y líneas **insert-only** (sin update/delete; anulación por reversa); plan de cuentas editable solo con permiso.

---

## 9. Reportes necesarios para cierre

| Reporte | Fuente | ¿Existe hoy? |
|---|---|---|
| **Posición mensual de IVA** | `v_posicion_iva` (§8.4) | ❌ (insumos sí) |
| **Libro IVA Compras** | `libro_iva_compras` + export | ✅ |
| **Libro IVA Ventas** | `libro_iva_ventas` + export | ✅ (falta export) |
| **Estado de Resultados (EERR)** | `journal_entry_lines` por cuenta ingreso/costo/gasto + período | ❌ |
| **Balance de Sumas y Saldos** | saldos por cuenta (debe/haber acumulado) | ❌ |
| **Mayor Contable (por cuenta)** | `journal_entry_lines` filtrado por cuenta | ❌ |
| **Balance General** | saldos por cuenta activo/pasivo/PN | ❌ |
| **Cuentas por Cobrar** | `customer_open_items` / `customer_current_account` | ✅ |
| **Cuentas por Pagar** | `supplier_open_items` / `supplier_current_account` | ✅ |
| **Reporte de Facturación** | `customer_invoices` por período/cliente/estado | 🟡 (datos sí, reporte formal no) |
| **Reporte de Impuestos** | percepciones/retenciones sufridas y practicadas por tipo | ❌ |
| **Rentabilidad por unidad de negocio** | EERR particionado por `cost_center` | ❌ (falta cost_center en ventas) |

**Filtros mínimos del reporte de posición/impuestos:** período (desde/hasta), cliente, proveedor, tipo de comprobante, tipo de impuesto, jurisdicción, centro de costo.

---

## 10. Roadmap de implementación (por fases)

> Cada fase es un PR independiente sobre la branch designada. Nada toca producción ni ejecuta migraciones sin gate ejecutivo. Migraciones primero en staging.

### Fase 1 — Auditoría y documentación ✅ (este documento)
- **Objetivo:** diagnóstico, brechas, riesgos, propuesta. Validar plan de cuentas y reglas de imputación con el **contador externo**.
- **Tablas:** ninguna. **UI:** ninguna. **APIs:** ninguna.
- **Riesgos:** que el plan de cuentas no se valide profesionalmente antes de construir.
- **Criterios de aceptación:** informe aprobado + plan de cuentas firmado por el contador.

### Fase 2 — Posición mensual de IVA (quick win)
- **Objetivo:** consolidar lo fiscal existente en una posición mensual con saldo a pagar/favor.
- **Tablas:** ninguna nueva (solo vista `v_posicion_iva`); + export del libro IVA ventas.
- **UI:** pantalla "Posición de IVA" con filtros (período, tipo impuesto) y export.
- **APIs:** data accessor read-only + export CSV/XLSX.
- **Riesgos:** definición exacta de qué percepciones/retenciones entran a la posición (validar con contador).
- **Criterios de aceptación:** la posición cuadra con la suma manual de los libros IVA del período; export concuerda con DDJJ F2002.

### Fase 3 — Modelo contable mínimo (catálogos)
- **Objetivo:** plan de cuentas, tipos de cuenta, períodos fiscales, reglas de imputación.
- **Tablas:** `account_types`, `chart_of_accounts`, `fiscal_periods`, `accounting_rules` (+ seed del plan de cuentas).
- **UI:** ABM de plan de cuentas (solo lectura inicial + edición con permiso), gestión de períodos.
- **APIs:** RPC de alta/baja de cuentas (gated), cierre de período.
- **Riesgos:** plan mal estructurado obliga a re-imputar; mitigar con validación profesional previa (Fase 1).
- **Criterios de aceptación:** plan seedeado e íntegro (jerarquía válida, solo hojas imputables); período se puede abrir/cerrar/bloquear.

### Fase 4 — Motor de asientos automáticos + mayor
- **Objetivo:** que cada documento (factura cliente/proveedor, cobro, pago) genere su asiento; mayor consultable.
- **Tablas:** `journal_entries`, `journal_entry_lines`; + `cost_center_id` en `customer_invoices`/`treasury_movements`.
- **UI:** consulta de asientos por documento, mayor por cuenta, asientos manuales (con permiso).
- **APIs:** triggers/RPC de registración por estado; RPC de asiento manual y de reversa.
- **Riesgos:** asientos descuadrados o duplicados → mitigar con invariante Σdebe=Σhaber (trigger) y UNIQUE(origen_tipo, origen_id); reversa nunca delete.
- **Criterios de aceptación:** todo documento existente genera asiento balanceado; backfill histórico cuadra; anulación genera reversa; mayor concuerda con subledgers.

### Fase 5 — Reportes para contador y balance
- **Objetivo:** entregables de cierre anual.
- **Tablas:** ninguna nueva (vistas/reportes): EERR, balance de sumas y saldos, balance general, mayor, CxC/CxP, facturación, impuestos.
- **UI:** sección "Cierre / Contabilidad" con todos los reportes + export.
- **APIs:** data accessors read-only + export.
- **Riesgos:** discrepancias entre reportes y lo declarado → conciliar contra libros IVA y tesorería.
- **Criterios de aceptación:** balance de sumas y saldos cuadra (Σdebe=Σhaber); EERR coincide con ingresos/costos/gastos del período; libros IVA = posición; export aprobado por el contador.

### Fase 6 — Automatización completa y cierre impositivo fino
- **Objetivo:** cerrar brechas impositivas y de gestión restantes.
- **Tablas:** `customer_invoice_other_taxes` (percepciones de venta), `retention_amount` en `supplier_payments`; conexión `logistics_orders`→facturación; (opcional) Flujo B contratos/tarifas; cierre conciliación bancaria (0078–0080).
- **UI:** carga de percepciones de venta y retenciones practicadas; facturación de servicios recurrentes; pantalla de aprobación AP.
- **APIs:** extensión de RPC de ventas y de pagos; corrida de facturación masiva; RPC de conciliación.
- **Riesgos:** cambios sobre el detalle fiscal canónico → mantener todo aditivo y validado.
- **Criterios de aceptación:** percepciones/retenciones reportables por tipo y jurisdicción; SICORE/IIBB soportados; ingresos 3PL dentro del circuito; conciliación bancaria operativa end-to-end.

**Orden recomendado:** F1 → **F2 (quick win)** → F3 → F4 → F5 → F6. F2 entrega valor impositivo inmediato sin depender de la capa contable.

---

## 11. Checklist final de cumplimiento

### Impositivo (IVA)
- [x] Registro de IVA crédito fiscal con múltiples alícuotas
- [x] Registro de IVA débito fiscal con múltiples alícuotas
- [x] Percepciones/retenciones/imp. internos en compras (desglosados)
- [ ] Percepciones de venta desglosadas (`customer_invoice_other_taxes`)
- [ ] Retenciones practicadas a proveedores
- [x] Libro IVA Compras (vista + export)
- [x] Libro IVA Ventas (vista; falta export)
- [ ] **Posición mensual de IVA consolidada (saldo a pagar/favor)**
- [ ] Reporte de impuestos por tipo/jurisdicción

### Contable
- [ ] Plan de cuentas (`chart_of_accounts`)
- [ ] Tipos de cuenta / clasificación A/P/PN/I/C/G
- [ ] Centros de costo en TODOS los documentos (falta ventas/tesorería)
- [ ] Asientos por partida doble (`journal_entries` / `journal_entry_lines`)
- [ ] Motor de asientos automáticos por estado de documento
- [ ] Trazabilidad documento ↔ asiento (`origen_tipo`/`origen_id`)
- [ ] Períodos fiscales con cierre/bloqueo
- [ ] Mayor contable
- [ ] Balance de sumas y saldos
- [ ] Estado de resultados
- [ ] Balance general

### Subledgers y tesorería
- [x] Cuenta corriente clientes (vista derivada)
- [x] Cuenta corriente proveedores (vista derivada)
- [x] Cobros imputados a facturas (allocations)
- [x] Pagos imputados a facturas (allocations)
- [x] Saldos bancarios (vista derivada)
- [x] Retenciones sufridas en cobros
- [ ] Conciliación bancaria aplicada (persistencia + UI)

### Integración
- [x] Factura proveedor → IVA compras → CxP
- [x] Factura cliente / OS → IVA ventas → CxC
- [x] Cobranza → baja CxC → banco/caja
- [x] Pago → baja CxP → banco/caja
- [ ] Cualquier operación → asiento contable
- [ ] `logistics_orders` (3PL) → facturación
- [ ] Rentabilidad por unidad de negocio (cost_center en ventas)

### Técnico / gobierno
- [x] RLS en tablas fiscales y de tesorería
- [x] RBAC granular (compras, tesorería)
- [ ] Módulo RBAC `contabilidad`
- [x] Auditoría append-only en documentos fiscales
- [x] RPC-first con guards
- [ ] Migraciones contables (diseñadas, sin ejecutar)

---

## 12. Conclusión

Nexus está **bien construido en lo fiscal-operativo** y **vacío en lo contable**. Para el objetivo de esta auditoría — soportar el **cierre anual de balance**, la **posición mensual de IVA** y la **trazabilidad contable completa** — el sistema **hoy NO está preparado de forma autónoma**, pero está **a una distancia razonable** porque los datos de origen (facturas, IVA discriminado, cobros, pagos) ya existen con buena calidad.

La ruta es clara y de riesgo controlado: (1) consolidar la posición de IVA con lo que ya hay; (2) agregar la capa contable como **reflejo aditivo** de los documentos existentes; (3) producir los reportes de cierre. Nada de esto requiere reescribir lo fiscal; todo es construcción incremental sobre cimientos sólidos.

**Recomendación de cierre:** aprobar este informe, validar el plan de cuentas con el contador externo, y arrancar por la **Fase 2 (posición de IVA)** como entrega de valor inmediato mientras se diseña el DDL de la capa contable (Fases 3–4).

---

*Documento de auditoría y propuesta. No constituye implementación. No se ejecutaron migraciones ni se modificó producción. Sujeto a aprobación ejecutiva y validación del contador externo por fase.*
