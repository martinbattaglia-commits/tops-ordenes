# VACANCY_SOURCE_OF_TRUTH_ANALYSIS

**Módulo:** CRM Comercial — Definición de la fuente oficial de vacancia
**Fase:** Pre-F2.1 (bloqueante del dashboard y del forecast)
**Fecha:** 2026-06-04
**Estado:** ✅ **DECISIÓN RATIFICADA (2026-06-04)** — ver §7
**Alcance:** análisis y decisión de fuente. **Sin migraciones, sin DDL, sin RLS, sin código.**
**Relacionado:** [MASTER_PLAN](./COMMERCIAL_MODULE_MASTER_PLAN.md) · [KPI_DASHBOARD §2.6](./COMMERCIAL_KPI_DASHBOARD.md) · [DATA_MODEL](./CLIENTIFY_NEXUS_DATA_MODEL.md)

> **DECISIÓN OFICIAL:** La vacancia queda anclada al **Digital Twin (`warehouse_*`)**, granularidad **Opción A (sector)**. No se avanza a granularidad de posición por ahora. Justificación: el objetivo inmediato es **Forecast Comercial**, comercial trabaja en **m²**, operación ya dispone de la vista booleana por posición, y la granularidad sector da vacancia útil sin esperar el relevamiento completo de Magaldi.

> **Pregunta que este documento responde:** ¿cuál es la única fuente oficial de vacancia (m² ocupados / libres / comprometidos / capacidad total) para todo TOPS Nexus, y está hoy esa fuente en condiciones de alimentar el KPI?

---

## 0. Resumen ejecutivo (TL;DR)

1. **La capacidad total en m² SÍ existe en Supabase**, modelada y sembrada con datos oficiales de planos de incendio, en el **Digital Twin** (`warehouse_sectors.surface_m2`). Magaldi está certificado; Luján es provisional.
2. **La ocupación SÍ se deriva hoy automáticamente del inventario** — es código real y funcionando (`src/lib/wms/twin.ts`, "Sprint 2"). Pero la deriva es a nivel **posición (booleano ocupado/libre)**, NO en m².
3. **La vacancia en m² NO es computable hoy**, por un desajuste estructural: la **capacidad** vive a nivel *sector* (con m²) y la **ocupación** vive a nivel *posición* (sin m² cargados y sin posiciones sembradas en Magaldi). Los dos niveles no se tocan.
4. **No hay evidencia de que la vacancia viva en Neuralsoft.** Neuralsoft es el ERP **financiero** (facturación, proveedores, tesorería, contabilidad) que Nexus está reemplazando. La ocupación física real probablemente vive hoy en **operación (planillas / WMS legacy "Deonics")**, no en Neuralsoft — **a confirmar con operaciones** (§4).
5. **Fuente oficial propuesta:** el **Digital Twin (`warehouse_*`)** como única verdad de capacidad y ocupación, con la **ocupación derivada del inventario** (patrón ya existente). Para que produzca m², hay que tomar **una** de dos decisiones de granularidad (§5).

---

## 1. Dónde vive hoy cada dato (inventario de fuentes)

### 1.1 Capacidad total — **EXISTE y está sembrada**
Jerarquía física de 6 niveles del Digital Twin (`0020_wms_physical_model.sql`), derivada de los planos de incendio aprobados por GCABA:

```
warehouses → warehouse_floors → warehouse_sectors → warehouse_zones → warehouse_racks → warehouse_positions
```

| Nivel | Columna de m² | Estado del dato | Evidencia |
|---|---|---|---|
| `warehouses.surface_m2` | total de sede | Magaldi = **6.893,87 m²** (certificado); Luján = **NULL** ("a validar") | `0020:207-211` |
| `warehouse_floors.surface_m2` | por piso | nullable, sin sembrar | `0020:70` |
| `warehouse_sectors.surface_m2` | **por sector** | **SEMBRADO con datos oficiales de plano** | `0020:232-279` |
| `warehouse_positions.surface_m2` | por posición/cubículo | declarado "OBLIGATORIO" pero **las 24 posiciones sembradas tienen NULL** | `0020:126`, `0023:45-46` |

