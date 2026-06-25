# ARCHITECTURE REVIEW BOARD — INFORME EJECUTIVO Y TÉCNICO
## Plataforma Comercial de Nexus — Prospección Inteligente
**Fecha:** 2026-06-25 | **Versión Blueprint:** 1.0-ARB-CA | **Documento:** /Users/martinbattaglia/CODE/tops-ordenes/docs/prospeccion/ARB-INFORME-EJECUTIVO-2026-06-25.md

---

## RESUMEN EJECUTIVO

El Architecture Review Board revisó el Blueprint completo del nuevo módulo de Prospección Inteligente de Nexus: la capa comercial que captura prospectos (de LinkedIn y otras fuentes), los enriquece, los califica con IA, los somete a aprobación humana y recién entonces los sincroniza con el CRM (Clientify). El principio rector es "nada va directo a Clientify": todo pasa por Nexus y por un gate humano.

Se evaluaron diez dimensiones técnicas (arquitectura funcional, arquitectura técnica, modelo de datos, integraciones, escalabilidad, seguridad, performance, mantenibilidad, operaciones y viabilidad del roadmap). El diseño es de alta calidad conceptual: separa correctamente las capas, garantiza atomicidad e inmutabilidad de la auditoría, y aplica lecciones reales de incidentes previos del propio sistema. No es un diseño improvisado.

Sin embargo, el panel identificó 62 hallazgos, de los cuales 5 son críticos y 27 son altos. Lo más relevante para Dirección: las migraciones de base de datos entregadas **no se aplicarían correctamente** tal como están (referencian columnas inexistentes y se contradicen entre sí), y hay **contradicciones internas en el propio diseño** (qué se construye en cada fase, qué campos existen en cada tabla) que, de no resolverse antes de escribir código, generarían retrabajo en cascada.

El veredicto es **GO WITH CHANGES**. El diseño es sólido y debe avanzar, pero exige una fase previa de corrección (estimada en 6 días-persona) antes de tocar código, donde se resuelvan los bloqueantes documentales y de base de datos. El costo de no hacerla es alto: el primer intento de aplicar las migraciones fallaría por completo.

El esfuerzo total estimado para llegar al loop de negocio completo (prospecto → Clientify) es de **68 días-persona** para un desarrollador senior, aproximadamente 14 semanas. El panel recomienda además dos cambios de secuencia de alto impacto: dividir la fase inicial en dos gates más pequeños, e insertar un hito temprano de sincronización manual a Clientify para que el equipo comercial vea valor en la semana 1 y no después de cuatro meses de infraestructura. El mayor riesgo de cronograma no es técnico sino externo: la dependencia de un proveedor de enriquecimiento aún no contratado.

---

## DICTAMEN FINAL DEL ARB

### **GO WITH CHANGES**

El Blueprint de Prospección Inteligente es aprobado para implementación, **condicionado a la ejecución de una fase de prerrequisitos (F0-PRE) antes de escribir la primera línea de código de aplicación**. El panel no recomienda NO GO porque el diseño es arquitectónicamente correcto en sus fundamentos y reusa patrones ya probados en producción en este mismo sistema; tampoco recomienda GO incondicional porque existen cinco hallazgos críticos que, de ignorarse, provocan fallos de implementación garantizados en el primer apply.

**Primero, el diseño merece avanzar.** La separación de capas (Regla de Dependencia tratada como ley constitucional), el patrón Transactional Outbox con atomicidad de transacción única, el control de concurrencia en Postgres (FOR UPDATE SKIP LOCKED), la RLS como frontera de seguridad real, y la codificación de lecciones operativas concretas (el incidente del 504 por Inactivity Timeout del Drive Sync de junio 2026) son decisiones maduras. El score global ponderado de 6.29/10 refleja un diseño bueno con ejecución de detalle incompleta, no un diseño defectuoso.

**Segundo, hay bloqueantes reales que no pueden diferirse.** La migración 0089 no compila: define índices sobre columnas que no existen (next_attempt_at, seq), duplica definiciones de índices con firmas contradictorias, y como Postgres hace rollback atómico, un solo CREATE INDEX fallido revierte TODA la migración (tablas, RLS, RPC, seed RBAC). Existe una contradicción CC-6 donde campos prohibidos (clientify_contact_id/deal_id) fueron eliminados del DDL pero reintroducidos en el diagrama ER y en el tipo TypeScript, lo que garantiza que el equipo los reintroduzca. Y hay una discrepancia directa entre el DDL y el roadmap sobre qué tablas pertenecen a qué fase, que bloquearía F1.

**Tercero, el costo de la corrección es bajo y el apalancamiento es altísimo.** Como las migraciones 0088/0089/0091 todavía no existen en producción (están "entregadas como documentos, no aplicadas"), corregirlas ahora es barato: no hay nada que revertir. Los ~6 días de F0-PRE evitan retrabajo en cascada a lo largo de F0–F5. Omitir esta fase no elimina el trabajo; lo traslada a un rollback atómico costoso en el primer intento de despliegue real.

**Cuarto, el riesgo dominante del proyecto es externo, no de diseño.** La fase F2 (enriquecimiento) introduce el primer proveedor externo real, y ese proveedor no está definido (contrato, costo por request, SLA, acceso). Sin él, F2 puede demorarse y bloquear F3→F4→F5. El panel exige una decisión de proveedor —o un stub funcional— como ADR antes de iniciar F2. Esta es una decisión de negocio que Dirección debe tomar, no una falla de arquitectura.

En síntesis: avanzar, pero ejecutar F0-PRE primero, adoptar los dos cambios de secuencia recomendados (split de F0 e inserción de F5-lite), y resolver la dependencia de proveedor de enriquecimiento como precondición de negocio para F2.

---

## SCORECARD — 10 DIMENSIONES

| Dimensión | Score | Issues C | Issues H | Issues M | Issues L |
|---|:---:|:---:|:---:|:---:|:---:|
| Arquitectura Funcional | 6.5 | 0 | 4 | 6 | 1 |
| Architecture Technical (Clean/DDD/SOLID) | 6.8 | 2 | 3 | 4 | 2 |
| Data Model | 6.8 | 1* | 5 | 6 | 2 |
| API Integration & Sync | 6.8 | 0 | 4 | 6 | 1 |
| Scalability | 6.2 | 0 | 6 | 1 | 3 |
| Security | 6.5 | 2* | 4 | 5 | 1 |
| Performance & SLOs | 5.5 | 1* | 5 | 2 | 1 |
| Mantenibilidad y Deuda Técnica | 5.8 | 0 | 4 | 0 | 7 |
| Operaciones y Observabilidad | 5.5 | 0 | 3 | 5 | 2 |
| Roadmap Viability (F0–F7) | 6.5 | 1 | 2 | 2 | 5 |

\* Varios CRITICAL son hallazgos consolidados reportados por múltiples revisores (p. ej. CONS-C1 fue detectado simultáneamente por Data Model, Security y Performance). El conteo por dimensión refleja la dimensión de origen; el total de issues únicos consolidados es 62.

**Score Global Ponderado:** **6.29/10**

Distribución de severidad (issues consolidados): **5 CRITICAL · 27 HIGH · 23 MEDIUM · 7 LOW**.

---

## HALLAZGOS CRÍTICOS (CRITICAL — bloquean implementación)

### CRIT-1 — Migración 0089 no aplica: índices del Outbox referencian columnas inexistentes y hay duplicados contradictorios
**ID:** CONS-C1 (DM-002 / SEC-CRIT-01 / PERF-008 + DM-003 / DM-004) · **Dimensión:** Data Model / Security / Performance · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0 (pre-migración)

**Descripción técnica.** Detectado por tres revisores independientes. El DDL de `prospeccion_events` define dos veces `prospeccion_events_aggregate_idx` y `prospeccion_events_pending_idx` (y `prospeccion_prospects_status_idx`) con firmas distintas. El bloque "ARB C-2" referencia columnas `next_attempt_at` y `seq` que **no existen** en el CREATE TABLE (solo existe `available_at`, sin `seq`). `CREATE INDEX IF NOT EXISTS` comprueba el nombre, no la definición, por lo que la versión útil se descarta en silencio; y en el caso de `seq`/`next_attempt_at` el `CREATE INDEX` falla con "column does not exist".

**Impacto.** Postgres ejecuta migraciones en transacción: un solo índice fallido provoca **rollback atómico de toda la 0089** —tablas, RLS, RPC de ingest, seed RBAC—. La migración entera no se aplica. Es un fallo garantizado en el primer apply, no un riesgo probabilístico.

**Recomendación concreta.** (1) Añadir columna `seq bigserial not null` a `prospeccion_events` para garantizar orden total de inserción (resuelve también CRIT-adyacente DM-004). (2) Decidir entre `available_at` y `next_attempt_at` y usar un único nombre en todo el DDL. (3) Eliminar los bloques duplicados de índices, dejando una sola definición: dispatch `(status, available_at, seq) WHERE status IN ('pending','failed')`, aggregate `(aggregate_id, seq)`, y status de prospects unificado a `(status, created_at desc)`. (4) Validar que el DDL compile en un branch efímero de Supabase antes del gate G5.

