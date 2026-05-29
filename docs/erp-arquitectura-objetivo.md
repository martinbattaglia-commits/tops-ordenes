# TOPS NEXUS — Informe técnico ERP: análisis de migración 0011 y arquitectura objetivo

> **Estado:** análisis · **Fecha:** 2026-05-29
> Analiza en detalle qué crea la migración `0011_arca_billing.sql`, mapea el
> modelo de datos actual y diseña la **arquitectura ERP final** para reemplazar
> completamente Neuralsoft (Facturación + Proveedores + Tesorería + Cuentas
> Corrientes + IVA Débito/Crédito + Retenciones + Balance Anual).
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md).

---

## 0. Hallazgo crítico de estado (leer primero)

El árbol desplegado (`origin/main` → Netlify) **no contiene** buena parte del
código y de las migraciones que el documento rector da por hechas. Verificado
con `git ls-tree -r origin/main`:

| Artefacto | En disco (local) | En `origin/main` (desplegado) |
|-----------|:----------------:|:-----------------------------:|
| Migración `0001`–`0007` (base, clients, orders, RLS, `current_role()`) | ✅ | ✅ |
| Migración `0008_purchase_orders` (vendors, purchase_orders, po_items) | ✅ | ❌ **untracked** |
| Migración `0009_rbac` (roles, permissions, user_roles) | ✅ | ❌ **untracked** |
| Migración `0010_documents` | ✅ | ❌ **untracked** |
| Migración `0011_arca_billing` (Facturación ARCA) | ✅ | ✅ |
| Módulos `compras`, `anmat`, `cctv`, `comercial`, `documental`, `ejecutivo`, `operaciones`, `settings/roles` | ✅ | ❌ **untracked** |
| Módulos `billing`, `clients`, `dashboard`, `orders`, `reports`, `settings`, `templates` | ✅ | ✅ |

**Implicancia:** el módulo de **Proveedores (OC)** y el **RBAC granular** existen
solo como WIP local sin versionar. La migración `0011` (ARCA) **sí** está
desplegada y es **autosuficiente**: sus únicas dependencias reales son
`public.current_role()` (definida en `0001`, endurecida en `0005`) y
`profiles.client_id` (de `0001`) — ambas presentes en producción. No depende de
`0008`/`0009`/`0010`. Por lo tanto `0011` puede aplicarse en producción sin
ellas, pero **el ERP real de proveedores no existe en repo todavía**.

> **Acción recomendada antes de seguir:** versionar (`git add`) las migraciones
> `0008`–`0010` y los módulos WIP, o decidir explícitamente descartarlos. Hoy
> hay divergencia entre lo que el rector declara "✅ existe" y lo que está bajo
> control de versiones.

---

## 1. Tablas creadas por la migración 0011

Cinco tablas nuevas, todas en `public`:

| Tabla | PK | Propósito | Cardinalidad esperada |
|-------|----|-----------|----|
| `fiscal_config` | `smallint` `id=1` (singleton, `check id=1`) | Datos del emisor (VEROTIN), ambiente ARCA, alias de cert, PV por defecto, pie legal | 1 fila |
| `puntos_venta` | `uuid` | Catálogo de puntos de venta (WS / controlador fiscal / manual) | decenas |
| `customer_invoices` | `uuid` | Comprobante electrónico de venta (cabecera) | alto (núcleo transaccional) |
| `invoice_items` | `uuid` | Renglones del comprobante | alto (≈ N× invoices) |
| `invoice_audit` | `bigserial` | Auditoría fiscal append-only | muy alto (crece monótono) |

Más **2 alteraciones** a tablas vivas: `clients` (+3 columnas fiscales),
`orders` (+1 FK `invoice_id` + índice).

---

## 2. Relaciones (modelo entidad-relación de 0011)

