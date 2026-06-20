# Runbook — Aplicación contable/fiscal/facturación · migraciones 0082–0101

> **Tipo:** runbook operativo de aplicación manual.
> **Destino primario:** **STAGING** (`vrxosunxlhohmqymxots`). **NO producción.**
> **Ejecuta:** Martín (a mano, SQL Editor de Supabase). El asistente no aplica nada (G3).
> **Estado de los archivos:** entregados en la branch `claude/nexus-accounting-tax-audit-mbpxjt`,
> **sin aplicar a ninguna base**.
> **Última verificación documental:** 20 migraciones (0082–0101) + 5 kits de validación presentes;
> cadena consistente (sin incompatibilidades críticas detectadas).

---

## 1. Resumen ejecutivo

Esta cadena de 20 migraciones convierte la capa fiscal/operativa de Nexus en una
**contabilidad completa con facturación**. Instala, en orden:

| Capacidad | Migraciones |
|---|---|
| **Contabilidad** (plan de cuentas, períodos, asientos por partida doble, libros, EERR) | 0082–0086 |
| **IVA** débito/crédito + **posición mensual** | 0083–0086 (usa libros 0059/0073 ya en base) |
| **Percepciones** de venta (desglose) | 0087, 0089 |
| **Retenciones** practicadas a proveedores | 0088, 0089 |
| **Tesorería bruto/retención/neto** (pago con retención sin residual) | 0090–0091 |
| **Centros de costo** (ventas/tesorería/contabilidad) | 0092, 0094 |
| **`logistics_orders` → facturación** (vínculo seguro, sin duplicar) | 0093 |
| **Base de cierre** (simulación + ejecución gateada) | 0095 |
| **Tarifas** (cliente × servicio, sin solapamientos) | 0096–0097 |
| **Billing runs** (facturación recurrente, borradores) | 0098 |
| **Pricing logístico** (simulación read-only) | 0099 |
| **Borradores de factura** desde billing run | 0100 |
| **Refundición anual** (simulación + ejecución gateada) | 0101 |

**Reglas no negociables de este despliegue:**

- ❌ **No aplicar directo en producción.** Primero **staging** completo y validado.
- ✅ **Cada bloque se valida antes de pasar al siguiente** (puntos go/no-go, §6).
- ❌ **No ejecutar cierre mensual real ni refundición anual real sin el contador** (§8) y sin
  confirmación explícita (las RPC exigen `confirm=true` + permiso `contabilidad.admin`).
- ✅ **Todo es aditivo**: no borra ni altera datos existentes; sólo agrega tablas, columnas,
  funciones y vistas.

> Las migraciones **no emiten ARCA**, **no emiten facturas automáticamente** y **no
> contabilizan nada sin documento aprobado**. Los borradores de factura nacen en estado
> `BORRADOR` (no fiscal).

---

## 2. Precondiciones

Antes de aplicar **cualquier** migración de esta cadena, confirmar:

- [ ] **Backup reciente de staging** (snapshot/restore point en Supabase). *Obligatorio.*
- [ ] **Acceso admin** a la consola de Supabase de **staging** (`vrxosunxlhohmqymxots`).
- [ ] **Branch correcta** desplegada: `claude/nexus-accounting-tax-audit-mbpxjt` (los archivos
      `.sql` salen de `supabase/migrations/` de esa branch).
- [ ] **Migraciones 0001–0081 ya aplicadas** en staging (esta cadena depende de:
      `clients`, `vendors`, `cost_centers`(0014), `customer_invoices`/`invoice_items`(0011),
      `customer_invoice_vat_lines`(0072), `supplier_invoices`+detalle(0014/0056), `treasury_*`(0053/0054),
      `logistics_orders`(0030), `contracts`(0076), RBAC(0009)).
- [ ] **Variables de entorno** de staging correctas (Supabase URL/keys). No se requieren
      secretos ARCA para esta cadena (no emite).
- [ ] **Usuario de aplicación** = rol con privilegios de owner/`postgres` en el SQL Editor
      (las migraciones crean tipos, funciones SECURITY DEFINER, policies).
- [ ] **Contador informado**: deberá validar plan de cuentas, cuentas de IVA/percep/retenc,
      reglas de imputación y criterio de cierre/refundición (§8). No bloquea la aplicación
      estructural, pero **sí bloquea** ejecutar cierres/refundición reales.
