# Constitución Arquitectónica — Plataforma Comercial de Nexus

## Bounded Context inicial: Prospección Inteligente

> **Versión:** `1.0.1` (v1.0 cerrada 2026-06-25 + correcciones del F0 Code Review Board: EVT-4 correlation/causation en la RPC, alineación de nombre de evento)
> **Estado:** **GO (Arquitectónico, ratificado por Dirección) + DDL validado contra motor Postgres real (Pre-G5: PASS, 4/4 fases · 20/20 checks · 0 errores). Fase documental CONCLUIDA. Blueprint v1.0 cerrado. F0 HABILITADO — pendiente la autorización de inicio formal de Dirección.**
> **Trayectoria:** ARB 7.44/10 → correcciones C-1..C-6 → F0-PRE Blueprint Reconciliation (5 críticos + 7 PARCIAL) → Blueprint Build System (BB-1..7) → Consistency Index **96.4/100 (GO)** → **DDL Validation Pre-G5 PASS** → **v1.0 cerrada**.
> **Autoridad:** Martín Battaglia (Presidencia · Logística TOPS / VEROTIN S.A.)
> **Fecha:** 2026-06-25
> **Gobierno:** subordinado al Documento Rector [TOPS-NEXUS-ERP.md](../../TOPS-NEXUS-ERP.md) y a los gates de gobernanza de Nexus (G1–G11).
> **Vigencia:** 10 años, con revisión anual obligatoria.

---

## Portada

| Campo | Valor |
|---|---|
| **Título** | Constitución Arquitectónica — Plataforma Comercial de Nexus |
| **Subtítulo** | Bounded Context inicial: Prospección Inteligente (`prospeccion`) |
| **Versión** | **1.0** (cerrada oficialmente 2026-06-25) |
| **Estado** | **GO (ratificado) + DDL validado Pre-G5 (PASS)** — Consistency Index 96.4/100, 18/18 relaciones CONSISTENTE, linter 26/26; DDL compila/ejecuta/rollback contra motor real. Fase documental CONCLUIDA · F0 HABILITADO · pendiente autorización de inicio de Dirección. |
| **ARB Date** | 2026-06-25 \| ARB 7.44 → F0-PRE → Consistency 96.4 (GO) → **DDL Validation PASS → v1.0 cerrada** |
| **Autoridad** | Martín Battaglia |
| **Fecha** | 2026-06-25 |
| **Alcance** | Plataforma Comercial de Nexus; primer contexto acotado: Prospección Inteligente |
| **Naturaleza** | Documento normativo (DEBE / NO DEBE / PROHIBIDO). Las reglas numeradas (R-x.y, INV-PR-n, AP-n, ADR-NNN, NFB-n) son vinculantes y citables. |

---

## ✅ Architecture Review Board — 2026-06-25

**Veredicto final:** **GO ratificado + DDL validado (Pre-G5)** — Architecture Consistency Index **96.4/100** (≥95), 7/7 condiciones, 18/18 relaciones CONSISTENTE, linter 26/26, y **DDL Validation Report PASS** (motor Postgres real). Trayectoria: ARB CONDITIONALLY APPROVED (7.44/10) → correcciones C-1..C-6 → F0-PRE Blueprint Reconciliation (5 críticos + 7 PARCIAL) → Blueprint Build System (BB-1..7) → Consistency Index 96.4 (GO) → **DDL Validation PASS → Blueprint v1.0 CERRADO, F0 HABILITADO**. Pendiente solo la autorización de inicio formal de F0 por Dirección.

**Score original del ARB (referencia histórica):** 7.44/10 → est. 8.6/10 post-correcciones C-1..C-6.