```
auth.users ──┬─< fiscal_config.updated_by         (SET NULL)
             ├─< customer_invoices.emitido_por     (SET NULL)
             └─< invoice_audit.user_id             (SET NULL)

clients ─────< customer_invoices.client_id          (RESTRICT)   1:N
customer_invoices ─< invoice_items.invoice_id        (CASCADE)    1:N
customer_invoices ─< invoice_audit.invoice_id        (CASCADE)    1:N
customer_invoices ─< customer_invoices.comprobante_asociado_id (SET NULL, autorreferencia NC/ND)
orders ──────< invoice_items.order_id                (SET NULL)   N:1 (renglón ← OS)
customer_invoices ─< orders.invoice_id               (SET NULL)   1:N (OS facturadas)
```

- **`clients 1:N customer_invoices`** con snapshot: la factura copia
  `razon_social`, `cuit_cliente`, `condicion_iva`, `domicilio_cliente` al emitir
  (inmutabilidad fiscal: si el cliente cambia luego, la factura no muta).
- **Doble vínculo OS ↔ factura**: `orders.invoice_id → customer_invoices` (la OS
  apunta a su factura) **y** `invoice_items.order_id → orders` (el renglón puede
  originarse en una OS firmada). Permite facturar varias OS en un comprobante.
- **Autorreferencia NC/ND**: `comprobante_asociado_id` enlaza una Nota de
  Crédito/Débito con la factura que ajusta.

---

## 3. Foreign keys (exhaustivo, con acción ON DELETE)

| # | Tabla.columna | → Referencia | ON DELETE |
|---|---------------|--------------|-----------|
| 1 | `fiscal_config.updated_by` | `auth.users(id)` | SET NULL |
| 2 | `customer_invoices.client_id` | `clients(id)` | **RESTRICT** |
| 3 | `customer_invoices.comprobante_asociado_id` | `customer_invoices(id)` | SET NULL |
| 4 | `customer_invoices.emitido_por` | `auth.users(id)` | SET NULL |
| 5 | `invoice_items.invoice_id` | `customer_invoices(id)` | **CASCADE** |
| 6 | `invoice_items.order_id` | `orders(id)` | SET NULL |
| 7 | `invoice_audit.invoice_id` | `customer_invoices(id)` | **CASCADE** |
| 8 | `invoice_audit.user_id` | `auth.users(id)` | SET NULL |
| 9 | `orders.invoice_id` | `customer_invoices(id)` | SET NULL |

**Constraint de unicidad fiscal:** `unique (punto_venta, cbte_tipo_arca,
numero_comprobante)` en `customer_invoices` — garantiza numeración secuencial
única por PV+tipo (solo aplica cuando hay número asignado tras el CAE).