**m² sembrados a nivel sector (la capacidad real disponible hoy):**
- **Magaldi PB** (s/planilla incendio 460/19): S1 564,68 · S2 786,02 · S3 793,30 · S4 306,31 · S5 990,27 → **3.440,58 m² de almacenamiento**.
- **Luján** (provisional s/plano 717/11): D1 895,05 · D2 **NULL** · D3 885,85 · D4 970,56 · D5 806,50 · D8 356,85 · D7 189,47 · D6 350,78 → **~4.455 m² (con D2 faltante)**.

> La capacidad existe, pero **es heterogénea**: Magaldi total certificado, Luján provisional y con un sector (D2) sin m².

### 1.2 Ocupación — **se DERIVA hoy, pero a nivel posición (sin m²)**
- El estado físico/manual vive en `warehouse_positions.status` (`disponible`/`reservado`/`ocupado`/`mantenimiento`, `0020:25-32`).
- La **ocupación efectiva NO se guarda: se deriva en tiempo de lectura** desde el inventario, en `src/lib/wms/twin.ts` (`getTwin`):
  - regla (`twin.ts:9-15, 66-92, 208-237`): `mantenimiento` gana; si la posición tiene `inventory_items` con `stock_available + stock_reserved > 0` → **`ocupado`**; si no → el estado guardado.
  - "una sola fuente (el inventario) decide qué está ocupado" — `twin.ts:14-15`.
- La UI ya lo refleja: `operaciones/mapa-inteligente/page.tsx:46` dice *"la ocupación se deriva automáticamente del inventario"*.

**Limitación:** la salida es **booleana por posición** (`occupied: boolean`, `twin.ts:32`). No produce m² ocupados. Y depende de que existan posiciones cargadas con inventario.

### 1.3 Ocupación ↔ cliente (depositante) — **EXISTE (texto, no FK)**
- `inventory_items.client_name` (texto denormalizado, **no** FK a `clients`) + `inventory_items.position_id` (FK a posición) — `0024:19-20`.
- Permite atribuir posiciones ocupadas a un depositante, pero sin integridad referencial con `clients`.

### 1.4 m² comprometidos (committed) — **NO EXISTE**
- No hay forma hoy de expresar "m² comprometidos por contratos firmados / oportunidades ganadas no onboardeadas".
- Es precisamente lo que aportaría el CRM (`crm_opportunities.m2`, `crm_contracts`) — **futuro**, no existe ([DATA_MODEL §3.2](./CLIENTIFY_NEXUS_DATA_MODEL.md)).

### 1.5 Capa comercial efímera — **hardcodeada, sin fuente**
- `src/lib/ejecutivo/locations.ts` tiene m² hardcodeados (Magaldi 6800, Luján 2800) y **ocupación = `null` "hasta que haya fuente verificable"** (`locations.ts:9-10,19`). Es un reconocimiento explícito de que la fuente de ocupación no está resuelta.

---

## 2. ¿Tiene Nexus una fuente suficiente hoy? — **NO (parcial)**

| Componente de la vacancia | ¿Existe en Nexus? | ¿Suficiente hoy? |
|---|---|---|
| Capacidad total (m²) | Sí, nivel sector (oficial) | **Magaldi sí · Luján parcial** (total sede NULL, D2 NULL) |
| m² ocupados | No directamente; ocupación booleana por posición | **No** (no hay m² por posición; Magaldi sin posiciones) |
| m² libres | Derivable solo si hay ocupados en m² | **No** |
| m² comprometidos | No | **No** (requiere CRM) |
| Ocupación → cliente | Sí (texto) | Parcial (sin FK) |

