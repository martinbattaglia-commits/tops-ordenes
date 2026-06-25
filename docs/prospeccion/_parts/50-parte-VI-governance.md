# Constitución Arquitectónica de la Plataforma Comercial de Nexus

## PARTE VI — ARCHITECTURE GOVERNANCE

> **Bounded context:** `prospeccion`. **Estado:** normativo · **Vigencia:** alineada a la Parte I (10 años, revisión anual obligatoria) · **Gobierno:** subordinada al Documento Rector [TOPS-NEXUS-ERP.md](../../TOPS-NEXUS-ERP.md) y al núcleo de gobernanza de Nexus ([.claude/skills/_shared/GOVERNANCE.md](../../../.claude/skills/_shared/GOVERNANCE.md)).
> **Tono:** normativo. Lo que sigue son **reglas y gates**, no recomendaciones. Donde se diga DEBE / NO DEBE / PROHIBIDO, es vinculante para todo el contexto `prospeccion`.
> **No-fantasy:** este documento describe gobernanza **prescrita**. Al 2026-06-25 el directorio `src/lib/prospeccion` está **vacío**; toda referencia a archivos `prospeccion/*` es **objetivo de diseño**, no estado actual. Las citas `file:line` a otros módulos (`clientify/`, `arca/`, `comercial/`) y a archivos de configuración (`netlify.toml`, `vitest.config.ts`, `package.json`) son **precedentes y hechos reales** del repo, verificados, que esta Parte VI eleva a norma de gobernanza. Los presupuestos numéricos que dependen de un valor vivo (Node, heap, índices) **DEBEN** citar el archivo vivo y no copiar el valor (regla de vigencia, `GOVERNANCE.md:78-80`).

---

### Preámbulo: por qué `prospeccion` necesita gobernanza explícita

Nexus ya tiene un núcleo de gobernanza no-negociable (`GOVERNANCE.md`, gates **G1**–**G11**). Esa capa es **organizacional y operativa**: cuándo se puede deployar (G1), cómo se aplican migraciones (G3), qué es prod (G4), evidencia antes de cerrar (G5), plan antes de código (G7). La Parte VI **no la reemplaza**: la **hereda** y le agrega una capa **arquitectónica** propia del contexto `prospeccion`, porque este contexto —a diferencia de los módulos CRUD-céntricos del repo— es un **pipeline event-driven, hexagonal, provider-agnostic** con una invariante dura de gobierno ("nada va directo al CRM", R-1.2.1) que solo es defendible si la arquitectura se gobierna con la misma severidad que el negocio.

En consecuencia, en `prospeccion` **toda regla de esta Parte VI es subordinada a G1–G11 y aditiva a ellas**: ante conflicto, gana el núcleo `GOVERNANCE.md`. Esta Parte VI ejerce la autoridad técnica (Architecture Governance) **dentro** del marco que la Dirección (Martín Battaglia) fija para todo Nexus.

---

## Capítulo 1 — Principios Arquitectónicos

Los siguientes principios son **OBLIGATORIOS** para todo código, diseño, ADR y PR del contexto `prospeccion`. Un diseño que viole un principio **no es conforme** y **NO DEBE** mergearse (ver Capítulo 4). Cada principio se identifica como **AP-n** (Architecture Principle) y es citable por otras Partes y por los ADR.

### AP-1 — Domain First (el dominio es soberano)
- **Descripción.** El modelo de dominio (`prospeccion/domain/`) es el centro y la fuente de verdad de las reglas; la infraestructura es un detalle periférico. El AR `Prospect`, sus invariantes (INV-PR-1…6, Parte II §1.1) y su máquina de estados gobiernan; nada las puede saltar.
- **Motivación.** La invariante de gobernanza (no-bypass del CRM) solo es defendible si vive dentro de una raíz transaccional pura (Parte II §1.1).
- **Consecuencias.** El dominio NO importa Supabase, `fetch`, ni SDKs (AP-5/AP-15). Los casos de uso delegan toda transición al AR (Regla UC-1, Parte II §2.3).
- **Ejemplo de aplicación.** `approve()` solo es legal desde `ai_analyzed`; si el estado es inválido, el AR lanza `DomainError` y el caso de uso **no persiste nada**.

### AP-2 — Events First (los eventos son ciudadanos de primera clase)
- **Descripción.** Toda transición relevante del agregado emite un Domain Event inmutable (los 9 + `*.failed`, Parte II §2.1). La coordinación entre agregados y módulos es **por eventos**, nunca por llamadas síncronas cruzadas.
- **Motivación.** Desacopla productores de consumidores y permite trazabilidad/auditoría (G10) y evolución (AP-9).
- **Consecuencias.** Existe un Outbox (`prospeccion_outbox`); la entrega es *at-least-once* y los consumidores DEBEN ser idempotentes (AP-8).
- **Ejemplo.** `CrmSyncCompleted` propaga el `CrmRef` sin que el productor conozca a `CreateCustomer`.

### AP-3 — API First / Explicit Contracts (contratos antes que implementación)
- **Descripción.** Toda capacidad expuesta o consumida se define primero como **contrato** (port TypeScript, esquema de evento versionado, DTO Zod) y recién después se implementa. Ver también AP-12.
- **Motivación.** Permite testear y sustituir implementaciones sin tocar el dominio; hace explícita la frontera del contexto.
- **Consecuencias.** Los 9 driven ports + driving ports (Parte II §4) son la "cintura" del hexágono; un port nace solo cuando un caso de uso lo necesita (anti-especulación).
- **Ejemplo.** `EnrichmentPort.enrich(...)` se define antes de elegir proveedor de enriquecimiento.

### AP-4 — Security by Default (seguridad cerrada por defecto)
- **Descripción.** Todo endpoint, cron o action nace **cerrado**: autenticación obligatoria, autorización por RLS/RBAC, validación de entrada en el borde. Lo público es la excepción justificada, no el default.
- **Motivación.** `prospeccion` toca datos comerciales sensibles y tres proveedores externos; un default abierto es una brecha.
- **Consecuencias.** RLS es la frontera real; los crons se autentican con `CRON_SECRET` **fail-closed** (precedente Nexus, skill `security-tops-nexus`); secretos solo en backend (G9, `GOVERNANCE.md:57-62`); datos sensibles **redactados** antes de salir a IA (Parte II §2.6, espejo `iaMatch.ts:57`).
- **Ejemplo.** El webhook/route de ingest verifica token *timing-safe* y rechaza por defecto.

### AP-5 — Provider Agnostic (proveedores intercambiables)
- **Descripción.** Ningún proveedor concreto (LinkedIn, enriquecimiento, IA, Clientify) se consagra como verdad permanente. Cada uno entra por su **port** detrás de una **ACL** (Parte II §2.6).
- **Motivación.** Vigencia a 10 años (R-1.3.1) y reemplazo del CRM externo por un CRM nativo sin reescribir el dominio (R-1.3.2).
- **Consecuencias.** PROHIBIDO importar un SDK/cliente de proveedor desde Dominio o Casos de Uso (Regla ACL-1, Parte II §2.6).
- **Ejemplo.** La ACL de CRM reusa `src/lib/clientify/client.ts` **a través** de `CrmSyncPort`, nunca directo.

