# Contabilidad Nexus — Arquitectura, modelo y operación

> Documentación de la **capa contable** de Nexus (migraciones 0082–0086 + módulo
> `/contabilidad`). Convierte la capa fiscal/operativa existente en una contabilidad
> por partida doble, **sin duplicar IVA Ventas ni romper lo existente**.
>
> Regla de oro: *el subledger manda, el GL refleja.* La factura/cobro/pago es la
> fuente; el asiento es un derivado automático, idempotente y trazable.

---

## 1. Arquitectura contable

```
DOCUMENTO OPERATIVO            MOTOR (RPC SECURITY DEFINER)        CONTABILIDAD
─────────────────────         ───────────────────────────        ─────────────
customer_invoices    ─┐                                      ┌─→ journal_entries
supplier_invoices    ─┼─→ acc_post_document(source, id) ─────┤   journal_entry_lines
customer_receipts    ─┤      ├ acc_post_sales_invoice        │   (partida doble)
supplier_payments    ─┘      ├ acc_post_purchase_invoice     │
                             ├ acc_post_customer_receipt     └─→ chart_of_accounts
                             ├ acc_post_supplier_payment          accounting_periods
                             ├ acc_reverse_entry                   accounting_rules
                             └ acc_backfill (dry-run/real)
```

Principios (heredados de G10 / `ERP-FINANCE-ARCHITECTURE.md`):

- **Partida doble**: todo asiento posteado balancea (Σ debe = Σ haber), validado por
  constraint trigger diferido.
- **Append-only**: un asiento posteado no se edita; se **revierte** (asiento inverso).
  Nunca hay `DELETE`.
- **Solo cuentas imputables** (hoja) reciben líneas.
- **Idempotencia**: a lo sumo un asiento activo por `(source_type, source_id)` →
  el backfill es re-ejecutable sin duplicar.
- **Aditivo**: la contabilidad **lee** las tablas fiscales/tesorería; no las modifica.
- **Configurable**: las cuentas de imputación viven en `accounting_rules` (no en el
  código ni en el frontend).

---

## 2. Modelo de datos

### Tablas (migración 0083)

| Tabla | Rol |
|---|---|
| `chart_of_accounts` | Plan de cuentas jerárquico (`code`, `name`, `type`, `subtype`, `parent_id`, `is_postable`, `is_active`, `is_system`) |
| `accounting_periods` | Períodos mensuales (`year`, `month`, `start/end_date`, `status` open/closed/locked) |
| `journal_entries` | Cabecera de asiento (`entry_number`, `entry_date`, `period_id`, `source_type`, `source_id`, `status`, `reversed_entry_id`) |
| `journal_entry_lines` | Líneas (`account_id`, `debit`, `credit`, `currency`, `exchange_rate`, `cost_center_id`, `line_no`) |
| `accounting_rules` (0084) | Mapeo configurable `(source_type, rule_key) → account_code` |

### Enums (0083)

- `account_type_t`: `activo` · `pasivo` · `patrimonio_neto` · `ingreso` · `gasto` · `orden`.
- `accounting_period_status_t`: `open` · `closed` · `locked`.
- `journal_entry_status_t`: `draft` · `posted` · `reversed` · `cancelled`.
- `journal_source_t`: `customer_invoice` · `supplier_invoice` · `customer_receipt` ·
  `supplier_payment` · `manual` · `adjustment` · `opening`.

### Invariantes (triggers)

- `journal_entry_lines.debit/credit` ≥ 0 y excluyentes (una línea es debe **o** haber).
- Línea solo a cuenta **imputable y activa** (`tg_jel_account_postable`).
- Líneas y cabecera de un asiento **posteado** son inmutables (`tg_jel_lock_posted`,
  `tg_je_lock_posted`); la única transición es a `reversed`/`cancelled`.
- `DELETE` prohibido sobre asientos (`tg_forbid_delete_financial`, reutilizado de 0053).
- **Balance + período abierto** al postear: constraint trigger diferido
  `check_journal_entry_balanced` (corre al commit).
- Idempotencia: índice único parcial `je_source_unique` sobre `(source_type, source_id)`
  para asientos activos no-reversa.

### Seguridad (RLS + RBAC)

- RLS en las 5 tablas: lectura para roles internos o `has_permission('contabilidad.view')`;
  escritura para `admin` o el permiso correspondiente.
- Las escrituras contables reales pasan por **RPC SECURITY DEFINER** (`set search_path =
  public, pg_temp`).
- Módulo RBAC `contabilidad` (0082/0084): `view`, `create`, `edit`, `export`, `admin`.

