# TOPS NEXUS — Gate 4C (Despacho + Entrega) · Decisiones abiertas

> Generado 2026-06-03. **Análisis para decisión. NO es diseño ni implementación.**
> Gate 4C = primer gate con **egreso irreversible** (ledger inmutable + `inventory_lots--`).
> Cada decisión incluye alternativas, ventajas/desventajas y recomendación del Arquitecto.

---

## D1 — ¿Exigir todos los BLT cerrados antes de despachar?

**Alternativas:** (A) Exigir todos los `packing_units` del pedido en `cerrada`. (B) Permitir despacho con bultos `abierta`.

| | Ventajas | Desventajas |
|---|---|---|
| A (exigir cerrados) | Integridad física (no se despacha un bulto a medio armar); fuerza el sellado; coherente con `packing_status` | Bloquea si quedó un bulto vacío trabado (deuda `anular_packing_unit`) |
| B (permitir abiertos) | Flexible | Riesgo de despachar contenido inconsistente; ambigüedad de estado |

**Recomendación: A.** `confirm_dispatch` exige que **todos los bultos no anulados del pedido estén `cerrada`**. *Prerrequisito:* resolver la deuda `anular_packing_unit` (o permitir ignorar bultos vacíos) para no quedar trabados.

---

## D2 — ¿Shipment por pedido o consolidado?

**Alternativas:** (A) 1 `shipment` por pedido. (B) `shipment` consolida varios pedidos/bultos (carga por viaje).

| | Ventajas | Desventajas |
|---|---|---|
| A (por pedido) | Simple; 1:1 pedido↔despacho; trazabilidad directa; alinea con el modelo actual (allocations por pedido) | No modela cargas multi-pedido en un mismo viaje |
| B (consolidado) | Modela viajes reales 3PL (varios pedidos por camión) | Más complejo (shipment N:M pedidos); reabre el modelo de datos |

**Recomendación: A para 4C** (1 shipment por pedido), dejando `shipments` con un diseño que **no bloquee** una consolidación futura (ej. `shipment_id` opcional en una capa de "viaje/manifiesto" en Gate 4C.1 o Tracking). Empezar simple, additive.

---

## D3 — Política de despacho para stock sin lote

**Contexto:** el ítem de prueba `G-001` tiene `stock_available` pero **sin** `inventory_lots`. Las allocations pueden tener `lot_number = null`.

**Alternativas:** (A) Permitir egreso con `lot_number null` (decremento solo de `inventory_items`, sin tocar `inventory_lots`). (B) Exigir lote (rechazar egreso sin lote). (C) Egreso decrementa `inventory_lots` por FEFO **si hay lotes**; si no, solo `inventory_items`.

| | Ventajas | Desventajas |
|---|---|---|
| A | Tolerante a datos sin lote | Pierde trazabilidad por lote en el egreso |
| B | Trazabilidad estricta | Bloquea stock legítimo sin lote |
| C (híbrida) | Trazabilidad cuando hay lote; tolerante cuando no | Lógica condicional en la RPC |

**Recomendación: C.** `confirm_dispatch` decrementa `inventory_lots` por FEFO cuando la allocation tiene lote; si `lot_number` es null, decrementa solo `inventory_items.stock_reserved`. Siempre escribe `inventory_movements` (egreso) con `lot_number` (o null).

---

## D4 — Tracking (estrategia de seguimiento del despacho)

**Alternativas:** Manual · Traccar · Mapbox · AirTag · GPS dedicado.

| Opción | Ventajas | Desventajas |
|---|---|---|
| Manual (estados) | Cero infra; ya existe el flujo de estados | Sin ubicación en tiempo real |
| Traccar | Ya integrado en TOPS (módulo Tracking de Flota, 0016-0019) | Requiere dispositivos GPS en vehículos |
| Mapbox | Visualización de mapa (ya usado en Tracking) | Solo presentación; necesita fuente de posición |
| AirTag | Barato, por bulto | Cobertura dependiente de red Apple; no apto B2B serio |
| GPS dedicado | Preciso | Costo/logística de hardware |

**Recomendación:** **4C = Manual (estados despachado/entregado) + reutilizar Traccar/Mapbox del módulo Tracking existente para el vehículo** (no por bulto). El tracking por **bulto/unidad** (QR/AirTag) es alcance de **Gate 5** (cadena de custodia). No acoplar 4C a hardware.

---

## D5 — Estrategia FEFO final

**Contexto:** hoy FEFO opera **a nivel ítem** (en `allocate_order`, ordena candidatos por vencimiento más próximo). El **split por lote** (decrementar el lote correcto en `inventory_lots`) está diferido.

**Alternativas:** (A) FEFO a nivel ítem (actual) + decremento de lote FEFO en el egreso (4C). (B) FEFO por lote desde la reserva (reservar lote específico).

| | Ventajas | Desventajas |
|---|---|---|
| A | No reabre la reserva (Gate 3 cerrado); FEFO se "materializa" en el egreso | El lote exacto se decide al despachar, no al reservar |
| B | Lote fijado desde la reserva | Reabre Gate 3 (cerrado/validado); más rígido |

**Recomendación: A.** Mantener FEFO a nivel ítem en la reserva; en `confirm_dispatch`, decrementar `inventory_lots` por **FEFO real** (lote más próximo a vencer del ítem) por la cantidad despachada. Cierra el gap "FEFO split por lote" sin tocar Gate 3.

---

## D6 — Modelo de entrega (estados terminales)

**Contexto:** `logistics_order_status_t` hoy tiene `despachado` y `entregado`. **No** existen `rechazado` ni `devolucion`.

**Alternativas:** (A) Solo `despachado → entregado` (4C mínimo). (B) Agregar `rechazado`/`devolucion` (logística inversa).

| | Ventajas | Desventajas |
|---|---|---|
| A | Mínimo, additive, cierra el ciclo feliz | No modela rechazos/devoluciones |
| B | Modela logística inversa real | Reingreso de stock (ledger ingreso), nuevos enums, más superficie |

**Recomendación:** **4C = A** (`despachado → entregado`), con `confirm_delivery`. **Rechazo/Devolución = gate posterior** (4C.1 o "Reverse Logistics") porque implica **reingreso de stock al ledger** (ingreso/ajuste) y enums nuevos — no mezclar con el egreso de 4C. Dejar el diseño de `shipments` preparado para colgar un evento de devolución futuro sin rediseño.

---

## Resumen de recomendaciones

| Decisión | Recomendación |
|---|---|
| D1 BLT cerrados | **Sí** (exigir todos `cerrada`; requiere resolver `anular_packing_unit`) |
| D2 Shipment | **1 por pedido** (additive, no bloquear consolidación futura) |
| D3 Sin lote | **Híbrida** (FEFO si hay lote; solo `inventory_items` si no) |
| D4 Tracking | **Manual + Traccar/Mapbox del vehículo**; por bulto → Gate 5 |
| D5 FEFO | **A nivel ítem + decremento FEFO en el egreso** |
| D6 Entrega | **despachado → entregado**; rechazo/devolución a gate posterior |

> Estas recomendaciones son input para el **documento de diseño de Gate 4C** (a producir en un chat dedicado). No constituyen implementación.
