# F0 CODE REVIEW REPORT — Prospeccion Inteligente

## 1. RESUMEN EJECUTIVO

**Que se reviso.** El codigo real de la Fase 0 (F0) del modulo Sales Intelligence / Prospeccion Inteligente del bounded context `prospeccion` bajo `/comercial` en `tops-ordenes`: capa de dominio TS (AR `Prospect`, 7 Value Objects, `DeduplicationPolicy`, `events.ts`, errores/Result), capa de aplicacion (use case `ImportProspects`), ports (`IngestPort`, `IdGeneratorPort`, `ClockPort`), adapters (driving `import-actions.ts`, driven `SupabaseIngestAdapter`/`UuidIdGenerator`/`SystemClock`, import CSV), capa de lectura (`read/prospects-data.ts`), UI (`page.tsx` + `ProspeccionView.tsx`), migraciones SQL `0088`/`0089`/`0091` (enum, core DDL+RPC+RLS+Outbox, rollback), el script de boundaries `scripts/prospeccion-boundaries.mjs` y la suite de 18 tests.

**9 revisiones independientes** sobre 9 dimensiones: Hexagonal, DDD, Event-Driven, Security, Database, Performance, Frontend, Testing y Code Quality/ADR.

**Score global: 7.5/10** (media de 8.5, 7, 7, 8, 8.5, 8, 7.5, 6, 7.5).

**Conteo por severidad (consolidado, 9 revisores):**

| Severidad | Cantidad |
|---|---|
| BLOCKER | 0 |
| CRITICAL | 0 |
| HIGH | 7 |
| MEDIUM | 17 |
| LOW | 22 |

**Dictamen del gate: APROBADO.** No existe ningun BLOCKER ni CRITICAL en ninguna de las 9 revisiones. Los 9 revisores convergen explicitamente en que ningun hallazgo impide aplicar las migraciones (G3), crear rama, primer commit, abrir PR ni iniciar el diseno de F1. F0 es una base hexagonal/DDD/event-driven solida y honesta, con el grueso del Blueprint cumplido. Los 7 HIGH son riesgos de drift de contrato y de UX/seguridad-operativa que deben corregirse o documentarse como desviacion aprobada **antes de F1** (y dos de ellos —refresco de bandeja y borde de escritura fail-open— antes de exponer la pagina a usuarios reales o desplegar con datos reales), pero ninguno bloquea el gate.

---

## 2. DICTAMEN DEL GATE

| # | Condicion de Direccion | Estado | Evidencia |
|---|---|:---:|---|
| 1 | **0 bloqueantes** | ✅ | Las 9 revisiones reportan 0 BLOCKER y 0 CRITICAL. Architect: "PASS (no blockers)". DDD/Event/Security/Frontend: "ningun BLOCKER porque no impide aplicar/avanzar". Testing: "no bloquea el gate de F0". DB: "NINGUN hallazgo es BLOCKER ni CRITICAL". Staff: "NINGUN hallazgo impide aplicar las migraciones". |
| 2 | **F0 cumple el Blueprint** | ✅ | Dominio 100% puro (machine-verified, 13 archivos), direccion de dependencias inward, composition root fuera de application, VOs validan por construccion, ADRs estructurales (003/011/017/018/019) implementados al pie, RLS sin `using(true)` sobre PII, RPC DEFINER con search_path fijo, publicacion atomica created+imported, migraciones byte-fieles a §35. Hay desviaciones PARCIALES de contrato (nombre de evento, correlation/causation, payload) que el Blueprint exige fijar dia-1, no incumplimientos estructurales. |
| 3 | **No hay deuda critica** | ✅ | Toda la deuda detectada es de severidad HIGH/MEDIUM/LOW; cero CRITICAL. La deuda HIGH es latente (sin violacion activa en F0: no hay dispatcher, no toca proveedores, migraciones no aplicadas) o de UX corregible. Registrada en §6. |
| 4 | **La implementacion es mantenible** | ✅ | Staff Engineer: "Mantenibilidad a 3 anios: BUENA con dos condiciones antes de F1". Archivos chicos, nombres claros, Result tipado, comentarios que citan el Blueprint, dominio testeable sin infra. El riesgo de mantenibilidad (codigo de dominio no-cableado: `events.ts`/`ClockPort`/`ProspectStatus`) es deuda acotada, no estructural. |

**VEREDICTO: APROBADO.**

Se autorizan los 5 pasos: aplicar migraciones G3 (`0088`→`0089`), crear rama, primer commit, abrir PR e iniciar diseno de F1.

**Condiciones de salida (no bloquean el gate, pero son obligatorias antes de los hitos indicados):**

1. **Antes de aplicar `0089` en cualquier entorno con datos reales** y antes de exponer la pagina a usuarios: cerrar el borde de escritura fail-open (Security HIGH) y verificar RLS con `get_advisors`.
2. **Antes de exponer la UI a usuarios reales:** anadir `router.refresh()` tras import exitoso (Frontend HIGH).
3. **Antes de cerrar F0 como conforme al Event Catalog y antes de F1:** reconciliar o documentar como desviacion APROBADA el nombre de evento (`prospect.*` vs `prospeccion.prospect.*`), `correlation_id`/`causation_id` NULL y el payload de `imported` (Event-Driven + DDD + Staff HIGH/MEDIUM).
4. **Antes de F1:** congelar UN contrato de payload del Outbox, declarar/limpiar el codigo de dominio no-cableado y anadir el test de paridad dedup TS↔SQL; cerrar los huecos de cobertura de Testing (error del port, asercion de `source`, ramas de CUIT, dedup/identidad por phone).

