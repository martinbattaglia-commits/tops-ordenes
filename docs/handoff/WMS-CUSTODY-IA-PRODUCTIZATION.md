# WMS · Custodia Digital e Integridad IA — Candidato de productización

> **Expediente:** NEXUS-WMS-CUSTODY-IA-RECOVERY-001
> **Rama:** `feat/wms-custody-ia-productization` · **Base:** `a6119bd` / tree `d290bb00`
> **Fuente histórica read-only:** commit `b6452a8` (PoC 14–15 jun 2026) — **NO deployable**
> **Estado:** candidato PRE-C4, **REVISIÓN 7** tras el C4 independiente (remediación 6).
>
> ⚠️ **Este árbol NO es deployable y NO constituye enforcement productivo.** Es un
> núcleo de dominio probado, con adaptadores en memoria. Nada de esto corre contra
> Supabase, sesión real, RBAC real ni IA real.

---

## 1. Estado por hallazgo — vocabulario honesto

`RESUELTO` = probado en este candidato · `PARCIAL` = sólo contrato de dominio ·
`PENDIENTE` = requiere DB, RPC, UI o migración.

| # | Hallazgo | Estado | Evidencia / límite |
|---|---|---|---|
| **C-1** | `chainValid` hardcodeado; `verify_custody_chain` nunca invocada | **RESUELTO** | `chain.ts`. `verified` exige `valid=true` **+** `events_checked` entero > 0 **+** vinculación evidencia↔eventos. Con la RPC actual el resultado es **siempre `unverifiable`** — fail-closed deliberado (§3.4) |
| **C-2** | fallback demo en runtime; `cached` no persistido | **RESUELTO** (dominio) | `provider.ts`: el adaptador entrega payload crudo; la procedencia la construye el caso de uso contra una **allowlist server-side**. Un adaptador que se declare `real` sin estar en la lista queda `mock`. Persistencia: **PENDIENTE** (DB) |
| **C-3** | sin umbral, hold, alerta ni decisión humana | **PARCIAL** | `decision.ts`, `release-policy.ts`, `human-decision.ts` completos y probados. El **enforcement** en reserva/picking/packing/carga/despacho es **PENDIENTE** (RPC) |
| **A-1** | escritura `service_role` sin authz | **PARCIAL** | El caso de uso sólo conoce puertos y no puede construir un cliente privilegiado. Pero el **adaptador real de sesión/RBAC (`ActorAuthorizationPort`) no existe**: sin él no hay frontera efectiva |
| **A-2** | sin captura obligatoria de foto de egreso | **PARCIAL** | Validación completa (orden, frescura, unicidad, etapa). La captura UI es **PENDIENTE** |
| **A-3** | sin etapa de ingreso en el modelo | **PENDIENTE** | Requiere migración de enum + CHECK (§3.1) |
| **A-4** | cero tests | **RESUELTO** | **198 tests** deterministas y adversariales |
| **M-1** | confianza del modelo como «nivel de coincidencia %» | **RESUELTO** | `formatModelConfidence()` + validación `finito ∈ [0,1]` |

### La regla que gobierna el módulo

`deriveIntegrityCaseState` devuelve `DerivableCaseState`: un estado terminal **no es
expresable**. `RELEASED`/`QUARANTINED` sólo existen vía `applyHumanDecision`, que sólo
acepta un `VerifiedActor` — un tipo que únicamente produce el puerto de autorización.
La regla humano–IA dejó de ser una comprobación saltable y pasó a ser la forma del tipo.

Y aun con todo en orden, un caso impecable termina en `REVIEW_REQUIRED` con motivo
`NO_CALIBRATED_THRESHOLD`: **no hay umbral calibrado**, y liberar automáticamente sobre
una magnitud sin definición sería inventar la regla de negocio.

---

## 2. Superficie

```
src/lib/custody/integrity/
  types.ts               estados, actor verificado, comando, procedencia
  validation.ts          validadores de runtime (sha256, ISO, finitud, ventanas)
  evidence.ts            validación del par cargado por puerto
  chain.ts               verificación real + vinculación evidencia↔cadena
  provider.ts            puerto + allowlist de modo real + normalización del payload
  decision.ts            máquina derivable + predicado de hold
  release-policy.ts      política conservadora de liberación
  human-decision.ts      única vía a un estado terminal
  certificate-policy.ts  certificado vs acta
  flags.ts               4 flags, todos OFF por defecto
  sealed.ts              artefactos sellados por el dominio (WeakMap privado)
  canonical.ts           CONSTRUCTORES CANÓNICOS: único camino a un outcome/proof
  snapshot.ts            clonado + congelado PROFUNDO, explícito por tipo
  provider-registry.ts   identidad de proveedor POR INSTANCIA
  ports.ts               CONTRATOS: repositorio con CAS, loader, autorización, chain head
  in-memory-repository.ts  adaptador de sandbox (revalida todo, snapshots congelados)
  test-doubles.ts        proveedores sintéticos — FUERA del barrel público
  use-cases.ts           evaluar / decidir
  index.ts               API pública acotada
src/lib/wms-custody-ia-integrity.test.ts   198 tests
docs/handoff/WMS-CUSTODY-IA-0221-DESIGN.sql  diseño SQL (NO es migración)
```

Sin tocar `Sidebar.tsx`, navegación, `package.json`, lockfiles, clientes Supabase
compartidos, tipos generados, `.env`, CI, `vitest.config.ts` ni el DB harness.
`supabase/migrations/` **byte-idéntico a la base** (182 `.sql`).

**Excluido del candidato:** `.claude/launch.json` · `docs/demo-mercadolibre/**` · seeds de
demo · documentos `CONNECT-*` · `demo-photo.ts` · `DEMO_VERDICTS` · archivos
WhatsApp/Connect · identidad MercadoLibre · migraciones históricas · adaptador OpenAI.

---

## 3. Diseño SQL — `DESIGN ONLY / NOT EXECUTABLE / NOT READY FOR LEASE`

SQL completo en [`WMS-CUSTODY-IA-0221-DESIGN.sql`](WMS-CUSTODY-IA-0221-DESIGN.sql).
**No está en `supabase/migrations/` y no debe copiarse allí** hasta resolver SCR-WMS-001 (§7).

**Vocabulario:** el dominio dice `clientId`; en el esquema es `client_id → public.clients`
(identidad canónica de `0219`). **No existe `tenant_id`** — 0 ocurrencias en 182 migraciones.

### 3.1 Etapa de ingreso — dos migraciones
`ALTER TYPE … ADD VALUE` no puede consumirse en la transacción que lo crea. Patrón del
repo: `0021` (enum) → `0022` (uso). Migración A: `'recepcion'` en `custody_stage_t` y
`'foto_recepcion'` en `custody_event_type_t`. Migración B: ampliar el CHECK
`custody_events_stage_type_chk` de `0036`, que enumera pares permitidos.

### 3.2 Identidad y aislamiento
`client_id` **NOT NULL** en las tres tablas nuevas, derivado de la entidad **bajo lock**
(`packing_units|shipments → logistics_orders → client_id`), nunca del caller. Un
constraint trigger diferido exige que caso, decisión, entidad y evidencias compartan
`client_id`, y que las evidencias pertenezcan a la misma unidad física.

**Precondición fail-closed:** `logistics_orders.client_id` es anulable (0219 declara «SIN
BACKFILL»). Si el pedido no tiene cliente resuelto, el caso **no se crea**. No se inventa.

### 3.3 Decisión acreditada relacionalmente
`custody_integrity_cases.decision_id` es una **FK diferible** a
`custody_integrity_decisions`, con CHECK
`(state terminal) = (decision_id is not null)`. Rellenar `decided_at`/`decision_kind` ya no
alcanza: hace falta la **fila**. Las evidencias de inspección pasan a una **tabla puente
con FK** (`custody_integrity_inspection_evidence`), no `uuid[]` sin integridad.

### 3.4 Vinculación evidencia ↔ cadena — requisito abierto de la RPC
`verify_custody_chain` (0038) **no devuelve** los ids de evento recorridos, así que hoy no
se puede acreditar que las evidencias comparadas pertenezcan a la cadena verificada. El
dominio lo trata como `unverifiable`. La RPC futura debe devolver `verified_event_ids`.

### 3.5 RPC transaccional de decisión
`decide_custody_integrity(...)`: `auth.uid()` real · `coalesce(has_permission(...), false)` ·
`SELECT … FOR UPDATE` · CAS por estado **y** versión · INSERT append-only · UPDATE del caso ·
una sola decisión por caso · `search_path` fijo · `revoke` a `public`/`anon` · `grant` mínimo
a `authenticated`.

