# Constitución Arquitectónica de la Plataforma Comercial de Nexus

## PARTES IV y V — ATRIBUTOS DE CALIDAD, DECISIONES (ADRs), RIESGOS, ROADMAP Y EJECUCIÓN

> **Bounded context:** `prospeccion`. Código de dominio bajo `src/lib/prospeccion`.
> **Tono:** normativo. Lo que sigue son **reglas, decisiones registradas y compromisos de ejecución**, no sugerencias. Donde se diga DEBE / NO DEBE / PROHIBIDO, es vinculante para todo el contexto `prospeccion`.
> **No-fantasy:** este documento describe arquitectura **prescrita**. Al 2026-06-25 el directorio `src/lib/prospeccion` está **vacío** y las migraciones `0088`/`0089`/`0091` están **entregadas pero NO aplicadas** (no figuran en `supabase/migrations/`, cuya última entrada real es `0087_mi_espacio_permission_and_grant.sql`). Toda cita `file:line` a otros módulos (`rate-limit.ts`, `compliance/sync/route.ts`, workflows de `.github/workflows`, `netlify.toml`, migraciones `crm_*`) es **precedente idiomático real** del repo que estas Partes elevan a norma; toda referencia a `prospeccion/*` es **objetivo de diseño**.
> **Continuidad:** estas Partes construyen sobre la Parte I (estratégica), la Parte II (dominio táctico + hexagonal) y el Event Storming. Reusan los identificadores `R-x.y` (Parte I), `INV-PR-n` y los ports/eventos (Parte II) sin redefinirlos.

---

## PARTE IV — ATRIBUTOS DE CALIDAD Y DECISIONES

### Capítulo 1 — Quality Attributes (tácticas concretas)

Esta arquitectura no persigue calidad en abstracto: cada atributo se satisface con **tácticas verificables** ancladas en restricciones reales de la plataforma (límite serverless ~26-30 s, rate-limit in-memory, RBAC dormido, privacidad de datos LinkedIn como riesgo de negocio).

#### 1.1 Performance

**Restricción dura.** Netlify Functions impone un techo de ejecución de ~26-30 s. El `build` ya corre al límite de memoria (`NODE_OPTIONS = --max-old-space-size=4096`, `netlify.toml:18`) y los syncs existentes declaran `maxDuration` acotado (`maxDuration = 60` en `compliance/sync/route.ts:6`, válido para el plan que lo permite; los pasos cron usan `--max-time 120` con presupuesto, `compliance-drive-sync.yml:44`).

**Tácticas:**
1. **Pipeline asíncrono por etapas, nunca síncrono extremo-a-extremo.** El único camino síncrono admitido en F0 es `import → outbox` (escritura local, sin red a proveedores). Enriquecimiento, scoring e IA (que tocan proveedores externos lentos) se ejecutan **fuera del request del usuario**, drenados desde el Outbox por cron. Ningún caso de uso de proveedor (`EnrichProspect`, `RunAIAnalysis`, `CompleteCrmSync`) DEBE invocarse desde un Server Action interactivo.
2. **Presupuesto de tiempo por corrida (deadline budget).** El drenado del Outbox DEBE adoptar el patrón `partial` ya probado en compliance: procesar hasta agotar un presupuesto (`partial` no es falla; "el presupuesto de tiempo agotado… progresa y se completa en las próximas", `compliance-drive-sync.yml:50-51`), y reanudar en la corrida siguiente. PROHIBIDO un job que intente vaciar todo el Outbox en una sola invocación.
3. **Trabajo idempotente y reanudable.** Cada evento drenado se procesa con `at-least-once` (E-3, Parte II) y consumidores idempotentes, de modo que un timeout a mitad de lote no corrompe estado.
4. **Lotes acotados.** El tamaño de lote por corrida es configurable y DEBE dimensionarse para cerrar holgadamente bajo el deadline serverless.

#### 1.2 Escalabilidad

**Tácticas:**
1. **Backpressure natural por Outbox.** El Outbox en Postgres absorbe picos de import (miles de filas de LinkedIn/CSV) sin saturar proveedores: la cola crece, el drenado consume a ritmo controlado.
2. **Escalado horizontal sin estado compartido en proceso.** Los casos de uso son stateless; el estado vive en Postgres. NO DEBE introducirse estado en memoria del proceso que altere correctness al escalar (lección directa del rate-limit in-memory, §1.3 / ADR ausente — ver Riesgos).
3. **Partición por etapa.** Cada etapa del pipeline drena su propio subconjunto de eventos; una etapa lenta (IA) no bloquea otra (import).
4. **Costo de proveedor como dimensión de escala.** El throughput de enriquecimiento/IA se limita deliberadamente (ver Costos, §1.6) — escalar volumen no implica escalar gasto sin control.