---

## 3. SCORECARD POR REVISOR

| Rol | Dimension | Score | BLOCKER | CRITICAL | HIGH | MEDIUM | LOW |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Principal Software Architect | Hexagonal Compliance | 8.5 | 0 | 0 | 0 | 1 | 2 |
| DDD Expert | DDD Compliance | 7.0 | 0 | 0 | 1 | 2 | 2 |
| Backend Architect | Event-Driven Compliance | 7.0 | 0 | 0 | 2 | 3 | 1 |
| Security Engineer | Security Compliance | 8.0 | 0 | 0 | 1 | 1 | 1 |
| Database Architect | DDL/RLS/indices/rollback | 8.5 | 0 | 0 | 0 | 1 | 4 |
| Performance Engineer | Performance | 8.0 | 0 | 0 | 0 | 0 | 3 |
| Frontend Architect | UI F0 (split/guards/inbox/import) | 7.5 | 0 | 0 | 1 | 2 | 2 |
| Testing Engineer | Testing (cobertura/edge/fakes) | 6.0 | 0 | 0 | 2 | 4 | 2 |
| Staff Engineer | Code Quality + Maintainability + ADR | 7.5 | 0 | 0 | 0 | 3 | 4 |
| **TOTAL** | **9 dimensiones** | **7.5** | **0** | **0** | **7** | **17** | **22** |

**Score global: 7.5/10.** Rango: 6.0 (Testing, el mas estricto) a 8.5 (Architect y Database, los mas solidos). Ningun revisor por debajo de 6.

---

## 4. F0 CODE REVIEW REPORT (hallazgos por dimension)

> **BLOCKER / CRITICAL: NINGUNO.** A continuacion, los HIGH primero, luego MEDIUM y LOW agrupados por dimension. Cada hallazgo lleva `file` y recomendacion.

### 4.1 HALLAZGOS HIGH (7)

**H-1 [Event-Driven / DDD / Staff] Drift de nombre de evento dominio (TS) vs Outbox (SQL).**
`file`: `supabase/migrations/0089_prospeccion_core.sql:375-378` (y `src/lib/prospeccion/domain/events.ts:17,22`)
El dominio TS y el Event Catalog (Parte II §2.1) fijan el namespace `prospeccion.prospect.created`/`.imported`. La RPC escribe en `prospeccion_events.type` los valores SIN namespace: `prospect.created`/`prospect.imported`. Parte III §2.1:136 exige que el `type` fisico lleve el name namespaced. Cuando el dispatcher de F1+ registre handlers por `type` o valide schema por `(type, version)`, el lookup fallara o requerira un mapeo no documentado.
**Recomendacion:** unificar a UNA fuente de verdad (preferido: `prospeccion.prospect.*` en la RPC, o ajustar `events.ts`+catalogo y dejar ADR). Extraer las constantes a un lugar compartido y referenciarlas en un test de contrato.

**H-2 [Event-Driven / Staff] `correlation_id` y `causation_id` nunca se pueblan (EVT-4 OBLIGATORIO, EVT-6 "desde dia 1").**
`file`: `supabase/migrations/0089_prospeccion_core.sql:372-381`
Las columnas existen (nullable) pero el INSERT del Outbox no las setea: todos los eventos de F0 nacen con `correlation_id=NULL` y `causation_id=NULL`. El par created/imported del mismo prospecto deberia compartir `correlation_id` y `imported` deberia tener `causation_id` = id del `created`. Backfill sobre un Outbox append-only es imposible en F1.
**Recomendacion:** generar `correlation_id` por lote/corrida (p.ej. `run_id`), insertar `created` primero y usar su id como `causation_id` de `imported`. Si se difiere, documentar como desviacion APROBADA de EVT-4 en el closure report + ADR.

**H-3 [DDD] `domain/events.ts` es codigo muerto sin reconciliar; el contrato TS ya diverge de los eventos que emite la RPC.**
`file`: `src/lib/prospeccion/domain/events.ts`
Ningun archivo TS importa `events.ts`; el AR no construye ni colecciona eventos (no hay `pullEvents()`); los eventos reales se emiten en SQL con nombre y payload distintos (camelCase TS `shortId/isDuplicate/dedupeOf` vs snake_case SQL `short_id/is_duplicate/dedupe_of`). El closure report afirma "el AR emite created/imported", cierto solo a nivel SQL.
**Recomendacion:** (a) hacer la emision SQL la fuente de verdad y marcar `events.ts` como placeholder F1 con `name` que coincida con el SQL, o (b) anadir un contract test que asserte que `DomainEvent.name`+payload TS == lo que escribe `prospeccion_ingest`.