**Causa raíz del bloqueo (el desajuste de granularidad):**
```
CAPACIDAD  vive a nivel  SECTOR     →  tiene m²  (sembrado)
OCUPACIÓN  vive a nivel  POSICIÓN   →  sin m²    (NULL) y sin posiciones en Magaldi
                                        ▲
                          no hay roll-up posición→sector en m²
```
- Magaldi: **0 posiciones sembradas** (zones/racks/positions requieren relevamiento, `0020:281-282`) → su ocupación no se puede derivar en absoluto.
- Luján: 24 cubículos sembrados pero con `surface_m2 = NULL` (`0023:45-46`) → aunque estén ocupados, no suman m².
- `inventory_items.stock_*` está en **unidades de cantidad** (numeric), no en m² ni con footprint → el inventario no dice cuántos m² consume.

> **Conclusión:** Nexus tiene la **estructura correcta** y el **mecanismo de derivación ya construido**, pero le faltan **datos** (posiciones + m² por posición) o **una decisión de modelo** (medir ocupación a nivel sector) para producir vacancia en m².

---

## 3. ¿Qué vive únicamente en Neuralsoft?

**Hallazgo: la vacancia NO es un dato de Neuralsoft.** Toda referencia a Neuralsoft en el repo lo describe como ERP **financiero** a reemplazar:
- "sistema financiero que reemplaza a Neuralsoft (AP / cuentas por pagar)" — `0014_supplier_invoices.sql:7`.
- Alcance de reemplazo: Facturación + Proveedores + Tesorería + Cuentas Corrientes + Contabilidad — `docs/erp-arquitectura-objetivo.md:6,315`.
- "reemplazar progresivamente Neuralsoft/Deonics, Clientify, Excel" — `docs/TOPS-NEXUS-ERP.md:12`.

Ninguna función de Neuralsoft documentada cubre ocupación/m²/vacancia de depósito. **Lo que probablemente vive fuera de Nexus** (a confirmar, no asumido):
- La **ocupación física real día a día** (qué cubículo/sector está realmente ocupado) — hoy plausiblemente en **planillas operativas / WMS legacy ("Deonics")**, no en Neuralsoft.
- El **m² oficial de Luján** y el **m² por cubículo** — en planos municipales / relevamiento físico pendiente, no en sistema.

> ⚠️ **No afirmo** que estos datos estén en Neuralsoft: la evidencia del código apunta a que Neuralsoft es financiero. La fuente real de la ocupación legacy debe **confirmarse con operaciones** (§4). El handoff maestro prohíbe tocar Neuralsoft sin autorización, pero para vacancia probablemente **ni siquiera es la fuente relevante**.

---

## 4. Preguntas a cerrar con operaciones (antes de fijar la fuente)

1. **¿Dónde está hoy la verdad de ocupación física?** ¿Planilla? ¿Deonics? ¿La cabeza del jefe de depósito? (Determina si Nexus debe importar un baseline o si se construye desde el inventario WMS).
2. **¿Cuál es el m² oficial de Lu蜡jan** (sede total) y el **m² de cada cubículo / sector D2**? (Hoy NULL en `warehouses.surface_m2` y `warehouse_sectors`).
3. **¿La vacancia se mide por m² o por posiciones/cubículos?** Comercial cotiza en m² (cotizador: ANMAT $80k/m², general $20k/m²); ANMAT opera por cubículos. Puede que la unidad correcta difiera por tipo de servicio.
4. **¿Qué cuenta como "comprometido"?** ¿Contrato firmado? ¿Oportunidad ganada? ¿Reserva operativa (`status=reservado` / `stock_reserved`)?
5. **¿Oficinas entra en la misma vacancia?** El cotizador vende "oficinas" (flex/fijo/privada) — ¿es capacidad del mismo Digital Twin (`sector_type='oficinas'`) o un inventario aparte?

---

## 5. Fuente oficial propuesta

