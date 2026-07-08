# C1.5 · Manual Nexus / Ayuda Interna — cierre

**Fecha:** 2026-07-08 · **Entorno:** prod `arsksytgdnzukbmfgkju` (0186 + ingesta autorizadas) · rama `fix/f5-2-copilot-context-retrieval`

Cierra C1.5: las preguntas de "cómo usar Nexus" ahora responden **desde el Manual Nexus con fuentes reales de Drive**, en vez del fallback "manual preparado pero no ingerido".

## 1. Schema (0186)

**Aplicada por DDL crudo** vía `execute_sql` (NO apply_migration, NO registrada en migrations). Extiende 3 CHECK de `company_knowledge_documents`:

| Check | Valor agregado |
|---|---|
| `company_kb_capa_ck` | `manual_nexus` |
| `company_kb_business_unit_ck` | `SISTEMA_NEXUS` |
| `company_kb_source_type_ck` | `MANUAL_USUARIO` |

Validado: los 3 CHECK admiten los valores nuevos · **0180 intacto** (`ai_budget_overrides` no existe) · 0186 no registrada en migrations.

## 2. Ingesta (17 documentos)

Upsert idempotente en `company_knowledge_documents` (delete-by-ids de los 17 + insert; el índice único de `drive_file_id` es parcial → no sirve como on_conflict PostgREST). Contenido leído del export local (idéntico a Drive). Metadata: `capa=manual_nexus`, `business_unit=SISTEMA_NEXUS`, `source_type=MANUAL_USUARIO`, `estado=VIGENTE`, `confidencialidad=INTERNO`, `ingestable=true`, `drive_file_id` + `url` real de Drive, `content` markdown limpio.

**Ingeridos (17):** 01_RESUMEN_EJECUTIVO, 03_ROLES_Y_PERMISOS, 04_FLUJOS_DE_TRABAJO, 05_MAPA_DEL_SISTEMA, 06_FAQ_AYUDA_INTERNA + 12 módulos (00_portal, 01_cockpit, 02_compras, 03_operaciones, 04_wms, 05_pedidos, 06_comercial, 07_compliance, 08_facturacion, 09_tesoreria, 10_rrhh, 11_sistema).

**Excluidos:** README, 00_MANIFEST, MANUAL_..._COMPLETO (duplica módulos), 90_ASSETS_REFERENCIA_NO_INGESTAR.

**Validación post-ingesta (read-only):** total 17 · SISTEMA_NEXUS 17 · MANUAL_USUARIO 17 · VIGENTE 17 · ingestable 17 · drive_file_id 17 · URL real de Drive 17 · **distinct drive_file_id 17 (sin duplicados)** · **prohibidos 0** (README/MANIFEST/COMPLETO/ASSETS).

## 3. Routing / código

- **`intent-classifier.ts`**: nuevo intent `manual_nexus` + rama que detecta AYUDA/HOW-TO (cómo creo/uso/reporto, qué módulos, dónde encuentro un módulo, permisos por rol, orden de lectura, cómo se conectan los módulos) **antes del veto** (para que "¿qué módulos tiene Nexus?" no caiga en datos internos). Distingue "cómo USO facturación" (manual) de "cuánto facturamos" (Nexus), y "dónde encuentro Compliance Cockpit" (manual) de "dónde veo las OC" (navegación).
- **`engine.ts`**: rama `manual_nexus` → `company_knowledge_search(capa='manual_nexus')`; si vacío → brecha específica (`coverage_overview`), nunca genérico ni "no encontré".
- **`tools.ts`**: `company_knowledge_search` admite `capa: manual_nexus`.
- **`copilot-suggestions.ts`**: la sección "Manual Nexus · Ayuda Interna" pasa de `preview` → `supported` (el click va al motor, no al fallback).
- **`visuals.ts`**: el adaptador `company_knowledge_search` detecta `SISTEMA_NEXUS` → card "Manual Nexus · Ayuda Interna" (una por sección/módulo, con "Abrir en Drive").

## 4. Smoke de retrieval (RPC read-only, capa manual_nexus)

Cada pregunta trae el doc correcto: "cómo creo una orden de servicio"→Operaciones y Servicios · "permisos por rol"→Sistema y Administración + Roles · "qué es WMS"→WMS · "dónde encuentro Compliance Cockpit"→Compliance · "qué módulos tiene Nexus"→FAQ + Portal.

## 5. Tests

`git diff --check` limpio · `tsc --noEmit` 0 · ESLint 0 · **suite 1031 passed + 1 skipped** (+15 `manual-nexus.test.ts`: 12 preguntas → manual_nexus, controles no-hijack, cobertura supported, schema capa).

## 6. UX

El narrativo usa el renderer premium (títulos, secciones, cards, sin markdown crudo). El smoke visual final (card + "Abrir en Drive") requiere login → confirmación del usuario.

## 7. Confirmación

Único write en prod = 0186 (DDL) + 17 docs manual_nexus. NO push · NO merge · NO deploy · NO Netlify · NO migrations table · NO apply_migration · NO 0180 · NO NotebookLM · NO C2 · NO Dólar BNA · NO backfill/reprojection global.
