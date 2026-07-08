# F2 — AI Qualification Engine (Qualification v1) · Documento de Arquitectura

> **Estado:** `✅ CERRADA EN PRODUCCIÓN` · **Versión:** `b1ea521` · **Deploy:** 2026-06-29 · **Diseño original:** v1.2 (2026-06-28) — ver Release Report `F2-RELEASE-REPORT-2026-06-29.md`.
> **Directivas finales (ronda 3, aprobadas, incorporadas):** (7) **Decision Trace** — envelope JSON estructurado asociado al score (sin tabla nueva) que permite reconstruir toda la decisión; (8) **Regla de dependencia** — el Decision Engine NUNCA depende de un proveedor de IA directo; solo vía ports. Ver §2.2.
> **Ronda 2 (aprobada por Dirección, incorporada):** (1) Lead Score totalmente auditable (todos los factores persistidos); (2) **Confidence Score** independiente; (3) **Prioridad comercial** como tercera dimensión; (4) **ICP multi-variante por unidad de negocio** (General/ANMAT/Cargas Generales/Fulfillment/Cross Dock/Última Milla), versionadas independientemente; (5) Feedback Loop enriquecido (ganadas/perdidas/motivo/margen/permanencia/recurrencia/crecimiento/NPS); (6) explicación también de **rechazos**. Ver §2.1.
> **F1 (UDIE + Prospección): CONGELADA e intacta.** F2 es **aditivo e independiente**: módulo nuevo + migración aditiva + rama nueva desde `main`. No toca `src/lib/udie/**`, ni la RPC `prospeccion_ingest`, ni las migraciones 0088/0089, ni el dominio/import de F1, ni el PR #42.
> **Método:** 3 arquitecturas independientes → síntesis con scoring → 2 críticas adversariales (ambas `approve-with-changes`; todos los hallazgos incorporados, ver §16). Fuente de verdad superior: el Blueprint `docs/prospeccion/PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md` (este doc NO lo invalida; lo extiende vía ADR).

---

## 0. Resumen ejecutivo

F2 convierte a Nexus de **importador** en **motor de decisión comercial**: para cada empresa importada por F1/UDIE, construye un **perfil de empresa** a partir de la **evidencia que el CSV ya trae** (Apollo/Sales Navigator), calcula un **Lead Score 0-100 explicable por reglas**, y decide **importar (≥80) / revisar (60-79) / descartar (<60)**. Objetivo estratégico: **Clientify recibe solo oportunidades calificadas**.

**Arquitectura elegida:** *Pure Isomorphic ScoringStrategy*. El cálculo `perfil→score→decisión→explicación` es un conjunto de **funciones puras** (cero I/O) que corren en **dos lugares con el MISMO código**: en el navegador (preview de import, Lead Score instantáneo) y en el servidor (cálculo **autoritativo** persistido). El servidor **siempre recalcula** (anti-tamper); el navegador solo pinta.

| Alternativa | Total | Veredicto |
|---|---|---|
| **A — Isomorphic Pure ScoringStrategy** | **53** | **Elegida** (mejor balance; explainability 10, testability 10, fit-con-F1 10) |
| C — Pragmatic minimal (YAGNI) | 53 | Descartada por fusionar enrichment+scores (migración destructiva al llegar enrichment) |
| B — Async event-driven (Outbox) | 50 | Máxima fidelidad al Blueprint, pero sacrifica el Lead Score instantáneo en preview. **Su rail Outbox queda RESERVADO** como seam de extensión (enrich/IA/F3). |

---

## 1. Objetivo y principio rector

- **Objetivo:** importar al CRM **solo oportunidades calificadas**, con un Lead Score explicado y una decisión (importar/revisar/descartar). No es importar contactos; es decidir cuáles merecen entrar.
- **Principio rector:** Nexus deja de ser un importador y pasa a ser un **motor inteligente de decisión comercial**. Flujo: `Sales Navigator → UDIE → Normalizer → Company Profile → ScoringStrategy → Decision → (aprobación humana) → Clientify`.
- **F2 opera DOWNSTREAM de F1**: sobre los prospectos ya importados a Nexus (no se enchufa al pipeline de import de UDIE; reusa su salida). La calificación es un sub-bounded-context aditivo de `prospeccion`.

---

## 2. Decisiones aprobadas (base del diseño)

**Decisiones de alcance (aprobadas):**
1. **Qualification v1 sobre evidencia del CSV**: scoring + decisión + explicación en una fase shippable. Enrichment externo e IA-LLM = **puntos de extensión** (ports, no implementados). La desviación del Blueprint (fusionar F2-enrich/F3-score/F4-IA) se documenta en **ADR-F2-01**.
2. **Evidencia = firmográficos del CSV** (industry, employees, country, revenue…), leídos del `raw` jsonb del prospecto. **Cero API externa.** Señales blandas (logística, crecimiento, tercerización) por **heurística determinística**.
3. **ICP = pesos del prompt como v1, config-tunable**: industria 20 / tamaño 15 / actividad logística 25 / presencia AR 10 / potencial 20 / crecimiento 10 = 100.
4. **Explicación determinística** (de los factores del score). IA reservada para una fase futura.

**Directivas adicionales de Dirección (incorporadas como secciones de primera clase):**
- **D-4 `ScoringStrategy` (interface)** — el scorer v1 implementa una interfaz; una variante futura alimentada por enrichment es **otra implementación, sin refactor** (§4).
- **D-5 ICP como política versionada** — no hardcodeado; configurable y versionable (§7).
- **D-6 Qualification Feedback Loop** — diseñar desde ahora la recalibración futura con conversión comercial, facturación y rentabilidad real (§10).
- **D-7 Agnóstico de proveedor** de enrichment **y** de IA (§11).

### 2.1 Ajustes aprobados (ronda 2) — refinamientos dentro de la arquitectura elegida (no la cambian)

