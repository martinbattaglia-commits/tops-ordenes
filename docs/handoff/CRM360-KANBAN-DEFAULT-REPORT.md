# CRM360-KANBAN-DEFAULT-REPORT

**Fecha:** 2026-06-08 · UX Refinement — Kanban por defecto + filtro de pipelines.
**Estado:** implementado · tsc PASS · build PASS · dev sirviendo.

---

## 1. Criterio aplicado

Dos cambios, ambos de **lectura/presentación** (no tocan datos, Clientify, sync ni backfill):

1. **Vista inicial = Kanban.** Al ingresar a `Comercial → Oportunidades 360°` abre directamente en Kanban. La vista Tabla sigue existiendo (toggle en el header), solo deja de ser la inicial.
2. **Filtro de pipelines.** CRM360 muestra únicamente los pipelines comerciales **activos** (ANMAT · Cargas Generales · Oficinas) y oculta el histórico catch-all **"Logística Tops"**.

El filtro reutiliza el **mismo criterio** que ya usaba la página `Comercial → Pipeline` (Clientify live), unificándolo en una fuente única para que ambas vistas no diverjan.

---

## 2. Filtros utilizados

### Cambio 1 — default Kanban
`src/app/(app)/comercial/oportunidades/OpportunitiesView.tsx`
```diff
- const [view, setView] = useState<"tabla" | "kanban">("tabla");
+ const [view, setView] = useState<"tabla" | "kanban">("kanban");
```

### Cambio 2 — allowlist de pipelines (fuente única)
Nuevo módulo `src/lib/comercial/pipeline-filter.ts`:
```ts
export const VISIBLE_PIPELINE_NAMES = new Set([
  "anmat",
  "alquiler de oficinas", "oficinas", "oficinas corporativas",
  "carga generales", "cargas generales", // tolerante a typo
]);
export function isVisibleCommercialPipeline(name: string | null | undefined): boolean {
  return VISIBLE_PIPELINE_NAMES.has((name ?? "").trim().toLowerCase());
}
```
- **Match case-insensitive + trim**, tolerante a variantes/typos.
- Es **allowlist** (solo se muestran los 3 activos), no blocklist: cumple literalmente "SOLO DEBEN MOSTRARSE ANMAT / Cargas Generales / Oficinas". Cualquier pipeline no listado —incluido "Logística Tops"— queda oculto.

Aplicado en el data layer de CRM360 (`src/lib/comercial/opportunities-data.ts`, `listOpportunities`):
```ts
if (db) return { items: db.filter((o) => isVisibleCommercialPipeline(o.pipeline)), source: "supabase" };
```
Campo filtrado: `crm_opportunities.clientify_pipeline` (mapeado a `o.pipeline`). El filtro aplica **después** de leer Supabase → afecta Kanban, Tabla, contadores de columna y el subtítulo "{N} oportunidades" de forma consistente.

Refactor de unificación: `src/lib/clientify/data.ts` ahora delega en `isVisibleCommercialPipeline` (antes tenía su propio Set duplicado).

### Qué NO se tocó
- No se borran ni se marcan `deleted_at` oportunidades de Logística Tops.
- No se modifica Clientify, ni la sincronización, ni el backfill.
- La Ficha 360° por id (`/comercial/oportunidades/[id]`) no se bloquea: el dato sigue existiendo; solo desaparece del **listado**. (No había requisito de bloquear acceso directo.)

---

## 3. Validación

### Técnica (ejecutada por el asistente)
| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | **EXIT 0** |
| `next build` (heap 4 GB, dev detenido, `.next` aparte) | **EXIT 0**, `/comercial/oportunidades` y `/[id]` = `ƒ (Dynamic)`, sin warnings |
| dev `:3030` reiniciado | `Ready` · `GET /comercial/oportunidades` → `307` (redirect a login, esperado sin sesión) · sin 500 |

### Casos funcionales (sesión real del usuario)
| Caso | Esperado |
|---|---|
| 1 · Ingreso a Oportunidades | Vista inicial = **Kanban** |
| 2 · Pipeline "Logística Tops" | **No visible** (ni en Kanban ni en Tabla) |
| 3 · ANMAT | **Visible** |
| 4 · Cargas Generales | **Visible** |
| 5 · Oficinas | **Visible** |

---

## 4. Cantidad de oportunidades visibles — antes / después

> **Nota de transparencia:** el asistente **no** lee la base productiva por su cuenta
> (intento de query directa con service-role bloqueado por el clasificador, y los
> `.env`/Clientify no son accesibles). Los números exactos se confirman ejecutando
> en el **SQL Editor de Supabase** (`arsksytgdnzukbmfgkju`) esta consulta **read-only**:

```sql
-- Distribución por pipeline (antes del filtro) + total visible (después)
select
  coalesce(clientify_pipeline, '(null)') as pipeline,
  count(*) as oportunidades,
  case
    when lower(btrim(clientify_pipeline)) in
      ('anmat','alquiler de oficinas','oficinas','oficinas corporativas',
       'carga generales','cargas generales')
    then 'VISIBLE' else 'oculto'
  end as estado_crm360
from crm_opportunities
where deleted_at is null
group by 1, 3
order by oportunidades desc;

-- Resumen antes/después
select
  count(*) as total_antes,
  count(*) filter (
    where lower(btrim(clientify_pipeline)) in
      ('anmat','alquiler de oficinas','oficinas','oficinas corporativas',
       'carga generales','cargas generales')
  ) as visibles_despues,
  count(*) filter (
    where lower(btrim(clientify_pipeline)) not in
      ('anmat','alquiler de oficinas','oficinas','oficinas corporativas',
       'carga generales','cargas generales')
      or clientify_pipeline is null
  ) as ocultas
from crm_opportunities
where deleted_at is null;
```

Tabla a completar con la salida de la consulta:

| Métrica | Cantidad |
|---|---|
| Total oportunidades (antes del filtro) | _por confirmar_ |
| **Visibles después** (ANMAT + Cargas Generales + Oficinas) | _por confirmar_ |
| Ocultas (Logística Tops + null/otros) | _por confirmar_ |

El criterio del SQL es **idéntico** al de `isVisibleCommercialPipeline`, de modo que el conteo de la consulta = el conteo que renderiza CRM360.

---

## 5. Archivos modificados
- `src/app/(app)/comercial/oportunidades/OpportunitiesView.tsx` — default `kanban`.
- `src/lib/comercial/pipeline-filter.ts` — **nuevo**, fuente única del allowlist.
- `src/lib/comercial/opportunities-data.ts` — aplica el filtro de lectura en `listOpportunities`.
- `src/lib/clientify/data.ts` — delega en la fuente única (elimina Set duplicado).