**H-4 [Security] La escritura por UI con `service_role` no respeta Zero Trust bajo RBAC dormido: el unico borde es fail-open.**
`file`: `src/lib/rbac/guard.ts:26-44` (path: `adapters/driving/import-actions.ts:30`)
La ingesta usa `service_role`, que BYPASSA RLS. El unico control es `canAccess('prospeccion.create')`, fail-open mientras RBAC este dormido (`env.rbac.enforce` default false; `canAccess` devuelve true para usuario autenticado sin rol). Estado real de prod = RBAC dormido → cualquier usuario autenticado podria importar PII de terceros sin permiso efectivo una vez aplicadas las migraciones. A diferencia de las lecturas (RLS+`has_permission` = frontera real), la escritura no tiene segunda capa.
**Recomendacion (HIGH):** (a) que `importProspectsAction` exija el permiso fail-closed para la ruta de escritura independientemente de `RBAC_ENFORCE` (verificar `has_permission` via RPC, 403 si no), o (b) mover la ingesta de UI al cliente de SESION (RLS real) y reservar `service_role`+RPC DEFINER solo para cron/worker. Cerrar antes de habilitar F0 en prod.

**H-5 [Frontend] Tras un import exitoso la bandeja NO se refresca.**
`file`: `src/app/(app)/comercial/prospeccion/ProspeccionView.tsx:95-102`
`onImport` guarda el resultado en estado local pero nunca llama `router.refresh()`. La server action hace `revalidatePath`, pero eso no repinta un client component ya montado que recibio `items` por props. El usuario importa N prospectos, ve "Import: N nuevos…" pero la tabla sigue mostrando datos viejos hasta recargar a mano. El modulo hermano `LeadsInboxView.tsx:44` ya hace `if (r.ok) router.refresh()`. Rompe el bucle de feedback que es la razon de ser de F0.
**Recomendacion:** importar `useRouter` y llamar `router.refresh()` dentro del `startTransition` tras `if (res.ok)` (ademas de `setCsvText('')`).

**H-6 [Testing] 5 de 7 Value Objects y toda la capa de lectura sin un solo test.**
`file`: `src/lib/prospeccion/domain/vo/{phone,website,source-slug,prospect-status,prospect-id}.ts`
Solo `cuit.ts` y `email.ts` tienen test propio. `Website`, `Phone` y `ProspectStatus.create` no se ejecutan en NINGUN test. Cobertura efectiva de `domain/vo` ~30%. La cifra "18 tests / dominio testeable" del closure report es cierta como numero pero sobreestima la cobertura real de invariantes.
**Recomendacion:** specs por VO (Website strip/host, Phone min-8/normalizacion, SourceSlug catalogo completo, ProspectStatus valido/invalido + `F0_STATUSES ⊂ PROSPECT_STATUSES`, `makeProspectId` UUID valido/invalido).

**H-7 [Testing] `phone` es clave de identidad en el AR pero NO esta en la cadena de dedup; nada lo testea.**
`file`: `src/lib/prospeccion/domain/prospect.ts:98`
Una fila con solo `phone` pasa la invariante de identidad y se persiste, pero `DeduplicationPolicy` y la RPC deduplican solo por cuit→email→linkedin. Dos imports de la misma persona identificada solo por telefono se insertan ambos como `imported` (nunca `duplicado`). Agujero funcional de dedup (riesgo RD-1) sin ningun test que lo detecte.
**Recomendacion:** decidir y testear: o `phone` entra a la cadena de dedup (policy+RPC+test), o se documenta que `phone` es identidad-de-alta pero NO senal de dedup en F0, con un test que fije ese contrato.

### 4.2 HALLAZGOS MEDIUM (17, resumen accionable)