- **A1 · Lead Score totalmente auditable.** No se guarda solo el puntaje: se persiste el **breakdown completo** — cada uno de los 6 factores (puntos crudos + ponderados), las `penalties` (código + puntos + motivo), los `hardFails`, los **inputs del perfil que alimentaron cada factor**, y `model_version`/`icp_config_version`/`strategy_id`. Cualquier decisión es **reconstruible bit-a-bit** desde `prospeccion_scores.factors` (jsonb). (§6, §8)
- **A2 · Confidence Score (métrica independiente).** `confidence` 0..100, **distinto del Lead Score**: el Lead Score mide *calidad del lead*; el Confidence mide *cuánta evidencia/completitud respalda esa evaluación*. En v1 (evidencia CSV) se deriva determinísticamente de la **completitud del perfil** (cuántos firmográficos vinieron explícitos vs `unknown`/inferidos). Función pura `computeConfidence(profile): number`. (§5, §6, §8)
- **A3 · Prioridad comercial (tercera dimensión).** `priority` (tier `alta|media|baja` + valor ordenable), **distinta** de Lead Score y Confidence: responde *en qué orden trabajar*. Combina Lead Score × Confidence × señales de negocio (banda de tamaño/revenue, fit con la variante ICP). Función pura `computePriority(score, confidence, profile, icp)`. Las tres métricas se persisten y se muestran por separado (no se asume que representan lo mismo). (§5, §6, §8)
- **A4 · ICP multi-variante por unidad de negocio.** El ICP deja de ser único: es un **conjunto de políticas** `businessUnit → IcpConfig`, cada una **versionada independientemente**. Variantes v1: `general`, `anmat`, `cargas_generales`, `fulfillment`, `cross_dock`, `ultima_milla`. En v1 se califica contra `general` por defecto (selección de variante / score-contra-mejor-variante = extensión reservada). `prospeccion_scores` graba `business_unit` + `icp_config_version` usados. (§7)
- **A5 · Feedback Loop enriquecido.** El esquema de outcomes (reservado, no construido) prevé: `won`/`lost`, `lost_reason`, `margin_real`, **permanencia** (tenure), **recurrencia**, **crecimiento**, **NPS**, además de `revenue_real`. (§10)
- **A6 · Explicación también de rechazos.** `explain()` produce una explicación clara para las **tres** decisiones — incluido **por qué se descartó** (factores bajos + penalties + hardFails responsables), no solo las aprobaciones. Toda decisión es transparente. (§5, §8, §12)

### 2.2 Directivas finales (ronda 3) — incorporadas

- **A7 · Decision Trace.** No es una métrica nueva: es el **registro completo del recorrido** del motor hasta la decisión, que permite **reconstruirla por entero**. Contiene: `icp_config_version`, `business_unit`, `factors` (raw+ponderado), `penalties`, `hard_fails`, `score`, `confidence`, `priority`, `decision`, `explanation`, `model_version`/`strategy_id`/`confidence_version`, e inputs del perfil. **No se crea tabla nueva**: se persiste como **`decision_trace jsonb`** (envelope estructurado) en la fila de `prospeccion_scores`, consolidando los campos de auditoría de A1. Función pura `buildDecisionTrace(result): DecisionTrace`. (§6, §8, §12 — ADR-F2-11)
- **A8 · Regla de dependencia (desacople de proveedor).** Regla arquitectónica explícita y **enforced por boundary**: el **Decision Engine (y todo el dominio `qualification`) NUNCA depende directamente de un proveedor de IA/enrichment**. La única dependencia permitida es vía los **ports**: `DecisionEngine → ScoringStrategy → EnrichmentPort → AINarrativePort`. Prohibido cualquier import directo a `openai`/`@anthropic-ai`/`@google/*`/SDK de proveedor dentro de `src/lib/prospeccion/qualification/**`. Se enforce con una zona ESLint `no-restricted-imports` + un test/grep de frontera (igual patrón que AP-UDIE-1 de F1). (§11 — ADR-F2-12)

---

## 3. Arquitectura elegida — Pure Isomorphic ScoringStrategy

El núcleo es **matemática pura, no infraestructura**. `qualify(raw, icp)` compone cuatro funciones puras y es **referencialmente transparente** (misma entrada ⇒ misma salida), lo que garantiza que **el número del preview == el persistido**.

- **CLIENTE (preview):** `ImportPanel`/`ImportWizard` parsea el CSV (reusa lo de F1, sin tocarlo), construye el `CompanyProfile` en el navegador desde la fila cruda y llama `qualify()` por fila → Lead Score + estrellas + decisión + explicación **al instante, sin backend**. Espejo del validador isomorfo de F1.
- **SERVIDOR (autoritativo):** una server action nueva `qualifyAndImportAction` (NO modifica `importProspectsAction`) ejecuta el commit en **dos pasos**: (1) import F0 como hoy (RPC `prospeccion_ingest`); (2) **recalcula** `qualify()` en el servidor sobre los mismos perfiles y persiste vía una **RPC nueva y aditiva** `prospeccion_record_qualification` (mecánica, ADR-017). **El borde nunca persiste el número que mandó el browser.**

Espejo exacto del patrón existente `src/lib/comercial/commercial-score.ts` (funciones puras, pesos como constantes inyectables, salida 0-100, testeable sin red ni base).

---

## 4. `ScoringStrategy` — interface (Directiva D-4)

El motor de scoring se expone como una **interface** para que la v1 (evidencia CSV) y una futura variante (alimentada por enrichment externo) **coexistan sin refactor**:

```ts
// El contrato estable que consume la capa de aplicación / la UI
export interface ScoringStrategy {
  readonly id: string;            // 'csv-evidence-v1'
  readonly modelVersion: string;  // 'qual-v1'
  qualify(raw: Record<string, unknown>, icp: IcpConfig): Result<QualificationResult>;
}

// v1 — única implementación construida ahora (evidencia del CSV)
export const csvEvidenceStrategy: ScoringStrategy; // compone buildCompanyProfile→scoreProfile→decide→explain

// FUTURO (reservado, NO implementado): misma interface, perfil enriquecido por EnrichmentPort
// export const enrichedStrategy: ScoringStrategy;
```

Clave: `scoreProfile`/`decide`/`explain` **no cambian** cuando llegue enrichment — solo cambia **cómo se construye el `CompanyProfile`** (de CSV vs. de un proveedor). Por eso la estrategia encapsula `buildCompanyProfile`, y el resto del pipeline es invariante. El `id`/`modelVersion` de la estrategia se graban en `prospeccion_scores` para trazabilidad.

---

## 5. Pipeline (puro, isomorfo) y transición de estado **legal**

Cuatro funciones puras encadenadas + una fachada, todas client-safe y testeables sin I/O:

| Etapa | Firma | Pura | Corre |
|---|---|---|---|
| Perfilado | `buildCompanyProfile(raw, icp): Result<CompanyProfile>` | ✅ | cliente + servidor |
| Scoring | `scoreProfile(profile, icp): { score, factors, penalties }` | ✅ | cliente + servidor |
| Decisión | `decide(score, profile, icp): { decision, hardFails }` | ✅ | cliente + servidor |
| Confianza (A2) | `computeConfidence(profile): number` (0..100, completitud de evidencia) | ✅ | cliente + servidor |
| Prioridad (A3) | `computePriority(score, confidence, profile, icp): { tier, value }` | ✅ | cliente + servidor |
| Explicación (A6) | `explain(profile, factors, penalties, decision): string` — cubre **import/review/discard** (incluye el porqué del rechazo) | ✅ | cliente + servidor |
| Fachada | `qualify(raw, icp): Result<QualificationResult>` — devuelve score + **confidence** + **priority** + factors auditables + explicación | ✅ | cliente (preview) + servidor (autoritativo) |
| Persistencia | RPC `prospeccion_record_qualification` | ❌ (mecánica) | solo servidor |

`buildCompanyProfile` lee firmográficos del `raw` jsonb con un **mapa de lectura PROPIO de F2** (variantes Apollo/Sales Navigator) — **NO** el `header-aliases` de F1 (que no se toca) — y deriva señales blandas determinísticas (keyword-match para depósitos/import-export/CDs/tercerización; bandas por umbrales de empleados/revenue; `is_argentina` por country). Los criterios que el CSV no evidencia (p. ej. nº de CDs) se marcan `unknown` sin bloquear.

### 5.1 Transición de estado legal (corrección crítica INV-PR-1)

La máquina canónica CC-7 es `imported → enriquecido → scoreado` y **INV-PR-1 prohíbe saltar etapas**. Por eso F2 hace **dos flips secuenciales en la misma transacción de la RPC**:
1. `imported → enriquecido`: se persiste el **`CompanyProfile` derivado del CSV como el snapshot de evidencia** (satisface INV-PR-3: "scoreado requiere evidencia presente").
2. `enriquecido → scoreado`: se persiste el `Score`/`Decision`/`Explanation`.

La RPC es **persistencia mecánica de un snapshot pre-validado en TS** (CS-RPC-2 / ADR-017): la lógica vive en el `qualify()` puro; la RPC no decide nada. (Si Dirección prefiriera un único flip `imported→scoreado`, requeriría un ADR que **enmiende formalmente INV-PR-1** — se eligió el camino legal completo para no tocar el Blueprint.)

### 5.2 Obtención de los `prospect_id` (corrección crítica)

`prospeccion_ingest` devuelve **solo `{inserted, duplicates}`** (no ids) y no se puede modificar. Por eso el paso 2 **no depende del retorno del ingest**: la calificación re-deriva los prospectos objetivo de forma **idempotente** leyendo los eventos `prospect.imported` recién emitidos al Outbox (que llevan `aggregate_id = prospect_id` + el `raw`), o equivalentemente consultando los prospectos en `status='imported'` sin score vigente. Esto desacopla F2 del contrato de retorno de F0 y hace el re-qualify reintentable.

---

## 6. Modelo de datos (aditivo, append-only)

**Migración nueva `0106_prospeccion_qualification.sql`** (0103/0104/0105 ya están ocupadas por `recon`; **verificar el siguiente número libre al implementar**). Rollback `ROLLBACK_0106.sql`. **No modifica `prospeccion_prospects`** (F0-frozen); solo su `status` avanza `imported→enriquecido→scoreado` **dentro de la RPC DEFINER**.

**(1) `prospeccion_enrichment`** *(nombre alineado al catálogo §1.1 del Blueprint; en v1 `evidence_source='csv'`)* — el snapshot de evidencia que satisface INV-PR-3:
`id`, `prospect_id` (FK→prospects, cascade), `profile_version int`, `evidence_source text default 'csv'`, `source_event_id uuid` (del `prospect.imported`, trazabilidad/idempotencia). **Firmográficos promovidos a columnas tipadas (ADR-012/DG-1):** `industry`, `industry_normalized`, `employee_band`, `employees_raw int`, `revenue_band`, `country`, `is_argentina bool`, `is_b2b bool`, `has_depositos bool`, `has_import_export bool`, `has_distribucion_nacional bool`, `has_cds bool`, `terceriza_almacenamiento bool`, `dentro_mercado_objetivo bool`, `growth_signal text`. `profile_raw jsonb` (subset firmográfico crudo + qué claves de `raw` mapearon, con envelope `schema_version` DG-5). `created_at`, `created_by`.