> 🔴 **Hallazgo de seguridad del esquema vigente.** `public.has_permission(text)` (`0009:164`)
> devuelve `exists(...) OR public.current_role() = 'admin'`. Con `current_role()` NULL la
> expresión es `false OR NULL` = **NULL**. Un guard `if not has_permission('x') then raise`
> evalúa `not NULL` = NULL, **no dispara, y la autorización pasa en silencio**. Todo guard de
> este diseño usa `coalesce(...)`. Corregir `has_permission` en sí mismo es decisión de
> Dirección: afecta a todo el repositorio.

### 3.6 Permiso — obliga a un par de migraciones
`permissions` tiene `unique (module, action)` (`0009:50`) y `permission_action_t` sólo admite
`view · create · edit · delete · sign · export · admin`. Un permiso WMS nuevo exige una acción
nueva vía `ALTER TYPE … ADD VALUE` (precedentes: `0164`, `0167`). El seed de
`wms.custody.decide` **no** puede ir en el mismo archivo.

### 3.7 Enforcement del hold
Guardas a incorporar en `allocate_order` (`0031`), picking (`0032`), packing (`0033`) y
despacho (`0035`). **No es aditivo**: cambia el comportamiento de funciones existentes, y por
eso queda fuera del núcleo. Patrón de referencia probado: la cuarentena de recepción bloquea
de hecho porque deja stock en `stock_reserved` y `allocate_order` sólo consume
`stock_available > 0` (`0031:105`).

---

## 4. Qué falta para que esto funcione

| Pieza | Bloqueante |
|---|---|
| `ActorAuthorizationPort` real (sesión + RBAC) | adaptador — sin él A-1 es PARCIAL |
| `EvidenceLoaderPort` sobre `custody_evidence` | adaptador + RLS |
| Adaptador Supabase del repositorio + RPC de decisión | migración |
| `verified_event_ids` en `verify_custody_chain` | migración/RPC |
| Enforcement del hold en las 4 RPC operativas | migración (no aditiva) |
| Etapa de ingreso | migración de enum |
| UI de recepción y validación | post-migración + flags |
| Adaptador real de visión | autorización de privacidad |
| Umbral y semántica | decisión de negocio |

---

## 5. Decisiones pendientes de Dirección

1. **¿Qué significa el umbral y cómo se calibra?** Sin esto no hay liberación automática legítima.
2. **¿Qué ocurre por encima del umbral?** ¿Libera solo o exige confirmación humana igual?
3. **¿Quién es el «encargado de turno»?** No existe como rol; `wms.custody.decide` está diseñado sin titular.
4. **¿Se autoriza enviar fotos a un proveedor externo?** Consentimiento, minimización, retención, DPA.
5. **¿Valor contractual del certificado?** Hoy todo PDF lleva `SANDBOX · DATOS SINTÉTICOS · SIN VALOR PROBATORIO`.
6. **¿Se corrige `has_permission` (§3.5)?** Afecta a todo el repositorio, no sólo a WMS.
7. **¿Se activa operativamente la cadena de custodia ya desplegada?** En producción tiene 0 filas.

---

## 6. Controles ejecutados

| Control | Resultado |
|---|---|
| Tests focalizados + adversariales | **198 / 198 PASS** (sin red, DB ni IA) |
| Typecheck — mis archivos | **0 errores** |
| Typecheck — repo fuera de `tests/db/` | **0 errores** |
| Typecheck — `tests/db/**` | 46 errores **de entorno**: el `node_modules` enlazado es el de la base anterior y no trae `pg`/`@types/pg`. No se instalaron dependencias ni se reparó nada ajeno |
| ESLint (alcance) | **0 warnings, 0 errores** |
| `lint:boundaries` · `lint:udie-boundary` | **PASS** |
| `git diff --check` | **PASS** |
| Secret scan del alcance | **sin secretos** |
| Suite completa / build global | **NO EJECUTADOS** — serializados para el gate final |
| DB harness | **NO APLICABLE** — sin migración aplicable (§7) |
| Llamadas externas de IA · mutaciones Supabase remotas | **NINGUNA** |
| `supabase/migrations/` | **byte-idéntico a la base** |

---

## 7. SHARED CHANGE REQUEST · SCR-WMS-001 (reescrito)

**El SCR anterior era incorrecto.** Proponía agregar `0221` al manifiesto subiendo
`EXPECTED_MANIFEST_SIZE` de 31 a 32. Eso no funciona:

- `custody_integrity_cases` referencia `custody_evidence`, que **nace en `0036`**;
- `0036–0039` están en `FROZEN_EXCLUDED_FILES`, es decir **no se aplican** en el harness;
- `0036` ejecuta `create extension postgis`;
- el harness levanta **PostgreSQL 17 vanilla, sin PostGIS** — por diseño explícito del manifiesto.

Agregar sólo `0221` produciría un fallo por dependencia ausente, no una prueba.

**Archivos:** `tests/db/harness/manifest.ts` · `tests/db/t-a0-10-manifest.test.ts`
**Estado:** **no modificados** en este candidato.

**Decisión requerida de Dirección — dos caminos excluyentes:**

**A · Harness con PostGIS dedicado para Custodia.** Provisionar un cluster con la extensión
(imagen Supabase o PostgreSQL + PostGIS) y un config propio, dejando intacto el harness
vanilla de P3-N1A0.
*Costo:* dependencia pesada nueva en el entorno de pruebas.
*Beneficio:* permite ejercitar la serie `0036–0039` completa, no sólo `0221`.

**B · Manifiesto de custodia separado con cierre real.** Un segundo manifiesto que incluya
`0036–0039` + dependencias, con exclusión o *stub* documentado de PostGIS (`custody_events.geom`
es una columna generada; su ausencia debería poder aislarse).
*Costo:* mantener dos universos de migraciones y justificar el stub.
*Beneficio:* sin dependencias externas nuevas.

**Prueba esperada tras la decisión:**
1. `t-a0-10-manifest.test.ts` en verde con la nueva clasificación.
2. Cluster efímero aplicando el cierre de custodia + `0221`.
3. `tests/db/t-wms-custody-integrity.test.ts` verificando sobre base limpia: el CHECK
   `terminal ⇒ decision_id`; el constraint trigger de coherencia caso↔decisión↔entidad↔cliente;
   el append-only de decisiones y de la tabla puente; el índice parcial de idempotencia; el CAS
   por versión en `decide_custody_integrity`; y RLS denegando escritura y lectura cross-client.

**Impacto si no se decide:** la persistencia consultable, el enforcement en motor y la RPC
transaccional no pueden implementarse. El módulo permanece con adaptadores en memoria.

---

## 8. Matriz de cierre R-1 … R-8

| Req | Qué exigía | Estado | Dónde |
|---|---|---|---|
| **R-1** | El caller no puede autocertificar identidad, permiso ni fecha | **RESUELTO** en dominio · **PARCIAL** en sistema (falta adaptador real) | `types.ts` (`VerifiedActor`, `DecisionCommand`), `human-decision.ts`, `ports.ts` |
| **R-2** | Transiciones seguras y concurrencia | **RESUELTO** en dominio | `recordAssessment` sólo acepta `DerivableCaseState` + guarda de runtime; `applyDecision` por CAS (versión + estado); `CASE_IDENTITY_MISMATCH` / `EVIDENCE_MISMATCH`; terminal no reevaluable |
| **R-3** | Política conservadora de liberación | **RESUELTO** | `release-policy.ts` — release exige que la única retención sea `NO_CALIBRATED_THRESHOLD` + 8 condiciones más. Cuarentena no sujeta |
| **R-4** | Evidencia, cadena y proveedor endurecidos | **RESUELTO** en dominio | `validation.ts`, `evidence.ts`, `chain.ts`, `provider.ts`. Vinculación evidencia↔cadena queda `unverifiable` con la RPC actual (§3.4) |
| **R-5** | Certificado bloqueado salvo todo cumplido | **RESUELTO** | `certificate-policy.ts` — `diferencias`, `posible_dano` y `null` siempre producen acta |
| **R-6** | Rediseño SQL | **CORREGIDO EN DISEÑO · NO VERIFICADO EN DB** | `WMS-CUSTODY-IA-0221-DESIGN.sql` — client_id NOT NULL bajo lock, FK diferible, constraint trigger, tabla puente, RLS `TO authenticated` + client_id, RPC CAS NULL-safe |
| **R-7** | Corregir el SCR | **RESUELTO** | §7 — SCR reescrito con el bloqueo real (PostGIS / 0036) y dos caminos |
| **R-8** | Tests adversariales + estados honestos | **RESUELTO** | 198 tests; §1 con vocabulario RESUELTO/PARCIAL/PENDIENTE |


---

## 9. Matriz de cierre F-1 … F-7 (remediación 2)