---

### CRIT-2 — Contradicción CC-6: IDs de CRM eliminados del DDL pero reintroducidos en el ER y en el Row type
**ID:** CONS-C2 (DM-001 / SEC-CRIT-02) · **Dimensión:** Data Model / Security · **Esfuerzo:** XS · **Impacto:** HIGH · **Bloquea:** F0 (pre-código)

**Descripción técnica.** Detectado por dos revisores. La regla ARB CC-6 elimina `clientify_contact_id` y `clientify_deal_id` de `prospeccion_prospects` (deben vivir solo en `prospeccion_crm_refs`) y el DDL los omite correctamente. Pero el diagrama Mermaid (§1.3) y la interfaz TypeScript `ProspeccionProspectRow` (§3.2) los siguen declarando.

**Impacto.** El equipo tomará el Row type generado como fuente de verdad y reintroducirá los campos prohibidos, filtrando IDs de CRM a la fila PII que tiene una RLS más amplia. Según la propia CC-6, esto es causa de rechazo en Architecture Review. Es una bomba de tiempo de seguridad sembrada en la documentación.

**Recomendación concreta.** Eliminar `clientify_contact_id` y `clientify_deal_id` del diagrama ER (§1.3) y de la interfaz `ProspeccionProspectRow` (§3.2). Añadir comentario `// crm ids viven en prospeccion_crm_refs, NO aquí (CC-6)`. Generar los tipos TS desde el schema real post-migración (`mcp__supabase__generate_typescript_types`) para eliminar el drift de raíz.

---

### CRIT-3 — Discrepancia de asignación de fases entre el DDL y el roadmap
**ID:** ROAD-001 · **Dimensión:** Roadmap Viability · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F1 (decidir antes de F0)

**Descripción técnica.** El DDL (§1.1) asigna `prospeccion_enrichment`/`prospeccion_scores` a F1 y `prospeccion_ai_content`/`prospeccion_human_decisions` a F2. El roadmap invierte esto: gate humano/HumanDecision a F1, enrichment a F2, scoring a F3, IA a F4. Son dos fuentes de verdad contradictorias sobre qué se construye cuándo.

**Impacto.** Si el desarrollador sigue el DDL, construirá F1 (ApproveProspect) **sin la tabla `prospeccion_human_decisions`** donde persistir la decisión, bloqueando la implementación. Las migraciones entregadas no son coherentes con el orden de fases del roadmap.

**Recomendación concreta.** Reconciliar ambos documentos en sesión de ARB antes de escribir código. Alinear el DDL a la secuencia del roadmap (F1 = `prospeccion_human_decisions`; F2 = enrichment + scores; F3/F4 = ai_content). Emitir un ADR de corrección. Bloqueante para F1; debe decidirse en F0-PRE para fijar el orden de migraciones.

---

### CRIT-4 — CS-RPC-1 puede invertir la frontera de Clean Architecture (lógica de negocio migrando a PL/pgSQL)
**ID:** ARCH-002 · **Dimensión:** Architecture Technical · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0 (antes del primer RPC)

**Descripción técnica.** CS-RPC-1 obliga a que cada use case mutante sea una función PL/pgSQL `SECURITY DEFINER`, pero no restringe qué puede contener. Si un ingeniero añade validación de estado o de invariantes en el PL/pgSQL (impulso natural al depurar transacciones), la capa de Infraestructura (Postgres) pasa a poseer reglas de dominio y la Regla de Dependencia se invierte **de forma permanente y sin que ningún lint lo detecte**.

**Impacto.** Erosión silenciosa de la arquitectura. El mandato es correcto por atomicidad, pero la ausencia de prohibición explícita garantiza que, bajo presión de debugging, la lógica de negocio termine en la base de datos —exactamente lo que la arquitectura quiere evitar.

**Recomendación concreta.** Clarificar el mandato: las funciones RPC DEBEN ser puramente mecánicas (INSERT estado del AR + INSERT outbox en una transacción, sin condicionales ni validación de reglas). Todos los checks INV-PR-1..6 viven en el AR TypeScript antes de `UnitOfWork.run()`. Renombrar a "persistence RPCs" y añadir nota normativa: "la RPC recibe un snapshot pre-validado; NO re-valida reglas de negocio".

---

### CRIT-5 — `ProspectRepositoryPort.nextId()` viola SRP y rompe el contrato del Repositorio
**ID:** ARCH-001 · **Dimensión:** Architecture Technical · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0 (antes de escribir puertos/repos)

**Descripción técnica.** El puerto de repositorio incluye `nextId()` delegando a `IdGeneratorPort`, conflando generación de ID con persistencia y creando una cadena de dependencias implícita invisible para el Use Case. El Use Case ya lista `IdGeneratorPort` entre sus dependencias.

**Impacto.** Contrato del repositorio contaminado desde el primer día; la dependencia real (generación de ID) queda oculta tras el repositorio, dificultando el testing y violando responsabilidad única. Es deuda estructural fácil de evitar ahora e incómoda de revertir después.

**Recomendación concreta.** Eliminar `nextId()` de `ProspectRepositoryPort`. `ImportProspectsUseCase` recibe `IdGeneratorPort` directamente y pasa el `ProspectId` pre-generado a `ProspectFactory.fromImportRow()`. Hace la dependencia explícita y mantiene el contrato del repositorio limitado a persistencia.

---

## HALLAZGOS ALTOS (HIGH — deben resolverse en su fase)

### ALT-1 — DoD-11 exige eslint-plugin-boundaries pero el paquete no está instalado
**ID:** ROAD-002 · **Esfuerzo:** XS · **Impacto:** HIGH · **Bloquea:** F0
DoD-11 (gate bloqueante de F0) requiere `eslint-plugin-boundaries` y zonas hexagonales en `.eslintrc.json`. Verificado contra el repo: el paquete NO está en package.json ni node_modules; `.eslintrc.json` solo extiende `next/core-web-vitals`. El gate de F0 no puede cumplirse. **Recomendación:** instalar como devDependency, definir zonas `domain/application/infrastructure/ui` para prospeccion, agregar el check a CI. ~0.5 día, antes del primer PR.

### ALT-2 — `prospeccion_ingest` sin límite de tamaño de lote (DoS y costo descontrolado)
**ID:** CONS-H1 (DM-011 / SEC-HIGH-02) · **Esfuerzo:** XS · **Impacto:** MEDIUM · **Bloquea:** F0
La RPC itera sobre `jsonb_array_elements(p_rows)` sin cota. Un CSV de 10k–100k filas agota el timeout serverless (26–30s) dejando estado a medias, mantiene locks largos y en F1+ dispara miles de llamadas a enrichment/LLM. **Recomendación:** guarda al inicio de la RPC `IF jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'BATCH_TOO_LARGE'`; el route handler valida tamaño de archivo (~2MB) y conteo de filas antes de llamar; worker pagina en lotes ≤200–500.

### ALT-3 — Mecanismo de import de LinkedIn arquitectónicamente ambiguo (CSV vs API vs scraper)
**ID:** INT-003 · **Esfuerzo:** XS · **Impacto:** HIGH · **Bloquea:** F0
El event storming menciona "selecciona un perfil o un cron lo levanta" — dos adapters con perfiles legales radicalmente distintos (CSV manual sin costo/ToS; API Sales Navigator ~$15k/año restringida; scraper ilegal y con riesgo de ban). Es el bloqueante de mayor probabilidad para la entrega de F0. **Recomendación:** ADR-011 que elija explícitamente CSV export de Sales Navigator → `FileImportAdapter` implementando `ImportPort`. Documentar que el scraping está PROHIBIDO y que la API requiere enrollment de partnership.

### ALT-4 — Casos de uso de lectura (bandeja) y SLO de la bandeja sin modelar
**ID:** CONS-H2 (GAP-004 + PERF-001) · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0
La bandeja es la UI primaria pero no hay especificación de `ProspectListView`/`ProspectDetailView`, ni paginación, ni target p50/p95. Una query con RLS `has_permission()` por fila sin LIMIT puede costar 2–8s a 5.000 registros. **Recomendación:** sección de Read Models como entregable de F0 con paginación keyset (page_size 25–50, `WHERE created_at < :cursor ORDER BY created_at DESC LIMIT N`). SLO: p95 < 500ms página 1, < 800ms interiores. Verificar que `has_permission()` sea inlineable/indexable.

### ALT-5 — User journeys de los actores comerciales no especificados
**ID:** GAP-002 · **Esfuerzo:** M · **Impacto:** HIGH · **Bloquea:** F1
El blueprint detalla el pipeline técnico pero no qué experimenta el comercial: cómo llega a la bandeja, qué ve antes de aprobar/rechazar, si puede editar, cómo se entera de nuevos prospectos. Sin esto, F1 puede producir una pantalla de aprobación que nadie use. **Recomendación:** sección de User Journeys (Aprobar/Rechazar/Buscar) con wireframes; el mecanismo de notificación de cola es entregable de F1, no de F6.

