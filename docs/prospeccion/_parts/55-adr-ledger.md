# ADR Ledger — Registro Canónico de Decisiones de Arquitectura

> Registro **autoritativo** de los ADRs críticos de la Plataforma Comercial de Nexus. Supera la lista preliminar de la Parte IV. ADRs **inmutables**; evolucionan por estado (Proposed → **Accepted** → Deprecated → Superseded). Todos los siguientes están **Accepted** (aprobados por Dirección en el walkthrough del 2026-06-25).

## ADR-001 — DDD + Bounded Context dedicado (Prospección = Core Domain)
- **Estado:** Accepted (Decisión 1).
- **Problema:** ¿Dónde vive la lógica de prospección y cómo se relaciona con el CRM existente?
- **Alternativas:** sub-feature dentro de `comercial`; extender el contexto CRM; app/microservicio separado.
- **Decisión:** Prospección es un **Bounded Context propio**, **Core Domain**, aguas arriba del CRM; frontera vía ACL + máquina de estados única + `crm_ingest_lead`.
- **Justificación:** el dominio de prospección es genuinamente distinto del CRM; evita contaminación de pipeline y lock-in; habilita sumar canales sin tocar el CRM.
- **Consecuencias:** mayor estructura (DDD/ACL) a cambio de aislamiento; fija el patrón de los contextos comerciales futuros.

## ADR-002 — Modelo de datos híbrido + Data Governance
- **Estado:** Accepted (Decisión 2).
- **Problema:** ¿Cómo modelar ~24 entidades manteniendo claridad de dominio y evolución?
- **Alternativas:** 24 tablas 1:1; relacional rígido; jsonb puro; tabla única ancha.
- **Decisión:** ~13 tablas: núcleo tipado + satélites `jsonb` para lo variable + ledgers append-only + catálogo de sources, gobernado por **DG-1..DG-10**.
- **Justificación:** equilibra invariantes/consultabilidad (columnas) con flexibilidad de proveedores (jsonb), con gobierno auditable.
- **Consecuencias:** disciplina de `jsonb` obligatoria (DTOs, validación, promoción a columna, envelope versionado).

## ADR-003 — Arquitectura Hexagonal Estratificada
- **Estado:** Accepted (Decisión 3).
- **Problema:** ¿Cuánta ceremonia hexagonal aplicar sin sobre-ingeniar?
- **Alternativas:** hexagonal en todo; patrón layered actual de Nexus; híbrido sin reglas.
- **Decisión:** Hexagonal Estratificada (**HEX-1..HEX-10**): Core 100% hexagonal; capa liviana condicionada para CRUD/reads triviales; CQRS para reads complejos.
- **Justificación:** máxima separación donde aporta (fronteras de proveedor/evento), máxima simplicidad donde no.
- **Consecuencias:** dos estilos coexisten con criterio explícito de migración; matriz Hexagonal Boundaries obligatoria.

## ADR-004 — Event Bus = Outbox transaccional sobre Postgres
- **Estado:** Accepted (Decisión 4).
- **Problema:** ¿Cómo desacoplar el pipeline con eventos durables sin infra nueva?
- **Alternativas:** broker externo (Kafka/RabbitMQ/SQS); llamadas directas; LISTEN/NOTIFY.
- **Decisión:** Outbox transaccional en Postgres + dispatcher por cron, detrás de `EventBusPort`.
- **Justificación:** atomicidad sin dual-write, durabilidad/replay/auditoría nativos, cero infra nueva, swappable a broker por el puerto.
- **Consecuencias:** at-least-once (consumidores idempotentes); latencia de cron; se construye la plomería.

## ADR-005 — Event Bus: estándar operativo (catalog, SLA, lanes, registry)
- **Estado:** Accepted (Decisión 4, ajuste).
- **Problema:** ¿Qué garantías operativas debe dar el bus a escala?
- **Alternativas:** outbox mínimo; broker (incluye esto de fábrica).
- **Decisión:** **EVT-1..EVT-12**: correlation/causation obligatorios + Inbox Pattern; Priority Lanes; Schema Registry + deprecación; Circuit Breaker + Rate Limiter; Event Catalog; Operational SLA por categoría; replay multidimensional.
- **Justificación:** eleva el Outbox a grado producción con trazabilidad causal, priorización y SLAs medibles.
- **Consecuencias:** mayor complejidad operativa (se construye por fase; los contratos se fijan día 1).