#### 1.3 Seguridad

La seguridad de `prospeccion` se apoya en las fronteras existentes del repo y agrega las propias de un pipeline con datos personales.

**Tácticas:**
1. **RLS como frontera primaria, por `has_permission`.** Toda tabla `prospeccion_*` DEBE tener RLS habilitada y políticas basadas en `has_permission(...)` (precedente: `crm_core` y la familia treasury usan `has_permission`, p. ej. `0042_crm_core.sql`, `0047_crm_write_path_fns.sql`). PROHIBIDO `using (true)` en cualquier política de `prospeccion`.
2. **Crons fail-closed con `CRON_SECRET`.** Los endpoints que disparan etapas del pipeline (drenado de Outbox, sync CRM) DEBEN exigir `Authorization: Bearer ${CRON_SECRET}` (patrón `compliance/sync/route.ts:19-25`; configuración env en `env.ts:244-245`). En F5/F6 la regla se endurece a **fail-closed estricto**: ausencia de `CRON_SECRET` => 401 (ver ADR-014).
3. **Gate humano como límite de confianza.** Ninguna automatización DEBE sintetizar la aprobación (R-4.3, Parte I; INV-PR-2). El paso `approved` exige `HumanDecision` con `actorId` real.
4. **Redacción antes de salir al LLM.** La ACL de IA DEBE redactar datos sensibles antes de construir el prompt (precedente `iaMatch.ts:57`, Parte II §2.6). Datos personales de LinkedIn NO DEBEN viajar crudos a un tercero.
5. **Único punto de salida al CRM, logueado y append-only** (R-1.2.3).

#### 1.4 Disponibilidad

**Tácticas:**
1. **Degradación graciosa por etapa.** Si un proveedor cae, el pipeline detiene **esa** etapa (evento `*.failed` no-transitorio) sin bloquear import ni la bandeja read-only; el prospecto queda en su último estado válido.
2. **Reintento gobernado por `transient`.** El reintento con backoff solo aplica a `*.failed` transitorios (semántica idéntica a `SoapNetworkError.transient`, `arca/soap.ts:21`, Parte II §2.1).
3. **Crons resilientes.** `concurrency: cancel-in-progress: false` (precedente `compliance-drive-sync.yml:27-29`) evita corridas pisadas; el estado `partial` permite avance incremental.
4. **Sin acoplamiento a uptime de proveedor en el camino crítico interno.** Import y bandeja funcionan aunque enrichment/IA/CRM estén caídos.

#### 1.5 Observabilidad

**Tácticas:**
1. **`MetricsPort` como contrato de telemetría** (Parte II §4.8): contadores por evento (`increment`) y latencias de proveedor (`observe`). Observabilidad mínima obligatoria por fase (ver DoD, Parte V Cap. 5).
2. **Outbox como log de auditoría natural.** Cada transición deja su evento; el historial es reconstruible leyendo `prospeccion_outbox`.
3. **Reportes de corrida estructurados.** Cada drenado emite un reporte `{ status, processed, errors }` (patrón `report.status`/`report.errors`, `compliance/sync/route.ts:36-40`, `compliance-drive-sync.yml:55-66`), con `errors>0` => falla visible.
4. **Trazabilidad de decisión humana y de sync** (quién aprobó, qué se sincronizó, cuándo).

#### 1.6 Costos

**Tácticas:**
1. **Costo de IA/enrichment medido y limitado.** El throughput por corrida acota el gasto; `MetricsPort.observe("uso_ia", …)` hace el costo visible (precedente conceptual `usoIa`, Parte II §4.8).
2. **No re-enriquecer ni re-analizar gratis.** `EnrichmentSnapshot`/`AIAnalysis` son inmutables (Parte II §1.2); re-ejecutar es decisión explícita, no efecto colateral de un reintento.
3. **Infra serverless sin servidores ociosos.** Crons puntuales en lugar de workers permanentes; no se introduce Redis/broker pagos en F0-F5 (ADR-004, ADR-005).
4. **Heap de build controlado** (`netlify.toml:18`): no inflar el bundle del dominio con SDKs de proveedor (entran por ACL, lazy).

#### 1.7 Mantenibilidad

**Tácticas:**
1. **Regla de Dependencia hacia adentro** (Parte II §3.1): el dominio no conoce infraestructura; cambiar un proveedor no toca el dominio.
2. **Una ACL por integración** (Parte II §2.6): el cambio de contrato de un proveedor queda confinado a su adapter.
3. **Errores tipados `Result<T, DomainError>`** en lugar de excepciones desnudas (precedente `clientify/client.ts:19`, `arca/soap.ts:11`).
4. **Convenciones del repo respetadas** (capas oficiales, `has_permission`, crons GH Actions) para que un mantenedor del ERP no enfrente un sub-sistema ajeno.