- [ ] **Confirmado que NO es producción.**

### 2.1. Notas técnicas críticas de aplicación

1. **Ejecutar cada archivo de migración como su propia ejecución** (un `.sql` por vez en el
   SQL Editor). **No** pegar varios archivos en una sola transacción/run.
   - Motivo: `0082_accounting_enums.sql` hace `ALTER TYPE … ADD VALUE 'contabilidad'`, que
     **no puede usarse en la misma transacción** en la que luego se referencia (lo usa
     `0084`). Aplicando archivo por archivo, el `ADD VALUE` queda committeado antes de 0084.
   - Es la única migración de la cadena con esa restricción (verificado: sólo 0082 contiene
     `add value`).
2. **Extensión `btree_gist`**: `0097_customer_service_rates.sql` hace
   `create extension if not exists btree_gist` (para el `EXCLUDE` anti-solapamiento de
   tarifas). Está en la lista de extensiones permitidas por Supabase; si la organización
   restringe extensiones, habilitarla antes (Database → Extensions → `btree_gist`).
3. Todas las migraciones son **idempotentes** (`if not exists`, `on conflict do nothing`,
   `create or replace`, enums guardados). Re-ejecutar una migración no debería romper, pero
   **el orden importa** (respetar §3).

---

## 3. Orden exacto de aplicación

> Aplicar **en este orden estricto**, un archivo por vez, validando al cierre de cada bloque
> (§4) antes de continuar.

### Bloque A — Capa contable base
| # | Archivo | Incorpora | NO hacer aún |
|---|---|---|---|
| 1 | `0082_accounting_enums.sql` | Valor de enum `permission_module_t='contabilidad'` (aislado) | — |
| 2 | `0083_accounting_core.sql` | `chart_of_accounts`, `accounting_periods`, `journal_entries`, `journal_entry_lines`, invariantes de partida doble, RLS/RBAC | — |
| 3 | `0084_accounting_seed.sql` | Plan de cuentas base 3PL + `accounting_rules` + permisos `contabilidad.*` | Editar el plan antes de validar con contador |
| 4 | `0085_accounting_posting.sql` | Motor de asientos (ventas/compras/cobros/pagos), reversa, backfill dry-run | Correr backfill **real** sin revisar dry-run |
| 5 | `0086_accounting_reports.sql` | Libro diario/mayor, sumas y saldos, EERR, posición IVA, controles | — |

### Bloque B — Fase 10 fiscal
| # | Archivo | Incorpora | NO hacer aún |
|---|---|---|---|
| 6 | `0087_sales_other_taxes.sql` | `customer_invoice_other_taxes` (percepciones de venta) + RPC + cuenta 2.1.16 | — |
| 7 | `0088_supplier_withholdings.sql` | `supplier_payment_withholdings` (retenciones practicadas) + RPC + cuentas 2.1.12–2.1.15 | — |
| 8 | `0089_phase10_posting_and_reports.sql` | Asientos con percepciones/retenciones + vistas fiscales | — |

### Bloque C — Fase 11 tesorería
| # | Archivo | Incorpora | NO hacer aún |
|---|---|---|---|
| 9 | `0090_treasury_withholdings_native.sql` | RPC `tesoreria_register_supplier_payment_neto` (bruto/retención/neto) + columnas en `supplier_payments` | — |
| 10 | `0091_phase11_reports_backfill.sql` | Vistas de conciliación + diagnóstico de residuales (read-only) | — |

### Bloque D — Fase 12 centros de costo / logistics / cierre
| # | Archivo | Incorpora | NO hacer aún |
|---|---|---|---|
| 11 | `0092_cost_centers_dimension.sql` | `cost_centers.type/updated_at` + unidades de negocio + `cost_center_id` en ventas/tesorería | — |
| 12 | `0093_logistics_billing.sql` | `logistics_order_billing_links` + RPCs + vistas (vínculo seguro) | — |
| 13 | `0094_cost_center_posting_reports.sql` | Ventas imputadas por CC + reportes por CC | — |
| 14 | `0095_accounting_closing.sql` | `accounting_closing_runs` + simulación/ejecución de cierre | **Ejecutar cierre real** (sólo simular) |