### AP-6 — Cloud Native (diseñado para serverless efímero)
- **Descripción.** Todo se diseña para ejecutarse en funciones **stateless, efímeras y con timeout duro** (Netlify Functions sobre Next.js, `netlify.toml`). No se asume proceso longevo, memoria compartida entre invocaciones ni afinidad de contenedor.
- **Motivación.** El runtime real corta a ~26–30 s, no a los 60 nominales de `maxDuration` (ver NFB-1, Capítulo 5). Asumir lo contrario produce 504 (precedente real: el "Inactivity Timeout" del Drive Sync por walk secuencial).
- **Consecuencias.** El trabajo largo se **fracciona** (lotes, deadline interno, paralelismo acotado); el estado vive en Postgres, no en memoria de proceso.
- **Ejemplo.** El pipeline avanza un prospecto por invocación dirigida por eventos, no procesa N en un solo request bloqueante.

### AP-7 — Observability by Default (observabilidad incorporada)
- **Descripción.** Cada caso de uso que toca proveedor o cambia estado emite métricas y logs estructurados vía `MetricsPort` (Parte II §4.8): latencia de proveedor, uso/costo de IA, tasa de `*.failed`, `transient` vs permanente.
- **Motivación.** La gobernanza necesita evidencia (G5/G6, `GOVERNANCE.md:35-43`): no se cierra una tarea sin estado real ni se diagnostica con teoría.
- **Consecuencias.** Existe un `MetricsPort` inyectable; los presupuestos del Capítulo 5 son **medibles** y por tanto exigibles.
- **Ejemplo.** `observe("ai.latency_ms", …)` y `increment("crm_sync.failed", { transient })`.

### AP-8 — Idempotency Everywhere (idempotencia en todos lados)
- **Descripción.** Toda operación reintentable (consumo de evento, sync a CRM, enrichment) DEBE ser idempotente: repetirla no duplica efectos.
- **Motivación.** Entrega *at-least-once* (AP-2) y reintentos serverless hacen inevitables las repeticiones.
- **Consecuencias.** INV-PR-5 (un `Prospect` → a lo sumo un `CrmRef`); idempotencia por `Cuit`/`clientifyId` (precedente `crm_ingest_lead` idempotente, `clientify/reconcile.ts:5`).
- **Ejemplo.** Reintentar `CompleteCrmSync` no crea un segundo contacto en Clientify.

### AP-9 — Backward Compatibility (compatibilidad hacia atrás)
- **Descripción.** Los contratos públicos (esquemas de evento, ports expuestos, DTOs de borde, tablas `prospeccion_*`) evolucionan **sin romper** consumidores existentes. Cambios incompatibles exigen versión nueva + período de convivencia.
- **Motivación.** Alinea con G2 (cambios solo aditivos sobre lo validado, `GOVERNANCE.md:14-18`) y con el versionado de eventos (E-4, Parte II §2.1).
- **Consecuencias.** Los eventos llevan `version: 1`; un cambio de payload incompatible nace como `version: 2`, no muta el `1`.
- **Ejemplo.** Agregar un campo opcional a `ScoreCalculated` es aditivo; renombrar `Score` rompe → requiere versión.

### AP-10 — Fail Gracefully (degradación elegante)
- **Descripción.** Una dependencia ausente o caída **NO DEBE** romper el shell ni perder datos. Se degrada (mock/parcial/diferido) y se emite el `*.failed` correspondiente.
- **Motivación.** Núcleo G11 de Nexus (`GOVERNANCE.md:70-74`): fallback seguro, RBAC cae a `PERMISSIVE` ante timeout, `isMock()` ante falta de Supabase.
- **Consecuencias.** Cada paso con proveedor tiene su contraparte `*.failed` con `reason`/`transient`/`attempt` (Parte II §2.1); un fallo no-transitorio detiene ese prospecto, no el sistema.
- **Ejemplo.** Si el proveedor de enrichment da 5xx, se emite `ProspectEnrichmentFailed{transient:true}` y se reintenta con backoff; no se cae el request.

### AP-11 — Performance Budget (presupuestos de performance vinculantes)
- **Descripción.** Toda ruta caliente respeta los Non-Functional Budgets del Capítulo 5. Un diseño que no quepa en su presupuesto **no es conforme**.
- **Motivación.** El límite serverless real (~26–30 s) y el costo de IA convierten la performance en una **restricción de corrección**, no en una optimización opcional.
- **Consecuencias.** El Architecture Review (Capítulo 4) valida explícitamente el impacto sobre los budgets.
- **Ejemplo.** Un caso de uso que necesite 40 s de proveedor en línea está **prohibido**; se rediseña a asíncrono por eventos.

### AP-12 — Explicit Contracts / Typed Errors (errores tipados, no excepciones desnudas)
- **Descripción.** Los bordes devuelven `Result<T, DomainError>`; los errores de proveedor distinguen `transient` de permanente. Las firmas son explícitas y los estados imposibles son irrepresentables (VOs con `create() → Result`, Parte II §1.3).
- **Motivación.** Precedente directo del repo: `ClientifyError` (`clientify/client.ts:19`), `SoapFaultError`/`SoapNetworkError` con `transient` (`arca/soap.ts:11-27`).
- **Consecuencias.** El orquestador decide reintento/stop **leyendo el tipo**, no parseando mensajes.
- **Ejemplo.** `enrich(...)` retorna `Result<EnrichmentSnapshot, {reason; transient}>`.

### AP-13 — Immutable Events / Append-Only (eventos y ledgers inmutables)
- **Descripción.** Los Domain Events son inmutables (`readonly` en todo el árbol); el Outbox y los logs de sync son **append-only**. Un cambio de opinión es un evento nuevo, no una mutación.
- **Motivación.** Auditoría e inmutabilidad son no-negociables de Nexus (G10, `GOVERNANCE.md:64-68`); INV-PR-4 (decisión humana inmutable).
- **Consecuencias.** PROHIBIDO mutar un evento emitido (Regla E-1); el log de sync no se reescribe (R-1.2.3, Parte I).
- **Ejemplo.** Re-aprobar tras un rechazo emite un evento nuevo; no edita el `ProspectRejected`.

### AP-14 — Configuration over Code (configuración, no hardcode)
- **Descripción.** Valores que varían por entorno o por gobierno (claves, URLs base, umbrales de costo IA, topes de retries, ICP/scoring tunables) viven en configuración/env validada, no incrustados en código.
- **Motivación.** Permite cambiar proveedor/umbral sin redeploy de lógica; respeta G9 (secretos fuera del repo) y la regla de vigencia (citar valor vivo, `GOVERNANCE.md:78-80`).
- **Consecuencias.** El acceso a env pasa por una capa validada (precedente `env-check` en `predev`, `package.json` scripts); los umbrales del Capítulo 5 son parámetros, no constantes mágicas.
- **Ejemplo.** El tope de costo IA por lote es configuración auditable, no un `if (cost > 5)` perdido.

