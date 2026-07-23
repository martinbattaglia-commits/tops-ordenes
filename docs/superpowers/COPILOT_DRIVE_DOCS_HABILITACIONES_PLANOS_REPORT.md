# FIX Drive Docs — Planchetas, habilitaciones y planos Magaldi/Luján

**Fecha:** 2026-07-08
**Entorno:** prod `arsksytgdnzukbmfgkju` (preflight read-only + 2 writes autorizados) · repo `tops-ordenes` worktree `tops-ordenes-fix-copilot-context`
**Alcance:** capa Documentos / Drive / Compliance del Nexus Copilot. NO Manual Nexus, NO NotebookLM, NO C2.

---

## 1. Problema original

Nexus Copilot no devolvía correctamente documentos críticos que SÍ están en Google Drive:
planchetas de habilitación (Luján/Magaldi), planos de Magaldi/Luján, planos de evacuación,
de incendio y de ventilación mecánica. Debían poder encontrarse con **link real de Drive**.

## 2. Root cause (por evidencia)

| # | Causa | Detalle |
|---|---|---|
| **F** | Routing/query impreciso | `pickTools` (`providers/mock.ts`) pasaba **solo la sede** como query → la RPC `ai_docs_browse` (match `tsv @@ websearch_to_tsquery` / `title ilike`, orden `ts_rank`→fecha) devolvía ~128 docs de la sede por fecha, con la plancheta (2018) sepultada. |
| **F** | Plural "planos" no detectado | `docWord = /…\|plano\b\|…/` no matcheaba **"planos"** (el `\b` falla ante la "s"); tampoco evacuación / incendio / ventilación / "habilitante" sueltos → esas consultas no llegaban a `docs_browse`. |
| **D** | Link real de Drive no priorizado en la cita | El `enrich` traía `source_url` (Drive webViewLink) pero `rowToChunk` citaba `entityUrl()→"/anmat"` (nav al módulo), no el PDF. |
| **G** | Ranking PDF vs CAD | Para "plancheta/habilitación", la RPC devolvía primero un `.dwg`/`.dwf` (CAD técnico) en vez del PDF visible por el usuario. |
| **A** | Evacuación no indexada | Los 2 planos de evacuación existían en Drive pero **no** en `compliance_documents` / `searchable_items` (0 filas). |

> **NO era OCR:** los PDF son escaneados, pero el índice usa **metadata** (título/sede/tipo_doc vía `ai_docs_projection`), no el texto interno → se encuentran igual.

## 3. Documentos detectados en Drive (FASE A preflight)

Todos con link real (`https://drive.google.com/file/d/…`): `PLANCHETA DE HABILITACIÓN LUJAN.pdf`,
`14. PLANCHETA HABILITACION MAGALDI 1765.pdf`, `Plancheta Habilitacion Magaldi.pdf`,
`Habilitacion Magaldi Certificada.pdf`, `Planos de evacuación Magaldi.pdf`,
`planos-evacuacion-lujan.pdf`, `10. PLANO CONDICIONES CONTRA INCENDIO - MAGALDI 1765.PDF`,
`PLANO CONTRA INCENDIO LUJAN`, `Plano ventilación mecánica Magaldi.pdf`, + CAD `.dwg/.dwf`.

## 4. Documentos ya existentes en Nexus (FASE B preflight)

`compliance_documents` / `searchable_items` = **569 docs de compliance indexados CON URL real de
Drive**: planchetas (2), planos (23), incendio (162), ventilación (3), habilitación (varias por sede).
**Único faltante: evacuación = 0.**

## 5. Documentos insertados (write autorizado)

| Título | Drive file id | Sede | Tipo | URL |
|---|---|---|---|---|
| `Planos de evacuación Magaldi.pdf` | `1IgKCe5Z0qdDafgceFtJT_Od0W7MJ0uZC` | MAGALDI (→ Magaldi 1765) | Plano de Evacuación | webViewLink real |
| `planos-evacuacion-lujan.pdf` | `1amMQVZKaT6HwEYgIBDegzcxQ3__W501l` | LUJAN (→ Pedro de Luján 3159) | Plano de Evacuación | webViewLink real |