> ⚠️ **Observación sobre CASCADE en `invoice_audit`** (#7): borrar una factura
> borra su auditoría. Para una auditoría fiscal verdaderamente inmutable, lo
> correcto es **impedir el DELETE de facturas autorizadas** (hoy no hay trigger
> de DELETE, solo de UPDATE — ver §5). Ver riesgo R3 en §7.

---

## 4. RLS policies (11 en 0011) y modelo de acceso

Todas usan `public.current_role()` (lee `profiles.role` → enum
`user_role_t`: `admin | operaciones | supervisor | cliente`).

| Tabla | Policy | Operación | Regla |
|-------|--------|-----------|-------|
| `fiscal_config` | read internal | SELECT | rol ∈ {admin, operaciones, supervisor} |
| `fiscal_config` | write admin | ALL | rol = admin |
| `puntos_venta` | read internal | SELECT | rol ∈ {admin, operaciones, supervisor} |
| `puntos_venta` | write admin | ALL | rol = admin |
| `customer_invoices` | read internal | SELECT | rol interno **o** `client_id = profiles.client_id` (el cliente ve las suyas) |
| `customer_invoices` | write internal | ALL | rol ∈ {admin, operaciones} |
| `invoice_items` | read | SELECT | existe la factura padre |
| `invoice_items` | write internal | ALL | rol ∈ {admin, operaciones} |
| `invoice_audit` | read admin | SELECT | rol ∈ {admin, supervisor} |
| `invoice_audit` | insert internal | INSERT | rol ∈ {admin, operaciones} (append-only: sin update/delete) |

**Storage:** policy `invoices bucket internal` sobre `storage.objects` — acceso
total al bucket privado `invoices` para cualquier `authenticated` (no discrimina
por rol ni por dueño del archivo → ver riesgo R4 en §7).

> **Debilidad de granularidad:** la RLS de 0011 se apoya en el enum simple de 4
> roles, **no** en el RBAC rico de `0009` (roles/permissions). Coexisten dos
> sistemas de autorización. La arquitectura objetivo debe unificarlos (§10).

---

## 5. Triggers

| Trigger | Tabla | Evento | Función | Efecto |
|---------|-------|--------|---------|--------|
| `customer_invoices_lock` | `customer_invoices` | BEFORE UPDATE | `tg_lock_authorized_invoice()` | Si `old.estado_arca = 'AUTORIZADO_ARCA'`, bloquea cambios a campos fiscales (`cae`, `numero_comprobante`, `total`, `subtotal`, `iva`, `cbte_tipo_arca`, `punto_venta`, `cuit_cliente`) → obliga NC/ND. Permite anulación lógica, materializar PDF y `updated_at`. |

Triggers relacionados ya existentes en el schema base:
- `trg_set_public_id` (`orders`, BEFORE INSERT) → genera `OS-NNNNNN`.
- `trg_set_po_public_id` (`purchase_orders`, BEFORE INSERT, **untracked**) → `OC-AAAA-NNNN`.
- `trg_roles_updated_at` (`roles`, **untracked**) → toca `updated_at`.

**Falta (gap):** no hay trigger que bloquee `DELETE` de comprobantes
autorizados, ni trigger que calcule/valide totales (`total = subtotal + iva +
percepciones + tributos + no_gravado + exento`) a nivel DB — hoy la consistencia
de importes depende del código de aplicación.

---

## 6. Enums (5 nuevos en 0011 + contexto)

**Creados por 0011:**

1. `condicion_iva_t` — `RESPONSABLE_INSCRIPTO`, `MONOTRIBUTO`, `EXENTO`, `CONSUMIDOR_FINAL`, `NO_RESPONSABLE`, `NO_CATEGORIZADO`.
2. `comprobante_tipo_t` — `FACTURA_A/B/C`, `NOTA_DEBITO_A/B/C`, `NOTA_CREDITO_A/B/C`, `FACTURA_E`. ⚠️ **falta** `NOTA_DEBITO_E`/`NOTA_CREDITO_E` y comprobantes M (régimen de retención).
3. `invoice_arca_status_t` — `BORRADOR`, `PENDIENTE_ARCA`, `ENVIADO_ARCA`, `AUTORIZADO_ARCA`, `RECHAZADO_ARCA`, `ERROR_ARCA`, `ANULADO`.
4. `arca_ambiente_t` — `SANDBOX`, `HOMOLOGACION`, `PRODUCCION`.
5. `punto_venta_tipo_t` — `WEBSERVICE`, `CONTROLADOR_FISCAL`, `MANUAL`.

**Pre-existentes relevantes:** `user_role_t`, `depot_t`, `order_status_t`,
`service_unit_t` (0001); `po_status_t`, `po_event_kind_t` (0008, untracked);
`permission_module_t`, `permission_action_t` (0009, untracked).

> **Nota de diseño:** usar enums nativos PG para tipos fiscales es robusto pero
> rígido — agregar un valor requiere `ALTER TYPE ... ADD VALUE` (no reversible en
> una transacción hasta PG12+, y nunca borrable). Para catálogos que crecen
> (tipos de comprobante M/T, alícuotas) conviene migrar a **tablas de catálogo**
> (ver §9, R1).

---

## 7. Riesgos de escalabilidad

| # | Riesgo | Severidad | Mitigación |
|---|--------|:---------:|------------|
| R1 | **Enums fiscales rígidos.** Nuevos tipos de comprobante (M, T), alícuotas o condiciones IVA requieren `ALTER TYPE`, irreversible y sin metadata (código ARCA, vigencia). | Media | Migrar tipos volátiles a **tablas catálogo** (`comprobante_tipos`, `alicuotas_iva`) con código ARCA, alias y `activo`. Mantener enum solo para estados de ciclo de vida. |
| R2 | **`invoice_audit` crece sin límite** (append-only, una fila por evento). En años, millones de filas. | Media | Particionar por rango de fecha (`PARTITION BY RANGE (ts)`), retención + archivado frío. Índice ya existe en `(invoice_id, ts desc)`. |
| R3 | **Auditoría borrable por CASCADE** (FK #7) y **sin guard de DELETE** en facturas autorizadas. Viola el no-negociable de inmutabilidad. | **Alta** | Trigger `BEFORE DELETE` que prohíba borrar comprobantes ≠ BORRADOR; cambiar `invoice_audit.invoice_id` a `ON DELETE RESTRICT` o desnormalizar (guardar `numero_comprobante`/`cae` en el log para sobrevivir al borrado). |
| R4 | **Bucket `invoices` sin scoping.** Cualquier `authenticated` accede a todo PDF fiscal (incluye clientes B2B que solo deberían ver los suyos). | **Alta** | Policy por path: `name like client_id || '/%'` o validar contra `customer_invoices.client_id`. Servir siempre con signed URLs de corta vida. |
| R5 | **Totales sin validación en DB.** La coherencia `total = Σ` depende del código. Un bug de app puede persistir comprobantes descuadrados. | Media | Trigger de validación de importes en `BEFORE INSERT/UPDATE`, o columna generada. |
| R6 | **Numeración de comprobantes sin secuencia server-side.** El número viene del CAE de ARCA, pero el unique no previene huecos ni concurrencia en borradores. | Baja | Reservar número solo al obtener CAE (ya es el patrón); documentar y agregar índice parcial `where numero_comprobante is not null`. |
| R7 | **Dos sistemas de autorización** (enum `user_role_t` vs RBAC `0009`) conviviendo. RLS de 0011 ignora permisos finos. | Media | Unificar: que `current_role()`/RLS consulten `has_permission()` del RBAC. |
| R8 | **Divergencia repo↔producción** (§0): proveedores/RBAC/módulos sin versionar. | **Alta** | Versionar o descartar explícitamente antes de construir Tesorería encima. |
| R9 | **Moneda y cotización por comprobante pero sin tabla de cotizaciones.** Factura E (export) guarda `moneda`/`cotizacion` sueltos. | Baja | Tabla `tipos_cambio` (fecha, moneda, valor) referenciable; histórico para revalúo. |

---

## 8. Qué falta para soportar cada dominio

### 8.1 Facturación ARCA **real** (hoy: SANDBOX/Mock)
Schema **completo** para emitir. Falta operativamente:
- Certificado X.509 montado en host (`ARCA_CERT_PATH`/`ARCA_KEY_PATH`) + flujo
  WSAA real (token/sign con TTL 12 h) y WSFEv1 productivo.
- `FECompUltimoAutorizado` para sincronizar el último número por PV+tipo antes
  de pedir CAE (evitar rechazo por salto de numeración).
- Manejo de **comprobantes M** y régimen de percepción/retención del receptor.
- Tabla `tipos_cambio` para Factura E.
- Reintentos idempotentes ante `ERROR_ARCA` (ya hay estado; falta cola/retry).

### 8.2 Proveedores (hoy: solo OC local, untracked)
Existe `vendors` + `purchase_orders` + `po_items` (en `0008`, **sin desplegar**).
**Falta el eslabón fiscal-financiero:**
- **`supplier_invoices`** (factura de proveedor / IVA Crédito) — inexistente.
- **`cost_centers`** (centro de costo) — inexistente.
- Vínculo OC → factura proveedor → pago (recepción/conciliación de 3 vías:
  OC ↔ remito ↔ factura).
- Categoría contable y responsable por factura (no-negociable del rector F3).

### 8.3 Tesorería (inexistente)
Falta **todo**: cajas, bancos, movimientos de fondos, medios de pago, cheques
propios y de terceros / e-cheq, pagos a proveedores, cobranzas de clientes,
conciliación bancaria, flujo de fondos proyectado.

### 8.4 Cuentas Corrientes (inexistente)
Falta el **subledger** (mayor auxiliar) de clientes (AR) y proveedores (AP):
saldo, antigüedad de deuda (aging), aplicación de cobros/pagos a comprobantes,
notas de crédito/débito, intereses por mora.

### 8.5 IVA Débito (parcial)
Se **deriva** de `customer_invoices.iva` + `invoice_items.alicuota_iva`. Falta:
- **Libro IVA Ventas** (vista/tabla consolidada por período + alícuota).
- Discriminación por alícuota (0/10.5/21/27) a nivel agregado para DDJJ.

### 8.6 IVA Crédito (inexistente)
Depende 100 % de `supplier_invoices` (que no existe). Falta:
- Cabecera + ítems de factura de compra con IVA discriminado por alícuota.
- **Libro IVA Compras** + cómputo de crédito fiscal.

### 8.7 Retenciones / Percepciones (casi inexistente)
`customer_invoices` tiene una columna `percepciones numeric` agregada, pero falta:
- **Tabla `retenciones`/`percepciones`** por comprobante y por régimen
  (Ganancias, IVA, IIBB por jurisdicción, SUSS), con base, alícuota, importe y
  **certificado** emitido/recibido.
- Padrones de alícuotas IIBB (ARBA/AGIP/Convenio Multilateral).
- Acumuladores para mínimos no sujetos a retención.

### 8.8 Balance Anual (inexistente)
Falta la **contabilidad de partida doble**:
- **Plan de cuentas** (`chart_of_accounts`).
- **Asientos** (`journal_entries`) + **líneas** (`journal_lines`, débito/haber).
- **Mayor** (vista derivada) y **Balance de sumas y saldos**.
- **Períodos contables** (`fiscal_periods`) con cierre/apertura y bloqueo.
- Motor de **registración automática**: cada factura, pago, cobro genera su
  asiento (subledger → GL).

---

## 9. Tablas a agregar **ahora** para evitar migraciones disruptivas futuras

Crear el **esqueleto** de los dominios futuros aunque se llenen por fases evita
`ALTER` masivos sobre tablas vivas y FKs retroactivas (lo más disruptivo). En
orden de prioridad:

**Bloque A — Catálogos transversales (migración 0012, base de todo):**
1. `cost_centers` (id, código, nombre, parent_id jerárquico, activo).
2. `chart_of_accounts` (plan de cuentas: código, nombre, tipo
   activo/pasivo/PN/R+/R−, imputable, parent_id).
3. `tax_rates` / `alicuotas_iva` (catálogo: código ARCA, alícuota, vigencia).
4. `tipos_cambio` (moneda, fecha, valor) — desbloquea Factura E y revalúo.
5. `fiscal_periods` (año/mes, estado abierto/cerrado) — para cierre y bloqueo.

**Bloque B — Proveedores / IVA Crédito (migración 0013, cierra Fase 3):**
6. `supplier_invoices` (espejo de `customer_invoices` para compras: vendor_id,
   cost_center_id, tipo comprobante, CAE recibido, importes con IVA discriminado,
   estado, `cuenta_contable_id`, responsable).
7. `supplier_invoice_items` (renglones con alícuota IVA).
8. `purchase_order_id` FK opcional en `supplier_invoices` (conciliación OC↔factura).

**Bloque C — Retenciones (migración 0014):**
9. `withholdings` (comprobante_id polimórfico venta/compra, régimen, base,
   alícuota, importe, certificado, fecha).

**Bloque D — Tesorería + CC (migración 0015):**
10. `accounts` (cajas y bancos: tipo, moneda, saldo, CBU/alias).
11. `payment_methods` (efectivo, transferencia, cheque, e-cheq, retención).
12. `treasury_movements` (ingreso/egreso, account_id, fecha, importe, concepto).
13. `payments` (egreso a proveedor) + `payment_allocations` (aplicación a
    `supplier_invoices`).
14. `collections` (cobranza de cliente) + `collection_allocations` (aplicación a
    `customer_invoices`).
15. `checks` (cheques/e-cheq: número, banco, vencimiento, estado, cartera).
16. `account_statements` / vista `current_accounts` (mayor auxiliar AR/AP por
    aplicación de comprobantes y cobros/pagos).

**Bloque E — Contabilidad (migración 0016, habilita Balance):**
17. `journal_entries` (asiento: fecha, período, origen, descripción).
18. `journal_lines` (cuenta, débito, haber, cost_center_id).

> **Principio anti-disruptivo:** agregar **ahora** las FK *placeholders* en las
> tablas que ya existen y son transaccionales —`customer_invoices.cost_center_id`,
> `customer_invoices.journal_entry_id`— como **nullable**, evita re-tocar la tabla
> núcleo (y su trigger de inmutabilidad) más adelante. Igual para `orders` y
> `purchase_orders`.

---

## 10. Arquitectura ERP final objetivo (reemplazo total de Neuralsoft)

Modelo en **4 capas**: documentos operativos → subledgers (auxiliares) →
tesorería → contabilidad general (GL). Toda operación fluye hacia el GL.

```
┌─────────────────────────────────────────────────────────────────────┐
│ CAPA 0 · MAESTROS Y CATÁLOGOS                                         │
│  clients · vendors · operators · products · services_catalog          │
│  cost_centers · chart_of_accounts · tax_rates · tipos_cambio          │
│  fiscal_config · puntos_venta · fiscal_periods                        │
│  RBAC unificado: roles · permissions · user_roles · current_role()    │
└───────────────┬───────────────────────────────────┬──────────────────┘
                │                                     │
┌───────────────▼──────────────┐      ┌───────────────▼──────────────────┐
│ CAPA 1 · DOCUMENTOS OPERATIVOS│      │ CAPA 1 · DOCUMENTOS OPERATIVOS    │
│  VENTAS                       │      │  COMPRAS                          │
│  orders (OS) ─────────────┐   │      │  purchase_orders (OC) ────────┐   │
│  customer_invoices ◄──────┘   │      │  supplier_invoices ◄──────────┘   │
│  invoice_items                │      │  supplier_invoice_items           │
│  (IVA Débito)                 │      │  (IVA Crédito)                    │
└───────────────┬──────────────┘      └───────────────┬───────────────────┘
                │ retenciones/percepciones (withholdings) ambos lados       │
┌───────────────▼───────────────────────────────────────▼──────────────────┐
│ CAPA 2 · SUBLEDGERS (CUENTAS CORRIENTES)                                   │
│  current_accounts AR (clientes)  ·  current_accounts AP (proveedores)      │
│  aging / saldo / aplicación de cobros y pagos a comprobantes               │
└───────────────┬───────────────────────────────────────┬──────────────────┘
                │ collections (cobranzas)   payments (pagos a proveedor)     │
┌───────────────▼───────────────────────────────────────▼──────────────────┐
│ CAPA 3 · TESORERÍA                                                         │
│  accounts (cajas/bancos) · treasury_movements · checks/e-cheq             │
│  payment_methods · conciliación bancaria · flujo de fondos                 │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │ cada documento/pago/cobro emite su asiento
┌────────────────────────────────▼──────────────────────────────────────────┐
│ CAPA 4 · CONTABILIDAD GENERAL (GL)                                          │
│  journal_entries · journal_lines (partida doble, por cost_center)           │
│  → Mayor · Balance de sumas y saldos · Estado de resultados · BALANCE ANUAL │
│  → Libro IVA Ventas · Libro IVA Compras · DDJJ IVA · Retenciones            │
└─────────────────────────────────────────────────────────────────────────────┘
        TRANSVERSAL: audit_log + *_audit (inmutable) · documents/attachments
        INTEGRACIONES: ARCA (WSAA/WSFEv1) · bancos · Clientify · migración Neuralsoft
```

**Principios rectores de la arquitectura:**

1. **El subledger manda, el GL refleja.** Facturas, pagos y cobros viven en sus
   tablas operativas; un **motor de registración** genera el asiento de partida
   doble automáticamente (`journal_entry_id` nullable en cada documento). Nunca
   se asienta a mano lo que el sistema puede derivar.
2. **Inmutabilidad fiscal end-to-end.** El trigger de bloqueo (hoy en
   `customer_invoices`) se replica en `supplier_invoices` y se complementa con
   guard de DELETE + período contable cerrado (`fiscal_periods`) que bloquea
   cualquier escritura retroactiva.
3. **Un solo sistema de autorización.** RLS de todo el ERP consulta el RBAC
   granular (`has_permission`), no el enum simple. Cliente B2B ve solo su
   dominio (sus OS/OC/facturas/CC) por `profiles.client_id`.
4. **Catálogos versionables, no enums, para lo que cambia** (tipos de
   comprobante, alícuotas, regímenes de retención, plan de cuentas).
5. **Datos fiscales nunca hardcodeados** (`fiscal_config`); clave X.509 solo en
   host. (No-negociables del rector.)
6. **Centro de costo y cuenta contable obligatorios** en todo documento de
   compra y, deseablemente, de venta → habilita resultados por unidad de negocio
   (depósito MAGALDI vs. otros) y el Balance segmentado.

**Secuencia de implementación (alineada al roadmap de 7 fases):**

| Migración | Bloque | Habilita | Fase rector |
|-----------|--------|----------|-------------|
| 0012 | Catálogos (cost_centers, plan de cuentas, tax_rates, tipos_cambio, fiscal_periods) | Fundación contable | F3/F6 |
| 0013 | `supplier_invoices` + items + FK a OC | Proveedores + IVA Crédito | **F3** |
| 0014 | `withholdings` | Retenciones/percepciones | F3/F4 |
| 0015 | Tesorería + Cuentas Corrientes (accounts, payments, collections, checks, allocations) | **F4 + F5** | F4/F5 |
| 0016 | GL (journal_entries/lines) + motor de asientos + Libros IVA | Balance Anual + DDJJ | F6 |
| 0017 | Migración Neuralsoft (ETL de saldos iniciales, históricos) | Reemplazo total | F7 |

> **Conclusión:** la migración `0011` resuelve **bien** el dominio de ventas
> (IVA Débito) y deja la inmutabilidad fiscal de ese lado correctamente atada.
> Para reemplazar Neuralsoft falta construir el **lado de compras (IVA Crédito)**,
> los **subledgers de cuentas corrientes**, la **tesorería** y, como capa que lo
> integra todo, la **contabilidad de partida doble** que produce el Balance. La
> decisión de mayor apalancamiento *ahora* es la **migración 0012 de catálogos**
> (centros de costo + plan de cuentas + períodos): es barata, no toca tablas
> vivas y desbloquea las cuatro fases siguientes sin migraciones disruptivas.