### AP-15 — Infrastructure Independence (independencia de la infraestructura)
- **Descripción.** El dominio y los casos de uso **no conocen** Next.js, Supabase ni proveedor alguno. Toda dependencia externa entra por un port (Dependency Inversion, Parte II §3-4).
- **Motivación.** Hace testeable el dominio sin red ni base, y sustituible toda la capa driven.
- **Consecuencias.** Un import de Dominio→adapter, o de Casos de Uso→`next/*`/`@supabase/*`, es una **violación constitucional** (Regla de Dependencia, Parte II §3.1).
- **Ejemplo.** `ClockPort`/`IdGeneratorPort` en lugar de `Date.now()`/`crypto.randomUUID()` directos (no-determinismo en tests).

### AP-16 — Human-in-the-Loop (la IA asiste, no decide)
- **Descripción.** Ninguna acción irreversible o de salida al CRM se ejecuta sin **decisión humana explícita**. La IA aporta score/resumen; **no aprueba**.
- **Motivación.** Encarnación táctica de "nada va directo al CRM" (R-1.2.1) y de "la IA nunca decide sola" (Parte II Regla DS-1, espejo `iaMatch.ts:63-64`).
- **Consecuencias.** INV-PR-2 (no se alcanza `crm_sync_requested` sin `HumanDecision = approved`).
- **Ejemplo.** El pipeline frena en `ai_analyzed` hasta `ApproveProspect(actorId)`.

### AP-17 — One Source of Truth (una sola fuente de verdad)
- **Descripción.** Sin apps paralelas, sin tablas duplicadas, sin lógica redundante: el alta de cliente y el estado del prospecto tienen un único lugar.
- **Motivación.** No-negociable maestro de Nexus (`ERP-ARQUITECTURA-MAESTRA.md:16-17`, citado en Parte I §1.2); cierre de loop sobre la `clients` canónica (R-1.4.1).
- **Consecuencias.** PROHIBIDO crear formas de alta de cliente paralelas (R-1.4.2); `prospeccion_*` es staging, no un segundo CRM.
- **Ejemplo.** `CreateCustomer` escribe en `clients`, no en una tabla espejo nueva.

| Plantilla normativa (Capítulo 1) | |
|---|---|
| **Objetivo** | Fijar los 17 principios arquitectónicos obligatorios que gobiernan todo diseño y código de `prospeccion`. |
| **Alcance** | Todo el contexto `prospeccion`: dominio, casos de uso, ports, adapters, bordes Next.js, ADR y PR. |
| **Decisiones tomadas** | 17 principios AP-1…AP-17, cada uno con descripción/motivación/consecuencias/ejemplo y anclados a invariantes de Parte II y a gates G1–G11. |
| **Decisiones descartadas** | (a) Principios "blandos" sin consecuencia exigible — descartado: un principio sin gate es decorativo. (b) Permitir SDK de proveedor en dominio "por pragmatismo" — PROHIBIDO (AP-5/AP-15). (c) Decisión de salida al CRM automatizable por IA — descartado (AP-16). |
| **Justificación** | Sin principios exigibles, la Regla de Dependencia y la invariante de no-bypass se erosionan PR a PR. |
| **Riesgos** | Rigidez/verbosidad. Se mitiga: un principio se invoca en el review solo cuando aplica al cambio. |
| **Impacto sobre la arquitectura** | Son la carta magna técnica; el resto de la Parte VI (standards, ADR, review, budgets) operacionaliza estos principios. |

---

## Capítulo 2 — Coding Standards (obligatorios)

Estándares **OBLIGATORIOS**. La conformidad se verifica en el Architecture Review (Capítulo 4) y en `npm run typecheck` / `npm run lint` / `npm run test` (`package.json` scripts).

### 2.1 Estructura de carpetas
`src/lib/prospeccion/` se organiza por **capa hexagonal** (Parte II §3):
```
prospeccion/
  domain/        # AR, entities, vo/, events/, services/, errors/  (capa 0, puro)
  application/   # casos de uso (capa 1)
  ports/         # interfaces driving y driven (capa 2)
  adapters/      # supabase/, enrichment/, ai/, crm/, eventbus/   (capa 3)
```
- La UI vive bajo `src/app/(app)/comercial/prospeccion/`; el borde (actions/routes) **compone** casos de uso, no contiene reglas (Parte II §3.2).
- **PROHIBIDO** un `data.ts` plano que mezcle acceso, fallback y mapeo en este contexto (excepción deliberada al patrón general, Parte II Preámbulo). El `data.ts` idiomático del repo (p.ej. `comercial/leads-data.ts:44`) es legítimo en módulos CRUD, no acá.

---

**CS-BOUNDARY-1 (ARB 2026-06-25 — Enforcement Técnico):** La Regla de Dependencia (el dominio nunca importa infraestructura) se verifica automáticamente mediante `eslint-plugin-boundaries`. Configuración OBLIGATORIA antes del primer PR de `prospeccion`:

```json
{
  "settings": {
    "boundaries/elements": [
      { "type": "domain",      "pattern": "src/lib/prospeccion/domain/**"         },
      { "type": "application", "pattern": "src/lib/prospeccion/application/**"    },
      { "type": "port",        "pattern": "src/lib/prospeccion/ports/**"          },
      { "type": "adapter",     "pattern": "src/lib/prospeccion/adapters/**"       },
      { "type": "infra",       "pattern": "src/lib/prospeccion/infrastructure/**" }
    ],
    "boundaries/rules": [
      { "from": "domain",      "disallow": ["adapter", "infra", "@supabase/*", "next/*"] },
      { "from": "application", "disallow": ["adapter", "infra", "@supabase/*", "next/*"] },
      { "from": "port",        "disallow": ["adapter", "infra"] }
    ]
  }
}
```

Un import violatorio genera **ERROR de lint** (no warning). Corre en `npm run lint` y bloquea el CI. Ver DoD-11.

---

### 2.2 Nomenclatura
- Carpetas y archivos: `kebab-case` (precedente repo: `leads-data.ts`, `commercial-score.ts`).
- Tipos/clases/VOs: `PascalCase` (`Prospect`, `EnrichmentSnapshot`, `CrmSyncPort`).
- Eventos: `PascalCase` para el tipo, `dotted.lowercase` para el `name` (`"prospeccion.prospect.scored"`).
- Funciones/variables: `camelCase`. Constantes de configuración: `SCREAMING_SNAKE_CASE`.
- Sufijos de rol: `*Port` (interfaces), `*UseCase` (driving), `*Policy` (domain service), `*Repository`/`*Adapter` (adapters), `*Error` (errores tipados).