#### 1.8 Testabilidad

**Tácticas:**
1. **Dominio puro testeable sin red ni base** (Parte II §3): VOs, AR y `*Policy` se prueban con `vitest` puro.
2. **Inyección de tiempo, IDs y proveedores** (`ClockPort`, `IdGeneratorPort`, `fetchImpl`): determinismo en tests (precedente `today: Date` en `commercial-score.ts:82`; `fetchImpl` inyectable, Parte II §2.6).
3. **Ports => dobles de prueba triviales:** cada driven port se mockea por interfaz.
4. **Crons con tests de auth.** Los endpoints cron DEBEN tener test de 401/200 (precedente directo: `tesoreria/caja-chica/sync/route.test.ts:33-41`).

#### 1.9 Evolución futura

**Tácticas:**
1. **Eventos versionados** (`version: 1`, Parte II §2.1, E-4): nuevos consumidores sin romper viejos.
2. **CRM reemplazable** (R-1.3.2): el `CrmSyncPort` aísla a Clientify; un CRM nativo de Nexus se enchufa sin tocar el dominio.
3. **Nuevas fuentes por nueva ACL** (F7): ABM, padrones, importadores entran como adapters de import, no como cambios al AR.
4. **Outbox como punto de inserción de un broker** si algún día el volumen lo exige (ADR-004/ADR-005 dejan la puerta abierta sin pagarla hoy).
5. **`*_status`/`*_analysis` consolidados en `jsonb`** (ADR-002/ADR-012): el esquema evoluciona agregando claves, no columnas, evitando migraciones por cada campo nuevo de proveedor.

| Plantilla normativa (Cap. 1) | |
|---|---|
| **Objetivo** | Fijar las tácticas concretas con que la arquitectura satisface cada atributo de calidad, ancladas en restricciones reales (serverless ~26-30 s, rate-limit in-memory, RBAC dormido, privacidad LinkedIn). |
| **Alcance** | Performance, escalabilidad, seguridad, disponibilidad, observabilidad, costos, mantenibilidad, testabilidad, evolución de todo `prospeccion`. |
| **Decisiones tomadas** | Pipeline asíncrono drenado por cron con deadline budget; RLS por `has_permission` sin `using(true)`; crons fail-closed; redacción pre-LLM; `MetricsPort` obligatorio; eventos versionados. |
| **Decisiones descartadas** | (a) Pipeline síncrono extremo-a-extremo — descartado por el techo serverless. (b) Estado en memoria del proceso para correctness — descartado (lección rate-limit). (c) Broker/Redis pagos en fases tempranas — descartado por costo. |
| **Justificación** | Cada táctica reusa un precedente verificable del repo y respeta los límites de la infra; la calidad se vuelve auditable, no aspiracional. |
| **Riesgos** | Complejidad operativa del drenado por cron; mitigada con `partial`/idempotencia/reportes estructurados. |
| **Impacto sobre la arquitectura** | Convierte los ports y el Outbox de la Parte II en mecanismos de calidad medibles y subordina toda etapa de proveedor al patrón async + presupuesto. |

---

### Capítulo 2 — Architecture Decision Records (ADRs)

> **Fuente única de ADRs (sin duplicación).** El **registro canónico y autoritativo** de los ADR es el **ADR Ledger** (`55-adr-ledger.md`, ADR-001…ADR-019). Para **evitar dos esquemas de numeración** (la causa de la inconsistencia MTD-02 detectada en F0-PRE), este capítulo **ya NO redefine** los ADR: solo mapea las decisiones fundacionales de Prospección a su ADR canónico en el Ledger. Citá siempre el número del Ledger.

| Decisión fundacional (tema) | ADR canónico (Ledger `55`) |
|---|---|
| Outbox transaccional en Postgres vs. broker | **ADR-004** (Event Bus = Outbox transaccional) |
| Arquitectura Hexagonal + DDD táctico | **ADR-003** (Hexagonal Estratificada) + **ADR-001** (DDD + Bounded Context) |
| Managers provider-agnostic (ports + ACL) | **ADR-006** (CRM Sync) + **ADR-007** (AI Provider Manager) |
| RLS por `has_permission` (frontera real) | **ADR-009** (Seguridad RLS-primary) |
| Sincronización outbound-first | **ADR-006** (CRM outbound-first) |
| `jsonb` consolidado para snapshots/análisis | **ADR-002** (modelo híbrido) + **ADR-012** (columnas vs `jsonb`) |
| Enum de módulo en 2 migraciones | **ADR-011** |
| Event Bus interno (no Kafka) | **ADR-004** (el bus interno es consecuencia directa del Outbox) |
| Cliente IA central provider-agnostic | **ADR-013** |
| Cron GH Actions + `CRON_SECRET` fail-closed | **ADR-014** |
| Correcciones de reconciliación F0-PRE | **ADR-015…ADR-019** |