**(2) `prospeccion_scores`** — las **tres métricas** (A1/A2/A3) + decisión + explicación auditable:
`id`, `prospect_id` (FK), `enrichment_id` (FK→prospeccion_enrichment), `score int CHECK 0..100` (Lead Score), **`confidence int CHECK 0..100`** (A2, métrica independiente), **`priority_tier text CHECK in ('alta','media','baja')`** + **`priority_value numeric`** (A3, ordenable), `decision text CHECK in ('import','review','discard')`, **`factors jsonb`** (A1 — auditoría COMPLETA: por dimensión ICP `{raw, weighted}` + los inputs del perfil que la alimentaron), `penalties jsonb` (código/puntos/motivo), `hard_fails jsonb`, `explanation text` (A6 — cubre aprobación Y rechazo), **`business_unit text`** (A4, ej. 'general'), `model_version text` ('qual-v1'), `strategy_id text` ('csv-evidence-v1'), `icp_config_version text`, `confidence_version text`, **`decision_trace jsonb`** (A7 — envelope completo del recorrido, ver abajo), `source_event_id uuid`, `created_at`, `created_by`.
> **A1+A7 · `decision_trace` jsonb** consolida la auditoría completa en un envelope estructurado y reconstruible: `{ icp_config_version, business_unit, model_version, strategy_id, confidence_version, profile_inputs, factors:{dim:{raw,weighted}}, penalties[], hard_fails[], score, confidence, priority:{tier,value}, decision, explanation }`. **No se crea tabla nueva** (directiva A7). Las columnas tipadas (`score`/`confidence`/`priority_*`/`decision`/`business_unit`) se mantienen para query/dashboard/filtros; el `decision_trace` es la verdad auditable de cómo se llegó a ellas. El dashboard/bandeja leen `score`, `confidence` y `priority_*` como **columnas separadas**.

**Append-only (R-7.2.2):** re-cálculo = **nueva fila** (mayor `created_at`); nunca `UPDATE` de score/factors; sin `updated_at` ni touch trigger. Vigente = última por `prospect_id`. **Vista `prospeccion_scores_current`** = `SELECT DISTINCT ON (prospect_id) … ORDER BY prospect_id, created_at DESC` (sin flag `superseded`).

**RLS (reconciliado con R-7.5.6):** `enable RLS`; `select = has_permission('prospeccion.view')`. La **escritura va por la RPC DEFINER** `prospeccion_record_qualification` (atómica: enrichment + scores + flips de status), cuyo **borde (la server action) exige el RBAC de escritura** (`prospeccion.create`/`edit`) — así "insert by write permission" (R-7.5.6) se cumple **en el borde**, no por una policy de INSERT de sesión (mismo patrón que `prospeccion_ingest`). `delete = is_admin()`.

**Dashboard:** read model sobre `prospeccion_scores_current JOIN prospeccion_enrichment`, `GROUP BY decision, industry_normalized` (importados≥80 / revisión 60-79 / descartados<60 / avg score / by industry). **No** usa `prospeccion_metrics` (eso es F6); no materializado en v1.

---

## 7. ICP como política versionada (Directiva D-5)

El ICP vive como **objeto config tipado y tunable** en `domain/icp-config.ts`, validado por **Zod con refine Σpesos=100** (+ test espejo), **NO hardcodeado** en el scorer. `scoreProfile`/`decide` **reciben** la config como parámetro (puras, inyectables): cambiar pesos no toca la matemática.

```ts
export type BusinessUnit = 'general' | 'anmat' | 'cargas_generales' | 'fulfillment' | 'cross_dock' | 'ultima_milla';

export interface IcpConfig {
  businessUnit: BusinessUnit;         // A4 — a qué unidad de negocio aplica esta variante
  version: string;                    // 'general-v1' — versionada INDEPENDIENTE por unidad; se graba en cada score
  weights: { industria; tamano; actividadLogistica; presenciaArgentina; potencialEconomico; crecimiento };
  thresholds: { import: number; review: number };           // 80 / 60
  idealProfile: { b2b; depositos; importExport; distribucionNacional; centrosDistribucion; pallets; tercerizaAlmacenamiento; mercadoObjetivoTops: string[] };
  penalties: ReadonlyArray<{ code: string; when: string; points: number }>;
  keywordMaps: Record<string, string[]>;                    // depósitos/import-export/CDs/tercerización → señales blandas
}

// A4 — registro de variantes ICP por unidad de negocio, cada una con su propia versión/evolución
export type IcpRegistry = Record<BusinessUnit, IcpConfig>;
export const DEFAULT_ICP_REGISTRY: IcpRegistry; // v1 construye 'general'; ANMAT/Cargas/Fulfillment/CrossDock/ÚltimaMilla quedan como variantes declaradas, afinables luego
export function selectIcp(reg: IcpRegistry, bu: BusinessUnit = 'general'): IcpConfig;
```

**A4 · ICP multi-variante por unidad de negocio:** el ICP es un **registro de políticas** (`businessUnit → IcpConfig`), cada una **versionada independientemente** (`general-v1`, `anmat-v1`, …). En v1 se califica contra `general` por defecto; la selección por variante (o score-contra-mejor-variante) es una extensión reservada. Cada `prospeccion_scores` graba `business_unit` + `icp_config_version` usados, así una empresa puede re-scorearse contra otra unidad de negocio sin perder la trazabilidad de la anterior (append-only).

**Tres niveles de versionado/tuning sin recompilar la math:**
- (a) **v1**: la política se carga de un módulo TS versionado; cambio = PR + ADR ligero → auditoría en git.
- (b) **Extension point (reservado, no construido)**: tabla aditiva `prospeccion_icp_configs` (`business_unit`, `version`, `config jsonb`, `active bool`) — **una fila activa por unidad de negocio** (A4) para que **Dirección ajuste pesos por variante sin deploy**; el read model elige la activa de la unidad y la inyecta a `qualify()`.
- (c) **Trazabilidad**: `icp_config_version` se graba en cada fila de `prospeccion_scores` → cada score es reproducible y explicable con qué pesos se calculó; re-score tras tuning = filas append-only nuevas.