| Req | Corrección | Estado | Mutante que muere |
|---|---|---|---|
| **F-1** | Frontera de liberación: `holdReasons` debe ser **exactamente** `["NO_CALIBRATED_THRESHOLD"]` (`isExactSet`). Comando validado en runtime. El repositorio revalida cliente, permiso, estado previo, coherencia decisión↔estado, versión, fecha, motivo, atestación y elegibilidad; devuelve **snapshots congelados**. Dobles fuera del barrel. | **RESUELTO EN DOMINIO** — la frontera real es la RPC | lista vacía · motivo ausente · duplicado · motivo extra · forma malformada · `decision` desconocida · `RELEASED` fabricado por llamada directa · mutación por alias |
| **F-2** | `evidenceId` devuelto debe coincidir con el solicitado; se valida el **par** (stage, eventType); `outcome` por allowlist; descriptor, observations, zones y error saneados y acotados. | **RESUELTO** | loader A/B→C/D · stage incorrecto con eventType correcto · outcome desconocido · descriptor basura · procedencia falsificada |
| **F-2.3** | Evidencia de inspección revalidada tras el loader. **`INSPECTION_PAIRS` está vacío**: el esquema no puede representar una inspección humana. No se inventó un `eventType`. | **BLOQUEADO POR ESQUEMA** — documentado | inspección extranjera/redactada/repetida/igual a ingreso o egreso — y, sobre todo, la imposibilidad de liberar |
| **F-3** | `verified` exige atestación completa: `chain_head`, `attested_at` **emitido por la RPC**, `scope`/`entity_id`, `events_checked` entero positivo y cobertura de eventos. La decisión y el certificado revalidan vigencia contra el head actual. | **RESUELTO EN DOMINIO · ATESTACIÓN INALCANZABLE** con la RPC vigente | events_checked fraccionario/Infinity · sin chain_head · sin attested_at · atestación de otra entidad · head cambiado antes de decidir · atestación vencida |
| **F-4** | Reserva atómica **antes** del egress: sólo el creador evalúa; el segundo caller recibe `EVALUATION_IN_PROGRESS`. | **RESUELTO** | dos evaluaciones concurrentes → proveedor invocado **una** sola vez, sin excepción sin tipar |
| **F-5** | SQL corregido: join real `custody_evidence → custody_events`; creación/assessment atómicos con lock y `client_id` derivado; `p_expected_version` validado; `UPDATE … RETURNING` + `GET DIAGNOSTICS`; `session_id` del JWT validado contra `auth.sessions`; coherencia en ambas direcciones; privilegios explícitos. | **CORREGIDO EN DISEÑO · NO VERIFICADO EN DB** | `custody_evidence.packing_unit_id` (columna inexistente) · expected_version NULL · UPDATE de cero filas · decisión huérfana |
| **F-6** | SCR-WMS-001 mantenido. Recomendación principal: **A · harness dedicado con PostgreSQL + PostGIS y cierre real 0036–0039**. B no se presenta como equivalente listo: exigiría un shim ejecutable y semánticamente fiel que no existe. | **ABIERTO** — decisión de Dirección | — |
| **F-7** | 198 tests. Los del SQL están rotulados **CONTRACT/DESIGN TEST ONLY**: no sustituyen una prueba de base de datos. | **RESUELTO** (cobertura, no prueba de DB) | — |

### Por qué la liberación no puede completarse hoy

Tres bloqueos independientes, todos declarados y ninguno sorteado:

1. **Inspección humana no representable** — `custody_event_type_t` no tiene un tipo para ella (F-2.3).
2. **Atestación de cadena inexistente** — `verify_custody_chain` no devuelve `verified_event_ids`, `chain_head` ni `attested_at`, así que la cadena es siempre `unverifiable` (F-3).
3. **Umbral sin calibrar** — decisión de negocio abierta.

La cuarentena, en cambio, sí se completa: retener nunca requirió estas garantías.


---

## 10. Matriz de cierre R3-1 … R3-6 (remediación 3)

| Req | Corrección | Estado | Prueba |
|---|---|---|---|
| **R3-1** | `sealed.ts`: los artefactos de evidencia, cadena, evaluación e inspección se registran en un `WeakMap` privado y quedan **atados al caso** (`caseBinding`). El repositorio exige el sello **y re-deriva** los hechos; `newState` se valida contra una allowlist de runtime. | **RESUELTO EN DOMINIO** | *«la secuencia directa reserve → recordAssessment → applyDecision NO alcanza RELEASED»* → `ARTIFACT_NOT_SEALED`; *«un artefacto sellado para OTRO caso no sirve»*; *«newState=%p se valida en runtime»* |
| **R3-2** | `ProviderRegistry` identifica **por instancia** (`WeakMap`), no por nombre. Descriptor, modelo, promptVersion y executionMode salen del registro. | **RESUELTO** | *«un impostor con el MISMO nombre que un proveedor permitido queda mock»* |
| **R3-3** | `chainHeadAtDecision` debe coincidir con el head de la atestación **y** con el head vigente. El certificado compara el conjunto de inspección contra el **canónico revalidado**, no contra «que existan IDs». | **RESUELTO EN DOMINIO** | *«head null/otro/histórico bloquea»*; *«el certificado exige el conjunto canónico exacto»* → `INSPECTION_SET_NOT_CANONICAL` |
| **R3-4** | La reserva es un **lease con vencimiento**; el fallo del loader se convierte en resultado tipado, persiste estado fail-closed y **libera el lease**. | **RESUELTO** | *«un fallo del evidence loader NO deja una reserva permanente»*; *«un lease vencido puede reclamarse; uno vigente no»*; *«el proveedor se invoca UNA sola vez»* |
| **R3-5** | Rama `release` **deshabilitada incondicionalmente**; cuarentena permitida; el caller ya no declara `execution_mode`/`outcome`/`verdict`/`model_confidence`/`chain_*`; `p_current_chain_head` eliminado y el head se recomputa bajo el lock; `session_id` desde `auth.jwt()` validado contra `auth.sessions`; helpers sin EXECUTE para `authenticated`; `revoke` antes de `grant`. | **CORREGIDO EN DISEÑO · NO VERIFICADO EN DB** | 8 contract tests, rotulados **CONTRACT/DESIGN TEST ONLY** |
| **R3-6** | 198 tests (134 previos conservados + 21 nuevos). Handoff con estados honestos. | **RESUELTO** | — |

### Qué significa exactamente `NO_CALIBRATED_THRESHOLD`

Bloquea la **liberación automática**: sin umbral calibrado, la máquina no libera sola.
**No sustituye** la inspección humana, ni la verificación de cadena, ni la decisión
registrada. Que sea la única retención presente es condición *necesaria* para liberar,
nunca suficiente: hacen falta además evidencia válida, atestación vigente, ejecución real,
veredicto `coincide`, prueba de inspección canónica y decisión de un actor verificado.

### Estado de la liberación

**Inalcanzable, por tres dependencias reales y declaradas:** tipo canónico de evidencia de
inspección humana (enum), RPC que produzca la atestación completa, y umbral calibrado
(negocio). La cuarentena sí se completa de punta a punta.


---

## 11. Matriz de cierre R4-1 … R4-2 (remediación 4)

| Req | Corrección | Estado | Prueba |
|---|---|---|---|
| **R4-1** | `canonical.ts` mantiene registros **privados** y expone un único camino: `buildEvaluationOutcome` revalida pertenencia, selector, evidencias, cobertura de eventos, scope/entity/head/timestamp de cadena, procedencia del proveedor, outcome/verdict/executionMode, y **deriva** `state` y `holdReasons`. `RecordAssessmentInput` **ya no tiene** campos `state`, `holdReasons`, `evidence`, `chain` ni `assessment`: no hay por dónde declararlos. El repositorio **recalcula** `expectedBinding = caseBinding(found.caseId, found.entity.clientId, found.entity.entityId)` desde el caso persistido y rechaza cualquier otro. Un sellador genérico ya no produce artefactos aceptables. | **RESUELTO EN DOMINIO** | binding autocreado → `BINDING_MISMATCH` · binding de otro caso → `BINDING_MISMATCH` · outcome canónico de otro caso → `ARTIFACT_NOT_CANONICAL` · `state`/`holdReasons` del caller no controlan la persistencia · datos «válidos» no derivados → `ARTIFACT_NOT_CANONICAL` · con `INSPECTION_PAIRS` vacío ninguna ruta directa llega a `RELEASED` |
| **R4-2** | `evaluateCertificateEligibility` exige simultáneamente: `chainHeadAtDecision` no vacío, igual al head de la atestación **e** igual al head vigente, y atestación vigente en `decidedAt` **y** en `issuedAt`. Blocker tipado `DECISION_CHAIN_HEAD_MISMATCH`. | **RESUELTO** | head `null`/vacío/histórico/otro → acta · head correcto pero distinto del vigente → acta · atestación vencida en `decidedAt` o en `issuedAt` → acta · todo coherente → `certificate` |

**Nota de alcance sin cambios:** el sellado en memoria sigue siendo defensa en
profundidad, no frontera productiva. La frontera productiva será la RPC
transaccional. Lo que R4-1 cambia es que el adaptador de dominio **tampoco**
acepta ya estados construidos afuera.


---

## 12. Cierre R5 — snapshot canónico profundo