> Formato, ciclo de vida (Proposed→Accepted→Deprecated→Superseded) e inmutabilidad de los ADR: ver `55-adr-ledger.md` y la ADR Governance (Parte VI, Cap. 3).

| Plantilla normativa (Cap. 2) | |
|---|---|
| **Objetivo** | Mapear las decisiones fundacionales de Prospección a su ADR canónico, sin duplicar la numeración (el Ledger `55` es la fuente única). |
| **Alcance** | Outbox, hexagonal/DDD, managers provider-agnostic, RLS, dirección de sync, esquema `jsonb`, enum de módulo, event bus, cliente IA, crons, correcciones F0-PRE. |
| **Decisiones tomadas** | La numeración canónica vive solo en `55-adr-ledger.md` (ADR-001..019); este capítulo es un índice de mapeo, no un segundo registro. |
| **Decisiones descartadas** | Mantener dos esquemas ADR-001..010 en paralelo (60 y 55) — descartado: era la inconsistencia MTD-02. |
| **Justificación** | AP-17 (una sola fuente de verdad) aplicado a los ADR; elimina la ambigüedad de "¿cuál ADR-003?". |
| **Impacto sobre la arquitectura** | Toda cita ADR-NNN resuelve sin ambigüedad al Ledger; el linter (BB-5) verifica numeración única. |

---

### Capítulo 3 — Matriz de Riesgos

Clasificación: **Técnicos · Operativos · De datos · De integración · Regulatorios · De escalabilidad.** Probabilidad y Impacto en escala Alta/Media/Baja.

| # | Categoría | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|:---:|:---:|---|
| RT-1 | Técnico | Timeout serverless (~26-30 s) en una etapa que toca proveedor | Alta | Alto | Pipeline async drenado por cron con **deadline budget** + estado `partial` (§1.1; `compliance-drive-sync.yml:50-51`); lotes acotados |
| RT-2 | Técnico | Rate-limit **in-memory** no protege en multi-container (`rate-limit.ts:5-8`: "NO reemplaza un limiter centralizado") | Alta | Medio | Tratarlo como anti-abuso casual, no como control de seguridad; backpressure real vía Outbox; si se requiere límite duro, mover a limiter centralizado (deuda registrada) |
| RT-3 | Técnico | Violación de la Regla de Dependencia (import de dominio→adapter) | Media | Alto | Lint de import boundaries + architecture review en DoD (Parte II §3.1) |
| RO-1 | Operativo | `CRON_SECRET` no configurado o desincronizado GitHub↔Netlify => pipeline no corre o queda abierto | Media | Alto | **Fail-closed estricto** (ADR-014); test de 401/200 (precedente `caja-chica/sync/route.test.ts:33-41`); rotación documentada |
| RO-2 | Operativo | RBAC **dormido** => grant de permiso faltante bloquea acceso legítimo o, peor, RLS mal escrita deja datos expuestos | Alta | Alto | RLS por `has_permission` desde F0; grant en migración separada (ADR-011/`0087`); verificación RLS en DoD (sin `using(true)`) |
| RO-3 | Operativo | Corridas de cron pisadas / duplicadas | Baja | Medio | `concurrency.cancel-in-progress: false` (precedente workflows); consumidores idempotentes (E-3) |
| RD-1 | De datos | Duplicación de prospecto/cliente (mismo CUIT/dominio entra dos veces) | Media | Alto | `DeduplicationPolicy` determinista + `findByDedupeKey` (Parte II §2.2/§4.1); INV-PR-5 idempotencia de sync |
| RD-2 | De datos | Pérdida/incoherencia evento-estado (dual-write) | Baja | Alto | **Outbox transaccional** (ADR-004): evento y agregado en una transacción (INV-PR frontera) |
| RD-3 | De datos | `jsonb` con datos inválidos al no haber constraint de columna (ADR-002/ADR-012) | Media | Medio | Validación por VOs en construcción (Parte II §1.3); la ACL solo persiste modelo de dominio ya validado |
| RI-1 | De integración | Cambio no anunciado de contrato de un proveedor (enrichment/IA/CRM/LinkedIn) | Alta | Medio | Una **ACL por integración** (ADR-008); el dominio no ve el JSON crudo; el cambio se confina al adapter |
| RI-2 | De integración | Bypass de Clientify (escritura directa al CRM saltando el gate) | Baja | Alto | INV-PR-2 + único punto de salida logueado (R-1.2.3); sync solo desde `approved` |
| RI-3 | De integración | Sync no idempotente => registros CRM duplicados | Media | Alto | Idempotencia por `Cuit`/`clientifyId` (INV-PR-5; precedente `reconcile.ts:5`) |
| RR-1 | Regulatorio | **Privacidad de datos de LinkedIn** (datos personales de terceros) = riesgo de negocio | Alta | Alto | Redacción pre-LLM (§1.3.4, `iaMatch.ts:57`); RLS estricta; minimización de datos; no exfiltrar datos crudos a proveedores; staging interno (no exposición pública) |
| RR-2 | Regulatorio | Trazabilidad insuficiente de quién aprobó/sincronizó qué | Media | Medio | `HumanDecision` inmutable (INV-PR-4) + log append-only de sync (R-1.2.3) + Outbox como auditoría |
| RE-1 | De escalabilidad | Pico de import (miles de filas) satura proveedores o el cron | Media | Medio | Backpressure por Outbox (§1.2); drenado a ritmo controlado; lotes |
| RE-2 | De escalabilidad | Costo de IA/enrichment crece sin control con el volumen | Media | Alto | Throughput limitado por corrida + `MetricsPort.observe` de costo (§1.6); inmutabilidad de snapshots (no re-pago) |