## ADR-006 — CRM Sync Engine genérico, outbound-first
- **Estado:** Accepted (Decisión 5).
- **Problema:** ¿Cómo sincronizar al CRM sin acoplar el dominio a Clientify?
- **Alternativas:** acoplar a Clientify directo; iPaaS/API unificada; bidireccional desde día 1.
- **Decisión:** `CrmSyncPort` genérico + **solo adapter Clientify ahora** (regla de tres), event-driven, outbound-first, idempotente/auditable/reversible; bidireccional en F7.
- **Justificación:** sin lock-in de CRM, reusa `crm_ingest_lead`/`clientify_sync_log`, difiere la complejidad bidireccional.
- **Consecuencias:** abstracción a validar con el 2º adapter; reversibilidad = compensación, no borrado duro.

## ADR-007 — AI Provider Manager
- **Estado:** Accepted (Decisión 6).
- **Problema:** ¿Cómo usar IA sin lock-in de proveedor?
- **Alternativas:** acoplar a OpenAI; gateway como arquitectura central; un solo proveedor sin abstracción.
- **Decisión:** `AIPort` + adapters (OpenAI ahora, Claude fast-follow, gateway opcional como adapter), registry/fallback/cost/cache, **AI-1..AI-12**.
- **Justificación:** absorbe el churn de modelos sin tocar el dominio; control de costo y validación (disciplina OCR).
- **Consecuencias:** capability flags + escape hatch; budget limiter persistido + cache desde F4.

## ADR-008 — Integración Canonical-hub + ACL + Registry
- **Estado:** Accepted (Decisión 7).
- **Problema:** ¿Cómo integrar con muchos sistemas externos de forma uniforme y extensible?
- **Alternativas:** point-to-point; ESB central; iPaaS como capa; payloads externos al dominio.
- **Decisión:** hub-and-spoke con Canonical Data Model; cada integración = adapter detrás de port con ACL obligatoria, clasificada (sync/async/event/batch/scheduled), en un Integration Registry.
- **Justificación:** uniformidad, contención del cambio externo, extensibilidad (sumar canal sin arquitectura nueva).
- **Consecuencias:** Canonical Model debe estar bien diseñado; verificación inbound estandarizada.

## ADR-009 — Seguridad RLS-primary + ciclo de vida PII + SSRF
- **Estado:** Accepted (Decisión 8, ajuste).
- **Problema:** ¿Cuál es la frontera de seguridad real dado el RBAC dormido?
- **Alternativas:** confiar en guards de app; service_role ubicuo; seguridad de perímetro.
- **Decisión:** **SEC-1..SEC-12**: RLS-primary (nunca `using(true)` en PII), Zero Trust, mínimo privilegio, RPC-first, fail-closed; ciclo de vida/olvido de PII; validación SSRF en enrichment; cifrado.
- **Justificación:** única postura honesta con RBAC dormido; protege PII de terceros desde día 1; escala a defensa en profundidad.
- **Consecuencias:** complejidad de RLS (tests obligatorios); admin-bypass documentado; decisión legal de datos LinkedIn registrada.

## ADR-010 — Roadmap F0→F7 por rebanadas verticales gateadas
- **Estado:** Accepted (Decisión 9).
- **Problema:** ¿Cómo entregar la plataforma minimizando riesgo?
- **Alternativas:** big-bang; capas horizontales; menos fases más grandes.
- **Decisión:** 8 fases verticales, aditivas, con gate G7; F0 mínima + fundaciones (outbox/estados) día 1; migraciones entregadas no aplicadas.
- **Justificación:** feedback temprano, respeta dependencias y gobernanza; fácil repriorizar.
- **Consecuencias:** algo de rework por concerns tardíos (mitigado por contratos día 1); toca todas las capas por fase.

## ADR-011 — Migración del enum de módulo en 2 pasos
- **Estado:** Accepted (técnico, CC-1).
- **Problema:** Postgres exige commitear un nuevo valor de enum antes de usarlo.
- **Alternativas:** una sola migración (falla); evitar el enum (rompe convención RBAC).
- **Decisión:** `0088` agrega `'prospeccion'` a `permission_module_t`; `0089` lo usa (molde `0086`→`0087`).
- **Justificación:** patrón ya probado en prod; idempotente.
- **Consecuencias:** dos migraciones en vez de una; rollback documenta que un valor de enum no se quita.

## ADR-012 — Contactabilidad/firmográficos en columnas; crudo en jsonb
- **Estado:** Accepted (Decisión 2, ajuste; corrige la Persistencia).
- **Problema:** ¿`*_status`/`*_analysis` van en `jsonb` o en columnas?
- **Alternativas:** todo en `jsonb` (viola DG-1); todo en columnas (rígido).
- **Decisión:** los campos que participan en filtros/scoring/reportes (`email_valid`, `industry`, `revenue_band`, etc.) son **columnas tipadas**; la respuesta cruda del proveedor queda en `jsonb` con envelope.
- **Justificación:** DG-1 (el dominio primero); consultabilidad + trazabilidad.
- **Consecuencias:** procedimiento de promoción `jsonb`→columna (DG-4) cuando un campo se vuelve relevante.

