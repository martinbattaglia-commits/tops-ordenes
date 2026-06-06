# TOPS_CORPORATE_CAPACITY_ARCHITECTURE

**Frente:** Dashboard Corporativo de Vacancia y Capacidad TOPS
**Fase:** 0 — Arquitectura de consolidación (solo diseño · sin código · sin merge · sin tocar main)
**Fecha:** 2026-06-04
**Objetivo:** consolidar los dos Digital Twins (Pedro Luján 3159 + Agustín Magaldi 1765) en una **única fuente corporativa** de capacidad/vacancia, base oficial del futuro CRM Comercial.
**Relacionado:**
[Luján data model](../lujan/LUJAN_3159_DIGITAL_TWIN_DATA_MODEL.md) ·
[Magaldi data model](../magaldi/MAGALDI_1765_DIGITAL_TWIN_DATA_MODEL.md) ·
[Vacancy SoT](../comercial/VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md) ·
[KPI Dashboard](../comercial/COMMERCIAL_KPI_DASHBOARD.md)

---

## 0. Resumen ejecutivo

Hay **dos modelos tipados**, cada uno en su rama aislada, con **formas distintas**:

| | Luján (`lujan3159-map.ts`) | Magaldi (`magaldi1765-map.ts`) |
|---|---|---|
| Rama | `feature/mapa-premium-lujan-3159` (`c1e4fb4`) | `feature/mapa-premium-magaldi-1765` (`8f35e6a`) |
| Forma | `sectors[]` + `cubicleBlocks[]` | `spaces[]` (plano) + `coworkingPremium` |
| Estados | ocupado / parcial / disponible | disponible / ocupado / interno / na |
| Categorías | general · anmat | anmat · general · oficina · coworking · publica · servicio · maniobra |
| Base de capacidad | almacenamiento 5.928 m² (todo vendible) | cubierta 6.893,87 m² (solo 4.011 vendible) |

**No se pueden sumar directamente.** La solución: **NO unificar los modelos fuente**, sino introducir un **contrato normalizado (`SiteCapacity`)** al que cada sede se adapta. El dashboard consume solo la forma normalizada. Patrón: *adapter + aggregator*.

---

## 1. Cómo integrar dos modelos que viven en ramas distintas

### 1.1 Problema
El dashboard necesita **ambos** `*-map.ts`, hoy en ramas separadas, sin merge a main. No se puede importar de otra rama.

### 1.2 Opciones de integración (git)

| Opción | Qué hace | Pros | Contras |
|---|---|---|---|
| **A — Rama de integración (recomendada)** | Crear `feature/dashboard-vacancia-corporativo` **desde main**; **mergear ambas feature branches** dentro de ella (merge feature↔feature, **nunca a main**); agregar adapters + selectores + dashboard | Trae ambos modelos con historia; aislado de main; reproducible | Arrastra también ambas UIs (inocuo) |
| B — Copia selectiva | Misma rama de integración; copiar **solo los dos `*-map.ts`** (capa de datos), no las UIs | Liviano; el dashboard depende solo de datos | Duplicación → riesgo de drift vs. ramas fuente |
| C — Promover a main | Llevar contrato + ambos modelos a main como fundación, luego construir | Limpio a largo plazo | **Toca main — excluido ahora** |

**Recomendación: Opción A.** "Sin merge" se respeta como *no merge a main*; mergear features dentro de una rama de integración es legítimo y preserva trazabilidad. Cuando el dashboard esté validado, el **end-state** es la Opción C (con autorización): el contrato `SiteCapacity` + los modelos graduados a main como fundación canónica compartida.

### 1.3 Regla de oro
Los **modelos fuente de cada sede no se modifican ni se fusionan** entre sí. Permanecen como *source of truth* por sede. La consolidación ocurre **una capa arriba**, vía adapters.

---

## 2. Diseño del `SiteModel` corporativo compartido (contrato)

### 2.1 Contrato normalizado (conceptual — no es código aún)

```
CategoryCapacity { capacityM2, occupiedM2, availableM2 }     // por categoría

SiteCapacity {                                                // 1 por sede
  siteCode, siteName,
  categories: { anmat: CategoryCapacity, general: CategoryCapacity, oficina: CategoryCapacity },
  racks:      { totalPositions, availablePositions, pending? },
  coworking?: { islas, puestos, disponiblePct },              // solo Magaldi
  cubiculos?: { total, available },                           // solo Luján (ANMAT)
  totals:     { comercializableM2, ocupadoM2, disponibleM2, vacanciaPct },
  excluded:   { maniobraM2, internoM2, noDesglosadoM2 },      // transparencia: lo NO vendible
  confidence: 'exact' | 'mixed' | 'pending',
  sources: string[]
}

CorporateCapacity {                                           // agregado
  sites: SiteCapacity[],
  byCategory: { anmat, general, oficina } (CategoryCapacity consolidada),
  racks, coworking, cubiculos,
  totals: { comercializableM2, ocupadoM2, disponibleM2, vacanciaPct },
  generatedAt
}
```