### ALT-6 — ROI diferido hasta F5: insertar hito de sync manual (F5-lite) entre F1 y F2
**ID:** CONS-H3 (GAP-003 + ROAD-003) · **Esfuerzo:** M · **Impacto:** HIGH · **Bloquea:** F1
Detectado por dos revisores con idéntica recomendación. El comercial no ve ningún prospecto en Clientify hasta F5/F6, tras 4–6 fases de infraestructura, con riesgo de abandono o presión para saltar el gate. La dependencia F5→F4/F3 es convención de secuencia, no técnica: INV-PR-2 solo exige estado "approved", no IA previa. **Recomendación:** insertar F5-lite entre F1 y F2 (botón "Sincronizar ahora" sin enrichment/IA); reordenar F0→F1→F5-lite→F2→F3→F4→F5-full. Entrega el loop No-Bypass completo en ~3 fases.

### ALT-7 — Estado "rechazado" terminal sin mecanismo de reactivación (impacta el DDL)
**ID:** GAP-001 · **Esfuerzo:** M · **Impacto:** HIGH · **Bloquea:** F1
INV-PR-6 declara "rejected" terminal sin transiciones salientes. En B2B (ciclos 3–18 meses) el rechazo suele ser temporal; sin reactivación, re-abordar crea un duplicado o viola la inmutabilidad de HumanDecision. **Recomendación:** definir "ReactivateProspect" que no mute la HumanDecision existente, emita "ProspectReactivated" con actor/motivo/timestamp, y modele HumanDecision como colección (no singleton). Decidir ANTES de F1 porque impacta el DDL.

### ALT-8 — Modelo de datos canónico (ApprovedProspectView/ProspectView) indefinido y sin capa anclada
**ID:** CONS-H4 (INT-001 + ARCH-006) · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F4/F5
Los puertos CrmSyncPort/AIPort reciben Views que no tienen schema ni capa declarada. Cada autor de adapter inventará su interpretación. Si las Views se definen fuera de Domain, se rompe la Regla de Dependencia. **Recomendación:** definir `ProspectView`/`ApprovedProspectView` como proyecciones read-only en `prospeccion/domain/views/` (generadas por el AR vía `toView()`), con matriz de mapeo canónico→Clientify/HubSpot/Salesforce. Añadir a eslint-boundaries que los ports importen de domain pero no de adapters.

### ALT-9 — Rate limiter "persistido" declarado tres veces pero sin contrato de implementación
**ID:** INT-002 · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F2/F5
CRM-9/AI-8/EVT-10 mencionan rate limiter persistido pero no hay schema, algoritmo, lectura del Dispatcher ni dueño del estado bajo concurrencia serverless. Cada fase implementará un limiter in-memory (la ruta de menor esfuerzo), rompiendo la garantía en cada ejecución concurrente. **Recomendación:** tabla `crm_rate_limit_state(adapter_id, window_start, call_count, window_seconds)`; token bucket; `SELECT FOR UPDATE` sobre la fila del limiter antes de desencolar; referenciar el límite real de Clientify (300 req/min pago).

### ALT-10 — Colisión entre `crm_ingest_lead` (mig 0048) y `prospeccion_ingest` (mig 0089): dos caminos a Clientify
**ID:** INT-004 · **Esfuerzo:** M · **Impacto:** HIGH · **Bloquea:** F5 (y F5-lite)
La función prod `crm_ingest_lead` ya escribe `crm_leads` y dispara sync a Clientify. El nuevo `prospeccion_ingest` + `crm_promote_lead` puede crear una segunda fila para un email ya existente del pipeline webhook. En prod se manifiesta como contactos duplicados. **Recomendación:** el dedup de `prospeccion_ingest` DEBE consultar `crm_leads` por email/phone/CUIT antes de crear (link, no insert); `crm_promote_lead` verifica filas existentes; definir si ambos pipelines convergen en la misma fila `crm_leads` o son mutuamente excluyentes por fuente.

### ALT-11 — `prospeccion_crm_refs` con RLS habilitada pero sin policies y sin updated_at
**ID:** DM-006 (+ SEC-LOW-01) · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0
La tabla habilita RLS sin definir ninguna policy; la UI necesita leerla para saber si un prospecto fue sincronizado, y un join authenticated devolverá 0 filas en silencio, induciendo workarounds que evaden RLS. Además carece de `updated_at`. **Recomendación:** SELECT para `has_permission('prospeccion.view')`; INSERT/UPDATE solo service_role/DEFINER; DELETE solo `is_admin()`; agregar `updated_at` + trigger `tg_touch_updated_at`. Si se deja deny-all hasta F3, documentarlo con un test que asegure que es intencional.

### ALT-12 — Tablas sin updated_at violando la convención normativa (import_jobs y sources)
**ID:** DM-005 (+ DM-012) · **Esfuerzo:** XS · **Impacto:** MEDIUM · **Bloquea:** F0
`prospeccion_import_jobs` no puede trackear cuándo pasó de running a completed/error (el dato operacional más importante de un job log); `prospeccion_sources` puede mutar "active" sin trazabilidad. **Recomendación:** agregar `updated_at` + trigger a ambas; para import_jobs considerar `started_at`/`completed_at` explícitos.

### ALT-13 — Tabla `prospeccion_event_consumers` (dedup EVT-4) ausente del DDL
**ID:** SCALE-10 · **Esfuerzo:** XS · **Impacto:** MEDIUM · **Bloquea:** F0
EVT-4 prescribe deduplicación `(event_id, consumer_name)` pero el DDL no incluye la tabla. Sin ella, un replay o un Dispatcher+replay simultáneos procesan eventos dos veces y pueden sincronizar el mismo prospecto al CRM dos veces. **Recomendación:** incluir en 0089 `(event_id uuid, consumer_name text, processed_at timestamptz, PRIMARY KEY (event_id, consumer_name))`. Sin ella, las garantías de idempotencia de EVT-4 son aspiracionales.

### ALT-14 — `prospeccion_events` sin columna seq: el Outbox no garantiza orden causal
**ID:** DM-004 · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0
El Outbox usa `id uuid` (no monotónico) y `created_at` (colisiona en inserciones en lote en la misma tx). Sin `seq bigserial` el worker no puede procesar en orden de emisión, pudiendo violar causalidad (prospect.imported antes de prospect.created). **Recomendación:** agregar `seq bigserial not null`; dispatch index `(status, available_at, seq)`; aggregate index `(aggregate_id, seq)`. Se resuelve junto con CRIT-1.

### ALT-15 — Outbox crece indefinidamente: EVT-7 prescribe particionado mensual no implementado
**ID:** SCALE-03 (+ PERF-005) · **Esfuerzo:** M · **Impacto:** HIGH · **Bloquea:** F2/F3
`prospeccion_events` no tiene `PARTITION BY RANGE`, ni cron de archivado, ni índice BRIN. A 5.000 prospectos/mes (~9 eventos c/u) son ~540K filas/año; la query de despacho degrada alrededor de 500K–1M filas. **Recomendación:** particionado mensual + cron de archivado a tabla cold antes de purgar; como mínimo declarar umbral de activación (">100K filas") y validar EVT-7 en DoD antes de F3. Separar la tabla de dedup de la de eventos para diferenciar retención.

### ALT-16 — Throughput de la etapa IA ~12–24 prospectos/hora vs SLA EVT-12 "cientos/hora"
**ID:** CONS-H5 (SCALE-01 + PERF-002) · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F4
Detectado por dos revisores con la misma matemática. Con NFB-3 (15s/prospecto) y GH Actions cada 5 min, el techo es ~12–24/hora; 1000 prospectos tardan 41–83h; 5000 tardan ~8–17 días. EVT-12 promete "cientos/hora". Ninguno de estos números aparece en el blueprint. **Recomendación:** declarar el throughput real como NFB explícito y reconciliar EVT-12 vía ADR; evaluar modelos rápidos (GPT-4o-mini/Haiku) para bajar NFB-3 a 3–5s, o pg_cron a 1 min; documentar el umbral de volumen que exige worker dedicado.

### ALT-17 — Lotes masivos (5000 CSV): sin degradación graceful, sin ETA visible, sin priorización
**ID:** SCALE-02 · **Esfuerzo:** M · **Impacto:** HIGH · **Bloquea:** F2
Un CSV de 5000 filas genera 10.000 eventos y un backlog de >1 semana, sin comunicación de ETA ni mecanismo para que importes urgentes pequeños no queden detrás del lote masivo. **Recomendación:** DoD con "ETA visible" (UI muestra backlog y estimación por throughput medido); imports > N requieren confirmación y se enrolan en lane Low.

### ALT-18 — Lag del Outbox no detectable en tiempo real (riesgo de quiebre silencioso)
**ID:** SCALE-04 · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F2
EVT-6 pide dashboard de backlog desde día 1 pero MetricsPort no existe, no hay índice sobre `(status='pending', created_at)`, y el umbral de DLQ es texto libre. Escenario: CRON_SECRET ausente en un deploy → todos los crons 401 → el Outbox crece sin que nadie lo note hasta las 48h. **Recomendación:** NFB "latencia máxima de detección de lag = 15 min"; health-check `MAX(now()-created_at) WHERE status='pending'` con alerta a 2 ciclos de cron; umbral DLQ concreto (`count(dead) > 10 en 1h`); índice parcial para query O(log n).