### 5.1 Decisión recomendada
**El Digital Twin (`warehouse_*`) es la ÚNICA fuente oficial de capacidad y ocupación de todo TOPS Nexus.** La vacancia se calcula sobre él, con la ocupación **derivada del inventario** (patrón ya existente en `twin.ts`). No se crea una segunda fuente; `ejecutivo/locations.ts` (hardcode) y cualquier planilla quedan **deprecados** como fuente.

Razones:
- Ya tiene la capacidad oficial (m² de planos de incendio).
- Ya tiene el mecanismo de ocupación derivada construido y en uso por el Mapa Inteligente.
- Es la clave de integración con WMS / Pedidos / Mapa (`0020:11`).
- Es interno a Supabase: gobernable por RLS, auditable, sin depender de Neuralsoft.

### 5.2 Definiciones canónicas de vacancia (conceptuales)
```
capacidad_total_m2   = Σ warehouse_sectors.surface_m2   (por sede / tipo / ANMAT vs general)
m2_ocupados          = m² de las unidades con inventario presente (derivado del inventario)
m2_reservados        = m² de unidades en estado 'reservado' o con stock_reserved > 0
m2_comprometidos     = Σ crm_opportunities.m2 (ganadas, aún no onboardeadas) + contratos firmados   [FUTURO CRM]
m2_libres            = capacidad_total_m2 − m2_ocupados − m2_reservados
vacancia_%           = m2_libres / capacidad_total_m2
vacancia_comercial_% = (m2_libres − m2_comprometidos) / capacidad_total_m2   [vista forecast]
```
- **Ocupación física** (operativa) y **compromiso comercial** (CRM) son dos capas distintas que se restan a la misma capacidad. Esto conecta directamente con forecast/oportunidades/propuestas/contratos del [MASTER_PLAN](./COMMERCIAL_MODULE_MASTER_PLAN.md).

### 5.3 Las dos opciones de granularidad (hay que elegir UNA)

| | **Opción A — Sector (pragmática)** | **Opción B — Posición (granular)** |
|---|---|---|
| Unidad de ocupación | m² ocupados/comprometidos **por sector** | derivada de posiciones con m² |
| Qué falta para habilitarla | asignar/medir m² ocupados por sector (puede partir del inventario o de carga operativa) | relevar zones/racks/positions de Magaldi + cargar `surface_m2` de cada posición (NULL hoy) |
| Esfuerzo de datos | **Bajo** (sectores ya tienen m²) | **Alto** (relevamiento físico completo) |
| Precisión | media (sector entero) | alta (cubículo) |
| Sirve para comercial/forecast | **Sí, ya** | sí, pero más tarde |
| Sirve para operación fina (qué cubículo) | no | sí (ya lo da el twin booleano) |
| Recomendación | **Adoptar como base del KPI comercial ahora** | objetivo a futuro cuando el relevamiento esté completo |

> **Recomendación:** **Opción A (sector) como fuente oficial del KPI de vacancia comercial**, conviviendo con la ocupación booleana por posición que el Mapa Inteligente ya muestra para operación. Es la única que produce vacancia en m² **sin esperar el relevamiento físico** de Magaldi.

### 5.4 Modelo híbrido recomendado (capas)
```
        ┌─────────────────────────────────────────────┐
        │  DIGITAL TWIN  (warehouse_*)  = FUENTE OFICIAL │
        ├───────────────┬─────────────────────────────┤
Capa 1  │ Capacidad m²  │ warehouse_sectors.surface_m2 │  (oficial, existe)
Capa 2  │ Ocupación m²  │ derivada del inventario,      │  (Opción A: por sector)
        │               │ por sector                    │
Capa 3  │ Compromiso m² │ crm_opportunities/contracts   │  (FUTURO CRM)
        └───────────────┴─────────────────────────────┘
                         │
                  vacancia_% = (Capa1 − Capa2 − Capa3) / Capa1
```

---

## 6. Brechas para habilitar el KPI (qué falta, sin implementar)

