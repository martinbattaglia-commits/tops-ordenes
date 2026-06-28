# ADR-KNW-ADAPTER — Adapter Pattern para la Proyección de Eventos de Conocimiento

**Estado:** APROBADO por Dirección (Martín Battaglia, 2026-06-28)

---

## Contexto

F0.5.1 introduce el primer flujo real del Knowledge Layer: proyectar la fuente `audit_log` hacia el read-model `knowledge_events`. El spec original (§5.3/§5.4) definía que las funciones `project_audit_log` y `knowledge_backfill_audit_log` insertaban **directamente** en `knowledge_events`, dejando la función `knowledge_emit_event` como código muerto. La revisión adversarial detectó esta contradicción entre la arquitectura declarada (emisor canónico único) y la implementación literal propuesta.

Dirección resolvió explícitamente: **"la arquitectura tiene prioridad sobre la implementación literal cuando ambas entran en contradicción"** y autorizó modificar el SQL originalmente redactado (desviación documentada como **R-A**).

El sistema también debe escalar hacia múltiples fuentes futuras (recon, orders, CRM, compliance, tracking, connect) sin modificar el pipeline cada vez que se incorpora una fuente nueva.

---

## Decisión

Toda fuente de eventos se proyecta vía un **adaptador**: una función SQL `public.project_<source>()` que:

1. Conoce el schema de **su** fuente origen.
2. Consulta su fila en `knowledge_sources` (gate `enabled`).
3. Traduce cada fila al contrato canónico `public.knowledge_event_canonical` (ver ADR-KNW-CONTRACT).
4. Deriva `visibility_key` mediante `public.knowledge_visibility_for(entity_type, entity_id)`.
5. **Llama a `public.knowledge_emit_event(p_event knowledge_event_canonical)`** — el emisor canónico.
6. Incluye guard `to_regclass('public.<tabla_fuente>')` para degradación grácil si la tabla no existe.
7. Envuelve su lógica en `EXCEPTION WHEN OTHERS` → registra `WARNING` (canal técnico EOL) y retorna `NULL`; **nunca propaga el error a la transacción de negocio** (G11).

**`public.knowledge_emit_event` es el ÚNICO punto autorizado que escribe en `knowledge_events`.**

Queda **expresamente prohibido** que cualquier adaptador, función de backfill, script, o código de aplicación haga `INSERT` directo sobre `knowledge_events`. Esta prohibición aplica también a `knowledge_backfill_audit_log`.

El mismo contrato aplica al backfill: `knowledge_backfill_audit_log` itera las filas de `audit_log` y, por cada una, construye el `knowledge_event_canonical` y llama al emisor. El emisor mantiene la idempotencia vía `ON CONFLICT DO NOTHING` sobre la constraint `knowledge_events_idem_uq (source_table, source_pk, event_type)`.

---

## Consecuencias

### Positivas

- **Punto único de materialización:** toda la lógica de persistencia, validación de contrato, idempotencia (`ON CONFLICT DO NOTHING`), instrumentación EOL (`KnowledgeProjection*` / `KnowledgeBackfill*`), propagación de `correlation_id` (vía GUC `knowledge.correlation_id`) y aplicación de defaults (`actor_kind → 'system'`, `payload → '{}'`) residen exclusivamente en `knowledge_emit_event`. Habilitar observabilidad o añadir una columna futura a `knowledge_events` requiere modificar **un solo objeto SQL**.
- **OCP (Open-Closed Principle):** el pipeline (emisor + tabla + vistas + registry) permanece cerrado a modificación cuando se suma una fuente nueva. Solo se abre el sistema mediante un adaptador nuevo.
- **Criterio de extensibilidad determinante (R-B):** `knowledge_emit_event` no referencia ninguna tabla-fuente concreta ni ramifica por `source_table`. Verificable por lectura directa del cuerpo de la función.
- **Auditoría centralizada:** cada escritura en `knowledge_events` pasa por el emisor, que puede registrar eventos técnicos en canal separado sin tocar las tablas funcionales.
- **Degradación grácil:** un adaptador cuya fuente no exista (guard `to_regclass`) o que falle internamente (manejo defensivo `EXCEPTION WHEN OTHERS`) nunca aborta la transacción de negocio que disparó el trigger.