---

## 8. APIs / interfaces de costura

```ts
// Dominio (puro, client-safe)
interface CompanyProfile { industry; industryNormalized; employeesRaw; employeeBand:'XS'|'S'|'M'|'L'|'XL'|null; revenueBand; country; isArgentina; isB2B; hasDepositos; hasImportExport; hasDistribucionNacional; hasCds; tercerizaAlmacenamiento; dentroMercadoObjetivo; growthSignal:'none'|'low'|'mid'|'high'; evidenceSource:'csv'; profileRaw }
type Decision = 'import' | 'review' | 'discard';
interface ScoreFactor { raw: number; weighted: number }
interface ScoreFactors { industria; tamano; actividadLogistica; presenciaArgentina; potencialEconomico; crecimiento } // cada uno ScoreFactor
type PriorityTier = 'alta' | 'media' | 'baja';
interface QualificationResult {
  profile; score;                                  // Lead Score (A1: factors auditables)
  confidence: number;                              // A2 — métrica independiente 0..100
  priority: { tier: PriorityTier; value: number }; // A3 — tercera dimensión
  factors; penalties; decision; hardFails;
  explanation;                                     // A6 — cubre import/review/discard
  businessUnit; modelVersion; icpConfigVersion; confidenceVersion;
}

// Funciones puras (la math) — las tres métricas son funciones SEPARADAS
function buildCompanyProfile(raw, icp): Result<CompanyProfile>;
function scoreProfile(profile, icp): { score; factors; penalties };   // Lead Score (calidad)
function computeConfidence(profile): number;                          // A2 — confianza (completitud de evidencia)
function decide(score, profile, icp): { decision; hardFails };
function computePriority(score, confidence, profile, icp): { tier: PriorityTier; value: number }; // A3
function explain(profile, factors, penalties, decision): string;     // A6 — explica también el rechazo
function buildDecisionTrace(result: QualificationResult): DecisionTrace; // A7 — envelope reconstruible (se persiste en prospeccion_scores.decision_trace)
function qualify(raw, icp): Result<QualificationResult>;              // fachada (ScoringStrategy.qualify): compone las anteriores

// A7 — Decision Trace: registro completo del recorrido hasta la decisión (no es métrica; es auditoría)
interface DecisionTrace {
  icpConfigVersion; businessUnit; modelVersion; strategyId; confidenceVersion;
  profileInputs: Record<string, unknown>;                 // los firmográficos que entraron al cómputo
  factors: ScoreFactors; penalties; hardFails: string[];
  score: number; confidence: number; priority: { tier: PriorityTier; value: number };
  decision: Decision; explanation: string;
}

// Ports driven (la aplicación depende solo de estas)
interface ProspectReaderPort { loadPendingByIds(ids): Promise<Result<{id; raw}[]>>; } // o por eventos prospect.imported
interface QualificationWritePort { record(rows: {prospectId; profile; result}[]): Promise<Result<{persisted}>>; }

// EXTENSION POINTS — declarados, SIN adapter en v1 (Directiva D-7)
interface EnrichmentPort   { enrich(profile: CompanyProfile): Promise<Result<CompanyProfile>>; } // perfil más rico; scoreProfile NO cambia
interface AINarrativePort  { narrate(result: QualificationResult): Promise<Result<string>>; }    // enriquece narrativa; NUNCA decide score
interface CrmSyncPort      { requestSync(prospectId: string): Promise<Result<void>>; }           // F3: solo tras prospeccion.approve (INV-PR-2)
```

**Server action** `qualifyAndImportAction` (composition root, RBAC + service_role): paso1 import F0 → paso2 recalcula `qualify()` + `QualificationWritePort.record()`. **RPC** `prospeccion_record_qualification(p_rows jsonb)`: INSERT append-only en enrichment+scores + flips `imported→enriquecido→scoreado` (mecánica).

---

## 9. UI + Dashboard (cero lógica de negocio en React)

La math vive en `domain/` (client-safe) y se **importa** vía un barrel `index.client.ts` (frontera anti-import-de-supabase); no se reimplementa.
- **Preview de import (el diferenciador):** columnas **Lead Score (0-100)** + estrellas, **Confidence** (A2, badge/anillo independiente), **Prioridad** (A3, tier alta/media/baja), **decisión proyectada** (Importar/Revisar/Descartar como badge) y **explicación** (tooltip/expandible, A6 — también el motivo del descarte). Las tres métricas se muestran **separadas**, nunca fusionadas. Instantáneo, sin backend. Memoización por fila para lotes grandes.
- **Bandeja (`ProspeccionView`):** columnas Lead Score + decisión junto al Estado CC-7 (`scoreado`='Calificado'); filas `imported` sin score muestran "Pendiente de calificación" (cubre la ventana del commit en 2 pasos).
- **Filtros (server-side, query params al read model):** por rango de **score**, **confidence**, **prioridad** (tier), **unidad de negocio** (A4), decisión, `industry_normalized`, compatibilidad (`dentro_mercado_objetivo`), estado CC-7. Ordenable por las tres métricas por separado.
- **Dashboard (`QualificationDashboard`, server-rendered):** tarjetas importados/revisión/descartados, avg score, mini-breakdown by-industry. Sin librería de charts, sin realtime en v1.

---

## 10. Qualification Feedback Loop (Directiva D-6 — diseñado, NO implementado)

El motor v1 predice (score/decisión). El **Feedback Loop** captura el **resultado comercial real** para recalibrar el modelo en versiones futuras, cerrando el ciclo *predicción → resultado → recalibración*.

**Señales de resultado (outcomes), por prospecto, vía `prospeccion_crm_refs` → Clientify/Facturación:**
- **Conversión comercial:** estado del deal en Clientify (ganado/perdido, etapa, motivo de pérdida) — datos ya disponibles en el dominio CRM existente (`clientify_deals_cache`, `crm_*`).
- **Facturación:** monto facturado real del cliente (módulo de Facturación de Nexus).
- **Rentabilidad:** margen/rentabilidad real (cuando el dato exista).

