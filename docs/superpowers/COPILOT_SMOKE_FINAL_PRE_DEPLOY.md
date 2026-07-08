# Nexus Copilot — Smoke final integral (pre draft deploy)

**Fecha:** 2026-07-08 · **Rama:** `fix/f5-2-copilot-context-retrieval` · **HEAD:** `0d3bbd1` · **Entorno:** prod `arsksytgdnzukbmfgkju` (solo lectura en este smoke)

Smoke de todas las capas del Copilot antes de preparar el draft deploy. **Cero writes en prod** en este smoke (solo `SELECT`/RPC read-only). **NO** push · **NO** merge · **NO** deploy · **NO** Netlify · **NO** migraciones · **NO** Dólar BNA · **NO** PR #46 · **NO** `feat/dolar-bna-kpi` · **NO** NotebookLM · **NO** C2.

## Resumen

| Fase | Qué valida | Resultado |
|---|---|---|
| A | Precheck git / aislamiento | ✅ |
| B | Typecheck + lint + suite + batería aceptación | ✅ |
| C | Entorno (Supabase, Gemini, provider, server) | ⚠️ requiere acción del usuario para el smoke vivo |
| D | Ruteo determinístico (intent classifier) | ✅ 44/44 |
| E–G | Retrieval por capa (RPC read-only, proxy) | ✅ 8/8 capas |
| H | Gemini real + visual + UX | ⏸ **queda al usuario** (login + provider) |

**Veredicto:** el código y los datos están **listos para draft deploy**. Las capas de ruteo y retrieval están verificadas de punta a punta en modo determinístico/read-only. La única validación que no puedo ejecutar yo es el smoke vivo con Gemini real + render visual, porque `/copilot` está detrás de login (RLS) y el server local corre con `AI_PROVIDER=mock`. Queda un checklist claro para que Martín lo cierre en 5 minutos.

## FASE A — Precheck git / aislamiento

- Rama `fix/f5-2-copilot-context-retrieval`, HEAD `0d3bbd1`.
- Commits de la rama (Copilot F5.2), de más nuevo a base:
  - `0d3bbd1` fix(ai): rutea chips cortos "crear orden" / "facturar un servicio" → manual_nexus *(hardening de este smoke)*
  - `5cf0457` feat(ai): Manual Nexus help knowledge layer (C1.5)
  - `17a1a4c` fix(ai): ruteo institucional + contenido más rico
  - `15ff6b6` feat(ai): renderer narrativo ejecutivo + thinking loader + sugerencias
  - `1394aad` fix(ai): retrieval de docs de Drive (habilitaciones y planos)
  - `2faae3f` chore(ai): doc C1 + alineación KB search *(base previa)*
- `git diff --check` limpio. Working tree sin cambios salvo **artefactos untracked**: `exports/` (paquete KB del manual) y `copilot-acceptance-results.json` (salida de la batería). Ninguno se commitea.
- Sin rastros de Dólar BNA / PR #46 / `feat/dolar-bna-kpi` / NotebookLM / C2.

## FASE B — Typecheck + lint + tests

- `tsc --noEmit` → **0 errores**.
- ESLint → **0 errores**.
- Suite: **1034 passed + 1 skipped**.
- Batería de aceptación del Copilot → ✅ (artefacto `copilot-acceptance-results.json`).

## FASE C — Entorno

- Supabase = prod `arsksytgdnzukbmfgkju` (único entorno).
- `AI_GEMINI_API_KEY` presente (no se imprime el valor).
- ⚠️ **`AI_PROVIDER=mock`** en el `.env.local` activo (no `gemini`).
- ⚠️ Server local `:3040` **stale**: fue buildeado en `2faae3f` (base previa), no en `0d3bbd1`; `/copilot` responde 307 (redirect a login).
- Por eso el smoke vivo (respuestas reales de Gemini + render de cards) **no es ejecutable headless**: hay que setear `AI_PROVIDER=gemini`, reiniciar el server desde `0d3bbd1` y loguearse.

## FASE D — Ruteo determinístico (intent classifier)

Smoke determinístico sobre `classifyCopilotIntent()` con los prompts reales de los chips y controles anti-hijack: **44/44 PASS**.

