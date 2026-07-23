# COPILOT_QA_REPORT.md — fix/f5-2-copilot-context-retrieval

**Alcance implementado:** P1 (mensajes de vacío honestos + resiliencia de args) y P2
(RPCs/tools read-only para facturas, OC y proveedores). Todo **local, sin deploy, sin
migración aplicada a prod**. Rama: `fix/f5-2-copilot-context-retrieval` (base `b8d9a69`).

## Gates de validación

| Gate | Resultado |
|---|---|
| `vitest run` (repo completo) | ✅ **707/707** (78 files) |
| `vitest run src/lib/ai` | ✅ **169/169** (baseline era 144 → +25 tests nuevos) |
| `tsc --noEmit` (typecheck) | ✅ **0 errores** |
| `eslint src/lib/ai` | ✅ **limpio** |
| Migración 0181 | ⏳ **entregada, NO aplicada** (G3). Cuerpos SELECT validados read-only contra prod (abajo). |
| Cambios a prod / RLS / guard anti-alucinación | ❌ **ninguno** (respetado) |

## Batería de preguntas — antes vs. después

Fuente del "antes": `ai_messages` reales de prod (auditoría 2026-07-06).
Fuente del "después": tests (P1a/P1b) + validación read-only de los cuerpos RPC (P2).

| Pregunta | Antes (real) | Después | Qué lo arregla |
|---|---|---|---|
| ¿Qué incidentes críticos están abiertos? | `no_evidence` genérico (tool ok, 0 filas — 0 incidentes abiertos) | **"No encontré incidentes que coincidan con tu consulta en Nexus."** (mensaje honesto, no el fallback) | P1a |
| ¿Qué tareas están vencidas? | `no_evidence` genérico (0 vencidas) | **"No encontré tareas que coincidan con tu consulta en Nexus."** | P1a |
| ¿Qué debería mirar mañana? | `no_evidence` genérico (agenda vacía) | **"No tenés incidentes, tareas ni notificaciones pendientes asignadas en Nexus."** | P1a |
| Cuántas tareas del proceso de Adm | **`error`** "Copilot no disponible" (Gemini mandó limit>50) | **degrada limpio** (limit clampeado a 50 → la tool corre; args semánticos malos se saltean sin romper) | P1b |
| ¿Cuál fue la última factura emitida? | `no_evidence` (sin tool; caía en search_knowledge) | **answered** → `FACTURA_A 2-21` · Martin Battaglia · ARS 2,118,710.00 · AUTORIZADO_ARCA · 2026-07-01 · fuente `/billing` | P2 |
| ¿Cuál fue la última orden de compra? | `no_evidence` (sin tool) | **answered** → `OC-2026-0371` · Refinería Bahía Blanca SAU · firmada · 2026-07-06 · fuente `/compras/ordenes` | P2 |
| ¿Cuál fue la última factura de proveedor? | `no_evidence` (sin tool) | **answered** → `FACTURA_A 00345` · Bulonera Balemap · ARS 12,100.00 · cargada · 2026-06-28 · fuente `/compras/facturas` | P2 |
| ¿Cuál fue el último proveedor cargado? | `no_evidence` (sin tool) | **answered** → Refinería Bahía Blanca SAU (categoría, activo) · fuente `/compras/proveedores` | P2 |
| ¿Cuál fue el último contrato ANMAT firmado? | **answered** (ya funcionaba) | sin cambios (regresión verde) | — |
| ¿Qué documentos de compliance pendientes? | **answered** (ya funcionaba) | sin cambios | — |
| Resumen del contrato de X | `no_evidence` (guard metadata-vs-contenido, correcto) | **sin cambios** — sigue degradando (no hay texto de PDF). Correcto. | — (P5 futuro) |

> Los valores "después" de P2 son datos **reales de prod** obtenidos ejecutando los
> cuerpos de las RPC en modo lectura (RLS bypass como `postgres`). Una vez aplicada la
> migración, el piloto (rol admin/operaciones) los verá bajo su RLS.

## Notas de seguridad / diseño verificadas

- **RLS**: las 4 tablas leídas tienen RLS; las RPC son `SECURITY INVOKER` → heredan la
  RLS del piloto. Políticas de lectura confirmadas: customer_invoices (admin/operaciones/
  supervisor o cliente propio), supplier_invoices/purchase_orders/vendors (authenticated).
- **PII**: las RPC proyectan solo campos de negocio (nunca CUIT/tel/email/CBU/domicilio) y
  pasan el texto por `ai_docs_redact`; el engine re-redacta. Los montos usan separador de
  miles con coma en prod (`2,118,710.00`) → **no** los enmascara el redactor de PII.
- **Read-only**: las 4 tools nuevas pasan la denylist estructural de verbos de escritura y
  la allowlist `ai_*` (test `tools.test.ts`). Ningún archivo de `src/lib/ai` importa
  service_role (test estructural).
- **Guard anti-alucinación**: intacto. P1a solo actúa cuando `chunks==0 && tools>0` y el
  answer es EXACTAMENTE el fallback → nunca convierte una duda en afirmación.

## Limitación conocida (documentada, follow-up con revisión)

- **Montos ≥ 7 dígitos con formato de puntos**: si la config numérica de la DB cambiara a
  es-AR (puntos de miles), el redactor de PII podría enmascarar montos grandes (patrón
  CUIT/DNI). Hoy prod usa comas → no ocurre. Follow-up seguro: "redacción money-aware"
  (excluir números precedidos por `$`/`ARS`), **requiere revisión de seguridad** — no
  incluido acá para no tocar el guard de PII sin gate.

## Recomendación

- **P1** (solo TS, sin migración): **listo para draft deploy** tras tu OK.
- **P2**: aplicar `0181_ai_finance_overview.sql` **a mano en el SQL Editor** (G3) antes de
  que las 4 tools tengan datos; cuerpos ya validados contra prod. Con la migración sin
  aplicar, las tools degradan seguro (P1a → "No encontré facturas…"), no rompen.
- **Nada** se despliega ni se commitea sin tu autorización explícita (G1).
