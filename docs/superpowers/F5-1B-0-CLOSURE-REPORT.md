# F5.1-b.0 — INFORME DE CIERRE FORMAL

> **Estado: ✅ CERRADO — EN PRODUCCIÓN 2026-07-03.** Aprobado por Dirección.
> Bloque: `F5.1-b.0 — Backfill de metadata documental a searchable_items`.
> Este documento es el registro autoritativo del cierre. Diseño: `F5-1B-0-DOCUMENT-METADATA-BACKFILL-DESIGN.md`.
> Mejoras posteriores: `F5-1B-0-1-DOCS-RETRIEVAL-BACKLOG.md`.

---

## 1. Qué se entregó

Proyección de la **metadata ya existente** de 797 documentos hacia `searchable_items`, para que el
Copilot F5.2-lite (Gemini, read-only) encuentre documentos por título/categoría/tipo/vencimiento/
cliente/organismo/sede — **sin leer Drive, sin extraer texto de PDF, sin embeddings, ~$0**.

## 2. Estado productivo final

| Ítem | Valor |
|---|---|
| Código en prod | `/api/version = dd17483` (= commit `0d59c35` del paquete + extras; guard/prompt v2 live) |
| Migración aplicada | `0176_knowledge_docs_projection` |
| Migración aplicada | `0177_knowledge_view_pilot_grant` |
| Backfill | `ai_docs_backfill_apply()` → **upserted 797, orphans 0** |
| `searchable_items` documental | **797** (569 compliance + 228 contratos) |
| Worktree/rama | `feat/f5-1b-0-docs-projection` @ `dd17483` (sin merge a main) |

## 3. Decisiones de Dirección aplicadas (D1–D6)

- **D1** compliance → `visibility_key = perm:compliance.view`.
- **D2** contratos → `visibility_key = perm:comercial.view`.
- **D3** rol dedicado **`ai_docs_pilot`** con `knowledge.view + compliance.view + comercial.view`,
  asignado a los 6 pilotos (`ai_pilot_users`). **`martin@` y `martin.battaglia@` son la misma persona
  (Martín Battaglia, Dirección) → ambas cuentas alineadas** (martin.battaglia@ pasó de `[]` a los 3).
  Sin `gerencia`, sin RBAC global, sin `RBAC_ENFORCE`.
- **D4** PII: excluye cuit/cbu/dni/texto-PDF/hashes/drive_file_id; `razon_social` incluida; redacción
  PII en el **write path** (`ai_docs_redact`, incluye CUIT/DNI **punteado**).
- **D5** marcador `[ficha metadata]` + guard estructural **fail-closed** metadata-vs-contenido.
- **D6** deep-link contrato → `/comercial/contratos` (`entityUrl` en `tools.ts`).

## 4. Validaciones post-apply (14/14 PASS)

| # | Check | Resultado |
|---|---|---|
| 1–3 | docs 797 (compliance 569 / contratos 228) | ✅ |
| 4 | visibility_key = {perm:compliance.view:569, perm:comercial.view:228} (solo 2 aprobadas) | ✅ |
| 5–6 | 0 public_id null; 0 title/body null | ✅ |
| 7 | **0 PII residual** (≥7 díg + CUIT punteado + email) | ✅ |
| 8–9 | 0 duplicados; 0 huérfanos | ✅ |
| 10 | 0 contratos con `visibility_key=staff` | ✅ |
| 11–12 | 7 triggers + 5 funciones `ai_docs_*` presentes | ✅ |
| 13 | rol `ai_docs_pilot` con los 3 permisos | ✅ |
| 14 | 0 no-pilotos con el rol | ✅ |

PII 4–6 dígitos residual (392 filas): verificada **benigna** (años, timestamps de captura, códigos de
documento). El número largo de expediente/póliza sí se redacta (p.ej. `PV-2021-[dato redactado]-GCABA`).

## 5. Smoke vivo (Dirección, `/copilot` prod)

- **RLS**: piloto (Cynthia, impersonada read-only) ve **797**; usuario sin roles ve **0**.
- **`Cual es el estado de compliance de Magaldi actualmente?`** → **ANSWERED** con 7 fuentes
  (fichas + caso, chips S1/S11–S16). **Prueba end-to-end de que b.0 funciona con Gemini.**