### 2.3 DTOs
- Todo dato que cruza el borde (entrada de action/route, salida a UI) se valida con **Zod** (`zod` ya es dependencia, `package.json`) y se mapea a VOs del dominio en el borde, nunca dentro del dominio.
- Un DTO **no** es una entidad: es transporte. PROHIBIDO pasar un DTO crudo al AR; se construyen VOs con `create() → Result` (AP-12).
- Los DTOs son `readonly`.

### 2.4 Eventos
- Estructura común obligatoria: `eventId`, `name`, `aggregateId`, `occurredAt`, `version`, `payload` (Parte II §2.1).
- `readonly` en todo el árbol (E-1/AP-13). `occurredAt` vía `ClockPort`; `eventId` vía `IdGeneratorPort` (AP-15).
- Cada paso con proveedor define su `*.failed` con `reason`/`transient`/`attempt` (AP-10).
- Versionado obligatorio (`version`) para evolución sin romper consumidores (AP-9).

### 2.5 RPC (Supabase)
- Toda escritura crítica de estado pasa por **RPC `SECURITY DEFINER`**; el front nunca escribe directo (G10, `GOVERNANCE.md:64-68`).
- El Outbox y el agregado se persisten en **una** transacción (Patrón Outbox, INV frontera Parte II §1.1) vía `UnitOfWorkPort`.
- Los nombres de RPC del contexto llevan prefijo `prospeccion_` (espejo de la familia `crm_ingest_lead`, Parte I R-1.2.2).

---

**CS-RPC-1 (ARB 2026-06-25, reforzada por ARCH-002):** Cada caso de uso que muta el Aggregate Root `Prospect` DEBE implementarse como una función PL/pgSQL `SECURITY DEFINER` con `set search_path = public` en Postgres. El adaptador `SupabaseUnitOfWork` invoca estas funciones exclusivamente vía `.rpc(nombre, payload)`. La atomicidad AR+Outbox se garantiza dentro de la misma transacción PL/pgSQL. Dos llamadas separadas desde TypeScript (INSERT AR + INSERT Outbox) son **PROHIBIDAS** — rompen la garantía transaccional. Cada nuevo caso de uso de mutación REQUIERE su RPC dedicada antes del merge.

> **CS-RPC-2 (ARCH-002 — la RPC es persistencia mecánica, NO dominio):** estas funciones son **"persistence RPCs"**: reciben un **snapshot ya validado** por el AR en TypeScript y SOLO ejecutan escritura mecánica (INSERT/UPDATE del estado del agregado + INSERT de sus eventos en el Outbox, en una transacción). Está **PROHIBIDO** colocar reglas de negocio dentro del PL/pgSQL: nada de validación de transiciones de la máquina de estados, de invariantes INV-PR-1…6, de dedup-policy ni de scoring. Toda decisión de dominio vive en el AR (`prospeccion/domain/`) y se evalúa **antes** de `UnitOfWork.run(...)`. Razón: una regla de negocio embebida en PL/pgSQL traslada la lógica de dominio a la capa de Infraestructura (Postgres) e **invierte la Regla de Dependencia (AP-1/AP-15) de forma permanente y silenciosa** — ningún lint de import-boundaries (CS-BOUNDARY-1) puede detectarlo porque ocurre fuera de TypeScript. **Excepción acotada:** la RPC `prospeccion_ingest` de F0 contiene normalización de strings y la cadena de dedup por SQL **por performance de ingesta masiva**; está documentada como excepción deliberada (Persistencia §2.2/§4.1) y NO se generaliza a las RPC de transición (enrich/score/approve/sync), que son estrictamente mecánicas. La `DeduplicationPolicy` del dominio (Parte II §2.2) sigue siendo la fuente de verdad conceptual del criterio de duplicado.

---

### 2.6 Adapters
- Un adapter implementa **un** port; es intercambiable (AP-3/AP-15).
- Clientes HTTP de proveedor: timeout + retries con backoff, `fetchImpl` **inyectable** para tests — patrón exacto de `clientify/client.ts` (default `maxRetries: 2`, `client.ts:39`; manejo de 429/5xx documentado en `client.ts:14`) y `arca/soap.ts` (POST con timeout + retries).
- El adapter mapea fila/JSON externo ↔ dominio (ACL); el dominio nunca ve el formato del proveedor (Regla ACL-1).

### 2.7 Repositories
- **Un repositorio por Aggregate Root** → existe solo `ProspectRepositoryPort` (Regla R-1, Parte II §2.4). PROHIBIDO repos para entidades internas.
- Devuelve/acepta el **agregado reconstituido**, no filas crudas; el mapeo vive en el adapter Supabase (precedente `clientify/mappers.ts`).
- `save(p, uow)` siempre dentro de la transacción (§2.5).

### 2.8 Casos de uso
- Patrón fijo: cargar AR → invocar método del AR o `*Policy` → recolectar eventos → persistir agregado + eventos en una `UnitOfWork` (Parte II §2.3).
- **No contienen reglas de transición** (Regla UC-1): delegan en el AR.
- Dependen **solo de ports** (AP-3/AP-15). Traducen errores de proveedor a `*.failed` por `transient` (Regla UC-2).

### 2.9 Servicios de dominio
- **Puros, síncronos, sin I/O** (`ScoringPolicy`, `DeduplicationPolicy`, `PromotionPolicy`). Precedente: `calculateCommercialScore(...)` (`commercial-score.ts:82`), motor de `matching.ts`.
- Señales externas caras (similitud IA) se **inyectan como función** pre-computada (`SimTextoFn`-style, `iaMatch.ts:19`); el servicio no llama a IA ni a base (Regla DS-1).

### 2.10 APIs (actions / routes / crons)
- Responsabilidad única: autenticar/autorizar (RLS/RBAC, AP-4), validar (Zod), componer el caso de uso, traducir `Result`/`DomainError` a HTTP/UI. Cero reglas de negocio (Parte II §3.2).
- Crons (GH Actions) autenticados **fail-closed** con `CRON_SECRET`; exigen `status` real para considerarse exitosos (precedente Drive Sync remediation).
- Headers de seguridad globales ya fijados en `netlify.toml` (`X-Frame-Options`, `X-Content-Type-Options`, HSTS, `Permissions-Policy`).

### 2.11 Migraciones
- **Numeradas, secuenciales, idempotentes, aplicadas A MANO** por Martín en el SQL Editor (G3, `GOVERNANCE.md:20-26`). El asistente prepara/muestra; **no** ejecuta WRITES; PROHIBIDO `supabase db push`.
- No reusar números con hueco histórico; el próximo libre se verifica contra prod (`arsksytgdnzukbmfgkju`, G4). Tablas `prospeccion_*` con RLS en todas.

### 2.12 Testing
- Tests **unitarios puros** del dominio y servicios (sin IO), corridos con Vitest (`vitest run`, `package.json`). El glob de `vitest.config.ts` ya incluye `src/lib/comercial/**/*.test.ts`; al crear el contexto se DEBE **extender** ese `include` con `src/lib/prospeccion/**/*.test.ts`.
- Inyección de `fetchImpl`/`simTexto`/`Clock`/`IdGen` hace los tests deterministas y sin red (precedente probado en `soap.ts`/`matching.ts`).
- Cobertura mínima exigida en el review: AR (todas las transiciones legales e ilegales), cada `*Policy`, cada ACL (mapeo + manejo de `transient`).