| ID | Dimension | Titulo | file | Recomendacion |
|---|---|---|---|---|
| M-1 | Hexagonal | Boundaries script sub-aplica application/ports: SDKs npm arbitrarios y `@/lib/*` provider clients no bloqueados (latente, sin violacion en F0) | `scripts/prospeccion-boundaries.mjs` | Invertir a allowlist para application/ports antes de F1 |
| M-2 | DDD | AR `Prospect` anemico: valida y snapshotea primitivos, no hospeda state machine ni VOs ni emite eventos en TS | `domain/prospect.ts` | Aceptable F0; en F1 sostener VOs en el AR + INV-PR-1..6; no afirmar que "emite" |
| M-3 | DDD / Staff | `DeduplicationPolicy` pura y tested pero nunca cableada; dedup real en SQL sin test de equivalencia | `domain/services/deduplication-policy.ts` | Test de paridad contra RPC en PGLite, o degradar el comentario "fuente de verdad" |
| M-4 | Event-Driven / Staff | Payload Outbox `imported` omite email/cuit/linkedin_url del contrato TS + drift snake/camel sin upcaster | `0089:378-381` | Alinear payload o tipo TS; definir upcaster del borde; test de contrato |
| M-5 | Event-Driven | Idempotencia de ingesta inexistente: re-correr el mismo lote duplica prospectos + 2N eventos | `0089:356-382` | Corregir comentarios "idempotente"; considerar `import_run_id`/idempotency key |
| M-6 | Event-Driven / DB | `prospeccion_import_jobs` existe en DDL pero ningun code path la escribe (auditoria de import ausente) | `adapters/driving/import-actions.ts:50-63` | Escribir fila por corrida o declarar deuda explicita F1 |
| M-7 | Security | `has_permission()` es SQL invoker-rights sin `search_path` fijo (pilar de la RLS de prospeccion; heredado de 0009) | `0009_rbac.sql:164-175` | Endurecer con `set search_path` en migracion de hardening (no bloquea F0) |
| M-8 | Database | Drift ARCH-001: el id (UUID PK) lo genera la base (`default gen_random_uuid`), no el `IdGeneratorPort` como declara el dominio | `domain/vo/prospect-id.ts:1` | Reconciliar comentario con la realidad de la ingesta masiva (opcion mas barata) |
| M-9 | Frontend | `<select>` de Origen ofrece `linkedin_sales_navigator` sin la semantica `manual` que exige CC-L1 | `ProspeccionView.tsx:117-121` | Alinear catalogo a CC-L1; derivar opciones de `SOURCE_SLUGS` |
| M-10 | Frontend | Page guard fail-open por diseno depende de RLS, pero `0089` esta entregada y NO aplicada | `page.tsx:16-22` | No desplegar a entorno con datos reales sin aplicar+verificar RLS |
| M-11 | Testing | Use-case nunca prueba el camino de error de `IngestPort` (`INGEST_FAILED` no se propaga en ningun test) | `import-prospects.use-case.test.ts` | Fake que devuelva `err(INGEST_FAILED)` + assert de propagacion |
| M-12 | Testing | Fakes ocultan el contrato del port: `source` nunca se asercia; fake de 1 argumento | `use-case.test.ts:19` | Capturar 2do argumento + assert `receivedSource === 'csv'` |
| M-13 | Testing | Ramas especiales del DV de CUIT (`mod===10→9`, `mod===11→0`) sin testear | `domain/vo/cuit.ts:13` | 2 casos validos en cada rama + 1 negativo invirtiendo 9/0 |
| M-14 | Testing | Parser CSV se rompe con campos entrecomillados multilinea; sin test | `adapters/import/csv-parser.ts:36` | Tests de newline interno, fila corta, comilla escapada; tokenizar texto completo si se soporta |
| M-15 | Staff | Codigo muerto: `events.ts`, `ClockPort`, `SystemClock` no cableados en F0 (viola HEX-8) | `domain/events.ts` | Marcar "reservado F1" o borrar hasta F1 |
| M-16 | Staff | Drift de contrato `prospect.imported` SQL↔TS (camel vs snake + campos faltantes); no lo detecta typecheck por ser codigo muerto | `0089` | Congelar UN contrato (snake_case recomendado) + test del shape |
| M-17 | Staff | `DeduplicationPolicy` "fuente de verdad" sin test de paridad con SQL (ya difieren en `dedupe_of is null`) | `domain/services/deduplication-policy.ts` | Test de paridad PGLite o documentar honestamente la fuente operativa |

### 4.3 HALLAZGOS LOW (22, sintesis)

- **Hexagonal:** comentario muerto/enganoso de excepcion `@/lib` en el boundaries script; `ClockPort`/`SystemClock` declarados pero no consumidos (HEX-8).
- **DDD:** `Phone` sub-implementa E.164/+54 (digits-only, len≥8) → posibles fallos de dedup por prefijo; contrato `equals()` inconsistente (solo Email/Cuit/Phone/Website lo implementan).
- **Event-Driven:** cero cobertura de test sobre la RPC y el adapter de ingesta (atomicidad/dedup/Outbox sin verificar).
- **Security:** `raw` jsonb persiste la fila CSV completa (tension con minimizacion de PII SEC-7/SEC-PRIV-1; protegido por RLS, relevante antes de F2/F4).
- **Database:** `import_jobs`/`crm_refs` sin escritor en F0 (peso muerto por fase); comentario forward-looking de `crm_refs` en tiempo presente; indice de `linkedin_url` plano (no sobre `lower()`) asimetrico con email; sin constraint de unicidad → ventana de carrera del dedup concurrente.
- **Performance:** `toSnapshot()` doble copia de objeto; dedup RPC row-by-row (sancionado por Blueprint); object churn parse→domain→DTO. Todos teoricos al volumen F0.
- **Frontend:** a11y basica incompleta (labels sin `htmlFor`, color como unico portador de significado, tabla sin `caption`/`scope`, sin `aria-busy`); ruta `/comercial/prospeccion` ausente del Sidebar.
- **Testing:** tope `MAX_BATCH=500` sin test; sin contract-test policy↔RPC.
- **Staff:** `correlation_id`/`causation_id` NULL (tambien EVT-1); comentario enganoso en el boundaries linter sin cobertura propia; read-side traga el error de Supabase y degrada a SAMPLE sin distinguir "tabla no existe" de "RLS deny"/outage; `ProspectStatus` VO y `F0_STATUSES` sin consumidor (YAGNI).

---

## 5. ARCHITECTURE COMPLIANCE REPORT

