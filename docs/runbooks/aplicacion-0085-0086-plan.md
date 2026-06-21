# Plan controlado de aplicación — 0085 / 0086 (+ track fiscal 0087–0089)

> **Naturaleza:** PLAN doc-first. **No aplica nada.** No ejecuta migraciones, no toca producción,
> no modifica datos. Base única: `arsksytgdnzukbmfgkju`. Aplicación real = aprobación explícita por
> migración (G7) + restore point (G4); **aplica Martín** (G1/G3).
>
> **Revisión 2** (corrige la rev. 1): la rev. 1 afirmaba "0086 requiere 0087" — **ERROR**. Diagnóstico
> corregido abajo con evidencia del repo.

## 0. Estado verificado (evidencia real — mini-probe + análisis de repo)
| Objeto / Migración | Estado | Evidencia |
|---|---|---|
| 0082–0084 (enums/núcleo/plan) | ✅ aplicadas | probes previos (`chart_of_accounts` 67/51) |
| 0102 (fix C4) | ✅ aplicada + validada | `libro_iva_compras_preliminar` = true; kit C4 OK |
| `supplier_invoice_other_taxes` | ✅ existe | mini-probe = true — **pero la crea `0056`, no `0087`** |
| **0085 (motor de posteo)** | ❌ NO aplicado | `pg_proc`: 8 funciones = false |
| **0086 (reportes)** | ❌ NO aplicado | 0086 vistas = false (`v_libro_diario`, `v_balance_sumas_saldos`, `v_estado_resultados`, etc.) |
| **0087 (`customer_invoice_other_taxes`)** | ❌ NO aplicado | mini-probe: `customer_invoice_other_taxes` = false |
| **0088 (`supplier_payment_withholdings`)** | ❌ NO aplicado | mini-probe = false |
| **0089 (vistas fiscales fase 10)** | ❌ NO aplicado | `v_pagos_proveedor_retenciones` etc. = false |

> Nota: el mini-probe pegado no capturó el estado de `v_posicion_iva` ni de algunas vistas 0089
> (`v_percepciones_ventas`, `v_retenciones_practicadas`, `v_posicion_fiscal_mensual`). Se **presumen
> false** (0086/0089 no aplicadas); confirmable en el re-probe del §7.

## 1. Diagnóstico del estado parcial ("Escenario C") — ACLARADO
El estado **no es** un `0087` corrupto/parcial. Es, simplemente:
- **Capa fiscal base (0001–0081) aplicada** — incluye `0056_ap_fiscal_detail` que crea
  `supplier_invoice_other_taxes` (con `tax_kind`). Por eso esa tabla existe.
- **Capa contable mínima (0082–0084) aplicada.**
- **Fix C4 (0102) aplicado** — único de la cadena 0085–0102 que se aplicó (fuera de orden numérico,
  pero **independiente**: solo toca vistas de `libro_iva_compras`).
- **Resto de la cadena contable/fiscal (0085–0089 … 0101) NO aplicada.**

→ La única "no-monotonía" real es **0102 aplicado antes que 0085–0101**, lo cual es inocuo (0102 no
depende de ellos). **No hay tablas de 0087/0088 a medio crear.**

## 2. Migraciones: aplicada / parcial / no aplicada
| Migración | Veredicto |
|---|---|
| 0056 (AP fiscal, crea `supplier_invoice_other_taxes`) | **APLICADA** (capa base) |
| 0082–0084, 0102 | **APLICADAS** |
| 0085, 0086, 0087, 0088, 0089 | **NO APLICADAS** (ninguna parcial) |
| 0090–0101 | NO aplicadas (fuera de este lote; scope posterior) |

**No se detecta ninguna migración parcialmente aplicada.**

## 3. Origen de `supplier_invoice_other_taxes` (punto 3)
La crea **`0056_ap_fiscal_detail.sql:114`** (`create table if not exists … supplier_invoice_other_taxes`
con `tax_kind public.ap_other_tax_t`, `jurisdiction`, `base`, `alicuota`, `importe`). **No** la crea
`0087`. `0087` crea **`customer_invoice_other_taxes`** (lado ventas) + función `ventas_persist_other_taxes`
+ cuenta `2.1.16`. Por eso `supplier_invoice_other_taxes`=true y `customer_invoice_other_taxes`=false
son **coherentes**: dos tablas distintas, de dos migraciones distintas.