### ALT-19 — Patrón de conexión del Dispatcher: claim-then-release y pgBouncer transaction-mode no especificados
**ID:** CONS-H6 (SCALE-07 + PERF-006) · **Esfuerzo:** M · **Impacto:** MEDIUM · **Bloquea:** F2
Mantener una tx abierta durante una llamada al LLM de 15s es el anti-patrón que causó el Inactivity Timeout del Drive Sync y consume el pool de pgBouncer. En transaction pooling, los advisory locks de sesión NO persisten, por lo que NFB-8 debe ser `SELECT FOR UPDATE SKIP LOCKED` dentro de tx explícita. **Recomendación:** claim-then-release: (1) SELECT FOR UPDATE SKIP LOCKED, (2) UPDATE status='processing' + COMMIT inmediato, (3) llamar al proveedor sin conexión DB, (4) nueva conexión para el UPDATE final. Documentar tope de conexiones concurrentes por corrida.

### ALT-20 — Latencia e2e (50–90 min) y SLO de sync CRM (≤5 min) no alcanzables sin pg_cron
**ID:** CONS-H7 (PERF-004 + PERF-007) · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F5
El camino feliz import→crm_sync_completed tarda 50–90 min por los tiempos de cola entre crons de 5 min, sin SLO declarado. La lane Critical promete ≤5 min pero GH Actions tiene granularidad ~5 min + latencia de runners (5–8 min p95 real). **Recomendación:** declarar SLO e2e (p95 < 2h, aceptable 50–90 min); ajustar SLO Critical a "≤8 min p95 GH Actions / ≤2 min p95 pg_cron"; ADR con umbral de activación de pg_cron ("primer cliente aprobado en prod").

### ALT-21 — Cold start de Netlify Functions no presupuestado en NFB-1 (riesgo de 504 en IA)
**ID:** CONS-H8 (SCALE-06 + PERF-003) · **Esfuerzo:** XS · **Impacto:** MEDIUM · **Bloquea:** F4
NFB-1 fija ~26–30s pero no descuenta el cold start (~0.3–2s). Para el dispatcher de IA (NFB-3 15s + 1 reintento = hasta 30s), un cold start de 3s puede llevar la invocación a >26s y provocar el 504 que el blueprint cita como precedente real. **Recomendación:** desglosar NFB-1 (cold start ≤2s, claim/commit ≤2s, mapeo ≤1s → ≤21s de trabajo de proveedor); usar `AbortSignal.timeout` a 24s propagado al fetch.

### ALT-22 — Blast radius de CRON_SECRET subespecificado (secreto único de larga vida, sin rotación ni rate limiting)
**ID:** SEC-HIGH-01 · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F2
CRON_SECRET es compartido entre todas las rutas cron, sin rotación ni scoping. Si se compromete, un atacante puede drenar el Outbox a ritmo arbitrario (amplificación de costo IA/enrichment, polución en Clientify). **Recomendación:** rotación explícita (90 días o ante exposición); secretos por endpoint (PROSPECCION_CRON_SECRET vs COMPLIANCE_CRON_SECRET); rate limit en `/dispatch` (max 1/min); el endpoint NO acepta event IDs/filtros del caller (auto-selecciona pending del DB).

### ALT-23 — Fuga de PII en `prospeccion_events.error` e `import_jobs.report`
**ID:** SEC-HIGH-03 · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0 (regla) / F2 (alcance de borrado)
Los mensajes de excepción pueden incluir valores de filas (full_name, email, phone, linkedin_url) que se persisten en `events.error` e `import_jobs.report`, ninguno cubierto por `prospeccion_pii_erase`. **Recomendación:** regla "los mensajes de excepción NO incluyen valores PII (solo row index, source slug, short_id, error code)"; extender el borrado PII a `events.error` (`[PII_REDACTED]`) e `import_jobs.report`; gate testeable en DoD-8.

### ALT-24 — Falta permiso `prospeccion.approve`: el gate humano colapsa dos niveles de confianza en "edit"
**ID:** SEC-MED-01 (impacto HIGH) · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F2
El seed RBAC define view/create/edit/delete/admin. El gate de aprobación se implementaría con `prospeccion.edit`, permitiendo que el mismo comercial importe y apruebe sin segundo par de ojos. Viola la segregación de funciones en el paso más consecuente del módulo. **Recomendación:** agregar `prospeccion.approve` al enum `permission_action_t`, otorgado solo a director_ops y admin (no a comercial). Requisito de seguridad para F2.

### ALT-25 — Proveedor de enrichment (F2) no definido: contrato, costo y acceso desconocidos
**ID:** ROAD-008 (impacto HIGH) · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F2
F2 es la primera fase que toca proveedor externo real pero no se identifica cuál (Apollo/Clearbit/Hunter/AFIP), su contrato, costo/request ni acceso. Si F2 se demora 3x, bloquea F3→F4→F5. **Recomendación:** antes de iniciar F2, documentar proveedor, endpoint, costo, sandbox/prod y SLA como ADR. Si no está definido, implementar un stub del EnrichmentPort (datos mínimos AFIP/ARCA o CSV manual) para no bloquear F3/F4.

### ALT-26 — No existe query/vista estándar de "pipeline health" ni del funnel del Outbox
**ID:** OPS-01 · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0
EVT-6/R-7.6.6 exigen dashboard de Event Bus desde día 1, pero no hay VIEW ni RPC en el DDL que responda "cuántos prospectos hay en cada estado" ni el estado del Outbox. El primer diagnóstico en prod requiere escribir el query de cero. **Recomendación:** agregar al DDL `VIEW prospeccion_pipeline_health (status, count)`, `VIEW prospeccion_outbox_health (status, event_type, count, max_age)` y función `prospeccion_pipeline_status()` para el health endpoint.

### ALT-27 — DLQ especificada pero sin runbook de resolución, umbral concreto ni SLA
**ID:** OPS-02 · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F2
EVT-3 dice "un dead es un incidente operativo" pero no define umbral de alerta, canal, pasos del operador ni tiempo a resolución. Para un operador sin oncall, la ausencia de runbook es crítica. **Recomendación:** runbook de DLQ (query de diagnóstico, clasificación transitorio/permanente, re-encolado, validación); umbral `count(dead) > 3 en 24h`; SLA resolver < 4h en horario ART.

### ALT-28 — Numeración de ADRs duplicada: dos conjuntos ADR-001..010
**ID:** MTD-02 · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0
El archivo 55 contiene ADR-001..014 y el 60 contiene ADR-001..010 con contenido parcialmente solapado/distinto. Citar "ADR-003" es ambiguo. Viola AP-17 (una sola fuente de verdad) aplicado al propio blueprint. **Recomendación:** consolidar todos los ADRs en `55-adr-ledger.md` como fuente canónica; los del archivo 60 ausentes en el 55 se renumeran como ADR-015..024.

### ALT-29 — RBAC dormido (RO-2) sin plan de resolución ni fase de activación
**ID:** MTD-03 · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0/F1
El RBAC dormido es la frontera real de seguridad, marcado Alta/Alto, pero el blueprint no define cuándo se activa ni qué gates lo requieren. El sistema entra en producción con una deuda de seguridad estructural indefinida. **Recomendación:** ADR-015 que documente estado actual, por qué está dormido, condiciones de activación y la fase (F1 o F2 a más tardar) donde se vuelve prerequisito; DoD-5 verifica que los grants del módulo existen antes del merge de F0.

### ALT-30 — Carga cognitiva de onboarding prohibitiva (4463 líneas / 17 archivos)
**ID:** MTD-01 · **Esfuerzo:** S · **Impacto:** HIGH · **Bloquea:** F0
Un segundo dev debe leer el blueprint entero antes del primer PR (2–3 días), sosteniendo en memoria 17 AP, 11 gates, 6 INV-PR, 8 NFBs, 24 ADRs y 10 DoD. **Recomendación:** `ONBOARDING.md` de ≤2 páginas (la invariante central en una oración, el diagrama de capas, los 3 comandos de verificación y los 2 hard-stops del review). El blueprint queda como referencia, no prerequisito.

### ALT-31 — F0 concentra la mayor complejidad técnica del roadmap, subestimada como "rebanada mínima"
**ID:** ROAD-004 · **Esfuerzo:** M · **Impacto:** HIGH · **Bloquea:** F0
F0 incluye AR completo + máquina de estados + VOs + dedup, RPC DEFINER idempotente, OutboxEventBus, UI con tabla/filtros/import, 3 migraciones con rollback y RLS, grants RBAC, vitest, y eslint-boundaries. Para un dev único son 8–12 días, no una iteración corta. **Recomendación:** dividir en F0a (migraciones + AR + RPC + tests, verificable por Dirección vía SQL) y F0b (UI + import CSV/manual). Gate más granular y feedback más corto.

