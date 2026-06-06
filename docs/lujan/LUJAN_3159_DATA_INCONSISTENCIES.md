# LUJAN_3159_DATA_INCONSISTENCIES

**Sede:** Pedro Luján 3159 · **Fecha:** 2026-06-04
**Mandato:** "No inventar datos. No corregir silenciosamente inconsistencias. Si hay diferencias entre croquis, informe e imágenes, documentarlas y elegir una fuente canónica justificada."
**Fuente canónica elegida:** `Informe_Auditoria_Deposito_Lujan_3159_rev2.pdf` (relevamiento Dirección 04/06/2026), corroborado por los cuadros sinópticos de Superficies y Ocupación. Los planos Mecalux son canónicos para **racks**; los croquis ANMAT para **cubículos**.

> Cada inconsistencia indica: qué dicen las fuentes, cuál se adopta y por qué, y cómo queda marcada en `src/lib/wms/lujan3159-map.ts` (campo `confidence`).

---

## #1 — Codificación de sectores: D1–D8 (seed Supabase) vs PB1–PB15 / PA (rev2) 🔴 CRÍTICA

| Fuente | Codificación | Total |
|---|---|---|
| Seed Supabase `0020`/`0023` | **D1–D8** ("provisional s/plano 717/11"), D2 en NULL; 24 cubículos en D7/D6 | ~4.455 m² |
| Informe rev2 (canónico) | **PB1–PB8 · PB10/11/15 · PA1/PA2** + cubículos PA3+PA7 / PA4-PA5 | **5.928 m²** |

- **No son mapeables 1:1.** Coinciden por m² solo PB5≈D4 (970) y PB8≈D5 (806); el resto no.
- **Decisión:** se adopta la codificación **PB/PA del rev2** como canónica para el mapa comercial. El seed D-code queda marcado como **desactualizado/provisional**.
- **Acción pendiente (NO ejecutada):** reconciliar `warehouse_sectors` (D→PB) vía migración futura **con autorización**. Mientras tanto, el data model local `lujan3159-map.ts` es la fuente del mapa comercial y de la vacancia comercial.
- **Impacto:** la [fuente oficial de vacancia](../comercial/VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md) (`warehouse_sectors.surface_m2`) hoy refleja los D-codes provisionales, no la realidad. **Requiere decisión de Dirección** antes de migrar.

---

## #2 — 2º piso: PA4 vs PA5 🟠

- **Croquis visual** rotula el bloque de cubículos del 2º piso como **PA4**; el **informe** lo menciona como **PA5**.
- **Decisión:** usar etiqueta combinada **"PA4-PA5"** en la visualización hasta que Dirección confirme la nomenclatura. `confidence: 'pending'` en el bloque del 2º piso.
- No afecta superficies (258 m²) ni estado (12 cubículos disponibles).

---

## #3 — PB3: ocupación por ala (derecha/izquierda) 🟠

- Rev2: Divanlito ocupa el **ala derecha**; ala izquierda disponible. Ocupación **~250/250 m²** (estimada).
- **Decisión:** `status: 'parcial'`, `occupiedM2: 250`, `availableM2: 250`, `confidence: 'approximate'`, nota "a confirmar por calle/posición contra plano Mecalux 1037501-1". Posiciones de rack disponibles = `null` (a confirmar).

---

## #4 — PB6: ocupación 30% / 70% 🟠

- Rev2: ocupación compartida **~30% (152 m²)** / disponible **~70% (354 m²)**, "Clientes varios".
- **Decisión:** `status: 'parcial'`, `occupiedM2: 152`, `availableM2: 354`, `confidence: 'approximate'`, `client: 'Clientes varios'`.

---

## #5 — Superficie del inmueble vs almacenamiento vs vendible 🟡

- El inmueble ronda **~7.500 m²** (cubierta + descubierta + playones). La superficie de **almacenamiento** es **5.928 m²**. La **vendible** es un subconjunto (excluye playón de maniobra, circulaciones, oficinas, sanitarios, carga/descarga, parking).
- **Decisión:** el modelo separa `meta.buildingM2Approx = 7500` (`approximate`, NO vendible) de `meta.totals.storageM2 = 5928` (`exact`). El playón/maniobra **no se computa como vendible** (mandato explícito). La "superficie vendible" se deriva de `availableM2` por sector, no del total del inmueble.

---

## #6 — m² ANMAT corregidos por Dirección 🟡

- PB10 **16 m²** (antes 30) · PB11 **12 m²** (antes 30) · PB15 **30 m²** (antes 60).
- **Decisión:** se adoptan los valores **corregidos**; cada sector lleva nota "Superficie corregida por Dirección". `confidence: 'exact'`.

---

## #7 — Cubículos 1º piso: lista de ocupados mal numerada en el prompt 🟡

- El texto del master prompt lista 6 "Ocupados" numerados 1–6, pero su 6º ítem ("Bonfarto Salud SA — 25 m²") corresponde al **cubículo 12** (25 m²), y luego repite "Cubículo 6 — 18 m²" entre los Disponibles.
- El **pie del cuadro de ocupación** (canónico) dice ocupados: **1, 2, 3, 4, 5, 12**; disponibles: **6, 7, 8, 9, 10, 11**.
- **Decisión:** se adopta el cuadro: ocupados C01–C05 (18 m²) + C12 (25 m²) = **115 m²**; disponibles C06 (18) + C07–C11 (25×5) = **143 m²**. Suma 258 ✓.

---

## #8 — Posiciones de rack: total y desglose 🟢 (consistente)

- PB1 434 (410 penetrable + 24 selectivo) · PB2 248 · PB3 483 · PB8 248 = **1.413** (1.389 penetrables + 24 selectivas).
- Coincide entre informe, cuadro de superficies y planos Mecalux (951207-1, 1762646-1, 1037501-1, 1764929-1). `confidence: 'exact'`.

---

## Verificación de cuadre (totales) 🟢

| Control | Cálculo | Resultado |
|---|---|---|
| Cargas generales PB (8 dep) | 805+997+500+300+970+506+300+806 | **5.184** ✓ |
| + PA1 | 5.184 + 100 | **5.284** ✓ |
| ANMAT | 58 (PB10/11/15) + 70 (PA2) + 258 + 258 | **644** ✓ |
| Total almacenamiento | 5.284 + 644 | **5.928** ✓ |
| Disponible (derivado del modelo) | Σ availableM2 sectores + cubículos | **3.613** ✓ |
| Ocupado | 5.928 − 3.613 | **2.315** ✓ (39%) |

> El data model `lujan3159-map.ts` reproduce 3.613 / 2.315 m² vía `getCommercialAvailabilitySummary()` — verificado con typecheck verde.

---

## Decisiones que requieren ratificación de Dirección

| # | Decisión pendiente | Bloquea |
|---|---|---|
| #1 | ¿Migrar `warehouse_sectors` de D-codes a PB-codes? ¿Cuándo? | Vacancia oficial correcta + coherencia Digital Twin |
| #2 | Nomenclatura definitiva 2º piso (PA4 o PA5) | Etiqueta final (cosmético) |
| #3 | Confirmar split real PB3 por calle/posición | Precisión de m² disponibles |
| #4 | Confirmar % real PB6 | Precisión de m² disponibles |