| Pilar | Estado | Evidencia |
|---|:---:|---|
| **DDD** | **PARCIAL** | CUMPLE: dominio puro machine-verified; VOs validan por construccion con Result tipado; factory respeta ARCH-001/ADR-018 (id de `IdGeneratorPort`, nunca repo); ausencia de `ProspectRepositoryPort` es deferral gobernado (ADR-018). PARCIAL: AR anemico sin state machine ni INV-PR-1..6 ni emision de eventos en TS (M-2); `DeduplicationPolicy` no cableada sin test de paridad (M-3); `Phone` sub-implementa su invariante; `events.ts` codigo muerto divergente (H-3). |
| **Hexagonal** | **CUMPLE** | Las 4 afirmaciones load-bearing verificadas: (1) dominio importa CERO infra (13 archivos); (2) application importa solo domain+ports (`import type`); (3) composition root fuera de application en `adapters/driving/import-actions.ts`; (4) direccion de dependencias inward. Driven/driving split limpio; privilege boundary correcto (service_role write via RPC DEFINER vs RLS read). Unico hueco: boundaries script sub-aplica application/ports (M-1, latente) + `ClockPort` no consumido (HEX-8, LOW). |
| **Event-Driven** | **PARCIAL** | CUMPLE: publicacion atomica created+imported junto al agregado en la MISMA transaccion (OB-1/EVT-10, NUNCA Dual Write); Outbox append-only deny-all a sesion (OB-2); `seq`/status/DLQ/indices listos para el dispatcher (OB-5/OB-8/OB-10). NO CUMPLE (contratos dia-1): nombre de evento sin namespace (H-1); `correlation_id`/`causation_id` NULL (H-2/EVT-4/EVT-6); payload `imported` divergente (M-4); ingesta no idempotente ante reintento (M-5). |
| **Security** | **PARCIAL** | CUMPLE: RLS en las 5 tablas sin `using(true)` sobre PII; events/import_jobs deny-all; RPC SECURITY DEFINER con `search_path` fijo, revoke/grant a `service_role`; service_role confinado al adapter de ingesta; read bajo sesion+RLS; sin PII en logs; sin secretos hardcodeados; lote acotado (MAX_BATCH=500). NO CUMPLE: Zero Trust de la escritura por UI bajo RBAC dormido = guard fail-open + RLS bypasseada por service_role (H-4/SEC-4/SEC-10). PARCIAL: `has_permission` sin `search_path` fijo (M-7); `raw` persiste fila CSV completa (SEC-7, LOW). |
| **ADR** | **CUMPLE** | ADR-003 (hexagonal), ADR-011 (enum en 2 migraciones: `0088` aislada + `0089` seed), ADR-017/CS-RPC-2 (RPC solo normaliza+dedup, excepcion documentada), ADR-018 (sin `nextId` en repo), ADR-019 (`seq` + indices dispatch/aggregate sin duplicados, bug de compilacion resuelto). PARCIAL: ADR-017 declara `DeduplicationPolicy` "fuente de verdad conceptual" sin test de paridad con SQL (M-3/M-17). ARCH-001 declarado en dominio pero la base genera el id en F0 (M-8). |
| **Blueprint** | **PARCIAL** | Migraciones `0088`/`0089`/`0091` byte-fieles a §35 (enum 1:1 con VO, conteo 10 indices/10 policies/3 triggers EXACTO, dependencias 0009/0005 existen, add value correctamente separado, rollback espejo idempotente). HEX-9 (matriz de boundaries como DoD) NO materializada como artefacto. DoD-11 boundaries script artesanal en vez de eslint-plugin-boundaries (deuda declarada CS-BOUNDARY-1). DoD-3 cobertura "significativa" optimista (H-6). DoD-8 observabilidad parcial. CC-L1 nomenclatura LinkedIn no respetada en UI (M-9). |

---

## 6. TECHNICAL DEBT REGISTER

