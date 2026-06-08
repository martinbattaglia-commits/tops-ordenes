# RELEASE-MANIFEST — TOPS NEXUS

**Fecha:** 2026-06-08 · Release Candidate sobre `claude/gracious-pasteur-6efdde`.
**Estado:** RC preparado (commit único). **No** pusheado, **no** mergeado, **no** deployado.

---

## Identidad del Release Candidate
- **Branch:** `claude/gracious-pasteur-6efdde` (7 commits RRHH ya presentes + 1 commit de release).
- **Base:** `main` (0 detrás → merge limpio sin conflictos).
- **Alcance funcional:** CRM360 (Kanban default, buscador, anti-URL deal name, contratos + estado documental, deep links), crm_units + reserva atómica, Digital Twin comercial (mapas Magaldi/Luján), Compliance Cockpit, RRHH (legajo/empleados/recibos), Facturación, Cockpit Ejecutivo, RBAC guard/visibility.

---

## ✅ Entra al Release (241 paths, 0 removes)

| Categoría | Paths | Detalle |
|---|---|---|
| **Código** (`src/`) | **75** | 54 modificados + 21 nuevos (rutas, componentes, libs) |
| **Migraciones** (`supabase/migrations/`) | **12** | 0052, 0053, 0061, 0061a, 0062–0069 |
| **Documentación** (`docs/handoff/`) | **146** | reportes de arquitectura, QA, deploy |
| **Config raíz** | **4** | `package.json`, `package-lock.json`, `.eslintrc.json` (root:true), `.gitignore` (endurecido) |
| **Assets públicos** (`public/tools/`) | **2** | plantillas contractuales: `contrato-anmat`, `aceptacion-condiciones` |
| **Scripts** (`scripts/`) | **2** | `crm-backfill-deals.mjs`, `rrhh-ch5b-ingest-recibos.mjs` (leen `process.env`, sin secretos hardcodeados) |

Detalle archivo por archivo en **RELEASE-FILE-INVENTORY.md**.

---

## 🚫 NO entra al Release (excluido por `.gitignore`)

| Tipo | Patrón | Por qué |
|---|---|---|
| Env backups | `.env.local.pre-drive-root.bak`, `.env.local.pre-fix.bak` | secretos — `.env.local.*` / `.env*.bak` ignorados |
| Build trash | `.next.trash-*/`, `.next.trash-build-*/` | artefactos temporales de build (`.next.trash-*/` ignorado) |
| Build output | `.next/` | salida de build |
| Env vivo | `.env`, `.env*.local` | secretos |

**Verificación de seguridad ejecutada:** `git add -A --dry-run` → **0** paths de tipo env/bak/trash/pem/log serían staged. ✅

---

## Migraciones — nota de aplicación (NO se ejecutan en este paso)
- Obligatorias (deben estar aplicadas en prod): 0052/0053, 0061–0068. (0066–0068 aplicadas por memoria; reconfirmar el resto.)
- **0069** (`clientify_deal_name`): **opcional**, no aplicada; el front degrada con fallback. Incluida en el repo para versionado.
- La aplicación de migraciones en prod la hace el usuario vía SQL Editor (no el asistente).

---

## Resultado
El Release Candidate contiene **exactamente** el código + migraciones + docs + assets del release, y **excluye** todo artefacto/secreto. Listo para commit único (ver RELEASE-COMMIT-PLAN.md), sin push/merge/deploy.
