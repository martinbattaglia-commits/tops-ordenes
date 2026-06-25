# Modelo de Datos Híbrido y Gobierno del Dato (Data Governance)

> **Refina la Decisión 2.** No es un modelo relacional puro ni un modelo JSONB-first: es **híbrido con reglas explícitas** sobre cuándo usar columna tipada y cuándo `jsonb`. El objetivo NO es minimizar tablas; es **maximizar claridad del dominio, mantenibilidad, rendimiento y evolución**. Esta sección es **normativa** y prevalece sobre cualquier redacción más laxa del capítulo de Persistencia.

## DG-1 — El dominio siempre primero (regla de columna tipada)
Todo atributo que **participe en** búsquedas · filtros · índices · joins · scoring · reglas de negocio · reportes · dashboards **DEBE** almacenarse en **columna tipada**. **NO DEBE** permanecer indefinidamente dentro de `jsonb`.

**Test operativo (si cualquiera es "sí" → columna tipada):** ¿se filtra/ordena por él en la bandeja o dashboard? ¿entra en el cálculo de `score`? ¿lo consume una regla/política del dominio? ¿aparece en un KPI o reporte? ¿lo necesita un join?

**Corrección al capítulo de Persistencia:** los flags de contactabilidad (`email_valid`, `phone_valid`, `website_up`) y los firmográficos que alimentan scoring/filtros (`industry`, `employee_band`, `revenue_band`, `is_amba`, `has_ecommerce`, `anmat_flag`) **DEBEN ser columnas tipadas** (promovidas), **no** vivir solo dentro de `prospeccion_enrichment.jsonb`. La respuesta cruda del proveedor sí queda en `jsonb` (ver DG-2).

## DG-2 — `jsonb` solo para información variable
`jsonb` se usa **exclusivamente** para información cuya estructura cambia con frecuencia o es heterogénea por proveedor: respuestas completas de proveedores, payloads externos, enriquecimiento crudo, análisis IA, metadata, respuestas de APIs, snapshots, resultados experimentales. **NO DEBE** usarse para representar el modelo de dominio.

## DG-3 — Canonical Domain Model (ningún payload externo entra al dominio)
El dominio tiene un **modelo canónico**. Todo adapter **DEBE** transformar:

```
Proveedor (payload externo, jsonb crudo)
        │  Anti-Corruption Layer
        ▼
Canonical DTO (tipado, validado con Zod)
        ▼
Dominio (entidades / value objects)
```

**Regla dura:** una estructura externa **NUNCA** ingresa directamente al dominio. El `jsonb` crudo se persiste como evidencia/auditoría; el dominio consume únicamente el Canonical DTO.

## DG-4 — Promoción formal de atributos (`jsonb` → columna)
Cuando un atributo que vive en `jsonb` pasa a ser relevante para consultas, dashboards, KPIs, reglas, IA o reportes, **DEBE** ejecutarse el **procedimiento formal de promoción**:

1. ADR corto que registre el atributo, su tipo destino y su fuente (`jsonb` path).
2. Migración aditiva: nueva columna tipada + índice si corresponde (DG-6).
3. Backfill idempotente desde el `jsonb` histórico (extracción diferida, en lote).
4. El adapter/ACL empieza a poblar la columna además del `jsonb` crudo.
5. Actualizar la **matriz de Data Governance** (DG-10) y el Canonical DTO.

`jsonb` **NO DEBE** convertirse en un depósito permanente de datos de dominio.

## DG-5 — Versionado y trazabilidad del payload (`jsonb` envelope estándar)
Todo `jsonb` de origen externo **DEBE** guardarse con un **sobre (envelope) estándar**, nunca como blob desnudo:

```jsonc
{
  "provider": "firecrawl",        // proveedor concreto
  "provider_version": "2026-06",  // versión/edición del proveedor
  "schema_version": 1,            // versión del schema de Nexus para este payload
  "fetched_at": "2026-06-25T12:00:00Z",
  "checksum": "sha256:…",         // hash del payload crudo (idempotencia/dedup)
  "confidence_score": 0.82,       // 0..1
  "data": { /* payload canónico/normalizado */ }
}
```

Garantiza **trazabilidad y reproducibilidad**: se sabe qué proveedor, con qué versión, cuándo, con qué confianza, y se detecta si el contenido cambió (checksum).

## DG-6 — Indexación disciplinada
**NO** indexar `jsonb` indiscriminadamente. Crear índices GIN o funcionales **solo** ante una necesidad demostrable (query real en hot path). **Priorizar** índices sobre columnas tipadas (btree). Cada índice se justifica en su ADR/migración.

## DG-7 — Inmutabilidad de auditoría
Los **ledgers append-only** (`prospeccion_timeline`, `activities`, `notes`) y el **Outbox** (`prospeccion_events`) son **completamente inmutables**: sin `UPDATE`, sin `DELETE` (salvo `is_admin()` por excepción operativa registrada). Toda corrección **DEBE** generar un **nuevo evento**, nunca reescribir el histórico. (Refuerza G10 de la gobernanza de Nexus.)

## DG-8 — Separación por categorías de dato
Cada tabla pertenece a **una** categoría con responsabilidades distintas; **NO** mezclar categorías en una misma tabla:

