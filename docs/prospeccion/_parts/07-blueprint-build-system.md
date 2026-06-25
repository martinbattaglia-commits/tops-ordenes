# Blueprint Build System (política del documento)

> **Estado:** normativo · **Naturaleza:** meta-gobernanza del propio documento.
> Esta sección establece que la Constitución Arquitectónica se gestiona **igual que el código fuente**: tiene fuentes de verdad, proceso de build, validaciones, linter, pipeline y criterios de publicación. Surge de la reconciliación F0-PRE (2026-06-25), donde se detectó que el documento consolidado había driftado respecto de sus partes — una inconsistencia **entre artefactos**, no de arquitectura. La causa raíz era tener **dos fuentes de verdad**; esta política la elimina.

## BB-1 — Única fuente de verdad: `docs/prospeccion/_parts/`
Los archivos de `docs/prospeccion/_parts/` son la **única fuente oficial de verdad** del Blueprint. Toda regla, contrato, DDL, diagrama y decisión vive en un `_part`. Equivale al *source* de un producto de software (AP-17, "One Source of Truth", aplicado al propio documento).

## BB-2 — El consolidado es un artefacto generado
`PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md` es **exclusivamente un artefacto generado** por concatenación de los `_parts` en el orden canónico. Equivale al *build output* (un binario, un bundle). **NUNCA DEBE editarse manualmente.** Una edición manual del consolidado es una violación de esta política y **DEBE** descartarse y regenerarse desde los `_parts`. (Verificable: el consolidado es byte-equivalente a `cat(_parts)`.)

## BB-3 — Todo cambio va en los `_parts` y luego se regenera
Cualquier modificación del Blueprint **DEBE** realizarse **exclusivamente** sobre los `_parts`. Tras editar, **DEBE** regenerarse el consolidado con el comando de build. PROHIBIDO el flujo inverso (editar el consolidado y "bajar" el cambio a los parts). El orden canónico de ensamblado es:

```
00-front-matter · 05-convenciones-canonicas · 07-blueprint-build-system · 10-parte-I-estrategico ·
15-event-storming · 20-parte-II-dominio · 25-hexagonal-estratificada · 30-parte-III-tecnica ·
32-event-bus-operational · 33-ai-provider-manager · 34-crm-sync-engine · 35-persistencia-ddl ·
36-data-governance · 40-parte-VII-enterprise · 45-security-rules · 50-parte-VI-governance ·
55-adr-ledger · 60-partes-IV-V-quality-roadmap
```

**Comando de build (canónico):** `node docs/prospeccion/tools/build.mjs` (regenera el consolidado desde la lista de orden única definida en `tools/build.mjs`). El orden vive en **un solo lugar** (`tools/build.mjs`); este capítulo lo refleja, no lo redefine.

## BB-4 — Blueprint Build Verification (validación automática)
Antes de aceptar cualquier estado del Blueprint, la **Blueprint Build Verification** (`node docs/prospeccion/tools/build.mjs --check`) **DEBE** verificar, de forma determinística:
1. **Build idéntico** — el consolidado en disco es **exactamente** la concatenación de los `_parts` (diff vacío). Si difiere → el consolidado fue editado a mano (viola BB-2) o está desactualizado → **error**.
2. **Sin referencias rotas** — toda cita interna resuelve (ver BB-5).
3. **Sin duplicaciones** — no hay identificadores duplicados con definiciones distintas (p. ej. dos `ADR-003`, dos índices con el mismo nombre).
4. **Sin contradicciones** — los chequeos cruzados del linter (BB-5) pasan.

Un fallo de cualquier punto **bloquea** la publicación de una versión oficial.

## BB-5 — Blueprint Linter
El **Blueprint Linter** (`node docs/prospeccion/tools/blueprint-lint.mjs`) verifica automáticamente, sobre los `_parts`, y **toda inconsistencia produce un error de validación** (exit ≠ 0):

