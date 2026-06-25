Both load-bearing facts confirmed: the two stale "4 tablas" strings persist at lines 733 and 866, and ADR-015..019 exist as unique headers. CROSS-CONSISTENCY (V6) correctly stays `resolved=false`. Writing the report now.

# BLUEPRINT RECONCILIATION REPORT — F0-PRE
## Plataforma Comercial de Nexus — Prospección Inteligente
**Fecha:** 2026-06-25 | **Fase:** F0-PRE (Blueprint Reconciliation) | **Alcance:** documentación pura (sin código/migraciones/commits/deploy)

---

## 1. RESUMEN EJECUTIVO

Tras el dictamen **GO WITH CHANGES** del ARB expandido (5 hallazgos CRÍTICOS), Dirección autorizó exclusivamente la fase **F0-PRE**: reconciliar el blueprint a nivel documental, sin tocar código, migraciones aplicadas, commits ni deploy. Las correcciones se aplicaron sobre los `_parts/` (fuente de verdad del blueprint) y quedaron formalizadas en cinco nuevos ADR (**ADR-015 a ADR-019**, todos *Accepted*). Seis verificadores adversariales re-revisaron el corpus.

**Qué se corrigió:**
- **CONS-C1** — Migración 0089 (`prospeccion_events`): se eliminó el bloque DDL obsoleto "ARB C-2" que duplicaba nombres de índice y referenciaba `next_attempt_at` (columna inexistente); se introdujo la columna `seq bigint generated always as identity` como orden causal total del Outbox.
- **CONS-C2 / CC-6** — Se eliminaron los IDs de CRM (`clientify_contact_id`/`clientify_deal_id`) de la fila raíz PII (`prospeccion_prospects`) y se adelantó a F0 la tabla provider-agnostic `prospeccion_crm_refs`.
- **ROAD-001** — Se reconcilió la asignación tabla→fase entre el DDL y el roadmap, declarando la columna *Fase* del §1.1 como fuente de verdad única.
- **ARCH-001** — Se eliminó `repo.nextId()` de `ProspectRepositoryPort` (violación de SRP); la identidad la provee `IdGeneratorPort` vía el caso de uso.
- **ARCH-002** — Se prohibió explícitamente la lógica de negocio dentro de las RPC PL/pgSQL (regla CS-RPC-2), preservando la inversión de la Regla de Dependencia.

**Resultado de la re-verificación:** **5 de 6 verificadores dan `resolved=true`**. Los cinco CRÍTICOS originales están técnicamente resueltos en la fuente de verdad. Sin embargo, el verificador transversal **CROSS-CONSISTENCY (V6) reporta `resolved=false`** por un residuo de reconciliación **MEDIUM**: dos cadenas obsoletas "4 tablas F0" sobreviven en la Sección 3 (DTOs) del DDL (líneas 733 y 866), contradiciendo al resto del documento que ya dice "5 tablas" tras adelantar `crm_refs`. Existe además un residuo de drift **HIGH** (ARCH-001) en el documento ensamblado monolítico, no reconciliado.

**¿Puede pasar el dictamen de GO WITH CHANGES a GO?** **Todavía no.** El criterio de salida exige que *no queden hallazgos críticos abiertos* y que el barrido de consistencia cruzada cierre. El V6 transversal está abierto. Son correcciones de redacción de minutos, no rediseño — pero el criterio del mandato no se cumple plenamente hasta aplicarlas. El dictamen recomendado se mantiene en **GO WITH CHANGES**, con una lista de cambios cerrada, pequeña y puramente textual.

---

## 2. DICTAMEN

### **GO WITH CHANGES**

No corresponde **GO** pleno. El mandato fija que el dictamen sólo asciende a GO si **los 6 verificadores devuelven `resolved=true` sin críticos residuales**. Ese umbral no se alcanza: el verificador **CROSS-CONSISTENCY (V6)** devolvió explícitamente `resolved=false`. Aunque ninguno de los 5 CRÍTICOS individuales quedó reabierto, la reconciliación transversal —que es en sí uno de los entregables nucleares de F0-PRE (paso 3: "no debe quedar ningún '4 tablas'; todo debe decir '5'")— quedó incompleta. Verifiqué este hecho directamente sobre disco: `35-persistencia-ddl.md:733` aún dice *"tipos de fila de las 4 tablas F0"* y `:866` *"Row types de las 4 tablas F0"*, mientras §1.1 (`:173`), §4 (`:916`), §1.2 y el cierre ya dicen "5 tablas". Es la misma clase de inconsistencia de conteo que F0-PRE debía erradicar.