**Diseño (extension point, no construido):**
- Tabla aditiva append-only **`prospeccion_qualification_outcomes`** (A5 — esquema enriquecido): `id`, `prospect_id` (FK), `score_id` (FK→prospeccion_scores que se evalúa), `crm_deal_id`, `outcome text` ('won'|'lost'|'open'), `lost_reason text`, `revenue_real numeric`, `margin_real numeric` (**margen**), `tenure_months int` (**permanencia**), `recurrence_count int` (**recurrencia**), `growth_pct numeric` (**crecimiento**), `nps int` (**NPS**), `observed_at`, `source text` ('clientify'|'facturacion'|'encuesta'). Poblada por un **job/consumer** que cruza `crm_refs` con deals/facturación/encuestas (reusa la infra de sync existente).
- **`FeedbackSourcePort`** (reservado): abstrae de dónde vienen los outcomes (Clientify, Facturación) — agnóstico de proveedor.
- **Recalibración (futura, fuera de v1):** un proceso compara **decisión/score predicho vs outcome real** (matriz de confusión: ¿los ≥80 efectivamente convirtieron? ¿algún <60 convirtió → falso negativo?) y propone ajustes a los **pesos del ICP** (que ya son política versionada §7) — recalibración **asistida y aprobada por Dirección**, no automática. Cada recalibración = nueva `icp_config_version` → re-score append-only → comparabilidad histórica.

> v1 solo **reserva** el esquema y los ports. No captura outcomes todavía (depende de que F3 sincronice a Clientify y de la integración con Facturación). Documentado en **ADR-F2-06**.

---

## 11. Agnóstico de proveedor (Directiva D-7)

- **Enrichment:** `EnrichmentPort` (un perfil más rico) — sin adapter en v1. Cuando se contrate proveedor (Apollo API/PDL/Firecrawl/MCP enrich-business), se agrega un adapter en `adapters/enrichment/` detrás del port (ACL: el dominio nunca ve el JSON del proveedor). `scoreProfile` no cambia.
- **IA:** `AINarrativePort` — sin adapter en v1. Alinea con el AI Provider Manager del Blueprint (registry `providerId→adapter`, OpenAI/Claude/Gemini por env, **nunca decide el score** — solo enriquece la narrativa; salida validada por Zod, defensa anti-prompt-injection, limiter de presupuesto DB-persistido cuando se construya en F4).
- **CRM:** `CrmSyncPort` — F3, agnóstico (Clientify/HubSpot/Salesforce), solo tras `prospeccion.approve`.

### 11.1 Regla de dependencia (A8 — vinculante, enforced)

El **Decision Engine y todo el dominio `qualification` NUNCA dependen directamente de un proveedor** de IA o enrichment. La única dependencia permitida es vía **ports**. Cadena válida:

`DecisionEngine → ScoringStrategy → EnrichmentPort → AINarrativePort`

**Prohibido** dentro de `src/lib/prospeccion/qualification/**`: cualquier import directo a `openai`, `@anthropic-ai/*`, `@google/generative-ai`, `@google-cloud/*`, o cualquier SDK/cliente de proveedor concreto. Los adapters de proveedor (cuando existan) viven **fuera del dominio**, detrás de los ports, en `adapters/` con ACL (el dominio nunca ve el JSON del proveedor).

**Enforcement (mecánico, no aspiracional)** — mismo patrón que AP-UDIE-1 de F1: (1) zona ESLint `no-restricted-imports` que prohíbe esos paquetes en `qualification/**`; (2) un **grep/test de frontera** en CI que falla si aparece un import de proveedor en el dominio; (3) un **test de pureza** que verifica que `qualification/domain/**` no importa `supabase`/`next/server`/SDKs (protege además el isomorfismo cliente/servidor). El Decision Engine debe permanecer 100% desacoplado y testeable sin red. (ADR-F2-12)

---

## 12. Estrategia de testing

Todo vitest puro (sin red ni base), patrón `commercial-score.ts` + VOs de F0:
- **Invariante de config:** `Σpesos DEFAULT_ICP_V1 === 100` (+ Zod refine).
- **Por función pura:** `company-profiler` (variantes Apollo/Sales Navigator → perfil; señales blandas por keyword; bandas por umbral; raw sin firmográficos → `unknown` sin crash); `scoring-policy` (cada dimensión aporta su peso; clamp 0..100; penalties restan); `decision-policy` (límites exactos 79/80 y 59/60; hardFails fuerzan discard); `explanation` (string exacto + determinismo).
- **Determinismo/transparencia referencial:** `qualify(raw,icp)` N veces ⇒ idéntico (contrato que garantiza preview==persistencia).
- **Frontera client-safe:** test/lint de que `qualification/domain` no importa `supabase`/`next/server`.
- **Snapshot de regresión de scoring:** set congelado inputs→scores para detectar drift al tunear.
- **Tres métricas separadas (A2/A3):** `computeConfidence` (perfil completo→alta confianza; perfil con muchos `unknown`→baja); `computePriority` (orden correcto por score×confidence×señales); test de que score/confidence/priority **no covarían trivialmente** (un lead alto con poca evidencia → score alto, confidence bajo).
- **ICP multi-variante (A4):** misma empresa scoreada contra `general` vs `anmat` da factores/score acordes a cada variante; `selectIcp` default `general`; cada variante valida Σpesos=100.
- **Explicación de rechazo (A6):** un caso `discard` produce explicación no vacía que **nombra los factores/penalties/hardFails** responsables; determinista.
- **Auditoría total (A1):** desde `factors`+`penalties`+`hardFails` persistidos se puede **recomputar** el score (test de reconstrucción).
- **Decision Trace (A7):** `buildDecisionTrace(result)` contiene todos los campos del recorrido y permite reconstruir score+decisión; round-trip determinista.
- **Regla de dependencia (A8):** test/grep de frontera que falla si `qualification/**` importa `openai`/`@anthropic-ai`/`@google/*`/SDK de proveedor, o `supabase`/`next/server` en el dominio (pureza + desacople).
- **Golden fixtures ICP (tramos × verticales):** EXCELENTE (≥80: industrial B2B, 500 empleados, 3 CDs, import/export, terceriza, AR ⇒ ~92); DUDOSO (60-79: servicios B2B medianos, señal logística parcial); RECHAZADO (<60: B2C puro / fuera de mercado → hardFail). Verticales: industrial / retail / servicios / logística-3PL / incompatible.
- **Use-case** con fakes de los ports: orquestación + idempotencia del re-qualify (re-correr no duplica vigente; append produce nueva fila; `scores_current` toma la última).
- **Read model:** degrada a muestra sin Supabase (AP-10); agrega bien por decisión/industria.