Filas: Magaldi `f2f3099e-6e2e-4127-b7de-7a31a1316a10`, Luján `c7fd5ee4-44c0-4a7b-8ddf-a0bcd538af20`.
`categoria='Evacuacion'` (SIN acento — token FTS que matchea la query normalizada; ver §10).
`item_id=NULL` (FK a `compliance_items`; no cuelgan de un caso).

## 6. Confirmación de writes

- **Solo 2 documentos** tocados (1 upsert idempotente `on conflict (drive_file_id)` + 1 update de ajuste FTS).
- **Trigger por fila:** `tg_ai_docs_compliance_ins/upd` (AFTER INSERT/UPDATE) auto-proyecta al spine `searchable_items` **solo esas filas**.
- **NO backfill global · NO reprojection global · NO migrations table · NO apply_migration · NO 0180.**

## 7. Cambios de código (locales, sin writes de schema)

- **Routing** (`providers/mock.ts`): detecta **tipo documental canónico + sede** (alias: plancheta/habilitante→`habilitacion`; planos plural / evacuación / incendio / ventilación; pedro→lujan, agustin→magaldi, 3159→lujan, 1765→magaldi) y arma query **precisa `"tipo sede"`**.
- **Ranking** (`tools.ts` `ToolSpec.rank` + `data.ts` paso post-enrich + `docs_browse.rank`): para plancheta/habilitación, **PDF/plancheta visible le gana al CAD** (plancheta +100, PDF +40, certificado +20, habilitación +10, CAD −50; estable). NO toca planos técnicos.
- **Link real** (`tools.ts`): `rowToChunk.url = source_url || entityUrl`; `enrich` agrega `sede`+`tipo_doc`; descripción guía a Gemini ("query = tipo + sede", link Drive).
- **Visual** (`visuals.ts` `docs_browse`): card con **sede (código) + tipo + fecha + "Abrir en Drive ↗"** + candidatos con link Drive.
- **Tests**: `docs-routing.test.ts` (routing 8 consultas + chunk source_url + ranking PDF>CAD) + `visuals.test.ts` (actionLabel).

## 8. Resultado smoke (backend/RPC read-only, 8/8)

| Consulta | Principal esperado | RPC/ranking |
|---|---|---|
| Plancheta habilitación **Luján** | PDF, no CAD | `Plano Habilitacion Lujan.pdf` (el `.dwg` cae por el `rank`) ✅ |
| Plancheta habilitación **Magaldi** | plancheta PDF | `14. PLANCHETA HABILITACION MAGALDI 1765.pdf` ✅ |
| Planos evacuación **Luján** | doc recién indexado | `planos-evacuacion-lujan.pdf` ✅ |
| Planos evacuación **Magaldi** | doc recién indexado | `Planos de evacuación Magaldi.pdf` ✅ |
| Plano incendio **Magaldi** | plano incendio | `…INCENDIO…MAGALDI 1765` ✅ |
| Plano ventilación **Magaldi** | ventilación | `…ventilacion mecanica.pdf` ✅ |
| Habilitante **Pedro de Luján 3159** | PDF útil | → `habilitacion lujan` → PDF ✅ |
| Habilitante **Agustín Magaldi 1765** | PDF útil | → `habilitacion magaldi` → plancheta PDF ✅ |

Smoke visual (card + "Abrir en Drive") = confirmación del usuario con login en `localhost:3040/copilot`.

## 9. Validación

`git diff --check` limpio · `tsc --noEmit` = 0 · ESLint = 0 · **suite 1016 passed + 1 skipped**.

## 10. Limitaciones

- Los PDF son **escaneados sin OCR**: la metadata (título/sede/tipo) alcanza para **encontrar y abrir** el
  documento con su link de Drive, pero NO para extraer/resumir el **contenido interno**. OCR queda para
  un futuro si se quiere leer el texto del PDF.
- **FTS accent-sensitive**: el config `spanish` stemea "Evacuación" (acentuado) → `'evacu'` pero la query
  normalizada "evacuacion" → `'evacuacion'` (no matchean). Fix scoped: el token sin acento vive en
  `categoria='Evacuacion'` de los 2 docs. Es un patrón a repetir si se ingieren más términos acentuados.