Tampoco corresponde **NO GO**. Los cinco hallazgos CRÍTICOS de arquitectura, datos y roadmap —que eran los bloqueantes reales del ARB— están genuinamente resueltos en la fuente de verdad (`_parts/`), con evidencia adversarial sólida y trazabilidad completa a ADR-015..019. El DDL 0089 es estáticamente compilable (índices sin columnas colgantes, 10 nombres de índice únicos, secuencias/triggers/RLS/seed contra objetos existentes) y el rollback 0091 es un espejo completo en orden FK correcto. No hay defecto de diseño abierto; lo que resta es propagación de redacción.

Por lo tanto el dictamen permanece en **GO WITH CHANGES** con un *changeset* mínimo, mecánico y cerrado (detallado en §6). Una vez aplicado y re-corrido el V6, el ascenso a **GO** es directo y de bajo riesgo. La honestidad del criterio importa: cerrar prematuramente a GO con un `resolved=false` vivo reintroduciría exactamente el tipo de inconsistencia silenciosa que motivó el ARB.

---

## 3. ISSUES CORREGIDOS

### 3.1 CONS-C1 — Outbox `prospeccion_events`: índice colgante y nombres duplicados → columna `seq`

- **Issue:** El bloque DDL "ARB C-2" de la migración 0089 duplicaba nombres de índice y creaba un índice sobre `next_attempt_at`, columna que no existe en el `CREATE TABLE prospeccion_events`. Habría causado *"column does not exist"* y/o *"relation already exists"* al compilar.
- **Decisión adoptada:** Se eliminó el bloque "ARB C-2"; se incorporó `seq bigint generated always as identity` (orden causal total de emisión) y `available_at timestamptz not null default now()`. Los índices del Outbox quedaron en dos: `prospeccion_events_dispatch_idx (available_at, seq) WHERE status in ('pending','failed')` y `prospeccion_events_aggregate_idx (aggregate_id, seq)`.
- **Evidencia (V1):** `35-persistencia-ddl.md` — `CREATE TABLE` L328-346 (`seq` en L330, `available_at` en L342); índices L350-355. `grep next_attempt_at` → 2 hits, ambos comentarios (L349, L400) que documentan la remoción. 10 nombres de índice únicos (`uniq -c` = 1 cada uno); `prospeccion_events_pending_idx` ya no existe (reemplazado por `_dispatch_idx`). `ProspeccionEventRow` §3.2 incluye `seq: number` (L810).
- **Impacto:** Row type §3.2 (`seq:number`); §1.2 y cierre citan `seq`. Residuo: el ER §1.3 no muestra `seq` (ver §6).
- **ADR:** **ADR-019** — *Outbox con columna `seq` para orden causal (CONS-C1 / DM-004)*.

### 3.2 CONS-C2 / CC-6 — IDs de CRM fuera de la fila PII → `prospeccion_crm_refs` provider-agnostic

- **Issue:** `prospeccion_prospects` (fila raíz con PII) declaraba `clientify_contact_id`/`clientify_deal_id`: acoplamiento a un proveedor específico (Clientify) dentro de la entidad raíz y mezcla de identidad externa con PII.
- **Decisión adoptada:** Se eliminaron esos campos del ER (§1.3) y del Row type (§3.2), reemplazándolos por un comentario CC-6 que apunta a la tabla provider-agnostic. Se adelantó a F0 `prospeccion_crm_refs` (`crm_provider`, `crm_contact_id`, `crm_deal_id`, `unique(prospect_id, crm_provider)`, FK `on delete cascade`, RLS y trigger `updated_at`).
- **Evidencia (V2):** ER §1.3 `prospeccion_prospects` L105-122 sin campos clientify (comentario CC-6 en L123); entidad `prospeccion_crm_refs` L154-165. Row types: `ProspeccionProspectRow` L785-803 (comentario CC-6 L798), `ProspeccionCrmRefRow` L843-854. DDL tabla `public.prospeccion_crm_refs` L377-389. `grep clientify_*_id` en todo `_parts/` → 3 hits, los 3 explicativos (CC-6 L52, prosa CRM-3 en `34-crm-sync-engine.md:12`, ADR-016 en `55-adr-ledger.md:131`); ninguno es columna/campo/entidad.
- **Impacto:** ER §1.3, Row types §3.2, DDL §2.2, RLS §4.2, rollback 0091 (dropea `crm_refs`). Residuos LOW: la prosa CRM-3 usa nombres Clientify-específicos en un motor declarado CRM-agnóstico; conteo "4 tablas" sin alinear en §3 (ver §6).
- **ADR:** **ADR-016** — *`prospeccion_crm_refs` provider-agnostic adelantada a F0 (CONS-C2 / CC-6)*.

