# CORPORATE_CAPACITY_ENGINE_REPORT

**Frente:** Dashboard Corporativo de Vacancia TOPS · **Fase:** 1 — Motor de capacidad (implementado)
**Rama:** `feature/dashboard-vacancia-corporativo` (integración, sin merge a main, sin deploy)
**Fecha:** 2026-06-04
**Archivo:** `src/lib/wms/corporate-capacity.ts` (typecheck ✅ · lint ✅ · build ✅)
**Relacionado:** [ARCHITECTURE](./TOPS_CORPORATE_CAPACITY_ARCHITECTURE.md)

---

## 1. Qué se construyó — primer motor corporativo de capacidad TOPS

Consolida los dos Digital Twins (Luján 3159 + Magaldi 1765) en una **única fuente corporativa** vía patrón **adapter + aggregator**. Los modelos fuente por sede **no se modificaron**.

### Estrategia git (C-1, Opción A)
Rama `feature/dashboard-vacancia-corporativo` creada desde `main`; se mergearon **ambas feature branches dentro de ella** (merge feature↔feature, nunca a main). Ahora coexisten `lujan3159-map.ts` y `magaldi1765-map.ts` + el motor.

### Componentes (`corporate-capacity.ts`)
| Pieza | Detalle |
|---|---|
| Contrato `SiteCapacity` / `CorporateCapacity` | normalizado; categorías ANMAT/General/Oficina; racks, coworking, cubículos, excluded, confidence |
| `lujanToSiteCapacity()` / `magaldiToSiteCapacity()` | adapters puros (mapean cada modelo al contrato) |
| `getCorporateCapacity()` | agregador consolidado |
| `getCorporateVacancySummary()` | KPIs de cabecera |
| `getCapacityByCategory()` · `getCapacityBySite()` · `getAvailableByCategory()` | selectores |
| **`findAvailability(request)`** | motor de matching demanda↔oferta (hook CRM) |

### committed_m2 (C-4 ajustado)
El contrato **soporta `committedM2`** en cada categoría y en los totales, pero el cálculo lo mantiene en **0** (`COMMITTED_M2_ENABLED = false`). El disponible mostrado es 100% **físico**. F2.1 activará el hook poblando desde `crm_opportunities`. No se incorpora al cálculo todavía.

---

## 2. Resultados validados (por código)

### Consolidado corporativo
| Métrica | Valor |
|---|---|
| Capacidad comercializable | **10.049 m²** |
| Ocupado físico | **6.279 m²** |
| Disponible físico | **3.770 m²** |
| Comprometido (committed) | **0** (hook F2.1) |
| **Vacancia corporativa** | **37,5%** |

### Por categoría
| Categoría | Capacidad | Disponible | Vacancia |
|---|---|---|---|
| ANMAT | 2.085 m² | 508 m² | 24,4% |
| Cargas Generales | 7.804 m² | 3.212 m² | 41,2% |
| Oficinas | 160 m² | 50 m² | 31,3% |

+ Racks 906/2.377 · Coworking 11 islas · Cubículos ANMAT 18 disponibles.

### Por sede
| Sede | Comercializable | Disponible | Vacancia |
|---|---|---|---|
| Pedro Luján 3159 | 5.928 m² | 3.613 m² | 60,9% |
| Agustín Magaldi 1765 | 4.121 m² | 157 m² | 3,8% |

**Integridad:** `disponible + ocupado === comercializable` ✓ · `committed === 0` ✓.

### `findAvailability()` — casos resueltos
- *ANMAT 300 m²* → "entran en Pedro Luján 3159 (401 m² disponibles)".
- *CG 800 m²* → "entran en Pedro Luján 3159 (3.212 m² disponibles)".
- *Oficinas* → "Disponible Oficinas: 50 m² en 1 sede(s)".

---

## 3. Refinamiento vs. la arquitectura (Fase 0)

La [arquitectura](./TOPS_CORPORATE_CAPACITY_ARCHITECTURE.md) §3.2 estimó **oficinas = 50 m²** de capacidad (solo las vendibles disponibles) y total **9.939 m²**. El motor refina:

> **Oficinas comercializables = oficinas vendibles disponibles (50) + oficinas rentadas/ocupadas (110, OF-PB1/2/3) = 160 m²**, porque una oficina rentada **sigue siendo parte del inventario comercializable** (capacidad), solo que ocupada. Esto sube el total comercializable a **10.049 m²** y baja la vacancia a 37,5% (vs 37,9%). Las oficinas de **uso interno** (CEO, gerencias…) quedan en `excluded.internoM2`, no en comercializable.

El motor es la **fuente precisa**; la cifra de la arquitectura era ilustrativa.

---

## 4. QA (Fase 4 anticipada)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | **TSC_EXIT=0** |
| `npx next lint` (motor) | **✔ No ESLint warnings or errors** |
| `npm run build` | **✓ Compiled successfully** (rama integración: motor + ambos mapas) |
| Validación de datos (`tsx`) | comercializable 10.049 = disp 3.770 + ocup 6.279 ✓ · committed 0 ✓ |

---

## 5. Relación con CRM (hook preparado, no activado)
- `findAvailability()` es el punto de entrada del CRM: cotización (validar capacidad), propuesta (sugerir sede/sector), onboarding (asignar espacio).
- `committedM2` listo para F2.1: `vacancia_comercial = comercializable − ocupado − committed`.
- Reemplaza el placeholder de vacancia del [KPI dashboard comercial](../comercial/COMMERCIAL_KPI_DASHBOARD.md) con un consolidado real de 2 sedes.

---

## 6. Pendiente
| Ítem | Fase |
|---|---|
| UI `/comercial/dashboard-vacancia` (consolidado, por categoría, por sede, matching) | 2 |
| Activar `committedM2` desde CRM | tras F2.1 |
| Graduar contrato + modelos a main (end-state Opción C) | con autorización |
| Screenshots | tras UI |

**Sin merge a main · sin deploy · sin Netlify.**