### ALT-32 — AR Prospect sobre-cargado: tres sub-dominios en un solo agregado
**ID:** ARCH-003 · **Esfuerzo:** M · **Impacto:** MEDIUM · **Bloquea:** F1
Un único AR absorbe adquisición, análisis IA y decisión humana + idempotencia CRM, con una máquina de 9 estados que es esencialmente tres concatenadas. **Recomendación:** extraer `ProspectAnalysis` (AIAnalysis + HumanDecision) como AR separado coordinado por eventos; como mínimo, guarda formal "Prospect no debe exceder N campos/métodos; si lo hace, disparar revisión de split del AR".

### ALT-33 — OCP: extensión de proveedores IA/Enrichment sin punto de extensión definido
**ID:** ARCH-004 · **Esfuerzo:** M · **Impacto:** MEDIUM · **Bloquea:** F2/F4
AP-5 promete proveedores intercambiables, pero agregar uno hoy requiere modificar el Manager (registrarlo), violando OCP. El registry está implícito pero nunca definido. **Recomendación:** `AIProviderRegistry` (separado de AIPort) que el Manager consulta; nuevos proveedores se registran config-driven sin modificar el Manager; `EnrichmentManager` sigue el mismo patrón; documentar en ADR.

### ALT-34 — ISP + tipado: MetricsPort mezcla counters y gauges con nombres/tags string sin tipo
**ID:** ARCH-005 · **Esfuerzo:** S · **Impacto:** LOW · **Bloquea:** F4/F6
`MetricsPort` expone `increment()` y `observe()`; consumidores que solo cuentan deben tomar ambos. Usa nombres string (`'ai.latency_ms'`) y `Record<string,string>` sin type safety, donde un typo crea una métrica fantasma silenciosa. **Recomendación:** separar en `CounterPort` y `ObserverPort` con `MetricName`/`MetricTags` como enums/branded types; inyectar solo el sub-port necesario por Use Case.

---

## HALLAZGOS MEDIOS Y BAJOS (tabla resumida)

| Rank | ID | Dimensión | Título | Esfuerzo | Impacto |
|:---:|---|---|---|:---:|:---:|
| 41 | DM-007 | Data Model | Dedup por CUIT colapsa múltiples contactos de la misma empresa | M | HIGH |
| 42 | DM-010 | Data Model / Security | Sin soft delete: borrado de PII irreversible y sin audit trail | M | MEDIUM |
| 43 | DM-008 | Data Model | Sin índice único parcial para dedup: duplicados bajo concurrencia | S | MEDIUM |
| 44 | DM-009 | Data Model | Sin org_id: multi-tenancy ausente sin decisión single-tenant registrada | M | MEDIUM |
| 45 | GAP-007 | Arq. Funcional | Enrichment permanentemente fallido sin intervención manual (bloquea PYME) | M | MEDIUM |
| 46 | GAP-008 | Arq. Funcional | Sin notificaciones internas ni loop de primer contacto | S | MEDIUM |
| 47 | GAP-009 | Arq. Funcional | Datos mínimos visibles en la bandeja de F1 no especificados | S | MEDIUM |
| 48 | GAP-005 | Arq. Funcional | Import en lote (CSV/LinkedIn) sin especificación funcional | S | MEDIUM |
| 49 | GAP-006 | Arq. Funcional | Exportación de prospectos y métricas de dashboard no contempladas | S | MEDIUM |
| 50 | INT-008 | API Integration | Versionado de prompt no aborda evolución del schema de AIAnalysis | M | MEDIUM |
| 51 | INT-006 | API Integration | Granularidad de eventos de sync CRM no definida (retry parcial) | S | MEDIUM |
| 52 | INT-007 | API Integration | EnrichmentPort sin linkedin_url (no soporta caso B2B solo-LinkedIn) | S | MEDIUM |
| 53 | INT-009 | API Integration | Ventana F5→F7 con datos stale: cambios en Clientify no detectados | S | MEDIUM |
| 54 | INT-005 | API Integration | AIPort.analyze() acopla el dominio a EnrichmentSnapshot sin caso null | XS | MEDIUM |
| 55 | ARCH-009 | Arch. Technical | Liskov: adapters de EnrichmentPort sin contrato mínimo de cobertura | M | MEDIUM |
| 56 | ARCH-007/008 | Arch. Technical | CQRS sin mecanismo de proyección; Factory.reconstitute() ambiguo | M | MEDIUM |
| 57 | SEC-MED-04/05 | Security | Prompt injection y SSRF declarados sin implementación concreta | M | MEDIUM |
| 58 | SEC-MED-02 | Security | Secrets de enrichment sin nombres/rotación (gotcha Netlify secret) | S | MEDIUM |
| 59 | SEC-MED-03 | Security | Audit trail del Outbox vulnerable: service_role borra; rollback 0091 destruye auditoría | S | MEDIUM |
| 60 | OPS-06/08 | Operaciones | Umbrales de lag/DLQ/backlog y alertas de costo IA sin valores concretos | S | MEDIUM |
| 61 | OPS-03/04/05 | Operaciones | Catch-up post-outage, liveness/readiness y protocolo de deployment del Outbox | M | MEDIUM |
| 62 | CONS-LOW | Multi-dimensión | Cluster de ~35 issues LOW (deuda menor, especificación fina, mejoras diferibles) | M | LOW |

**Nota sobre el cluster LOW (rank 62):** agrupa los hallazgos no bloqueantes de todos los revisores (ARCH-010/011, DM-013/014, MTD-04..11, ROAD-005..010, GAP-010/011, INT-010/011, SEC-LOW-02, OPS-09/10, SCALE-05/08/09, PERF-009). El panel recomienda diferirlos al backlog de calidad y abordarlos oportunísticamente en su fase, **con seis excepciones de bajo esfuerzo/alto retorno a priorizar**: ARCH-011 (DomainError tipado antes del primer Use Case), MTD-09 (audit de migraciones drifteadas antes de aplicar 0088), DM-013 (trigger CHECK de transiciones antes de F2), SCALE-08/PERF-009 (estimación de costo enrichment + TTL de cache antes de F2), y ROAD-006/ROAD-007 (ScoringPolicy implementada durante F2 y Dashboard mínimo desde F1).

---

## ROADMAP DE IMPLEMENTACIÓN — VALIDACIÓN ARB

| Fase | Objetivo | Esfuerzo (días-persona) | Riesgo | Dictamen ARB |
|---|---|:---:|:---:|:---:|
| **F0-PRE** | Reconciliación DDL/roadmap + corrección de migraciones + prerrequisitos bloqueantes | 6 | CRITICAL | GO WITH PREREQUISITES |
| **F0** | Rebanada vertical: import + bandeja read-only + Outbox | 11 | HIGH | GO WITH PREREQUISITES |
| **F1** | Estados + aprobación / gate humano | 6 | HIGH | GO WITH PREREQUISITES |
| **F1.5 / F5-lite** | Sync manual a Clientify + dashboard mínimo (INSERCIÓN ARB) | 5 | MEDIUM | GO WITH PREREQUISITES |
| **F2** | Enriquecimiento asíncrono (primer proveedor externo) | 9 | CRITICAL | GO WITH PREREQUISITES |
| **F3** | Scoring (política pura, sin IA) | 3 | LOW | GO |
| **F4** | IA comercial (datos redactados) | 7 | HIGH | GO WITH PREREQUISITES |
| **F5** | Sync CRM outbound full | 6 | HIGH | GO WITH PREREQUISITES |
| **F6** | Dashboard + cierre de loop (CreateCustomer) | 4 | MEDIUM | GO |
| **F7** | Bidireccional + nuevas fuentes / ABM | 11 | HIGH | GO WITH PREREQUISITES |

> Nota: el total nominal de la tabla (68) coincide con la estimación agregada del panel. Si se adoptan los cambios de secuencia recomendados, F5-full se reduce de 6 a ~3–4 días y F3/F6 también se acortan (ScoringPolicy y dashboard mínimo adelantados), de modo que la inserción de F5-lite es en gran medida auto-financiada.

### Detalle por Fase

