# LUJAN_3159_DIGITAL_TWIN_DATA_MODEL

**Sede:** Pedro Luján 3159 · **Fase:** 1 — Data model local seguro · **Fecha:** 2026-06-04
**Archivo implementado:** `src/lib/wms/lujan3159-map.ts` (typecheck ✅, additive-only, sin Supabase)
**Relacionado:** [CODE_AUDIT](./LUJAN_DIGITAL_MAP_CODE_AUDIT.md) · [DATA_INCONSISTENCIES](./LUJAN_3159_DATA_INCONSISTENCIES.md)

---

## 1. Decisiones de modelado

1. **Capa local, no Supabase.** El modelo vive en `src/lib/wms/lujan3159-map.ts`. No se aplican migraciones ni se modifica el seed `warehouse_*` (restricción del handoff). Es la fuente provisional autorizada del mapa comercial.
2. **Estado comercial ≠ estado operativo.** Se introduce `CommercialStatus` (`ocupado`/`parcial`/`disponible`) separado del `PositionStatus` operativo del WMS (`disponible`/`reservado`/`ocupado`/`mantenimiento`). No se pisa el existente.
3. **Confianza explícita por dato.** Todo m²/ocupación lleva `confidence: 'exact' | 'approximate' | 'pending'` — los aproximados (PB3, PB6) y pendientes (2º piso PA4/PA5) quedan marcados, nunca presentados como exactos.
4. **Cliente como titular de sector/cubículo.** Campo `client` a nivel sector y cubículo (lo que el WMS no modela). Texto por ahora; FK a `clients`/`crm` es futuro.
5. **Racks como sub-objeto del sector.** `RackInfo` (plano, rev, fecha, sistema, posiciones, unidad de carga) embebido en el sector que los tiene (PB1, PB2, PB3, PB8).
6. **Cubículos en bloques aparte.** Los 24 cubículos ANMAT (12 por piso) se modelan como `CubicleBlock` con cubículos individuales (code, m², estado, cliente).

---

## 2. Estructura de tipos (resumen)

```
LujanSiteModel
├── meta: SiteMeta
│   ├── code/name/address/owner
│   ├── buildingM2Approx (~7500, NO vendible, 'approximate')
│   └── totals: SiteTotals (storageM2 5928, generalM2 5284, anmatM2 644,
│                occupied 2315/39%, available 3613/61%, racks 1413, clientes 13)
├── sectors: Sector[]
│   ├── code (PB1..PB15, PA1, PA2) · category (general|anmat) · floor (PB|P1|P2)
│   ├── surfaceM2 + surfaceConfidence
│   ├── occupancy: { status, client, occupiedM2, availableM2, confidence, note }
│   └── rack?: RackInfo { plano, rev, fecha, system, positions, positionsAvailable, unidadCargaKg }
└── cubicleBlocks: CubicleBlock[]
    ├── code (PA3+PA7 | PA4-PA5) · floor (P1|P2) · totalM2 (258)
    └── cubicles: Cubicle[] { code C01..C12, surfaceM2 (18|25), status, client }
```

Cada entidad lleva `sources: SourceRef[]` (informe rev2 / cuadro / plano Mecalux / croquis).

---

## 3. Datos cargados (canónicos)

### 3.1 Planta Baja — Cargas Generales
| Sector | m² | Estado | Cliente | Disp. m² | Racks |
|---|---|---|---|---|---|
| PB1 | 805 | Parcial | Avantecno (24 selectivas) | 805 + 410 pos. | 434 (410 pen + 24 sel), 951207-1, 800kg |
| PB2 | 997 | Disponible | — | 997 + 248 pos. | 248 pen, 1762646-1, 1200kg |
| PB3 | 500 | Parcial | Divanlito (ala der.) | ~250 *(approx)* | 483 pen, 1037501-1, 800kg |
| PB4 | 300 | Ocupado | Silica Networks | 0 | — |
| PB5 | 970 | Ocupado | Divanlito | 0 | — |
| PB6 | 506 | Parcial | Clientes varios | ~354 *(approx)* | — |
| PB7 | 300 | Ocupado | Silica Networks | 0 | — |
| PB8 | 806 | Disponible | — | 806 + 248 pos. | 248 pen, 1764929-1, 1200kg |

