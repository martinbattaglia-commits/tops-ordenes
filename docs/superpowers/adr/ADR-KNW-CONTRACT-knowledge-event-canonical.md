# ADR-KNW-CONTRACT — Contrato Canónico `KnowledgeEventCanonical`

**Estado:** APROBADO por Dirección (Martín Battaglia, 2026-06-28)

---

## Contexto

El Adapter Pattern (ADR-KNW-ADAPTER) establece que adaptadores y emisor se comunican a través de una interfaz definida. Sin un contrato explícito y verificable por el motor SQL, los adaptadores pueden pasar estructuras inconsistentes al emisor y los errores se detectan en runtime, no en build.

Postgres ofrece composite types como mecanismo de tipado estructural entre funciones. Un composite type como parámetro de función hace que el motor valide la estructura en el momento de la llamada, no al ejecutar `INSERT`.

La firma actual del emisor sin un tipo explícito (`knowledge_emit_event(p_event_type text, p_occurred_at timestamptz, ...)`) requeriría 13 parámetros posicionales en cada llamada, sin verificación de completitud ni nombres.

---

## Decisión

Existe un **contrato canónico único**: el composite type SQL `public.knowledge_event_canonical`. Es la **interfaz oficial entre adaptadores y pipeline**.

### Definición del contrato

```sql
create type public.knowledge_event_canonical as (
  event_type     text,
  occurred_at    timestamptz,
  actor_kind     text,
  actor_id       uuid,
  actor_label    text,
  entity_type    text,
  entity_id      text,
  summary        text,
  payload        jsonb,
  visibility_key text,
  source_table   text,
  source_pk      text,
  correlation_id text
);
```

**13 campos** = columnas de negocio de `knowledge_events` excluyendo los campos gestionados por el pipeline:

| Campo excluido | Responsable |
|---|---|
| `id` | DEFAULT de la tabla `knowledge_events` (`gen_random_uuid()`) |
| `seq` | `GENERATED ALWAYS AS IDENTITY` |
| `ingested_at` | DEFAULT de la tabla `knowledge_events` (`DEFAULT now()`) |
| `status` | DEFAULT de la tabla `knowledge_events` (`DEFAULT 'processed'`) |
| `retry_count` | DEFAULT de la tabla `knowledge_events` (`DEFAULT 0`) |
| `available_at` | DEFAULT de la tabla `knowledge_events` (`DEFAULT now()`) |
| `processed_at` | Gestionado por el worker (F0.5.2+) |
| `error` | Gestionado por el worker en caso de fallo |

### Firma del emisor

```sql
create or replace function public.knowledge_emit_event(
  p_event public.knowledge_event_canonical
) returns void ...
```

El emisor acepta **exclusivamente** el contrato. Está prohibido sobrecargar `knowledge_emit_event` con firmas de parámetros sueltos.

### Defaults aplicados por el emisor

El emisor aplica los defaults del contrato antes de insertar:

- `actor_kind`: si `NULL` → `'system'`
- `payload`: si `NULL` → `'{}'::jsonb`

Los demás campos obligatorios (`event_type`, `occurred_at`, `entity_type`, `entity_id`, `visibility_key`) deben ser NOT NULL en el valor que entrega el adaptador. El emisor valida solo estos (NOT NULL de obligatorios). Sin validaciones complejas, sin serialización adicional, sin reflexión.

---

## Responsabilidades (frontera dura)

### Adaptador (`project_<source>()`)

- Lee **su** fuente origen.
- Consulta su fila en `knowledge_sources` (gate `enabled`).
- Traduce cada fila al formato `knowledge_event_canonical`.
- Resuelve `source_table` (= su `source_key` en el registry).
- Calcula `visibility_key` mediante `public.knowledge_visibility_for(entity_type, entity_id)`.
- Entrega el `knowledge_event_canonical` al emisor.
- **NO** persiste directamente.
- **NO** conoce la tabla `knowledge_events`.
- **NO** conoce las vistas `v_knowledge_*`.
- **NO** gestiona idempotencia (esa responsabilidad es del emisor).

### Source Registry (`knowledge_sources`)

- Registra y resuelve qué fuentes existen y están activas.
- **NO** transforma datos de eventos.
- **NO** valida el contrato canónico.

### Pipeline — emisor (`knowledge_emit_event`)

- Recibe `knowledge_event_canonical`.
- Aplica defaults (`actor_kind`, `payload`).
- Valida NOT NULL de campos obligatorios.
- Materializa el evento en `knowledge_events` con `INSERT ... ON CONFLICT DO NOTHING` (idempotencia sobre `knowledge_events_idem_uq`).
- Aplica observabilidad EOL (evento técnico en canal separado).
- Propaga `correlation_id` desde GUC `knowledge.correlation_id` si el campo viene `NULL` en el contrato.
- **NUNCA** conoce el origen (no ramifica por `source_table`).
- **NUNCA** accede a tablas fuente.