| Plantilla normativa (Cap. 3) | |
|---|---|
| **Objetivo** | Inventariar y clasificar los riesgos de `prospeccion` con su probabilidad, impacto y mitigación verificable. |
| **Alcance** | Riesgos técnicos, operativos, de datos, de integración, regulatorios y de escalabilidad del bounded context. |
| **Decisiones tomadas** | 16 riesgos registrados; cada uno con mitigación anclada a un ADR, una invariante o un precedente del repo. |
| **Decisiones descartadas** | Tratar el rate-limit in-memory como control de seguridad (RT-2) — descartado explícitamente. |
| **Justificación** | La matriz hace gobernable lo que la infra y los proveedores no controlan; los riesgos Alta/Alto (RT-1, RO-2, RR-1) gobiernan la priorización del roadmap. |
| **Riesgos** | Que la matriz se vuelva estática; revisión obligatoria por fase (DoD). |
| **Impacto sobre la arquitectura** | Justifica el orden del roadmap (F1 estados+aprobación y RLS antes que volumen) y eleva la privacidad LinkedIn a criterio de aceptación. |

---

## PARTE V — EJECUCIÓN

### Capítulo 4 — Roadmap F0 → F7

Cada fase: **objetivos · entregables · criterios de aceptación · riesgos · dependencias · métricas de éxito.** Ninguna fase se implementa sin superar la **Definition of Done** (Cap. 5) ni la Regla de Decisión del Rector (R-1.5).

#### F0 — Rebanada vertical (import + bandeja + outbox)
- **Objetivos.** Probar la arquitectura extremo-a-extremo en lo mínimo: importar prospectos (CSV/manual), verlos en una bandeja read-only, escribir el Outbox y emitir `prospect.created`/`imported`.
- **Entregables.** Las **5 tablas F0** (`prospeccion_sources`, `prospeccion_prospects`, `prospeccion_events` = Outbox con `seq`, `prospeccion_import_jobs`, `prospeccion_crm_refs` provider-agnostic vacía hasta F5 — adelantada por ARB C-3) + enum + RPC `prospeccion_ingest` (migraciones `0088`/`0089`/`0091`, **entregadas, NO aplicadas**); AR `Prospect` mínimo; casos de uso `ImportProspects`; `OutboxEventBus`; UI `/comercial/prospeccion` read-only; RLS por `has_permission`.
- **Criterios de aceptación.** Importar N filas => N prospectos en estado `imported` + 2·N eventos en Outbox en la misma transacción; bandeja lista solo lo permitido por RLS; **cero** escritura a Clientify; sin `using(true)`.
- **Riesgos.** RO-2 (RLS/RBAC dormido), RD-2 (atomicidad), RT-1 (no aplica aún: import es local).
- **Dependencias.** Partes I-II; migraciones aplicadas tras revisión; `has_permission`/grant del módulo (ADR-011).
- **Métricas de éxito.** 100% de imports con su par de eventos en Outbox; 0 bypass; typecheck/build/vitest verdes.

