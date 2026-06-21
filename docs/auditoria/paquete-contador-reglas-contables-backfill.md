# Paquete para el contador — Validación de reglas de imputación antes del backfill

> **Naturaleza:** documentación pura. No modifica datos, no aplica migraciones, no contabiliza.
> Destinado a la **revisión profesional del contador** de las 5 reglas de imputación provisorias
> antes de generar los asientos históricos (backfill) en la base única `arsksytgdnzukbmfgkju`.
> **Estado:** ningún asiento generado aún (`journal_entries = 0`). Es el momento correcto para decidir.

---

## 1. Resumen ejecutivo

El sistema (TOPS NEXUS) ya tiene **instalada y validada la capa contable**:
- **Motor de asientos automáticos** (`0085`) — genera el asiento por partida doble de cada
  comprobante, configurable por reglas de imputación.
- **Vistas contables** (`0086`) — libro diario, mayor, balance de sumas y saldos, estado de
  resultados, posición de IVA, conciliación fiscal↔contable.

**Todavía no hay asientos históricos:** no se corrió el *backfill* (la operación que recorre los
comprobantes y los contabiliza). Antes de hacerlo se requiere **validación profesional de 5 reglas
de imputación** marcadas como provisorias `(*)`, porque definen **a qué cuenta** va cada asiento.

El **backfill real está bloqueado** hasta: (a) validar estas reglas con el contador, (b) completar
la infraestructura de posteo hasta `0094`, (c) correr un dry-run final, (d) aprobación explícita.

---

## 2. Estado actual verificado (evidencia real sobre la base productiva)

| Ítem | Estado |
|---|---|
| `0085` (motor de posteo) | ✅ OK REAL (8 funciones instaladas) |
| `0086` (vistas contables) | ✅ OK REAL (8 vistas instaladas) |
| Comprobantes pendientes de contabilizar | **27** |
| Importe total pendiente | **$ 85.066.531,50** |
| `journal_entries` (asientos) | **0** |
| `journal_entry_lines` (líneas) | **0** |
| Libro diario (`v_libro_diario`) | **vacío** |
| Balance de sumas y saldos | **sin movimiento** (debe = haber = 0) |
| Asientos descuadrados | **0** |
| Reglas de imputación `(*)` en revisión | **5 de 18** |

---

## 3. Las 5 reglas a validar

| # | Tipo de comprobante | Regla | Cuenta actual | Tipo de asiento que afecta |
|---|---|---|---|---|
| 1 | Venta (`customer_invoice`) | `revenue` | `4.1.05` Ventas - Servicios Logísticos | Imputación del **ingreso** (neto gravado) de cada factura de venta |
| 2 | Venta (`customer_invoice`) | `percepciones_a_depositar` | `2.1.04` Percepciones IVA a depositar | **Pasivo** por percepciones que TOPS practica (agente de percepción) |
| 3 | Venta (`customer_invoice`) | `otros_tributos_a_depositar` | `2.1.10` Otros Tributos a depositar | **Pasivo** por otros tributos facturados |
| 4 | Compra (`supplier_invoice`) | `expense` | `6.1.10` Otros Gastos Operativos | Imputación del **gasto/costo** (neto) de cada factura de proveedor |
| 5 | Compra (`supplier_invoice`) | `percepciones_sufridas` | `1.1.06` Percepciones IVA sufridas | **Activo** (crédito a computar) por percepciones sufridas en compras |

**Detalle por regla:**

**Regla 1 — `customer_invoice.revenue → 4.1.05`**
- Cuenta actual: Ventas - Servicios Logísticos (ingreso operativo).
- Por qué `(*)`: es un **default**; concentra **todas** las ventas gravadas en una sola cuenta.
- Riesgo de dejarla así: Estado de Resultados **grueso** (no distingue tipos de ingreso a nivel cuenta).
- **Pregunta al contador:** ¿alcanza una cuenta general de ingresos, o deben separarse por tipo de servicio?

**Regla 2 — `customer_invoice.percepciones_a_depositar → 2.1.04`**
- Cuenta actual: Percepciones IVA a depositar (pasivo).
- Por qué `(*)`: asume que las percepciones de venta son **de IVA**.
- Riesgo: si hubiera percepciones de otra naturaleza (IIBB/municipal), quedarían mal clasificadas.
- **Pregunta al contador:** ¿las percepciones que TOPS practica son de IVA? ¿Hay de otro tipo?