## 4. Riesgo de aplicar `0087` "encima" (punto 4) — BAJO
- `0087` **no** crea `supplier_invoice_other_taxes` (no hay colisión con la tabla existente).
- La tabla que `0087` sí crea (`customer_invoice_other_taxes`) **no existe** → se crea limpia.
- `0087` usa `create table if not exists` / `on conflict do nothing` (idempotente).
→ **No se requiere hotfix de idempotencia para 0087** (ver §9). Aplicar 0087 es de bajo riesgo.

## 5. Orden seguro recomendado (punto 5)
Todas las dependencias del lote 0085–0089 ya están satisfechas por la base aplicada, así que el
**orden numérico es seguro** y se aplica **una migración por vez, validando** (G7):

```
0085 → 0086 → 0087 → 0088 → 0089
```
- **0085** (motor de posteo): depende de 0083/0084 + columnas existentes
  (`customer_invoices.percepciones/tributos`, `supplier_invoices.percepciones`,
  `customer_receipts.retention_amount` de `0053`). **Standalone.**
- **0086** (reportes): depende de `journal_entries` (0083), `libro_iva_*`,
  `supplier_invoice_other_taxes` (0056 ✓) y `customer_receipts.retention_amount` (0053 ✓).
  **NO depende de 0087/0088/0089** (verificado: 0086 no referencia `customer_invoice_other_taxes`
  ni `supplier_payment_withholdings`). Las vistas se crean aunque `journal_entries` esté vacío
  (devuelven 0 filas hasta el backfill).
- **0087 / 0088 / 0089**: track de desglose fiscal (percepciones de venta, retenciones a proveedores,
  reportes fase 10). **No** son necesarias para Asientos→Balance→EERR (Etapa 6).

### Punto 6 — ¿0085 → 0087 → 0088 → 0089 → 0086? Corrección
**No es necesario** intercalar 0087/0088/0089 antes de 0086 (0086 no los necesita). El orden
**numérico** `0085→0086→0087→0088→0089` es válido y más simple. **No hay que parcializar 0086.**

### Decisión clave — momento del BACKFILL (append-only)
`0089` (y más adelante `0094`) **reemplazan** `acc_post_sales_invoice`/`acc_post_supplier_payment`
con lógica de percepciones/retenciones desglosadas. Los asientos son **append-only** (rehacer = reversa).
Por eso:
- **Objetivo A — validar la mecánica de Etapa 6 (balance) ya:** aplicar `0085`+`0086`, hacer un
  **backfill de validación** (dry-run → real) con la lógica base de 0085. Sirve para probar que el
  balance cuadra; los asientos podrían rehacerse luego si se adopta el desglose.
- **Objetivo B — contabilidad definitiva sin re-backfill:** aplicar **toda** la cadena de posteo/
  reportes que se vaya a usar (mínimo `0085→0089`; idealmente hasta donde llegue el posteo definitivo)
  **antes** de un **único backfill definitivo**, para que los asientos nazcan con la lógica final.

**Recomendación:** decidir A vs B **antes** del backfill real. Para A, basta `0085+0086`. Para B,
aplicar el DDL `0085→0086→0087→0088→0089` (todo idempotente, sin posteo) y recién entonces backfillear
una sola vez con la lógica final.

## 7. Probes read-only adicionales antes de autorizar (punto 7)
Correr y pegar (no escriben nada):
1. **Re-confirmar 0086/0089 faltantes no capturados:** `to_regclass` de `v_posicion_iva`,
   `v_percepciones_ventas`, `v_retenciones_practicadas`, `v_posicion_fiscal_mensual`,
   `v_percep_retenc_fiscal_vs_contable`.
2. **Descartar 0087 parcial (satélites):** existencia de función `ventas_persist_other_taxes`
   (`pg_proc`) y de la cuenta `2.1.16` (`select … from chart_of_accounts where code='2.1.16'`).
   Esperado: ausentes.