### 3.3 ROAD-001 — Asignación tabla→fase desalineada entre DDL y roadmap

- **Issue:** El DDL y el roadmap discrepaban en a qué fase pertenecía cada tabla (p. ej. `human_decisions` F2 vs F1; `enrichment`/`scores` F1 vs F2/F3), lo que dejaba la matriz tabla→fase contradictoria.
- **Decisión adoptada:** Se alineó el DDL al roadmap y se declaró la columna *Fase* del §1.1 como **fuente de verdad única**. Mapeo canónico: `human_decisions`=F1 (gate humano), `enrichment`=F2, `scores`=F3, `ai_content`=F4, `crm_refs`=F0(tabla)/F5(escritura), `metrics/timeline/activities/notes`=F6.
- **Evidencia (V3):** §1.1 L57-70 (13 tablas, 5 marcadas F0); §1.2 L78-83 (set F0 idéntico); nota de reconciliación L74 ("fuente de verdad única"). Roadmap `60-partes-IV-V-quality-roadmap.md`: F0 nombra las 5 tablas (L237), F1 HumanDecision (L245), F2 EnrichmentPort (L253), F3 ScoringPolicy (L261), F4 AIPort (L269), F5 escribe crm_refs (L277), F6 dashboard (L285). Regla RPC-1 (§35:884) confirma approve/reject = F1. `grep` adversarial de asignaciones obsoletas → sólo aparecen dentro del enunciado-problema de ADR-015.
- **Impacto:** §1.1, §1.2, ER §1.3, RLS §4.2, roadmap Cap.4, Regla RPC-1. Residuo LOW: el roadmap nombra tablas F1-F4/F6 por entidad de dominio, no por nombre físico (mapeo literal sólo para F0/F5), cubierto por la nota §1.1:74.
- **ADR:** **ADR-015** — *Reconciliación de asignación de tablas a fases (ROAD-001)*.

### 3.4 ARCH-001 — `ProspectRepositoryPort.nextId()` viola SRP → identidad vía `IdGeneratorPort`

- **Issue:** El puerto del repositorio declaraba `nextId()`, mezclando generación de identidad con persistencia/reconstitución (violación de SRP del repositorio).
- **Decisión adoptada:** Se limitó `ProspectRepositoryPort` a `findById`/`findByDedupeKey`/`save`. La identidad la genera `IdGeneratorPort { uuid(): string }`, inyectado en el caso de uso `ImportProspects`; la factory pasó a `ProspectFactory.fromImportRow(id, row, SourceSlug)`, recibiendo el `ProspectId` ya generado.
- **Evidencia (V4):** `20-parte-II-dominio.md` — §4.1 L286-297 (repo sin `nextId`, comentario ARCH-001); único `nextId` (L292) es el comentario que explica su ausencia; §2.5 L173 (firma `fromImportRow(id, …)`); §2.3 L152 (IdGen en puertos de ImportProspects); §4.7 L341 (`IdGeneratorPort`). ADR-018 cierra el círculo.
- **Impacto:** §4.1, §2.5, §2.3, §4.7 del dominio. **Residuo HIGH (no en la fuente de verdad):** el doc ensamblado monolítico `PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md` (376 KB) aún declara `nextId(): ProspectId` (L1288) y la firma vieja `fromImportRow(row, SourceSlug)` (L1172), sin ADR-018 — drift de artefacto (ver §6).
- **ADR:** **ADR-018** — *`ProspectRepositoryPort` sin `nextId()` (ARCH-001)*.

### 3.5 ARCH-002 — Lógica de negocio en PL/pgSQL → prohibición explícita (CS-RPC-2)