### 2.13 Documentación
- Cada decisión arquitectónica relevante → **ADR** (Capítulo 3). Cada port y evento → comentario de contrato (qué garantiza, qué precondición exige).
- Esta Constitución (`docs/prospeccion/_parts/*`) es la fuente normativa; los reportes de handoff son snapshots históricos (`GOVERNANCE.md:78`).

| Plantilla normativa (Capítulo 2) | |
|---|---|
| **Objetivo** | Fijar estándares de código exigibles por capa y por artefacto, verificables por typecheck/lint/test y por review. |
| **Alcance** | Estructura, nomenclatura, DTOs, eventos, RPC, adapters, repos, casos de uso, servicios, APIs, migraciones, testing, docs. |
| **Decisiones tomadas** | Estructura por capa hexagonal; Zod en el borde; un repo por AR; clientes con `fetchImpl` inyectable; migraciones a mano (G3); extender el `include` de `vitest.config.ts`. |
| **Decisiones descartadas** | (a) `data.ts` plano en este contexto — PROHIBIDO. (b) Excepciones desnudas — descartado a favor de `Result` (AP-12). (c) `supabase db push` — PROHIBIDO (G3). |
| **Justificación** | Reusa patrones ya probados del repo y los hace norma; mantiene el dominio testeable sin red. |
| **Riesgos** | Más archivos que el patrón plano. Aceptado por densidad de reglas y criticidad de la invariante. |
| **Impacto sobre la arquitectura** | Operacionaliza AP-1…AP-17 en convenciones concretas y deja la conformidad medible. |

---

## Capítulo 3 — ADR Governance

Un **ADR** (Architecture Decision Record) documenta una decisión arquitectónica significativa, su contexto y sus consecuencias. En `prospeccion` los ADR son **obligatorios** para las decisiones del listado 3.1 y son insumo del Architecture Review (Capítulo 4).

### 3.1 Cuándo DEBE escribirse un ADR (decisiones que lo obligan)
Un ADR es **OBLIGATORIO** cuando la decisión:
1. **Cambia o agrega un contrato público** — un port, un esquema de evento (o sube su `version`), un DTO de borde, una tabla `prospeccion_*` (AP-3/AP-9).
2. **Altera la máquina de estados o una invariante** del AR `Prospect` (INV-PR-1…6).
3. **Incorpora, reemplaza o retira un proveedor externo** (enrichment, IA, CRM, fuente de import) o su ACL (AP-5).
4. **Modifica un Non-Functional Budget** del Capítulo 5 (timeout, retries, tope de costo IA, tamaño de evento).
5. **Cruza la frontera del bounded context** (acoplamiento con `comercial`, `clientify`, `clients`, ERP).
6. **Introduce una excepción a un principio AP-n** o a un gate G1–G11 (la excepción DEBE quedar registrada, con su justificación y su fecha de revisión).
7. **Cambia el mecanismo de propagación** (Outbox, transporte de eventos, idempotencia).

NO requieren ADR: renombres internos sin impacto de contrato, refactors que preservan firmas, fixes de bug sin cambio de decisión.

### 3.2 Ciclo de vida (estados)
Un ADR transita por estados explícitos:
- **Proposed** — redactado, en revisión; aún no vinculante.
- **Accepted** — aprobado en el Architecture Review (Capítulo 4) y, donde G7 aplica, con OK de la Dirección. Es vinculante.
- **Deprecated** — ya no se recomienda, pero su decisión sigue en código hasta su retiro.
- **Superseded by ADR-NNNN** — reemplazado por otro ADR; el nuevo enlaza al viejo y viceversa. **Un ADR Accepted nunca se edita en su contenido decisorio**: se supersede (AP-13, inmutabilidad de la decisión).

### 3.3 Versionado y ubicación
- Viven en `docs/prospeccion/adr/NNNN-titulo-en-kebab.md`, numeración secuencial sin reuso de huecos (espejo de la disciplina de migraciones G3).
- Formato mínimo: **Título · Estado · Fecha · Contexto · Decisión · Consecuencias · Alternativas descartadas · Principios/Gates afectados (AP-n / G-n) · Revisión (fecha)**.
- Toda regla `R-x.y` o `AP-n` que un ADR toque DEBE citarse por su identificador, para trazabilidad bidireccional con esta Constitución.
- El estado vive en el encabezado del archivo; el historial vive en git (no se borra un ADR, se marca Deprecated/Superseded — AP-13).

| Plantilla normativa (Capítulo 3) | |
|---|---|
| **Objetivo** | Definir cuándo, cómo y dónde se registran las decisiones arquitectónicas, y cómo evolucionan sin perder trazabilidad. |
| **Alcance** | Toda decisión significativa de `prospeccion` (contratos, invariantes, proveedores, budgets, fronteras, excepciones). |
| **Decisiones tomadas** | 7 disparadores obligatorios; ciclo Proposed→Accepted→Deprecated→Superseded; ADR inmutable (se supersede); ubicación `docs/prospeccion/adr/`, numeración sin huecos. |
| **Decisiones descartadas** | (a) ADR para todo cambio — descartado (ruido). (b) Editar un Accepted — PROHIBIDO (AP-13). (c) ADR fuera del repo (wiki externa) — descartado: la decisión vive con el código. |
| **Justificación** | La vigencia a 10 años (Parte I) exige memoria de por qué se decidió cada cosa; sin ADR, las excepciones se vuelven invisibles. |
| **Riesgos** | Burocracia. Se mitiga con el listado cerrado 3.1 y formato mínimo. |
| **Impacto sobre la arquitectura** | Hace auditable la evolución; conecta cada cambio con AP-n/G-n y alimenta el review. |

---

## Capítulo 4 — Definition of Architecture Review (gate formal)

El **Architecture Review** es un **gate obligatorio** previo al merge de todo cambio que toque `prospeccion` y caiga en el alcance del Capítulo 3.1. Es la materialización técnica de **G7** (plan→aprobación→build, `GOVERNANCE.md:45-48`) y queda **subordinado a G1** (nada se mergea/deploya a `main` sin OK de la Dirección, `GOVERNANCE.md:8-12`).

### 4.1 Proceso (gate-heavy, una fase por vez)
1. **Diseño** → ADR(s) en estado *Proposed* (Capítulo 3) + alcance escrito.
2. **Presentación de alcance** al Architecture Owner; se corre el checklist 4.2.
3. **Aprobación** → ADR a *Accepted*; donde G7/G1 aplican, OK explícito de la Dirección.
4. **Build** → recién entonces se escribe código (G7).
5. **Verificación con evidencia** (G5): typecheck/lint/test verdes (`package.json`), lectura de estado real, caso de prueba ejecutado. "No fantasy": nunca declarar "validado" sin evidencia (`GOVERNANCE.md:6`).
6. **Merge/deploy**: solo con OK de la Dirección (G1).