#### F1 — Estados + aprobación (gate humano)
- **Objetivos.** Materializar la máquina de estados y el gate humano (INV-PR-1, INV-PR-2, INV-PR-4).
- **Entregables.** Tabla **`prospeccion_human_decisions`** (§1.1 = F1); casos de uso `ApproveProspect`/`RejectProspect`; eventos `HumanApproved`/`ProspectRejected`; UI de revisión/aprobación; `HumanDecision` inmutable persistida.
- **Criterios de aceptación.** Transiciones ilegales rechazadas por el AR (`DomainError`, nada se persiste); `approved` exige `actorId` real; `rejected` terminal; toda decisión auditada.
- **Riesgos.** RR-2 (trazabilidad), RO-2 (autorización del aprobador).
- **Dependencias.** F0. **Nota de dependencia (ROAD-001):** F1 **construye y testea** la maquinaria del gate humano (casos de uso, `HumanDecision`, transiciones ilegales → `DomainError`) de forma aislada con `vitest`. El camino end-to-end `…→ ai_analyzed → approved` solo es **ejercitable** una vez que F2–F4 completan los estados intermedios (`enriched/scored/ai_analyzed`); esto es una **dependencia incremental, no una contradicción**. Si la Dirección adopta la variante **F1.5/F5-lite** (sync tras aprobación sin IA, recomendación del ARB / CONS-H3), la precondición de `approve` se relaja explícitamente vía ADR e invariante; hasta esa decisión, `approve` mantiene su precondición `ai_analyzed` (INV-PR-1).
- **Métricas de éxito.** 0 transiciones ilegales aceptadas; 100% de aprobaciones con actor identificado.

#### F2 — Enriquecimiento asíncrono
- **Objetivos.** Primer toque a proveedor externo, fuera del request, drenado por cron con deadline budget.
- **Entregables.** Tabla **`prospeccion_enrichment`** (§1.1 = F2); `EnrichmentPort` + ACL de enrichment; caso de uso `EnrichProspect`; eventos `ProspectEnriched`/`…Failed` (con `transient`); cron de drenado (GH Actions, `CRON_SECRET` fail-closed); persistencia `jsonb` (ADR-002/ADR-012). **Capacidades del Event Bus que debutan con el primer Dispatcher (F2):** Dead Letter (`status='dead'`, EVT-2/EVT-3), observabilidad de lag del Outbox (EVT-6) y `retry`/backoff por `transient`. **Maduración posterior:** Priority Lanes (EVT-5) y Replay multidimensional (EVT-9) se ejercitan a partir de F2 y se profundizan F4–F7; el Schema Registry (EVT-8) se formaliza cuando un evento sube de `version` (F4+). Ninguna de estas capacidades se exige **antes** de F2 (en F0/F1 el Outbox solo se escribe y se lee linealmente).
- **Criterios de aceptación.** Ninguna llamada a proveedor en camino interactivo; reintento solo en `*.failed` transitorio; corrida `partial` reanuda sin duplicar; el dominio nunca ve JSON crudo.
- **Riesgos.** RT-1 (timeout), RI-1 (cambio de contrato), RE-2 (costo).
- **Dependencias.** F1; ADR-004/008/014.
- **Métricas de éxito.** p95 de etapa < deadline; 0 timeouts no recuperados; costo de enrichment por prospecto dentro de presupuesto.

#### F3 — Scoring
- **Objetivos.** Calificar contra el ICP con una política **pura** (sin IA, sin red).
- **Entregables.** Tabla **`prospeccion_scores`** (§1.1 = F3); `ScoringPolicy` (función pura, estilo `calculateCommercialScore`, `commercial-score.ts:82`); caso de uso `ScoreProspect`; evento `ScoreCalculated`; `Score` (VO 0..100).
- **Criterios de aceptación.** `scored` exige `EnrichmentSnapshot` (INV-PR-3); política determinista y testeada con `vitest` puro; sin I/O.
- **Riesgos.** RD-3 (datos `jsonb` inválidos => VOs validan).
- **Dependencias.** F2.
- **Métricas de éxito.** Cobertura de tests de la política alta; reproducibilidad 100% (mismo input => mismo score).

#### F4 — IA comercial
- **Objetivos.** Análisis IA (resumen, fit, riesgos) con datos redactados; la IA aporta señal, no decide.
- **Entregables.** Tabla **`prospeccion_ai_content`** (§1.1 = F4); `AIPort` + ACL de IA + cliente IA central (ADR-013); caso de uso `RunAIAnalysis`; eventos `AIAnalysisCompleted`/`…Failed`; `AIAnalysis` + `ConfidenceScore`.
- **Criterios de aceptación.** Redacción pre-LLM verificada; `ai_analyzed` solo desde `scored`; la IA no transiciona a `approved` (gate humano intacto); costo de IA medido por `MetricsPort`.
- **Riesgos.** RR-1 (privacidad LinkedIn) — **crítico**, RE-2 (costo), RI-1.
- **Dependencias.** F3; ADR-013.
- **Métricas de éxito.** 0 datos sensibles sin redactar en prompts (auditado); costo IA por prospecto dentro de presupuesto; latencia p95 bajo deadline.

