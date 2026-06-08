# CRM-PIPELINE-COUNTERS-FIX

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Solo se corrigió el **cálculo del contador**.
Sin tocar diseño, estructura de pipeline ni sincronización.

---

## Causa raíz

El badge de cada pestaña mostraba **`p.stages.length`** — la **cantidad de ETAPAS** del pipeline, **no** la cantidad de oportunidades.

- `src/app/(app)/comercial/pipeline/page.tsx` (badge del switcher): `{p.stages.length}`.
- Por eso **ANMAT = 5** (sus 5 etapas: Nuevo Lead, Contactado, Propuesta Enviada, Alta Probabilidad, Cuarentena), aunque adentro hubiera 13 oportunidades.

### Respuestas a la auditoría
1. **De dónde provenía:** del objeto `UiPipeline.stages` (longitud del array de etapas), no de los deals.
2. **Dataset:** ninguno de deals — usaba la metadata de etapas del pipeline.
3. **Qué excluía:** **todas** las oportunidades (no las contaba; contaba etapas).
4. **Propiedad incorrecta de Clientify:** sí — usaba `pipeline.stages` en vez de los `deals` filtrados por `pipeline_id`.

---

## Fórmula anterior vs nueva

| | Fórmula |
|---|---|
| **Anterior** | `badge(p) = p.stages.length` (cantidad de etapas) |
| **Nueva** | `badge(p) = #{ deals del pipeline p con status ∈ {open, expired} y stageId ≠ null }` = **suma exacta de las columnas del kanban** |

- "Visibles" = oportunidades **activas con etapa** (las que se renderizan en las columnas; Won/Lost no son columnas). Coincide con la suma de los encabezados de columna (`deals.length` por stage).
- Se computa en el data layer (`getPipelineSnapshot`) para **cada pipeline visible**: el activo reutiliza el fetch ya hecho; los demás hacen un count liviano por `pipeline_id` (`page_size 200`).

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/lib/clientify/data.ts` | `PipelineSnapshot.pipelineCounts: Record<number, number>`; cómputo de oportunidades visibles por pipeline (`visibleCount` = activos con etapa); agregado a los 3 returns |
| `src/app/(app)/comercial/pipeline/page.tsx` | badge del switcher: `{p.stages.length}` → `{pipelineCounts[p.id] ?? 0}` |

Sin cambios en columnas/etapas/sincronización ni en el resto de la UI.

---

## Validaciones realizadas (evidencia real contra Clientify API)

```
pipeline                 | badge VIEJO (#etapas) | deals_total | badge NUEVO (visibles activos c/etapa)
ANMAT                    |          5            |     51      |     13   ✅ (coincide con el ejemplo)
Alquiler de oficinas     |          4            |      1      |      1
Carga Generales          |          4            |     29      |      5
```

- **ANMAT:** 5 → **13** (exactamente el caso reportado). El 51 es el total incl. Won/Lost (no son columnas); las **visibles** en el kanban son 13 → el badge ahora coincide.
- El badge nuevo = **suma de las columnas** que se ven en pantalla (activos con etapa). Sin exclusiones ocultas, sin inconsistencias.
- `tsc --noEmit` EXIT 0.
- `/comercial/pipeline` → HTTP 307 (recompila sin 500).

---

## Resultado

Los badges superiores ahora reflejan **exactamente** la cantidad de oportunidades visibles en cada pipeline (ANMAT=13, Alquiler=1, Cargas=5), coincidiendo con la suma de las columnas del kanban.

> Nota: límite `page_size 200` por pipeline (consistente con el fetch del tablero). Si un pipeline superara 200 oportunidades activas, tanto las columnas como el badge se acotan al mismo set (sin discrepancia entre ambos). Hoy ninguno se acerca al límite. Sin commit/push.