## ADR-013 — Cliente IA central compartido `src/lib/ai`
- **Estado:** Accepted (Decisión 6).
- **Problema:** ¿Cada consumidor de IA reinventa el cliente (hoy solo OCR con fetch crudo)?
- **Alternativas:** duplicar el fetch por módulo; SDK directo en cada uso.
- **Decisión:** extraer un cliente IA central en `src/lib/ai` (detrás de `AIPort`) que consumen OCR y Prospección, con timeout/retry/cache.
- **Justificación:** deduplica, agrega resiliencia ausente hoy, un solo lugar para gobernar costo/modelos.
- **Consecuencias:** refactor aditivo de OCR para consumir el cliente central (sin romperlo).

## ADR-014 — Cron GH Actions + `CRON_SECRET` fail-closed
- **Estado:** Accepted (Decisión 8 / EVT-1).
- **Problema:** ¿Cómo agendar el dispatcher/jobs sin infra nueva y de forma segura?
- **Alternativas:** Netlify Scheduled Functions (no usadas en el repo); worker dedicado; pg_cron para todo.
- **Decisión:** cron por **GitHub Actions** (~5 min) → endpoint con `Authorization: Bearer CRON_SECRET` **fail-closed**; `pg_cron` para proyecciones DB-side; worker solo si se exige sub-minuto.
- **Justificación:** reusa el patrón existente; endurece el fail-open actual; honesto sobre la cadencia de GH Actions.
- **Consecuencias:** latencia de ~5 min (irrelevante para este dominio); lane Critical puede requerir worker a futuro.

---

> **ADR-015 a ADR-019 — Correcciones de F0-PRE (Blueprint Reconciliation, 2026-06-25).** Resuelven los 5 hallazgos CRÍTICOS del ARB expandido. Documentación pura: ninguna toca código, migración aplicada, commit ni deploy.

## ADR-015 — Reconciliación de asignación de tablas a fases (ROAD-001)
- **Estado:** Accepted (F0-PRE, 2026-06-25).
- **Problema:** el catálogo DDL (`35-persistencia §1.1`) y el Roadmap (`60 Cap. 4`) asignaban tablas a fases distintas (p. ej. `human_decisions` F2 en DDL vs gate humano F1 en roadmap; `enrichment`/`scores` F1 vs F2/F3); un dev que siguiera el DDL construiría F1 sin su tabla.
- **Alternativas:** (a) dejar dos mapeos y "saber cuál vale" (frágil); (b) alinear el roadmap al DDL; (c) **alinear el DDL al roadmap** y declarar el §1.1 como fuente de verdad única.
- **Decisión:** (c). Mapeo canónico: `human_decisions`=F1, `enrichment`=F2, `scores`=F3, `ai_content`=F4, `crm_refs`=**F0** (creada en 0089, escrita en F5), `metrics`/`timeline`/`activities`/`notes`=F6. La columna **Fase** del §1.1 es la fuente de verdad; el roadmap la cita.
- **Justificación:** AP-17 (una sola fuente de verdad) aplicado al propio blueprint; elimina el bloqueo de implementación de F1.
- **Consecuencias:** el §1.1, el §1.2 (F0 = 5 tablas), los entregables de F0/F5 del roadmap y la Regla RPC-1 (approve/reject = F1) quedan alineados.

## ADR-016 — `prospeccion_crm_refs` provider-agnostic adelantada a F0 (CONS-C2 / CC-6)
- **Estado:** Accepted (F0-PRE; formaliza ARB C-3 y CC-6).
- **Problema:** los IDs de CRM (`clientify_contact_id`/`clientify_deal_id`) estaban acoplados a la fila raíz y, pese a CC-6, reaparecían en el diagrama ER y en el Row type `ProspeccionProspectRow` → el equipo los reintroduciría desde el tipo generado, filtrando IDs de CRM a la fila PII.
- **Alternativas:** (a) mantener los IDs en `prospeccion_prospects` (acopla el schema raíz a Clientify); (b) **tabla `prospeccion_crm_refs` provider-agnostic** (`crm_provider`, `crm_contact_id`, `crm_deal_id`) creada desde F0.
- **Decisión:** (b). Se eliminan los campos de Clientify del ER (§1.3) y del Row type (§3.2); se crea `prospeccion_crm_refs` en 0089 con RLS (SELECT por `prospeccion.view`, escritura service_role/DEFINER), `updated_at`+trigger y FK `on delete cascade`; queda vacía hasta F5.
- **Justificación:** AP-5 (provider-agnostic) honrado en el DDL, no solo en el dominio; CC-6 deja de contradecirse a sí misma.
- **Consecuencias:** F0 pasa a 5 tablas; el rollback 0091 dropea `crm_refs`; se agrega `ProspeccionCrmRefRow`.