### 3.2 Planta Baja — ANMAT
| Sector | m² | Estado | Cliente |
|---|---|---|---|
| PB10 | 16 | Ocupado | Elintec |
| PB11 | 12 | Ocupado | Cala Med |
| PB15 | 30 | Ocupado | Q-Advice |

### 3.3 1º Piso
| Sector | m² | Cat. | Estado | Cliente |
|---|---|---|---|---|
| PA1 | 100 | General | Ocupado | Avantecno (vinc. PB1) |
| PA2 | 70 | ANMAT | Ocupado | Vitalis Pharma |
| PA3+PA7 | 258 | ANMAT | 6 ocup / 6 disp | cubículos (ver §3.5) |

### 3.4 2º Piso
| Bloque | m² | Cat. | Estado |
|---|---|---|---|
| PA4-PA5 *(pending)* | 258 | ANMAT | 12 disponibles |

### 3.5 Cubículos ANMAT 1º piso (PA3+PA7)
- Ocupados: C01 Narena SRL, C02 Tex Argenta SRL, C03 T.G. Health SRL, C04 Laboratorios Integrador, C05 Nicolas Leonardo Company (18 m² c/u), C12 Bonfarto Salud SA (25 m²) → **115 m²**.
- Disponibles: C06 (18) + C07–C11 (25 c/u) → **143 m²**.

### 3.6 Racks Mecalux
| Sector | Plano | Sistema | Posiciones | Unidad carga |
|---|---|---|---|---|
| PB1 | 951207-1 rev00 (2017-05-02) | Penetrable + Selectivo | 434 (410+24) | 800 kg |
| PB2 | 1762646-1 rev00 (2023-07-11) | Penetrable | 248 | 1200 kg |
| PB3 | 1037501-1 rev01 (2018-01-23) | Penetrable | 483 | 800 kg |
| PB8 | 1764929-1 rev00 (2023-07-13) | Penetrable | 248 | 1200 kg |
| **Total** | | | **1.413** (1.389 pen + 24 sel) | |

---

## 4. Selectores de Comercial Readiness (Fase 3, ya implementados)

Funciones puras exportadas para que el CRM consuma disponibilidad sin recalcular:

| Función | Devuelve |
|---|---|
| `getAvailableAreaByCategory('general'\|'anmat')` | m² disponibles por categoría (sectores + cubículos ANMAT) |
| `getAvailableRackCapacity()` | posiciones de paleta disponibles + sectores con disponibilidad pendiente (PB3) |
| `getAvailableAnmatCubicles()` | lista de cubículos libres (bloque, piso, code, m²) |
| `getCommercialAvailabilitySummary()` | resumen consolidado (storage/ocupado/disponible/% + breakdown) |

**Resultados verificados** (`getCommercialAvailabilitySummary()`):
- `availableGeneralM2` = 3.212 · `availableAnmatM2` = 401 · `availableM2` = **3.613** · `occupiedM2` = **2.315** (39%).
- `availableRackPositions` = 906 (PB1 410 + PB2 248 + PB8 248); PB3 pendiente.
- `availableAnmatCubicles` = 18 (6 en 1º + 12 en 2º).

Esto responde directamente a los casos de uso del CRM:
- *"Cliente pide 300 m² ANMAT"* → `getAvailableAnmatCubicles()` (no hay bloque único de 300; se ofrece combinación de cubículos / 2º piso 258 m²).
- *"Cliente pide 800 m² CG con racks"* → PB8 (806 + 248 pos.) o PB2 (997 + 248), o PB1 penetrable.

---

## 5. Pendiente (gateado)

- **Fase 2 (UI premium):** vistas Comercial / Infraestructura / ANMAT / Racks + filtros + panel lateral + resumen + export. **No iniciada** — espera ratificación de fuente canónica (inconsistencia #1).
- **Reconciliación Supabase (D→PB):** diseñada, **no ejecutada** (requiere autorización; afecta vacancia oficial).
- **Confirmaciones de Dirección:** PA4/PA5, split PB3, % PB6.
