# Event Bus / Outbox — Reglas Operativas (ESTÁNDAR DEFINITIVO)

> **Refina y cierra la Decisión 4.** Estándar operativo **definitivo** del Outbox transaccional sobre Postgres para toda la Plataforma Comercial de Nexus. Normativo. La abstracción vive detrás de `EventBusPort`; estas reglas gobiernan la implementación Postgres + dispatcher.

## EVT-1 — Cadencia del dispatcher
**Salvedad técnica honesta:** el cron de **GitHub Actions** tiene granularidad mínima **~5 min** y no garantiza puntualidad.
- **Baseline:** dispatcher por cron GH Actions **~5 min** (cola general).
- **Proyecciones DB-side:** **PUEDEN** usar **`pg_cron`** (extensión Postgres en Supabase) a 1 min sin infra nueva.
- **Priority Lanes (ver EVT-5):** la lane `Critical` **PUEDE** tener su propio cron más frecuente o un worker; sub-minuto con handlers app-side es el disparador para incorporar un worker dedicado (no requerido en F0–F5).
- Crons separados por costo: liviano frecuente vs caro espaciado (enrichment/IA).

## EVT-2 — Retry y backoff
At-least-once. **Backoff exponencial + jitter**: `available_at` en 1 min → 5 min → 30 min → 2 h → 6 h. **Máx N=6**; agotados → DLQ (`status='dead'`). El schedule y N son configurables por Priority Lane.

## EVT-3 — Dead Letter (DLQ)
Tras N reintentos → `status='dead'`: visible en health-check + vista admin; **nunca** auto-borrado; **replay manual** (EVT-9); **alerta** si `count(dead) > umbral`. Un `dead` es un incidente operativo.

## EVT-4 — Idempotencia y trazabilidad
- **Mantener** deduplicación `(event_id, consumer_name)` (tabla `prospeccion_event_consumers`).
- **`correlation_id` OBLIGATORIO** en todo evento (hilo de negocio extremo a extremo).
- **`causation_id` OBLIGATORIO** (qué evento/comando causó este evento → árbol causal completo).
- **Idempotency Key de negocio OPCIONAL** para eventos provenientes de **sistemas externos** (webhooks/imports), para deduplicar por clave de negocio además de por `event_id`.
- **Inbox Pattern por consumidor** cuando exista **integración crítica entre bounded contexts** (el consumidor persiste el evento en su propia inbox antes de procesarlo, garantizando entrega exactamente-una-vez efectiva a nivel de ese BC).
- **NO usar TTL** para eliminar registros de deduplicación. La estrategia **privilegia trazabilidad sobre ahorro de almacenamiento**.

## EVT-5 — Concurrencia, orden y Priority Lanes
- **Mantener:** `FOR UPDATE SKIP LOCKED`, **orden por Aggregate**, **procesamiento paralelo entre Aggregates**.
- **Documentado explícitamente:** se garantiza orden **solo dentro del mismo Aggregate**; **entre Aggregates el procesamiento es concurrente** (sin orden global).
- **Priority Lanes:** cada evento lleva una prioridad **`Critical` · `High` · `Normal` · `Low`**. El Dispatcher **DEBE poder priorizar** (drena `Critical` antes que `Low`) **sin modificar el dominio** (la prioridad es metadato del evento + política del dispatcher, no lógica de negocio). Lanes con starvation-avoidance (las lanes bajas no quedan infinitamente postergadas).

## EVT-6 — Observabilidad (desde el día 1)
**Dashboard específico del Event Bus** con, como mínimo: **SLO por tipo de evento**, **Correlation ID end-to-end**, **tracing distribuido**, **throughput**, **latencia** (`created_at→processed_at`), **backlog** (edad p95 de `pending`), **DLQ** (`count(dead)`), **replay** (estado/auditoría), **tiempo promedio por consumidor**, **errores por proveedor** y **errores por Adapter**. Toda esta información **DEBE** estar disponible desde el primer día (no es una mejora posterior).