## ADR-017 — Las RPC de transición son persistencia mecánica, sin lógica de negocio (ARCH-002)
- **Estado:** Accepted (F0-PRE; refuerza CS-RPC-1).
- **Problema:** CS-RPC-1 obligaba a RPC `SECURITY DEFINER` por caso de uso mutante pero no restringía su contenido; embeber validación de invariantes/transiciones en PL/pgSQL invertiría la Regla de Dependencia (AP-1/AP-15) sin que el lint de boundaries (CS-BOUNDARY-1) pudiera detectarlo (ocurre fuera de TypeScript).
- **Alternativas:** (a) permitir lógica en PL/pgSQL "por pragmatismo de depuración"; (b) **prohibir lógica de negocio en las RPC** (persistencia mecánica sobre snapshot pre-validado).
- **Decisión:** (b) vía **CS-RPC-2 / Regla RPC-2**: las RPC de transición (F1+) solo escriben estado+eventos; las invariantes INV-PR-1…6 viven en el AR TypeScript y se evalúan antes de `UnitOfWork.run()`. Excepción acotada y documentada: `prospeccion_ingest` (F0) hace normalización+dedup en SQL por performance de ingesta masiva.
- **Justificación:** preserva el dominio soberano (AP-1) y la testabilidad sin DB (HEX-7).
- **Consecuencias:** cada RPC de transición lleva nota "recibe snapshot pre-validado; NO re-valida reglas"; la `DeduplicationPolicy` del dominio sigue siendo la fuente de verdad conceptual del dedup.

## ADR-018 — `ProspectRepositoryPort` sin `nextId()` (ARCH-001)
- **Estado:** Accepted (F0-PRE).
- **Problema:** el puerto de repositorio incluía `nextId()`, conflando generación de identidad con persistencia (viola SRP) y creando una dependencia implícita invisible para el caso de uso.
- **Alternativas:** (a) mantener `repo.nextId()` delegando a IdGen; (b) **eliminarlo**: el caso de uso recibe `IdGeneratorPort` directo y pasa el `ProspectId` a `ProspectFactory.fromImportRow(id, row, source)`.
- **Decisión:** (b). El repositorio queda limitado a `findById`/`findByDedupeKey`/`save`.
- **Justificación:** SRP + dependencia explícita; `ImportProspects` ya listaba `IdGen` entre sus puertos.
- **Consecuencias:** firma de la factory cambia a `fromImportRow(id, …)`; sin impacto en otros puertos.

## ADR-019 — Outbox con columna `seq` para orden causal (CONS-C1 / DM-004)
- **Estado:** Accepted (F0-PRE).
- **Problema:** la migración 0089 **no compilaba**: el bloque de índices "ARB C-2" referenciaba columnas inexistentes (`next_attempt_at`, `seq`) y duplicaba nombres de índice con firmas contradictorias → rollback atómico de toda la migración. Además, sin orden monotónico el Outbox no garantizaba causalidad (`id` uuid no ordena; `created_at` colisiona en el mismo lote).
- **Alternativas:** (a) ordenar por `created_at` (colisiona); (b) **agregar `seq bigint generated always as identity`** y consolidar los índices a una sola definición válida.
- **Decisión:** (b). Índices definitivos: dispatch `(available_at, seq) WHERE status in ('pending','failed')`, aggregate `(aggregate_id, seq)`, prospects `(status, created_at desc)`; se elimina el bloque duplicado. Se unifica `available_at` como nombre único (se descarta `next_attempt_at`).
- **Justificación:** la migración debe compilar y el Outbox debe garantizar orden de emisión para replay determinista (E-3/AP-2).
- **Consecuencias:** `ProspeccionEventRow` gana `seq`; el DDL compila en un branch efímero sin rollback (criterio de salida de F0-PRE).

---

**Objetivo** — Preservar el "por qué" de cada decisión arquitectónica para que el blueprint sirva de referencia durante años.
**Alcance** — Todas las decisiones arquitectónicas significativas de la Plataforma Comercial.
**Decisiones tomadas** — 19 ADRs Accepted (ADR-001..ADR-019; ADR-015..019 = correcciones F0-PRE), registro autoritativo.
**Decisiones descartadas** — no llevar ADRs; notas informales; registrar solo lo nuevo.
**Justificación** — memoria arquitectónica gobernada (ADR Governance, Parte VI); trazabilidad de alternativas y consecuencias.
**Riesgos** — desactualización → el Architecture Review exige el ADR en la Definition of Done.
**Impacto sobre la arquitectura** — es el índice de decisiones que gobierna toda evolución futura; ningún cambio significativo sin su ADR.