#### F5 — Sync CRM outbound
- **Objetivos.** Cerrar el camino "Nexus => Clientify" tras aprobación, idempotente y logueado (ADR-006).
- **Entregables.** `CrmSyncPort` + ACL de CRM (reusa `clientify/client.ts` vía ACL); casos de uso `RequestCrmSync`/`CompleteCrmSync`; eventos `CrmSyncRequested`/`CrmSyncCompleted`/`…Failed`; `CrmRef`; log append-only de sync. **La tabla `prospeccion_crm_refs` ya existe desde F0** (creada en 0089 por ARB C-3); F5 **la escribe** por primera vez (provider-agnostic, INV-PR-5).
- **Criterios de aceptación.** Sync solo desde `approved` (INV-PR-2); idempotente por `Cuit`/`clientifyId` (INV-PR-5, RI-3); todo sync logueado (R-1.2.3); 0 escritura directa al CRM.
- **Riesgos.** RI-2 (bypass), RI-3 (duplicados), RO-1 (`CRON_SECRET`).
- **Dependencias.** F4; ADR-006/014.
- **Métricas de éxito.** 0 duplicados en CRM; 100% de syncs con entrada de log; 0 bypass detectados.

#### F6 — Dashboard
- **Objetivos.** Visibilidad operativa del embudo y del cierre de loop (Cliente del ERP, R-1.4.1).
- **Entregables.** Tablas **`prospeccion_metrics`/`prospeccion_timeline`/`prospeccion_activities`/`prospeccion_notes`** (§1.1 = F6); Dashboard `/comercial/prospeccion` con métricas de pipeline (conteos por estado, tasa de aprobación, costo IA/enrichment, latencias) leídas de `MetricsPort`/Outbox; caso de uso `CreateCustomer` (cierre de loop vía OHS de `clients`).
- **Criterios de aceptación.** Métricas consistentes con el Outbox; `CustomerCreated` solo desde `crm_sync_completed`; sin alta de cliente paralela (R-1.4.2).
- **Riesgos.** RE-1 (volumen), RD-1 (dedup contra `clients`).
- **Dependencias.** F5.
- **Métricas de éxito.** Tablero refleja el estado real (drift 0); cierre de loop sin duplicar clientes.

#### F7 — Bidireccional + nuevas fuentes / ABM
- **Objetivos.** Inbound desde CRM (Conformist, R-3.2.4) y nuevas fuentes de import (ABM, padrones, importadores) como nuevas ACLs.
- **Entregables.** Adapters de inbound (webhook normalizado al Published Language); nuevos adapters de import; eventual sustitución del `EventBusPort` por broker si el volumen lo exige (ADR-004, sin tocar dominio).
- **Criterios de aceptación.** Inbound normaliza al lenguaje publicado antes de propagar (R-3.2.4); nuevas fuentes entran sin modificar el AR; reconciliación sin sobrescribir decisiones humanas (INV-PR-4).
- **Riesgos.** RE-1/RE-2 (escala/costo), RI-1 (más contratos externos), RD-1 (dedup multi-fuente).
- **Dependencias.** F6; reevaluación de ADR-004 (¿broker?).
- **Métricas de éxito.** Nuevas fuentes integradas sin cambio de dominio; conflictos inbound resueltos sin pérdida de auditoría.

| Plantilla normativa (Cap. 4) | |
|---|---|
| **Objetivo** | Definir la secuencia incremental F0→F7, cada fase entregable y aceptable por sí sola. |
| **Alcance** | Desde la rebanada vertical mínima hasta bidireccional + nuevas fuentes/ABM. |
| **Decisiones tomadas** | Orden guiado por riesgo: estados+aprobación y RLS antes que proveedores; proveedores antes que volumen; outbound antes que bidireccional. |
| **Decisiones descartadas** | Implementar IA o sync antes del gate humano y la RLS — descartado (gobernanza/seguridad primero). Bidireccional temprano — descartado (ADR-006). |
| **Justificación** | Cada fase prueba un riesgo concreto de la matriz (Cap. 3) y supera la Regla de Decisión (R-1.5). |
| **Riesgos** | Presión por saltar fases; contenida por la DoD y los gates del Rector. |
| **Impacto sobre la arquitectura** | El roadmap es additive: ninguna fase reescribe el dominio; cada una agrega ports/adapters. |

---

### Capítulo 5 — Definition of Done (checklist OBLIGATORIO)

**Regla DoD-0 (vinculante).** **NO se implementa ninguna fase** (F0..F7) hasta que su plan cumpla, y al cierre se evidencie, **todos** los ítems siguientes. La omisión de cualquier ítem invalida la fase.

