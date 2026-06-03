# TOPS NEXUS — GATE 4C IMPLEMENTATION READINESS REPORT

> 🟢 **ACTUALIZACIÓN 2026-06-03 — BLOQUEANTE #3 RESUELTO · GATE 4C = READY TO CODE.**
> Mini-Gate 4B.1 (`anular_packing_unit`) quedó **VALIDADO y CERRADO** (migración `0034_wms_packing_cancel.sql`
> + kit `gate4b1_cancel_validation_report.sql`, 0 footprint). El Bloqueante #3 (decisión/código de packing)
> está **cerrado por la vía (a)** — RPC dedicada, sin excepciones ocultas en `confirm_dispatch`.
> **Renumeración definitiva:** `0034` = Packing Cancel (4B.1) · `0035` = Dispatch (4C).
> Quedan **solo los 2 gates operativos** (Backup + PITR), que se confirman al momento de aplicar — no
> bloquean el inicio de la **codificación** de 4C. El veredicto histórico de auditoría se conserva abajo
> como registro; el estado vigente es **READY TO CODE**. Ver `GATE_4B1_CLOSURE_REPORT.md`.
>
> Auditoría técnica de preparación para implementación. **Modo READ ONLY.**
> No se escribió SQL/TS/React/migraciones/RPC/UI. No se modificaron archivos. No commits/push/deploy.
> Fecha: 2026-06-03. Auditor: Arquitecto Principal (rol). Repo: `~/CODE/tops-ordenes`.
> Verificado contra: estado git real, migraciones `0001`–`0033` en disco+git, y los 5 documentos obligatorios.

---

## Alcance y método

Verificación basada en **fuentes que el repo permite leer**: git (`status`/`log`/`rev-list`/`branch`),
el árbol de migraciones (SQL como fuente de verdad del esquema, triggers y RPC) y los documentos de handoff.

> **Límite declarado honestamente:** la base Supabase (`arsksytgdnzukbmfgkju`) **no se consultó** —
> es DEV/PROD compartida y este entorno no tiene tool de ejecución SQL. Por lo tanto, los puntos que
> dependen de **estado de filas vivas** (cantidad real de bultos vacíos colgados; saldo actual de
> `G-001`; existencia de PITR/último backup en el dashboard) quedan marcados como **NO VERIFICABLES
> desde el repo** y se elevan como pre-condiciones operativas a confirmar por Martín antes de migrar.

---

## 1. Estado Git

| Ítem | Resultado | Estado |
|---|---|---|
| Working tree limpio | **1 archivo untracked**: `docs/handoff/GATE_4C_DISPATCH_DESIGN.md` | ⚠️ casi-limpio |
| Branch actual | `main` | ✅ |
| HEAD | `3b1b3a6` — `fix(tracking): ingest de Traccar vía token` (2026-06-03 17:10) | ✅ |
| origin/main | `3b1b3a6` (idéntico a HEAD) | ✅ |
| Ahead / Behind | `0` ahead · `0` behind | ✅ sincronizado |
| Ramas de backup | `backup/main-pre-fullmerge-20260530`, `backup/main-wms-gate4b-20260603`, `deploy/safe-sections` | ✅ |

**Lectura:** Git en excelente estado. `main` ↔ `origin/main` perfectamente sincronizados (resuelve el
riesgo histórico "main sin push" del MASTER_HANDOFF). Existe backup específico **post-Gate 4B**
(`backup/main-wms-gate4b-20260603`), red de seguridad correcta para arrancar 4C.

**Observación (no bloqueante):** el único untracked es el **propio documento de diseño aprobado de 4C**,
que aún **no está commiteado**. Conviene versionarlo (junto con este reporte) antes de tocar código, para
que la "fuente de verdad aprobada" viva en git. No es deuda técnica de código.

---

## 2. Cadena de migraciones

**Conteo:** 31 archivos en disco = 31 versionados en git. `git status` sobre `supabase/migrations/` = vacío
(ninguna migración modificada ni sin commitear).