### Bloque E — Fase 13 tarifas / billing / refundición anual
| # | Archivo | Incorpora | NO hacer aún |
|---|---|---|---|
| 15 | `0096_billable_services.sql` | Catálogo de servicios facturables | — |
| 16 | `0097_customer_service_rates.sql` | Tarifas por cliente (EXCLUDE anti-solapamiento) + `btree_gist` | — |
| 17 | `0098_billing_runs.sql` | Billing runs + items + RPCs (borradores) | — |
| 18 | `0099_logistics_pricing.sql` | Pricing logístico (simulación read-only) | — |
| 19 | `0100_billing_draft_invoice.sql` | Columnas de origen en `invoice_items` + borrador desde billing run | Emitir el borrador a ARCA (es BORRADOR) |
| 20 | `0101_annual_closing.sql` | Refundición anual (simulación + ejecución gateada) | **Ejecutar refundición real** (sólo simular) |

---

## 4. Validaciones después de cada bloque

> Cada kit es **read-only**. Correrlo entero y revisar que la columna `estado` sea `OK`
> (o `REVISAR`/`FALLO` con su explicación). Ubicación: `supabase/tests/`.

### Después de Bloque A — `ACCOUNTING_VALIDATION.sql`
- [ ] Estructura + RLS de tablas contables = `OK`.
- [ ] Plan de cuentas seedeado (≥60 cuentas) y cuentas clave resuelven.
- [ ] `accounting_rules` resuelven a cuentas (0 reglas rotas).
- [ ] `v_asientos_descuadrados` **vacío**.
- [ ] `v_balance_sumas_saldos`: Σ debe = Σ haber **y** Σ saldo deudor = Σ saldo acreedor.
- [ ] `v_comprobantes_sin_asiento`: revisar cobertura (esperable que liste documentos previos
      sin contabilizar — se resuelven con backfill **dry-run** primero).
- [ ] Libro diario / mayor responden.
- [ ] (Opcional) `select public.acc_backfill('customer_invoice', true)` → **dry-run**, no escribe.

### Después de Bloque B — `PHASE10_FISCAL_VALIDATION.sql`
- [ ] `customer_invoice_other_taxes` y `supplier_payment_withholdings` existen + RLS.
- [ ] Cuentas 2.1.12–2.1.16 creadas; reglas por tipo resuelven.
- [ ] `v_percepciones_ventas` / `v_retenciones_practicadas` responden.
- [ ] `v_posicion_fiscal_mensual` calcula.
- [ ] `v_percep_retenc_fiscal_vs_contable`: diferencias ≈ 0 (o explicadas por documentos sin asiento).

### Después de Bloque C — `PHASE11_TREASURY_VALIDATION.sql`
- [ ] Columnas `gross_amount`/`withheld_amount` + RPC nativa + vistas existen.
- [ ] La RPC vieja `tesoreria_register_payment` sigue intacta.
- [ ] **Prueba funcional (staging):** registrar un pago a proveedor con retención
      (`tesoreria_register_supplier_payment_neto`) → verificar bruto/retención/neto.
- [ ] `v_supplier_payment_detalle.balanceado = true`; `v_pagos_retencion_residual` **vacío**
      (sin residual en CxP).
- [ ] `v_pagos_tesoreria_vs_contable.dif_neto ≈ 0` (tras contabilizar el pago).

### Después de Bloque D — `PHASE12_VALIDATION.sql`
- [ ] `cost_centers.type/updated_at` + unidades de negocio sembradas.
- [ ] `customer_invoices.cost_center_id` / `treasury_movements.cost_center_id` existen.
- [ ] **EERR por CC = total general**; **mayor por CC = mayor general**.
- [ ] `v_logistics_orders_facturables/facturadas/no_facturables` responden; **0** órdenes con
      doble vínculo.
- [ ] `v_periodos_para_cierre` muestra estado correcto.
- [ ] **Simular** cierre (`acc_simulate_closing`) — **no ejecutar cierre real** salvo validación explícita.

### Después de Bloque E — `PHASE13_VALIDATION.sql`
- [ ] `billable_services`, `customer_service_rates` (con EXCLUDE), `billing_runs`/`items` existen.
- [ ] **0** tarifas activas solapadas; **0** billing run items duplicados.
- [ ] **Prueba funcional:** crear billing run → calcular recurrente → aprobar/excluir ítems →
      generar **borrador** de factura.