### 4.2 Checklist obligatorio (todo ítem DEBE responderse)
**Alineación de paradigma**
- [ ] **DDD táctico:** ¿el cambio respeta el AR único `Prospect` y sus invariantes (INV-PR-1…6)? ¿No crea ARs ni repos espurios?
- [ ] **Hexagonal / Regla de Dependencia:** ¿las dependencias apuntan hacia adentro? ¿Cero imports Dominio→infra / Casos de Uso→`next`/`@supabase` (AP-15)?
- [ ] **Event-Driven:** ¿toda transición emite su evento + su `*.failed`? ¿Persistencia atómica vía Outbox (AP-2/AP-13)?

**Impacto**
- [ ] **Core Domain:** ¿toca la máquina de estados o una invariante? → ADR obligatorio (3.1.2).
- [ ] **Bounded Contexts / fronteras:** ¿acopla con `comercial`/`clientify`/`clients`/ERP? ¿El cruce es por contrato/evento, no por import directo (AP-17, R-1.4.2)?
- [ ] **Contratos públicos:** ¿cambia un port/evento/DTO/tabla? ¿Es backward-compatible o sube `version` (AP-9)?
- [ ] **No-bypass del CRM:** ¿algún camino nuevo permite llegar al CRM sin `HumanDecision = approved` (INV-PR-2/AP-16)? Si sí → **rechazo**.
- [ ] **Provider-agnostic:** ¿algún SDK de proveedor se filtró a Dominio/Casos de Uso (AP-5, Regla ACL-1)? Si sí → **rechazo**.
- [ ] **Performance:** ¿cabe en los Non-Functional Budgets (Capítulo 5)? ¿Respeta el límite serverless ~26–30 s (NFB-1)?
- [ ] **Observabilidad:** ¿emite métricas/logs de latencia, costo IA, `*.failed` (AP-7)?
- [ ] **Seguridad:** ¿RLS/RBAC aplican? ¿Crons fail-closed? ¿Secretos fuera del cliente (G9)? ¿Datos redactados antes de IA?
- [ ] **Idempotencia:** ¿los consumidores/sync son idempotentes (AP-8, INV-PR-5)?
- [ ] **Migraciones:** ¿numerada, idempotente, a mano (G3)? ¿RLS en tablas nuevas?
- [ ] **Tests/Evidencia:** ¿hay tests del cambio? ¿`vitest.config.ts include` cubre el path? ¿Build verde (G5)?
- [ ] **ADR:** ¿existe ADR *Accepted* para cada disparador del Capítulo 3.1?

Cualquier ítem en rojo **bloquea el merge**. Las dos preguntas marcadas "→ rechazo" (no-bypass del CRM y filtración de SDK) son **hard stops**: no admiten excepción sin ADR de excepción aprobado por la Dirección (3.1.6).

| Plantilla normativa (Capítulo 4) | |
|---|---|
| **Objetivo** | Definir el gate formal de revisión arquitectónica y su checklist obligatorio antes de cualquier merge. |
| **Alcance** | Todo cambio en `prospeccion` que caiga en el Capítulo 3.1. |
| **Decisiones tomadas** | Proceso de 6 pasos subordinado a G7/G1/G5; checklist de paradigma + impacto; dos hard-stops (no-bypass del CRM, SDK en el dominio). |
| **Decisiones descartadas** | (a) Review informal "a ojo" — descartado (no auditable). (b) Merge antes de evidencia — PROHIBIDO (G5). (c) Excepciones sin registro — descartado (exigen ADR 3.1.6). |
| **Justificación** | Sin un gate explícito, los principios y la invariante de gobierno se erosionan; G7 ya exige plan→OK→build. |
| **Riesgos** | Fricción/latencia de entrega. Se mitiga: el checklist solo aplica al alcance del Capítulo 3.1; el resto pasa por typecheck/lint/test. |
| **Impacto sobre la arquitectura** | Es el punto de control que conecta principios, standards, ADR y budgets en una decisión de merge defendible. |

---

## Capítulo 5 — Non-Functional Budgets (justificados)

Presupuestos **vinculantes** (AP-11). Cada uno es **medible** vía `MetricsPort` (AP-7) y se valida en el review (Capítulo 4). Los valores son **objetivos de diseño**: donde dependan de un límite de plataforma, citan el hecho vivo y se ajustan por ADR (3.1.4), no a mano en el código.

| ID | Presupuesto | Valor objetivo | Justificación técnica |
|---|---|---|---|
| **NFB-1** | Latencia máx. de una invocación serverless (request síncrono) | **≤ ~26–30 s de pared** (margen real, no los 60 s nominales de `maxDuration`) | El runtime de Netlify Functions corta antes de los 60 s nominales; el límite **operativo real observado es ~26–30 s**. Precedente real: el Drive Sync daba **504 "Inactivity Timeout"** por walk **secuencial** que superaba el límite del contenedor (fix = paralelizar + deadline interno + lotes). Por eso AP-6: el trabajo largo se fracciona, no se bloquea. |
| **NFB-2** | Timeout de enrichment (1 proveedor, 1 prospecto) | **≤ 8 s** por intento; **≤ 2 reintentos** | Debe caber **con holgura** dentro de NFB-1 dejando margen para mapeo + persistencia + Outbox. Alineado con el default `maxRetries: 2` del cliente HTTP del repo (`clientify/client.ts:39`) y el manejo de 429/5xx con backoff (`client.ts:14`). |
| **NFB-3** | Timeout de IA (1 análisis) | **≤ 15 s** por intento; **1 reintinto** transitorio | La IA es el paso más caro en tiempo; aún así DEBE caber en NFB-1 dejando margen. Si excede, se rediseña a asíncrono por evento (AP-6), nunca se sube el timeout del request. |
| **NFB-4** | Tiempo máx. de sync CRM (1 prospecto) | **≤ 10 s** incluyendo dedupe idempotente | Idempotente por `Cuit`/`clientifyId` (AP-8/INV-PR-5); cabe en NFB-1. Reusa el cliente Clientify (300 req/min, `client.ts:14`) a través de la ACL. |
| **NFB-5** | Tamaño máx. de un Domain Event (payload) | **≤ 32 KB** serializado | Los eventos son **hechos**, no documentos: snapshots grandes (texto IA crudo, JSON de proveedor) van por referencia, no embebidos. Mantiene el Outbox y el transporte livianos y la entrega *at-least-once* barata (AP-2). |
| **NFB-6** | Límite de retries por paso con proveedor | **≤ 2** reintentos (enrichment/CRM), **≤ 1** (IA), con backoff exponencial | Espejo del default del repo (`maxRetries: 2`, `client.ts:39`). Un `*.failed{transient:false}` **no** reintenta y detiene ese prospecto (Parte II §2.1). Evita tormentas de reintentos contra proveedores con rate-limit. |
| **NFB-7** | Tope de costo IA | **Configurable por lote y por día** (AP-14), con **corte duro** al excederse | El costo de IA es el riesgo económico del pipeline. El tope vive en configuración auditable, no en código; al excederse se emite `*.failed` y se frena el lote (fail-closed, AP-4). Medido vía `MetricsPort` (uso IA, AP-7). |
| **NFB-8** | Límite de concurrencia | **In-memory por proceso, NO cross-container**; serialización real por **lock en Postgres** | El rate-limit / contador en memoria de una función es **por proceso/contenedor efímero**: no coordina entre invocaciones concurrentes ni entre contenedores (AP-6). Por eso la concurrencia real contra un proveedor o sobre un mismo `Prospect` se controla con un **lock/claim en Postgres** (la única fuente compartida), no con un contador en RAM. |