- **`cual e del ultimo mail que le envié a Cynthia?`** → ANSWERED (connect_message). No documental.
- **Guard metadata-vs-contenido**: NO causó falsos negativos (`error_detail=null` en todas).
- **Dilución de ranking**: NO ocurre — `searchable_items` contiene **solo** las 797 fichas; los 309
  `knowledge_events` viven en tabla separada (los sirven otras tools). Sin competencia de ranking.
- **Auditoría**: `provider=gemini`, `model=gemini-2.5-pro`, sources ligadas, `prompt_version=system.v2`,
  `ai_monthly_spend()=$0.0195`, 0 PII ≥7 díg en el content auditado.

## 6. Diagnóstico de los `NO_EVIDENCE` (aceptado por Dirección)

| Consulta | Veredicto | Causa |
|---|---|---|
| `que incidentes críticos hay abiertos?` | **NO_EVIDENCE correcto** | Hay **0 incidentes abiertos** (0 críticos). Tool correcta (`incidents_overview`). Ajeno a b.0. |
| `cual es el ultimo contrato de ANMAT que se firmo?` | **NO_EVIDENCE correcto (con gap)** | Existe contrato ANMAT (DEO Distribuidora), pero la ficha **no proyecta `fecha_firma`** → "el último firmado" no es respondible. Mejora b.0.1. |
| `que contratos estan próximos a vencer?` | **Falso negativo parcial** | Hay 4 contratos que vencen ≤90d, pero el modelo ruteó a `compliance_pending` y `search_knowledge` es FTS **sin filtro por fecha**. Mejora b.0.1, no hotfix. |

**Ningún `NO_EVIDENCE` fue defecto de b.0 ni del guard.** La data del backfill es correcta y buscable
(`search_knowledge` como piloto: contratos=20, ANMAT=10, MAGALDI=20).

## 7. Datos de contexto (verificados en vivo)

- Contratos: 57 en tabla; **solo 4 tienen documentos** (los 228 docs pertenecen a 4 contratos).
  36 con `fecha_fin`; **4 vencen ≤90 días**; 41 con `fecha_firma` (no proyectada).
- Existe 1 contrato ANMAT ("CONTRATO DE ALMACENAJE ANMAT.docx — DEO Distribuidora").
- El body de la ficha no contiene la palabra de dominio ("compliance"/"contrato") → búsquedas
  genéricas rankean pobre (retrieval mejora en b.0.1).

## 8. Riesgos remanentes

1. **Cobertura de fechas**: solo ~10 fichas de contrato y ~238 en total tienen `entity_date` →
   "por vencer" es parcial. (Límite de datos fuente, no de b.0.)
2. **Retrieval genérico débil**: FTS matchea términos específicos, no dominio genérico → b.0.1.
3. **Ruteo del planner**: a veces elige la tool equivocada para contratos → b.0.1.
4. Ninguno es riesgo de seguridad/PII/RLS (todos verdes).

## 9. Rollback

Disponible en `supabase/migrations/ROLLBACK_0176_0177_knowledge_docs_projection.md` (Nivel 0 delete
scoped → Nivel 1 drop funciones/triggers/vista → rollback de 0177 → Nivel 3 kill-switch Copilot).
**No fue necesario.**

## 10. Gobernanza / límites respetados

Sin extracción de texto, sin embeddings, sin pgvector, sin tocar Drive/Knowledge-drain, sin cron,
sin `RBAC_ENFORCE`, sin WhatsApp/Email, sin merge a `main`. Deploy del código lo hizo Dirección
(Netlify manual, `dd17483`); las migraciones + backfill se aplicaron desde Cloud Code por
autorización explícita de Dirección (cambio de operador), como `postgres`, sobre el único entorno
productivo `arsksytgdnzukbmfgkju`.

## 11. Próximo bloque

- **F5.1-b.0.1** — mejoras de retrieval/tooling (ver `F5-1B-0-1-DOCS-RETRIEVAL-BACKLOG.md`). Aditivas.
- **F5.1-b.1** (extracción de texto de PDF) — **NO-GO** hasta plan propio (PII alta, Drive, OCR).
- **F5.1-b.2** (embeddings/pgvector) — **NO-GO / diferir** hasta medir recall del FTS.