- [ ] Verificar que el borrador queda **`BORRADOR`** (no `AUTORIZADO_ARCA`) → **no se emitió ARCA**.
- [ ] Verificar que el borrador **no aparece** en `v_comprobantes_sin_asiento` → **no se contabilizó**.
- [ ] `v_billing_vs_factura_diff`: diferencia 0.
- [ ] `v_logistics_orders_pricing`: órdenes "no priceable" con motivo (pricing no inventa datos).
- [ ] **Simular** refundición anual (`acc_simulate_annual_closing`) — **no ejecutar real** salvo validación.
- [ ] `resultado_anual` = EERR del ejercicio.

---

## 5. Pruebas funcionales desde la UI (staging)

Navegar a la sección **Contabilidad** del sidebar. Para cada prueba, el resultado esperado:

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Entrar a `/contabilidad` | Resumen con KPIs (último período, posición IVA, balance, pendientes) |
| 2 | `/contabilidad/plan-cuentas` | Plan jerárquico (~70 cuentas), imputables marcadas |
| 3 | `/contabilidad/libro-diario` | Asientos posteados; Debe = Haber |
| 4 | `/contabilidad/balance` | Sumas y saldos cuadra (chip "Cuadra") |
| 5 | `/contabilidad/posicion-iva` y `/posicion-fiscal` | Posición mensual por período |
| 6 | `/contabilidad/percepciones-cargar` | Cargar percepción de prueba a una factura → aparece en `/percepciones-ventas` |
| 7 | `/contabilidad/pagos-retenciones` | Registrar pago con retención → muestra bruto/retención/neto; CxP del proveedor cancela por el bruto |
| 8 | `/contabilidad/retenciones` | La retención figura como deuda fiscal a depositar |
| 9 | `/contabilidad/resultado-cc` | Resultado por centro de costo (tras imputar CC a facturas) |
| 10 | `/contabilidad/ordenes-facturar` | Vincular orden logística a una factura existente → pasa a "facturada", sin duplicar |
| 11 | `/contabilidad/billing` | Crear billing run, calcular recurrente, aprobar ítems |
| 12 | `/contabilidad/billing` → "Borrador factura: <cliente>" | Crea `customer_invoice` BORRADOR (no fiscal); ítems quedan `invoiced` |
| 13 | `/contabilidad/refundicion-anual` | Simular ejercicio → muestra resultado y asiento propuesto; **no modifica datos** |
| 14 | `/contabilidad/cierre` | Períodos con flag listo/no listo; "Simular cierre" devuelve bloqueos o resultado |
| 15 | `/contabilidad/comprobantes` | Comprobantes sin asiento + backfill (simular antes de ejecutar) |

> Si algún ítem write no responde por permisos: el usuario de prueba necesita rol con
> `contabilidad.create/edit/admin` o `tesoreria.create`/`pedidos.edit` según la acción
> (RBAC 0084/0057/0053/0030).

---

## 6. Puntos de control "go / no-go"

**Avanzar al siguiente bloque sólo si el bloque actual está verde.** **NO avanzar** (no-go) si:

- ❌ Hay **asientos descuadrados** (`v_asientos_descuadrados` no vacío).
- ❌ El **balance no cuadra** (`v_balance_sumas_saldos`).
- ❌ Hay **diferencias fiscal vs contable** no explicadas (`v_iva_fiscal_vs_contable`,
  `v_percep_retenc_fiscal_vs_contable`).
- ❌ Hay **errores en vistas** (alguna vista no responde / error de columna).
- ❌ Una **migración falló** (no continuar la cadena).
- ❌ Hay **duplicación de facturación** (órdenes con doble vínculo / billing items duplicados).
- ❌ Un borrador de billing **quedó emitido** (`AUTORIZADO_ARCA`) en vez de `BORRADOR`.
- ❌ Se **contabilizó algo sin aprobación** (un BORRADOR figura contabilizado).
- ❌ Una **simulación modificó datos** (pricing/cierre/refundición deben ser read-only).
- ❌ Hay **períodos con bloqueos** y se intentó cerrar igual.

Cualquier no-go ⇒ pasar a §7 (contención).

---

## 7. Plan de contención si algo falla

Las migraciones son **aditivas** (no destructivas), por lo que la contención es
**detener y diagnosticar**, no revertir datos productivos.