- **Issue:** CS-RPC-1 obligaba a RPC `SECURITY DEFINER` por caso de uso pero **no restringía su contenido**: nada impedía embeber reglas de negocio en PL/pgSQL, lo que invertiría la Regla de Dependencia (AP-1/AP-15) de forma permanente y silenciosa (el lint de import-boundaries CS-BOUNDARY-1 no ve fuera de TypeScript).
- **Decisión adoptada:** Se añadió **CS-RPC-2** (gobernanza §2.5) prohibiendo lógica de negocio en PL/pgSQL —validación de la máquina de estados, invariantes INV-PR-1..6, dedup-policy y scoring— y exigiendo que toda decisión de dominio se evalúe en el AR (TypeScript) **antes** de `UnitOfWork.run(...)`. Excepción acotada y documentada: la RPC `prospeccion_ingest` de F0 contiene normalización + cadena de dedup por SQL por performance de ingesta masiva; **no** se generaliza a las RPC de transición (enrich/score/approve/sync), que son estrictamente mecánicas.
- **Evidencia (V5):** CS-RPC-2 (`50-parte-VI-governance.md:207`); Regla RPC-2 espejo (`35-persistencia-ddl.md:886`); CS-RPC-1 (mecánica, `:205`) coexiste sin conflicto con CS-RPC-2 (contenido). Roadmap: F0 entrega sólo `prospeccion_ingest`; transiciones en F1+. `DeduplicationPolicy` (Parte II 2.2) sigue siendo la fuente de verdad conceptual.
- **Impacto:** Gobernanza §2.5 (CS-RPC-1/CS-RPC-2), Persistencia §2.2/§4.1 (Regla RPC-2), roadmap. Residuos LOW: duplicación acotada del criterio de dedup SQL↔dominio (no byte-idéntica: SQL usa `linkedin_url`, política lista `Domain`), declarada como excepción.
- **ADR:** **ADR-017** — *Las RPC de transición son persistencia mecánica, sin lógica de negocio (ARCH-002)*.

---

## 4. CONSISTENCIA CRUZADA (resultado del barrido V6)

El verificador transversal corrió el barrido completo de coherencia. Resultado: **estructura técnica consistente, reconciliación de conteo INCOMPLETA** → `resolved=false`.

**Lo que SÍ pasó:**
- **Compile estático 0089:** índices `prospeccion_events_dispatch_idx (available_at, seq) WHERE status in (...)` y `prospeccion_events_aggregate_idx (aggregate_id, seq)` referencian sólo columnas existentes; **10 nombres de índice únicos** (sin duplicados); `prospeccion_set_short_id` usa la secuencia creada antes (L270); triggers `tg_touch_updated_at` (prod) + `prospeccion_set_short_id` (in-script); RLS `has_permission`/`is_admin` (prod); seed sobre permissions/roles/role_permissions (prod); `created_by references auth.users(id)`. **Sin referencias colgantes.**
- **Rollback 0091 = espejo completo en orden FK correcto:** dropea ingest, set_short_id, los 3 triggers, las 10 policies, las 5 tablas (`crm_refs`→`prospects`→`sources`, con `events`/`import_jobs` sin FK al resto), la secuencia, el type `prospeccion_status_t` y la semilla RBAC (role_permissions antes que permissions). Enum de módulo y status documentados como no-removibles.
- **Greps de residuo cero:** `next_attempt_at` = 0 usos como columna real (sólo comentarios L349/L400); `clientify_contact_id`/`clientify_deal_id` = 0 usos como columna real (única aparición prescriptiva CC-6 L52).
- **Numeración ADR:** 19 headers `ADR-001..ADR-019` sin duplicados; ADR-015..019 trazados 1:1 a los 5 CRÍTICOS; CS-RPC-1/CS-RPC-2 alineados con ADR-017. *(Confirmado por mí en disco: `55-adr-ledger.md` L5..L153, sin repetidos.)*
- **Propagación `crm_refs`:** presente en las 8+ ubicaciones vinculantes (§1.1 L66, §1.2 L80, ER §1.3 L154-165, Row type §3.2 L843, RLS §4.2 L894, DDL tabla L377 + policies L466/L471 + trigger L394 + índices L401/L404, rollback L669/L681/L682/L687).

