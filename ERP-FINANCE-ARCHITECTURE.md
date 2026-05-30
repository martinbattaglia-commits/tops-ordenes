# ERP-FINANCE-ARCHITECTURE.md
## TOPS NEXUS — Arquitectura del ERP Financiero y Contable

> **Naturaleza de este documento:** DISEÑO. No es implementación.
> No ejecuta migraciones, no toca producción, no modifica ARCA, no emite comprobantes.
> Es la especificación maestra que habilita las fases de construcción posteriores.
>
> **Fecha:** 2026-05-29 · **Branch:** `feature/nexus-fullstack` · **Estado:** propuesta para gate ejecutivo
>
> **Regla de oro (no-negociable #1):** una sola fuente de verdad. Este documento
> **consolida y referencia** el corpus de diseño existente; **no lo duplica**.

---

## 0. Cómo leer este documento

Este archivo es el **mapa financiero unificado**. Cuando un dominio ya está diseñado
en otro doc, acá se lo **referencia** y se describe sólo el delta nuevo que pide el
MASTER PROMPT. Los documentos rectores que NO se reescriben son:

| Doc existente | Qué define | Relación con este doc |
|---|---|---|
| `docs/erp-arquitectura-objetivo.md` | Backbone financiero de 4 capas (documentos → subledgers → tesorería → GL) | **Fundamento.** Acá se hereda el modelo de capas y se le agrega Flujo B + dashboard. |
| `docs/ERP-ARQUITECTURA-MAESTRA.md` | Mapa de 10 módulos del ERP | Acá se ubican los módulos nuevos dentro de ese mapa. |
| `docs/MIGRATION-0012-DESIGN-REVIEW.md` | Catálogos base (cost_centers, chart_of_accounts, tax_rates, fiscal_periods…) | **Pre-requisito.** Este doc consume esos catálogos; no los rediseña. |
| `docs/RBAC-ARCHITECTURE.md` | Modelo de permisos granular | Acá se agrega el módulo `finanzas` al catálogo. |
| `supabase/migrations/0011_arca_billing.sql` | Facturación ARCA (customer_invoices) | **Ya soporta Flujo B** (periodo, fch_serv). Acá se diseña la capa upstream que lo alimenta. |

**Lo genuinamente NUEVO que este documento diseña por primera vez:**
1. **Facturación Directa (Flujo B)** — contratos + servicios recurrentes + tarifas + facturación masiva.
2. **Facturas de Proveedores** (`supplier_invoices`) + pipeline de ingesta OCR.
3. **Contabilidad operativa** — motor de asientos automáticos, mayores, plan de cuentas aplicado.
4. **Dashboard FINANZAS** — agregación de cobranzas/pagos/resultado/EBITDA por unidad de negocio.

---

## 1. Análisis de la arquitectura actual (punto de partida)

### 1.1. Lo que YA existe y funciona

| Capa | Componente | Migración / código | Estado |
|---|---|---|---|
| Maestros | `clients` (+ condición IVA, tipo_doc, localidad) | 0001 / 0011 | ✅ |
| Maestros | `vendors`, `products` | 0008 | ✅ |
| Maestros | RBAC granular (`permissions`/`roles`/`role_permissions`/`user_roles`) | 0009 | ✅ |
| Documentos | `orders` (Órdenes de Servicio — **Flujo A**) | 0001 / 0004 | ✅ |
| Documentos | `purchase_orders` (Órdenes de Compra) | 0008 | ✅ |
| Documentos | `documents` (repositorio versionado + OCR + hash) | 0010 | ✅ |
| Documentos | `customer_invoices` + `invoice_items` + `invoice_audit` | 0011 (no aplicada) | 🟡 diseñada |
| Fiscal | ARCA WSAA/WSFEv1, CAE, QR, motor `emitInvoice` genérico | `src/lib/arca/*`, `src/lib/invoicing/*` | ✅ código |
| Ingesta | OCR OpenAI (pdf-parse + Vision) | `src/lib/ocr/openai.ts` | ✅ |

### 1.2. El hallazgo clave sobre el motor de facturación

El motor `emitInvoice(input, ctx)` (`src/lib/invoicing/emit.ts`) **NO requiere una orden de servicio**.
`EmitInvoiceInput` ya acepta `items[]`, `periodo`, `fch_serv_desde/hasta`. La tabla `customer_invoices`
(0011) ya tiene `periodo text`, `fch_serv_desde/hasta`, `fch_vto_pago` y `comprobante_asociado_id`.

> **Consecuencia de diseño:** Flujo B **no necesita un segundo motor de facturación**.
> Necesita una **capa upstream** (contratos → tarifas → corrida mensual) que produzca
> `EmitInvoiceInput` y lo entregue al motor existente. Esto honra el no-negociable #1.

El único acoplamiento de `invoice_items.order_id → orders` (FK SET NULL) es el **link opcional de Flujo A**.
En Flujo B ese campo queda `NULL` y aparece un nuevo link `invoice_items.recurring_service_id`.

### 1.3. Los huecos que el MASTER PROMPT manda cerrar

| Hueco | Evidencia de inexistencia | Bloque que lo cierra |
|---|---|---|
| Facturación recurrente sin OS | No hay tablas de contratos/tarifas | **Bloque 1** (Flujo B) |
| Registro de facturas de proveedor | `purchase_orders.factura_id` es sólo un `text` placeholder | **Bloque 2** (supplier_invoices) |
| Plan de cuentas aplicado | `chart_of_accounts` sólo diseñado en 0012-review | **Bloque 3** (contabilidad) |
| Centros de costo en cada documento | `cost_centers` sólo diseñado en 0012-review | **Bloque 3** |
| Asientos / mayores / EERR | Inexistente (verificado en erp-arquitectura-objetivo §8) | **Bloque 3** |
| Dashboard financiero agregado | No existe vista FINANZAS | **Bloque 4** |

---

## 2. Principios no-negociables (heredados, vigentes)

Todo lo diseñado acá obedece los 6 principios rectores del ERP (de `ERP-ARQUITECTURA-MAESTRA.md`):

1. **Una sola fuente de verdad** — sin apps paralelas, sin tablas duplicadas, sin lógica redundante.
2. **Inmutabilidad documental** — nunca delete físico de comprobantes; sólo *Anular* / *Archivar* / nota de crédito.
3. **Auditoría total** — usuario, fecha, acción, cambio, IP en cada movimiento financiero (tablas append-only).
4. **Un solo sistema de autorización** — RLS sobre RBAC; el predicado de seguridad vive en la base.
5. **Datos fiscales no hardcodeados** — clave X.509 sólo en el host, nunca en código ni DB.
6. **Centro de costo en cada documento** — para rentabilidad por unidad de negocio.

**Patrones obligatorios de implementación** (de `MIGRATION-0012-DESIGN-REVIEW.md`), aplicables a TODA tabla nueva:
- Aislamiento multi-tenant `client_id` + RLS donde haya datos de cliente.
- Tablas de auditoría **append-only** (insert-only; sin update/delete).
- Funciones `SECURITY DEFINER` siempre con `set search_path = public, pg_temp`.
- Idempotencia (seeds `on conflict do nothing`, buckets `on conflict do update`).
- Política de borrado de FK **explícita** (`restrict` para documentos fiscales, `set null` para links blandos).

---

## 3. Modelo de datos objetivo (las 4 capas)

Se hereda el backbone de `docs/erp-arquitectura-objetivo.md §10`. Este documento **completa** las capas
con las entidades nuevas. Diagrama lógico:

```
CAPA 0 — MAESTROS Y CATÁLOGOS
  clients · vendors · products · services_catalog
  cost_centers · chart_of_accounts · tax_rates · fiscal_periods   ← (0012, pre-requisito)
  contracts · recurring_services · tariffs                         ← NUEVO (Bloque 1)

CAPA 1 — DOCUMENTOS OPERATIVOS (qué pasó en el negocio)
  orders (OS, Flujo A) · purchase_orders (OC)
  customer_invoices  ← alimentado por Flujo A *y* Flujo B
  supplier_invoices  ← NUEVO (Bloque 2)
  billing_runs       ← NUEVO (Bloque 1: corrida masiva)

CAPA 2 — SUBLEDGERS / CUENTAS CORRIENTES (quién debe a quién)
  ar_ledger (cuenta corriente clientes)   ← NUEVO (Bloque 3)
  ap_ledger (cuenta corriente proveedores)← NUEVO (Bloque 3)

CAPA 3 — TESORERÍA (movimiento real de plata)
  treasury_accounts · payments · receipts  ← (futuro, fuera de scope inmediato)

CAPA 4 — CONTABILIDAD GENERAL (el reflejo contable)
  journal_entries · journal_entry_lines    ← NUEVO (Bloque 3)
  (partida doble, "el subledger manda, el GL refleja")
```

> **Regla de flujo:** documento operativo → registra subledger → genera asiento.
> El motor de registración (Bloque 3) es **automático y disparado por estado**
> (ej.: una `customer_invoice` que pasa a `AUTORIZADO_ARCA` dispara su asiento de venta).

---

## 4. BLOQUE 1 — Facturación Directa (Flujo B)

### 4.1. Problema de negocio

Existen ingresos recurrentes que **no nacen de una Orden de Servicio**:

| Servicio | Base de cálculo | Periodicidad |
|---|---|---|
| Almacenaje Cargas Generales | m² o m³ × precio unitario × meses | Mensual |
| Almacenaje ANMAT | m² o m³ × tarifa regulada | Mensual |
| Alquiler de Oficinas Privadas | monto fijo | Mensual |
| Coworking | monto fijo | Mensual |

Hoy se facturan a mano. El objetivo: **"Generar facturación del mes"** con un click → borradores → revisión → ARCA.

### 4.2. Entidades nuevas

#### `contracts` — el acuerdo comercial con el cliente
```
contracts
  id                uuid PK
  client_id         uuid NOT NULL → clients(id) RESTRICT
  codigo            text UNIQUE        -- 'CTR-2026-0001'
  descripcion       text
  cost_center_id    uuid → cost_centers(id) RESTRICT   -- principio #6
  fecha_inicio      date NOT NULL
  fecha_fin         date NULL          -- null = vigente indefinido
  estado            contract_status_t  -- borrador|vigente|suspendido|finalizado
  punto_venta       int                -- override del PV por defecto si aplica
  condicion_pago    text DEFAULT '30 días'
  observaciones     text
  created_at/by · updated_at
```

#### `recurring_services` — qué se le factura a ese contrato, mes a mes
```
recurring_services
  id                uuid PK
  contract_id       uuid NOT NULL → contracts(id) CASCADE
  tipo_servicio     recurring_service_kind_t  -- almacenaje_general|almacenaje_anmat|oficina|coworking
  descripcion       text NOT NULL      -- aparece como línea en la factura
  unidad            service_unit_t     -- 'm2'|'m3'|'mes'|'un'  (extender enum)
  cantidad          numeric(12,2)      -- ej. 120.50 m²
  precio_unitario   numeric(14,2)      -- snapshot; o resuelto vía tariffs
  tariff_id         uuid NULL → tariffs(id)  -- si el precio viene de tarifario regulado
  alicuota_iva      numeric(5,2) DEFAULT 21
  periodicidad      periodicity_t DEFAULT 'mensual'
  cost_center_id    uuid → cost_centers(id)  -- hereda del contrato si null
  activo            boolean DEFAULT true
  vigente_desde     date
  vigente_hasta     date NULL
```

#### `tariffs` — tarifario versionado (sobre todo ANMAT y m²/m³)
```
tariffs
  id                uuid PK
  codigo            text               -- 'ALM-ANMAT-M2', 'ALM-GRAL-M3'
  descripcion       text
  unidad            service_unit_t
  precio_unitario   numeric(14,2)
  moneda            text DEFAULT 'ARS'
  vigente_desde     date NOT NULL
  vigente_hasta     date NULL          -- versionado por rango; sin solapamiento
  UNIQUE(codigo, vigente_desde)
```
> Las tarifas se **versionan por fecha** (mismo patrón que `documents`): nunca se edita un precio
> histórico; se cierra el rango y se inserta una nueva versión. Esto preserva la trazabilidad
> de cuánto valía el m² ANMAT cuando se facturó marzo.

#### `billing_runs` — la corrida masiva (auditable, re-ejecutable, idempotente)
```
billing_runs
  id                uuid PK
  periodo           text NOT NULL      -- '2026-05'
  estado            billing_run_status_t  -- preparando|borradores_listos|revisado|emitido|cerrado|error
  contratos_total   int                -- cuántos contratos vigentes se procesaron
  facturas_generadas int
  monto_total       numeric(15,2)
  ejecutado_por     uuid → auth.users
  ejecutado_at      timestamptz
  notas             text
  UNIQUE(periodo)                       -- una corrida por período (idempotencia)
```
```
billing_run_items   -- traza línea por línea qué generó la corrida
  id                uuid PK
  billing_run_id    uuid → billing_runs(id) CASCADE
  contract_id       uuid → contracts(id)
  recurring_service_id uuid → recurring_services(id)
  customer_invoice_id uuid NULL → customer_invoices(id)  -- se llena al emitir
  estado            text               -- pendiente|borrador|emitido|omitido|error
  motivo            text               -- por qué se omitió/falló
```

### 4.3. Cambios mínimos sobre lo existente

- `invoice_items` (0011): agregar `recurring_service_id uuid NULL → recurring_services(id) SET NULL`.
  Queda como el espejo de Flujo B del `order_id` de Flujo A. Una factura puede tener líneas de
  uno u otro origen, nunca se rompe el motor.
- `customer_invoices` (0011): **sin cambios**. Ya tiene `periodo`, `fch_serv_desde/hasta`.

### 4.4. Flujo de facturación masiva (algoritmo de la corrida)

```
"Generar facturación del mes 2026-05"
  1. Crear/obtener billing_run(periodo='2026-05')         [idempotente por UNIQUE]
  2. SELECT contratos WHERE estado='vigente'
       AND fecha_inicio <= fin_periodo
       AND (fecha_fin IS NULL OR fecha_fin >= inicio_periodo)
  3. Por cada contrato → cada recurring_service activo del período:
       a. Resolver precio:  tariff vigente al período  ||  precio_unitario snapshot
       b. computeItem()  (reusa src/lib/invoicing/calc.ts)
       c. Acumular líneas por (cliente, punto_venta, tipo_comprobante)
  4. Por cada agrupación → construir EmitInvoiceInput:
       { client, items[], periodo, fch_serv_desde/hasta, concepto=2 (servicios) }
  5. Persistir como customer_invoices estado=BORRADOR  (NO se manda a ARCA todavía)
  6. billing_run.estado = 'borradores_listos'
  --- PUNTO DE REVISIÓN HUMANA ---
  7. Operador revisa el lote en UI (montos, clientes, omisiones)
  8. "Emitir lote"  → por cada borrador: emitInvoice(input, ctx)  [motor 0011 existente]
       → CAE + QR + AUTORIZADO_ARCA + asiento de venta (Bloque 3)
  9. billing_run.estado = 'emitido' → 'cerrado'
```

> **Seguridad del diseño:** la corrida **separa generación de emisión**. Generar borradores es
> reversible y no fiscal. La emisión a ARCA es un segundo paso explícito y auditado. Respeta el
> FREEZE ARCA actual: hasta que no se levante el freeze, la corrida se detiene en el paso 6.

### 4.5. Relaciones (Flujo B)

```
clients 1──N contracts 1──N recurring_services N──1 tariffs
contracts ──N billing_run_items N── billing_runs (1 por período)
billing_run_items 1──1 customer_invoices (al emitir)
customer_invoices 1──N invoice_items ──→ recurring_service_id (link Flujo B)
                                    └──→ order_id            (link Flujo A)
```

---

## 5. BLOQUE 2 — Facturas de Proveedores + Ingesta OCR

### 5.1. Problema de negocio

El circuito de compras hoy llega hasta `OC → PDF → Mail → Drive`. **Falta registrar la factura que
el proveedor devuelve.** `purchase_orders.factura_id` es sólo un `text` suelto. Se necesita el
comprobante de compra como entidad de primera clase para: cuentas por pagar, IVA crédito fiscal,
y conciliación OC↔Factura.

### 5.2. Entidad nueva — `supplier_invoices`

```
supplier_invoices
  id                  uuid PK
  vendor_id           uuid NOT NULL → vendors(id) RESTRICT
  purchase_order_id   uuid NULL → purchase_orders(id) SET NULL   -- conciliación OC↔Factura
  cost_center_id      uuid → cost_centers(id) RESTRICT           -- principio #6
  -- Identidad fiscal del comprobante recibido (lo que pide el MASTER PROMPT):
  tipo_comprobante    comprobante_tipo_t   -- FACTURA_A/B/C, NOTA_CREDITO_*...
  punto_venta         int NOT NULL
  numero_comprobante  bigint NOT NULL
  cae                 text                 -- CAE del proveedor (de la factura recibida)
  cae_vto             date
  fecha_emision       date NOT NULL
  fecha_vto_pago      date
  periodo             text                 -- '2026-05' para imputación contable
  -- Identidad del emisor (snapshot, viene del OCR o del maestro vendor):
  razon_social        text NOT NULL
  cuit_proveedor      text NOT NULL
  condicion_iva       condicion_iva_t
  -- Importes:
  importe_neto        numeric(15,2) NOT NULL
  importe_iva         numeric(15,2) NOT NULL DEFAULT 0
  importe_no_gravado  numeric(15,2) DEFAULT 0
  importe_exento      numeric(15,2) DEFAULT 0
  importe_total       numeric(15,2) NOT NULL
  moneda              text DEFAULT 'ARS'
  -- Estado y procedencia:
  estado              supplier_invoice_status_t  -- borrador|registrada|conciliada|pagada|anulada
  origen              supplier_invoice_source_t  -- carga_manual|ocr|email
  document_id         uuid NULL → documents(id)  -- el PDF/imagen original (bucket privado 0010)
  ocr_extract         jsonb                       -- ExtractedDocument crudo, para auditoría
  ocr_confidence      numeric(4,3)
  -- Auditoría:
  created_at/by · updated_at
  UNIQUE(cuit_proveedor, tipo_comprobante, punto_venta, numero_comprobante)  -- no duplicar comprobante
```
```
supplier_invoice_items        -- desglose opcional (para imputación por línea/cuenta)
  id · supplier_invoice_id → CASCADE
  descripcion · cantidad · precio_unitario
  alicuota_iva · importe_neto · importe_iva · importe_total
  chart_account_id  uuid NULL → chart_of_accounts(id)   -- imputación contable de la línea
  cost_center_id    uuid NULL → cost_centers(id)
```
```
supplier_invoice_audit        -- append-only (principio #3)
  id bigserial · supplier_invoice_id · ts · accion · actor · actor_email · ip · meta jsonb
```

### 5.3. Pipeline de ingesta OCR (reusa `src/lib/ocr/openai.ts`)

```
Subir PDF/imagen de factura de proveedor
  1. Guardar blob → bucket privado 'documents' (0010), path scoped, file_hash SHA-256
     → crea documents(type='factura', vendor_id, source='upload')
  2. OCR:
       PDF con texto  → extractFromPdf(buffer)     → ExtractedDocument
       PDF escaneado  → (F3) pdf→imagen → extractFromImage()
       imagen pura    → extractFromImage(dataUrl)
  3. Mapear ExtractedDocument → borrador supplier_invoices:
       parties[role='emisor'].taxId   → cuit_proveedor
       parties[role='emisor'].name    → razon_social
       date                           → fecha_emision
       amounts[kind='neto'|'iva'|'total'] → importes
       (CAE: el EXTRACTION_PROMPT ya pide title/identificador; extender prompt para CAE explícito)
  4. Match contra vendors por CUIT  → autocompletar vendor_id (o sugerir alta de proveedor)
  5. Match contra purchase_orders abiertas del vendor → sugerir conciliación
  6. Estado = 'borrador', origen='ocr', ocr_extract = JSON crudo, ocr_confidence
  --- REVISIÓN HUMANA: el operador confirma/corrige los campos extraídos ---
  7. "Registrar" → estado='registrada' → genera asiento de compra + AP ledger (Bloque 3)
```

> **Diseño deliberado:** el OCR **propone, el humano dispone**. Nunca se registra un comprobante
> fiscal sin confirmación, porque el crédito fiscal de IVA depende de la exactitud del dato.
> `ocr_confidence` baja (<0.6) marca el borrador para revisión obligatoria.

### 5.4. Extensión menor al OCR existente

`EXTRACTION_PROMPT` (`src/lib/ocr/openai.ts`) ya extrae CUIT, razón social, fecha, montos.
**Delta:** agregar al schema del prompt un campo `"cae"` y `"caeVto"` y `"comprobante": {tipo, puntoVenta, numero}`
para capturar la identidad fiscal completa del comprobante de compra. Cambio aditivo, no rompe el uso documental.

---

## 6. BLOQUE 3 — Contabilidad: Plan de Cuentas, Centros de Costo, Asientos y Mayores

> Esta capa **consume** los catálogos de la migración 0012 (`cost_centers`, `chart_of_accounts`,
> `tax_rates`, `fiscal_periods`) ya diseñados en `MIGRATION-0012-DESIGN-REVIEW.md`. Acá se diseña
> el **motor de registración** y los **mayores**, que 0012 no cubre.

### 6.1. Plan de Cuentas (`chart_of_accounts`) — estructura aplicada

Catálogo jerárquico (de 0012-review). Estructura mínima para TOPS / Verotin S.A.:

```
1  ACTIVO
   1.1  Activo Corriente
        1.1.01  Caja y Bancos
        1.1.02  Deudores por Ventas (Cuentas por Cobrar) ← AR ledger
        1.1.03  IVA Crédito Fiscal
   1.2  Activo No Corriente
2  PASIVO
   2.1  Pasivo Corriente
        2.1.01  Proveedores (Cuentas por Pagar)          ← AP ledger
        2.1.02  IVA Débito Fiscal
        2.1.03  Retenciones a depositar
3  PATRIMONIO NETO
   3.1  Capital · 3.2  Resultados Acumulados
4  INGRESOS
   4.1.01  Ventas Almacenaje Cargas Generales
   4.1.02  Ventas Almacenaje ANMAT
   4.1.03  Alquiler Oficinas · 4.1.04 Coworking · 4.1.05 Servicios Logísticos (OS)
5  COSTOS
   5.1.01  Costo de Servicios · 5.1.02  Transporte
6  GASTOS
   6.1.01  Gastos de Administración · 6.1.02  Gastos Comerciales · 6.1.03  Impuestos
```
> El plan se **seedea** pero es **gestionable** (igual que RBAC). `chart_of_accounts.is_system`
> protege las cuentas estructurales. Cada cuenta tiene `tipo` (activo/pasivo/pn/ingreso/costo/gasto)
> e `imputable boolean` (sólo las hojas reciben asientos).

### 6.2. Centros de Costo (`cost_centers`)

De 0012-review, seed inicial obligatorio (no-negociable #6):

```
ANMAT · CARGAS_GENERALES · OFICINAS · COWORKING · TRANSPORTE · ADMINISTRACION
```
Cada documento operativo (OS, OC, customer_invoice, supplier_invoice, contract) lleva
`cost_center_id`. Esto es lo que habilita **rentabilidad por unidad de negocio**.

### 6.3. Motor de asientos automáticos (`journal_entries` / `journal_entry_lines`)

```
journal_entries
  id                uuid PK
  numero            bigint            -- correlativo por período fiscal
  fecha             date NOT NULL
  fiscal_period_id  uuid → fiscal_periods(id)   -- período abierto/cerrado (0012)
  origen_tipo       text              -- 'customer_invoice'|'supplier_invoice'|'payment'|'manual'
  origen_id         uuid              -- el documento que lo disparó (trazabilidad)
  descripcion       text
  estado            text              -- borrador|registrado|anulado
  created_at/by
journal_entry_lines
  id                uuid PK
  journal_entry_id  uuid → journal_entries(id) CASCADE
  chart_account_id  uuid → chart_of_accounts(id) RESTRICT  -- sólo cuentas imputables
  cost_center_id    uuid NULL → cost_centers(id)
  debe              numeric(15,2) DEFAULT 0
  haber             numeric(15,2) DEFAULT 0
  CHECK (debe >= 0 AND haber >= 0 AND NOT (debe > 0 AND haber > 0))
```
**Invariante de partida doble** (validado por trigger): `SUM(debe) = SUM(haber)` por asiento.

#### Reglas de registración (subledger manda, GL refleja)

| Evento disparador | Asiento generado |
|---|---|
| `customer_invoice` → `AUTORIZADO_ARCA` | DEBE 1.1.02 Deudores (total) / HABER 4.x Ventas (neto) + 2.1.02 IVA Débito (iva) |
| `supplier_invoice` → `registrada` | DEBE 5.x/6.x Gasto (neto) + 1.1.03 IVA Crédito (iva) / HABER 2.1.01 Proveedores (total) |
| Nota de crédito cliente | Asiento inverso (respeta inmutabilidad: NUNCA borra la factura original) |
| Pago a proveedor (tesorería, futuro) | DEBE 2.1.01 Proveedores / HABER 1.1.01 Caja-Bancos |
| Cobro de cliente (tesorería, futuro) | DEBE 1.1.01 Caja-Bancos / HABER 1.1.02 Deudores |

> El motor es una función `SECURITY DEFINER set search_path` disparada por trigger de cambio de estado.
> Cada asiento referencia su `origen_id` → trazabilidad total documento↔asiento. Anular un documento
> genera un **asiento de reversa**, nunca un delete (principio #2).

### 6.4. Subledgers (cuentas corrientes)

```
ar_ledger (clientes)        ap_ledger (proveedores)
  client_id                   vendor_id
  customer_invoice_id         supplier_invoice_id / payment_id
  fecha · debe · haber · saldo_acumulado · periodo
```
Vistas materializables `v_ar_saldos` / `v_ap_saldos` → saldo por cliente/proveedor → alimentan el dashboard.

### 6.5. Reportes contables derivados

| Reporte | Fuente |
|---|---|
| Estado de Resultados (EERR) | `journal_entry_lines` agregado por cuenta tipo ingreso/costo/gasto + período |
| Balance General | saldos acumulados por cuenta activo/pasivo/PN |
| Flujo de Fondos | movimientos de tesorería (capa 3, futuro) |
| Rentabilidad por unidad de negocio | EERR particionado por `cost_center_id` |
| Libro IVA Ventas / Compras | `customer_invoices` / `supplier_invoices` por período |

---

## 7. BLOQUE 4 — Dashboard Financiero (sección FINANZAS)

Agregación de sólo-lectura sobre las capas anteriores. **No** introduce nuevas tablas de negocio;
son **vistas**.

| KPI | Definición | Fuente |
|---|---|---|
| Facturación del mes | Σ `customer_invoices.importe_total` período actual, estado AUTORIZADO | customer_invoices |
| Facturación anual | Σ ídem año en curso | customer_invoices |
| Cuentas por cobrar | saldo deudor neto | `v_ar_saldos` |
| Cuentas por pagar | saldo acreedor neto | `v_ap_saldos` |
| Resultado operativo | Ingresos − Costos − Gastos del período | EERR (journal_entry_lines) |
| EBITDA estimado | Resultado operativo + amortizaciones (cuentas 6.x marcadas) | EERR |
| Rentabilidad por unidad de negocio | EERR particionado por cost_center | journal_entry_lines × cost_centers |

```
v_finanzas_dashboard  (vista agregada, refresco on-demand / cron)
  periodo · facturacion_mes · facturacion_anual · cxc · cxp
  resultado_operativo · ebitda_estimado
v_rentabilidad_por_cc
  cost_center · ingresos · costos · gastos · resultado · margen_pct
```

---

## 8. RBAC — Permisos del módulo financiero

Se agrega el módulo `finanzas` al catálogo RBAC existente (0009). **No** se crea un sistema nuevo;
se extiende el enum `permission_module_t` y se seedean permisos + rol.

### 8.1. Nuevos permisos (`permissions`)

```
finanzas.view              Ver dashboard financiero y reportes
finanzas.billing.run       Ejecutar facturación masiva (Flujo B)
finanzas.billing.emit      Emitir lote a ARCA  (gateado por FREEZE ARCA actual)
finanzas.contracts.edit    Crear/editar contratos y servicios recurrentes
finanzas.tariffs.edit      Editar tarifario
finanzas.supplier.register Registrar facturas de proveedor
finanzas.accounting.view   Ver plan de cuentas, mayores, EERR
finanzas.accounting.edit   Editar plan de cuentas / asientos manuales
finanzas.export            Exportar reportes financieros
```
Extender enum `permission_module_t`: agregar `'finanzas'`. Extender `permission_action_t` si hace
falta `'run'` (o mapear `billing.run` → acción `create`).

### 8.2. Nuevo rol sugerido

```
roles: ('finanzas', 'Finanzas / Contabilidad', 'Equipo financiero y contable', '#0E7C3A', is_system=true)
```
Mapeo: `finanzas` obtiene todos los `finanzas.*` + `analytics.view`. `director_ops` y `admin`
ya heredan todo. `comercial` puede ver `finanzas.view` (lectura).

### 8.3. RLS — un solo sistema de autorización (principio #4)

Toda tabla nueva con RLS habilitada. Predicados:
- Internos (`current_role()` ∈ admin/operaciones/supervisor o `has_permission('finanzas.*')`) → acceso completo.
- Cliente B2B → sólo lectura de SUS contratos/facturas vía `client_id = (select client_id from profiles where id = auth.uid())`.
- Tablas de auditoría y asientos → **insert-only** + lectura interna; sin update/delete (trigger guard).
- Buckets de PDFs de factura → scoping multi-tenant por `split_part(name,'/',1)=client_id` (patrón 0013).

---

## 9. Secuencia de migraciones (DISEÑO — NO ejecutar)

### 9.1. Resolución del conflicto de numeración

`docs/erp-arquitectura-objetivo.md` asignaba `0013=supplier_invoices`, pero el repo **ya tiene**
`0013_invoices_storage_isolation.sql`. Se **renumera** la secuencia financiera para evitar colisión:

| Migración | Contenido | Estado | Notas |
|---|---|---|---|
| 0011 | ARCA billing (customer_invoices) | en repo, **no aplicada** | freeze |
| 0012 | Catálogos: cost_centers, chart_of_accounts, tax_rates, fiscal_periods, rbac_audit | **reservada** (design-review) | pre-requisito de todo |
| 0013 | invoices_storage_isolation | **en repo** | ⚠️ slot ocupado |
| **0014** | **Flujo B: contracts, recurring_services, tariffs, billing_runs(+items)** + extensión `invoice_items.recurring_service_id` | a diseñar | Bloque 1 |
| **0015** | **supplier_invoices (+items, +audit)** + FK a OC + extensión OCR prompt | a diseñar | Bloque 2 |
| **0016** | **Contabilidad: journal_entries, journal_entry_lines, ar_ledger, ap_ledger** + motor de asientos | a diseñar | Bloque 3 |
| **0017** | **RBAC finanzas** (permisos + rol + enum) + vistas dashboard | a diseñar | Bloques 4 + 8 |
| 0018+ | Tesorería (treasury_accounts, payments, receipts), retenciones, migración Neuralsoft | futuro | fuera de scope |

> **Orden de dependencias estricto:** 0012 (catálogos) → 0014/0015 (documentos) → 0016 (contabilidad,
> que referencia chart_of_accounts y los documentos) → 0017 (RBAC+dashboard, que referencia todo).
> Ninguna se ejecuta en esta fase. Todas siguen los patrones obligatorios del §2.

### 9.2. Extensiones de enums requeridas (aditivas, idempotentes)

```
service_unit_t      += 'm2', 'm3'
permission_module_t += 'finanzas'
-- nuevos enums: contract_status_t, recurring_service_kind_t, periodicity_t,
--   billing_run_status_t, supplier_invoice_status_t, supplier_invoice_source_t,
--   contb. usa los existentes condicion_iva_t / comprobante_tipo_t (0011)
```

---

## 10. Riesgos y mitigaciones

| # | Riesgo | Impacto | Mitigación de diseño |
|---|---|---|---|
| R1 | Doble sistema de autorización (legacy `user_role_t` + RBAC granular) | Permisos inconsistentes | Toda tabla nueva usa `has_permission()` + `current_role()` como fallback; consolidar es deuda conocida (no la introduce este diseño) |
| R2 | Facturación masiva emite comprobantes erróneos en lote | Fiscal grave | Separación generación↔emisión; punto de revisión humana obligatorio; FREEZE ARCA frena en borrador |
| R3 | OCR extrae mal CUIT/CAE/importe de factura proveedor | Crédito fiscal IVA incorrecto | `ocr_confidence`; el humano confirma; UNIQUE de comprobante evita duplicados |
| R4 | Conflicto de numeración de migraciones | Migración rota | Renumeración resuelta en §9.1 (0014+) |
| R5 | Tarifas históricas pisadas | Pierde trazabilidad de precio facturado | `tariffs` versionado por rango de fecha, sin update destructivo |
| R6 | Asientos descuadrados | Balance incorrecto | Trigger invariante `SUM(debe)=SUM(haber)`; CHECK debe/haber excluyentes |
| R7 | Borrado de documento fiscal | Ilegal / rompe auditoría | Inmutabilidad por trigger; sólo Anular + asiento de reversa (principio #2) |
| R8 | Período contable cerrado recibe asiento | Reapertura indebida | `fiscal_periods.estado`; motor rechaza asiento sobre período cerrado |
| R9 | Clave X.509 expuesta | Compromiso fiscal | Clave sólo en host; nunca en DB ni código (principio #5) — sin cambios |
| R10 | Filtración cross-tenant de facturas | Privacidad cliente | RLS + scoping de bucket por client_id (patrón 0013) en toda tabla/bucket nuevo |

---

## 11. Roadmap de implementación (fases, design-only)

> Cada fase es un PR independiente sobre `feature/nexus-fullstack`. **Nada toca producción ni
> ejecuta migraciones hasta gate ejecutivo explícito por fase.** Las migraciones se escriben pero
> se aplican primero en staging.

| Fase | Entregable | Depende de | Gate |
|---|---|---|---|
| **F-Cat** | Migración 0012 (catálogos + rbac_audit) aplicada en staging | — | Validación staging |
| **F-B1** | Flujo B: tablas (0014) + UI Contratos/Servicios/Tarifas + corrida masiva hasta BORRADOR | 0012 | Demo corrida sin emisión |
| **F-B2** | Emisión de lote → ARCA (reusa `emitInvoice`) | F-B1 + **levantar FREEZE ARCA** | Gate fiscal |
| **F-SP** | supplier_invoices (0015) + pipeline OCR + conciliación OC↔Factura | 0012 | Demo carga OCR |
| **F-CO** | Contabilidad (0016): motor de asientos + mayores + EERR/Balance | 0014, 0015 | Validación contable (cuadre) |
| **F-DSH** | RBAC finanzas (0017) + dashboard FINANZAS + rentabilidad por CC | 0016 | Demo ejecutiva |
| **F-TES** | Tesorería + retenciones (0018+) | F-CO | Futuro |
| **F-MIG** | Migración de datos históricos Neuralsoft | todo lo anterior | Corte de sistema |

### Orden recomendado de construcción

```
F-Cat → (F-B1 ∥ F-SP) → F-CO → F-DSH → F-B2(post-freeze) → F-TES → F-MIG
```
F-B1 y F-SP son paralelizables (ambas dependen sólo de los catálogos). F-CO los une en contabilidad.
F-B2 (emisión real a ARCA) se posterga hasta que se levante el FREEZE ARCA y exista la clave en host.

---

## 12. Resumen ejecutivo

- **El motor de facturación NO se duplica.** Flujo B reusa `emitInvoice` + `customer_invoices`;
  sólo se agrega la capa upstream contratos→tarifas→corrida masiva.
- **4 bloques nuevos:** Flujo B (recurrente), supplier_invoices+OCR, contabilidad (asientos/mayores),
  dashboard FINANZAS. Todos cuelgan del backbone de 4 capas ya diseñado.
- **Catálogos (0012) son el pre-requisito.** cost_centers + chart_of_accounts habilitan rentabilidad
  por unidad de negocio (principio #6) y los asientos.
- **Numeración resuelta:** la secuencia financiera arranca en 0014 (0013 ya ocupado).
- **Todo design-only:** ninguna migración ejecutada, producción intacta, ARCA congelado, sin emisión.
- **Próximo paso sugerido:** gate ejecutivo sobre este documento → luego diseñar el DDL de 0012 y 0014.

---

*Documento de arquitectura. No constituye implementación. Sujeto a aprobación en gate ejecutivo.*