**Cadena WMS (foco de la auditoría):**

| Mig. | Archivo | Líneas | Crea / Define | Depende de |
|---|---|---|---|---|
| 0024 | `wms_inventory.sql` | 82 | `inventory_items`, `inventory_lots` | 0020 (positions) |
| 0025 | `wms_receptions.sql` | 176 | `receptions`, `reception_items`, enums recepción | 0024 |
| 0026 | `inventory_movements.sql` | 87 | **ledger** + trigger inmutabilidad + `movement_type_t`/`movement_reference_t` | 0024 |
| 0027 | `wms_functions.sql` | 297 | `confirm_reception`, `release_quarantine`, `confirm_movement` + lockdown RLS | 0024/0025/0026 |
| 0029 | `pedidos_permission_module.sql` | 16 | módulo RBAC pedidos | 0009 (rbac) |
| 0030 | `logistics_orders.sql` | 225 | `logistics_orders`, `logistics_order_items`, `stock_allocations` + **enums terminales 4C congelados** | 0024 |
| 0031 | `pedidos_functions.sql` | 274 | `allocate_order` (FEFO), `release_allocation`, `cancel_order` | 0030/0024 |
| 0032 | `wms_picking.sql` | 286 | RPC picking + `wms_pick_recompute_line` | 0030/0031 |
| 0033 | `wms_packing.sql` | 552 | `packing_units`, `packing_unit_items`, `packing_status_t`, 6 RPC + `wms_pack_recompute` | 0030/0031/0032 |

**Integridad:**
- ✅ **Orden secuencial** correcto; cada migración depende solo de anteriores (sin forward-deps).
- ✅ **Gaps `0012` y `0028` intencionales** (histórico / Digital Twin v2 bloqueado), confirmados; no rompen la cadena.
- ✅ **Sin conflictos:** ninguna migración posterior altera destructivamente tablas/funciones previas; el
  patrón es estrictamente aditivo + idempotente (`create ... if not exists`, `create or replace`).
- ✅ **Enums terminales de 4C ya congelados en 0030/0033** (`alloc_status_t.despachada`,
  `order_item_status_t.despachado`, `logistics_order_status_t.despachado/entregado`,
  `packing_status_t.despachada`) — 4C los **consume**, no los crea. Sin choque de enum.
- ✅ **Nada de 4C existe aún:** no hay definición real de `shipments` / `shipment_status_t` /
  `confirm_dispatch` / `confirm_delivery` (solo menciones en comentarios de 0027/0032). Slate limpio para `0034`.

**Veredicto sección 2:** cadena **íntegra, ordenada, versionada y sin conflictos**. Lista para `0034`.

---

## 3. Ledger (`inventory_movements`)

**Trigger de inmutabilidad (0026:54-71):** ✅ INTACTO.
- `prevent_inventory_movement_mutation()` → `RAISE` con `errcode=restrict_violation`.
- `trg_inventory_movements_immutable` BEFORE **UPDATE/DELETE** FOR EACH ROW.
- `trg_inventory_movements_no_truncate` BEFORE **TRUNCATE** FOR EACH STATEMENT.
- Garantía dura para **todos los roles** (incluido `service_role`, que bypassa RLS).
- ✅ **Ninguna migración posterior (0027/003x) altera, dropea ni deshabilita** el trigger.

**Comportamiento actual de los movimientos (vía RPC `SECURITY DEFINER`):**

| Tipo | RPC / rama | Efecto en stock | Asiento ledger |
|---|---|---|---|
| **ingreso** | `confirm_reception` (0027) | `+stock_available` (o `+stock_reserved` si cuarentena); find-or-create `inventory_lots` (acumula) | `ingreso`, `reference='recepcion'` |
| **traslado** | `confirm_movement` rama traslado (0027:257) | cambia `position_id`, stock sin cambio | `traslado` |
| **ajuste** | `confirm_movement` rama ajuste / `release_quarantine` | delta `stock_available` (o shift bucket) | `ajuste` |
| **egreso** | `confirm_movement` rama egreso (0027:271) | **`-stock_available`** | `egreso`, `to_position=null` |

