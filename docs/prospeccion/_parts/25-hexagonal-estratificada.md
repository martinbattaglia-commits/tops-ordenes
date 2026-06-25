# Arquitectura Hexagonal Estratificada (reglas de aplicación)

> **Refina la Decisión 3.** Hexagonal/Clean es el estándar de la Plataforma Comercial, pero se aplica **estratégicamente**: máxima separación donde aporta valor, máxima simplicidad donde no. Esta sección es **normativa** y define con precisión la frontera entre arquitectura estricta y capa liviana. Optimiza simultáneamente mantenibilidad, escalabilidad, claridad, rendimiento y velocidad de desarrollo, sin sobreingeniería.

## HEX-1 — Core Domain 100% Hexagonal (sin excepciones)
El Core Domain **DEBE** estar completamente aislado de: base de datos, frameworks, APIs, SDKs, IA, CRM, Enrichment y Event Bus. El dominio **conoce únicamente interfaces (ports)**, nunca implementaciones. **NO DEBE** existir un solo `import` de infraestructura dentro de `src/lib/prospeccion/domain/**`.

## HEX-2 — Casos de uso: siempre por Ports
Todos los Application Services **DEBEN** operar exclusivamente a través de ports. **NO DEBE** haber lógica de negocio distribuida en adapters: toda la **orquestación** vive en los casos de uso (`src/lib/prospeccion/application/**`). Un adapter que contiene una regla de negocio es un defecto de arquitectura.

## HEX-3 — Adapters: único punto de contacto con el exterior
Todo proveedor/recurso externo **DEBE** implementarse exclusivamente como adapter detrás de un port: Clientify, OpenAI, Gemini, Claude, Firecrawl, Apify, Google, SMTP, Storage, Scheduler, Event Bus. El dominio **NUNCA** accede directo. (Refuerza la ACL del Canonical Domain Model — ver DG-3.)

## HEX-4 — CRUD simples: capa liviana condicionada
Un CRUD puramente administrativo **PUEDE** usar la capa liviana (patrón `data.ts` existente como driven adapter, sin inventar ports) **solo si cumple SIMULTÁNEAMENTE las 5 condiciones**:
1. no contiene reglas de negocio,
2. no dispara eventos,
3. no interactúa con proveedores externos,
4. no modifica el dominio (es lectura o CRUD administrativo puro),
5. no participa en workflows.

**Si cualquiera deja de cumplirse, DEBE migrarse inmediatamente al modelo hexagonal completo.** (La bandeja read-only y los reads de F0 califican como capa liviana; el import **no** califica — dispara eventos y normaliza al dominio → hexagonal pleno.)

## HEX-5 — Queries complejas: CQRS
Las consultas de lectura complejas **DEBEN** usar **CQRS**, separando claramente:

```
Commands → Use Cases → Domain Events → Read Models (proyecciones)
```

**NO DEBE** mezclarse lógica de consulta con lógica de negocio. Los Read Models (vistas/tablas de proyección, p.ej. snapshots del dashboard) se alimentan de eventos y se consultan por la capa liviana; los Commands pasan siempre por casos de uso.

## HEX-6 — Dirección única de dependencias
La dependencia fluye en **un solo sentido**:

```
Infrastructure → Adapters → Application → Domain
```

**Nunca** en sentido inverso. El dominio no depende de nadie; la infraestructura (composition root) depende de todo y ensambla. Una dependencia inversa invalida la revisión de arquitectura (Parte VI).

## HEX-7 — Testabilidad del Core
Todo el Core Domain **DEBE** poder ejecutarse en pruebas unitarias **sin**: PostgreSQL, Supabase, Next.js, Clientify, OpenAI, Firecrawl, ni Internet. Si un test del dominio requiere cualquiera de esos, hay una fuga de infraestructura que **DEBE** corregirse. (Los ports se sustituyen por fakes/in-memory en los tests.)

## HEX-8 — Mínima complejidad compatible con la evolución
**NO** agregar capas solo por cumplir el patrón. Cada Port, Adapter o Servicio **DEBE** justificar su existencia (frontera real que protege, proveedor que abstrae, o regla que orquesta). Ante la duda, la opción más simple que no comprometa la evolución futura. (Anti-sobreingeniería; complementa HEX-4.)

