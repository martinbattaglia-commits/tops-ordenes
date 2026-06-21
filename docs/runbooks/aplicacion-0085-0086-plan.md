# Plan controlado de aplicación — 0085 (motor de posteo) + 0086 (reportes contables)

> **Naturaleza:** PLAN doc-first. **No aplica nada.** No ejecuta migraciones, no toca producción,
> no modifica datos. Habilita la auditoría de **Etapa 6 — Asientos → Balance** (hoy BLOQUEADA por
> `0085` no aplicada). La aplicación real requiere **aprobación explícita** de Dirección + restore
> point (G4). Base única: `arsksytgdnzukbmfgkju`.

## 0. Estado verificado actual (evidencia real)
| Migración | Estado | Fuente de evidencia |
|---|---|---|
| 0082 enums | ✅ aplicada | probe enum |
| 0083 núcleo contable | ✅ aplicada | probe `to_regclass` (5 tablas) |
| 0084 plan de cuentas | ✅ aplicada | `chart_of_accounts` 67/51 |
| 0102 fix C4 libro compras | ✅ aplicada + validada | kit C4 OK REAL |
| **0085 motor de posteo** | ❌ **VERIFICADO NO APLICADO** | `pg_proc`: 8 funciones `false` |
| **0086 reportes** | ❌ **NO APLICADA** | probe: vistas `false` |
| **0087 / 0088 (percep/retenc)** | ⚠️ **PARCIAL — a confirmar** | P4 (Etapa 5): al menos una estructura existe; **set exacto PENDIENTE (bloque 1 del mini-probe)** |

## 1. Confirmar si 0087+ están aplicadas (GATE — punto 1)
**Prerrequisito duro antes de definir el orden.** Correr el **bloque (1) del mini-probe** (existencia
`to_regclass` de objetos 0086/0087/0088/0089). Determina el escenario de orden (§3). El bloque (2)
ya confirmó `0085` no aplicada.

> ⚠️ **Estado no-monotónico posible:** `0085` no aplicada pero alguna estructura `0087/0088` sí →
> el chain se aplicó fuera de orden histórico. **No reusar números**, no “rellenar huecos”; tratar
> cada migración por su idempotencia propia.

## 2. Dependencias reales (analizadas en repo)
### 0085 — motor de posteo
Depende de: `0083` (journal_entries/lines), `0084` (chart_of_accounts/accounting_rules),
tablas fiscales/tesorería existentes, y columnas ya presentes: `customer_invoices.percepciones/tributos`,
`supplier_invoices.percepciones`, **`customer_receipts.retention_amount`** (existe desde `0053` ✓).
→ **`0085` es aplicable de forma STANDALONE ahora** (no depende de 0086/0087/0088).

### 0086 — reportes contables (8 vistas, en este orden)
`v_libro_diario` → `v_libro_mayor` → `v_balance_sumas_saldos` → `v_estado_resultados` →
**`v_posicion_iva`** → `v_comprobantes_sin_asiento` → `v_asientos_descuadrados` → `v_iva_fiscal_vs_contable`.
- La mayoría depende solo de `journal_entries` (poblado por el backfill de `0085`) + `libro_iva_*` (✓).
- **`v_posicion_iva` depende de `supplier_invoice_other_taxes` (tabla de `0087`)** y de
  `customer_receipts.retention_amount` (✓).
→ **`0086` REQUIERE que exista `supplier_invoice_other_taxes` (0087)**; si falta, la creación de
`v_posicion_iva` falla y (al correr el script completo) **aborta toda la migración**.

### 0089 — fuera de este lote
Reemplaza `acc_post_sales_invoice`/`acc_post_supplier_payment` con versiones percep/retenc y depende
de `0087`+`0088`. **No** se incluye en este plan (0085+0086); se evalúa por separado.

## 3. Orden seguro de aplicación (punto 3) — condicional al GATE §1
- **Escenario A — `supplier_invoice_other_taxes` EXISTE** (0087 ya aplicada):
  `0085` → `0086`. (Dependencia de `v_posicion_iva` satisfecha.)
- **Escenario B — NO existe:**
  `0085` → **`0087`** (y `0088` si luego se quiere `0089`) → `0086`.
  Cada una idempotente; aplicar y validar **una por vez** (G7).
- En ambos: **`0085` primero** (standalone, habilita el backfill que puebla los asientos que `0086` reportará).

## 4. Validaciones post-0085 (read-only, punto 4)
1. **Existencia:** `pg_proc` → las 8 funciones (`acc_post_document`, `acc_backfill`,
   `acc_post_sales_invoice`, `acc_post_purchase_invoice`, `acc_post_customer_receipt`,
   `acc_post_supplier_payment`, `acc_reverse_entry`, `acc_create_posted_entry`) = `true`.
