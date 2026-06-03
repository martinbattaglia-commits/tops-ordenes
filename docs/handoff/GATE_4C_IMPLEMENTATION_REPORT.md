# GATE 4C — Despacho + Entrega (`0035`) · REPORTE DE IMPLEMENTACIÓN

> Estado: **implementado (código). Migración `0035` PENDIENTE de aplicar a Supabase** (la aplica Martín
> a mano en el SQL Editor). Sin push/deploy/merge. Fecha: 2026-06-03.
> Arquitecto Principal + Staff Engineer + Release Engineer (rol). Repo `~/CODE/tops-ordenes`.
> Implementa exactamente `GATE_4C_DISPATCH_DESIGN.md` + `GATE_4C_IMPLEMENTATION_PLAN.md` (sin arquitectura nueva).

---

## 1. Resumen

Gate 4C cierra el ciclo logístico con el **primer egreso irreversible**: despacho (egreso real de stock +
ledger), entrega y reversión compensatoria. Todo el alcance autorizado quedó implementado a nivel código y
**verificado con `tsc --noEmit` (0 errores) y `eslint` (limpio)**. La **migración `0035` no fue aplicada**
(regla del proyecto: las migraciones las corre Martín); por lo tanto el **kit SQL aún no se ejecutó** y se
entrega listo para correr tras aplicar `0035` con backup manual previo (PITR off).

---

## 2. Migración nueva — `0035_wms_dispatch.sql`

| Objeto | Detalle |
|---|---|
| Enum | `shipment_status_t ('despachado','entregado','anulado')` |
| Tabla | `shipments` (cabecera 1×pedido) + secuencia + trigger `set_shipment_public_id` ('DSP-') |
| Índices | `shipments_order_idx`, `shipments_status_idx`, **parcial `shipments_order_uk` unique(order_id) where status<>'anulado'** |
| Columna aditiva | `packing_units.shipment_id` (FK nullable) + `packing_units_shipment_idx` |
| RLS | `shipments` lectura `authenticated`; escritura **solo vía RPC** (lockdown) |
| RPC | `confirm_dispatch(uuid)→uuid`, `confirm_delivery(uuid,text)`, `revert_dispatch(uuid)` |
| Helper | `wms_dispatch_recompute(uuid)` (REVOKE public/authenticated) |

**Principios respetados (verificables en el SQL):**
- **EGRESO sobre `stock_reserved`** (NO `stock_available`) + `inventory_lots` por lote. **No reutiliza** la
  rama `egreso` de `confirm_movement` (hallazgo L1).
- **FEFO REAL** multi-lote: re-resuelto sobre `inventory_lots` por `expiration_date asc`, decremento greedy;
  guard de consistencia que **aborta** si `Σ lotes < cantidad` (sin egreso parcial). D3=C: sin lote →
  solo `stock_reserved`, egreso `lot_number=null`.
- **Ledger append-only:** SOLO `INSERT` de `egreso` (despacho, 1 por lote) e `ingreso` (reversión,
  `reason='reversion_despacho'`). **JAMÁS UPDATE/DELETE** (trigger 0026 intacto).
- **Reversión compensatoria:** lee los `egreso` del shipment del ledger y escribe `ingreso` nuevos; no
  modifica el histórico. Restituye `stock_reserved` + `inventory_lots`, devuelve estados, shipment `anulado`.
- **Roll-ups derivados** (`wms_dispatch_recompute`): líneas `empacado↔despachado`, pedido
  `preparado↔despachado↔entregado`. Despacho-seguro.
- **D1=A:** rechaza despachar con bultos `abierta` (resoluble con `anular_packing_unit` de 4B.1).
- **Whole-order atómico:** despacho todo-o-nada; unicidad de shipment por índice parcial.

---

## 3. Impacto en TypeScript

| Archivo | Estado | Contenido |
|---|---|---|
| `src/lib/dispatch/types.ts` | NEW | `ShipmentStatus`, `SHIPMENT_STATUS_META`, `DispatchQueueRow`, `DispatchPanel`, `DispatchUnit`, `DispatchItem`, `ShipmentRow` (reusa `PhysicalLocation`) |
| `src/lib/dispatch/dispatch.ts` | NEW | Lecturas `listDispatchQueue`, `listDispatchPanel`; wrappers `confirmDispatch`, `confirmDelivery`, `revertDispatch` (solo RPC). Embeds shallow + mapa (evita el anidado profundo de PostgREST) |