## HEX-9 — Matriz "Hexagonal Boundaries" (documentación obligatoria)
Cada componente **DEBE** figurar en esta matriz:

| Componente | Layer | Responsibility | Depends On | Used By | Test Strategy | Justificación |
|---|---|---|---|---|---|---|
| `Prospect` (AR), VOs, Domain Events/Services | **Domain** | Invariantes y reglas puras | Nada (solo tipos propios) | Application | Unit puro (sin I/O) | Aislamiento total (HEX-1) |
| ImportProspects / EnrichProspect / ScoreProspect / RunAIAnalysis / ApproveProspect / RequestCrmSync / CreateCustomer | **Application** | Orquestación de casos de uso | Domain + Ports | Driving adapters | Unit con ports fake | Lógica de negocio centralizada (HEX-2) |
| ProspectRepositoryPort, EventBusPort, EnrichmentPort, AIPort, CrmSyncPort, ClockPort, IdGeneratorPort, MetricsPort, UnitOfWorkPort | **Ports** | Contratos de entrada/salida | Tipos del Domain | Application + Adapters | Contract tests | Inversión de dependencias (HEX-6) |
| SupabaseProspectRepository, PostgresOutboxEventBus, FirecrawlEnricher/ApifyEnricher, OpenAIProvider/ClaudeProvider, ClientifyCrmSync, StorageAdapter, SmtpAdapter | **Adapters (driven)** | Implementan ports contra infra/SDK | Ports + SDK/infra | Composition root | Integration | Reemplazo de proveedor sin tocar dominio (HEX-3) |
| Server Actions, Route Handlers, Cron Dispatchers | **Adapters (driving)** | Traducen HTTP/cron a casos de uso | Application | Runtime Next.js | Integration/e2e | Entrada al hexágono |
| `data.ts` reads (bandeja/dashboard), Read Models | **Capa liviana / Read side** | Lectura sin reglas (CQRS query) | Supabase (driven, directo) | Pages/Server Components | Integration liviana | CRUD/reads sin frontera (HEX-4/HEX-5) |
| DI / Composition Root, env, Supabase client | **Infrastructure** | Ensamblado y wiring | Todo | Runtime | Smoke | Punto único de cableado (HEX-6) |

## HEX-10 — Evolución uniforme del ERP
Todo módulo nuevo de la Plataforma Comercial (Campañas, ABM, Customer Intelligence, nuevos canales) **DEBE** seguir exactamente estas reglas. La arquitectura escala de forma **uniforme**: no se generan estilos distintos dentro del ERP. Este capítulo es la plantilla reutilizable para cualquier bounded context comercial futuro.

---

**Objetivo** — Definir con precisión dónde aplica arquitectura estricta (hexagonal pleno) y dónde capa liviana, para maximizar valor sin sobreingeniería.
**Alcance** — Todo el bounded context `prospeccion` y, por HEX-10, todo módulo comercial futuro.
**Decisiones tomadas** — Hexagonal Estratificada (HEX-1..HEX-10): Core 100% hexagonal; casos de uso por ports; proveedores solo por adapters; capa liviana condicionada (5 condiciones); CQRS para reads complejos; dirección única de dependencias; Core testeable sin infra; mínima complejidad justificada; matriz Hexagonal Boundaries; evolución uniforme.
**Decisiones descartadas** — (a) hexagonal en todo sin excepción (ceremonia en lo trivial); (b) híbrido sin reglas (degenera en acoplamiento ad-hoc).
**Justificación** — El valor de hexagonal está en las fronteras de proveedor/evento (corazón de la plataforma); ahí se aplica pleno. En reads/CRUD sin frontera, la capa liviana entrega más rápido sin deuda, con criterio explícito de migración cuando deja de ser trivial.
**Riesgos** — Que la "capa liviana" se abuse y meta reglas → mitigación: las 5 condiciones de HEX-4 + el gate de Architecture Review. Que la matriz quede desactualizada → mitigación: es entregable obligatorio de cada feature (Definition of Done).
**Impacto sobre la arquitectura** — Convierte el "pragmatismo calibrado" en reglas auditables; fija la plantilla de todo módulo comercial futuro (HEX-10); condiciona la estructura de carpetas y la estrategia de testing.