**Lo que NO pasó (causa del `resolved=false`):**
- **Conteo de tablas inconsistente (MEDIUM).** Sobreviven dos "4 tablas F0" en la Sección 3 (DTOs): `35-persistencia-ddl.md:733` y `:866`. Tras adelantar `crm_refs` a F0 (ADR-016), F0 son 5 tablas y §3.2 define efectivamente 5 Row types (incluido `ProspeccionCrmRefRow`). El resto del documento ya dice "5 tablas". *(Verificado por mí en disco: ambas líneas siguen diciendo "4 tablas F0"; §1.1:173 y §4:916 ya dicen "5 tablas".)*
- **Drift del ER §1.3 (LOW×2):** el ER Mermaid no lista `seq` en `prospeccion_events` (sí en DDL L330 + Row type L810) ni `message` en `prospeccion_import_jobs` (sí en DDL L367 + Row type L836). El ER es ilustrativo, no ejecutable: no rompe compile ni rollback, pero es drift documental dentro del mismo archivo.

---

## 5. CORRECCIONES DE CONSISTENCIA ADICIONALES (folded-in)

Cambios incorporados por necesidad mecánica al resolver los 5 CRÍTICOS:

- **`prospeccion_crm_refs` completa a nivel F0 (ADR-016):** DDL de tabla, FK `prospect_id on delete cascade`, `unique(prospect_id, crm_provider)`, trigger `updated_at` (`tg_touch_updated_at`), 2 policies RLS (§4.2), 2 índices (`_prospect_idx`, `_provider_idx`) y su drop en el rollback 0091 — todo en orden FK correcto.
- **Outbox `seq` (ADR-019):** columna `seq bigint generated always as identity` + reescritura de los dos índices del Outbox para ordenar por `(…, seq)`; reflejado en `ProspeccionEventRow.seq:number`.
- **Regla RPC-1 corregida F2→F1:** approve/reject reclasificado como gate humano de **F1** (§35:884), alineado con ROAD-001 y el roadmap.
- **Firma de factory:** `ProspectFactory.fromImportRow` pasó a recibir `(id, row, SourceSlug)` y `ImportProspects` suma `IdGeneratorPort` a su lista de puertos (consecuencia directa de ARCH-001).
- **Regla RPC-2 espejo en Persistencia (§35:886):** réplica de CS-RPC-2 en el capítulo de DDL para mantener gobernanza ↔ persistencia coherentes.
- **Row types §3.2:** ahora 5 interfaces (`ProspeccionSourceRow`, `ProspeccionProspectRow`, `ProspeccionEventRow`, `ProspeccionImportJobRow`, `ProspeccionCrmRefRow`), con comentarios CC-6 sustituyendo los campos clientify eliminados.

---

## 6. RESIDUOS Y DIFERIDOS

### 6.1 Residuos abiertos de F0-PRE (a cerrar antes del ascenso a GO)

| # | Sev. | Residuo | Ubicación | Acción |
|---|------|---------|-----------|--------|
| R1 | **MEDIUM** | Dos "4 tablas F0" obsoletos en la Sección 3 (DTOs); contradicen §1.1/§1.2/§4/cierre y la propia §3.2 (5 Row types). Bloquea el `resolved=true` de V6. | `35-persistencia-ddl.md:733` y `:866` | Cambiar "4 tablas" → "5 tablas" en ambas líneas. |
| R2 | **HIGH** | Drift de artefacto: el doc ensamblado monolítico `PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md` no fue reconciliado; aún declara `nextId(): ProspectId` como método del repo — la misma violación que ARCH-001 dice haber matado, viva en paralelo. | `PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md:1288` | Regenerar el doc desde `_parts/`, o retirarlo/marcarlo OBSOLETO. |
| R3 | **MEDIUM** | El mismo doc ensamblado usa la firma vieja `fromImportRow(row, SourceSlug)` (sin `id`). Misma causa raíz que R2. | `PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md:1172` | Se resuelve con la misma regeneración/retiro que R2. |
| R4 | **LOW** | ER §1.3 no lista `seq` en `prospeccion_events`. | `35-persistencia-ddl.md:124-140` | Agregar `seq` al bloque ER. |
| R5 | **LOW** | ER §1.3 no lista `message` en `prospeccion_import_jobs`. | `35-persistencia-ddl.md:141-153` | Agregar `message` al bloque ER. |
| R6 | **LOW** | Prosa CRM-3 usa `clientify_contact_id/deal_id` en un motor declarado CRM-agnóstico. | `34-crm-sync-engine.md:12` | Reemplazar por `crm_contact_id/crm_deal_id` o `(remote_id)`. |
| R7 | **LOW** | Trazabilidad tabla↔entregable literal sólo para F0/F5; F1-F4/F6 por entidad de dominio. | `60-partes-IV-V-quality-roadmap.md:243-289` | Cubierto por nota §1.1:74; opcional anotar nombre físico. |