**Lockdown RLS (0027:29-35):** las policies de INSERT de `inventory_items`/`inventory_lots`/
`inventory_movements` fueron **dropeadas a propósito** → esas tablas son escribibles **solo** por RPC
`SECURITY DEFINER` (owner, bypass RLS). El trigger sigue cubriendo UPDATE/DELETE/TRUNCATE. Arquitectura
consistente y **compatible con 4C** (un `confirm_dispatch` SECURITY DEFINER podrá INSERTAR `egreso`).

### Incompatibilidades detectadas con el diseño de Gate 4C

| # | Hallazgo | Severidad | Impacto en 4C |
|---|---|---|---|
| **L1** | **El `egreso` actual de `confirm_movement` decrementa `stock_available`, NO `stock_reserved`.** Pero la mercadería despachable vive en `stock_reserved` (allocations `empacada`). | 🔴 Crítico (de diseño) | **Confirma la decisión del diseño 4C:** NO reutilizar la rama `egreso` de `confirm_movement`. `confirm_dispatch` debe implementar egreso `reserved→0` inline. Ya contemplado (diseño §5.4, R3). **No es un defecto del repo; es una restricción correctamente entendida.** |
| **L2** | **El `egreso` actual NO decrementa `inventory_lots.quantity`** (gap "FEFO split por lote" diferido desde Gate 2). | 🟠 Medio | Es exactamente lo que 4C debe cerrar (diseño §10). `inventory_lots` tiene `quantity numeric default 0` → admite decremento a 0 sin borrar fila. Compatible. |
| **L3** | **`confirm_movement` valida la referencia `'despacho'` como no-op** (`v_exists := true`, 0027:243, "shipments aún no existe"). | 🟡 Bajo | Cuando exista `shipments`, esa validación podría endurecerse (aditivo). **No bloquea** 4C porque el diseño encapsula el egreso en `confirm_dispatch`, no en `confirm_movement`. Mejora opcional. |

**Veredicto sección 3:** ledger **inmutable, intacto y arquitectónicamente compatible** con 4C. Las tres
observaciones (L1-L3) **ya están correctamente resueltas en el diseño** de `GATE_4C_DISPATCH_DESIGN.md`;
ninguna es un defecto del repositorio.

---

## 4. Packing (`packing_units` / `packing_unit_items`)

**Esquema (0033):** ✅ completo y cerrado.
- `packing_units` (`BLT-` por trigger, `status packing_status_t`, FK `order_id`).
- `packing_unit_items` (`unique(allocation_id)` = 1 reserva → 1 bulto).
- 6 RPC: `create_packing_unit`, `pack_allocation`, `unpack_allocation`, `close_packing_unit`,
  `reopen_packing_unit`, `confirm_packing_order` + helper `wms_pack_recompute`.
- Forward-guards 4C ya instalados: `unpack`/`reopen` bloqueados sobre `despachada`.

**`anular_packing_unit`:** ❌ **NO EXISTE** (confirmado por grep en todas las migraciones). No hay RPC de
anulación de bulto en ninguna parte del repo.

### Impacto del problema `anular_packing_unit` sobre 4C

- Un **bulto vacío `abierta`** no se puede cerrar (`close` exige ≥1 ítem) **ni anular** → queda **trabado**.
- El diseño 4C resolvió **D1 = A**: `confirm_dispatch` exige que **todos los bultos no anulados del
  pedido estén `cerrada`**. **Un solo bulto vacío trabado en un pedido bloquearía su despacho.**
- ⚠️ **NO VERIFICABLE desde el repo:** cuántos bultos vacíos colgados existen hoy en la DB (requiere
  consulta a la base compartida). El MASTER/HANDOFF los reporta como footprint de demos E2E (`BLT-*` vacíos
  colgados de pedidos cancelados), severidad Baja, pero **su existencia real no se pudo contar aquí**.

