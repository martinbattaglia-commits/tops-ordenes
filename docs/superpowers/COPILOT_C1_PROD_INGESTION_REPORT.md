# Nexus Copilot · C1 — Reporte de aplicación e ingesta en PROD (C1.1 + C1.2)

> **Fecha:** 2026-07-07 · **Proyecto Supabase (prod):** `arsksytgdnzukbmfgkju` (tops-ordenes-prod, sa-east-1) — el mismo al que apunta la app.
> **Ejecución:** vía MCP Supabase (`execute_sql`), con OK explícito de Dirección. **Verificado read-only** al cierre.

---

## 1. Estado de la migración 0185

- **Aplicada:** ✅ sí, por **DDL crudo (`execute_sql`)** — **NO** vía `apply_migration`.
- **Registrada en `supabase_migrations.schema_migrations`:** ❌ **NO** (última registrada sigue siendo `20260703223653` = `0179`). Consistente con la **Opción 1** confirmada (no tocar la tabla `migrations`; misma situación que 0181-0184, cuyos objetos existen sin registrar).
- **0180 (`ai_budget_overrides`):** ✅ **intacto / ausente** (`to_regclass` = null). No se tocó.

### Objetos creados por 0185
| Objeto | Detalle |
|--------|---------|
| tabla `public.company_knowledge_documents` | RLS **habilitada**; 2 policies |
| policy `company_kb_read` (SELECT) | `has_permission('knowledge.view')` |
| policy `company_kb_write` (ALL) | `current_role() ∈ (admin, supervisor)` |
| RPC `public.ai_company_knowledge_search(text,text,text,int)` | **SECURITY INVOKER** (`prosecdef=false`) |
| índices | GIN(`tsv`), GIN trigram(`title`), parcial `(capa,business_unit) where VIGENTE+ingestable`, único parcial `drive_file_id` |
| trigger + fn | `company_kb_touch` / `company_kb_touch_updated_at` (updated_at) |

---

## 2. Documentos INGERIDOS (9 · todos VIGENTE, ingestable=true, capa=institucional)

| # | Título | Unidad | Tipo | Confid. | URL | source_ref |
|---|--------|--------|------|---------|-----|-----------|
| 1 | Logística TOPS — Sitio oficial (completo) | CORPORATIVO | SITE_COMPLETO | PUBLICO | logisticatops.com | `kb/01_…/TOPS_Web_LogisticaTops_Completo_VIGENTE_2026-07.md` |
| 2 | Cargas Generales — Almacenamiento 3PL (sitio) | CARGAS_GENERALES | SITE_COMPLETO | PUBLICO | cargasgenerales.logisticatops.com | `kb/01_…/TOPS_Web_CargasGenerales_Completo_VIGENTE_2026-07.md` |
| 3 | Depósito habilitado ANMAT en Barracas (sitio) | REGULADOS | SITE_COMPLETO | PUBLICO | logisticatops.com/anmat | `kb/01_…/TOPS_Web_ANMAT_Regulados_Completo_VIGENTE_2026-07.md` |
| 4 | Cubículos ANMAT para gestión RNE (sitio) | ANMAT | SITE_COMPLETO | PUBLICO | logisticatops.com/anmat | `kb/01_…/TOPS_Web_Cubiculos_ANMAT_RNE_VIGENTE_2026-07.md` |
| 5 | Logística TOPS — Ecosistema de Servicios 3PL | CORPORATIVO | SITE_COMPLETO | PUBLICO | logisticatops.com | `kb/01_…/TOPS_Web_Ecosistema_3PL_VIGENTE_2026-07.md` |
| 6 | Logística TOPS — Sitio institucional (standalone) | CORPORATIVO | SITE_COMPLETO | PUBLICO | logisticatops.com | `kb/01_…/TOPS_Web_LogisticaTops_Standalone_VIGENTE_2026-07.md` |
| 7 | Carpeta institucional Logística TOPS | CORPORATIVO | DOSSIER | INTERNO | (PDF, futura URL Drive) | `kb/02_…/TOPS_Carpeta_Institucional_VIGENTE_2026-07.md` |
| 8 | Propuesta comercial — Cargas Generales (modelo) | CARGAS_GENERALES | PROPUESTA_MODELO | INTERNO | (PDF, futura URL Drive) | `kb/02_…/TOPS_Propuesta_Cargas_Generales_VIGENTE_2026-07.md` |
| 9 | Manual de uso — Portal B2B | CORPORATIVO | SITE_COMPLETO | INTERNO | (PDF, futura URL Drive) | `kb/03_…/TOPS_Manual_Portal_B2B_VIGENTE_2026-07.md` |

**Distribución:** por tipo → SITE_COMPLETO:7, DOSSIER:1, PROPUESTA_MODELO:1 · por unidad → CORPORATIVO:5, CARGAS_GENERALES:2, ANMAT:1, REGULADOS:1.

