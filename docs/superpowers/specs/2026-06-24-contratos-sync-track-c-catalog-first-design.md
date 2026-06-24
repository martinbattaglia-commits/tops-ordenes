# Track C — Contratos Sync: catalogar primero, extraer después

**Fecha:** 2026-06-24
**Estado:** Diseño APROBADO por Martín. NO implementado (pausado a pedido).
**Engagement previo:** corrección del scope de Contratos (PR #29) + observabilidad del cron (PR #30), ya en producción. Ver memoria `drive_sync_remediation_2026_06_19`.

## Problema

Tras corregir el scope, el sync de Contratos resuelve las 2 carpetas de categoría
(`CLIENTES DE ANMAT`, `CLIENTES CARGAS GENERALES`) y sincroniza los clientes reales,
pero cierra `status='partial'`: el corpus (~40 dossiers, 200+ documentos) no entra en
el presupuesto de ~18s (tope seguro para no reincidir en el 504 *Inactivity Timeout*
de Netlify, que dispara a ~26-30s sin enviar datos).

Causa: la **extracción de texto** (bajar + parsear cada PDF, ~1-3s c/u) corre
**intercalada con el walk** y se come el presupuesto antes de que el walk llegue a
todos los dossiers. La extracción de 200+ PDFs lleva varios minutos — NO entra en una
corrida serverless de ningún approach.

## Prioridad del negocio (definida por Martín)

**Catálogo confiable es lo prioritario**: que TODOS los contratos y documentos
aparezcan en el CRM de forma completa y confiable. El texto extraído de los PDFs es
**secundario / no urgente** (puede converger en varios días).

## Diseño (Enfoque A: dos fases)

**Alcance:** sólo `src/lib/comercial/contracts-sync/engine.ts`. Compliance NO se toca
(ya completa en ~10s; su extracción es por nombre y está OFF).

### Fase 1 — Catálogo (extracción APAGADA)
Recorre los contenedores de categoría → todos los dossiers → cataloga contratos
(match por CUIT/razón, `tipo` derivado del nombre de la categoría) y documentos **sin
bajar PDFs**. Construye en memoria `seenFiles` (id, mimeType, nombre, contractId) de
todos los docs. Upsert de docs en lote (con `text_source=NULL`, `quality='pendiente'`
para los nuevos; preserva el texto de los que ya lo tenían). Detección de bajas
(sólo si la fase no truncó). → **el catálogo completa siempre en una corrida.**

### Fase 2 — Extracción (best-effort, presupuesto restante)
Recorre `seenFiles` que aún no tienen texto (`text_source` NULL) y extrae hasta un
deadline seguro; hace UPDATE de esos docs con `extracted_text`/`text_source`/`quality`.
Lo que no llega queda diferido y converge en próximas corridas (drena el backlog
porque los ya extraídos se saltean — re-walk los vuelve a ver pero ya tienen texto).

### Presupuesto de tiempo
- `catalogDeadlineMs ≈ t0 + 14s` — la Fase 1 debe cerrar acá; si se excede (corpus
  enorme), `truncated=true` → `partial` legítimo (raro con ~40 dossiers).
- `extractDeadlineMs ≈ t0 + 22s` — la Fase 2 corre hasta acá y para. Total < 26s → sin 504.

### Semántica de estado (cambio clave)
`status='completed'` ahora refleja que el **catálogo** cerró completo y sin errores,
**independiente del texto pendiente**. El backlog de extracción se reporta aparte
(campos nuevos en el reporte/`contract_sync_runs`: `docs_extracted`, `docs_pending_text`),
NO como `partial`. Así el cron queda **verde** cuando el catálogo está completo.
- `partial` → sólo si la Fase 1 (catálogo) trunca.
- `error` → si falla algo duro (carpeta mal configurada = 502, vía la guarda de Track A, intacta).

### Manejo de errores
Igual que hoy: error crítico de extracción (auth/cuota) apaga la Fase 2 y cuenta el
error; errores de catálogo (upsert/walk) se cuentan; la guarda anti-misconfig de Track A
(folder==root → `error`) se mantiene.

### Observabilidad
El `message` y el reporte muestran: "Catálogo completo: N contratos, M docs · Texto:
X extraídos, Y pendientes." Los workflows ya toleran esto (PR #30): el cron mira
`completed` + `errors=0`. Se agregan `docs_extracted` / `docs_pending_text` a
`contract_sync_runs` (migración aditiva).

## Testing

Test del invariante central con Drive/Supabase mockeados: **un corpus que excede el
presupuesto de extracción igual cataloga el 100% de contratos/docs en una corrida**
(`status='completed'`, con `docs_pending_text > 0`). Es el invariante que define Track C.

## Fuera de alcance (futuro)

- **Enfoque B** (worker de extracción en Netlify Background Function, corre hasta
  15 min) — si más adelante se necesita el texto rápido. Es aditivo: se suma encima
  sin rehacer la Fase 1.
- Limpieza de los ~100 `contract_documents` espurios enlazados a los contratos
  Anulados MAGALDI/LUJAN (opcional, no molesta).

## Migración asociada

Aditiva: `alter table contract_sync_runs add column docs_extracted int, add column
docs_pending_text int;` (nullable, sin default destructivo). Aplicar con el patrón
de migraciones del proyecto.