| Chequeo | Regla |
|---|---|
| **Referencias cruzadas** | Toda cita `ADR-NNN`, `INV-PR-n`, `AP-n`, `HEX-n`, `NFB-n`, `CC-n`, `DoD-n`, `BB-n` resuelve a una definición existente y dentro del rango definido. |
| **Capítulos / secciones** | Las partes del orden canónico existen; los encabezados `#`/`##` no quedan huérfanos. |
| **ADR** | Numeración única en el Ledger (`55`); ningún `ADR-NNN` con dos definiciones distintas en el corpus. |
| **Reglas** | `INV-PR` ≤ máx definido; `AP` ≤ 17; `NFB` ≤ 8; `CC` ≤ máx; `DoD` ≤ máx; sin huecos no documentados. |
| **DDD** | La máquina de estados y los eventos coinciden entre Event Storming (`15`) y Dominio (`20`) vía la tabla canónica de estados (CC-7). |
| **Roadmap** | Toda tabla del catálogo (`35` §1.1) tiene fase; la fase coincide con los entregables del roadmap (`60`). |
| **DDL** | Cada índice/policy/trigger referencia solo columnas existentes; nombres de índice únicos; sin columnas "fantasma" (un índice que referencie una columna ausente del `CREATE TABLE`); rollback espejo del create. |
| **RPC / DTO** | Las firmas de RPC y los DTOs/Row types coinciden; sin columnas de proveedor en la fila raíz (CC-6: `clientify_*` solo en `prospeccion_crm_refs`). |
| **Event Catalog** | Todo evento (incluidos `*.failed`) del catálogo (`20`) aparece en el transporte (`30`/`32`) con el mismo slug. |
| **Tablas** | Todo `prospeccion_*` citado existe en el catálogo `35` §1.1; el número de tablas F0 es idéntico en todo el corpus (sin conteos obsoletos). |
| **Fases** | `F0..F7` (+ `F0-PRE`, `F1.5/F5-lite`) usadas consistentemente. |
| **Nombres** | Nombres canónicos de tabla únicos (`ai_content` no `ai_analysis`; `events` no `outbox` como tabla física). |
| **Diagramas** | Cada bloque de diagrama mermaid tiene apertura y cierre (fences balanceadas); entidades/columnas referenciadas existen. |

## BB-6 — Blueprint CI Pipeline
Antes de declarar una **versión oficial** del Blueprint, el **Blueprint CI Pipeline** (`node docs/prospeccion/tools/blueprint-ci.mjs`) **DEBE** ejecutar, en orden, y **todas** deben resultar satisfactorias:

1. **Build** (BB-3) — regenerar el consolidado.
2. **Blueprint Build Verification** (BB-4) — consolidado == `cat(_parts)`.
3. **Blueprint Linter** (BB-5) — referencias, ADR, reglas, DDL, RPC/DTO, Event Catalog, tablas, fases, nombres, diagramas.
4. **Cross-Reference Validation** — subconjunto del linter, reportado por separado.
5. **Consistency Matrix** — las 18 relaciones (validación semántica del ARB; ver `BLUEPRINT-CONSISTENCY-REPORT`).
6. **Architecture Consistency Index** — índice ≥ **95/100** (umbral fijado por Dirección).

> **Separación determinístico / semántico.** Los pasos 1–4 son **determinísticos** y los ejecuta el tooling (`tools/`). Los pasos 5–6 incluyen juicio **semántico** (¿dos artefactos *significan* lo mismo?) y los ejecuta el panel del ARB (workflow de validación), apoyándose en la evidencia objetiva de 1–4. Una versión oficial **solo** se emite si los 6 pasos pasan; el resultado se archiva en `BLUEPRINT-CONSISTENCY-REPORT-<fecha>.md`.

## BB-7 — Criterios de publicación (versión oficial)
Una **versión oficial** del Blueprint (cambio de `Versión`/`Estado` en el front-matter) **solo** puede emitirse si el CI Pipeline (BB-6) pasa entero. El cambio de dictamen `GO WITH CHANGES → GO` exige, además del CI verde: 0 hallazgos críticos, 0 contradicciones entre artefactos, referencias internas válidas, y Architecture Consistency Index ≥ 95/100. El front-matter (`00`) registra la versión y el estado; ambos viven en los `_parts` y se propagan por build.

---

| Plantilla normativa (Blueprint Build System) | |
|---|---|
| **Objetivo** | Que el Blueprint se comporte como un producto de software: fuente de verdad, build, validaciones, lint, pipeline y criterios de publicación; nunca más depender de ediciones manuales del consolidado. |
| **Alcance** | Todo el corpus `docs/prospeccion/` (parts, consolidado y tooling). |
| **Decisiones tomadas** | BB-1 `_parts` = fuente única; BB-2 consolidado = artefacto generado, no editable; BB-3 editar parts + regenerar; BB-4 build verification; BB-5 linter determinístico; BB-6 CI pipeline de 6 pasos; BB-7 criterios de publicación. |
| **Decisiones descartadas** | (a) Mantener dos fuentes de verdad (parts + consolidado editable) — descartado: causó el drift de F0-PRE. (b) Validación solo manual/visual — descartado: no auditable. (c) Linter solo semántico (agentes) sin capa determinística — descartado: el ARB necesita evidencia objetiva y reproducible. |
| **Justificación** | La reconciliación F0-PRE probó que el drift entre artefactos es el modo de falla real; tratarlo con disciplina de software (build + lint + CI) lo elimina de raíz y lo hace reproducible. |
| **Riesgos** | Que alguien edite el consolidado a mano (BB-2). Mitigación: BB-4 lo detecta (diff ≠ vacío) y bloquea. Que el linter quede desactualizado respecto de nuevas reglas. Mitigación: el linter se versiona con los parts y se extiende al agregar familias de reglas. |
| **Impacto sobre la arquitectura** | No cambia la arquitectura del producto; cambia la **gobernanza del documento**: lo vuelve verificable y reproducible, condición para sostener la vigencia a 10 años sin erosión documental. |