**Defecto del C4 (reproducido y corregido).** `Object.freeze` sólo protege el
primer nivel. El registro guardaba únicamente el binding, así que
`readEvaluationOutcome` devolvía el objeto del caller: se podía derivar
`state`/`holdReasons` con evidencia válida y después hacer
`outcome.evidence.ingress.redacted = true`, y el repositorio persistía la
evidencia redactada conservando sólo `NO_CALIBRATED_THRESHOLD`.

**Corrección.** `snapshot.ts` clona y congela **cada nivel** con funciones
explícitas por tipo — entidad, selector, par, ambos `EvidenceRecord`, cadena,
atestación, `verifiedEventIds`, assessment, provenance, `observations`, `zones`,
`holdReasons` y la prueba de inspección con sus `evidenceIds` y `problems`. Sin
`JSON.stringify`. Los snapshots se toman **antes de cualquier `await`**, y toda
la validación, derivación y persistencia usa ese mismo snapshot.

El `WeakMap` privado guarda ahora `{ binding, snapshot }`:
`readEvaluationOutcome` devuelve **el snapshot registrado**, nunca los campos del
objeto que el caller vuelve a presentar, y el repositorio persiste desde ahí. El
handle público es una materialización equivalente y profundamente congelada; la
autoridad no está en él.

Además, la `IntegrityAssessment` **ya no se acepta armada desde afuera**: el
constructor canónico recibe el *payload crudo* del proveedor y la construye él
mismo, con la procedencia resuelta contra el registro de instancias.

**Un hueco extra que encontraron las pruebas nuevas:** `observations` y `zones`
se copiaban pero no se congelaban, así que un `push` sobre el handle alcanzaba
el snapshot. Corregido y cubierto.

| Invariante | Prueba |
|---|---|
| La secuencia exacta del C4 no persiste evidencia redactada | *«EL DEFECTO DEL C4: redactar la evidencia tras derivar NO se persiste»* |
| 14 mutaciones internas distintas no alteran lo persistido | tabla parametrizada (`redacted`, `clientId`, `entityId`, selector, `chainHead`, `attestedAt`, `verifiedEventIds`, `outcome`, `verdict`, `executionMode`, `observations`, `zones`, `holdReasons`) |
| Mutar el `pair` original con `verifyChain` en vuelo no cambia el snapshot | prueba con promesa retenida |
| Una evidencia realmente redactada sí produce `EVIDENCE_REDACTED` | prueba de contraste |
| El repositorio no conserva referencias externas al handle | comparación por identidad |
| `inspectionProof.evidenceIds` inmutable | prueba dedicada |

Intactos: **R4-2**, la imposibilidad actual de `RELEASED`, los bloqueos de
esquema y negocio, **F-6 ABIERTO** y **SQL DESIGN ONLY**.


---

## 13. Cierre R6 — consistencia evidencia ↔ proveedor ↔ persistencia

**R6-1.** El caso de uso entregaba al proveedor las referencias originales y
recién después construía el snapshot: entre una cosa y la otra el objeto podía
cambiar, y el veredicto terminaba correspondiendo a una versión distinta de la
persistida. **El flujo canónico pasó a poseer la invocación**: `provider.compare`
recibe exactamente los mismos `EvidenceRecord` congelados que luego se validan,
derivan y persisten. El caso de uso ya no llama al proveedor.

**R6-2.** Toda la captura ocurre **antes de la primera frontera async**:
`caseId`, entidad, selector, par, **referencia exacta** del proveedor, identidad
efectiva (`captureProviderIdentity`), instante de evaluación, límite de
antigüedad y binding. Después del primer `await` no se relee ningún campo mutable
del input: un registro tardío no convierte `mock` en `real`, sustituir la
instancia no cambia la procedencia, y `evaluatedAt` no se puede mover.
`providerCompletedAt` surge del reloj interno del flujo que hizo la comparación.

`buildAssessmentFromIdentity` reemplaza la resolución tardía: no consulta el
registro. `outcomeDiagnostics()` expone `providerCalls` para auditar que sea 0 o 1.

| Invariante | Prueba |
|---|---|
| Bytes comparados == bytes persistidos, pese a mutar el par durante `compare` | *«R6-1 · mutar el pair durante compare»* |
| Registro tardío no convierte `mock` en `real` | *«registrar el provider DESPUÉS del await»* |
| Sustituir `input.provider` no cambia el resultado | *«sustituir input.provider durante una espera»* |
| `evaluatedAt` estable pese a mutación | *«mutar input.evaluatedAt durante una espera»* |
| No hay API pública para un outcome desde payload libre | *«R6-3»* (contrato + inspección del constructor) |
| timeout / excepción / payload inválido → fail-closed, 1 invocación | tabla parametrizada |
| Evidencia inválida → 0 invocaciones | prueba dedicada |
| El caso de uso completo invoca exactamente 1 vez | prueba dedicada |

Intactos: **R4-2**, los snapshots profundos de **R5**, la imposibilidad actual de
`RELEASED`, los bloqueos de esquema y negocio, **F-6 ABIERTO**, **SQL DESIGN ONLY**
y la ausencia de migraciones.

---

## 14. DB-1 · Integración local con PostgreSQL 17 + PostGIS REAL

Sesión local y serial. **Nada de esto está commiteado, empujado ni desplegado.**
El índice Git permanece en `7f825737383a214045f28e28c79afabfe46e0af6`; las
migraciones y el harness de custodia son archivos **untracked**.

### 14.1 Runtime — lo que antes bloqueaba

Tres intentos previos de instalar PostGIS fracasaron. El tercero no fue un
conflicto de link sino un fallo del motor de Homebrew 6.0.9
(`unknown install step: configure_clang_system`), declarado por el propio
Homebrew como configuración no Tier 1.

La causa era una sola: **el motor no conocía el paso de instalación**. Verificado
por ausencia, no por suposición — `configure_clang_system` y
`run_configure_clang_system` daban 0 coincidencias en `Library/Homebrew`.

Tras UNA sincronización autorizada (`brew update`, 6.0.9 → 6.0.15), el handler
aparece con cadena de despacho completa: DSL en `install_steps.rb:751`, `when`
en `:1033`, implementación en `install_steps/formula_actions.rb:120`. El
siguiente `brew install postgis` terminó en **exit 0**, 63 bottles, sin errores.

`postgis 3.6.4` · `GEOS 3.14.1` · `PROJ 9.8.1` · PostgreSQL 17.10 intacto.
Cero fórmulas desinstaladas, cero upgrades, cero unlink, cero cleanup.

### 14.2 D1 — inspección humana representable

`custody_event_type_t` no tenía forma de expresar «una persona miró la carga»,
y por eso la liberación era **inalcanzable por diseño**, no por política. D1
agrega el valor canónico `inspeccion_humana` y amplía
`custody_events_stage_type_chk` para admitir EXACTAMENTE `(despacho,
inspeccion_humana)`. Ningún otro par se relajó.

Una evidencia acredita inspección sólo si cumple **todas**: evento
`inspeccion_humana` en etapa `despacho`, soporte `foto`, no redactada, misma
entidad, mismo cliente, distinta de ingreso y egreso, no repetida, y **dentro
del tramo de cadena efectivamente atestado**. El predicado vive en
`is_custody_inspection_evidence` para que la RPC y cualquier auditoría posterior
apliquen la misma regla.

### 14.3 D2 — la atestación se deriva, no se declara

`verify_custody_chain` devolvía `{valid, events_checked, first_error}`: no
acreditaba **sobre qué entidad** se pronunciaba. Un llamador podía aplicar la
verificación de A a un caso de B. Ahora deriva y firma `status`, `scope`,
`entity_id`, `verified_event_ids`, `chain_head` y `attested_at`. Las tres claves
originales se conservan porque 0039 las consume.

Una cadena vacía ya no es «válida»: es `unverifiable`. Afirmar lo contrario
habría permitido liberar una entidad sobre la que no se registró nada.

### 14.4 D3 — NO_AUTOMATIC_RELEASE

Probado **por agotamiento de vías**, no por inspección de código:

| Vía | Resultado |
|---|---|
| `UPDATE ... state='RELEASED'` directo (incluso como superusuario) | `custody_integrity_cases_terminal_needs_decision_chk` |
| RPC de assessment pidiendo estado terminal | `estado no derivable` |
| `authenticated` escribiendo la tabla | sin GRANT de INSERT/UPDATE/DELETE |
| Evaluación «perfecta» (confianza 1.0, `coincide`, cadena verificada) | queda en `REVIEW_REQUIRED` esperando a una persona |
| Dos decisiones concurrentes | exactamente 1 gana; 1 fila de decisión |
| Segunda liberación | `caso ya decidido` |

**No se introdujo ningún umbral numérico.** Se prueba explícitamente: confianza
`0.01` con veredicto `coincide` **libera**; confianza `0.99` con veredicto
`posible_dano` **bloquea**. La regla es el veredicto, nunca la magnitud. El
«90 %» sigue sin existir.