| Categoría | Qué es | Tablas |
|---|---|---|
| **Core Domain** | Entidades/AR con invariantes, columnas tipadas | `prospeccion_prospects`, `prospeccion_sources`, `prospeccion_scores` (núcleo) |
| **Operational Data** | Estado operativo, bitácoras de proceso | `prospeccion_import_jobs` (incl. enrichment), `prospeccion_event_consumers` |
| **External Payloads** | `jsonb` crudo de proveedores (con envelope DG-5) | `prospeccion_enrichment`, `prospeccion_ai_content` |
| **Audit** | Ledgers inmutables + outbox | `prospeccion_timeline`, `prospeccion_activities`, `prospeccion_notes`, `prospeccion_events` |
| **Analytics** | Snapshots/agregados precomputados | `prospeccion_metrics` |

## DG-9 — Ciclo de vida del dato (Data Lifecycle)
Cada dato tiene un ciclo de vida explícito y auditable:

```
Importado → Enriquecido → Validado → Promovido → Histórico → Archivado
```

- **Importado**: fila cruda normalizada al DTO canónico (estado `raw`/`imported`).
- **Enriquecido**: payloads externos persistidos en External Payloads con envelope.
- **Validado**: el Canonical DTO pasó validación (Zod) + score de confianza ≥ umbral.
- **Promovido**: atributos relevantes movidos a columnas tipadas (DG-4).
- **Histórico**: el prospecto cerró su ciclo (sincronizado/cliente_creado/rechazado); inmutable.
- **Archivado**: política de retención (nunca borrado físico; `archived_at` + posible particionado/cold storage).

## DG-10 — Matriz de Data Governance
Cada atributo del modelo **DEBE** figurar en esta matriz. Ejemplo (extracto representativo; el documento mantiene la matriz completa por atributo):

| Atributo | Owner | Fuente de verdad | Frecuencia actualización | Persistencia | Indexación | Versionado | Archivado |
|---|---|---|---|---|---|---|---|
| `company_name` | Prospección | `prospeccion_prospects` | Import/enrich | Columna `text` | btree | — (núcleo) | con el prospecto |
| `cuit` | Prospección | `prospeccion_prospects` | Import | Columna `text` | btree único parcial | — | con el prospecto |
| `email` | Prospección | `prospeccion_prospects` | Import/enrich | Columna `citext`/`text` | btree `lower(email)` | — | con el prospecto |
| `industry` | Prospección | columna (promovida) | Enrich | Columna `text` | btree | env. del proveedor origen | con el prospecto |
| `employee_band` | Prospección | columna (promovida) | Enrich | Columna `text`/enum | btree | env. proveedor | con el prospecto |
| `revenue_band` | Prospección | columna (promovida) | Enrich | Columna `text`/enum | btree | env. proveedor | con el prospecto |
| `email_valid` / `phone_valid` / `website_up` | Prospección | columna (promovida) | Enrich | Columna `bool` | parcial si hot | env. proveedor | con el prospecto |
| `score` | Prospección | `prospeccion_scores.score` | Recálculo | Columna `int` | btree | `score_model_version` | append-only |
| `web_analysis` (crudo) | Proveedor (vía ACL) | `prospeccion_enrichment.web_analysis` | Enrich | `jsonb` (envelope) | GIN solo si se demuestra | `schema_version`/`provider_version` | con el prospecto |
| `ai_content` | IA (vía ACL) | `prospeccion_ai_content.content` | On-demand | `jsonb` (envelope) | — | `prompt_version`/`model` | append-only por versión |
| `linkedin_metadata` (crudo) | Proveedor (vía ACL) | `prospeccion_enrichment.linkedin` | Enrich | `jsonb` (envelope) | — | env. proveedor | con el prospecto |

---

**Objetivo** — Garantizar que el modelo de datos siga siendo sostenible, claro y performante durante años, evitando que `jsonb` degenere en un depósito schemaless de datos de dominio.
**Alcance** — Todas las tablas `prospeccion_*` y todo adapter que persista datos externos. Aplica a F0 (núcleo) y a todas las fases.
**Decisiones tomadas** — Modelo híbrido con DG-1..DG-10: dominio en columnas tipadas; `jsonb` solo para lo variable y con envelope versionado; Canonical DTO obligatorio; promoción formal `jsonb`→columna; auditoría inmutable; separación por categorías; ciclo de vida explícito; matriz de gobierno por atributo.
**Decisiones descartadas** — (a) relacional puro (rígido, se rompe con cada proveedor); (b) `jsonb`-first (pierde invariantes, filtros y reporting); (c) dejar contactabilidad/firmográficos en `jsonb` (viola DG-1).
**Justificación** — Equilibra estabilidad del núcleo (invariantes, índices, reglas) con flexibilidad de los bordes (proveedores heterogéneos), y agrega gobernanza para que la flexibilidad no erosione la calidad del dato.
**Riesgos** — Disciplina de promoción no se cumple → `jsonb` crece como depósito; mitigación: gate de Architecture Review (Parte VI) verifica DG-1/DG-4 en cada feature. Sobre-normar puede frenar la entrega; mitigación: en F0 solo aplica el núcleo + envelope, la matriz completa se llena por fase.
**Impacto sobre la arquitectura** — Refuerza el Canonical Data Model (Parte VII) y los Coding Standards (Parte VI); convierte la frontera columna/`jsonb` en una **regla auditable**, no un juicio ad-hoc; condiciona el diseño de cada satélite y de cada adapter.