| Dimensión | Original | Post-correcciones |
|---|:---:|:---:|
| Strategic Design (DDD, Context Map) | 8.5 | 8.5 |
| Domain Model (AR, invariantes, VOs) | 7.5 | 7.5 |
| Technical Architecture (Hexagonal, Outbox) | 8.0 | 8.0 |
| Persistence (DDL, RLS, idempotencia) | 7.0 | **8.0** ↑ C-2, C-3 |
| Security & Privacy | 6.5 | **8.5** ↑ C-1 |
| Operational Quality | 7.5 | 7.5 |
| Integration Correctness | 7.0 | **8.0** ↑ C-3 |
| Governance & Maintainability | 7.0 | **8.5** ↑ C-4, C-6 |
| Product Viability | 6.5 | 6.5 |
| **TOTAL** | **7.44** | **est. 8.6** |

**Correcciones C-1..C-4, C-6 incorporadas (ARB inicial):**
- **C-1** Privacy by Design — §5 en security rules (fuentes, retención, borrado PII, Ley 25.326, RAT, INV-PR-8)
- **C-2** Índices DDL — índices operativos en migración 0089 (Outbox + prospects + crm_refs)
- **C-3** Provider Agnostic — `clientify_contact_id/deal_id` → `prospeccion_crm_refs` (F0); CC-6
- **C-4** CS-RPC-1 — cada mutación del AR = RPC SECURITY DEFINER en Postgres
- **C-6** CS-BOUNDARY-1 + DoD-11 — enforcement técnico eslint-plugin-boundaries

**F0-PRE — Blueprint Reconciliation + Build System (2026-06-25):** (1) los **5 hallazgos CRÍTICOS** del ARB expandido quedaron resueltos (CONS-C1 migración 0089 compila · CONS-C2 sin clientify IDs en ER/Row type · ROAD-001 fases DDL↔roadmap alineadas · ARCH-001 `nextId()` fuera del repo · ARCH-002 RPC mecánica sin lógica de negocio), registrados como **ADR-015..ADR-019**. (2) Se estableció el **Blueprint Build System** (cap. `07`, reglas BB-1..BB-7 + tooling `tools/`): los `_parts/` son la **única fuente de verdad** y el consolidado es un **artefacto generado** (AP-17); build + linter (26/26) + CI determinístico. (3) **Blueprint Consistency Report 2026-06-25:** 18/18 relaciones CONSISTENTE, **Architecture Consistency Index 96.4/100**, 7/7 condiciones GO → **dictamen GO**.

**Correcciones diferidas (pre-condición de fase, no de aprobación):**
C-5 ReactivateProspect (F1) · C-7 CRON_SECRET rotation (F2) · C-8 Outbox lag monitor (F2) · C-9 UL Español/Inglés table → **CERRADA** por CC-7 (correspondencia canónica de estados).

**Validación técnica Pre-G5 (2026-06-25):** ✅ **DDL Validation Report — PASS.** Las migraciones `0088`/`0089`/`0091` se compilaron y ejecutaron contra un **motor Postgres real efímero** (PGLite WASM, PG 17.5; sin prod, sin costo, sin deploy): 4/4 fases · 20/20 checks · 0 errores · 0 warnings · rollback espejo limpio · smoke-test del RPC end-to-end OK. **Cierra la deuda "compile real del DDL pre-G5".**

**Deuda diferida restante (no bloqueante, no contradicción):** columna de lane EVT-5 (F2/F4); anotación inline CC-2 en labels Mermaid; **apply real a prod = G3 (a mano por Martín).**

**Próximo gate:** **autorización de inicio formal de F0 por Dirección.** El Blueprint v1.0 está CERRADO y F0 HABILITADO; nada se construye hasta el "go" explícito de inicio.

---

## Nota de gobernanza (LEER ANTES QUE NADA)

Este documento es la **referencia arquitectónica oficial** de la Plataforma Comercial de Nexus y de su primer bounded context, Prospección Inteligente. Fija principios, contratos, esquema y reglas de evolución. **No es una autorización de ejecución.**

**Mientras este documento no esté aprobado personalmente por la Dirección (Martín Battaglia):**