1. **No seguir aplicando bloques.** Frenar en la migración que falló.
2. **Capturar el error exacto** del SQL Editor (código `SQLSTATE`, mensaje, hint).
3. **Guardar screenshot/log** del error y del estado (qué migraciones se aplicaron OK).
4. **No "arreglar" datos a mano** en la base (especialmente nunca en producción).
5. **Identificar qué migración falló** y a qué objeto (tabla/función/policy).
6. **Clasificar la causa**: estructura (objeto faltante / dependencia 0001–0081 no aplicada),
   permiso (rol sin privilegio), RLS (policy), extensión (`btree_gist`), enum
   (¿0082 corrido en la misma transacción que 0084?), o dato.
7. **Documentar el estado parcial** (qué quedó aplicado) en este runbook o en un anexo.
8. **No pasar a producción** bajo ninguna circunstancia con la cadena incompleta.
9. **Preparar un hotfix en una migración nueva separada** (no editar las ya entregadas) si el
   hallazgo lo requiere; revisarlo y volver a empezar el bloque afectado.

### 7.1. "Rollback lógico" disponible (no destructivo)
- **Asientos**: no se borran; se **revierten** con `acc_reverse_entry(entry_id, motivo)`
  (genera asiento inverso). El backfill es idempotente (no duplica).
- **Cierre de período**: `acc_reopen_period(period_id, motivo)` reabre y revierte el asiento de cierre.
- **Tesorería/recibos/pagos**: anulación lógica vía `tesoreria_void_movement` (append-only).
- **Borrador de factura**: al ser `BORRADOR` (no fiscal) puede anularse lógicamente
  (`anulada=true`) sin impacto contable.
- ⚠️ **No existe un rollback automático destructivo de las migraciones.** Si hace falta
  deshacer estructura en staging, restaurar desde el **backup** del paso 2.

---

## 8. Validaciones contables con contador (checklist)

Antes de habilitar cierres/refundición reales, el contador debe validar:

- [ ] **Plan de cuentas** (`chart_of_accounts`): codificación, aperturas, cuentas faltantes.
- [ ] **IVA Crédito Fiscal** (`1.1.05`) y **IVA Débito Fiscal** (`2.1.02`).
- [ ] **IVA Saldo a Pagar** (`2.1.03`) y criterio de la posición mensual.
- [ ] **Percepciones a depositar** (`2.1.04` IVA, `2.1.05` IIBB, `2.1.16` municipal) y
      **percepciones sufridas** (`1.1.06`/`1.1.07`).
- [ ] **Retenciones a depositar** (`2.1.06`/`2.1.12`–`2.1.15`) y **retenciones sufridas** (`1.1.08`).
- [ ] **Cuentas de ingresos** (`4.x`) — ¿desdoblar ventas por servicio/unidad de negocio?
- [ ] **Cuentas de costos/gastos** (`5.x`/`6.x`) — cuenta de gasto **default** (`6.1.10`, marcada `(*)`).
- [ ] **Reglas de imputación** (`accounting_rules`) — especialmente las marcadas `(*)`.
- [ ] **Centros de costo** / unidades de negocio (`cost_centers`).
- [ ] **Criterio de cierre mensual** (cuándo pasar período a `closed`).
- [ ] **Criterio de refundición anual** (income_statement_closing mensual → 3.2.02; anual → 3.2.01).
- [ ] **Resultado del ejercicio** (`3.2.02`) y **Resultados No Asignados** (`3.2.01`).

> El ajuste de cuentas/reglas se hace **editando `accounting_rules` y `chart_of_accounts`
> en la base** (no requiere nueva migración); re-contabilizar (reversa + repost) los asientos
> afectados.

---

## 9. Checklist antes de producción

Producción **sólo** puede considerarse si **todo** lo siguiente es verdadero:

1. [ ] Staging aplicó **0082–0101** completo, sin errores.
2. [ ] **Los 5 kits** de validación dieron `OK` (o `REVISAR` explicados y aceptados).
3. [ ] La **UI** de `/contabilidad` funciona (las 15 pruebas de §5).
4. [ ] **Balance de sumas y saldos cuadra.**
5. [ ] **0 asientos descuadrados.**
6. [ ] **0 diferencias fiscal vs contable** sin explicación.
7. [ ] **0 duplicación de facturación** (órdenes/billing).
8. [ ] El **billing run genera sólo borradores** (BORRADOR, sin ARCA).
9. [ ] El **pricing logístico no inventa datos** (no priceable con motivos).
10. [ ] La **refundición anual fue sólo simulada** (no ejecutada) en staging.
11. [ ] El **contador validó** plan de cuentas y reglas (§8).
12. [ ] **Martín aprueba explícitamente** el pase a producción.