### Negativas

- Añade un nivel de indirección en el path de escritura: adaptador → emisor → tabla. Overhead despreciable en Postgres.
- El backfill no puede usar `INSERT ... SELECT` directo (más eficiente en bulk). El costo es aceptado: la idempotencia y la observabilidad del emisor son no-negociables para el MVP.
- Todos los desarrolladores que creen un adaptador futuro deben conocer la prohibición del `INSERT` directo. Mitigación: el comentario-contrato en `0108` y este ADR son la documentación vinculante.

---

## Alternativas consideradas (y por qué se descartan)

### Alternativa A: Insert directo por adaptador (spec literal §5.3/§5.4)

Cada `project_<source>()` y `knowledge_backfill_*` hace `INSERT INTO knowledge_events ... ON CONFLICT DO NOTHING`. `knowledge_emit_event` existe pero nunca se llama.

**Descartada.** `knowledge_emit_event` queda como código muerto, lo cual fue la contradicción detectada. La instrumentación EOL, los defaults, la propagación de `correlation_id` y la idempotencia quedan replicados en cada adaptador (violación de DRY estructural). Agregar observabilidad futura implica modificar N adaptadores. Rompe OCP.

### Alternativa B: Pipeline en TypeScript (RPC sobre TS)

El adaptador es código TypeScript que llama a Supabase client. El pipeline de escritura vive en `src/lib/knowledge/`.

**Descartada.** Contradice D12 (proyección por triggers AFTER INSERT con emisor compartido) y el principio RPC-first. Introduce latencia de red en el path crítico del trigger. La capa TS de `src/lib/knowledge/data.ts` es **solo lectura** del read-model.

### Alternativa C: Emisor genérico con dispatch dinámico (EXECUTE / format())

Un orquestador itera `knowledge_sources.enabled = true` y construye dinámicamente el nombre del adaptador (`format('project_%s()', source_table)`).

**Descartada.** Prohibido explícitamente en F0.5.1 (límite de alcance de Dirección). Introduce reflexión y ejecuta SQL dinámico, lo que dificulta el análisis estático, la auditoría de permisos y el razonamiento sobre dependencias.

---

## Alcance F0.5.1

Se implementa **únicamente `AuditLogAdapter`** (`project_audit_log`) como implementación de referencia del contrato. Los demás adaptadores (ReconAdapter, OrdersAdapter, CRMAdapter, ComplianceAdapter, TrackingAdapter, ConnectAdapter) quedan **definidos por contrato en este ADR, NO implementados**. Sus filas en `knowledge_sources` tampoco se registran en F0.5.1 (cada uno lo hará al activarse en su fase correspondiente, F0.5.2+).

El contrato canónico y el emisor único (`knowledge_emit_event`) aplican exclusivamente a `knowledge_events` (el timeline). El otro read-model, `searchable_items` (Búsqueda Universal), **no pasa por `knowledge_emit_event`** y se materializa por una vía distinta en una fase posterior (F0.5.2+), fuera del alcance de estos ADR.

---

## Relación

- **ADR-KNW-CONTRACT** — define el composite type `public.knowledge_event_canonical` que es la interfaz que cada adaptador produce y que `knowledge_emit_event` acepta como único parámetro.
- **ADR-KNW-REGISTRY** — define el Source Registry (`knowledge_sources`) que cada adaptador consulta para el gate `enabled` y que registra la fila de su fuente.
- **D12** — decisión de arquitectura que establece proyección por triggers AFTER INSERT con emisor compartido. Este ADR formaliza y refuerza D12 sin introducir capacidad nueva.
- **ADR-ENG-1** — observabilidad (EOL) obligatoria desde F0.5.1. El emisor canónico es el único punto donde se instrumentan los eventos técnicos `KnowledgeProjection*` / `KnowledgeBackfill*` (canal separado, nunca en `knowledge_events`).