### 14.5 D4 — harness dedicado, vanilla intacto

`tests/custody-db/` con manifiesto propio de **39** migraciones (36 del cierre
inventariado + 0221–0223) y `vitest.custody.config.ts`. Reutiliza
`loadSchema(client, manifest)`, `startEphemeralCluster` y `connectGuarded` sin
modificarlos.

Vive **fuera de `tests/db/`** deliberadamente: `vitest.db.config.ts` incluye
`tests/db/**/*.test.ts`, así que un test de custodia ahí dentro se ejecutaría
también en la corrida vanilla —sobre un esquema sin tablas de custodia— y la
rompería. La separación de directorio es lo que hace que la invariancia sea real
y no sólo declarada; T-C1-05 la verifica contra `git status`, no de palabra.

`EXPECTED_MANIFEST_SIZE = 31` del vanilla queda intacto.

### 14.6 Resultados

> ⚠️ **14.6, 14.7 y 14.8 quedan como REGISTRO HISTÓRICO del cierre DB-1 y están
> SUPERADOS por la §15 (remediación post-DB-C4).** No se editan, para que el
> expediente conserve qué se sabía en cada momento.

| Gate | Resultado |
|---|---|
| Harness dedicado PG17 + PostGIS real | **PASS** — 60/60 |
| Suite unitaria completa (incluye R1–R6) | **PASS** — 1897 pasan, 1 skip |
| Lint | **PASS** — 0 errores; 0 warnings en archivos nuevos |
| Boundaries (DoD-11 + AP-UDIE-1) | **PASS** |
| Secret scan (15 archivos nuevos) | **PASS** — sin secretos ni referencias a entorno real |
| Diff-check | **PASS** — index tree intacto, 0 tracked modificados |
| Suite DB vanilla | 🔴 **RED** — ver 14.7 |
| Typecheck | 🔴 **RED preexistente** — ver 14.8 |
| Build | 🔴 **RED preexistente** — ver 14.8 |

### 14.7 🔴 SCR-WMS-002 · el guard del manifiesto vanilla bloquea toda migración nueva

`validateCanonicalManifest()` exige que **toda** migración del repositorio esté
en el manifiesto o en una exclusión documentada. Las tres nuevas no están en
ninguno, así que la suite vanilla aborta:

```
ManifestIntegrityError: hay migraciones sin clasificar:
0221_custody_integrity_enums.sql, 0222_custody_integrity_foundation.sql,
0223_custody_integrity_decision.sql
```

**Esto es el guard funcionando como fue diseñado** (endurecimiento H-05): una
migración nueva rompe la suite hasta que alguien decida explícitamente dónde va,
y esa decisión queda visible en el diff.

Pero produce una **contradicción intrínseca** entre dos exigencias del mandato
DB-1: no se puede agregar ninguna migración al repositorio y a la vez mantener
`tests/db/harness/manifest.ts` byte-invariante. No es un defecto de esta sesión:
es una propiedad del mecanismo, y aparecerá igual con cualquier migración futura
de cualquier módulo.

**No se tocó el archivo congelado.** La resolución es de Dirección/C4, no mía.
Remedio mínimo, una sola decisión consciente — agregar al set congelado de
`FROZEN_EXCLUDED_FILES`:

```
"0221_custody_integrity_enums.sql",
"0222_custody_integrity_foundation.sql",
"0223_custody_integrity_decision.sql",
```

`EXPECTED_MANIFEST_SIZE` seguiría siendo 31: son exclusiones, no entradas.

### 14.8 🔴 Typecheck y build: ROJO PREEXISTENTE, medido

Ambos fallan **por la misma causa y ya fallaban antes de DB-1**. Medido apartando
temporalmente los archivos de esta sesión:

| | Con DB-1 | Baseline sin DB-1 |
|---|---|---|
| `tsc --noEmit` | exit 1 · 55 errores | exit ≠ 0 · **46 errores** |
| `next build` | exit 1 | exit **1** |

El baseline de 46 errores está **íntegramente en `tests/db/**`** — archivos
commiteados que esta sesión no modificó. Causa única: `@types/pg` no es
dependencia del proyecto, y `tsconfig.json` incluye `**/*.ts`. El build compila
correctamente (`✓ Compiled successfully`) y sólo falla en la etapa de typecheck,
sobre `tests/db/harness/cluster.ts`.

Los 9 errores restantes atribuibles a DB-1 son de esa **misma clase única**
(`import { Client } from "pg"`). Los 9 *implicit-any* que sí eran míos fueron
corregidos con tipos explícitos.

Arreglarlo exige `npm i --save-dev @types/pg`, que toca `package.json` y el
lockfile — **prohibido por el mandato**. Se reporta, no se repara.

### 14.9 Lo que sigue pendiente

Nada de esto cambió en DB-1, y ninguna prueba de esta sesión lo da por resuelto:
umbral calibrado, comportamiento por encima del umbral, quién es el «encargado
de turno», autorización de privacidad para IA externa, valor contractual del
certificado, y si se corrige la falta de NULL-safety de `has_permission`
(0009:164) — que acá se neutraliza con `coalesce(..., false)` en cada guard y se
documenta con una prueba que exhibe el `NULL`.

---

## 15. Remediación POST-DB-C4

El DB-C4 independiente dio **FAIL**. Los hallazgos no se discuten ni se
auto-waivean: se remedian. Esta sección describe qué cambió y —igual de
importante— qué NO cambió y por qué.

Las migraciones `0221`–`0223` son **nuevas, untracked y nunca aplicadas**: se
corrigen en sitio. `0001`–`0220` son históricas e inmutables, y ninguna se tocó.

### 15.1 Procedencia SERVER-OWNED de la evaluación

**El hallazgo.** `record_custody_integrity_evaluation` era ejecutable por
`authenticated` y recibía por parámetro provider, modelo, execution_mode,
outcome, verdict y confidence. Un resultado declarado por el interesado no
acredita nada, y una evaluación así no puede sostener una liberación.

**La corrección.** Esa RPC **se elimina** — no basta con revocarle EXECUTE:
mientras exista sigue siendo una vía de escritura sin intento previo, y un GRANT
descuidado la reabre. En su lugar, un flujo durable de intento en dos tiempos,
con la tabla `custody_integrity_evaluation_attempts` como soporte:

| | `begin_custody_integrity_evaluation` | `complete_custody_integrity_evaluation` |
|---|---|---|
| Quién | `authenticated` | **sólo el rol interno de servidor** |
| EXECUTE | `authenticated` | revocado a public/anon/authenticated; concedido a `service_role` |
| Qué recibe | `case_id` y `expected_version`, nada más | `attempt_id`, `case_id`, versión y los hechos del proveedor |
| Qué deriva | actor, sesión, rol, cliente, scope, entidad, evidencias, fecha, estado `pending` | re-deriva tenant y atestación de cadena |
| Qué valida | sesión, permiso WMS, tenant y CAS | binding COMPLETO del intento |

La finalización rechaza: intento inexistente, ajeno a otro caso, vencido, ya
utilizado o abandonado, con versión distinta, con cliente distinto, con
evidencias distintas o con entidad distinta. **No permite completar dos veces**
(`where status = 'pending'` + `GET DIAGNOSTICS`) y **no permite cambiar caso,
versión, cliente ni evidencias**: el binding queda congelado por el trigger
`trg_custody_integrity_attempt_guard`, que además bloquea DELETE y TRUNCATE.

El rol de servidor **no recibe escritura directa sobre ninguna tabla**: 0222
revoca ALL a `service_role` —además de a public/anon/authenticated— sobre las
cuatro tablas y le devuelve sólo SELECT. Sin esa revocación, el
`ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO service_role` del bootstrap
de Supabase le habría dado INSERT/UPDATE y el intento sería decorativo.

**Auditoría sin filtración.** `custody.integrity_evaluated` registra
`attempt_id`, outcome, execution_mode, verdict, chain_status, provider, model,
prompt_version y un booleano `provider_error_present`. El texto del error del
proveedor **nunca** entra a la auditoría, y la columna que lo persiste está
acotada a 500 caracteres por CHECK para que no pueda usarse como vertedero de
payloads. Ninguna imagen, ningún sha, ningún path.

**No se llamó a ningún proveedor.** Los resultados de las pruebas son dobles
sintéticos; lo que se verifica es la PROCEDENCIA del dato, no su contenido.

### 15.2 Captura productiva de la inspección humana

**El hallazgo.** El esquema admitía `(despacho, inspeccion_humana)`, pero la
única vía productiva de captura —`attach_custody_evidence` (0038)— la rechazaba
por su propia lista blanca interna. La inspección sólo existía como INSERT
directo del harness: funcionalidad probada sin camino real en producción.