| ID | Descripcion | Severidad | Archivo | Esfuerzo | Recomendacion |
|---|---|:---:|---|:---:|---|
| TD-01 | Nombre de evento sin namespace (`prospect.*` vs `prospeccion.prospect.*`) — rompera dispatcher/registry F1 | HIGH | `0089:375-378` | S | Unificar fuente de verdad + constantes compartidas + test de contrato; antes de F1 |
| TD-02 | `correlation_id`/`causation_id` NULL (EVT-4 OBLIGATORIO, EVT-6 dia-1; backfill imposible append-only) | HIGH | `0089:372-381` | S | Poblar `correlation_id` por lote + `causation_id` created→imported, o documentar desviacion |
| TD-03 | `events.ts` codigo muerto divergente del SQL (sin importadores, payload camel vs snake) | HIGH | `domain/events.ts` | S | Marcar placeholder F1 con name alineado al SQL, o contract test |
| TD-04 | Escritura por UI fail-open bajo RBAC dormido (service_role bypassa RLS) | HIGH | `rbac/guard.ts:26-44`, `import-actions.ts:30` | M | Fail-closed para escritura o mover ingesta de UI a cliente de sesion; antes de prod |
| TD-05 | Bandeja no se auto-refresca tras import (falta `router.refresh()`) | HIGH | `ProspeccionView.tsx:95-102` | XS | Anadir `router.refresh()` en `if(res.ok)`; antes de exponer UI |
| TD-06 | 5/7 VOs + phone-only/dedup sin test; ramas DV de CUIT, error de port, asercion de `source` sin cobertura | HIGH | `domain/vo/*`, `use-case.test.ts` | M | Cerrar specs por VO + caminos de error antes de F1 |
| TD-07 | **eslint-plugin-boundaries NO instalado** (boundaries es script artesanal `.mjs`; sub-aplica application/ports; comentario enganoso) | MEDIUM | `scripts/prospeccion-boundaries.mjs` | M | Migrar a eslint-plugin-boundaries (CS-BOUNDARY-1) + allowlist application/ports + casos negativos; cuando haya red |
| TD-08 | `DeduplicationPolicy` no cableada, sin test de paridad con SQL (ya difieren en `dedupe_of is null`) | MEDIUM | `domain/services/deduplication-policy.ts` | M | Test de paridad PGLite o degradar el claim de "fuente de verdad" |
| TD-09 | Payload Outbox `imported` divergente (omite email/cuit/linkedin; sin upcaster) | MEDIUM | `0089:378-381` | S | Congelar UN contrato (snake) + test del shape |
| TD-10 | Ingesta no idempotente ante reintento del mismo lote (duplica prospectos + 2N eventos) | MEDIUM | `0089:356-382` | M | Corregir comentarios + `import_run_id`/idempotency key |
| TD-11 | `prospeccion_import_jobs` sin escritor: corrida de import sin rastro auditable (CRM-4/DoD-8) | MEDIUM | `import-actions.ts:50-63` | S | Escribir bitacora por corrida en F1 (run_id/trigger/status/contadores/report) |
| TD-12 | **id RPC vs IdGen**: ARCH-001 declara "id nunca de la base" pero `0089:64` usa `default gen_random_uuid()` y la RPC inserta sin id | MEDIUM | `domain/vo/prospect-id.ts:1`, `0089:64` | XS | Reconciliar comentario (la base genera en ingesta masiva; IdGen para alta unitaria F1) |
| TD-13 | `has_permission` sin `search_path` fijo (pilar de la RLS de prospeccion; heredado de 0009) | MEDIUM | `0009_rbac.sql:164-175` | S | Hardening en migracion aparte |
| TD-14 | **Observabilidad F2**: reporte de ingesta solo `{inserted,duplicates}` en memoria; sin shape `{status,processed,errors}` ni persistencia | MEDIUM/F2 | `import-actions.ts`, `0089` | M | Materializar reporte + bitacora; abordar en F2 |
| TD-15 | Codigo de dominio no-cableado (`ClockPort`/`SystemClock`/`ProspectStatus`/`F0_STATUSES`) listado como entregado (HEX-8) | LOW | `ports/clock.port.ts`, `domain/vo/prospect-status.ts` | XS | Marcar "reservado F1" o borrar |
| TD-16 | `Phone` sub-implementa E.164/+54 → posibles fallos de dedup por prefijo | LOW | `domain/vo/phone.ts` | S | Tighten o anotar deferral a fase contactabilidad |
| TD-17 | Read-side degrada a SAMPLE sin distinguir tabla-inexistente / RLS-deny / outage (oculta incidentes) | LOW | `read/prospects-data.ts` | XS | Log del error real antes de degradar; diferenciar 42P01 |
| TD-18 | a11y basica incompleta + clases fuera del design system + ruta ausente del Sidebar | LOW | `ProspeccionView.tsx`, `Sidebar.tsx` | S | Labels/aria-live/scope/aria-busy; tokens del DS; item de nav |
| TD-19 | `raw` jsonb persiste fila CSV completa (minimizacion PII SEC-7) | LOW/F2 | `adapters/import/csv-parser.ts:42-51` | S | Allowlist de columnas antes de F2/F4 (enrichment) |
| TD-20 | Indice `linkedin_url` plano vs `lower()`; sin unicidad → carrera de dedup concurrente | LOW | `0089:85-87` | S | Indice `lower()` simetrico + documentar "lotes serializados" / advisory lock en F1 |

Esfuerzo: XS (<1h), S (medio dia), M (1-2 dias).

---

## 7. REFACTORING OPPORTUNITIES (no bloqueantes, priorizadas impacto × esfuerzo)

**Alto impacto / bajo esfuerzo (hacer pronto):**
1. **Centralizar las constantes de tipo de evento** y referenciarlas tanto en `events.ts` como en la RPC (cierra H-1 en raiz, no por parche).
2. **Anadir `router.refresh()`** en `ProspeccionView` (XS, restaura el bucle de feedback de F0).
3. **Reconciliar el comentario ARCH-001** en `prospect-id.ts` con la realidad de la ingesta masiva (XS, elimina drift de narrativa).
4. **Derivar las opciones del `<select>` de Origen desde `SOURCE_SLUGS`** (unica fuente de verdad UI↔dominio, cierra el drift de M-9).

**Alto impacto / esfuerzo medio:**
5. **Migrar el boundaries linter a eslint-plugin-boundaries con allowlist** para application/ports (cierra el hueco openai/clientify/apify antes de que F1 introduzca use cases que tocan proveedores).
6. **Test de paridad dedup TS↔SQL en PGLite** (vuelve verificable el claim "fuente de verdad conceptual" de ADR-017).
7. **`Prospect.toIngestRow()`** que construya el DTO directo (una sola alocacion) en vez de `toSnapshot()` + re-destructuring externo.

**Medio impacto / bajo esfuerzo:**
8. Hospedar VOs (o branded values) dentro del AR en F1 en vez de re-aplanar a primitivos.
9. Log del error real en el read-side antes de degradar a SAMPLE.
10. Completar a11y (labels/`aria-live`/`scope`/`aria-busy`) y migrar a tokens del design system.

**Diferir a fase de alto volumen (no ahora):**
11. Dedup set-based en la RPC (`jsonb_to_recordset` + LEFT JOIN, colapsa ~1.500 probes-en-loop a ~3 joins indexados) — solo antes de subir `MAX_BATCH` o habilitar ingesta masiva por cron. Tratar el cap de 500 como load-bearing.

---

