# F0.5 — Checklist de Reconciliación Documental

**Fecha:** 2026-06-28 · **Contexto:** cierre de bloque F0.5.0 + F0.5.1, previo a arranque de F0.5.2 y aprobación G7.

Cada ítem registra una contradicción o inconsistencia documental detectada por el Release Readiness Review (RRR), la corrección correspondiente y su estado actual.

---

## Convenciones de estado

| Estado | Significado |
|--------|-------------|
| ✅ APLICADO | Corrección ya implementada en esta sesión; no requiere acción adicional |
| ⏳ PENDIENTE | Corrección identificada, aún no implementada; acción requerida antes de la fase indicada |
| 📋 DOCUMENTADO/ACEPTADO | Inconsistencia evaluada y aceptada como acoplamiento conocido; no requiere edición de código o SQL, solo claridad conceptual |

---

## Ítems de reconciliación

| # | Inconsistencia detectada | Archivos involucrados | Corrección | Estado | Bloquea |
|---|--------------------------|----------------------|------------|--------|---------|
| **I-1** | **Spec §5.3/§5.4 muestra Alternativa A RECHAZADA como canónica.** El cuerpo del spec presentaba el emisor de 13 parámetros sueltos + `INSERT` directo a `knowledge_events` como la forma correcta, cuando esa fue la alternativa rechazada en los ADR. Un desarrollador que aplique "el SQL del spec" reconstruye la arquitectura descartada. | `docs/superpowers/specs/2026-06-28-nexus-connect-design.md` §5.3 y §5.4 | Banner de override añadido al inicio de §5.3 (línea ~3821): aclara que el SQL es Alternativa A RECHAZADA/superada, señala los ADR (`ADR-KNW-ADAPTER/REGISTRY/CONTRACT`) y las migraciones entregadas como canónicas, y apunta a `docs/superpowers/plans/2026-06-28-f05-1-knowledge-timeline-projection.md` §13 para implementar correctamente. El SQL original se conserva solo por trazabilidad del diseño previo. | ✅ **APLICADO** (esta sesión) | NO — es solo documental; no hay cambio de comportamiento |
| **I-2** | **Nombres de eventos técnicos EOL desalineados en 3 direcciones.** Las constantes de evento en `observability.ts:47-53`, los nombres emitidos en SQL (`0108:111`, `0109:59/121/134`) y lo que describen los ADR no coinciden en ningún par. Ningún colector cableado contra las constantes TS verá los logs reales del motor SQL. | `src/lib/knowledge/observability.ts:47-53` · `migrations/0108_knowledge_rpc.sql:111` · `migrations/0109_knowledge_projection_triggers.sql:59,121,134` · `docs/superpowers/adr/` | Definir un **catálogo único de nombres de eventos EOL** (tabla exhaustiva nombre→capa→emisor→receptor) que sirva como fuente de verdad para los 3 artefactos. Reconciliar literales antes de cablear cualquier colector o sink de observabilidad. No requiere reabrir migraciones entregadas si los nombres se normalizan en una nueva migración o en el código TS. | ⏳ **PENDIENTE** — pre-cableo de colectores; resolver durante F0.5.2 | NO bloquea arrancar F0.5.2; SÍ bloquea cablear colectores EOL |
| **I-3** | **ADR vs implementación en visibilidad delegada.** Los ADR (`ADR-KNW-ADAPTER`) afirman que "cada adaptador resuelve su propia visibilidad", pero `knowledge_visibility_for` (`0108`) la centraliza con un CASE hardcodeado por `entity_type`. Una fuente futura con visibilidad no-staff obliga a editar el código compartido de todas las fuentes. | `docs/superpowers/adr/ADR-KNW-ADAPTER.md` · `migrations/0108_knowledge_rpc.sql` (función `knowledge_visibility_for`) | No requiere edición del ADR ni del SQL. Aclaración conceptual: la derivación de `visibility_key` se delega al helper transversal `knowledge_visibility_for`; el adaptador lo invoca pero no lo reimplementa. El acoplamiento centralizado es una decisión consciente aceptada (menor OCP en visibilidad a cambio de lógica única y no duplicada). Cada fuente futura que necesite visibilidad distinta deberá extender el CASE en `0108` o introducir un helper propio. El ADR es correcto en espíritu; la implementación concreta es más acoplada de lo que el ADR sugiere. Registrado como acoplamiento conocido. | 📋 **DOCUMENTADO/ACEPTADO** — ADR coherentes entre sí; no requiere edición | NO — es acoplamiento intencionado; no hay cambio de comportamiento |
| **I-4** | **Vocabulario `entity_type` del CASE desalineado con valores reales de la fuente.** La función `knowledge_visibility_for` en `0108` incluye ramas CASE para `order`/`client`/`document`/etc., pero la fuente `audit_log` emite valores como `stock_allocation`/`custody`/`recon`/`shipment`. Casi todo cae al default `'staff'`, lo que hace que el feature quede vacío para entidades no listadas. | `migrations/0108_knowledge_rpc.sql` (CASE en `knowledge_visibility_for`) · `migrations/0001_initial_schema.sql` (tabla `audit_log` y sus entity values) | Reconciliar los literales del CASE en `knowledge_visibility_for` con el vocabulario real de `event_type`/`entity_type` que emite `audit_log`. Relevar los valores activos en la DB de prod antes de F0.5.2 para evitar que el mapping quede mayormente en el branch default. Esto es una corrección de datos de configuración, no una ruptura de contratos. | ⏳ **PENDIENTE** — relevar durante F0.5.2 (no bloquea arranque) | NO bloquea F0.5.2; SÍ afecta la utilidad visible del feature para no-staff |
| **I-5** | **`visibility.ts` (scaffolding MACL prematuro) con test verde.** `src/lib/knowledge/visibility.ts` implementa reglas de mínimo común citando Parte III §4.1 / ADR-MACL, que pertenece a la visión F7-F11. No tiene consumidor real. La existencia de `visibility.test.ts` con tests verdes amplifica el riesgo: da señal falsa de "feature lista" que podría llevar a consumirla antes de su fase, violando la invariante unidireccional D16/D19. | `src/lib/knowledge/visibility.ts` · `src/lib/knowledge/visibility.test.ts` | Re-etiquetar los archivos con un comentario `// SCAFFOLDING INERTE — MACL (F7+). No consumir. Ver ADR-MACL y D19.` al inicio de ambos archivos, o removerlos del scope activo (preferible). El test verde debe silenciarse o marcarse como `skip` hasta que MACL entre en scope. | ⏳ **PENDIENTE** — opcional pero recomendado antes de F0.5.2 para evitar confusión en el equipo | NO bloquea F0.5.2; SÍ es riesgo de confusión conceptual |

---

## Resumen de estados

| Estado | Cantidad | Ítems |
|--------|----------|-------|
| ✅ APLICADO | 1 | I-1 |
| ⏳ PENDIENTE | 3 | I-2, I-4, I-5 |
| 📋 DOCUMENTADO/ACEPTADO | 1 | I-3 |

**Ningún ítem pendiente bloquea el arranque de F0.5.2.** I-2 bloquea cablear colectores EOL; I-4 afecta la utilidad visible del feature; I-5 es riesgo de confusión conceptual.

---

## Trazabilidad

- Contradicciones detectadas por: `docs/superpowers/F05-RELEASE-READINESS-REVIEW.md` §2 Dim 1, §2 Dim 11, §3 R-1, §3 R-8, §3 R-9, §4 Rec 2/9/12/15
- Banner I-1 aplicado en: `docs/superpowers/specs/2026-06-28-nexus-connect-design.md` línea ~3821
- Este checklist apunta desde: `docs/superpowers/F05-MILESTONE-CLOSURE-REPORT.md` §2 y §3 R-1