| # | Brecha | Bloquea | Dueño |
|---|---|---|---|
| G1 | m² oficial de Luján (sede + sector D2) sin cargar (NULL) | capacidad total correcta | Operaciones (relevamiento/plano) |
| G2 | Sin roll-up de ocupación a m² (hoy booleano por posición) | m² ocupados | Decisión de granularidad (§5.3) |
| G3 | Posiciones de Magaldi no sembradas; m² por posición NULL | Opción B | Operaciones (relevamiento) |
| G4 | `inventory_items.client_name` es texto, no FK a `clients` | atribución ocupación→cliente confiable | Datos |
| G5 | m² comprometidos no existen | vacancia comercial / forecast | CRM (F2.1+) |
| G6 | Confirmar que ocupación legacy no depende de Neuralsoft/Deonics | descartar fuente externa | Operaciones |

---

## 7. Decisión oficial ratificada (2026-06-04)

| # | Decisión | Estado |
|---|---|---|
| 1 | **Fuente oficial = Digital Twin (`warehouse_*`)**, ocupación derivada del inventario | ✅ **Ratificada** |
| 2 | **Granularidad del KPI comercial = Opción A (sector)** | ✅ **Ratificada** |
| 3 | **No avanzar a granularidad de posición (Opción B) por ahora** | ✅ **Ratificada** (diferida) |

**Justificación oficial:** objetivo inmediato = Forecast Comercial · comercial trabaja en m² · operación ya tiene la vista booleana por posición · la granularidad sector da vacancia útil sin esperar el relevamiento completo de Magaldi.

### 7.1 KPI oficial de vacancia (definición formalizada)

| Métrica | Definición | Fuente | ¿Lista hoy? |
|---|---|---|---|
| **Capacidad total** | `Σ warehouse_sectors.surface_m2` (por sede / tipo) | Digital Twin (sembrado, oficial) | Magaldi ✅ · Luján ⚠️ (G1) |
| **m² ocupados** | m² de sectores con inventario presente (derivado del inventario, agregado a sector) | Digital Twin + `inventory_items` | Habilitable tras decidir el roll-up sector (§5.4) |
| **m² libres** | `capacidad_total − m² ocupados − m² reservados` | derivado | Tras m² ocupados |
| **m² comprometidos** | `Σ crm_opportunities.m2` (ganadas no onboardeadas) + contratos firmados | CRM (F2.1+) | ❌ Futuro CRM |

> La vacancia queda **oficialmente anclada al Digital Twin**. `ejecutivo/locations.ts` (hardcode) queda **deprecado** como fuente.

### 7.2 Gate de autorización de F2.1 (pasos pendientes)

Dos dependencias **operativas** (no de sistema, fuera de mi alcance) restan antes de habilitar el cálculo en vivo del KPI:

1. **G6 — Confirmar con operaciones** que la ocupación física real no exige un import desde Neuralsoft/Deonics (evidencia del código: Neuralsoft es financiero, no de depósito).
2. **G1 — Cargar el m² faltante de Luján** (sede total `warehouses.surface_m2` + sector D2) — dato de plano/relevamiento.

**Importante:** estos dos pasos **NO bloquean el inicio de F2.1** (DDL + RLS + modelo CRM), porque:
- El **modelo CRM** (oportunidades, cotizaciones, propuestas, contratos, onboarding) no depende de la carga de m² de Luján.
- El **m² comprometido** lo aporta el propio CRM (`crm_opportunities.m2`), que se construye en F2.1.
- La capacidad de Magaldi ya está completa; Luján se completa en paralelo.

Por lo tanto, F2.1 puede autorizarse en cuanto el negocio lo indique; G1/G6 corren en paralelo y solo condicionan el **encendido del número de vacancia en el dashboard**, no la construcción del modelo de datos.

**Este documento no implementa nada.** Fija la fuente oficial. La vacancia queda anclada al Digital Twin.
