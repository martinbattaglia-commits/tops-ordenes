# Blueprint Build System — tooling

Implementa la política **Blueprint Build System** (capítulo `_parts/07-blueprint-build-system.md`, reglas BB-1..BB-7).
El Blueprint se gestiona como código: los `_parts/` son la **única fuente de verdad** (BB-1) y el documento
consolidado `PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md` es un **artefacto generado** que **NUNCA** se edita a mano (BB-2).

## Comandos

```bash
# BB-3 — Build: regenerar el consolidado desde los _parts (en el orden canónico)
node docs/prospeccion/tools/build.mjs

# BB-4 — Build Verification: ¿el consolidado es EXACTAMENTE cat(_parts)? (no escribe; falla si difiere)
node docs/prospeccion/tools/build.mjs --check

# BB-5 — Blueprint Linter: referencias, ADR, reglas, drift, DDL, mermaid, conteos, nombres
node docs/prospeccion/tools/blueprint-lint.mjs          # legible
node docs/prospeccion/tools/blueprint-lint.mjs --json   # máquina

# BB-6 — CI Pipeline (pasos determinísticos 1-4): build-verify + linter
node docs/prospeccion/tools/blueprint-ci.mjs
```

## Flujo de trabajo (obligatorio, BB-3)

1. Editar **solo** los archivos en `_parts/`.
2. `node tools/build.mjs` → regenera el consolidado.
3. `node tools/blueprint-ci.mjs` → verifica build + lint (debe dar verde).
4. Para una **versión oficial** (BB-6/BB-7): además, Consistency Matrix (18 relaciones) + Architecture
   Consistency Index ≥ 95/100 (capa semántica del ARB), archivados en `BLUEPRINT-CONSISTENCY-REPORT-<fecha>.md`.

## Archivos

| Archivo | Rol |
|---|---|
| `build.mjs` | Orden canónico de ensamblado (fuente única) + build + `--check` (Build Verification) |
| `blueprint-lint.mjs` | Linter determinístico (BB-5); exit ≠ 0 ante cualquier inconsistencia |
| `blueprint-ci.mjs` | Orquestador del pipeline determinístico (BB-6 pasos 1-4) |

> El orden de los parts vive **solo** en `build.mjs` (`PARTS_ORDER`). El capítulo BB lo refleja, no lo redefine.
> Los pasos semánticos del CI (Consistency Matrix, Architecture Consistency Index) los ejecuta el panel ARB
> apoyándose en la evidencia objetiva del tooling determinístico.