3. **Descartar 0088 parcial:** función `ap_register_payment_withholdings` y cuentas `2.1.12–2.1.15`.
   Esperado: ausentes.
4. **Estado del libro contable:** `select count(*) from journal_entries;` → esperado 0
   (nada contabilizado aún).
5. **Reglas de imputación:** `select count(*) from accounting_rules;` y revisar las marcadas `(*)`
   (defaults pendientes de validar con contador) **antes** del backfill real.

## 8. Validaciones después de cada bloque (punto 8)
- **Post-0085:** `pg_proc` → 8 funciones = true; `journal_entries` sigue en 0 (el DDL no contabiliza).
- **Backfill dry-run (default `p_dry_run=true`):** `select public.acc_backfill('<tipo>', true);`
  por `customer_invoice / supplier_invoice / customer_receipt / supplier_payment`; inspeccionar el
  `jsonb` (ok, conteos, balanceo); confirmar `journal_entries` = 0.
- **Backfill real (gated):** `acc_backfill('<tipo>', false, <from>, <to>)` por tipo; tras cada uno
  `select count(*) from v_asientos_descuadrados;` → 0 (requiere 0086 aplicada para esa vista).
- **Post-0086:** las vistas existen; tras backfill: `v_comprobantes_sin_asiento` vacío;
  `v_asientos_descuadrados` vacío; **`v_iva_fiscal_vs_contable` diff 0** (engancha con Etapas 2 y 4
  ya validadas); `v_balance_sumas_saldos` Σ debe = Σ haber; ecuación Activo = Pasivo + PN + Resultado.
- **Post-0087 / 0088 / 0089 (si se aplican):** existencia de tablas/funciones/cuentas;
  vistas fiscales devuelven datos coherentes; reconciliación percep/retenc fiscal vs contable.

## 9. ¿Hotfix de idempotencia para 0087? (punto 9) — NO
No corresponde: `0087` **no** crea `supplier_invoice_other_taxes` (esa es de `0056`). La tabla que
`0087` crea no existe; y `0087` ya es idempotente (`if not exists` / `on conflict do nothing`).
**No se necesita preparar ningún hotfix.**

## 10. Recomendación final — GO / NO-GO (punto 10)
- **Aplicar el DDL de `0085`: GO (condicionado)** — es standalone, idempotente, depende solo de
  objetos ya aplicados, y **no contabiliza nada** (solo crea funciones). Condiciones: restore point
  (G4) + aprobación explícita. Riesgo técnico bajo.
- **Aplicar `0086`: GO (condicionado)** tras 0085 — no depende de 0087/0088; crea vistas (sin datos
  hasta el backfill). Mismas condiciones.
- **Backfill REAL: NO-GO todavía** — primero (a) decidir Objetivo A vs B (§6), (b) **validar las
  reglas `accounting_rules` `(*)` con el contador**, (c) correr **dry-run** y revisar. El backfill es
  append-only: rehacer implica reversa.
- **0087/0088/0089: GO (condicionado), pero opcionales para Etapa 6** — son el track de desglose
  fiscal; aplicarlas conviene **antes** del backfill solo si se elige el Objetivo B.

### Secuencia recomendada (pendiente de aprobación)
1. Re-probe §7 (confirmar ausencias) → cerrar diagnóstico.
2. Decidir **Objetivo A** (validar balance ya con 0085+0086) **o B** (cadena completa antes del backfill).
3. Aplicar `0085` → validar §8.
4. Aplicar `0086` → validar existencia.
5. (Objetivo B) aplicar `0087→0088→0089` → validar cada una.
6. Validar/ajustar `accounting_rules` con contador.
7. **Backfill dry-run → real** (gated) → validar cuadre/conciliación/balance (§8).
8. Cerrar **Etapa 6** con evidencia real (kit dedicado, a preparar tras el GATE).

---

*Plan de aplicación rev. 2. Doc-first, read-only. No constituye ejecución ni modificación de datos.
Sujeto al re-probe del §7 y a aprobación explícita por migración.*