**¿Debe resolverse antes de Gate 4C?** → **SÍ, debe quedar resuelto o formalmente neutralizado**, en una
de dos formas (decisión requerida antes de codear):
- **(a)** Implementar `anular_packing_unit()` como mini-gate **4B.1** (RPC additive: `abierta → anulada`
  para bultos sin ítems), **o**
- **(b)** Adoptar explícitamente en el diseño de `confirm_dispatch` la regla **"ignorar bultos `anulada`
  y bultos `abierta` sin ítems"** al evaluar D1 (el diseño ya lo menciona como alternativa en R1, pero
  **no está formalizado** como contrato de la RPC).

Mientras D1=A esté vigente y exista (o pueda existir) un bulto vacío trabado **sin** vía de salida, hay
un **camino de despacho bloqueable**. Es el principal pendiente funcional de 4C.

**Veredicto sección 4:** esquema de packing listo; **`anular_packing_unit` es un prerrequisito abierto**
de D1 que debe decidirse (a o b) antes de escribir 4C.

---

## 5. Reserva y FEFO (`stock_allocations` / `inventory_items` / `inventory_lots`)

**`stock_allocations` (0030):** `order_item_id`, `inventory_item_id` (RESTRICT), `lot_number` (nullable),
`quantity`, `status alloc_status_t`, `reserved_at`/`released_at`. Lockdown RLS (escritura solo RPC, 0031).

**`inventory_lots` (0024):** identidad `(inventory_item_id, lot_number, expiration_date)`,
`quantity numeric default 0`, `active`. `lot_number NOT NULL` en la tabla, pero un ítem puede **no tener
ninguna fila de lote** (caso `G-001`).

**FEFO actual (`allocate_order`, 0031):**
- ✅ FEFO **a nivel ítem**: candidatos `(client_name, sku)` con `stock_available > 0` ordenados por
  `min(expiration_date) asc nulls last`, `FOR UPDATE`.
- ✅ Guarda en `stock_allocations.lot_number` un **lote FEFO representativo** (el más próximo a vencer del
  ítem, `order by expiration_date asc nulls last limit 1`) — **trazabilidad**, no compromiso de stock por lote.
- ✅ Shift de bucket `available → reserved`; **no** escribe ledger; **no** decrementa `inventory_lots`.

### Impacto del diseño FEFO multi-lote de Gate 4C

| # | Hallazgo | Estado |
|---|---|---|
| **F1** | El `lot_number` de la allocation es **un único lote representativo**; **no puede expresar un split multi-lote**. | ✅ El diseño 4C lo asume: `confirm_dispatch` **re-resuelve FEFO real** sobre `inventory_lots` al egresar y decrementa **lote a lote** (multi-asiento). Correcto (§10). |
| **F2** | `inventory_lots.quantity` admite decremento a 0 (default 0, sin auto-delete). | ✅ Compatible con el decremento FEFO de 4C. |
| **F3** | Ítem sin lotes (`G-001`): allocation con `lot_number = null`. | ✅ D3=C (híbrida): egreso decrementa solo `stock_reserved`, ledger con `lot_number null`. Tolerado por el diseño. |
| **F4** | Riesgo de incoherencia `Σ inventory_lots.quantity < stock_reserved` del ítem (datos legacy). | ⚠️ El diseño define guard de aborto (§10, §12.12), pero **la coherencia real de datos NO es verificable desde el repo** — depende del estado vivo de la DB. A validar en el kit SQL antes de PROD. |
| **F5** | Gate 3 (reserva) **NO se reabre**: FEFO multi-lote se materializa solo en el egreso. | ✅ D5=A. Aditivo, no toca `allocate_order`. |

**Veredicto sección 5:** el modelo de reserva/FEFO es **compatible** con el FEFO multi-lote de 4C, que es
**aditivo** (se materializa en `confirm_dispatch`, sin tocar Gate 3). El único punto a validar empíricamente
es la **coherencia stock↔lotes** (F4), que se cubre con el kit SQL y **no es verificable en esta auditoría**.