### 2.2 Adapters por sede (puros, en la rama de integración)
- `toSiteCapacity(LUJAN_3159) → SiteCapacity` — mapea `sectors[] + cubicleBlocks[]` a categorías ANMAT/CG; racks desde `rack`; cubículos desde bloques.
- `toSiteCapacity(MAGALDI_1765) → SiteCapacity` — mapea `spaces[]` por categoría; coworking desde `coworkingPremium`; **excluye** maniobra/interno/público/servicio del comercializable.

El dashboard importa **solo** los adapters → `SiteCapacity[]`, nunca los modelos crudos.

### 2.3 Decisión de normalización crítica — "base comercializable"
Para que las sedes sean **comparables y sumables sin distorsión**, la capacidad corporativa se mide sobre **superficie comercializable** (ANMAT + Cargas Generales + Oficinas vendibles), **no** sobre superficie cubierta/total:

| Sede | Cubierta / Almacenamiento | **Comercializable** | Excluido |
|---|---|---|---|
| Luján | 5.928 m² (almacenamiento) | **5.928** (todo es storage ANMAT/CG) | — |
| Magaldi | 6.893,87 m² (cubierta) | **4.011** (ANMAT 1.441 + CG 2.520 + oficinas 50) | ~2.722 cubierta no desglosada (interno/público/servicio) + 1.700 maniobra descubierta |

> Esta asimetría se hace **explícita** en `excluded`. La vacancia corporativa se calcula sobre comercializable, no sobre cubierta — evita comparar peras con manzanas.

---

## 3. KPIs corporativos

### 3.1 Definiciones
| KPI | Fórmula | Fuente |
|---|---|---|
| Capacidad comercializable total | Σ sedes (ANMAT + CG + Oficinas) m² | adapters |
| Ocupado total | Σ sedes ocupado m² | adapters |
| Disponible total | Σ sedes disponible m² | adapters |
| **Vacancia corporativa %** | disponible / comercializable | derivado |
| Por categoría | ANMAT / CG / Oficinas (cap · ocup · disp) consolidadas | adapters |
| Por sede | comparativa Luján vs Magaldi | adapters |
| Racks | posiciones totales / disponibles | adapters |
| Coworking | islas / puestos / % disponible | Magaldi |
| Cubículos ANMAT | total / disponibles | Luján |
| Mix de disponibilidad | % del disponible que es ANMAT vs CG vs Oficinas | derivado |

### 3.2 Consolidación ilustrativa (cifras reales de ambos modelos)

> Validadas: Luján (ANMAT cap 644/disp 401 · CG 5.284/3.212 · racks 906/1.413 · cubículos 18/24 · total disp 3.613). Magaldi (ANMAT 1.441/107 · CG 2.520/0 · oficinas 50/50 · racks 0/964 · cowork 11i·56p).

| Categoría | Capacidad m² | Disponible m² | Vacancia % |
|---|---|---|---|
| **ANMAT** | 644 + 1.441 = **2.085** | 401 + 107 = **508** | 24,4% |
| **Cargas Generales** | 5.284 + 2.520 = **7.804** | 3.212 + 0 = **3.212** | 41,2% |
| **Oficinas** | 0 + 50 = **50** | 0 + 50 = **50** | 100% |
| **TOTAL comercializable** | **9.939** | **3.770** | **37,9%** |

- **Racks selectivos:** 2.377 posiciones (Luján 1.413 + Magaldi 964) · disponibles **≥ 906** (PB3 Luján pendiente).
- **Coworking Premium:** 11 islas · 56 puestos (100% disponible, solo Magaldi).
- **Cubículos ANMAT:** 24 totales · **18 disponibles** (solo Luján).

> Cifras sujetas a los *confidence* ya documentados (Luján PB3/PB6 estimados; Magaldi cubierta no desglosada). El dashboard mostrará el `confidence` por celda.

> **Refinamiento (Fase 1):** el motor implementado (`corporate-capacity.ts`) cuenta las **oficinas rentadas/ocupadas** (OF-PB, 110 m²) dentro de Oficinas comercializables → Oficinas capacidad **160 m²** (no 50), total comercializable **10.049 m²** y vacancia **37,5%**. Las cifras precisas están en [CORPORATE_CAPACITY_ENGINE_REPORT](./CORPORATE_CAPACITY_ENGINE_REPORT.md); las de esta tabla eran ilustrativas.

### 3.3 Lecturas ejecutivas que habilita
- "Hoy TOPS puede vender **3.770 m²** comercializables (37,9% de vacancia)."
- "Cargas Generales es el grueso disponible (3.212 m², casi todo en Luján)."
- "ANMAT escaso: solo 508 m² (107 Magaldi + 401 Luján, mayormente cubículos)."
- "Oficinas/coworking: 50 m² + 11 islas, 100% en Magaldi."

---