- **NADA se implementa.** Al 2026-06-25 el directorio `src/lib/prospeccion` está **vacío**; toda ruta `prospeccion/*` es **objetivo de diseño**, no estado actual.
- **NADA se commitea ni se deploya** a `main` ni a producción (gate **G1**).
- **NINGUNA migración se aplica** (gate **G3**): las migraciones `0088` (enum de módulo), `0089` (núcleo F0) y `0091` (rollback) se entregan **numeradas, idempotentes y revisables**, pero **las aplica Martín a mano** en el SQL Editor de prod (`arsksytgdnzukbmfgkju`, gate **G4**). El asistente prepara y muestra; **no** ejecuta escrituras. `supabase db push` está **PROHIBIDO**.
- **NINGUNA fase del roadmap (F0→F7) arranca** sin superar su **Definition of Done** (Parte V, Cap. 5) y la **Regla de Decisión** del Rector (R-1.5), bajo aprobación previa (gate **G7**: plan → aprobación → build).

Ante conflicto entre esta Constitución y el núcleo de gobernanza de Nexus (`GOVERNANCE.md`, G1–G11), **gana el núcleo**. Esta Constitución ejerce la autoridad técnica (Architecture Governance) **dentro** del marco que la Dirección fija para todo Nexus.

> **No-fantasy.** Este documento describe arquitectura **prescrita**, no construida. Las citas `file:line` a otros módulos del repo (`clientify/`, `compliance/sync/`, `arca/`, `comercial/`, migraciones `crm_*`, workflows de GitHub Actions) son **precedentes idiomáticos reales y verificados** que esta Constitución eleva a norma. Lo que existe hoy son las **reglas** bajo las cuales el código **DEBE** nacer.

---

## Cómo leer este documento

Esta Constitución sirve, en orden de uso, a:

- **Arquitectos y CTO** — para fijar y defender los límites del sistema: Context Map, hexágono, modelo canónico, zonas de evolución. Empezar por las Partes I, VII y VI.
- **Desarrolladores** — para saber dónde vive cada cosa y qué contrato cumplir: dominio táctico (Parte II), arquitectura técnica y Managers (Parte III), persistencia/DDL/DTO/RPC/RLS (Persistencia), coding standards (Parte VI, Cap. 2).
- **Líderes técnicos / reviewers** — para gobernar el merge: principios AP-n, ADRs, Architecture Review con hard-stops y Non-Functional Budgets (Parte VI), Quality Attributes, Riesgos y DoD (Partes IV–V).
- **Futuros equipos (horizonte 10 años)** — para entender qué permanece estable y qué es intercambiable, y por qué se decidió cada cosa: Evolution Strategy (Parte VII §7), Evolución a 5 años (Parte VI, Cap. 7) y los ADRs.

**Convenciones normativas** (válidas en todo el documento):

- **DEBE / OBLIGATORIO** — requisito de cumplimiento estricto; una implementación que lo viole **no es conforme**.
- **NO DEBE / PROHIBIDO** — acción vedada sin excepción dentro del alcance de esta Constitución.
- **PUEDE / OPCIONAL** — facultad permitida, nunca obligatoria.
- **Identificadores citables** — `R-x.y` (reglas estratégicas/EA, Partes I y VII), `INV-PR-n` (invariantes del agregado, Parte II), `AP-n` (principios arquitectónicos, Parte VI), `ADR-NNN` (decisiones registradas, Parte IV), `NFB-n` (presupuestos no-funcionales, Parte VI). Una Parte cita reglas de otra por su identificador; nunca las redefine.

---

## Executive Summary

**Qué es.** La **Plataforma Comercial de Nexus** es la capa de **adquisición y calificación de demanda** del ERP vertical único de Logística TOPS. Su primer bounded context, **Prospección Inteligente** (`prospeccion`), cubre todo el ciclo *aguas arriba* del CRM: **importa** prospectos (LinkedIn / CSV / manual), los **enriquece** con datos de la web y de IA, los **scorea** contra el perfil de cliente ideal (ICP), genera **inteligencia comercial** asistida por IA, **deduplica**, y **sincroniza al CRM solo tras aprobación humana**, cerrando el loop al **crear el Cliente del ERP** en la tabla canónica `clients`.