---

## Consecuencias

### Positivas

- **Verificación estructural por el motor SQL:** el composite type garantiza que el adaptador entrega exactamente los 13 campos con los tipos correctos; errores de contrato se detectan en compilación de la función, no en runtime del INSERT.
- **Interfaz estable:** evolucionar el formato de `knowledge_events` (agregar una columna interna como `processed_at`) no requiere tocar el contrato ni los adaptadores, solo el emisor.
- **Legibilidad y autodocumentación:** el composite type es un objeto SQL de primera clase, visible en `pg_type`, consultar con `\d knowledge_event_canonical` en psql.
- **Habilita OCP:** sumar `ReconAdapter` en F0.5.2 = un `project_recon()` nuevo que construye un `knowledge_event_canonical` y lo pasa al emisor. Sin modificar el pipeline, el emisor, las vistas ni la persistencia.
- **Criterio de extensibilidad determinante:** la firma `knowledge_emit_event(p_event public.knowledge_event_canonical)` hace imposible que el emisor inyecte lógica por fuente (el contrato es opaco al emisor).

### Negativas

- `ALTER TYPE` en Postgres no es transaccional ni permite modificaciones arbitrarias (ej. no se puede reordenar campos). Agregar un campo al contrato requiere `DROP TYPE CASCADE` + recreación, lo que implica recrear el emisor y los adaptadores. Mitigación: el contrato se define con los 13 campos estables de negocio; los campos de infraestructura del pipeline quedan fuera del contrato y bajo control exclusivo del emisor.
- Un composite type no impone `NOT NULL` en sus campos (esa restricción es de tabla, no de tipo). El emisor debe validar explícitamente los campos obligatorios antes del INSERT.

---

## Alternativas consideradas (y por qué se descartan)

### Alternativa A: Emisor con 13 parámetros posicionales

```sql
knowledge_emit_event(p_event_type text, p_occurred_at timestamptz, p_actor_kind text, ...)
```

**Descartada.** Sin tipado estructural: los adaptadores pueden omitir parámetros opcionales sin que el motor lo detecte. La firma de 13 parámetros es propensa a errores de orden. Agregar un campo requiere modificar todos los adaptadores existentes (viola OCP).

### Alternativa B: Parámetro JSONB sin schema

```sql
knowledge_emit_event(p_event jsonb)
```

**Descartada.** Sin verificación estructural: el motor no valida los campos del JSONB. Errores de contrato se detectan solo en runtime al intentar extraer campos (`p_event->>'event_type'`). La firma es completamente opaca; los adaptadores no saben qué incluir sin leer el cuerpo del emisor.

### Alternativa C: Tabla intermedia (staging inbox)

Los adaptadores insertan en una tabla staging y el emisor la drena con un worker.

**Descartada.** Introduce latencia de drenado, complejidad de worker y persistencia de estado intermedio no necesarios en F0.5.1. El worker de drenado (`/api/knowledge/drain`) está diferido a F0.5.2. El trigger síncrono con el contrato directo es suficiente para el MVP de F0.5.1.

---

## Alcance F0.5.1

- Se define e implementa el composite type `public.knowledge_event_canonical` en la migración `0108`.
- Se implementa `knowledge_emit_event(p_event public.knowledge_event_canonical)` en `0108`.
- Se implementa `AuditLogAdapter` (`project_audit_log`) como primera implementación del contrato en `0109`.
- Sin validaciones complejas adicionales (solo NOT NULL de obligatorios + defaults `actor_kind` / `payload`).
- Sin serialización adicional, sin reflexión, sin carga dinámica.
- El contrato es una interfaz estructural simple. Evoluciones del contrato son decisiones arquitectónicas que requieren aprobación de Dirección.

---

## Relación

- **ADR-KNW-ADAPTER** — define el Adapter Pattern; este ADR define la interfaz que cada adaptador produce y que el emisor acepta. Son complementarios: el Adapter Pattern sin contrato explícito no tiene verificación; el contrato sin el Adapter Pattern no tiene punto de aplicación.
- **ADR-KNW-REGISTRY** — el Source Registry no participa en la transformación ni en el contrato; provee el gate `enabled` y la clave `source_table` que el adaptador incluye en el `knowledge_event_canonical`.
- **D12** — el emisor compartido definido en D12 es la función `knowledge_emit_event(p_event knowledge_event_canonical)`. Este ADR formaliza su firma.
- **ADR-ENG-1** — la observabilidad EOL (eventos técnicos `KnowledgeProjection*` / `KnowledgeBackfill*`) es responsabilidad del emisor tras recibir el contrato; no es parte del contrato canónico mismo (canal separado, nunca en `knowledge_events`).