---

## 13. ADRs (aditivos al ledger del Blueprint; namespace `ADR-F2-` para evitar colisión con ADR-001..020 existentes)

- **ADR-F2-01 — Qualification v1 sobre evidencia CSV** (fusión consciente de F2-enrich/F3-score/F4-IA en una fase shippable). *Decisión:* calificar sobre los firmográficos del CSV; el `CompanyProfile`-CSV es el snapshot de evidencia (`prospeccion_enrichment.evidence_source='csv'`) que satisface INV-PR-3. *Justificación:* no hay API de enrichment contratada; Apollo/Sales Navigator ya cargan los firmográficos. *Consecuencias:* señales blandas limitadas a lo que exporte el CSV; el enrichment externo es una mejora aditiva detrás de `EnrichmentPort`, sin refactor (D-4). **No invalida el Blueprint**: lo extiende.
- **ADR-F2-02 — Scoring isomorfo puro + persistencia autoritativa en 2 pasos** (no async-first en v1). *Consecuencia:* ventana de inconsistencia (prospecto `imported` sin score si falla el paso 2) → mitigada por idempotencia + estado UI "Pendiente de calificación" + re-qualify.
- **ADR-F2-03 — 2 tablas append-only** (`prospeccion_enrichment` separado de `prospeccion_scores`), no fusión; nombres alineados al catálogo §1.1; transición legal `imported→enriquecido→scoreado` (INV-PR-1) dentro de la RPC DEFINER mecánica (CS-RPC-2/ADR-017).
- **ADR-F2-04 — `ScoringStrategy` como interface** (D-4): v1 `csv-evidence`; la variante enrichment-fed es otra impl; `scoreProfile/decide/explain` invariantes.
- **ADR-F2-05 — ICP como política versionada** (D-5): config tipada/inyectable + `icp_config_version` grabado por score + tabla `prospeccion_icp_configs` reservada.
- **ADR-F2-06 — Qualification Feedback Loop** (D-6): esquema + ports reservados (`prospeccion_qualification_outcomes`, `FeedbackSourcePort`); recalibración asistida por Dirección, no automática; no construido en v1.
- **ADR-F2-07 — Ports agnósticos de proveedor** (D-7): `EnrichmentPort`/`AINarrativePort`/`CrmSyncPort` declarados sin adapter; ACL obligatoria al integrarlos (ADR-008).
- **ADR-F2-08 — Modelo de TRES métricas independientes** (A2/A3): `score` (Lead Score = calidad), `confidence` (confianza del modelo = completitud de evidencia) y `priority` (prioridad comercial = orden de trabajo) son funciones puras y columnas **separadas**; nunca se asumen equivalentes. *Consecuencia:* la UI y los filtros las muestran/ordenan por separado; `computeConfidence`/`computePriority` se versionan junto al `model_version`.
- **ADR-F2-09 — ICP multi-variante por unidad de negocio** (A4): el ICP es un `IcpRegistry` (`businessUnit → IcpConfig`) versionado independientemente (general/anmat/cargas_generales/fulfillment/cross_dock/ultima_milla). v1 califica contra `general`; `prospeccion_scores` graba `business_unit`+`icp_config_version`. *Consecuencia:* re-score contra otra unidad = filas append-only nuevas, sin perder histórico; selección automática de variante = extensión futura.
- **ADR-F2-10 — Auditoría total + explicación de rechazos** (A1/A6): cada score persiste el breakdown completo (factores+penalties+hardFails+inputs+versiones) → decisión reconstruible; `explain()` cubre las tres decisiones, **incluido el porqué del descarte**. *Consecuencia:* `factors` jsonb es contrato auditable estable; los tests aseguran explicación no vacía y determinista para import/review/discard.
- **ADR-F2-11 — Decision Trace como envelope jsonb (sin tabla nueva)** (A7): el recorrido completo de la decisión se persiste como `prospeccion_scores.decision_trace jsonb` (consolidando A1), no en una tabla aparte. *Decisión:* `buildDecisionTrace(result)` produce un envelope reconstruible; las columnas tipadas se mantienen para query. *Consecuencia:* una sola fila reconstruye la decisión; el envelope se versiona junto al `model_version`; test de reconstrucción (trace → score).
- **ADR-F2-12 — Decision Engine desacoplado de proveedores (regla de dependencia vinculante)** (A8): el dominio `qualification` solo depende de ports (`ScoringStrategy`/`EnrichmentPort`/`AINarrativePort`/`CrmSyncPort`), nunca de un SDK de proveedor. *Enforcement:* zona ESLint `no-restricted-imports` + grep/test de frontera en CI + test de pureza (sin supabase/next/SDKs en el dominio). *Consecuencia:* el motor es testeable sin red y los proveedores se cambian sin tocar el núcleo.

---

## 14. Roadmap