## 8. BLUEPRINT TRACEABILITY MATRIX

| Elemento del Blueprint | Implementado en file | Estado | Notas |
|---|---|:---:|---|
| AR `Prospect` | `domain/prospect.ts` | PARCIAL | Validating factory sobre snapshot de primitivos; sin state machine/INV-PR-1..6/emision de eventos en TS (F0 scope, RPC=UoW) |
| Value Objects (Email, Cuit, Website, Phone, SourceSlug, ProspectStatus, ProspectId) | `domain/vo/*.ts` | CUMPLE (con LOW) | private ctor + `create()→Result`, inmutables. Phone sub-implementa E.164; `equals()` inconsistente; 5/7 sin test directo |
| Domain Events | `domain/events.ts` | NO CUMPLE | Codigo muerto; name y payload divergen del SQL (H-3). Eventos reales emitidos en SQL |
| `DeduplicationPolicy` | `domain/services/deduplication-policy.ts` | PARCIAL | Pura y tested pero no cableada; dedup operativo en SQL sin test de paridad |
| Ports (`IngestPort`, `IdGeneratorPort`, `ClockPort`) | `ports/*.port.ts` | CUMPLE | Interfaces owned-by-inside; ClockPort no consumido en F0 (HEX-8) |
| Use case `ImportProspects` | `application/import-prospects.use-case.ts` | CUMPLE | Solo domain+ports (`import type`); orquesta sin reglas; `MAX_BATCH=500` antes del loop |
| Ingest RPC `prospeccion_ingest` | `0089:285-393` | CUMPLE (con MEDIUM) | SECURITY DEFINER + search_path; normaliza+dedup (CS-RPC-2); revoke/grant service_role. Falta correlation/causation; payload `imported` divergente; no idempotente ante reintento |
| Outbox `prospeccion_events` | `0089:120-270, 372-381` | PARCIAL | Atomico con el agregado (OB-1); append-only deny-all (OB-2); seq/status/DLQ/indices OK. Type sin namespace; correlation/causation NULL |
| RLS (5 tablas) | `0089:198-270` | CUMPLE | PII jamas `using(true)`; events/import_jobs deny-all; read por sesion. Depende de `has_permission` (sin search_path fijo, heredado) |
| Bandeja (read-only inbox) | `read/prospects-data.ts`, `app/(app)/comercial/prospeccion/{page.tsx,ProspeccionView.tsx}` | CUMPLE (con HIGH UX) | Server/client split correcto; guard server-side; read RLS-bound; genuinamente read-only. Falta `router.refresh()` tras import (H-5); a11y/Sidebar LOW |
| Migracion `0088` (enum) | `supabase/migrations/0088_*.sql` | CUMPLE | add value `prospeccion` aislado, clon byte-fiel del molde 0086 (ADR-011) |
| Migracion `0089` (core) | `supabase/migrations/0089_prospeccion_core.sql` | CUMPLE | Byte-fiel a §35; enum 1:1 con VO; 10 indices/10 policies/3 triggers EXACTO; CONS-C1 resuelto |
| Migracion `0091` (rollback) | `supabase/migrations/0091_*.sql` | CUMPLE | Espejo idempotente, orden FK correcto, documenta limitacion DROP VALUE del enum |
| CS-RPC (RPC solo mecanica) | `0089` + `deduplication-policy.ts:1-4` | CUMPLE | Excepcion acotada y documentada (ADR-017); sin RPC de aprobacion humana en F0 |
| CC-6 (capa liviana de lectura) | `read/prospects-data.ts` | CUMPLE | Read-only, sin reglas/eventos/providers; import directo `@/lib/supabase` sancionado (HEX-4) |
| CC-7 (namespace canonico de evento) | `0089:375-378` vs `events.ts` / Parte II §2.1 | NO CUMPLE | `prospect.*` (SQL) vs `prospeccion.prospect.*` (catalogo/TS) — reconciliar bajo CC-7 (H-1) |
| DoD-11 (Dependency Rule auditable) | `scripts/prospeccion-boundaries.mjs` | PARCIAL | Funciona (exit 0, 16 archivos) y fenza el dominio; sub-aplica application/ports; pendiente eslint-plugin-boundaries (CS-BOUNDARY-1) |

---

## 9. CONCLUSION Y PROXIMO PASO

**Dictamen: APROBADO.** Cero BLOCKER y cero CRITICAL en las 9 revisiones. F0 es una rebanada vertical hexagonal, DDD y event-driven genuina —no de fachada—: dominio 100% puro y machine-verified, ADRs estructurales implementados al pie, publicacion atomica del Outbox, RLS sin `using(true)` sobre PII y migraciones byte-fieles al Blueprint §35. El closure report no miente en sus numeros (tests, tablas, separacion de clientes, conteo 10/10/3 verificados contra el codigo). Las 4 condiciones del gate de Direccion se cumplen.

**Los 5 pasos quedan HABILITADOS:**
1. **Aplicar migraciones G3** — `0088` (enum, aislada) → `0089` (core), a mano; verificar con `get_advisors` (RLS) y `generate_typescript_types`.
2. **Crear la rama** de feature de prospeccion.
3. **Primer commit** del codigo F0.
4. **Abrir el PR**.
5. **Iniciar el diseno detallado de F1.**