**Principio rector — "NADA va directo al CRM".** Ningún prospecto alcanza el CRM externo (Clientify hoy) sin atravesar, en orden, las etapas de Prospección y sin **aprobación humana explícita**: **LinkedIn → Nexus → Clientify**. La prospección vive en una **zona de staging propia** (`prospeccion_*`); la salida al CRM tiene un **único punto gobernado y logueado** (append-only). El gate humano no es un detalle de UI: es un **límite de confianza** que ninguna automatización ni IA puede sintetizar.

**Cómo está construida.** Cuatro paradigmas combinados:

- **DDD** — clasificación de subdominios (Prospección es **CORE**); modelado táctico con un único Aggregate Root `Prospect`, Value Objects válidos por construcción, 9 Domain Events + `*.failed`, y una máquina de estados explícita con 6 invariantes duras (INV-PR-1…6).
- **Hexagonal / Clean** — dominio **puro y soberano** (cero infraestructura); todo lo externo entra por **Ports** detrás de **ACLs**; la Regla de Dependencia apunta siempre hacia adentro.
- **Event-Driven** — transporte por **Transactional Outbox sobre Postgres** + Dispatcher por cron, con idempotencia, retry/backoff por `transient`, orden por agregado, replay y Dead Letter (sin broker externo).
- **Provider-agnostic** — IA, Enrichment y CRM se acceden por **Managers** intercambiables por configuración; **ningún proveedor concreto es canónico**. El modelo canónico es de Nexus; los externos se adaptan a Nexus, nunca al revés.

**Visión a 10 años.** La Constitución se diseña para que el **dominio perdure** y los **detalles cambien en la periferia**: cambiar de proveedor de IA/enrichment, o reemplazar Clientify por un **CRM nativo de Nexus**, **DEBE** ser un cambio de adapter/port sin reescribir el dominio. Lo estable (dominio, invariante de no-bypass, hexágono, eventos como contrato, Postgres como verdad única) se protege como **Stable Core**; lo intercambiable (proveedores, prompts, heurísticas) vive en la **Experimental Zone** y se mueve por ADR.

**Por qué importa (Regla de Decisión).** Prospección Inteligente alimenta de **clientes calificados** al ERP único: el cliente entra por Nexus, queda disponible para Órdenes → Facturación → Tesorería sin re-tipeo, y aleja a la organización de Neuralsoft y de las herramientas dispersas.

---

## Índice navegable (Table of Contents)

> Orden de lectura recomendado: de la estrategia a la ejecución. Cada entrada enlaza al capítulo correspondiente bajo `docs/prospeccion/_parts/`.

### Parte I — Diseño Estratégico (DDD) · [`10-parte-I-estrategico.md`](./10-parte-I-estrategico.md)
1. Resumen ejecutivo y visión de Plataforma Comercial — principio "nada va directo al CRM", visión a 10 años, cierre de loop sobre `clients`, Regla de Decisión.
2. Strategic Domain Design — clasificación de subdominios CORE / SUPPORTING / GENERIC.
3. Context Map de Bounded Contexts — ACL, Customer/Supplier, Conformist, Open Host Service, Published Language.
4. C4 — Context Diagram (Nivel 1).

### Event Storming — El flujo completo del negocio · [`15-event-storming.md`](./15-event-storming.md)
- Leyenda y método · Big-picture (Command → Aggregate → Event → Policy) · Flujo end-to-end (9 eventos + caminos de error/duplicado/rechazo) · Máquina de estados comercial ÚNICA (Prospección ↔ CRM) · Managers provider-agnostic · Diagrama Commands→Events→Policies · Resumen normativo.

### Parte II — Modelo de Dominio (DDD táctico) + base Hexagonal · [`20-parte-II-dominio.md`](./20-parte-II-dominio.md)
1. Tactical DDD — Aggregate Root `Prospect`, Entities, Value Objects, invariantes INV-PR-1…6.
2. Eventos, Servicios, Casos de Uso, Repositorios, Factories, ACL.
3. Arquitectura Hexagonal / Clean — 5 capas y Regla de Dependencia.
4. Catálogo de Ports (driving / driven).