---

## 3. Plan de cuentas (seed 0084)

Plan mínimo viable para 3PL/servicios (AR). Estructura jerárquica; las **hojas** son
imputables, los rubros son contenedores; todo `is_system=true` (protegido) pero
editable con permiso.

```
1 ACTIVO            1.1 Corriente (Caja, Bancos, Deudores, IVA CF, Percep/Retenc sufridas, Anticipos)
                    1.2 No corriente (Bienes de uso, Amortización acum.)
2 PASIVO            2.1 Corriente (Proveedores, IVA DF, IVA a pagar, Percep/Retenc a depositar,
                        Cargas sociales, Sueldos, Anticipos clientes, Otros tributos)
                    2.2 No corriente (Deudas financieras)
3 PATRIMONIO NETO   Capital, Resultados no asignados, Resultado del ejercicio
4 INGRESOS          Almacenaje CG/ANMAT, Oficinas, Coworking, Servicios logísticos,
                    Transporte, No gravadas/exentas, Otros, Intereses ganados
5 COSTOS            Servicios logísticos, Transporte, Depósito, Personal operativo
6 GASTOS            Administración, Comerciales, Sueldos, Cargas sociales, Servicios,
                    Seguridad, Mantenimiento, Honorarios, Seguros, Otros, Impuestos,
                    Gastos bancarios, Amortizaciones
```

> Cuentas marcadas `(*)` en `accounting_rules` (ventas/gasto default) requieren
> validación con el contador (ver §9). Se reimputan editando `accounting_rules`,
> sin tocar código.

---

## 4. Flujo de asientos automáticos

Reglas de registración (NC invierte debe↔haber automáticamente):

| Documento | Debe | Haber |
|---|---|---|
| **Factura de venta** (AUTORIZADO_ARCA) | Deudores por ventas (total) | Ventas (neto) + Ventas no gravadas/exentas + IVA débito + Percep. a depositar + Otros tributos |
| **Factura de compra** (aprobada) | Gasto/Costo (neto+no grav+exento+tributos, con centro de costo) + IVA crédito + Percep. sufridas | Proveedores (total) |
| **Cobranza** (confirmado) | Banco/Caja (neto) + Retenciones sufridas | Deudores por ventas (bruto) |
| **Pago a proveedor** (confirmado) | Proveedores (importe) | Banco/Caja (importe) |

- **Banco vs Caja**: se resuelve por `bank_accounts.is_system` (CAJA → cuenta Caja).
- **Estado que habilita posteo**: ventas `AUTORIZADO_ARCA ∧ ¬anulada`; compras
  `approval_status='aprobada'`; cobros/pagos `status='confirmado'`.
- **Anulación / Nota de crédito**: `acc_reverse_entry(entry_id, motivo)` crea el
  asiento inverso y marca el original como `reversed`. Nunca se borra.
- **Backfill**: `acc_backfill(source_type, dry_run, from, to)` recorre los documentos
  elegibles sin asiento activo y los contabiliza (o simula). Devuelve resumen
  `{candidates, posted_or_preview, skipped_existing, errors}`.

RPCs públicas (granted a `authenticated`, permiso interno `contabilidad.create`):
`acc_post_sales_invoice`, `acc_post_purchase_invoice`, `acc_post_customer_receipt`,
`acc_post_supplier_payment`, `acc_post_document` (dispatcher), `acc_reverse_entry`,
`acc_backfill`.

---

## 5. Relación entre IVA fiscal y contabilidad

- La **fuente fiscal** sigue siendo `libro_iva_ventas` / `libro_iva_compras` (no se
  tocaron). La contabilidad **refleja** ese IVA en cuentas: `2.1.02 IVA Débito` y
  `1.1.05 IVA Crédito`.
- La vista de control **`v_iva_fiscal_vs_contable`** compara, por período, el IVA de
  los libros fiscales contra el IVA registrado en la contabilidad (débito/crédito), y
  expone las diferencias. Si todos los comprobantes están contabilizados, las
  diferencias deben ser ≈ 0.
- **`v_comprobantes_sin_asiento`** lista lo que falta contabilizar (insumo del backfill).

---

## 6. Cómo se calcula la posición mensual de IVA

Vista **`v_posicion_iva`** (fiscal, independiente de la contabilidad). Por período:

```
IVA débito fiscal      = Σ libro_iva_ventas.iva_debito_fiscal
IVA crédito fiscal     = Σ libro_iva_compras.iva_credito_fiscal
Saldo técnico          = débito − crédito
Percepciones IVA sufr. = Σ supplier_invoice_other_taxes (PERCEPCION_IVA), no anuladas
Retenciones sufridas   = Σ customer_receipts.retention_amount (confirmadas)
Saldo posición         = saldo técnico − percepciones − retenciones
Resultado              = 'a_pagar' (>0) | 'a_favor' (<0) | 'neutro'
```

> Nota: las **retenciones practicadas** a proveedores aún no se modelan
> (`supplier_payments` no tiene `retention_amount`). Cuando se agregue, se suman a la
> posición. La regla `supplier_payment.retencion_practicada → 2.1.06` ya está creada.

---

## 7. Cómo se genera el balance de sumas y saldos

Vista **`v_balance_sumas_saldos`**: por cada cuenta imputable, sobre **asientos
posteados**:

```
total_debe     = Σ debit
total_haber    = Σ credit
saldo_deudor   = max(total_debe − total_haber, 0)
saldo_acreedor = max(total_haber − total_debe, 0)
```

Si la contabilidad cuadra: `Σ total_debe = Σ total_haber` y
`Σ saldo_deudor = Σ saldo_acreedor`. El **estado de resultados**
(`v_estado_resultados`) agrega las cuentas `ingreso`/`gasto` por período con
`neto = haber − debe` (ingresos +, gastos −); el resultado del período es `Σ neto`.

Otros reportes: `v_libro_diario`, `v_libro_mayor` (saldo acumulado por cuenta con
window function), `v_asientos_descuadrados` (control de integridad, debe estar vacío).

---

## 8. Qué falta para un balance anual completo

1. **Asientos de ajuste de cierre** (amortizaciones, devengamientos, provisiones,
   diferencias de cambio) — hoy se cargan como asientos manuales (`source_type='manual'`).
2. **Asiento de refundición de cuentas de resultado** al cierre del ejercicio
   (llevar saldos de 4/5/6 a `3.2.02 Resultado del ejercicio`).
3. **Saldos de apertura** (`source_type='opening'`) si se migra histórico de otro
   sistema (Neuralsoft).
4. **Retenciones practicadas** y **percepciones de venta desglosadas** para DDJJ
   completas.
5. **Centro de costo en ventas y tesorería** para rentabilidad por unidad de negocio.
6. **Estados contables formales** (presentación ENotas/anexos) — fuera del alcance del
   sistema operativo; los produce el contador con la información exportada.
7. **Conexión `logistics_orders` → facturación** para que no queden ingresos 3PL fuera
   del circuito.

---

## 9. Recomendaciones para validación con contador

- **Validar el plan de cuentas** (`chart_of_accounts`): nombres, aperturas, y si
  conviene desdoblar ventas por servicio (almacenaje/ANMAT/oficinas/coworking) en lugar
  del default `4.1.05`.
- **Validar las reglas de imputación** (`accounting_rules`), en especial las marcadas
  `(*)`: cuenta de ventas default, cuenta de gasto default, y el tratamiento de
  percepciones sufridas (1.1.06 a computar).
- **Definir el criterio de período**: hoy el período del asiento se toma de la fecha del
  documento (factura: `created_at`/`fecha_emision`; cobro/pago: `payment_date`).
- **Acordar el circuito de cierre mensual**: cuándo pasar `accounting_periods.status` a
  `closed`/`locked` (el motor rechaza asientos sobre período cerrado).
- **Revisar `v_iva_fiscal_vs_contable`** tras cada cierre para confirmar que el IVA
  contable coincide con el fiscal.
- **Aplicar y validar en staging** con `supabase/tests/ACCOUNTING_VALIDATION.sql` antes
  de producción; correr el backfill primero en **dry-run**.

---

## 10. Operación (paso a paso)

1. Aplicar migraciones **0082 → 0086 en orden** (a mano, Supabase prod, G3).
2. Correr `supabase/tests/ACCOUNTING_VALIDATION.sql` (read-only) → verificar `OK`.
3. En `/contabilidad/comprobantes`, **Simular** el backfill por tipo (dry-run).
4. Si el dry-run no reporta errores, **Contabilizar** (genera asientos).
5. Verificar en `/contabilidad/balance` que cuadra y en `/contabilidad/posicion-iva`
   la posición del mes; revisar `/contabilidad/libro-diario` y el mayor.
6. Validar el plan y las reglas con el contador; ajustar `accounting_rules` si hace falta
   y re-contabilizar (revertir + re-postear) los asientos afectados.

> Las migraciones se entregan; las aplica Martín. Esta capa no ejecuta migraciones ni
> toca producción por sí sola.