**La corrección.** Sin tocar 0038, 0222 **reemplaza la función hacia adelante**
con la misma firma. Para la variante de inspección —y sólo para ella— rige la
política única de §15.4, el soporte debe ser `foto`, el tenant se deriva de la
entidad y el instante autoritativo es `now()`: lo que el cliente mande en
`p_occurred_at` **no se usa**. (`p_captured_at` sí se conserva: es metadato
descriptivo del archivo, no el hecho autoritativo.) Para los demás pares se
preserva exactamente el comportamiento de 0038; endurecer flujos ajenos a este
expediente habría sido un cambio no pedido y con consumidores propios (0039).

`actor_id` y `created_by` quedan en `auth.uid()`, y la RPC verifica sobre lo
**escrito** —no sobre lo pretendido— que ambos existan, coincidan entre sí y con
el actor, y que la evidencia no nazca redactada.

`is_custody_inspection_evidence` incorpora esa exigencia de procedencia humana,
de modo que una inspección fabricada por INSERT directo —sin actor— tampoco
acredita al decidir. El camino positivo de las pruebas usa la RPC real; los
INSERT directos quedan reservados a casos negativos, y cada uno está marcado.

**Anti-replay.** `custody_integrity_inspection_evidence` gana un índice único
sobre `evidence_id`: la PK compuesta sólo impedía repetir una evidencia DENTRO
de una decisión; ahora tampoco puede acreditar dos decisiones distintas. La RPC
además lo comprueba explícitamente, porque un error de unicidad no explica el
hecho.

### 15.3 Cadena y concurrencia

1. **Cadena vacía.** Devolvía `valid = true` sobre cero eventos. Ahora
   `valid = false`, `status = 'unverifiable'`, `events_checked = 0`, sin
   `chain_head` ni `attested_at`. **Consecuencia conocida y querida:** 0039
   (`get_shipment_custody_summary`) informará `chain_valid = false` para un
   shipment sin ningún evento de custodia — que es el hecho verdadero.

2. **Advisory lock.** La decisión toma ahora **exactamente el mismo**
   `pg_advisory_xact_lock` por entidad que usa `custody_event_hashchain` (0036),
   antes de leer nada de la cadena y sostenido hasta el fin de la transacción, y
   **recomputa el head después de adquirirlo**. La clave se deriva en un único
   lugar (`custody_chain_lock`) para que no exista la posibilidad de escribir
   mal la cadena de texto en un segundo sitio y creerse serializado sin estarlo.
   Se prueba en las dos direcciones, con `pg_locks` como evidencia: decisión
   primero (el evento concurrente espera) y evento primero (la decisión espera y,
   al obtener el lock, descubre que la cadena avanzó y se bloquea).

3. **Evidencia.** Se acreditan únicamente los eventos dentro del tramo atestado
   (`chain_seq <= chain_seq(chain_head)`), y una inspección ya vinculada a otra
   decisión no vuelve a servir.

La atestación se partió en `custody_chain_attestation` (interna, sin gate de rol
ni auditoría) y `verify_custody_chain` (user-facing, con el gate canónico y la
auditoría). Motivo concreto: la finalización corre **sin sesión de usuario** y
necesita re-derivar la atestación; con un único cuerpo gateado por
`current_role()` eso exigía relajar el gate para todos.

### 15.4 Acceso, tenant y **RELEASE ADMIN-ONLY**

Todas las RPC user-facing SECURITY DEFINER del feature aplican una **política
única**, implementada una sola vez en `assert_custody_access` +
`assert_custody_tenant`:

1. sesión real (`auth.uid()` no nulo);
2. sesión **acreditada**: `session_id` del token, presente en `auth.sessions` y
   perteneciente a ese usuario;
3. permiso requerido, **siempre** con `coalesce(..., false)` (hallazgo 0009:164);
4. rol real no nulo;
5. entidad y `client_id` **derivados server-side**;
6. usuarios client-bound sólo operan sobre su propio `client_id`; los roles
   internos globales conservan exclusivamente la política canónica existente;
7. cualquier NULL falla **cerrado**.

El orden 3→4 no es cosmético: el permiso se comprueba **antes** que el rol para
que el guard atraviese el hazard de 0009:164 y quede demostrado que el
`coalesce` es lo que cierra la puerta.

Esto cerró un agujero real: `upsert_custody_integrity_assessment` no validaba la
sesión contra `auth.sessions` ni acotaba por tenant, de modo que un usuario
client-bound podía **abrir casos sobre entidades de otro cliente**.

#### RELEASE ADMIN-ONLY — resolución conservadora de la fase inicial

- **Sólo `admin`** puede ejecutar la decisión de **liberación**.
- `operaciones` y `supervisor` **no reciben automáticamente**
  `wms.custody.decide`: 0222 crea el permiso y deliberadamente **no siembra
  ninguna fila en `role_permissions`**. Aunque se les otorgue explícitamente, la
  liberación les sigue estando vedada.
- La **cuarentena** y el resto de las operaciones **conservan sus permisos
  existentes**. Cerrar la puerta peligrosa no puede costar la capacidad de
  retener una carga sospechosa.
- Una delegación futura exige **autorización separada** y visible en su diff.

Se acredita en dos capas: la RPC lo comprueba, y el CHECK
`custody_integrity_decisions_release_admin_chk` impide que una liberación con
otro rol **exista escrita**, ni siquiera a mano.

El acotamiento por tenant se evalúa **antes** que el rol, para que un intruso de
otro cliente reciba `cliente ajeno` y no una pista sobre qué rol le faltaría.

Ningún permiso se amplió por conveniencia de tests: el escenario base incorporó
un decisor admin explícito, y `staff` conserva `wms.custody.decide` justamente
para probar que tenerlo **no alcanza**.

### 15.5 SCR-WMS-002 — resuelto por clasificación dedicada exacta

Se agregó a `tests/db/harness/manifest.ts` una exclusión **nueva y separada**,
`custody-integrity-dedicated-harness`, que coincide por **filenames exactos**
contra un set propio con las tres migraciones. No se tocó el contenido de
`FROZEN_EXCLUDED_FILES`, no se agregó nada a `WMS_MIGRATION_MANIFEST` y
`EXPECTED_MANIFEST_SIZE` sigue en **31**.

> **Desvío declarado.** El mandato autorizaba modificar también
> `tests/db/t-a0-10-manifest.test.ts`. **No se modificó**, y el archivo está
> byte-idéntico a HEAD. Motivo: el harness vanilla tiene un guard de universo
> exacto (`tests/db/scripts/assert-clean-run.mjs` +
> `expected-suite.mjs → EXPECTED_TOTAL_TESTS = 350`), y agregar un solo `it`
> allí obliga a actualizar ese archivo, que **no está entre los paths
> autorizados**. Cambiarlo en silencio habría sido peor que el defecto a
> corregir: es precisamente el artefacto que impide que una corrida parcial pase
> por completa. Las pruebas granulares viven en
> `tests/custody-db/t-c1-10-manifest-classification.test.ts`, importando el
> módulo **real** del vanilla —no una copia—. La corrección en sí queda probada
> por el propio harness vanilla sin casos nuevos: `T-A0-10 · toda migración del
> repositorio está clasificada` fallaba y ahora pasa.

Probado: vanilla **31**; cierre histórico de custodia **36**; manifiesto dedicado
**39** (36 + 3); `0224_*` y toda migración futura siguen **sin clasificarse
solas**; y once variantes de nombre (mayúsculas, sufijos, prefijos, guiones,
espacios, ruta completa) **no coinciden**.

En consecuencia, la invariancia del harness vanilla pasa de **total** a
**acotada y verificada**: cambia **un solo archivo**, nombrado, y T-C1-05 lo
comprueba con `git status`, además de recortar `FROZEN_EXCLUDED_FILES` y
`WMS_MIGRATION_MANIFEST` y compararlos byte a byte contra HEAD.

### 15.6 `@types/pg` — hidratación sin tocar manifests

`package.json` y `package-lock.json` ya declaraban `@types/pg` (lock resuelto en
**8.20.3**); lo que faltaba era el paquete en el `node_modules` **compartido**.

Se hidrató **sólo esa versión**, en una ventana serial de recursos Node, por
descarga del tarball de registro y extracción directa: sin scripts, sin `--save`
y sin que npm reconstruyera el árbol. La integridad del tarball se verificó
**idéntica al `integrity` del lockfile** antes de extraer. Los hashes SHA-256 de
`package.json` y `package-lock.json` quedaron **iguales antes y después**, y
`git status` sobre ambos devuelve **0 líneas**.

Con eso, `typecheck` y `build` pasan a **exit 0**. No se creó ningún
`declare module "pg"` ni shim alguno.

### 15.7 Gates — conteos REALES de esta sesión