## EVT-7 — Retención y ciclo de vida
**Mantener** particionado mensual. **Política de ciclo de vida explícita:**

```
Activo → Procesado → Archivado → Cold Storage → Eliminación (solo cuando la normativa lo permita)
```

**Nunca** eliminar **eventos críticos** sin una política explícita (criticidad declarada en el Event Catalog, EVT-11). Borrado físico solo fuera de la ventana de retención y con autorización (G10/DG-7).

## EVT-8 — Versionado y Schema Registry
- **Event Schema Registry**: registro oficial del schema de cada tipo de evento y sus versiones.
- **Versionado de contratos** (`version` por evento) + **validación automática de esquemas** (Zod/JSON-Schema en publicación y en consumo).
- **Compatibilidad hacia atrás** obligatoria; cambios incompatibles → **nueva versión**.
- **Política formal de deprecación** (estados: Active → Deprecated → Retired, con ventana de soporte).
- **El dominio NUNCA depende de versiones antiguas del payload**: el upcasting al schema actual ocurre en el borde (adapter/consumer), no en el dominio.

## EVT-9 — Replay
Capacidades de replay: **por consumidor**, **por Aggregate**, **por `correlation_id`**, **por rango temporal**, **por tipo**. Modos **Dry Run** (simula, no aplica) y **Shadow** (procesa en paralelo sin efectos visibles, para validar). **Auditoría completa del replay** (quién, qué, cuándo, alcance, resultado) en un ledger de replays. La idempotencia (EVT-4) lo hace seguro.

## EVT-10 — Publicación
- **Estricto:** **NUNCA Dual Write** — el evento se persiste en la misma transacción que el cambio de estado.
- **Relay Process explícito:** el dispatcher es un relay nombrado y observable (no un efecto lateral implícito).
- **Circuit Breaker por Adapter:** si un adapter (proveedor/CRM/IA) falla repetidamente, su circuito se abre y los eventos esperan (sin quemar reintentos ni costos) hasta el half-open.
- **Rate Limiter por proveedor externo:** el dispatcher respeta límites de tasa por proveedor (persistido, no in-memory) para no exceder cuotas ni disparar costos.
- **Timeout configurable por consumidor:** cada handler tiene su timeout; al vencerse cuenta como fallo retriable (EVT-2).

## EVT-11 — Event Catalog (catálogo oficial)
Existe un **catálogo oficial de eventos**; cada tipo de evento **DEBE** documentar: **Productor**, **Consumidores**, **Aggregate**, **Payload** (schema + versión), **SLA** (ref. EVT-12), **Criticidad** (`Critical/High/Normal/Low`), **Ejemplo** (instancia real anonimizada) y **Versiones** (historial). Es la fuente única de verdad de la mensajería.

**Plantilla + ejemplo:**

| Campo | `prospect.created` (ejemplo) |
|---|---|
| Productor | `ImportProspects` (Application Service) |
| Consumidores | `EnrichmentScheduler`, `TimelineProjector`, `MetricsCollector` |
| Aggregate | `Prospect` |
| Payload (v1) | `{ prospect_id, source, cuit?, email?, linkedin_url?, created_by }` |
| SLA | Categoría **High** (ver EVT-12) |
| Criticidad | High |
| Ejemplo | `{ "prospect_id":"…","source":"csv","email":"…","created_by":"…" }` |
| Versiones | v1 (Active) |