---

## 10. Orden recomendado para producción

Cuando los 12 puntos de §9 estén cumplidos:

- **Replicar el mismo orden** de §3 (Bloques A→E, archivo por archivo). **No saltear bloques.**
- **Ventana de mantenimiento** acordada (baja probabilidad de escrituras concurrentes en
  finanzas/tesorería durante la aplicación).
- **Backup previo de producción** (restore point) inmediatamente antes.
- **Aplicar bloque por bloque** y **validar bloque por bloque** con los mismos kits (read-only).
- **No activar cierres reales ni refundición real el mismo día** del despliegue estructural:
  primero observar que la operación normal (facturar, cobrar, pagar, contabilizar) funciona.
- **Monitoreo posterior** (24–72 h): revisar `v_asientos_descuadrados`,
  `v_balance_sumas_saldos`, `v_iva_fiscal_vs_contable`, `v_pagos_retencion_residual` y
  `v_billing_vs_factura_diff` periódicamente.
- Recordatorio de prod: en producción la fuente de verdad es `arsksytgdnzukbmfgkju` (G4);
  confirmar que se aplica ahí y no en staging por error.

---

## 11. Apéndice técnico

### 11.1. Migraciones (descripción corta)
| Archivo | Descripción |
|---|---|
| 0082_accounting_enums | enum `permission_module_t += 'contabilidad'` (aislado) |
| 0083_accounting_core | plan de cuentas, períodos, asientos, partida doble, RLS/RBAC |
| 0084_accounting_seed | plan de cuentas base 3PL + reglas + permisos |
| 0085_accounting_posting | motor de asientos (ventas/compras/cobros/pagos), reversa, backfill |
| 0086_accounting_reports | diario, mayor, sumas y saldos, EERR, posición IVA, controles |
| 0087_sales_other_taxes | percepciones de venta (detalle) + RPC + cuenta 2.1.16 |
| 0088_supplier_withholdings | retenciones practicadas + RPC + cuentas 2.1.12–2.1.15 |
| 0089_phase10_posting_and_reports | asientos con percep/retenc + vistas fiscales |
| 0090_treasury_withholdings_native | pago proveedor bruto/retención/neto (RPC nativa) |
| 0091_phase11_reports_backfill | conciliación + diagnóstico residuales (read-only) |
| 0092_cost_centers_dimension | `cost_centers.type` + unidades de negocio + CC en ventas/tesorería |
| 0093_logistics_billing | vínculo `logistics_orders` → factura (sin duplicar) |
| 0094_cost_center_posting_reports | ventas por CC + reportes por CC |
| 0095_accounting_closing | cierre de período (simulación + ejecución gateada) |
| 0096_billable_services | catálogo de servicios facturables |
| 0097_customer_service_rates | tarifas por cliente (EXCLUDE anti-solapamiento, `btree_gist`) |
| 0098_billing_runs | billing runs + items + RPCs (borradores) |
| 0099_logistics_pricing | pricing logístico (simulación read-only) |
| 0100_billing_draft_invoice | origen en `invoice_items` + borrador desde billing run |
| 0101_annual_closing | refundición anual (simulación + ejecución gateada) |

### 11.2. Kits de validación (read-only)
| Kit | Bloque |
|---|---|
| `supabase/tests/ACCOUNTING_VALIDATION.sql` | A |
| `supabase/tests/PHASE10_FISCAL_VALIDATION.sql` | B |
| `supabase/tests/PHASE11_TREASURY_VALIDATION.sql` | C |
| `supabase/tests/PHASE12_VALIDATION.sql` | D |
| `supabase/tests/PHASE13_VALIDATION.sql` | E |

### 11.3. Pantallas agregadas (`/contabilidad/*`)
`/` (resumen) · `posicion-iva` · `posicion-fiscal` · `plan-cuentas` · `libro-diario` ·
`mayor` · `balance` · `resultado-cc` · `centros-costo` · `percepciones-ventas` ·
`percepciones-cargar` · `retenciones` · `pagos-retenciones` · `ordenes-facturar` ·
`servicios` · `tarifas` · `billing` · `pricing-logistica` · `cierre` ·
`refundicion-anual` · `comprobantes`.