**Contenido:** `content`/`summary` **curados y de-ruidados desde cada fuente** (los HTML→markdown originales tienen ruido de navegación; se conservó el texto institucional útil). Originales completos en el ZIP `NEXUS_COPILOT_KNOWLEDGE_BASE_READY.zip` (que debe subirse a Drive como biblioteca canónica; ahí se poblarán las `drive_file_id`/URL reales). `source_ref` = clave idempotente (`insert … where not exists`).

---

## 3. Documentos EXCLUIDOS (y motivo)

| Excluido | Motivo |
|----------|--------|
| Planilla Cotización MELI/VEROTIN | **CONFIDENCIAL** (pricing interno) — no va a búsqueda amplia |
| Código de Ética, Constancia S&H Magaldi, 3PL Strategic Evolution, Screenshot Cargas, Cotizador standalone | **METADATA_ONLY** (PDF sin texto extraíble; requieren OCR/revisión) |
| Media assets (videos/GIFs/imágenes) | **NO_INGESTAR** |
| NotebookLM / `05_RESEARCH_NOTEBOOKLM_EXPORTS` / "Archivo 2" | Fuera de scope C1 (van en **C2**) |
| Histórico / borradores | No presentes en el ZIP; excluidos por diseño (estado ≠ VIGENTE) |

**Verificación:** 0 CONFIDENCIAL · 0 no-ingestables · 0 con `source_ref` de notebooklm/research/metadata_only/archivo 2.

---

## 4. Smoke de retrieval (RPC `ai_company_knowledge_search`) — 8/8

Las 8 preguntas institucionales de aceptación devuelven documentos:

| Pregunta | ¿Devuelve docs? |
|----------|:---:|
| ¿Qué servicios ofrece Logística TOPS? | ✅ |
| ¿Qué ofrece TOPS para productos regulados por ANMAT? | ✅ |
| ¿Qué ofrece TOPS para cargas generales? | ✅ |
| ¿Qué diferencia hay entre ANMAT y Cargas Generales? | ✅ (trae doc ANMAT + doc Cargas) |
| ¿Dónde opera Logística TOPS? | ✅ |
| ¿Qué es TOPS Nexus? | ✅ |
| ¿Qué es TOPS Connect? | ✅ |
| ¿Cómo trabaja TOPS como operador 3PL? | ✅ |

> El smoke se corrió por MCP (conexión `postgres`, que **bypassa RLS**): valida la lógica de query + los datos. La RLS (`has_permission('knowledge.view')`) se valida en el smoke Copilot end-to-end con una sesión de piloto real.

---

## 5. Nota de cambio · RPC ajustada a OR-por-token

La RPC se creó con `websearch_to_tsquery` (**AND estricto**), que devolvía **0** en preguntas **comparativas/multi-tema** (p.ej. "diferencia entre ANMAT y cargas generales") aunque ambos temas están ingeridos, y además **divergía** del `demoFilter` del código (que hace match por OR de tokens). Se ajustó vía `create or replace function` a **OR-por-token** (recall para multi-tema, paridad demo/real), conservando `SECURITY INVOKER`, grants y ranking `ts_rank` (los matches precisos ordenan primero). El archivo `supabase/migrations/0185_company_knowledge_base.sql` del repo se actualizó para reflejar exactamente lo aplicado en prod (evitar divergencia repo↔DB).

**Trade-off:** con un corpus chico (9 docs), el OR-por-token puede devolver casi todo el corpus para términos comunes ("tops", "logística"); el ranking `ts_rank` pone lo más relevante primero y el modelo sintetiza. Para un corpus grande convendría matching más preciso o búsqueda semántica (pgvector = **C3 opcional**).

---

## 6. Riesgos / próximos pasos

- **Smoke Copilot/Gemini end-to-end** (respuesta narrada + citas en el chat): pendiente — requiere app local + sesión de piloto logueada (RLS) + `AI_GEMINI_API_KEY` (ya en `.env.local`). Sin deploy prod.
- **Subir el corpus a Drive** (biblioteca canónica) y poblar `drive_file_id`/URL reales (hoy los PDFs quedaron sin URL).
- **Draft/preview deploy** antes de cualquier prod (no ahora).
- **C2 (NotebookLM/research)**: separado, con el ZIP `NEXUS_COPILOT_NOTEBOOKLM_KB_READY.zip`.
- **Reconciliación `migrations`**: 0185 (como 0181-0184) aplicada sin registrar; decisión de trazabilidad pendiente (Opción 1 vigente).

---

### Confirmación de reglas (C1.1 + C1.2)
Escrituras en prod SOLO las autorizadas (DDL de 0185 + 9 inserts institucionales + `create or replace` de la RPC). **Sin** `apply_migration` · **sin** tocar `migrations` · **sin** tocar 0180 · sin backfill/reprojection · sin NotebookLM · sin crawler · sin grounding · sin push/merge/deploy/Netlify · sin auth/UDIE.