## 4. Selectores reutilizables (corporativos)

Funciones puras sobre `CorporateCapacity` (en la rama de integración; reutilizables por el dashboard y por el CRM):

| Selector | Devuelve |
|---|---|
| `getCorporateCapacity()` | agregado consolidado completo |
| `getCapacityByCategory(cat)` | capacidad/ocupado/disponible consolidado de una categoría |
| `getCapacityBySite()` | comparativa por sede |
| `getCorporateVacancySummary()` | KPIs de cabecera (comercializable/ocupado/disponible/vacancia%) |
| `getAvailableByCategory(cat)` | m² disponibles de la categoría en todas las sedes |
| **`findAvailability(request)`** | **motor de matching** (ver §5): dado `{category, m2, sede?}` → opciones factibles por sede/sector/cubículo/isla, o "no disponible + alternativa" |

`findAvailability` es el **puente con el CRM** y la pieza más valiosa: convierte la pregunta comercial ("¿tengo 300 m² ANMAT?") en una respuesta operable sobre las dos sedes.

---

## 5. Relación futura con el CRM Comercial

El Dashboard Corporativo es la **fuente oficial de oferta (supply)**; el CRM aporta la **demanda/compromiso (demand)**. Se cierran así:

```
   Digital Twins (Luján + Magaldi)            CRM Comercial Nexus
   = OFERTA física (capacidad)                = DEMANDA (oportunidades)
            │                                          │
            ▼                                          ▼
   CorporateCapacity  ──findAvailability()──►  crm_opportunities (m², service_type)
            │                                          │
            └──────── Vacancia comercial ◄─────────────┘
   vacancia_comercial = comercializable − ocupado_físico − comprometido(CRM ganadas)
```

### 5.1 Puntos de integración
1. **Vacancia oficial** (cierra [VACANCY_SOURCE_OF_TRUTH §2.6](../comercial/VACANCY_SOURCE_OF_TRUTH_ANALYSIS.md)): el KPI de vacancia del [dashboard comercial](../comercial/COMMERCIAL_KPI_DASHBOARD.md) pasa de "1 sede placeholder" a **consolidado 2 sedes** vía `getCorporateVacancySummary()`.
2. **Validación de capacidad** en cotización: `findAvailability({category, m2})` valida si la oportunidad entra → evita cotizar lo inexistente.
3. **Sugerencia de sede/sector** en propuesta: el matching propone Luján vs Magaldi, sector/cubículo/isla concretos.
4. **Onboarding**: al ganar, el espacio sugerido alimenta la asignación operativa (WMS).
5. **m² comprometidos** (`crm_opportunities.m2` ganadas no onboardeadas) se restan a la capacidad → **vacancia comercial** real.

### 5.2 Casos de uso (ejemplos resueltos con los datos actuales)
- *"Cliente pide 300 m² ANMAT"* → ANMAT disponible corporativo 508 m²; no hay bloque único de 300 (Magaldi PB30 107; Luján cubículos 401 fragmentados + 2º piso 258). Respuesta: combinación o 2º piso Luján.
- *"Cliente pide 800 m² CG con racks"* → Luján PB8 (806 + 248 pos) o PB2 (997 + 248); Magaldi sin CG disponible.
- *"Cliente quiere coworking"* → Magaldi 11 islas / 56 puestos, 100%.

---

## 6. Decisiones a ratificar antes de Fase 1

| # | Decisión | Impacto |
|---|---|---|
| C-1 | Estrategia de integración git: **Opción A** (rama `feature/dashboard-vacancia-corporativo`, merge de ambas features) | Cómo conviven los dos modelos |
| C-2 | Base de KPI = **superficie comercializable** (ANMAT+CG+Oficinas), no cubierta total | Comparabilidad de sedes |
| C-3 | Tratamiento de Luján "parcial" (PB3/PB6 estimados) en el roll-up | Precisión vacancia |
| C-4 | ¿El dashboard incluye ya **m² comprometidos** del CRM (aún no existe) o se deja el hook para cuando arranque F2.1? | Alcance Fase 1 |
| C-5 | End-state Opción C (graduar contrato+modelos a main) — futura, con autorización | Fundación compartida |

---

## 7. Entregables de las fases siguientes (propuesta)

| Fase | Entregable | Toca código |
|---|---|---|
| **0 (esta)** | `TOPS_CORPORATE_CAPACITY_ARCHITECTURE.md` | No |
| 1 | Contrato `SiteCapacity` + adapters (`to-site-capacity.ts`) + selectores corporativos | Sí (rama integración) |
| 2 | UI `/comercial/dashboard-vacancia` (consolidado, por categoría, por sede, matching) | Sí |
| 3 | Hook CRM (`findAvailability` expuesto) + readiness | Sí |
| 4 | QA (typecheck/lint/build) + reporte | Sí |

**Sin código en esta fase.** Sin merge. Sin tocar main. Sin Netlify. Primero la arquitectura.