**Regla 3 — `customer_invoice.otros_tributos_a_depositar → 2.1.10`**
- Cuenta actual: Otros Tributos a depositar (pasivo).
- Por qué `(*)`: cuenta "cajón" para el campo `tributos` de la factura.
- Riesgo: mezcla conceptos si hay tributos heterogéneos.
- **Pregunta al contador:** ¿qué tributos cubre y necesita cuenta propia alguno?

**Regla 4 — `supplier_invoice.expense → 6.1.10`**
- Cuenta actual: Otros Gastos Operativos (gasto).
- Por qué `(*)`: default; concentra **todo** el neto de compras en una sola cuenta de gasto.
- Riesgo: **es la más sensible** — un Estado de Resultados sin desglose de costos/gastos por naturaleza.
- **Pregunta al contador:** ¿alcanza para un MVP, o debe imputarse por naturaleza del gasto?

**Regla 5 — `supplier_invoice.percepciones_sufridas → 1.1.06`**
- Cuenta actual: Percepciones IVA sufridas (activo, crédito a computar).
- Por qué `(*)`: asume percepciones sufridas **de IVA**.
- Riesgo: si hay percepciones de IIBB/otras, el crédito quedaría mal clasificado.
- **Pregunta al contador:** ¿son de IVA? ¿Separar por jurisdicción/tipo?

---

## 4. Análisis de implicancia contable

### Ventas — `customer_invoice.revenue → 4.1.05`
Actualmente **todas** las ventas gravadas se imputarían a una **cuenta general** de ingresos por
servicios logísticos.

**Preguntas para el contador:**
- ¿Alcanza usar una cuenta general de ingresos?
- ¿O debe separarse por tipo de ingreso? Cuentas disponibles en el plan:
  almacenaje cargas generales (`4.1.01`), almacenaje ANMAT (`4.1.02`), alquiler de oficinas
  (`4.1.03`), coworking (`4.1.04`), servicios logísticos (`4.1.05`), transporte / distribución
  (`4.1.06`), no gravadas / exentas (`4.1.07`).

### Compras / Gastos — `supplier_invoice.expense → 6.1.10`
Actualmente el **neto de compras/proveedores** se imputaría a una **cuenta general** de otros
gastos operativos.

**Preguntas para el contador:**
- ¿Alcanza para un MVP contable?
- ¿O debe imputarse por **naturaleza**? Cuentas disponibles:
  costo de servicios logísticos (`5.1.01`), costo de transporte (`5.1.02`), costo de depósito
  (`5.1.03`), costo de personal operativo (`5.1.04`), gastos de administración (`6.1.01`),
  comerciales (`6.1.02`), sueldos y jornales (`6.1.03`), cargas sociales (`6.1.04`), servicios
  públicos (`6.1.05`), seguridad (`6.1.06`), mantenimiento (`6.1.07`), honorarios (`6.1.08`),
  seguros (`6.1.09`), otros (`6.1.10`), impuestos/tasas (`6.1.11`), gastos bancarios (`6.1.12`).

### Percepciones / tributos
- `percepciones_a_depositar` (venta, pasivo `2.1.04`) — percepciones que TOPS practica.
- `otros_tributos_a_depositar` (venta, pasivo `2.1.10`) — otros tributos facturados.
- `percepciones_sufridas` (compra, activo `1.1.06`) — percepciones que TOPS sufre.

**Preguntas para el contador:**
- ¿La cuenta actual corresponde a **IVA**?
- ¿Hay que separar **IVA / IIBB / municipal / otros**?
- ¿Hay que **crear cuentas específicas** antes del backfill?

---

## 5. Matriz de decisión A / B / C

### A — Mantener reglas actuales y hacer backfill MVP **ya**
- **Estado: NO recomendado ahora.**
- Motivo: el backfill real está **postergado** por la decisión "Objetivo B" hasta `0094`. Además deja
  un P&L **correcto pero grueso** (cuenta única de ingreso y de gasto).