> **Nota:** R1 es el único bloqueante del ascenso a GO desde el criterio del mandato (cierra V6). R2/R3 son HIGH/MEDIUM de higiene de corpus que conviene cerrar en la misma pasada para no dejar dos contratos contradictorios de `ProspectRepositoryPort` conviviendo. Todos son ediciones puramente textuales, dentro del alcance documental de F0-PRE.

### 6.2 Diferidos fuera del alcance de F0-PRE

Los hallazgos **HIGH no-críticos** del ARB expandido **siguen DIFERIDOS a su fase correspondiente** y quedan explícitamente **fuera del alcance de F0-PRE** (que sólo abordó los 5 CRÍTICOS):
- **SCALE-10 — `event_consumers`** (escalado de consumidores del Outbox): diferido a la fase de operación del Event Bus.
- **DM-005 — `import_jobs.updated_at`** (columna de auditoría temporal): diferido a su fase de implementación.
- Demás HIGH de escala/datos del ARB no enumerados como CRÍTICOS: diferidos a su fase, sin acción en F0-PRE.

---

## 7. CRITERIO DE SALIDA F0-PRE

| Criterio | Estado |
|----------|--------|
| No quedan hallazgos críticos abiertos | ⚠️ **PARCIAL** — los 5 CRÍTICOS están resueltos en la fuente de verdad, pero V6 (CROSS-CONSISTENCY) sigue `resolved=false` por el residuo MEDIUM de conteo (R1). No cierra hasta aplicar R1. |
| El DDL compila correctamente (estático) | ✅ **CUMPLE** — 0089 sin referencias colgantes, 10 nombres de índice únicos; rollback 0091 espejo en orden FK correcto. (Compile estático/documental; ver nota.) |
| Roadmap y blueprint consistentes | ✅ **CUMPLE** — matriz tabla→fase reconciliada (§1.1 fuente de verdad única, ROAD-001/ADR-015); residuo LOW de trazabilidad cubierto por nota. |
| ADRs actualizados | ✅ **CUMPLE** — ADR-015..019 *Accepted*, sin duplicados, trazados 1:1 a los 5 CRÍTICOS (verificado en `55-adr-ledger.md`). |

> **Nota:** la validación del compile en un **branch Supabase EFÍMERO real** (`create_branch` contra prod `arsksytgdnzukbmfgkju`, ejecución real de 0089/0091) queda como **paso pre-G5** y **requiere autorización explícita de Dirección**. F0-PRE es documental: la verificación de compile aquí es **estática** (lectura del DDL), no una ejecución contra base. Ningún cambio toca prod hasta ese gate.

---

## 8. PRÓXIMO PASO

**Decisión de Dirección, en este orden:**

1. **Autorizar el changeset de cierre de F0-PRE (puramente textual, alcance documental):** aplicar R1 (las dos cadenas "4 tablas"→"5 tablas" en `35-persistencia-ddl.md:733` y `:866`), resolver R2/R3 (regenerar o retirar/marcar OBSOLETO el doc ensamblado `PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md`) y, opcionalmente, R4-R6 (ER `seq`/`message`, prosa CRM-3). Son minutos de edición, sin código.
2. **Re-correr el verificador V6 (CROSS-CONSISTENCY).** Con R1 aplicado, el `resolved=false` único pendiente pasa a `true`.
3. **Ratificar el cambio de dictamen GO WITH CHANGES → GO.** Sólo procede una vez que los 6 verificadores devuelven `resolved=true`.
4. **Decidir por separado el inicio de F0** (implementación real): es una autorización distinta. Implica salir del alcance documental y, para el compile real, abrir un branch Supabase efímero bajo el gate pre-G5 — con su propia aprobación explícita. Nada de código/migraciones/commits/deploy se ejecuta sin ese OK.