2. **Sin asientos aún:** `select count(*) from journal_entries;` → 0 (el DDL no contabiliza nada).

## 5. Backfill en dry-run primero (punto 6) — SÍ
`acc_backfill(p_source_type text, p_dry_run boolean default true, p_from date, p_to date)` —
**el default es `dry_run=true`**. Procedimiento:
1. **Dry-run por tipo** (no escribe): `select public.acc_backfill('customer_invoice', true);`
   e ídem `'supplier_invoice'`, `'customer_receipt'`, `'supplier_payment'`. Inspeccionar el `jsonb`
   devuelto (`ok`, conteos, balanceo) sin commitear.
2. Confirmar `journal_entries` sigue en 0 tras los dry-runs.
3. **Backfill real (gated, tras OK):** `select public.acc_backfill('<tipo>', false, <from>, <to>);`
   por tipo, en orden: `customer_invoice` → `supplier_invoice` → `customer_receipt` → `supplier_payment`.
4. Tras cada tipo: `select count(*) from v_asientos_descuadrados;` → debe ser 0.

> ⚠️ **Pre-backfill:** los asientos usan los defaults de `accounting_rules` marcados `(*)` (imputación
> pendiente de validar con contador). **Revisar/validar esas reglas ANTES del backfill real**, porque
> generan asientos posteados (append-only; corregir luego implica reversa).

## 6. Validaciones post-0086 (read-only, punto 5)
1. **Existencia:** 8 vistas de `0086` = `true` (en escenario B sin 0087, `v_posicion_iva` no se crea
   → tratar como NO_APLICADA, no falla).
2. **Cobertura:** `v_comprobantes_sin_asiento` → idealmente **vacío** tras backfill (todo documento
   fiscalmente válido tiene asiento).
3. **Partida doble:** `v_asientos_descuadrados` → **vacío**.
4. **Conciliación fiscal↔contable:** `v_iva_fiscal_vs_contable` → diff **0** (IVA débito contable =
   `libro_iva_ventas` Etapa 4 ✓; IVA crédito contable = `libro_iva_compras` Etapa 2 ✓).
5. **Balance:** `v_balance_sumas_saldos` → Σ debe = Σ haber; ecuación Activo = Pasivo + PN + Resultado.
6. Recién con (2)–(5) en verde se puede **cerrar Etapa 6** con evidencia real.

## 7. Pre-aplicación y gobernanza
- **Restore point / backup** en `arsksytgdnzukbmfgkju` (G4) antes de cualquier `apply`.
- **Aviso al contador** (los asientos materializan imputaciones; el backfill es masivo).
- **Aprobación explícita** por migración (G7: una fase por vez, validar, luego la siguiente).
- El asistente **prepara y muestra**; **aplica Martín** (G1/G3). Prohibido `supabase db push`.

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| `0086` falla por `supplier_invoice_other_taxes` ausente | GATE §1; escenario B aplica `0087` primero |
| Backfill masivo (volumen de asientos) | dry-run + por tipo + por rango de fechas (`p_from/p_to`) |
| Doble contabilización | índice `je_source_unique` (1 asiento activo por documento) — idempotente |
| Imputaciones `(*)` sin validar | validar `accounting_rules` con contador **antes** del backfill real |
| Asiento en período cerrado | el trigger `check_journal_entry_balanced` rechaza períodos closed/locked |
| Estado no-monotónico (0085 ✗ / 0087 ?) | confirmar con bloque (1); no reusar números; idempotencia por migración |

## 9. Resumen ejecutable (pendiente de aprobación)
1. **(GATE)** correr bloque (1) del mini-probe → definir escenario A/B.
2. Aplicar **`0085`** → validar §4 (8 funciones, journal_entries=0).
3. **Dry-run** backfill por tipo → inspeccionar (§5.1–5.2).
4. Validar/ajustar `accounting_rules` con contador.
5. **Backfill real** por tipo → `v_asientos_descuadrados` vacío (§5.3–5.4).
6. **(Escenario B)** aplicar `0087` (y `0088` si aplica) → validar.
7. Aplicar **`0086`** → validar §6 (cobertura, cuadre, conciliación, balance).
8. **Cerrar Etapa 6** con evidencia real (kit dedicado, a preparar tras el GATE).

---

*Plan de aplicación. Doc-first, read-only. No constituye ejecución ni modificación de datos.
Sujeto a confirmación del bloque (1) del mini-probe y a aprobación explícita por migración.*