### Parte III — Arquitectura Técnica (construida alrededor del dominio) · [`30-parte-III-tecnica.md`](./30-parte-III-tecnica.md)
1. Modelo C4 — Container y Component.
2. Backbone Event-Driven — Outbox + Event Bus interno (idempotencia, retry, backoff, orden, replay, Dead Letter).
3. AI Provider Manager · 4. Enrichment Manager · 5. CRM Sync Engine genérico · 6. Capas y flujos (del borde al dato), guard `isMock()`.

### Persistencia (DDL · DTO · RPC · RLS · RBAC) · [`35-persistencia-ddl.md`](./35-persistencia-ddl.md)
0. Hechos de prod (verdad base) · 1. Modelo de datos completo (con subconjunto F0) · 2. DDL definitivo literal de F0 (migraciones `0088` / `0089` / `0091`, idempotentes, **no aplicadas**) · 3. DTOs (contrato de datos) · 4. RPC · RLS · RBAC (síntesis de contratos).

### Parte VII — Enterprise Architecture · [`40-parte-VII-enterprise.md`](./40-parte-VII-enterprise.md)
1. Business Capability Map (C1–C13, Core/Supporting/Shared) · 2. Information Architecture · 3. Canonical Data Model · 4. Integration Architecture · 5. Security Architecture (Zero Trust, RBAC, RLS, secrets, PII/LinkedIn) · 6. Operational Architecture · 7. Evolution Strategy (Stable Core / Extension Points / Experimental Zone).

### Parte VI — Architecture Governance · [`50-parte-VI-governance.md`](./50-parte-VI-governance.md)
1. Principios Arquitectónicos (AP-1…AP-17) · 2. Coding Standards · 3. ADR Governance · 4. Definition of Architecture Review (gate formal + checklist) · 5. Non-Functional Budgets (NFB-1…NFB-8) · 6. Technology Radar (Adopt/Trial/Assess/Hold) · 7. Evolución a 5 años.

### Partes IV y V — Calidad, ADRs, Riesgos, Roadmap y Ejecución · [`60-partes-IV-V-quality-roadmap.md`](./60-partes-IV-V-quality-roadmap.md)
- **Parte IV:** Cap. 1 Quality Attributes · Cap. 2 Architecture Decision Records (mapeo al **ADR Ledger** `55`, ADR-001…019 — fuente única) · Cap. 3 Matriz de Riesgos.
- **Parte V:** Cap. 4 Roadmap F0→F7 · Cap. 5 Definition of Done (checklist obligatorio bloqueante).

---

## Glosario de términos clave

### Domain-Driven Design (DDD)

- **Bounded Context** — frontera explícita dentro de la cual un modelo y su lenguaje son consistentes. Aquí, `prospeccion`. Lo que está dentro no se mezcla con el lenguaje de otros contextos (CRM, Comercial, Operaciones).
- **Aggregate Root (AR)** — la única entidad por la que se entra a mutar un grupo de objetos que comparten frontera de consistencia transaccional. Aquí, `Prospect`: toda mutación pasa por la raíz, que valida sus invariantes y emite sus eventos.
- **Entity** — objeto con identidad propia y mutable, **dentro** de la frontera del AR (p. ej. `EnrichmentSnapshot`, `AIAnalysis`, `HumanDecision`, `CrmRef`).
- **Value Object (VO)** — objeto **inmutable**, comparado por valor, **válido por construcción** (`create() → Result`); un VO en estado inválido no puede existir (p. ej. `Email`, `Cuit`, `Score` 0..100, `Money` en centavos, `ConfidenceScore` 0..1).
- **Domain Event** — hecho del negocio ya ocurrido (en pasado), inmutable, versionado (p. ej. `ProspectEnriched`, `ScoreCalculated`, `HumanApproved`, `CustomerCreated`). Se persiste append-only en el Outbox.
- **Domain Service / Policy** — lógica de dominio pura (sin I/O) que no pertenece a una entidad/VO (p. ej. `ScoringPolicy`, `DeduplicationPolicy`, `PromotionPolicy`).
- **Anti-Corruption Layer (ACL)** — capa de traducción en la frontera que protege el modelo de dominio del modelo de un sistema externo. El modelo del proveedor **nunca** penetra el dominio: se traduce a/desde el modelo canónico.
- **Open Host Service (OHS)** — servicio estable que un contexto upstream expone para que otros lo consuman sin acoplarse a sus internos. Aquí, el alta de Cliente del ERP en `clients`.
- **Published Language** — lenguaje común (eventos y DTOs versionados) por el que dos contextos se comunican sin leer las tablas internas del otro.