#### F0-PRE — Prerrequisitos bloqueantes (6 días · CRITICAL · GO WITH PREREQUISITES)
**Objetivo.** Resolver los bloqueantes CRITICAL/HIGH declarados pre-código: reconciliar DDL vs roadmap (CRIT-3), corregir la migración 0089 que no compila (CRIT-1: índices con columnas inexistentes, duplicados; añadir `seq bigserial`), eliminar `clientify_contact_id/deal_id` del ER y del Row type (CRIT-2/CC-6), instalar y configurar eslint-plugin-boundaries (ALT-1/DoD-11), emitir ADR de import LinkedIn = CSV (ALT-3), clarificar RPC como persistencia mecánica (CRIT-4), quitar `nextId()` del repo (CRIT-5), añadir `prospeccion_event_consumers` (ALT-13), `updated_at` a import_jobs/sources (ALT-12), policies+updated_at a crm_refs (ALT-11), VIEWs de health (ALT-26), guarda de batch ≤500 (ALT-2), regla anti-PII (ALT-23), consolidar ADRs (ALT-28) y escribir ONBOARDING.md (ALT-30). Validar el DDL en un branch Supabase antes del gate G5.
**Dependencies.** Ninguna.
**Blockers.** CRIT-1..5, ALT-1, ALT-3, ALT-28.
**Success criteria.** El DDL de 0088/0089/0091 compila en un branch efímero sin rollback (seq presente, un solo set de índices, event_consumers incluida); DDL y fases reconciliados vía ADR único; `npm run lint` FALLA ante un import domain→infra de prueba; ADR-011 fija import = CSV; Row type sin clientify ids; ADRs con numeración única; ONBOARDING.md existe.
**Observaciones ARB.** Verificado contra el repo: eslint-plugin-boundaries NO está instalado; las migraciones del repo llegan a 0087, así que 0088/0089/0091 aún no existen en producción — la corrección del DDL es barata AHORA. Esta fase NO está en el roadmap original pero es trabajo ineludible (≥8 issues marcados "blocks_phase: F0 pre-código"). Es la fase de mayor apalancamiento: ~6 días aquí evitan retrabajo en cascada. Recomendación firme de sesión de ARB conjunta antes de tocar código.
**Recomendación.** GO WITH PREREQUISITES.

#### F0 — Rebanada vertical: import + bandeja read-only + Outbox (11 días · HIGH · GO WITH PREREQUISITES)
**Objetivo.** Probar la arquitectura extremo-a-extremo en lo mínimo: aplicar las migraciones corregidas (4 tablas base + outbox + event_consumers + enum de módulo + RLS por has_permission + grants RBAC), AR Prospect mínimo con VOs y dedup, RPC `prospeccion_ingest` mecánica e idempotente (con guarda de batch), OutboxEventBus transaccional, caso de uso ImportProspects (CSV/manual) y UI `/comercial/prospeccion` read-only con read models (ProspectListView + paginación keyset). Importar N filas ⇒ N prospectos imported + 2N eventos en la misma tx, cero escritura a Clientify.
**Dependencies.** F0-PRE.
**Blockers.** ALT-4 (read models sin modelar), ALT-2 (límite de batch, resuelto en F0-PRE pero ejercitado aquí), ALT-29 (RBAC dormido — DoD-5).
**Success criteria.** 100% de imports con su par de eventos en Outbox dentro de la misma tx; bandeja lista solo lo permitido por RLS; 0 escritura a Clientify; sin `using(true)`; DoD-0 completo (typecheck 0, build Node 22, vitest verde incl. test de RPC y dominio); SLO bandeja p95 < 500ms página 1; evidencia G5 adjunta.
**Observaciones ARB.** F0 concentra la mayor complejidad del roadmap pese a llamarse "rebanada mínima". Adoptar el split F0a (migraciones+AR+RPC+tests, verificable por Dirección vía SQL) / F0b (UI+import) reduce el riesgo de un gate de 11 días a dos gates de ~6 y ~5. El AR Prospect arrastra ALT-32 (sobre-cargado); fijar la guarda de split ya aquí. La infraestructura reusa patrones probados en prod (compliance/sync, caja-chica, clientify-dashboard), bajando el riesgo técnico de plataforma; el riesgo residual es de scope y DoD. Greenfield real: 0 líneas en src para prospeccion.
**Recomendación.** GO WITH PREREQUISITES (preferentemente con split F0a/F0b).

#### F1 — Estados + aprobación / gate humano (6 días · HIGH · GO WITH PREREQUISITES)
**Objetivo.** Materializar la máquina de estados y el gate humano (INV-PR-1/2/4): casos de uso ApproveProspect/RejectProspect, eventos HumanApproved/ProspectRejected, UI de revisión/aprobación y HumanDecision inmutable persistida. Transiciones ilegales rechazadas por el AR sin persistir; approved exige actorId real; toda decisión auditada.
**Dependencies.** F0.
**Blockers.** ALT-5 (user journeys sin especificar), ALT-7 (rejected terminal sin reactivación — decidir antes porque impacta el DDL), CRIT-3 (la tabla human_decisions debe existir desde F1).
**Success criteria.** 0 transiciones ilegales aceptadas (DomainError, nada se persiste); 100% de aprobaciones con actor identificado; HumanDecision inmutable; user journey validado con mecanismo de notificación de nuevos prospectos (no diferido a F6); modelo de reactivación decidido y reflejado en DDL o documentado como invariante; DoD-0 + G5.
**Observaciones ARB.** ALT-7 impacta el DDL: en B2B (ciclos 3–18 meses) el rechazo suele ser temporal; decidir HumanDecision como colección vs singleton aquí evita una migración correctiva en F5/F7. ALT-5 es diseño funcional más que código: sin user journeys, F1 puede producir una UI inutilizada. ALT-29: F1 es la fase más tardía razonable para documentar la activación del RBAC dormido.
**Recomendación.** GO WITH PREREQUISITES.

#### F1.5 / F5-lite — Sync manual a Clientify + dashboard mínimo (5 días · MEDIUM · GO WITH PREREQUISITES) — INSERCIÓN RECOMENDADA POR ARB
**Objetivo.** Entregar valor de negocio observable temprano: tras aprobar manualmente, botón "Sincronizar ahora" que crea contacto/deal en Clientify sin enrichment ni IA (loop completo LinkedIn→Nexus→Clientify en 3 fases), más un dashboard read-only mínimo (conteos por estado, últimos importados/aprobados/rechazados) leído del Outbox.
**Dependencies.** F1.
**Blockers.** ALT-10 (colisión crm_ingest_lead vs prospeccion_ingest: el dedup debe consultar crm_leads antes de crear), ALT-9 (rate limiter persistido — mínimo necesario para no romper el límite real de Clientify 300 req/min).
**Success criteria.** Un prospecto aprobado llega a Clientify sin duplicar contra crm_leads del pipeline webhook (reconcile verificado); idempotencia por CUIT (re-sincronizar no crea segundo contacto/deal); dashboard mínimo consistente con el Outbox; Dirección ve prospectos llegar a Clientify en la primera semana de uso real.
**Observaciones ARB.** Hallazgo duplicado por 2 revisores con idéntica recomendación: la dependencia F5→F4/F3 es convención de secuencia, no técnica dura (INV-PR-2 solo exige "approved"). Si Dirección decide que TODO prospecto sincronizado DEBE tener score/IA, esta fase no procede y debe documentarse como invariante explícita en INV-PR-1..6 (hoy no está) — es decisión de negocio, no técnica. ALT-10 es el riesgo real de esta variante: ya existe crm_ingest_lead escribiendo crm_leads; sin reconcile, hay contactos duplicados en prod. Reduce el time-to-value de 6 fases a 3 y baja el riesgo de abandono (RO-2).
**Recomendación.** GO WITH PREREQUISITES.

#### F2 — Enriquecimiento asíncrono (9 días · CRITICAL · GO WITH PREREQUISITES)
**Objetivo.** Primer toque a proveedor externo fuera del request: EnrichmentPort + ACL, caso de uso EnrichProspect, eventos ProspectEnriched/Failed (con transient), cron de drenado por GH Actions con CRON_SECRET fail-closed y deadline budget, persistencia jsonb. Ninguna llamada a proveedor en camino interactivo; reintento solo en failed transitorio; corrida partial reanuda sin duplicar.
**Dependencies.** F1 (y F0-PRE para event_consumers/dedup).
**Blockers.** ALT-25 (proveedor de enrichment NO definido — riesgo de bloqueo externo), ALT-9 (rate limiter persistido), ALT-19 (claim-then-release y pgBouncer transaction-mode), ALT-22 (blast radius de CRON_SECRET), ALT-18 (lag del Outbox no detectable), ALT-27 (DLQ sin runbook).
**Success criteria.** 0 llamadas a proveedor en camino interactivo; dispatcher con claim-then-release (SELECT FOR UPDATE SKIP LOCKED + COMMIT antes de la llamada externa, sin tx abierta durante I/O); corrida partial reanuda sin duplicar (idempotencia por event_consumers); health-check de lag operativo (<15 min) + runbook de DLQ con umbral; rate limiter persistido respeta el límite bajo concurrencia; p95 < deadline; costo por prospecto dentro de presupuesto; DoD-0 + DoD-10 + G5.
**Observaciones ARB.** El riesgo técnico más alto del roadmap está en F2, no en F0: F0 tiene riesgo de subestimación; F2 tiene riesgo de bloqueo externo. Sin proveedor contratado, los 9 días NO incluyen el tiempo de negociación/contrato de API. Mitigación: si el proveedor no está definido, implementar un stub del EnrichmentPort (AFIP/ARCA o CSV manual) para no bloquear F3/F4; registrar la elección como ADR. F2 introduce el primer cron, el primer dispatcher y el primer proveedor: concentra los blockers de seguridad, conexión y observabilidad. El precedente del Drive Sync (504 por tx larga / walk secuencial) valida ALT-19 como riesgo concreto, no teórico.
**Recomendación.** GO WITH PREREQUISITES.