**Regla NFB-0 (presupuesto agregado).** La suma de los pasos síncronos de **un** request DEBE caber en NFB-1. Como NFB-2+NFB-3+NFB-4 superan ~26–30 s si se encadenan en línea, el pipeline **DEBE** ejecutarse **un paso por invocación** dirigido por eventos (AP-2/AP-6), nunca el ciclo completo en un solo request bloqueante.

| Plantilla normativa (Capítulo 5) | |
|---|---|
| **Objetivo** | Fijar presupuestos no-funcionales medibles y vinculantes, cada uno con su justificación técnica. |
| **Alcance** | Toda ruta caliente de `prospeccion`: enrichment, IA, sync CRM, eventos, concurrencia, costo. |
| **Decisiones tomadas** | NFB-1…NFB-8 + NFB-0; límite serverless real ~26–30 s; retries ≤2/≤1; evento ≤32 KB; concurrencia por lock Postgres (no RAM); tope de costo IA configurable y fail-closed. |
| **Decisiones descartadas** | (a) Confiar en `maxDuration=60` — descartado (no es el límite real; 504 reproducido). (b) Pipeline completo en un request — PROHIBIDO (NFB-0). (c) Rate-limit/concurrencia solo in-memory — descartado (no cross-container, NFB-8). |
| **Justificación** | El límite serverless y el costo de IA son restricciones de corrección; ignorarlas produce 504 y costos no acotados (precedentes reales). |
| **Riesgos** | Budgets demasiado ajustados frenan features legítimas. Se mitiga: se ajustan por ADR (3.1.4), con evidencia de medición. |
| **Impacto sobre la arquitectura** | Fuerzan el diseño asíncrono por eventos y el control de concurrencia en Postgres; son criterio de aceptación en el review. |

---

## Capítulo 6 — Technology Radar

Clasificación **Adopt / Trial / Assess / Hold** para `prospeccion`. **Adopt** = estándar por defecto; **Trial** = usar en alcance acotado con evidencia; **Assess** = investigar antes de comprometer; **Hold** = no introducir sin ADR de excepción aprobado.

### IA
| Anillo | Ítem | Justificación |
|---|---|---|
| Adopt | IA **detrás de `AIPort` + ACL**, señal expuesta como función pura inyectable (`SimTextoFn`-style, `iaMatch.ts:19`); datos **redactados** antes de salir | AP-5/AP-16; la IA asiste, no decide. |
| Assess | Proveedor/modelo concreto de IA | Es detalle intercambiable (R-1.3.1); se elige por ADR midiendo NFB-3/NFB-7. |
| Hold | IA que **decide** la salida al CRM o escribe directo | Viola AP-16/INV-PR-2 (hard stop del review). |

### CRM
| Anillo | Ítem | Justificación |
|---|---|---|
| Adopt | **Clientify a través de `CrmSyncPort` + ACL**, idempotente | Reusa `clientify/client.ts` sin acoplar el dominio (AP-5/AP-8). |
| Trial | **CRM nativo de Nexus** (`crm_leads`/`crm_opportunities` + `clients`) como destino futuro | R-1.3.2: reemplazar el CRM externo sin reescribir el dominio. |
| Hold | Escritura directa al CRM saltando el port | R-1.2.3 / AP-16. |

### Enrichment
| Anillo | Ítem | Justificación |
|---|---|---|
| Adopt | **`EnrichmentPort` + ACL** con `fetchImpl` inyectable, backoff, `transient` | Patrón probado `client.ts`/`soap.ts`; testeable sin red. |
| Assess | Proveedor de enriquecimiento concreto (datos de empresa/contacto) | Intercambiable; se elige por ADR midiendo NFB-2 y costo. |
| Hold | SDK de proveedor importado en Dominio/Casos de Uso | Regla ACL-1 / AP-15. |

### Event Bus
| Anillo | Ítem | Justificación |
|---|---|---|
| Adopt | **Outbox en Postgres** (`prospeccion_outbox`) escrito en la transacción del agregado | Atomicidad evento↔estado; cero infra nueva (AP-2/AP-6). |
| Assess | Broker dedicado (cola/stream gestionado) si el volumen lo exige | Solo si el Outbox+poller no alcanza; decisión por ADR (3.1.7). |
| Hold | Bus en memoria del proceso como mecanismo de entrega | Efímero, no cross-container (NFB-8/AP-6). |

### Bases de datos
| Anillo | Ítem | Justificación |
|---|---|---|
| Adopt | **Supabase/Postgres prod `arsksytgdnzukbmfgkju`** con RLS, RPC `SECURITY DEFINER`, PostGIS | G4/G10; fuente de verdad única (AP-17). |
| Adopt | **Locks/claims en Postgres** para concurrencia real | NFB-8: la única fuente compartida entre contenedores. |
| Hold | Segunda base / tabla espejo paralela al CRM | AP-17 / R-1.4.2. |

### Frameworks
| Anillo | Ítem | Justificación |
|---|---|---|
| Adopt | **Next.js 14 App Router** (`next 14.2.18`, `package.json`) en el borde; **TypeScript estricto** | Estándar del repo; el borde compone, no decide (Parte II §3.2). |
| Adopt | **Zod** para validación de borde (`package.json`) | DTOs validados (§2.3). |
| Adopt | **Node 22** en build/runtime (`netlify.toml` `NODE_VERSION=22`) | Hecho vivo; requerido por el toolchain del repo. |
| Hold | DI container pesado | Descartado a favor del wiring explícito por función (Parte II §3, estilo `soap.ts`/`matching.ts`). |

### Testing
| Anillo | Ítem | Justificación |
|---|---|---|
| Adopt | **Vitest** unitario puro (`vitest run`, `vitest.config.ts`) con inyección de puertos | Determinista, sin red; ya es el estándar del repo (`vitest@2`). |
| Trial | Tests de contrato sobre las ACL (mapeo + `transient`) | Cubre el borde de proveedor sin pegarle al proveedor real. |
| Assess | E2E del pipeline contra branch efímero de Supabase | Útil para gates mayores; costo/tiempo a evaluar por ADR. |

