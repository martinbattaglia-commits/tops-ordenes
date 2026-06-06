# MAGALDI_DIGITAL_MAP_CODE_AUDIT

**Sede:** Central Corporativa — Agustín Magaldi 1765 / Osvaldo de la Cruz 3201 (CABA)
**Fase:** 0 — Auditoría (cerrada) · **Rama:** `feature/mapa-premium-magaldi-1765` (aislada, sin merge)
**Fecha:** 2026-06-04
**Fuente de verdad (esta etapa):** documentación auditada + croquis entregados — **NO** los seeds de Supabase ni nomenclaturas heredadas.
**Regla:** no inventar datos · documentar toda diferencia.

---

## 1. Fuentes provistas y su rol

| Documento | Rol | Estado |
|---|---|---|
| `Croquis-2-Comercial-CD-Magaldi.html` | **CANÓNICA comercial** — array `D` con cada espacio (id, nombre, m², categoría, estado, racks, notas) | ✅ leído |
| Master prompt · INVENTARIO OFICIAL | **CANÓNICA de control** (totales ANMAT/CG/racks/coworking) | ✅ cruzado |
| `Croquis Magaldi.pdf` / imagen croquis | Plano visual de respaldo | ✅ referencia |
| `Informe-Auditoria-Infraestructura-CD-Magaldi.docx` | Informe de infraestructura | ⚠️ no extraído como texto (binario); el HTML + inventario ya aportan la data estructurada |
| Layout Coworking Premium (imagen) | Distribución de islas/puestos | ✅ referencia |
| Plano incendio Cert. 460/19 | Base legal estructural | ✅ (ya en seed 0020) |

> El HTML comercial y el INVENTARIO OFICIAL del master prompt **cruzan exacto** (ver §3) — alta confianza.

---

## 2. Código del mapa: patrón reutilizable

Igual que Luján: el mapa premium se construye como **vista nueva no destructiva** clonando el patrón (los archivos de Luján viven en su rama, no aquí). Equivalentes Magaldi:

| Luján (otra rama) | Magaldi (esta rama) |
|---|---|
| `src/lib/wms/lujan3159-map.ts` | `src/lib/wms/magaldi1765-map.ts` *(Fase 1)* |
| `src/app/(app)/comercial/mapa-lujan/` | `src/app/(app)/comercial/mapa-magaldi/` *(Fase 2)* |

El audit del código base (mapa operativo `/operaciones/mapa-inteligente`, `twin.ts`, design system, íconos) es el mismo de `docs/lujan/LUJAN_DIGITAL_MAP_CODE_AUDIT.md`. **Magaldi es más complejo** (sede corporativa): exige más categorías (anmat, general, oficina, coworking, pública, servicio, maniobra) y más vistas (Comercial, Infraestructura, ANMAT, Cargas Generales, Coworking, Corporativa, Vacancia).

---

## 3. Inventario canónico (validado por cruce)

### 3.1 Inmueble
| Campo | Valor |
|---|---|
| Domicilio | Agustín Magaldi 1765 / Osvaldo de la Cruz 3201, CABA |
| Titular | VEROTIN S.A. |
| Destino | Depósito de consignatarios en general |
| Superficie cubierta registrada | **6.893,87 m²** |
| Expediente / Certificado | 35391367/2018 · 460/19 |

### 3.2 ANMAT — 1.441 m² (27 sectores PB6–PB32) ✅ cruza
PB6 400 · PB7 70 · PB8 50 · PB9 50 · PB10 50 · PB11 50 · PB12 70 · PB13 30 · PB14 15 · PB15 17 · PB16 17 · PB17 25 · PB18 30 · PB19 17 · PB20 20 · PB21 17 · PB22 17 · PB23 35 · PB24 17 · PB25 17 · PB26 50 · PB27 70 · PB28 60 · PB29 60 · PB30 **107 (DISPONIBLE)** · PB31 70 · PB32 10.
**Σ = 1.441 m²** (ocupado 1.334 · disponible 107). Único disponible: **PB30**.

### 3.3 Cargas Generales — 2.520 m² (6 depósitos, todos OCUPADOS) ✅ cruza
PB1 900 (400 pos. racks selectivos) · PB2 300 (150 1er piso + 150 altillo) · PB3 100 · PB4 1000 (564 pos. racks selectivos) · PB5 100 · PB5A 120 (tinglado).
**Σ = 2.520 m²**.

### 3.4 Racks — 964 posiciones selectivas ✅ cruza
PB1 400 · PB4 564. **Ambos sectores OCUPADOS** → posiciones comercialmente disponibles hoy: **0** (capacidad instalada 964).