### Arquitectura Hexagonal (Ports & Adapters)

- **Port** — interfaz (contrato) definida hacia adentro del sistema; el dominio depende de la abstracción, no de la implementación (Dependency Inversion).
- **Adapter** — implementación concreta de un port hacia el mundo exterior (Supabase, HTTP de proveedor, EventBus).
- **Driving (primario)** — adapter por el que el mundo **invoca** al sistema (Server Action, Route Handler, cron).
- **Driven (secundario)** — adapter por el que el sistema **sale** al mundo (repositorio, EventBus, ACLs de IA/Enrichment/CRM).
- **Composition Root** — punto en el borde donde se cablea qué adapter concreto recibe cada port; nunca en el dominio.
- **Regla de Dependencia** — ley del hexágono: las dependencias apuntan **siempre hacia adentro**. Un import de Dominio→adapter, o de Casos de Uso→Next.js/Supabase, es una **violación constitucional**.

### Event-Driven

- **Outbox (Transactional Outbox)** — patrón por el que emitir un evento es **insertar una fila en la misma transacción** que muta el agregado, evitando eventos huérfanos. Aquí, `prospeccion_outbox` / `prospeccion_events`.
- **Event Bus** — transporte interno que entrega los eventos del Outbox a sus consumidores (handlers/Policies). Aquí es **interno sobre Postgres**, no Kafka/SQS.
- **Dispatcher** — Route Handler disparado por cron que lee eventos `pending`, los entrega a los handlers y los marca `processed`/`failed`, con presupuesto de tiempo (`partial`).
- **Replay** — reconstruir el estado del agregado reproduciendo sus eventos en orden; **DEBE** ser "dry"-capaz (recorrer sin tocar proveedores).
- **Idempotencia** — propiedad por la que reprocesar el mismo evento **no** produce efectos dobles (entrega *at-least-once* + consumidores idempotentes). Un `Prospect` mapea a lo sumo a un `CrmRef` (INV-PR-5).
- **DLQ (Dead Letter Queue)** — destino de los eventos que agotan reintentos o fallan permanentemente; inspeccionable y re-encolable, nunca descartado en silencio.
- **`transient`** — bandera de un error de proveedor: transitorio → reintento con backoff; permanente → detiene ese prospecto y emite `*.failed`.

### Otros

- **Manager** — fachada provider-agnostic (AI / Enrichment / CRM Sync) que aísla un grupo de proveedores externos tras un port; devuelve un **DTO normalizado**, nunca el JSON crudo del proveedor.
- **RLS (Row Level Security)** — control de acceso a nivel de fila en Postgres. En `prospeccion` es la **frontera real** de datos (el RBAC está "dormido"): tablas con PII **nunca** llevan `using(true)`; Outbox y jobs quedan cerrados a sesión de usuario (solo `service_role`).
- **RBAC (Role-Based Access Control)** — autorización por permisos finos (`has_permission(...)`, `is_admin()`, `current_role()`) sobre roles. Prospección define permisos propios `prospeccion.*` sin inventar un sistema paralelo.
- **SECURITY DEFINER / INVOKER** — una RPC `DEFINER` corre como su dueño (tráfico de máquina sin `auth.uid()`, p. ej. la ingesta); una `INVOKER` corre con la sesión del usuario (el único paso humano: aprobar/rechazar).
- **Gate humano** — punto obligatorio de decisión humana (aprobar/rechazar) antes de cualquier salida al CRM; límite de confianza, no operación de servicio.