- Institucional (qué servicios, dónde opera, unidades) → `company_institutional`.
- Manual / Ayuda Interna (cómo creo OC/OS, qué módulos, permisos por rol, dónde está Compliance Cockpit, orden de lectura) → `manual_nexus`.
- Datos internos (cuánto facturamos, ranking clientes) → `nexus_internal` (el veto NEXUS sigue mandando).
- **Hardening de este smoke:** los labels cortos de los chips ("Crear Orden de Compra", "Crear Orden de Servicio", "Facturar un servicio"), si el usuario los tipea literal, antes caían en herramientas de datos; ahora rutean a `manual_nexus` (son preguntas how-to, y el Copilot es read-only). Cubierto con 3 tests nuevos en `manual-nexus.test.ts` y commit aislado `0d3bbd1`.

## FASE E–G — Retrieval por capa (RPC read-only, proxy del smoke vivo)

Ejecuté las mismas RPC que usa el engine, contra prod, en modo lectura. Cada capa devuelve contenido y el top hit es el correcto:

| Capa | Query | n | Top hit |
|---|---|---:|---|
| C1 institucional | "qué servicios ofrece logística tops" | 8 | (institucional) |
| C1.5 manual | "cómo creo una orden de servicio" | 8 | Manual TOPS Nexus — **Operaciones y Servicios** (URL Drive real) |
| C1.5 manual | "permisos por rol" | 8 | Manual TOPS Nexus — **Roles y permisos** (matriz 16 módulos) |
| C1.5 manual | "qué es WMS / depósito" | 8 | Manual TOPS Nexus — WMS |
| C1.5 manual | "qué módulos tiene Nexus" | 8 | Manual (FAQ/Portal) |
| Drive docs | "plancheta habilitación magaldi" | 1 | **14. PLANCHETA HABILITACION MAGALDI 1765.pdf** |
| Drive docs | "plano evacuación luján" | 1 | **planos-evacuacion-lujan.pdf** (fix de acento OK) |
| Compliance | `compliance_documents` total | 571 | (base de compliance íntegra) |

- Los docs de manual traen `business_unit=SISTEMA_NEXUS`, `source_type=MANUAL_USUARIO`, `estado=VIGENTE` y **URL real de Drive** → el visual capa-aware ("Manual Nexus · Ayuda Interna", card por módulo + "Abrir en Drive") tiene con qué renderizar.
- Los 2 docs de Drive (plancheta Magaldi + evacuación Luján) hacen match exacto; el de evacuación confirma que el fix del token sin acento (`categoria='Evacuacion'`) resolvió el mismatch FTS `spanish`.

### Follow-up cosmético (no bloqueante)

El campo `detalle` que arma la RPC `ai_company_knowledge_search` prefija `"Institucional ·"` incluso para filas `capa=manual_nexus` (string estático heredado de cuando la RPC era solo institucional). No afecta ruteo ni el visual (ambos keyan por `business_unit`/`source_type`, que son correctos) ni el contenido que ve el LLM (`summary` es el markdown real del manual). Corregirlo requiere tocar la RPC = migración → **fuera del alcance autorizado de este smoke**. Anotado para una próxima ventana de schema.

## FASE H — Gemini real + visual + UX (queda al usuario)

No ejecutable por mí (login-gated + provider mock). Checklist para cerrarlo:

1. En `.env.local`: `AI_PROVIDER=gemini` (la key ya está).
2. Reiniciar el server desde `0d3bbd1` (`npm run dev`), abrir `/copilot`, loguearse.
3. Probar una pregunta por capa y confirmar respuesta + visual:
   - Institucional: "¿Qué servicios ofrece Logística TOPS?" → card institucional por unidad.
   - Manual: "¿Cómo creo una Orden de Servicio?" → card "Manual Nexus · Ayuda Interna" + "Abrir en Drive".
   - Drive docs: "planos de evacuación de Luján" → doc con link a Drive.
   - Compliance: una pregunta de vencimientos → semáforo/tabla.
   - Recomendación ejecutiva: click en un chip de reporte → narrativa con secciones/badges (sin markdown crudo), sources colapsables (máx 3), thinking loader al inicio.
   - Gemini estático + actualidad: una pregunta general → responde vía Gemini sin romper el veto Nexus.

## Confirmación

- Cero writes en prod en este smoke (100% read-only).
- Sin push / merge / deploy / Netlify / migraciones.
- Dólar BNA intacto (PR #46 y `feat/dolar-bna-kpi` sin tocar).
- Único commit nuevo de la sesión: `0d3bbd1` (hardening de ruteo, aislado, con tests), **sin push**.