### Observabilidad
| Anillo | Ítem | Justificación |
|---|---|---|
| Adopt | **`MetricsPort`** (counters/observe) + logs estructurados con `code/details/hint` | AP-7; G6 exige diagnóstico con evidencia real. |
| Assess | Backend de métricas/tracing gestionado | Si la observabilidad por logs no alcanza; decisión por ADR. |
| Hold | `console.log` suelto sin estructura como observabilidad oficial | No auditable (G6). |

### Automatización
| Anillo | Ítem | Justificación |
|---|---|---|
| Adopt | **Crons en GitHub Actions** autenticados fail-closed (`CRON_SECRET`), exigiendo `status` real | Precedente Drive Sync; AP-4/G5. |
| Trial | Poller del Outbox como función programada acotada por deadline | Drena eventos respetando NFB-1 (AP-6). |
| Hold | Make/Zapier u orquestadores externos que escriban al CRM | Reintroducen apps paralelas (AP-17); precedente: Make quedó huérfano tras mover el lead a función propia. |

| Plantilla normativa (Capítulo 6) | |
|---|---|
| **Objetivo** | Clasificar la tecnología del contexto en Adopt/Trial/Assess/Hold con justificación por ítem. |
| **Alcance** | IA, CRM, Enrichment, Event Bus, BD, Frameworks, Testing, Observabilidad, Automatización. |
| **Decisiones tomadas** | Adopt: ACLs+ports, Outbox Postgres, Supabase prod, Next 14/Zod/Node 22, Vitest, MetricsPort, crons fail-closed. Hold: SDK en dominio, escritura directa al CRM, bus en RAM, base paralela, orquestadores externos al CRM. |
| **Decisiones descartadas** | Consagrar un proveedor de IA/enrichment concreto (queda Assess, R-1.3.1); DI container pesado (Hold). |
| **Justificación** | Separa lo permanente (patrones, Postgres, contratos) de lo intercambiable (proveedores), sosteniendo AP-5 y la vigencia a 10 años. |
| **Riesgos** | El radar envejece. Se mitiga con la revisión anual (Parte I) y ADR por movimiento de anillo. |
| **Impacto sobre la arquitectura** | Da una decisión por defecto para cada elección tecnológica y la ancla a los principios. |

---

## Capítulo 7 — Evolución a 5 años

Horizonte intermedio dentro de la vigencia de 10 años de la Constitución (Parte I §1.3). Distingue lo que **permanece estable** (el núcleo soberano) de lo que **cambia** (los detalles intercambiables).

### 7.1 Qué PERMANECE estable
- **El dominio puro** (AR `Prospect`, invariantes INV-PR-1…6, máquina de estados, VOs). Es lo permanente por diseño (AP-1).
- **La invariante de gobierno** "nada va directo al CRM" + Human-in-the-Loop (R-1.2.1 / AP-16). Es la razón de existir del contexto.
- **La arquitectura hexagonal y la Regla de Dependencia** (AP-15): el dominio nunca conoce la infraestructura.
- **El catálogo de eventos como contrato** (versionado, AP-9): se extiende, no se rompe.
- **Los gates de gobernanza G1–G11** y este marco de Architecture Governance (principios, ADR, review, budgets).
- **Postgres como fuente de verdad única y como punto de coordinación de concurrencia** (AP-17 / NFB-8).

### 7.2 Qué CAMBIA (y cómo se absorbe el cambio)
- **Los proveedores** (IA, enrichment, fuente de import) — cambiarán una o más veces; se absorben en la ACL/port sin tocar el dominio (AP-5). Cada cambio = un ADR (3.1.3).
- **El CRM** — la trayectoria esperada es Clientify (externo) → **CRM nativo de Nexus**; se absorbe sustituyendo el adapter de `CrmSyncPort` (R-1.3.2, radar CRM: Adopt→Trial).
- **El transporte de eventos** — si el volumen supera al Outbox+poller, se evalúa un broker dedicado **detrás del `EventBusPort`** (radar Assess); el dominio no se entera.
- **Los modelos y costos de IA** — bajarán y cambiarán; los budgets NFB-3/NFB-7 se reajustan por ADR con evidencia de medición.
- **Los límites de plataforma** (timeout, Node, heap) — son hechos vivos (`netlify.toml`); si cambian, se cita el archivo vivo y se reajusta NFB-1 por ADR (regla de vigencia, `GOVERNANCE.md:78-80`).
- **El borde Next.js** — versiones del framework subirán; al ser borde "tonto" (compone, no decide), su recambio no toca el dominio.

### 7.3 Señales de revisión anticipada (antes del ciclo anual)
- Repetidos `*.failed{transient:true}` que saturan NFB-6 → revisar proveedor/contratos.
- Costo IA acercándose sostenidamente al tope NFB-7 → revisar modelo/estrategia.
- Más de un consumidor externo del Outbox → evaluar broker dedicado (3.1.7).
- Aparición de un segundo destino de "alta de cliente" → alerta de violación AP-17 (R-1.4.2).

| Plantilla normativa (Capítulo 7) | |
|---|---|
| **Objetivo** | Trazar qué permanece estable y qué cambia en 5 años, y cómo se absorbe cada cambio sin erosionar el núcleo. |
| **Alcance** | Dominio, invariantes, proveedores, CRM, transporte de eventos, IA, límites de plataforma, borde. |
| **Decisiones tomadas** | Núcleo soberano estable (dominio, no-bypass, hexagonal, eventos-contrato, gates); cambio absorbido por ports/ACL + ADR; Postgres permanente como verdad y coordinación. |
| **Decisiones descartadas** | (a) Reescritura periódica del dominio al cambiar de proveedor — descartado (todo el sentido de AP-5). (b) Consagrar Clientify a 5 años — descartado (R-1.3.2). |
| **Justificación** | La estabilidad del dominio + la intercambiabilidad de la infraestructura es la apuesta central de la Constitución (Parte I/II); este capítulo la proyecta en el tiempo. |
| **Riesgos** | Subestimar un cambio de plataforma disruptivo (p.ej. salida de serverless). Se mitiga: AP-6 ya no asume proceso longevo, y NFB se citan a archivos vivos. |
| **Impacto sobre la arquitectura** | Confirma que la arquitectura está diseñada para que el cambio ocurra en la periferia y el centro perdure. |

---

> **Cierre de la Parte VI.** La gobernanza de `prospeccion` es **doble y jerárquica**: hereda el núcleo no-negociable de Nexus (G1–G11, autoridad de la Dirección) y le agrega una capa arquitectónica propia —17 principios, coding standards exigibles, ADR obligatorios, un Architecture Review con hard-stops, presupuestos no-funcionales medibles y un radar tecnológico—. Lo permanente es el dominio puro y la invariante de no-bypass del CRM; todo lo demás (proveedores, CRM, transporte, IA, plataforma) es intercambiable detrás de un port y se mueve por ADR. Esta Parte VI no fabrica certezas: al 2026-06-25 el código de `prospeccion` no existe; lo que existe son las **reglas** bajo las cuales **DEBE** nacer.
