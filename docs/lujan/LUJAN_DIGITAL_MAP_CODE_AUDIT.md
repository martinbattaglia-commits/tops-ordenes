# LUJAN_DIGITAL_MAP_CODE_AUDIT

**Sede:** Depósito Anexo — Pedro Luján 3159 (Barracas, CABA)
**Fase:** 0 — Auditoría de código (antes de escribir/modificar UI)
**Fecha:** 2026-06-04
**Regla:** no inventar datos · no resolver inconsistencias en silencio · mejora progresiva no destructiva
**Relacionado:** [DATA_INCONSISTENCIES](./LUJAN_3159_DATA_INCONSISTENCIES.md) · [DATA_MODEL](./LUJAN_3159_DIGITAL_TWIN_DATA_MODEL.md) · [VACANCY_SOURCE_OF_TRUTH_ANALYSIS](../comercial/VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md)

---

## 1. ¿Qué existe hoy? (mapa / Digital Twin)

### 1.1 Ruta y componentes
| Pieza | Archivo | Qué hace |
|---|---|---|
| Mapa Inteligente (Digital Twin) | `src/app/(app)/operaciones/mapa-inteligente/page.tsx` | Server component `force-dynamic`. Renderiza sedes → pisos → sectores → cubículos. Sectores **sin** posiciones = chip; **con** posiciones = grilla de cubículos (2 columnas + pasillo). |
| Lectura del Twin | `src/lib/wms/twin.ts` (`getTwin`) | Lee `warehouses → warehouse_floors → warehouse_sectors` + `warehouse_positions`; **deriva ocupación del inventario** (Sprint 2). Devuelve `TwinWarehouse[]`. Mock si `demoMode`/`needsSupabase`. |
| Tipos / colores | `src/lib/wms/types.ts` | `PositionStatus` (`disponible`/`reservado`/`ocupado`/`mantenimiento`) + `POSITION_STATUS_META` (colores). `WmsKpis`. |
| KPIs WMS | `src/lib/wms/data.ts` (`getWmsDashboard`) | Ocupación por **posición** (set de `position_id` con stock). No por m². |
| Mapa operativo (otro) | `src/app/(app)/operaciones/mapa/page.tsx` | Mapa geográfico/operativo separado (no es el Twin de superficies). |

### 1.2 Modelo de datos actual
- **Origen: Supabase** (`warehouse_*`, migraciones `0020_wms_physical_model`, `0023_lujan_cubiculos`), con **fallback mock** en `twin.ts` (`MOCK_TWIN`).
- Jerarquía: `warehouses → warehouse_floors → warehouse_sectors → warehouse_zones → warehouse_racks → warehouse_positions`.
- m² disponibles en columnas `surface_m2` a nivel sede / piso / sector / posición.
- Ocupación = **booleana por posición**, derivada de `inventory_items.position_id` (no almacenada).

### 1.3 Estética / interacción actual
- Leyenda de 4 estados operativos; chips de sector; grilla de cubículos con tooltip `title` (no panel lateral).
- **Sin**: panel lateral, filtros, buscador, vistas múltiples, resumen comercial, exportación CSV, layer de racks, cliente por sector.

---

## 2. ¿Qué FALTA para el mapa premium comercial?

El mapa actual es **operativo** (estado físico de posiciones derivado del inventario). El premium pedido es **comercial** (qué vender, a quién está ocupado, cuántos m² libres). Brechas:

| Requisito premium | ¿Existe? | Brecha |
|---|---|---|
| Estado **comercial** (Ocupado / Parcial / Disponible) | ❌ | El enum actual es operativo (`disponible/reservado/ocupado/mantenimiento`), semántica distinta |
| **Cliente por sector** (Avantecno, Divanlito, Silica…) | ❌ | `inventory_items.client_name` es por ítem, no por sector; sin titular de sector |
| **m² ocupados / disponibles por sector** | ⚠️ parcial | Existe `surface_m2` del sector, pero no el split ocupado/libre |
| **Layer de racks Mecalux** (plano, sistema, posiciones, unidad carga) | ❌ | `warehouse_positions.capacity` es int sin metadata de plano/sistema/kg |
| **Vistas** Comercial / Infraestructura / ANMAT / Racks | ❌ | Hoy una sola vista |
| **Filtros / buscador / panel lateral** | ❌ | — |
| **Resumen comercial** (total/ocupado/disponible/%) | ❌ | — |
| **Exportación PDF/CSV** | ❌ | — |
| **Cubículos individuales con cliente** | ⚠️ parcial | Grilla existe; falta cliente + estado comercial por cubículo |
| **Codificación de sectores PB1–PB15 / PA** | ❌ | El seed usa **D1–D8** (ver inconsistencia #1) |

---

## 3. Hallazgo crítico — codificación divergente (afecta la fuente de vacancia)

El seed de Supabase (`0020:247-279`, `0023`) modela Luján con sectores **D1–D8** ("provisional s/plano 717/11", total ~4.455 m², con D2 en NULL) y **solo 24 cubículos** (D7/D6). El relevamiento **rev2 (04/06/2026)** que ahora es fuente de verdad usa **PB1–PB8 / PB10/11/15 / PA1/PA2** + 24 cubículos en PA3+PA7 / PA4-PA5, total **5.928 m²**.

**Las dos codificaciones no son mapeables 1:1.** El Digital Twin sembrado está **desactualizado** respecto del informe rev2.

> **Impacto directo:** la [fuente oficial de vacancia ratificada](../comercial/VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md) = `warehouse_sectors.surface_m2`. Hoy esos sectores (D-codes) **no reflejan la realidad comercial** (PB-codes). La reconciliación es un prerequisito para que la vacancia sea correcta. Detalle y opciones en [DATA_INCONSISTENCIES #1](./LUJAN_3159_DATA_INCONSISTENCIES.md).

---

## 4. Decisión de arquitectura propuesta (no destructiva)

1. **No reemplazar** `mapa-inteligente` (operativo) — sigue sirviendo a Operaciones con su vista booleana por posición.
2. **Crear** el mapa premium **comercial** como vista nueva (p. ej. `operaciones/mapa-comercial` o `comercial/mapa-lujan`), alimentada por un **data model local tipado** (`src/lib/wms/lujan3159-map.ts`, ya creado en Fase 1) — **sin tocar Supabase**.
3. **No aplicar migraciones**: la reconciliación D→PB del seed se diseña pero **no se ejecuta** sin autorización (restricción del handoff maestro).
4. La capa local se vuelve la **fuente provisional autorizada** del mapa comercial y del KPI de vacancia comercial, hasta que se decida migrar el seed.

---

## 5. Activos reutilizables (design system)

- Clases del repo ya disponibles: `nx-surface`, `card`, `page-header`, `page-title`, `eyebrow-tiny`, `btn btn-ghost`, badges (`StatusBadge.tsx`), `Icon.tsx`, `CountUp.tsx`, `charts/`.
- Tokens de color por estado ya definidos (`POSITION_STATUS_META`). El mapa comercial necesita un set **comercial** propio (Ocupado=rojo, Parcial=naranja, Disponible=verde) + categoría (General=coral, ANMAT=azul, Racks=navy) — definir en el data model, no pisar el operativo.

---

## 6. Entregable de esta fase

- ✅ Este audit.
- ✅ `src/lib/wms/lujan3159-map.ts` (data model tipado, typecheck verde, derivación reproduce 3.613/2.315 m²).
- ✅ [DATA_INCONSISTENCIES](./LUJAN_3159_DATA_INCONSISTENCIES.md).
- ✅ [DATA_MODEL](./LUJAN_3159_DIGITAL_TWIN_DATA_MODEL.md).
- ⏸️ UI premium (Fase 2) — **gateada** hasta ratificar fuente canónica (inconsistencia #1).
