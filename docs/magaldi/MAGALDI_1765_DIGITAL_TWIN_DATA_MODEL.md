# MAGALDI_1765_DIGITAL_TWIN_DATA_MODEL

**Sede:** Central Corporativa — Agustín Magaldi 1765 · **Fase:** 1 — Modelo tipado · **Fecha:** 2026-06-04
**Archivo:** `src/lib/wms/magaldi1765-map.ts` (typecheck ✅, additive-only, sin Supabase)
**Relacionado:** [CODE_AUDIT](./MAGALDI_DIGITAL_MAP_CODE_AUDIT.md) · [IMPLEMENTATION_REPORT](./MAGALDI_1765_PREMIUM_MAP_IMPLEMENTATION_REPORT.md)

---

## 1. Decisiones de modelado

1. **Capa local, no Supabase.** El modelo vive en `magaldi1765-map.ts`. No toca el seed `0020` (que usa S1–S5, superseded). Es la fuente del mapa corporativo y del futuro Dashboard de Vacancia.
2. **Lista plana de espacios** (`MagaldiSpace[]`), no jerarquía floor→sector: la sede corporativa mezcla depósitos, oficinas, coworking, áreas públicas y servicios en un layout no jerárquico. Cada espacio tiene `floor` (PA/PB).
3. **7 categorías** (`SpaceCategory`): `anmat`, `general`, `oficina`, `coworking`, `publica`, `servicio`, `maniobra`.
4. **4 estados comerciales** (`CommercialStatus`): `disponible`, `ocupado`, `interno` (oficina propia no comercial), `na` (no comercializable).
5. **Colisión de códigos resuelta por id** (M-2): depósitos `PB1/PB2/PB3` vs oficinas `OF-PB1/OF-PB2/OF-PB3` — ids únicos, etiquetas del croquis conservadas.
6. **Coworking Premium** modelado aparte (`CoworkingPremium`): se vende por isla; composición + beneficios incluidos.
7. **Confianza** por dato (`exact`/`approximate`/`pending`).

---

## 2. Estructura de tipos

```
MagaldiSiteModel
├── meta: MagaldiMeta
│   ├── code/name/address/owner/destino/expediente/certificado
│   └── totals: MagaldiTotals
│        cubiertaM2 6893.87 · anmatM2 1441 (disp 107) · generalM2 2520 (disp 0)
│        oficinaVendibleM2 50 · rackPositionsTotal 964 (disp 0)
│        cubiertaNoDesglosadaM2Approx 2722 · maniobraDescubiertaM2 1700
├── spaces: MagaldiSpace[]   (id, name, category, status, floor, m2, rackPositions?, note?, confidence)
└── coworkingPremium: CoworkingPremium  (11 islas · 56 puestos · 100% · composición · incluye[])
```

---

## 3. Inventario cargado (canónico, validado por código)

| Bloque | Detalle | Total |
|---|---|---|
| **ANMAT** | 27 sectores PB6–PB32; único disponible PB30 (107 m²) | **1.441 m²** (disp 107 · ocup 1.334) |
| **Cargas Generales** | PB1 900 (400 racks) · PB2 300 · PB3 100 · PB4 1000 (564 racks) · PB5 100 · PB5A 120 — todos ocupados | **2.520 m²** (disp 0) |
| **Racks selectivos** | PB1 400 + PB4 564; ambos sectores ocupados → libres 0 | **964** posiciones |
| **Oficinas vendibles** | OF PA1 10 · PA2 10 · PA3 15 · PA4 15 — disponibles | **50 m²** |
| **Coworking Premium** | 6×6 + 3×4 + 2×4 = 56 puestos; 100% disponible | **11 islas** |
| **Corporativo interno** | CEO, Gerencia, Dirección Op., Conferencias, Recepción, Archivo, Asistencia | sin m² (no vendible) |
| **Público/Servicio** | Comedor coworking, vestuarios, Sala Cómputos, Área Mantenimiento | sin m² |
| **Maniobra (descubierto)** | Playa 820 + Playón 880 + Plazoleta | 1.700 m² (no vendible, no cubierta) |

> Validación por código (`tsx`): ANMAT = 1.441 (27 sectores) · CG = 2.520 · vendible disponible = 157 m² (107 ANMAT + 50 oficinas) — **OK**.

---

## 4. Selectores de Comercial Readiness (Fase 3, implementados)

Funciones puras para CRM / Dashboard Corporativo de Vacancia:

| Función | Resultado |
|---|---|
| `getAvailableAnmatM2()` | 107 m² (PB30) |
| `getAvailableGeneralM2()` | 0 m² |
| `getAvailableOfficeM2()` | 50 m² (OF PA1–PA4) |
| `getAvailableRackPositions()` | 0 (PB1/PB4 ocupados; capacidad 964) |
| `getCoworkingAvailability()` | 11 islas · 56 puestos · 100% |
| `getMagaldiCommercialSummary()` | resumen ejecutivo consolidado |

Casos de uso CRM:
- *"Cliente pide 100 m² ANMAT"* → PB30 (107 m²) disponible.
- *"Cliente pide depósito CG"* → **sin disponibilidad** hoy (todos ocupados); ofrecer Luján.
- *"Cliente quiere coworking"* → 11 islas / 56 puestos, 100% disponible.

---

## 5. Pendiente / consolidación

- Reconciliación seed `warehouse_*` (S→PB) — diseñada, no ejecutada.
- `.docx` de auditoría — revisar si surge discrepancia con el HTML.
- **Dashboard Corporativo de Vacancia** — consolidará Magaldi + Luján. Los selectores de ambas sedes (`getMagaldiCommercialSummary` / `getCommercialAvailabilitySummary`) son la interfaz común; ahí conviene **generalizar** un `SiteModel`/`<SiteMap/>` compartido (aterriza en main con autorización).