| Gate | Exit | Resultado medido |
|---|---|---|
| Harness Custodia (cluster limpio, PG 17.10 + PostGIS 3.6.4) | **0** | **124/124** en 11 archivos |
| Suite DB vanilla (`npm run test:db`) | **0** | **350/350** en 22 archivos · `P3_N1A0_CLEAN_RUN` · `P3_N1A0_NO_LOCAL_RESIDUALS` |
| Unitarios (`npm test`) | **0** | **1897 pasan, 1 skip** en 144 archivos |
| `typecheck` | **0** | 0 errores (antes: 55) |
| `build` | **0** | compila y prerenderiza |
| `lint` | **0** | 0 errores; warnings preexistentes en archivos no tocados |
| `lint:boundaries` | **0** | 21 archivos sin violaciones |
| `lint:udie-boundary` | **0** | `AP-UDIE-1 OK` |
| `git diff --check` (árbol e índice) | **0** | sin residuos de espacio |
| Secret/PII scan (43 archivos en alcance) | — | **0 hallazgos** sobre 12 patrones; no se imprimió ningún valor |
| `package.json` / `package-lock.json` | — | SHA-256 invariantes · 0 líneas en `git status` |
| Cleanup | — | 0 postmasters, 0 clusters temporales, 0 puertos, 0 servicios |

### 15.8 Lo que esta remediación NO hace

- No commitea, no pushea, no mergea, no crea PR, no despliega.
- No toca Supabase remoto, producción ni datos reales.
- No llama a ningún proveedor externo: sólo el límite DB y dobles sintéticos.
- No toca WhatsApp, Connect, Sidebar ni sus worktrees.
- No se auto-certifica: **no** declara FEATURE COMPLETE ni DEPLOYABLE.
- No resuelve nada de §14.9: umbral calibrado, comportamiento por encima del
  umbral, «encargado de turno», autorización de privacidad para IA externa,
  valor contractual del certificado y la NULL-safety de `has_permission`
  (0009:164) siguen abiertos.

## 16. W22-BIS / W22-TER · remediación del DB-C4 (10 observaciones, 9 causas raíz)

El DB-C4 de W22 cerró en **FAIL**. Esta sección registra qué quedó cerrado, con
qué evidencia, y qué sigue abierto. Nada de lo de acá está commiteado: el
candidato vive en el worktree, sin índice tocado.

| Causa raíz | Sesión | Estado | Artefacto |
|---|---|---|---|
| **B-1** escalada de `profiles.role` | W22-BIS | **CERRADA** | `0224` · trigger `trg_profiles_authority_guard` |
| **M-1** ACL de `custody_events` / `custody_evidence` | W22-BIS | **CERRADA** | `0224` · `revoke all` + `grant select` |
| **M-3/M-4** cota temporal de la inspección | W22-BIS | **CERRADA** | `0224` · predicado único con ambas cotas |
| **M-6** harness de Custodia en CI | W22-TER-A | **CERRADA (LOCAL PASS)** | `test:custody:db` + `wms-custody-db-harness.yml` + sonda PostGIS |
| **M-5** compatibilidad tri-state con `0039` | W22-TER-B | **CERRADA (LOCAL PASS)** | `0225` |
| **M-2** replay de la misma foto | — | **OPEN** | — |
| MINOR-01/02/03 | — | **DEFERRED HARDENING** | — |

### 16.1 M-5 · contrato tri-state de `0225`

`0039` resolvía la integridad de un despacho con
`verify_custody_chain(null, shipment_id)`, que sólo atesta la cadena **directa**
del shipment. En el modelo de `0036` la evidencia vive en los eventos de las
packing units, así que un despacho íntegro cuyos eventos cuelgan de sus bultos
daba `events_checked = 0` y —tras la corrección del DB-C4, que dejó de aceptar
una cadena vacía como válida— `chain_valid = false`. El POD imprimía
«CADENA INVÁLIDA» sobre un envío que nadie había roto.

`0225` es **forward-only**: no edita `0039` ni `0221`–`0224`. Redefine sólo
`get_shipment_custody_summary` —misma firma, mismas claves, más `chain_status`—
y agrega el helper interno `custody_shipment_chain_rollup`, sin
`SECURITY DEFINER` y con `EXECUTE` revocado a `PUBLIC`, `anon`, `authenticated`
y `service_role`.

Cadenas **requeridas** de un shipment: la de cada packing unit que le pertenece,
más la propia del shipment **sólo si tiene eventos**. Resolución con precedencia
`invalid > unverifiable > verified`:

| Situación | `chain_status` |
|---|---|
| ninguna cadena requerida | `unverifiable` |
| alguna requerida inválida | `invalid` |
| ninguna inválida, alguna vacía o no atestable | `unverifiable` |
| todas verificables y válidas | `verified` |

`chain_valid` se conserva por compatibilidad y es `true` **exclusivamente** con
`verified`. `chain_events_checked` suma los eventos realmente recorridos. El
resumen emite **una sola** auditoría agregada `custody.shipment_summary`, sin
PII: no se audita por hijo.

### 16.2 M-5 · presentación canónica compartida

`src/lib/custody/chain-presentation.ts` es la única fuente de verdad para
nombrar y colorear el estado; la consumen la UI (`CustodyShipmentSection`) y el
POD (`PodPdfDocument`).

| Estado | UI | PDF | Color | ¿Acredita? |
|---|---|---|---|---|
| `verified` | Íntegra | CADENA VÁLIDA | verde `#16a34a` | sí |
| `invalid` | Inválida | CADENA INVÁLIDA | rojo `#C90812` | no |
| `unverifiable` | Sin evidencia suficiente | SIN EVIDENCIA SUFICIENTE | ámbar `#B45309` | no |

`unverifiable` no se muestra en rojo ni se llama «ROTA» ni «INVÁLIDA». El POD
imprime además un enunciado explícito: sólo `verified` acredita la integridad;
los otros dos dicen que **NO** la acreditan, y `unverifiable` aclara que tampoco
afirma que la cadena haya sido vulnerada. Sólo `verified` llama «verificados» a
los eventos; los demás dicen «recorridos».

Fallback defensivo para respuestas anteriores a `0225`: sin `chain_status`,
`chain_valid = true` → `verified`; `chain_valid = false` → **`unverifiable`**.
`invalid` sólo se afirma si la base lo afirma: `false` significaba dos cosas y
acusar de adulteración con un dato ambiguo era el defecto original.

### 16.3 M-5 · gates de la sesión W22-TER-B

| Gate | Exit | Resultado |
|---|---|---|
| `T-C2-05` tri-state (SQL) | **0** | 18/18 · rojo previo 14/18 sin `0225` |
| `T-C2-06` presentación (pura) | **0** | 22/22 |
| `npm run test:custody:db` | **0** | **220/220** en 17 archivos |
| Harness externo equivalente al contrato CI | **0** | 220/220 · PostGIS 3.6.4 · PG 17.0010 · 0 bases residuales |
| `T-C2-04` (regresión M6) | **0** | 17/17 · `LOCAL PASS PRESERVED` |
| `npm run test:db` (vanilla) | **0** | 350/350 · `EXPECTED_MANIFEST_SIZE` sigue en 31 |
| Unitarios · typecheck · lint · boundaries · udie · build | **0** | sin errores |

`REMOTE CI: NOT EXECUTED` — no hubo push en ninguna de estas sesiones.

### 16.4 Lo que M-5 NO hace

- No abre **M-2** (replay de la misma foto), que sigue `OPEN`.
- No toca `0039`, `0221`–`0224`, el workflow/sonda/contrato de M-6, los
  lockfiles ni el harness vanilla más allá de clasificar `0225` por filename
  exacto.
- No amplía RLS, grants ni superficie de Data API.
- No declara FEATURE COMPLETE, DEPLOYABLE ni C4 PASS.

## 17. W22-TER-C · M-2 · atestación server-side del contenido (FAIL-CLOSED)

### 17.1 El defecto

`attachEvidenceAction` calculaba el SHA-256 sobre el buffer que llegaba en el
`FormData` y **nunca releía el objeto almacenado**; `attach_custody_evidence`
plegaba ese digest en la hash-chain como si fuera la identidad del contenido.
De ahí salían dos ataques: declarar un digest que no corresponde a los bytes
guardados, y subir **la misma fotografía** a otro `path` para acreditar una
segunda inspección. Un `unique (sha256)` no cierra nada mientras el digest lo
declare el llamador.

### 17.2 Frontera de confianza que establece `0226`

| Capa | Qué aporta | ¿Verificado localmente? |
|---|---|---|
| Storage | los bytes realmente almacenados | **NO** — sin stack local |
| Adaptador server-side | relee el objeto y hashea **esos** bytes | orquestación sí, lectura real no |
| DB (`0226`) | exige una atestación server-side, la consume atómicamente y reclama el contenido | **SÍ**, contra PostgreSQL 17 real |

La DB no puede leer Storage. Lo que `0226` garantiza —y se prueba— es que
**ningún camino acepta una inspección humana sin una atestación emitida por el
rol interno de servidor**, y que el digest que entra a la cadena es el
**atestado**, jamás el del parámetro. Eso vuelve obligatoria la relectura de
bytes: sin su producto, la base no opera.