### B — Afinar reglas **antes** del backfill
- **Estado: recomendado SI el contador exige desglose por cuenta.**
- Aclaración técnica importante: el modelo actual `accounting_rules` mapea **una sola cuenta** por
  `(source_type, rule_key)`. **No permite por sí solo** separar ventas por servicio ni compras por
  naturaleza (eso necesitaría una regla por categoría o imputación por línea → **extensión de modelo**).
- Es decir: "afinar la regla" cambia *a qué única cuenta* va todo, pero **no** desglosa.

### C — Mantener reglas, aplicar hasta `0094`, usar centro de costo, **luego** backfill
- **Estado: recomendación técnica actual.**
- Motivo: las **compras ya llevan `cost_center_id`** en el asiento; las **ventas reciben centro de
  costo con `0094`**. Permite **análisis por centro de costo** (rentabilidad por unidad de negocio)
  aunque las cuentas sean generales. Evita reversas/reposteos por backfillear antes de la lógica final.

---

## 6. Qué resuelve `0094`
- Agrega/consolida el **centro de costo en las ventas** (hoy el asiento de venta no lo lleva).
- Habilita `v_estado_resultados_cc` → **Estado de Resultados por centro de costo**.
- Permite ver **rentabilidad por centro de costo / unidad de negocio**.
- Aporta **dimensión analítica** sin remapear cuentas.

## 7. Qué NO resuelve `0094`
- **No** separa automáticamente las ventas por tipo de servicio **a nivel cuenta contable**.
- **No** separa las compras por naturaleza **a nivel cuenta contable**.
- **No** define por sí solo los criterios contables (eso es decisión profesional del contador).
- **No** reemplaza la validación profesional de las reglas.

---

## 8. Recomendación para el contador

**Opción recomendada:**
- **Aprobar provisionalmente las 5 reglas** para un primer backfill controlado, **siempre que se
  acepte** un Estado de Resultados por **cuenta general + dimensión de centro de costo** (vía `0094`).

**Opción alternativa:**
- Si se requiere un **P&L formal por cuentas específicas** (ingresos por servicio / gastos por
  naturaleza), **diseñar una extensión del modelo de imputación antes del backfill real** (reglas por
  categoría o imputación por línea), para no contabilizar con criterio grueso y luego tener que rehacer.

---

## 9. Decisión requerida (marcar)

- [ ] Apruebo reglas actuales para backfill MVP.
- [ ] Apruebo reglas actuales **solo si** se aplica hasta `0094` y se usa centro de costo.
- [ ] **No apruebo:** requiero desglose por cuenta antes del backfill.
- [ ] Requiero **cuentas separadas** para percepciones / tributos (IVA / IIBB / municipal).
- [ ] Requiero **modificar el plan de cuentas**.
- [ ] Requiero **revisar facturas / proveedores específicos** antes del backfill.

_Observaciones del contador:_

> ________________________________________________________________

---

## 10. Próximos pasos según la decisión

**Si aprueba** (reglas actuales / opción C):
1. Aplicar la infraestructura de posteo hasta `0094` (migraciones idempotentes, una por vez, gated).
2. Correr el **dry-run final** de `acc_backfill` (no escribe).
3. Revisar diferencias (cobertura, cuadre, conciliación fiscal vs contable).
4. **Autorizar el backfill real** (recién entonces nacen los asientos).

**Si no aprueba** (requiere desglose por cuenta):
1. Diseñar la **extensión del modelo de imputación** (reglas por categoría / por línea).
2. Crear las **nuevas reglas** (y cuentas si hicieran falta), editando `accounting_rules` / plan.
3. **Validar nuevamente** con el contador.
4. Recién después: dry-run → backfill.

---

## 11. Cierre

- **No se generó ningún asiento todavía** (`journal_entries = 0`).
- **No hay impacto contable irreversible**: nada está contabilizado.
- **Este es el momento correcto para decidir las reglas.**
- **Después del backfill**, cambiar el criterio de imputación implica **reversar y repostear**
  (los asientos son append-only). Por eso se valida **antes**.

---

*Documento para revisión profesional del contador. No constituye asesoramiento contable ni
ejecución. No modifica datos ni contabiliza. Las cuentas y reglas citadas son del plan de cuentas
y de `accounting_rules` vigentes en la base, verificados al momento de redacción.*