### 3.5 Coworking
- **Oficinas vendibles (50 m²):** OF PA1 10 · OF PA2 10 · OF PA3 15 · OF PA4 15 — DISPONIBLES.
- **Coworking Premium (100% disponible):** 11 islas · 56 puestos = 6 islas×6 (36) + 3 islas bajas×4 (12) + 2 islas mesa alta×4 (8). Se comercializa **por isla**; incluye Wi-Fi Starlink, recepción, comedor, vestuarios, sala de conferencias, estacionamiento.

### 3.6 Corporativo / interno (no vendible, sin m² en croquis)
CEO · Gerencia Comercial · Dirección Operativa · Sala de Conferencias · Recepción · Sala Archivo · Asistencia Ejecutiva · Comedores/Vestuarios · Sala de Cómputos · Área Servicio Mantenimiento.

### 3.7 No vendible / descubierto
Playa de Maniobras 820 m² · Playón de Maniobras 880 m² (**descubiertos** — NO computan en los 6.893,87 cubiertos) · Plazoleta de Desconsolidado.

---

## 4. Inconsistencias documentales detectadas (no resueltas en silencio)

| # | Inconsistencia | Resolución propuesta |
|---|---|---|
| **M-1** 🔴 | **Seed Supabase `0020` usa S1–S5** (plano incendio, ~3.440 m²) vs realidad comercial **PB1–PB32 + OF/PA + coworking**. No mapeable. | Canónico = **codificación PB/OF/PA del croquis comercial** (el master prompt prohíbe usar seeds como fuente). Reconciliación del seed = futura, con autorización. |
| **M-2** 🟠 | **Colisión de códigos PB1/PB2/PB3:** designan a la vez **depósitos CG** (PB1 900, PB2 300, PB3 100) y **oficinas** ("Oficinas PB1" 50, "Oficinas PB2" 10, "Oficinas PB3" 50). | Desambiguar en el modelo: `DEP-PB1` (depósito) vs `OF-PB1` (oficina). Se conserva la etiqueta visible del croquis + id único interno. |
| **M-3** 🟡 | **Cuadre de superficie cubierta:** 6.893,87 m² registrados vs storage medido (ANMAT 1.441 + CG 2.520 = 3.961) + oficinas (~210) = ~4.171. ~2.722 m² de cubierta (oficinas internas, áreas públicas, servicios, circulación) **no están desglosados** en el croquis. | No se infiere el reparto. Se marca el remanente como "cubierta no desglosada" `confidence: pending`. |
| **M-4** 🟡 | **Maniobra descubierta (Playa 820 + Playón 880 = 1.700 m²)** podría confundirse con superficie cubierta. | Se modela como `maniobra` / `no vendible` / descubierto; **no** suma a los 6.893,87 ni a vendible. |
| **M-5** 🟡 | `Informe-...-Magaldi.docx` no extraído como texto (binario). | El HTML comercial + inventario oficial ya proveen la data estructurada y cruzan; el .docx queda como respaldo a revisar si surge discrepancia. |
| **M-6** 🟢 | Numeración ANMAT no contigua espacialmente (PB6 grande 400 m²; PB7–PB12 medios; PB13–PB29 chicos). | Consistente con el croquis; sin acción (solo nota). |

---

## 5. Nomenclatura oficial propuesta

- **Sectores ANMAT:** `PB6`–`PB32` (27). 
- **Depósitos CG:** `PB1`–`PB5`, `PB5A`.
- **Oficinas:** `OF-PB1/2/3` (planta baja) · `OF-PA1/2/3/4` (planta alta, coworking vendible).
- **Coworking Premium:** bloque `CWP` (se vende por isla).
- **Corporativo interno:** `CEO`, `GER`, `DIROP`, `CONF`, `RECEP`, `ARCH`, `ASIST`.
- **No vendible:** `PLAYA`, `PLAYON`, `PLZ` (maniobra/descubierto); `SCOMP`, `ASERV` (servicio); comedores/vestuarios (pública).

> Esta nomenclatura PB/OF/PA es la **fuente oficial** para el mapa comercial y para el futuro Dashboard Corporativo de Vacancia.

---

## 6. Conclusión

- ✅ **Fase 0 cerrada** con data canónica validada (cruce HTML ↔ inventario oficial exacto en ANMAT 1.441 / CG 2.520 / racks 964 / coworking 50 m² + 11 islas).
- ✅ Inconsistencias documentadas (M-1…M-6); nomenclatura oficial propuesta.
- ▶️ **Habilitadas Fase 1 (modelo tipado) → Fase 2 (UI) → Fase 3 (readiness) → Fase 4 (QA)**, con datos reales y sin inventar.