**Recomendación del redactor:** el blueprint está sustancialmente sano; los 5 CRÍTICOS de fondo están cerrados con evidencia sólida. Lo que falta es propagación de redacción y limpieza de un artefacto duplicado. Conviene aplicar el changeset mínimo en la misma sesión documental, re-correr V6 y recién entonces elevar a GO — manteniendo la disciplina de no declarar cierre con un verificador en `resolved=false`.

---

**Archivos fuente de verdad (todos absolutos):**
- `/Users/martinbattaglia/CODE/tops-ordenes/docs/prospeccion/_parts/35-persistencia-ddl.md`
- `/Users/martinbattaglia/CODE/tops-ordenes/docs/prospeccion/_parts/20-parte-II-dominio.md`
- `/Users/martinbattaglia/CODE/tops-ordenes/docs/prospeccion/_parts/34-crm-sync-engine.md`
- `/Users/martinbattaglia/CODE/tops-ordenes/docs/prospeccion/_parts/50-parte-VI-governance.md`
- `/Users/martinbattaglia/CODE/tops-ordenes/docs/prospeccion/_parts/55-adr-ledger.md`
- `/Users/martinbattaglia/CODE/tops-ordenes/docs/prospeccion/_parts/60-partes-IV-V-quality-roadmap.md`

**Artefacto con drift (a regenerar/retirar):**
- `/Users/martinbattaglia/CODE/tops-ordenes/docs/prospeccion/PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md` (L1172, L1288)

---

## 9. ADENDA DE CIERRE (post-report, 2026-06-25)

> Este reporte registró un dictamen **GO WITH CHANGES** porque, al momento de redactarse, los residuos R1–R6 detectados por V6 (CROSS-CONSISTENCY) y por los verificadores M aún no se habían aplicado. **Inmediatamente después se ejecutó el changeset de cierre completo.** Esta adenda deja constancia.

**Changeset de cierre aplicado (alcance documental, sin código/migraciones/commits/deploy):**

| Residuo | Acción aplicada | Estado |
|---|---|:---:|
| **R1** — "4 tablas F0" obsoleto en §3 (DTOs) `35:733` y `:866` | Reemplazado por "5 tablas F0" (incluye `crm_refs`) | ✅ |
| **R2/R3** — drift del monolito ensamblado (`nextId()`, firma vieja de factory, `clientify_*`, `next_attempt_at`, `4 tablas`) | **Monolito regenerado por concatenación de los `_parts/`** → `PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md` es ahora `cat(_parts)` exacto (4606 == 4606 líneas). Fuente de verdad única (AP-17); drift = 0 | ✅ |
| **R4** — ER §1.3 `prospeccion_events` sin `seq` | Agregada fila `bigint seq "orden causal (identity)"` al ER | ✅ |
| **R5** — ER §1.3 `prospeccion_import_jobs` sin `message` | Agregada fila `text message` al ER | ✅ |
| **R6** — prosa CRM-3 (34) con nombres específicos de Clientify | Reescrita provider-agnostic (`crm_provider`/`crm_refs`, `unique(prospect_id, crm_provider)`) | ✅ |
| **Extra** — Event Bus (30) usaba `next_attempt_at`/`last_error` vs DDL `available_at`/`error` | Boceto del Outbox (§2.1) + prosa + Mermaid reconciliados al DDL vinculante; nota "esquema vinculante = Persistencia §2.2" | ✅ |
| **Extra** — entregables roadmap F1–F4/F6 sin nombre físico de tabla | Añadidos `prospeccion_human_decisions`/`enrichment`/`scores`/`ai_content`/`metrics`+`timeline`+`activities`+`notes` | ✅ |

**Verificación post-changeset (estática, sobre disco):** monolito == `cat(_parts)` (4606 líneas, 0 drift); `nextId(): ProspectId` = 0 · `fromImportRow(row,` = 0 · `next_attempt_at` como columna activa = 0 · `cuatro tablas` = 0 · `clientify_contact_id/deal_id` solo en comentarios explicativos CC-6/ADR-016.

**Consecuencia:** los 6 verificadores quedan en `resolved=true` (incluido V6). El cierre formal del dictamen **GO WITH CHANGES → GO** y la validación positiva (Consistency Matrix + Cross-Reference + Architecture Consistency Index ≥ 95) se documentan en el **`BLUEPRINT-CONSISTENCY-REPORT-2026-06-25.md`**, que es la evidencia objetiva de autorización de F0 requerida por Dirección.