---

## 6. Matriz de riesgos

| Riesgo | Severidad | Probabilidad | Mitigación |
|---|---|---|---|
| **DEV/PROD comparten la misma DB** (`arsksytgdnzukbmfgkju`); 4C escribe el primer egreso irreversible | 🔴 Crítica | Alta | Kit SQL **0 footprint** (`BEGIN/ROLLBACK` + sentinel). E2E **solo** con pedido `Test-*` desechable. **Backup + PITR obligatorios antes de aplicar `0034`.** Un egreso de prueba mal hecho solo se revierte por PITR. |
| **PITR no confirmado** (no verificable desde el repo) | 🔴 Crítica | Media | **Bloqueante operativo:** confirmar PITR habilitado en el dashboard Supabase y anotar timestamp pre-migración **antes** de cualquier WRITE de 4C. |
| **Backup previo no confirmado** (no verificable desde el repo) | 🔴 Crítica | Media | **Bloqueante operativo:** snapshot lógico pre-`0034` registrado en `SUPABASE_BACKUP_CHECKLIST.md` antes de migrar. |
| **Egreso sobre bucket equivocado** (`available` en vez de `reserved` — hallazgo L1) | 🔴 Alta | Baja | Diseño ya lo resuelve: egreso inline en `confirm_dispatch` sobre `stock_reserved`; NO reutilizar `confirm_movement`. Caso de prueba dedicado en el kit. |
| **Reversión que viola inmutabilidad del ledger** | 🔴 Alta | Baja | Reversión = asientos `ingreso` compensatorios **nuevos** (nunca UPDATE/DELETE). El trigger lo garantiza a nivel DB. Diseño §13. |
| ~~**`anular_packing_unit` ausente**~~ → ✅ **RESUELTO (4B.1, `0034`, validado)** | 🟢 Cerrado | — | RPC `anular_packing_unit` Empty-only implementada y validada. D1=A satisfacible. |
| **FEFO multi-lote: incoherencia stock↔lotes** (F4) | 🟠 Media | Baja | Guard de aborto en `confirm_dispatch` (no egreso parcial). Validar coherencia en kit SQL antes de PROD. |
| **Packing: bultos vacíos vivos en DB compartida** (cantidad no verificable aquí) | 🟡 Baja | Media | Contar/limpiar bultos `BLT-*` vacíos colgados de pedidos cancelados antes del E2E de 4C. |
| **Diseño 4C aprobado sin commitear** (untracked) | 🟡 Baja | Alta | Commitear `GATE_4C_DISPATCH_DESIGN.md` + este reporte antes de iniciar código. |
| **Inconsistencia de naming de ruta** (placeholder `/wms/despachos` vs diseño `/wms/despacho`) | 🟢 Informativa | Alta | Alinear en implementación: reutilizar `/wms/despachos` (plural, ya existe el placeholder `ModuleScaffold`) o ajustar el diseño. Cosmético. |

---

## 7. Gate de aprobación

### Fundamento de la decisión

**El repositorio en sí (git, cadena de migraciones, ledger, packing/FEFO) está en condiciones técnicas
sólidas y arquitectónicamente compatible con Gate 4C.** No hay defectos de código que impidan diseñar `0035`
(la migración de Dispatch; `0034` quedó tomada por Mini-Gate 4B.1).

Sin embargo, por tratarse del **primer egreso irreversible del sistema sobre una base DEV/PROD compartida**,
la barra de aprobación es deliberadamente estricta (Reality-Checker). Persisten **bloqueantes concretos y
enumerables** —operativos y de decisión— que **deben resolverse antes de escribir una sola línea de código**:

---

## ⛔ GATE 4C NOT READY

**Bloqueantes a resolver antes de iniciar implementación (en orden):**

1. **[OPERATIVO · 🔴] Backup Supabase previo NO confirmado.** Tomar snapshot lógico pre-`0034` del
   proyecto `arsksytgdnzukbmfgkju` y registrarlo en `SUPABASE_BACKUP_CHECKLIST.md`. *(No verificable desde
   el repo — requiere acción de Martín en el dashboard.)*