### 11.4. RPCs principales
- **Posteo**: `acc_post_document`, `acc_post_sales_invoice`, `acc_post_purchase_invoice`,
  `acc_post_customer_receipt`, `acc_post_supplier_payment`, `acc_reverse_entry`, `acc_backfill`.
- **Fiscal**: `ventas_persist_other_taxes`, `ap_register_payment_withholdings`.
- **Tesorería**: `tesoreria_register_supplier_payment_neto`, `tesoreria_diagnose_payment_withholdings`.
- **Logistics**: `logistics_set_billing_status`, `logistics_link_invoice`, `billing_price_logistics_order`.
- **Cierre**: `acc_simulate_closing`, `acc_execute_closing` (gateada), `acc_reopen_period`,
  `acc_simulate_annual_closing`, `acc_execute_annual_closing` (gateada).
- **Billing**: `billing_run_create`, `billing_run_calculate_recurring`, `billing_run_add_item`,
  `billing_run_set_item_status`, `billing_run_set_status`, `billing_run_create_draft_invoice`,
  `customer_service_rate_for`.

### 11.5. Vistas principales
`v_libro_diario`, `v_libro_mayor`, `v_balance_sumas_saldos`, `v_estado_resultados`,
`v_posicion_iva`, `v_comprobantes_sin_asiento`, `v_asientos_descuadrados`,
`v_iva_fiscal_vs_contable`, `v_percepciones_ventas`, `v_retenciones_practicadas`,
`v_pagos_proveedor_retenciones`, `v_posicion_fiscal_mensual`,
`v_percep_retenc_fiscal_vs_contable`, `v_supplier_payment_detalle`,
`v_pagos_retencion_residual`, `v_pagos_tesoreria_vs_contable`, `v_estado_resultados_cc`,
`v_libro_mayor_cc`, `v_resultado_por_cc`, `v_logistics_orders_facturables/_facturadas/_no_facturables`,
`v_facturas_desde_ordenes`, `v_periodos_para_cierre`, `v_refundicion_simulacion`,
`v_tarifas_vigentes/_vencidas`, `v_billing_runs`, `v_billing_run_items`,
`v_servicios_recurrentes_pendientes`, `v_logistics_orders_pricing`,
`v_facturas_borrador_billing`, `v_billing_vs_factura_diff`, `v_resultado_anual`.

### 11.6. Riesgos conocidos
- **0082 en misma transacción que 0084** ⇒ error de enum. Mitigación: aplicar archivo por archivo (§2.1).
- **`btree_gist` deshabilitada** ⇒ falla 0097. Mitigación: habilitar la extensión antes.
- **Pago con retención del 100%** (neto = 0): no soportado (`check amount>0`). Caso marginal.
- **Pagos legacy** con retención cargada a la manera de Fase 10 (allocations al neto): aparecen
  en `v_pagos_retencion_residual` para corrección manual.
- **Cierre/refundición**: escriben; sólo con `confirm=true` + `contabilidad.admin`. La UI sólo
  expone **simulación**.
- **Cuentas/reglas default `(*)`**: requieren validación del contador antes de cerrar.

### 11.7. Pendientes (F14) — ver §12.

---

## 12. Pendientes F14

La siguiente fase lógica (no incluida en esta cadena) es habilitar el **pricing automático de
órdenes logísticas**, hoy imposible por falta de datos. Requiere:

- Mapear `logistics_orders` a **`client_id`** (hoy sólo hay `client_name` texto).
- Mapear cada orden logística a un **servicio facturable** (`billable_services`).
- Definir **cantidad fiscal / unidad** por servicio en la orden.
- Conectar **orden → tarifa (`customer_service_rates`) → precio** y alimentar el billing run.
- Habilitar pricing automático **sólo cuando esos datos existan** (no antes).
- **Regla dura:** nunca inventar cliente/precio/servicio desde texto libre.

Otros pendientes de cierre definitivo: ARCA en producción (emisión real de los borradores),
distribución de resultados sobre `3.2.01`, y migración de saldos de apertura del primer ejercicio.

---

*Runbook de aplicación. No constituye aplicación. Ninguna migración fue ejecutada; producción
intacta. Las migraciones las aplica Martín a mano, en orden, validando bloque por bloque.*