Mutaciones **exclusivamente vía RPC SECURITY DEFINER**. `tsc --noEmit` = **0 errores**.

---

## 4. Impacto en UI

| Archivo | Estado | Rol |
|---|---|---|
| `src/app/(app)/wms/despachos/page.tsx` | MOD (reemplaza placeholder) | **Cola** de despacho: pedidos `preparado`/`despachado` + KPIs + filtro |
| `src/app/(app)/wms/despachos/[id]/page.tsx` | NEW | **Panel**: bultos + contenido (lote previsto + ubicación) + datos del despacho + acciones |
| `src/app/(app)/wms/despachos/actions.ts` | NEW | Server Actions `confirmDispatchAction`/`confirmDeliveryAction`/`revertDispatchAction` |
| `src/app/(app)/wms/despachos/_components/DispatchActions.tsx` | NEW | Cliente: Despachar (confirmación reforzada "egreso irreversible"), Entregar (receptor), Revertir (confirmación) |

- **Revalidación de stock:** las actions revalidan `/wms/despachos`, `/wms/packing`, `/pedidos` **y además
  `/wms/inventario`, `/wms/lotes`, `/wms/vencimientos`** (el despacho mueve stock). **Sin `router.refresh()`**.
- Estética `nx-*` reutilizada; sin rediseño visual. `eslint` = limpio.

---

## 5. Validación

> ⚠️ **La migración `0035` no fue aplicada** (la aplica Martín). Por lo tanto el **kit SQL aún no se corrió**.

- **Verificado ahora:** `tsc --noEmit` (0 errores) + `eslint` (0 warnings) sobre toda la capa nueva.
- **Pendiente (tras aplicar `0035` con backup manual):** correr
  `docs/handoff/gate4c_dispatch_validation_report.sql` — **14 casos, 0 footprint**:
  C1 happy path · C2 egreso sobre `stock_reserved` (no `available`) · C3 FEFO un lote · C4 FEFO multi-lote
  split · C5 D3 sin lote · C6 guard de consistencia · C7 ledger append-only (UPDATE/DELETE rechazados) ·
  C8 entrega · C9 reversión (neto 0 + estados) · C10 roll-up multi-línea · C11 D1=A bulto abierto ·
  C12 unicidad · C13 forward-guards · C14 authz.
- **Esperado:** todas las filas `OK`. Cierre del kit verifica 0 footprint (conteos/saldos vuelven al inicial).
- **E2E navegador** (tras aplicar): pedido `Test-*` → reservar → pickear → empacar → cerrar → despachar
  (verificar `stock_reserved--`, ledger `egreso`, lotes FEFO, revalidación de inventario) → entregar →
  revertir (verificar restitución + ledger compensatorio). Restaurar fixture.

---

## 6. Checklist de cierre

| # | Paso | Estado |
|---|---|---|
| 1 | Ejecutar validaciones | ⏳ tras aplicar `0035` (kit listo) · ✅ tsc/eslint OK |
| 2 | Mostrar resultados | ✅ tsc 0 errores · eslint limpio (ver §5) |
| 3 | Mostrar diff completo | ✅ (entregado en el reporte de la tarea) |
| 4 | Archivos creados | ✅ §2–§4 + este reporte + kit |
| 5 | Migraciones nuevas | ✅ `0035_wms_dispatch.sql` |
| 6 | Impacto TS | ✅ §3 |
| 7 | Impacto UI | ✅ §4 |
| 8 | Actualizar handoffs | ✅ `WMS_PHASE_CLOSURE_HANDOFF.md`, `MASTER_HANDOFF.md` |

---

## 7. Próximos pasos (requieren acción de Martín / OK)

1. **Backup manual** de Supabase (PITR off) + confirmar último backup diario.
2. Aplicar `0035_wms_dispatch.sql` en el SQL Editor.
3. Correr `gate4c_dispatch_validation_report.sql` → esperar todo `OK`.
4. E2E navegador con `Test-*`.
5. (commit local ya realizado; **push pendiente de decisión**).

**Fuera de alcance (próximo ciclo — NO iniciar):** Gate 5 (Cadena de Custodia: QR + fotos + evidencia +
firma digital) sobre `packing_units`.

---

> **FIN — Gate 4C implementado (código). Migración pendiente de aplicar. Sin push/deploy. Gate 5 NO iniciado.**