2. **[OPERATIVO · 🔴] PITR (Point-In-Time Recovery) NO confirmado.** Verificar que esté habilitado y anotar
   el timestamp de referencia pre-migración. Es la **única** red ante un egreso de prueba mal ejecutado en
   la DB compartida. *(No verificable desde el repo.)*

3. ~~**[DECISIÓN/CÓDIGO · 🟠] `anular_packing_unit` sin resolver (prerrequisito de D1=A).**~~
   ✅ **RESUELTO (2026-06-03) por la vía (a)** — Mini-Gate 4B.1: RPC `anular_packing_unit` (`abierta` vacío →
   `anulada`, Empty-only) implementada en `0034_wms_packing_cancel.sql` y **VALIDADA** (kit 12 checks,
   0 footprint, todo OK). D1=A de `confirm_dispatch` queda plenamente satisfacible (los bultos vacíos
   trabados ahora se anulan y se excluyen). **Sin excepciones ocultas en `confirm_dispatch`.**

**Saneamientos menores recomendados (no bloquean, hacer en la misma tanda):**

4. **[🟡] Commitear el diseño aprobado.** `docs/handoff/GATE_4C_DISPATCH_DESIGN.md` está untracked; versionar
   junto con este reporte para que la fuente de verdad aprobada viva en git.

5. **[🟡] Validación de datos vivos pendiente (no verificable en esta auditoría READ ONLY sin acceso a DB):**
   contar/limpiar bultos `BLT-*` vacíos; confirmar saldo de `G-001` (esperado 100/0); chequear coherencia
   `Σ inventory_lots.quantity` vs `stock_reserved` (riesgo F4). Cubrir en el kit SQL `0 footprint` antes de PROD.

6. **[🟢] Alinear naming de ruta** `/wms/despachos` (placeholder existente) vs `/wms/despacho` (diseño).

---

### Lo que SÍ está listo (para constancia)

- ✅ Git sincronizado (`main` = `origin/main`, 0/0) + backup post-4B (`backup/main-wms-gate4b-20260603`).
- ✅ Cadena de migraciones `0024`–`0033` íntegra, ordenada, versionada (31/31), sin conflictos; gaps intencionales.
- ✅ Ledger `inventory_movements` inmutable (trigger intacto, no debilitado) y lockdown RLS correcto.
- ✅ Enums terminales de 4C congelados (0030/0033); slate limpio (no existe `shipments`/`confirm_dispatch`).
- ✅ Diseño `GATE_4C_DISPATCH_DESIGN.md` resuelve D1–D6 y ya contempla las incompatibilidades L1–L3 y F1–F5.

### Re-evaluación — ESTADO VIGENTE: ✅ GATE 4C READY TO CODE (2026-06-03)

- **Bloqueante #3 (packing)** → ✅ **RESUELTO** (Mini-Gate 4B.1 validado, `0034`).
- **Bloqueantes #1 y #2 (Backup + PITR)** → **operativos, de pre-aplicación**: se confirman **antes de
  aplicar** la migración `0035` de 4C, **no** antes de empezar a codear. No bloquean la escritura del código.
- Saneamiento #4 (commitear diseños) y #6 (naming de ruta) → pendientes menores, no bloquean código.

**Conclusión:** la **codificación de Gate 4C puede comenzar** (migración `0035` + TS + UI). Los gates
operativos Backup/PITR siguen siendo **obligatorios antes de aplicar `0035`** a la base compartida DEV/PROD.

---

> **FIN — Auditoría READ ONLY (con actualización de cierre 4B.1).**
> Veredicto histórico de auditoría: **GATE 4C NOT READY** (3 bloqueantes).
> **Veredicto vigente (2026-06-03): GATE 4C READY TO CODE** — Bloqueante #3 resuelto (4B.1 validado);
> restan solo los gates operativos Backup + PITR, exigibles al aplicar `0035`.