Componentes: `custody_content_attestations` (privada, un solo uso, caduca, atada
a bucket, path, digest, tamaño, actor, sesión, tenant, entidad, etapa y tipo);
`custody_inspection_content_claims` (ledger append-only con PK sobre el digest,
que vuelve **atómico** el anti-replay); `attest_custody_content` y
`revoke_custody_content_attestation`, ambas sólo para `service_role`; y
`attach_custody_evidence` con la **misma firma**, fail-closed para la inspección
humana y sin cambios para los demás pares históricos.

El anti-replay está **acotado a `(despacho, inspeccion_humana, foto)`**: un POD
o un documento pueden compartir contenido legítimamente, y prohibirlo
globalmente rompería flujos sanos sin cerrar ningún ataque. El claim **no se
libera nunca**: ni la redacción de la evidencia ni el cierre del caso devuelven
el digest al pozo.

### 17.3 Estado — `M2: FAIL-CLOSED`, no `PASS`

El entorno local **no tiene Supabase Storage**: no hay runtime de contenedores
activo, el repositorio no declara `supabase/config.toml` y el remoto está
prohibido. La lectura autoritativa del objeto real no pudo ejercitarse y
sustituir Storage por un doble para declarar M2 cerrado es exactamente lo que el
mandato prohíbe.

Lo que SÍ quedó demostrado contra PostgreSQL real (21 ataques, 20 en rojo sin
`0226`): digest mentido, mismo path con otro hash, misma foto con otro path,
mismos bytes con otro nombre/extensión, reutilización cross-entidad y
cross-cliente, reutilización tras redacción, atestación consumida/vencida/
revocada/ajena, concurrencia con ganador único, `authenticated` sin acceso a la
atestación ni al ledger, RPC legacy sin atestación, y compatibilidad de los
cinco pares históricos.

`STOP — LOCAL_STORAGE_ATTESTATION_NOT_VERIFIABLE`. Para cerrar M2 hace falta una
ventana con Supabase Storage real —stack local o entorno de pruebas dedicado— y
un test de ida y vuelta que suba, relea y compare bytes.

### 17.4 W22-TER-C1 · frontera de confianza del adaptador

La primera versión del adaptador de M2 tenía seis defectos de frontera, todos
remediados sin tocar la DB:

| Defecto | Remediación |
|---|---|
| `session_id` aceptado desde `FormData` | el formulario ya no se lee para identidad; actor y sesión salen de `resolveTrustedActor()` |
| operador identificado con `admin.auth.getUser()` | se usa `sessionClient.auth.getUser()`; el cliente admin no representa a nadie |
| `createAdminClient() ?? createClient()` | clientes **separados**: sesión para identidad, admin obligatorio para Storage y RPC internas; sin admin no hay upload, atestación ni attach |
| `storage.remove()` ignoraba `{ error }` | el puerto lanza `CustodyStorageError`; un borrado fallido nunca se reporta como limpio |
| compensación sin cubrir el attach | fases explícitas `upload → reread/hash → attest → attach`, cada una con su compensación |
| borrado automático ante attach ambiguo | los errores de RPC se **clasifican**: con código de PostgREST son deterministas y se compensa; sin código son ambiguos y **no se toca nada** |

`session_id` se deriva server-side con `getClaims()` (auth-js 2.106.2), que
verifica la firma contra el JWKS y, con clave simétrica, cae a `getUser(token)`
contra el servidor de auth antes de devolver los claims; `session_id` es claim
requerido. Se exige además que `claims.sub` coincida con el usuario validado, y
la DB sigue validando el par contra `auth.sessions`.

Estados de salida, sin bucket, path, digest, nombre de archivo ni PII: `ok`,
`failed`, `cleanup_required` (la compensación falló y quedó un objeto por
limpiar) y `reconciliation_required` (el attach quedó sin confirmar; la
evidencia pudo haberse creado y por eso no se borra ni se reintenta).

`T-C2-08` cubre 27 casos: identidad y sesión, las cuatro fases, cada modo de
compensación, la no-compensación ante ambigüedad, el puerto real que no ignora
`{ error }` y la ausencia de filtraciones en todas las salidas de fallo.

**M2 sigue `FAIL-CLOSED`**: el roundtrip real contra Supabase Storage sigue sin
ejecutarse y es lo único que falta para cerrarlo.

### 17.5 W22-TER-C2 · una sola invocación y clasificación fail-closed

**Corrección de premisa, verificada contra el paquete instalado.** No es cierto
que `supabase-js` 2.106.2 reintente `.rpc()`:

```js
// postgrest-js 2.106.2 · shouldRetry()
if (!RETRYABLE_METHODS.includes(method)) return false;      // ["GET","HEAD","OPTIONS"]
if (!RETRYABLE_STATUS_CODES.includes(status)) return false; // [520, 503]
```

`.rpc()` viaja como POST y queda fuera del guard de método. Además `supabase-js`
construye el `PostgrestClient` con `{ headers, schema, fetch, timeout,
urlLengthLimit }`: no propaga ninguna opción `retry`, que tampoco existe en sus
tipos — `db: { retry: false }` sería un no-op silencioso. Se comprobó
empíricamente con un `fetch` grabador: un 503/504/408/520 o un error de red
sobre `.rpc()` produce **exactamente una** invocación del transporte.

**Guard igual, por diseño.** La garantía no puede depender de que una lista
interna siga sin incluir POST. `noRetryTransport()` cuenta intentos por
(método + URL) y **aborta el segundo** de un método mutante; los clientes
acotados `createCustodyMutationClient()` y `createCustodyAdminMutationClient()`
lo inyectan. `createClient()` y `createAdminClient()` quedan intactos: el resto
de Nexus no cambia.

**Clasificación por allowlist, ambigua por defecto.** La versión anterior
trataba «tiene `code`» como prueba de rollback, y eso es falso: `08006`,
`53300`, `57014`, `58000`, `XX000`, `40003` y los `PGRST00x` traen código y no
dicen nada sobre si la transacción confirmó. Ahora sólo son deterministas 18
SQLSTATE de la allowlist —violaciones de integridad `23xxx`, excepciones de dato
`22xxx`, rechazos `42xxx`, nuestras `P0001`/`P0002`, `40001`/`40P01` que ya
hicieron ROLLBACK y `25006`—, enumerados uno por uno y sin familias abiertas.

**El flanco del eco.** Si el transporte observó más de un intento, la
clasificación degrada a AMBIGUA sea cual sea el código: un `23505` en el segundo
intento puede ser el eco del primero, que sí confirmó. Ese caso ya no borra nada.

`T-C2-08` pasa a 68 casos. `M2` sigue `FAIL-CLOSED`: falta el roundtrip real
contra Supabase Storage.

### 17.6 W22-TER-C3 · compensación segura y respuestas ambiguas

Tres defectos de la orquestación, remediados sin tocar la DB ni `server.ts`.

**F1 · una atestación ambigua ya no borra el objeto.** Antes, cualquier
excepción de `ports.attest()` entraba en `compensate()` y eliminaba Storage. Una
respuesta perdida se parece a un error, y la atestación pudo haber confirmado.
Ahora sólo compensan los fallos que PRUEBAN ausencia de efecto:
`CustodyPreflightError` (la llamada nunca salió), `StoredContentMismatchError`
y `CustodyStorageError` (locales, sin RPC de por medio) y un `CustodyRpcError`
cuyo SQLSTATE está en la allowlist exacta de TER-C2. Un `Error` genérico es
**ambiguo**: `reconciliation_required`, cero `remove`, cero `revoke`, cero
`attach`, cero retry. La allowlist SQLSTATE no se amplió.

**F2 · sólo una revocación confirmada habilita borrar.** El orden es ahora
obligatorio: si existe `attestationId` se revoca primero, y si la revocación
falla —determinista, ambigua, preflight o genérica— se devuelve
`cleanup_required` **de inmediato y se preserva el objeto**. Una atestación
quizá viva apuntando a un objeto borrado es un estado peor que un huérfano. Si
la revocación confirma y después falla `remove`, también es `cleanup_required`.

**F3 · las respuestas se validan antes de acreditarlas.** `attest_custody_content`
debe devolver un UUID canónico no vacío; `attach_custody_evidence` debe devolver
`event_id` y `evidence_id` canónicos y un `event_public_id` no vacío. Una
respuesta sin error pero nula, incompleta o malformada es **ambigua**:
reconciliación sin compensación destructiva. Nunca se devuelve `ok` con IDs
`undefined`.

Evidencia: contra el comportamiento previo, 25 de los 33 casos nuevos quedan en
rojo; con la remediación, `T-C2-08` pasa a **101 casos** verdes. Todas las
garantías de TER-C1 (identidad, sesión, separación de clientes) y TER-C2
(una sola invocación, allowlist) siguen intactas y probadas en el mismo archivo.

`M2` sigue `FAIL-CLOSED`: falta el roundtrip real contra Supabase Storage.