#### F3 — Scoring (3 días · LOW · GO)
**Objetivo.** Calificar contra el ICP con una política pura (sin IA, sin red): ScoringPolicy (estilo `calculateCommercialScore`), caso de uso ScoreProspect, evento ScoreCalculated, VO Score 0..100. `scored` exige EnrichmentSnapshot (INV-PR-3); política determinista y testeada con vitest puro.
**Dependencies.** F2 (solo para el dato de enrichment; la política es pura).
**Blockers.** Ninguno.
**Success criteria.** Política determinista (mismo input ⇒ mismo score, reproducibilidad 100%); cobertura alta (vitest puro sin I/O); `scored` solo desde prospectos con EnrichmentSnapshot (INV-PR-3); DoD-0 + G5.
**Observaciones ARB.** ROAD-006: implementar y testear la ScoringPolicy DURANTE F2; así F3 se reduce a "enchufar" el cron que drena EnrichmentCompleted y persiste el score (~2 días efectivos). Es la fase de menor riesgo: dominio puro, precedente directo en `commercial-score.ts`, sin proveedor externo. Único riesgo (jsonb inválido) mitigado con VOs que validan el snapshot al construir.
**Recomendación.** GO.

#### F4 — IA comercial (7 días · HIGH · GO WITH PREREQUISITES)
**Objetivo.** Análisis IA (resumen, fit, riesgos) con datos redactados; la IA aporta señal, no decide: AIPort + ACL + cliente IA central (ADR-009), caso de uso RunAIAnalysis, eventos AIAnalysisCompleted/Failed, VOs AIAnalysis + ConfidenceScore. Redacción pre-LLM verificada; `ai_analyzed` solo desde `scored`; la IA no transiciona a approved (gate humano intacto); costo medido por MetricsPort.
**Dependencies.** F3.
**Blockers.** ALT-16 (throughput IA ~12–24/hora vs SLA "cientos/hora" — reconciliar como NFB antes de prometer SLA), ALT-21 (cold start de Netlify no presupuestado), ALT-33 (OCP: AIProviderRegistry), RR-1 privacidad LinkedIn (CRÍTICO) + ALT-23 (PII en prompts/errores).
**Success criteria.** 0 datos sensibles sin redactar en prompts (auditado, DoD-10); `ai_analyzed` solo desde `scored`; la IA NO transiciona a approved (gate humano intacto, verificado por test); throughput real declarado como NFB y reconciliado con EVT-12; dispatcher con `AbortSignal.timeout` a 24s descontando cold start; costo IA por prospecto dentro de presupuesto medido por MetricsPort; latencia p95 bajo deadline; DoD-0 + DoD-10 + G5.
**Observaciones ARB.** RR-1 (privacidad de datos de LinkedIn) es el único riesgo marcado CRÍTICO en una fase individual del roadmap: la redacción pre-LLM es criterio de aceptación y gate de DoD-10, no opcional. La matemática de throughput (1000 prospectos = 41–83h; 5000 = 8–17 días) no aparece en el blueprint — reconciliar vía ADR (modelos rápidos o pg_cron a 1 min) o aceptar el throughput real. ALT-17 (lotes masivos sin ETA) toca F2 pero su impacto se siente aquí (cuello de botella IA). MetricsPort (ALT-34) se introduce aquí; separar en CounterPort/ObserverPort con tipos al primer uso.
**Recomendación.** GO WITH PREREQUISITES.

#### F5 — Sync CRM outbound full (6 días · HIGH · GO WITH PREREQUISITES)
**Objetivo.** Cerrar el camino Nexus⇒Clientify tras aprobación, idempotente y logueado (ADR-005): CrmSyncPort + ACL (reusa clientify/client.ts vía ACL), casos de uso RequestCrmSync/CompleteCrmSync, eventos CrmSyncRequested/Completed/Failed, VO CrmRef, log append-only de sync. Sync solo desde approved (INV-PR-2); idempotente por Cuit/clientifyId (INV-PR-5); 0 escritura directa al CRM.
**Dependencies.** F4 (según roadmap original; si se adoptó F5-lite, F5-full extiende ese trabajo enchufando la cadena enrichment/score/IA).
**Blockers.** ALT-10 (colisión crm_ingest_lead vs prospeccion_ingest; reconcile.ts no definido para prospeccion), ALT-20 (latencia e2e 50–90 min y SLO ≤5 min no alcanzables sin pg_cron), ALT-22 (CRON_SECRET fail-closed estricto).
**Success criteria.** 0 duplicados en CRM (idempotencia por CUIT/clientifyId, INV-PR-5); 100% de syncs con entrada en el log append-only; sync solo desde approved; 0 bypass detectados; 0 escritura directa al CRM (DoD-7); reconcile contra crm_leads verificado; SLO e2e declarado y medido; DoD-0 + G5.
**Observaciones ARB.** Si se adoptó F5-lite, gran parte del CrmSyncPort, la idempotencia y el reconcile ya existen; F5-full se reduce a enchufar la cadena enrichment→score→IA antes del sync (~3–4 días). F5 es el entregable de mayor valor de negocio observable. CONS-H7/ALT-20: el SLO ≤5 min no es alcanzable con GH Actions; requiere pg_cron (sin ADR en F0-F4) — declarar SLO realista o decidir pg_cron con umbral. ALT-10 es el riesgo de producción más tangible: ya hay un camino a Clientify en prod; el reconcile debe estar definido antes del sync outbound.
**Recomendación.** GO WITH PREREQUISITES.

#### F6 — Dashboard + cierre de loop (4 días · MEDIUM · GO)
**Objetivo.** Visibilidad operativa del embudo y cierre de loop (Cliente del ERP, R-1.4.1): dashboard `/comercial/prospeccion` con métricas (conteos por estado, tasa de aprobación, costo IA/enrichment, latencias) leídas de MetricsPort/Outbox, y caso de uso CreateCustomer (alta de cliente vía OHS de clients). Métricas consistentes con el Outbox; CustomerCreated solo desde crm_sync_completed; sin alta de cliente paralela.
**Dependencies.** F5.
**Blockers.** RD-1/RE-1 (dedup contra clients en el cierre: CreateCustomer no debe duplicar clientes existentes).
**Success criteria.** Tablero refleja el estado real (drift 0 contra el Outbox); CustomerCreated solo desde crm_sync_completed; cierre de loop sin duplicar clientes; DoD-0 + G5.
**Observaciones ARB.** Si se adoptó el dashboard mínimo en F1.5, F6 se reduce al dashboard completo + CreateCustomer (~3 días). Las VIEWs prospeccion_pipeline_health/outbox_health deberían existir desde F0-PRE (ALT-26); si se hizo, F6 las consume en vez de escribir queries de cero. El cierre de loop es el único tramo nuevo de dominio en F6; el resto es lectura sobre infra ya construida.
**Recomendación.** GO.

#### F7 — Bidireccional + nuevas fuentes / ABM (11 días · HIGH · GO WITH PREREQUISITES)
**Objetivo.** Inbound desde CRM (Conformist, R-3.2.4) y nuevas fuentes de import (ABM, padrones, importadores) como nuevas ACLs: adapters de inbound (webhook normalizado al Published Language), nuevos adapters de import, y eventual sustitución del EventBusPort por broker si el volumen lo exige (sin tocar el dominio).
**Dependencies.** F6; reevaluación de ADR-001/008 (broker?).
**Blockers.** ROAD-009 (F7 sin criterio de entrada ni umbral de volumen para el broker), ALT-15 (Outbox sin particionado/archivado), CONS-H1 evolucionado (rate-limit pasa de Medio a Alto con el volumen de F7).
**Success criteria.** Inbound normaliza al Published Language antes de propagar; nuevas fuentes entran como adapters sin modificar el AR Prospect; reconciliación no sobrescribe decisiones humanas (INV-PR-4); decisión de broker contra umbral explícito; Outbox particionado/archivado si se cruza el umbral; DoD-0 + G5.
**Observaciones ARB.** F7 es la fase más variable: 11 días asume inbound + 1–2 adapters nuevos sin broker; con broker sube a ~15+ días. ROAD-009: falta el criterio que dispara el broker (ej. >5000 prospectos/mes con propagación >4h). El particionado/archivado del Outbox (EVT-7) debería decidirse con umbral en F0 y ejecutarse a más tardar antes de F7. RT-2 (rate-limit in-memory) y ALT-29 (RBAC dormido) son las dos deudas estructurales que, sin abordarse antes, se vuelven Alto riesgo justo en F7 — resolverlas en el backlog post-F5.
**Recomendación.** GO WITH PREREQUISITES.

---

## ESTIMACIÓN TOTAL DE ESFUERZO