- [ ] **DoD-1 — Typecheck 0.** `tsc`/`next build` en verde, **0** errores de tipo (el build ya corre al límite de heap, `netlify.toml:18`: no introducir regresiones).
- [ ] **DoD-2 — Build.** `npm run build` exitoso (`netlify.toml:8`) en condiciones equivalentes a Netlify (Node 22).
- [ ] **DoD-3 — `vitest` verde.** Suite completa pasa; el dominio puro tiene cobertura significativa; **los endpoints cron incluyen test de 401/200** (precedente `caja-chica/sync/route.test.ts:33-41`).
- [ ] **DoD-4 — Migración idempotente revisada + rollback.** Cada migración es idempotente (`IF NOT EXISTS`/guardas), revisada manualmente, con script/plan de **rollback** explícito (precedente del par `0082`/`0083_cash_box_rollback.sql`); el enum de módulo se aplica en **2 migraciones** (ADR-011). Migraciones `0088`/`0089`/`0091` se aplican **solo** tras esta revisión.
- [ ] **DoD-5 — RLS verificada / sin `using(true)`.** Toda tabla `prospeccion_*` con RLS habilitada y políticas por `has_permission`; **prohibido `using(true)`**; con RBAC dormido, se verifica que los grants necesarios existan (ADR-009, RO-2).
- [ ] **DoD-6 — ADRs escritos.** Toda decisión nueva o desviación de un ADR vigente queda registrada como ADR (formato Cap. 2). Cambiar un ADR exige un ADR nuevo, no edición silenciosa.
- [ ] **DoD-7 — Architecture review pasado.** Revisión de Regla de Dependencia (sin import dominio→infra), de ACL por proveedor y de no-bypass de Clientify (INV-PR-2); supera la Regla de Decisión del Rector (R-1.5).
- [ ] **DoD-8 — Observabilidad mínima.** `MetricsPort` instrumentado para la etapa (contadores de evento + latencia/costo de proveedor); reporte de corrida estructurado `{status, processed, errors}` con `errors>0 => falla` (patrón compliance).
- [ ] **DoD-9 — Evidencia G5.** Evidencia verificable adjunta (logs de corrida, salida de tests, captura de RLS, reporte de migración) conforme al gate **G5**; sin evidencia, la fase no se considera hecha.
- [ ] **DoD-10 — Privacidad de datos verificada.** Para fases que tocan proveedores (F2/F4/F5/F7): redacción pre-LLM auditada (RR-1) y minimización de datos personales de LinkedIn confirmada.

---

### DoD-11 — Import Boundaries verificado (ARB 2026-06-25)

| Criterio | Verificación |
|---|---|
| `eslint-plugin-boundaries` instalado en devDependencies | `grep boundaries package.json` devuelve la dependencia |
| Zonas hexagonales de `prospeccion` definidas en `.eslintrc.json` | Ver CS-BOUNDARY-1 en Parte VI §2.1 |
| Import violatorio genera ERROR de lint | Test: añadir import prohibido → `npm run lint` falla |
| `npm run lint` incluye check de boundaries | Confirmado en CI |
| 0 errores de boundary en código correcto | `npm run lint` pasa en codebase limpio |

**Justificación:** Sin enforcement técnico, la Regla de Dependencia (AP-1, HEX-7) se erosiona silenciosamente en el PR #3. El lint check la convierte en una garantía verificable.

**Gate:** Bloquea F0. El primer PR de código del bounded context `prospeccion` no puede mergearse sin esta configuración activa.

---

| Plantilla normativa (Cap. 5) | |
|---|---|
| **Objetivo** | Fijar el listón de "terminado" que cualquier fase DEBE superar antes de implementarse y al cerrarse. |
| **Alcance** | Todas las fases F0..F7 de `prospeccion`. |
| **Decisiones tomadas** | DoD-0 bloqueante; 10 ítems obligatorios; cron con test de auth; migración idempotente + rollback; RLS sin `using(true)`; evidencia G5; privacidad verificada. |
| **Decisiones descartadas** | "Hecho" por demo o por merge sin evidencia — descartado (DoD-9). RLS diferida a una fase posterior — descartado (es la frontera con RBAC dormido). |
| **Justificación** | Reusa los gates ya vigentes del repo (typecheck/build/test, idempotencia, `CRON_SECRET`, reportes estructurados) y los hace condición de avance, no buena intención. |
| **Riesgos** | Fricción de proceso; aceptada por la criticidad CORE y la privacidad LinkedIn. |
| **Impacto sobre la arquitectura** | Subordina toda implementación a verificación previa; ninguna fase del roadmap avanza sin cumplir esta DoD. |

---

> **Cierre de las Partes IV y V.** La calidad de `prospeccion` es **medible y auditable** (Cap. 1), sus decisiones quedan **registradas y citables** (Cap. 2 → ADR Ledger `55`, ADR-001..019), sus riesgos **gobernados** con mitigaciones ancladas en precedentes reales (Cap. 3), su construcción **secuenciada por riesgo** (Cap. 4, F0→F7) y subordinada a una **Definition of Done bloqueante** (Cap. 5). Ninguna línea de código de `prospeccion` se escribe fuera de este marco. Con esto, la Constitución Arquitectónica de la Plataforma Comercial de Nexus queda completa de la estrategia (Parte I) a la ejecución (Parte V).