**Eventos de fallo (`*.failed`) en el catálogo.** Los eventos `*.failed` del dominio (`prospect.enrichment.failed`, `ai.analysis.failed`, `crm.sync.failed`; Parte II §2.1) son **miembros de primera clase del Event Catalog**, no efectos colaterales. Cada uno documenta su payload (`{ reason, transient, attempt }`), hereda la **lane** de su contraparte feliz (p. ej. `crm.sync.failed` = Critical; `prospect.enrichment.failed` = Normal; `ai.analysis.failed` = Low) y su ruteo lo gobierna EVT-2 (retry/backoff por `transient`; agotados → DLQ `status='dead'`). Esto cierra la correspondencia **Event Catalog ↔ Event Bus**: todo evento del dominio (los 9 + sus `*.failed`) tiene entrada de catálogo y SLA.

## EVT-12 — Operational SLA (objetivos por categoría, justificados)
Objetivos operativos por Priority Lane. Justificación clave: el piso de latencia real lo fija la cadencia del dispatcher (~5 min GH Actions); `Critical` solo baja de eso con worker/pg_cron dedicado.

| Categoría | Latencia máx (p95) | Tiempo máx en cola | Throughput esperado | Disponibilidad | Tasa máx de errores | Tiempo máx de replay | Justificación |
|---|---|---|---|---|---|---|---|
| **Critical** (`crm.sync.*`, `customer.created`) | ≤ 5 min (worker/pg_cron) | ≤ 10 min | decenas/min | 99.5% | < 1% | ≤ 30 min | Afecta dinero/cliente real; baja latencia exige lane dedicada. |
| **High** (`prospect.created/imported`, `prospect.approved`) | ≤ 1 ciclo (~5–10 min) | ≤ 15 min | cientos/hora | 99% | < 2% | ≤ 1 h | Experiencia del comercial; tolera minutos. |
| **Normal** (`prospect.enriched`, `score.calculated`) | ≤ 30 min | ≤ 1 h | cientos/hora | 99% | < 5% | ≤ 2 h | Enrichment/score tardan segundos-minutos igual; no urgente. |
| **Low** (`ai.analysis.completed`, re-enrich background) | best-effort (≤ horas) | ≤ varias horas | batch | 98% | < 10% | ≤ 6 h | Trabajo caro/diferible; se prioriza costo sobre latencia. |

Los valores son punto de partida; cada uno se ratifica con datos reales en operación y se versiona junto al Event Catalog.

---

**Objetivo** — Estándar operativo definitivo del Event Bus: fiable, idempotente, observable, priorizable, versionado y con SLAs explícitos.
**Alcance** — La implementación Postgres del `EventBusPort`, su dispatcher, todos los consumidores y todo bounded context comercial futuro.
**Decisiones tomadas** — EVT-1..EVT-12 con: correlation/causation obligatorios + idempotency key de negocio + Inbox Pattern; Priority Lanes Critical/High/Normal/Low; observabilidad completa desde día 1; ciclo de vida Activo→…→Eliminación; Event Schema Registry + validación + backward-compat + deprecación; replay multidimensional con Dry Run/Shadow + auditoría; Relay + Circuit Breaker + Rate Limiter + timeout por consumidor; Event Catalog; Operational SLA por categoría.
**Decisiones descartadas** — TTL de deduplicación (sacrifica trazabilidad); orden global cross-aggregate (innecesario y costoso); exactly-once a nivel transporte (imposible → Inbox Pattern donde es crítico); sub-minuto con GH Actions (no fiable → worker dedicado para Critical).
**Justificación** — Eleva el Outbox a un bus de grado producción con trazabilidad causal completa, priorización, contratos versionados y SLAs medibles, sin infra externa, honesto sobre los límites reales.
**Riesgos** — Complejidad operativa mayor (circuit breaker, lanes, registry) → mitigación: se construye por fase, pero los contratos (catalog, SLA, correlation/causation) se fijan desde día 1. Starvation de lanes bajas → política anti-starvation. Crecimiento del registry/dedup → EVT-7.
**Impacto sobre la arquitectura** — Define el comportamiento del backbone que orquesta TODO el pipeline; condiciona health-check, métricas, el diseño de cada consumidor/adapter y la plantilla de eventos de todo módulo comercial futuro.