- **Total persona-días:** **68 días** (incluye F0-PRE de 6 días y la inserción F5-lite de 5 días recomendadas por el ARB).
- **Estimación en semanas (1 dev senior, 5 días/semana):** **~14 semanas** (≈ 3,5 meses de calendario sin contar negociación de proveedor ni interrupciones operativas).
- **Fases en camino crítico:**
  1. **F0-PRE** (reconciliación DDL/roadmap + migraciones corregidas + eslint-boundaries + ADR import LinkedIn) →
  2. **F0** (migraciones 0088/0089/0091 corregidas + AR Prospect + RPC ingest mecánica + OutboxEventBus + UI bandeja read-only + RLS + read models) →
  3. **F1** (máquina de estados + gate humano + HumanDecision + user journeys) →
  4. **F2** (EnrichmentPort + ACL + cron drenado claim-then-release + rate limiter persistido + dispatcher observabilidad) — **BLOQUEANTE EXTERNO: definir proveedor de enrichment** →
  5. **F4** (AIPort + ACL + redacción pre-LLM + costo + throughput reconciliado) →
  6. **F5** (CrmSyncPort + idempotencia por CUIT + reconcile con crm_ingest_lead + log append-only).

- **Riesgo de timeline:**
  - **ALTO por dependencia externa (F2).** La estimación de 9 días de F2 NO incluye el tiempo de negociación/contrato del proveedor de enrichment, que no está definido. Si no se contrata a tiempo, F2 puede demorarse y bloquear F3→F4→F5. Mitigación obligatoria: stub del EnrichmentPort (AFIP/ARCA o CSV manual) para desacoplar el cronograma del contrato.
  - **MEDIO por subestimación de F0.** F0 (11 días) concentra la mayor complejidad; el split F0a/F0b reduce el riesgo de un gate largo y mejora la previsibilidad. Sin split, hay riesgo de desbordar la estimación.
  - **MEDIO por throughput de IA (F4).** El gap de 4–10x entre el throughput real (~12–24/hora) y el SLA prometido ("cientos/hora") puede requerir migrar a pg_cron o modelos rápidos, trabajo no presupuestado si se descubre tarde. Reconciliarlo como NFB antes de F4 lo neutraliza.
  - **BAJO en el camino feliz de plataforma.** La infraestructura (Outbox, cron, RLS) reusa patrones ya probados en producción, lo que reduce el riesgo técnico de implementación; el riesgo residual es de scope, DoD y gobernanza, no de plataforma.
  - **Recurso único.** Toda la estimación asume un solo desarrollador senior. Un segundo dev requiere el ONBOARDING.md (ALT-30) y reduce el calendario pero no el total de persona-días.

---

## LISTA PRIORIZADA DE MEJORAS (Top 15)

| Rank | ID | Severidad | Título | Esfuerzo | Impacto | Bloquea |
|:---:|---|:---:|---|:---:|:---:|---|
| 1 | CONS-C1 | CRITICAL | Migración 0089 no compila: índices con columnas inexistentes + duplicados; falta seq | S | HIGH | F0 (pre-migración) |
| 2 | CONS-C2 | CRITICAL | CC-6: clientify ids eliminados del DDL pero reintroducidos en ER y Row type | XS | HIGH | F0 (pre-código) |
| 3 | ROAD-001 | CRITICAL | Discrepancia de asignación de fases DDL vs roadmap | S | HIGH | F1 (decidir en F0) |
| 4 | ARCH-002 | CRITICAL | CS-RPC-1 puede invertir Clean Architecture (lógica de negocio en PL/pgSQL) | S | HIGH | F0 |
| 5 | ARCH-001 | CRITICAL | ProspectRepositoryPort.nextId() viola SRP y rompe el contrato del Repositorio | S | HIGH | F0 |
| 6 | ROAD-002 | HIGH | DoD-11 exige eslint-plugin-boundaries pero no está instalado | XS | HIGH | F0 |
| 7 | CONS-H1 | HIGH | prospeccion_ingest sin límite de lote (DoS + costo descontrolado) | XS | MEDIUM | F0 |
| 8 | INT-003 | HIGH | Mecanismo import LinkedIn ambiguo (CSV vs API vs scraper) | XS | HIGH | F0 |
| 9 | CONS-H2 | HIGH | Read models de la bandeja y SLO sin modelar | S | HIGH | F0 |
| 10 | GAP-002 | HIGH | User journeys de los actores comerciales no especificados | M | HIGH | F1 |
| 11 | CONS-H3 | HIGH | ROI diferido hasta F5: insertar F5-lite entre F1 y F2 | M | HIGH | F1 |
| 12 | GAP-001 | HIGH | Estado "rechazado" terminal sin reactivación (impacta el DDL) | M | HIGH | F1 |
| 13 | CONS-H4 | HIGH | Modelo de datos canónico (Views) indefinido y sin capa anclada | S | HIGH | F4/F5 |
| 14 | INT-002 | HIGH | Rate limiter "persistido" sin contrato de implementación | S | HIGH | F2/F5 |
| 15 | INT-004 | HIGH | Colisión crm_ingest_lead vs prospeccion_ingest: dos caminos a Clientify | M | HIGH | F5 |

---

## OBSERVACIONES FINALES DEL ARB

**Sobre la calidad del diseño.** Este Blueprint pertenece al cuartil superior de los diseños que el panel ha revisado para un sistema de un solo desarrollador. La disciplina arquitectónica es real, no decorativa: el patrón Transactional Outbox está implementado con fidelidad de producción (atomicidad de transacción única vía PL/pgSQL, FOR UPDATE SKIP LOCKED, despacho budget-aware), la RLS es tratada como frontera de seguridad efectiva, y las decisiones están ancladas en evidencia operativa concreta del propio sistema —el incidente del 504 por Inactivity Timeout del Drive Sync de junio 2026 es citado correctamente para justificar el pipeline estrictamente asíncrono—. El score global de 6.29/10 no castiga el diseño conceptual; castiga la brecha entre la intención (excelente) y la ejecución de detalle (incompleta en migraciones, contratos de puertos y especificación funcional de la UI).

**Sobre la naturaleza de los hallazgos.** Los cinco hallazgos críticos comparten una característica reveladora: ninguno es un error de concepto, todos son errores de consistencia. La migración no compila porque dos versiones del DDL divergieron; los campos prohibidos reaparecen porque el diagrama y el tipo no se actualizaron con la regla; las fases se contradicen porque DDL y roadmap evolucionaron por separado. Esto es síntoma de un documento de 4463 líneas en 17 archivos mantenido sin una única fuente de verdad —exactamente el anti-patrón AP-17 que el propio blueprint prohíbe—. La lección operativa es que la consolidación documental (ADRs unificados, tipos generados desde el schema real, un ONBOARDING.md) no es cosmética: es el mecanismo que previene que estos cinco críticos se reproduzcan en la siguiente iteración del diseño.

**Sobre el apalancamiento de F0-PRE.** El hallazgo más accionable del review es que las migraciones 0088/0089/0091 todavía no existen en producción. Esto convierte una corrección potencialmente costosa (revertir migraciones aplicadas, reconciliar datos) en una corrección barata (editar documentos antes de aplicarlos). El panel insiste: los 6 días de F0-PRE son la inversión de mayor retorno de todo el proyecto. Omitirlos no ahorra tiempo; transfiere el costo a un rollback atómico de toda la 0089 en el primer apply, más el debugging bajo presión que eso implica.

**Sobre la secuencia y el valor de negocio.** Dos cambios de secuencia, ambos detectados independientemente por múltiples revisores, mejoran sustancialmente el perfil de riesgo del proyecto sin aumentar el esfuerzo total: el split de F0 (gates más cortos, verificación temprana por Dirección vía SQL) y la inserción de F5-lite (loop de negocio completo en 3 fases en vez de 6). El segundo es especialmente importante desde la perspectiva de Dirección: reduce el time-to-value de ~3,5 meses a ~6 semanas para la primera sincronización real a Clientify, y mitiga el riesgo humano más probable del proyecto —que el equipo comercial abandone o presione para saltar el gate de aprobación porque no ve resultados—. La condición para F5-lite es una decisión de negocio que solo Dirección puede tomar: si se acepta que un prospecto pueda sincronizarse sin score ni análisis de IA. Si la respuesta es no, debe codificarse como invariante explícita (hoy no está en INV-PR-1..6).

**Próximos pasos recomendados.** (1) Convocar una sesión de ARB conjunta para ejecutar F0-PRE: reconciliar DDL/roadmap, corregir las migraciones, consolidar ADRs y emitir el ADR de import LinkedIn — todo antes de la primera línea de código. (2) Tomar dos decisiones de negocio bloqueantes que están fuera del alcance del equipo técnico: el proveedor de enrichment para F2 (con su presupuesto) y la política de F5-lite (sync sin IA, sí/no). (3) Adoptar el split F0a/F0b y la inserción F5-lite en el roadmap oficial. (4) Antes de aplicar la 0088, ejecutar el audit de migraciones drifteadas pre-0088 (MTD-09, prerequisito de DoD-4), dado el drift histórico ya documentado en este sistema entre el registro de migraciones y la realidad de producción. Con estos cuatro pasos resueltos, el proyecto puede avanzar con confianza alta y riesgo controlado.

---

*Architecture Review Board — Panel de 12 arquitectos senior independientes — 2026-06-25*