1. **F2 v1 (esta fase, tras aprobación):** profiler + ScoringStrategy CSV + decisión + explicación determinística + persistencia (mig 0106) + preview/bandeja/dashboard + tests. **Sin enrichment externo, sin IA-LLM, sin sync Clientify.**
2. **F2.5 — Enrichment externo:** adapter detrás de `EnrichmentPort` (proveedor + ADR + key + limiter de costo); `enrichedStrategy` (misma interface). Mejora el perfil; el scoring no cambia.
3. **F3 — Sync Clientify de aprobados (≥80 + `aprobado`):** gate de **aprobación humana** (INV-PR-2). **Prerrequisito:** `prospeccion.approve` **no existe** en `permission_action_t` → requiere **extender el enum** (patrón 2-migraciones tipo 0086/0087) o reutilizar `sign`/`admin`; `CrmSyncPort`→`ClientifyCrmAdapter` (write-path por ACL).
4. **F4 — IA narrativa:** `AINarrativePort` + AI Provider Manager (OpenAI/Claude/…); enriquece la explicación, nunca el score.
5. **F6 — Métricas + recalibración:** poblar `prospeccion_qualification_outcomes` (conversión/facturación/rentabilidad) + proceso de recalibración del ICP asistido por Dirección (cierra el Feedback Loop).

---

## 15. Plan de despliegue

- **Rama nueva** `feat/prospeccion-f2-qualification` **desde `main`** (worktree aislado, como F1). **No tocar** la rama F1 ni el PR #42.
- **Migración aditiva 0106** (verificar siguiente libre) — **G3 (apply a prod) lo hace Martín a mano**, como toda migración; idempotente + rollback.
- **Gates antes de "listo":** typecheck 0 · vitest verde · `next build` · boundaries (la frontera client-safe del dominio qualification) · `udie-boundary` sigue OK (F2 no toca udie).
- **Sin merge, sin deploy, sin escritura en prod.** PR para revisión; el merge/deploy son decisión de Dirección.
- **Implementación gateada:** writing-plans → TDD subagent-driven (como F1) → PR → Release Report. **No arranca hasta tu OK del diseño.**

---

## 16. Respuesta a las críticas adversariales (todos los hallazgos resueltos)

| Hallazgo (crítica) | Resolución en este diseño |
|---|---|
| **INV-PR-1**: el diseño saltaba `imported→scoreado` (ilegal) | §5.1: transición legal `imported→enriquecido→scoreado` (dos flips); el perfil-CSV es el snapshot `enriquecido`. |
| Transición debe nacer del AR / RPC mecánica (CS-RPC-2) | §5.1/§6: la RPC `prospeccion_record_qualification` persiste un snapshot **pre-validado en TS** y hace los flips mecánicamente (sin lógica de negocio en SQL, ADR-017). |
| `prospeccion_ingest` **no devuelve ids** | §5.2: el paso 2 re-deriva los prospectos vía Outbox `prospect.imported` / query `imported` sin score (idempotente); no depende del retorno del ingest. |
| Migración **0103 ocupada** (recon) | §6: usar **0106** (verificar libre al implementar). |
| ADR **018/019 ya existen** en el Blueprint | §13: renumerados a **ADR-F2-01..07** (namespace propio). |
| Nombre de tabla vs catálogo §1.1 (`prospeccion_enrichment`) | §6: tabla de perfil renombrada a **`prospeccion_enrichment`** (`evidence_source='csv'`). |
| RLS write vs R-7.5.6 ("insert by write permission") | §6: escritura por **RPC DEFINER** gateada por el RBAC del borde (`prospeccion.create/edit`) — cumple R-7.5.6 en el borde, mismo patrón que `prospeccion_ingest`. |
| `prospeccion.approve` no es un seed plano | §14 (F3): requiere **extender `permission_action_t`** (2-migraciones) o reutilizar `sign`/`admin`. Corregido en el handoff de F3. |

---

## 17. Self-Review crítico

- **¿Qué podría estar mal en 2 años?** El scoring por keyword sobre el CSV es un proxy; su techo de calidad lo fija lo que Apollo/Sales Navigator exporten. Mitigación diseñada: `EnrichmentPort` + `ScoringStrategy` permiten subir de calidad sin refactor, y el Feedback Loop permite recalibrar con datos reales. Riesgo: si los pesos del ICP no reflejan el ICP real de Dirección, el filtro de Clientify será subóptimo hasta validar/recalibrar.
- **¿Qué simplificar?** El commit en 2 pasos (no atómico) es la mayor complejidad. Si la inconsistencia ocasional molesta, F3 podría mover la calificación a un consumer async del Outbox (Arquitectura B, ya reservada) — un cambio aditivo, no un rediseño.
- **¿Qué mantener deliberadamente chico?** El dominio `qualification` debe permanecer **puro y client-safe** (cero I/O), y la math (scoreProfile/decide/explain) **invariante** ante el origen del perfil. Toda complejidad de proveedor (enrichment/IA/CRM) vive detrás de ports, fuera del núcleo.
- **¿Riesgo de framework sobreingenierizado?** El Feedback Loop y los ports reservados son **esquema + interfaces**, no maquinaria. Regla: no construir adapters de enrichment/IA/feedback hasta que exista la necesidad real (proveedor contratado / F3 sync vivo). v1 = puro + 2 tablas + 1 RPC + UI.

---

## 18. Criterio de aprobación

Esta fase de **diseño** se cierra cuando Dirección apruebe: arquitectura (Isomorphic Pure ScoringStrategy), modelo de datos (2 tablas append-only, mig 0106), APIs/ports, ICP versionado, Feedback Loop, ports agnósticos, ADR-F2-01..07, roadmap y plan de despliegue — **con todos los hallazgos adversariales incorporados**. **Recién tras tu OK explícito** se habilita `writing-plans` → TDD → rama → PR (sin merge/deploy). **F1 permanece congelada.**
