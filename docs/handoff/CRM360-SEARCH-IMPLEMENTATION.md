# CRM360-SEARCH-IMPLEMENTATION

**Fecha:** 2026-06-08 · Buscador global de oportunidades. Estado: implementado · tsc PASS · build PASS · dev sirviendo.

## Objetivo
Localizar cualquier oportunidad en segundos sin recorrer manualmente el tablero Kanban. Filtrado en tiempo real, client-side, aplicado por igual a **Kanban** y **Tabla**.

## Ubicación
Input debajo del título "Oportunidades 360°" y **encima** de las columnas/tabla.
Placeholder: `🔍 Buscar oportunidad, empresa, contacto o ID...`
Sin botón de submit: filtra mientras se escribe (`onChange` → estado `q`). Botón "✕" para limpiar.

## Campos indexados
Por cada oportunidad se arma un único "haystack" normalizado con:

| Campo del request | Campo de datos (`Opportunity`) | Origen DB |
|---|---|---|
| Empresa | `o.empresa` | `company_name` / `clients.razon` |
| Contacto | `o.contacto` | `contacto` (contact_name) |
| Oportunidad (title + service name) | `oppTitle(o)` + `SERVICE_TITLE[o.serviceType]` | `service_type` + `m2` |
| ID | `o.publicId` | `public_id` (OPP-YYYY-####) |
| Pipeline | `o.pipeline` | `clientify_pipeline` (ANMAT / Cargas Generales / Oficinas) |
| Responsable (extra) | `o.ownerName` | `owner_name` |

## Estrategia de filtrado
```ts
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); // case- y acento-insensitive
const filtered = useMemo(() => {
  const term = norm(q.trim());
  if (!term) return opps;                       // sin término → lista completa
  return opps.filter((o) =>
    norm([o.empresa, o.contacto, oppTitle(o), SERVICE_TITLE[o.serviceType], o.publicId, o.pipeline, o.ownerName]
      .filter(Boolean).join("  "))
      .includes(term));
}, [opps, q]);
```
- **Substring match** sobre el haystack concatenado → un solo término matchea cualquier campo ("Rodrigo", "ANMAT", "OPP-2026", "Oficinas"…).
- **Acento-insensitive** (NFD + strip de diacríticos): "lujan" matchea "Luján".
- **Fuente única para ambas vistas:**
  - Tabla → `filtered.map(...)`.
  - Kanban → `byStage` se recalcula desde `filtered` (no desde `opps`), así las columnas reflejan el filtro.
- **Subtítulo** muestra `{filtered} de {total} oportunidades` mientras hay término.

## Resultado vacío
Si `filtered.length === 0` se reemplaza la vista (tabla o kanban) por un estado vacío Nexus:
ícono en círculo `bg-bg-surface-alt`, **"No se encontraron oportunidades"**, subtítulo `Sin coincidencias para "<término>"`, y botón "Limpiar búsqueda". Mismo bloque para ambas vistas.

## Impacto en performance
- **Cero llamadas nuevas.** Filtra sobre las oportunidades ya cargadas en memoria (prop `opps`).
- `useMemo` con deps `[opps, q]`: el filtrado se recomputa solo al tipear o al cambiar el dataset; el render del Kanban/Tabla no recalcula `byStage` salvo que cambie `filtered`.
- Complejidad O(n·m) trivial (n≈82 oportunidades, m≈7 campos). Imperceptible; escala holgadamente a miles.
- No se tocó el data layer ni el filtro de pipelines (el buscador opera sobre el set ya filtrado a ANMAT/Cargas Generales/Oficinas).

## UX / responsive
- Input full-width (`w-full`), se adapta a mobile y desktop; ícono 🔍 a la izquierda, botón limpiar a la derecha.
- Dark mode: usa tokens (`bg-bg-surface`, `text-fg-primary`, `placeholder:text-fg-muted`, `border-stroke-soft`, `focus-visible:ring-tops-blue-700`) → respeta el tema activo sin colores hardcodeados.
- `type="search"` + `aria-label` para accesibilidad.

## Validaciones
| Caso | Entrada | Resultado esperado |
|---|---|---|
| 1 | `Rodrigo` | Solo oportunidades cuyo contacto/empresa contiene "Rodrigo" |
| 2 | `ANMAT` | Solo pipeline/servicio ANMAT |
| 3 | `OPP-2026` | Coincidencias por `public_id` |
| 4 | término sin matches | Mensaje "No se encontraron oportunidades" (estilo Nexus) |

### Técnica (ejecutada)
- `tsc --noEmit` → **EXIT 0**.
- `next build` → **EXIT 0**; `/comercial/oportunidades` = `ƒ (Dynamic)`, bundle 3.23 → **3.86 kB** (+~0.6 kB del buscador), sin warnings.
- dev `:3030` reiniciado y sirviendo (`GET /comercial/oportunidades` → 307 redirect a login para curl sin sesión).
- Validación visual de los 4 casos: pendiente de confirmación en sesión logueada (no es posible autenticar vía curl).

## Archivo modificado
- `src/app/(app)/comercial/oportunidades/OpportunitiesView.tsx` — estado `q`, `norm`, `filtered` (useMemo), input de búsqueda, estado vacío, `byStage`/tabla basados en `filtered`, subtítulo con conteo.