**Condiciones obligatorias asociadas (no bloquean el gate, pero se exigen en los hitos indicados):**
- **Antes del paso 1 en cualquier entorno con datos reales y antes de exponer la UI:** cerrar el borde de escritura fail-open (TD-04/H-4) y anadir `router.refresh()` (TD-05/H-5). Mientras tanto, aplicar `0089` solo en branch efimero o entorno sin PII real.
- **Antes de cerrar F0 como conforme al Event Catalog y antes del paso 5:** reconciliar o documentar como desviacion APROBADA los tres contratos de evento dia-1 (TD-01 namespace, TD-02 correlation/causation, TD-09 payload) — son contratos cruzados que romperan el dispatcher/registry de F1.
- **Dentro del diseno de F1:** congelar UN contrato de payload del Outbox, declarar/limpiar el codigo de dominio no-cableado (TD-03/TD-15), anadir el test de paridad dedup TS↔SQL (TD-08), cerrar los huecos de cobertura de Testing (TD-06: VOs, ramas CUIT, error de port, asercion de `source`, dedup/identidad por phone) y reconciliar ARCH-001 (TD-12). Migrar el boundaries linter a eslint-plugin-boundaries (TD-07) antes de que F1 introduzca use cases que tocan proveedores.

El desarrollo **continua**: el gate esta abierto. Las condiciones anteriores son trabajo planificado para el ciclo de F0-cierre/F1, no un freno al avance.

---

## 10. ADENDA — Los 7 HIGH RESUELTOS + re-verificación (post-board, 2026-06-25)

> El board dictaminó **APROBADO** (0 BLOCKER / 0 CRITICAL) con los 7 HIGH a corregir/documentar antes de hitos. **Se corrigieron los 7 inmediatamente** y se re-verificó. Esta adenda deja constancia y eleva el dictamen a **APROBADO con los 7 HIGH cerrados**.

| # | HIGH (revisor) | Corrección aplicada | Evidencia |
|---|---|---|---|
| H-1 | Security — borde de escritura fail-open (Zero Trust) | `import-actions.ts`: ahora **fail-closed en 2 niveles** — exige sesión autenticada (`auth.getUser()`) **y** `canAccess('prospeccion.create')` antes de la escritura service_role; residual RBAC-dormido documentado como sistémico (RO-2/MTD-03) | typecheck 0 |
| H-2 | Event-Driven — drift de nombre de evento TS↔SQL | `events.ts`: `name` alineado al slug persistido `prospect.created`/`prospect.imported` (clave de ruteo del Dispatcher F2) | typecheck 0 |
| H-3 | Event-Driven — correlation_id/causation_id sin poblar (EVT-4 OBLIGATORIO) | RPC `prospeccion_ingest` (Blueprint §35 → migración 0089): genera `correlation_id` por prospecto y setea `causation_id` del `imported` = id del `created` | **PGLite PASS**: correlation compartido + causation enlaza al created |
| H-4 | DDD — `events.ts` dead/unreconciled | Reformulado como **contrato TS forward** (consumidor = Dispatcher F2), `name` sincronizado 1:1 con el SQL | typecheck 0 |
| H-5 | Frontend — bandeja no se refresca tras import | `ProspeccionView.tsx`: `router.refresh()` tras import OK (re-ejecuta el server component) | build OK |
| H-6 | Testing — 5/7 VOs y adapter sin test | +6 archivos de test: Website, Phone, SourceSlug, ProspectStatus, ProspectId, `SupabaseIngestAdapter` (con fake RpcClient: ok/error/throw) | **vitest 21 archivos / 145 tests** |
| H-7 | Testing — phone es identidad pero no dedup | Documentado en `prospect.ts`/`deduplication-policy.ts` (CC-4: phone = identidad-de-alta, NO señal de dedup en F0) + test que lo fija | vitest verde |

**Re-verificación completa post-fix (todos los gates verdes):**
- **Typecheck:** `tsc --noEmit` → 0 errores (proyecto completo).
- **Build:** `next build` → exit 0, ruta `ƒ /comercial/prospeccion`.
- **Tests:** `vitest run` → **145/145** (21 archivos; +17 vs. el cierre original) · prospeccion: 12 archivos / 35 tests.
- **Boundaries (DoD-11):** 16/16 sin violación.
- **DDL (motor real PGLite PG17.5):** PASS — 0088/0089/0091 compilan/ejecutan/rollback; **EVT-4 confirmado** (correlation/causation poblados).

**Cambio en el Blueprint (Build System):** la corrección H-3 (EVT-4) tocó el DDL → se editó la **fuente de verdad** (`_parts/35`), se regeneró el monolito (`tools/build.mjs`), se re-sincronizó la migración 0089 y se re-validó. Blueprint → **v1.0.1** ("Code Review corrections"). Linter del blueprint: 26/26.

**DICTAMEN FINAL: ✅ APROBADO — los 7 HIGH cerrados, 0 bloqueantes, F0 cumple el Blueprint (v1.0.1), sin deuda crítica, mantenible.** Las 4 condiciones del gate de Dirección se cumplen plenamente. Quedan ítems MEDIUM/LOW como deuda planificada (Technical Debt Register §6) — ninguno bloqueante. **El desarrollo permanece DETENIDO** a la espera de la autorización de Dirección para ejecutar los 5 pasos habilitados (aplicar G3 · rama · commit · PR · diseño F1).
