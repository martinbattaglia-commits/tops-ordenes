# MAPA-LUJAN-NAMING-REFINEMENT — TOPS NEXUS

**Fecha:** 2026-06-08 · Refinamiento UX/UI: nomenclatura visual de cubículos ANMAT (Mapa Luján).
**Tipo:** **solo visual.** No toca crm_units, reservas, disponibilidad, colores, Digital Twin, deep links, joins ni identificadores internos.

---

## Cambios realizados

### Nomenclatura visual (lo que ve el usuario)
| Bloque (interno) | ANTES (mostrado) | DESPUÉS (mostrado) |
|---|---|---|
| `PA3+PA7` (floor P1) | `PA3+PA7` | **`PA3`** + subtítulo **`PRIMER PISO`** |
| `PA4-PA5` (floor P2) | `PA4-PA5` | **`PA4`** + subtítulo **`SEGUNDO PISO`** |

### Cómo se deriva (sin hardcodear los 2 casos de forma frágil)
`src/app/(app)/comercial/mapa-lujan/LujanMapView.tsx`:
```ts
const FLOOR_DISPLAY: Record<FloorCode,string> = { PB:"PLANTA BAJA", P1:"PRIMER PISO", P2:"SEGUNDO PISO" };
function blockDisplay(block) {
  return { label: block.code.split(/[+-]/)[0], floor: FLOOR_DISPLAY[block.floor] };
}
// "PA3+PA7" → "PA3" · "PA4-PA5" → "PA4" · piso desde block.floor
```

### Dónde se aplica
1. **`CubicleBlockCard`** (card del bloque en el grid): título `blockDisplay(block).label` (más grande/legible) + línea de piso debajo.
2. **`CubicleDetail`** (panel lateral): título `{label} · {cubicle.code}` (ej. `PA3 · C01`) + línea de piso.

### Estilo (consistente con Nexus)
- Título: `font-mono text-2xl font-black text-fg-primary tracking-tight` (más grande, más bold, **blanco** vía token `text-fg-primary`).
- Piso: `text-[11px] font-bold uppercase tracking-wider text-fg-primary` (blanco, legible, mayúsculas).
- Sin colores hardcodeados (usa tokens Nexus → dark-mode correcto).

---

## Lo que NO se tocó (garantías)
| Elemento | Estado |
|---|---|
| `block.code` (identificador interno) | **intacto** (`PA3+PA7`, `PA4-PA5`) |
| Cubículos reales | **intactos** (`PA3+PA7-C01`, `PA4-PA5-C01`, …) |
| Join a crm_units `unitStates[`${b.code}-${c.code}`]` | **intacto** (línea 117 / 545) |
| Deep link `resUnit=…${block.code}-${cubicle.code}` | **intacto** (línea 569) |
| Estado / colores (`UNIT_STATE_COLOR`) | **intactos** |
| Disponibilidad / reservas / lógica comercial | **sin cambios** |
| Export CSV (`b.code·c.code`) | **intacto** |
- El buscador sigue indexando `b.code`, así que buscar `PA3+PA7` **o** `PA3` encuentra el bloque.

---

## Evidencia técnica
- `tsc --noEmit` → **PASS**.
- `next build` → **PASS**; `/comercial/mapa-lujan` compila (`ƒ` dynamic, 6.19 kB).
- `grep` confirma joins/href/csv siguen usando `block.code`/`cubicle.code` reales (sin cambios).

---

## Validación (QA · usuario, sesión real)
Servida en dev `:3030` y/o prod tras redeploy. Marcar:

| Verificación | Esperado | Resultado |
|---|---|---|
| Bloque superior | `PA3` + `PRIMER PISO` (no `PA3+PA7`) | ☐ |
| Bloque inferior | `PA4` + `SEGUNDO PISO` (no `PA4-PA5`) | ☐ |
| Panel cubículo (1º piso) | `PA3 · C0x` + `PRIMER PISO` | ☐ |
| Panel cubículo (2º piso) | `PA4 · C0x` + `SEGUNDO PISO` | ☐ |
| Reservar un cubículo → CRM360 precarga | unidad sigue siendo `PA3+PA7-C0x` / `PA4-PA5-C0x` (código real) | ☐ |
| Colores/estado por cubículo | sin cambios (verde/rojo/amarillo según crm_units) | ☐ |
| **Desktop** | título grande, blanco, legible | ☐ |
| **Mobile** | título y piso legibles, sin recorte | ☐ |
| **Dark mode** | texto blanco con buen contraste | ☐ |
| **Contraste/legibilidad** | piso en mayúsculas legible | ☐ |

---

## Despliegue
Cambio de **código** (componente de UI) → requiere commit + push a `main` + redeploy para verse en prod. (Pendiente de tu OK; en dev `:3030` ya se ve.)

## Resultado
El usuario comercial lee de inmediato **PA3 = Primer Piso** y **PA4 = Segundo Piso**, sin nomenclatura técnica, mientras los identificadores internos (`PA3+PA7-C0x`, `PA4-PA5-C0x`) y toda la lógica de reservas/crm_units quedan exactamente igual.
