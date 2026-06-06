# CORPORATE_VACANCY_DASHBOARD_REPORT

**Frente:** Dashboard Corporativo de Vacancia TOPS · **Fase:** 2 — UI (implementada)
**Rama:** `feature/dashboard-vacancia-corporativo` (integración, sin merge a main, sin deploy)
**Fecha:** 2026-06-04
**Ruta:** `/comercial/dashboard-vacancia`
**Relacionado:** [ARCHITECTURE](./TOPS_CORPORATE_CAPACITY_ARCHITECTURE.md) · [ENGINE_REPORT](./CORPORATE_CAPACITY_ENGINE_REPORT.md)

---

## 1. Qué se construyó

Dashboard corporativo que **consume exclusivamente** `src/lib/wms/corporate-capacity.ts` (motor Fase 1). Vista nueva, no destructiva, sin Supabase.

### Secciones implementadas (según spec)
| # | Sección | Contenido |
|---|---|---|
| 1 | **Resumen ejecutivo** | Capacidad comercializable · Disponible · Ocupado · Vacancia% (con barra) |
| 2 | **ANMAT** | capacidad · disponible · vacancia (barra) |
| 3 | **Cargas Generales** | capacidad · disponible · vacancia (barra) |
| 4 | **Oficinas** | capacidad · disponible |
| 5 | **Racks** | totales · disponibles |
| 6 | **Coworking** | islas · puestos |
| 7 | **Comparativa por sede** | tabla Luján vs Magaldi (comercializable/disp/ocup/vacancia + ANMAT/CG disp + extras) + fila TOTAL |
| 8 | **Motor de matching** | `findAvailability()` interactivo: selector de categoría + m²/puestos + presets |

### Matching — presets incluidos
- **300 m² ANMAT** → "entran en Pedro Luján 3159 (401 m² disponibles)".
- **800 m² CG** → "entran en Pedro Luján 3159 (3.212 m² disponibles)".
- **20 puestos coworking** → "disponibles en Magaldi 1765 (56 puestos · 11 islas · 100%)".

> Coworking se evalúa contra puestos disponibles (no es m², por eso no usa `findAvailability` sino la disponibilidad de coworking del motor). ANMAT/CG/Oficinas usan `findAvailability()`.

### Interacciones
Selector + input numérico · presets · export **CSV** (capacidad por categoría y por sede) · export **PDF** (print A4) · responsive · claro/oscuro (tokens del design system) · barras de vacancia.

---

## 2. Datos mostrados (del motor, no recalculados)

| | Capacidad | Disponible | Vacancia |
|---|---|---|---|
| **Corporativo** | 10.049 m² | 3.770 m² | 37,5% |
| ANMAT | 2.085 | 508 | 24,4% |
| Cargas Generales | 7.804 | 3.212 | 41,2% |
| Oficinas | 160 | 50 | 31,3% |

Racks 906/2.377 · Coworking 11 islas / 56 puestos · Cubículos ANMAT 18.
Por sede: Luján 5.928/3.613 (60,9%) · Magaldi 4.121/157 (3,8%).

`committed = 0` (hook CRM F2.1); disponible mostrado = físico.

---

## 3. Archivos

| Archivo | Tipo |
|---|---|
| `src/app/(app)/comercial/dashboard-vacancia/page.tsx` | nuevo — server/metadata |
| `src/app/(app)/comercial/dashboard-vacancia/DashboardVacanciaView.tsx` | nuevo — UI cliente (~360 líneas) |
| `src/components/shell/Sidebar.tsx` | editado — +1 link nav (Comercial → Vacancia Corporativa) |
| `docs/corporate/CORPORATE_VACANCY_DASHBOARD_REPORT.md` | este reporte |

**No tocado:** main, Netlify, PROD, Supabase, modelos fuente, motor (solo consumido). Sin deploy, sin merge.

---

## 4. QA

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | **TSC_EXIT=0** |
| `npx next lint` (dashboard) | **✔ No ESLint warnings or errors** |
| `npm run build` | **✓ Compiled successfully** · `/comercial/dashboard-vacancia` = 5.24 kB / 101 kB |

Build de la rama de integración compila las 3 vistas premium (mapa-lujan + mapa-magaldi + dashboard-vacancia) y el motor.

---

## 5. Screenshots

⏸️ **Pendientes.** La ruta vive bajo el layout `(app)` con middleware de autenticación; capturar requiere una sesión logueada en entorno **no-PROD** (`npm run dev` + Supabase local/staging). No se ejecutó para respetar la restricción "no tocar PROD". Se capturan en cuanto se autorice un entorno seguro. (Avance no detenido por esto, según indicación.)

---

## 6. Estado del frente corporativo

| Fase | Entregable | Estado |
|---|---|---|
| 0 | Arquitectura de consolidación | ✅ |
| 1 | Motor `corporate-capacity.ts` | ✅ |
| 2 | Dashboard UI | ✅ (este) |
| 3 | Activar `committedM2` desde CRM | ⏸️ tras F2.1 |
| — | Screenshots en vivo | ⏸️ entorno no-PROD |
| — | Graduar contrato+modelos a main (Opción C) | ⏸️ con autorización |

**Sin merge · sin main · sin Netlify · sin deploy.**
