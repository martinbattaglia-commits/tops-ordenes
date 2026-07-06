# COPILOT_CONTEXT_AUDIT.md
**Nexus Copilot — Auditoría de contexto/retrieval (read-only)**
Fecha: 2026-07-06 · Autor: análisis asistido · Entorno: prod `arsksytgdnzukbmfgkju` · Modo: **solo lectura, sin cambios aplicados**

> Regla clave respetada: **no se relajó ningún guardarraíl**, no se tocó producción, no se escribió en la DB. Todas las consultas fueron `SELECT`/llamadas a RPC de lectura. El cliente MCP entra como `postgres` (bypass RLS) → lo observado es el **techo** de datos disponibles, no lo que ve el piloto bajo RLS (se marca la distinción donde importa).

---

## 1. Arquitectura actual (mapa de flujo real)

```
UI  src/app/(app)/copilot/{page,CopilotChat}.tsx
 └─ Server Action  copilot/actions.ts
     └─ askCopilot()  src/lib/ai/engine.ts   ← ÚNICO camino al provider
         1. checkGate()          gate.ts    kill-switch + sesión + ai_pilot_users (fail-closed)
         2. checkBudget()        budget.ts  tope diario/usuario + mensual USD
         3. LOOP (maxRounds+1):
            provider.plan()      providers/gemini.ts  → Gemini decide: tool_calls | final
              executeTool()      data.ts   → supabase.rpc(spec.rpc)  (cliente de sesión = RLS)
              catálogo           tools.ts  → 12 tools = 12 RPC read-only
            validateCitations()  guardrails.ts   [S#] deben existir
            isMetadataContentRisk()  guardrails.ts   ficha vs contenido → degrada
         4. logInteraction()     audit.ts  → ai_log_interaction → ai_messages/ai_sources
```

**Hecho central:** el *retrieval es dirigido por el LLM*. Gemini decide **si** llama una tool, **cuál** y con **qué args**. El "último/abierto/vencido/crítico" no lo calcula SQL de forma determinística salvo dentro de cada RPC; la **elección** de RPC y de filtros la hace el modelo.

**Rama/worktree de referencia (linaje de producción):**
`~/CODE/tops-ordenes-f5-1b01` → `feat/f5-1b-0-1-docs-retrieval` (`b8d9a69`), descendiente de `ccd9063` (Gemini live) → `66f9060` (F5.1-b.0.1 retrieval) → `b8d9a69`. Prod se despliega por Netlify CLI (no git), coherente con este linaje.

---

## 2. Tools / RPCs actuales (todas existen en prod, todas SECURITY INVOKER = respetan RLS)

| Tool (catálogo) | RPC | Cubre |
|---|---|---|
| search_knowledge | `ai_search_knowledge` → **lee solo `searchable_items`** | FTS: SOLO compliance_documento + contrato |
| connect_search | `connect_search` | Nexus Link (mensajes) |
| incidents_overview | `ai_incidents_overview` → `connect_incidents` | incidentes por estado/severidad ✅ |
| tasks_overview | `ai_tasks_overview` | tareas abiertas/vencidas/mías ✅ |
| workflows_stuck | `ai_workflows_stuck` | workflows trabados |
| entity_timeline / entity_360 | `ai_entity_timeline` / `ai_entity_360` | cronología de una entidad |
| compliance_pending | `ai_compliance_pending` | compliance vencido/por vencer ✅ |
| contracts_overview | `ai_contracts_overview` → `contracts` (57) | contratos metadata ✅ |
| docs_browse | `ai_docs_browse` → `searchable_items` | fichas compliance/contrato ✅ |
| clients_health | `ai_clients_health` | clientes con más incidentes/tareas |
| ops_digest | `ai_ops_digest` | eventos últimas N horas |
| my_agenda | `ai_my_agenda` | agenda del usuario |

**Sin tool ni proyección (invisibles para Copilot):** `customer_invoices`, `supplier_invoices`, `purchase_orders`, proveedores/vendors como entidad, `clients` (listado/último), organigrama/personas.

---

## 3. Estado de los datos (prod, techo sin RLS)

| Dominio | Filas | Último | Observación |
|---|---|---|---|
| **connect_incidents** | **2** | 2026-07-02 | INC-0003 *cerrado*, INC-0004 *resuelto* → **0 abiertos, 0 críticos** |
| tareas (RPC) | 6 abiertas / **0 vencidas** | — | hay abiertas; **ninguna vencida** |
| **customer_invoices** | **29** (21 no anuladas) | 2026-07-01 | **answerable — sin tool** |
| **supplier_invoices** | **16** (0 aprobadas, todas 'cargada') | 2026-06-28 | **answerable — sin tool** |
| **purchase_orders** | **24** | **2026-07-06 (hoy)** | **answerable — sin tool** |
| contracts | 57 (23 de Drive) | firma 2026-05-21 | tool OK ✅ |
| crm_contracts | 0 | — | flujo no usado; contratos viven en `contracts` |
| clients | 6 activos | — | sin tool de listado |
| **searchable_items / ai_docs_projection** | **569 compliance + 231 contrato** | — | **ningún otro dominio proyectado** |
| **knowledge_nodes** (grafo) | **0** | — | grafo vacío; solo se usa la proyección |
| contract_sync (última corrida) | **partial, 0 errores, 95 upd, 3 new** | **2026-07-06** | **Drive sync SANO** |
| ai_pilot_users | 6 | — | incluye martin.battaglia@ y martin@ → **gating no es el problema** |

---

## 4. Reproducción con datos reales (extracto de `ai_messages`, ground-truth)

| Pregunta real | tools_used | outcome | Diagnóstico |
|---|---|---|---|
| ¿Qué incidentes críticos están abiertos? (×4 veces) | `incidents_overview` ×4 | no_evidence | **Datos vacíos** (0 abiertos). Ruteo correcto. Mensaje engañoso. |
| ¿Qué tareas están vencidas? (×2) | `tasks_overview` ×4 | no_evidence | **0 vencidas.** Ruteo correcto. Mensaje engañoso. |
| ¿Qué debería mirar primero mañana? | `my_agenda` ×4 (+2) | no_evidence | Agenda del usuario vacía. Mensaje engañoso. |
| Cuál fue el último contrato firmado / que se firmó | `contracts_overview` | **answered ✅** | Funciona. |
| me buscás el contrato de tex argenta | `contracts_overview` | **answered ✅** [S1] | Funciona. |
| ¿Documentos de compliance pendientes? | `compliance_pending` | **answered ✅** (15) | Funciona. |
| me das la plancheta de Lujan de compliance | `docs_browse` | **answered ✅** | Funciona. |
| resumen del contrato de X (×3) | `docs_browse` | no_evidence | **Guard metadata-vs-contenido OK** (no hay texto de PDF). Correcto. |
| Cuántas tareas del proceso de Adm | `search_knowledge` | **error** | **BUG**: Gemini mandó `limit>50` → zod throw → `outcome=error` → "Copilot no disponible". |
| saldo del banco galicia / presidente de TOPS | `search_knowledge` | no_evidence | Dominio no proyectado (tesorería/organigrama). Fuera de índice. |

---

## 5. Causa raíz (clasificada contra la taxonomía A–Q del pedido)

**Primarias:**

- **(A/J) Conflación "0 filas" ↔ "no puedo".** El motor tiene un único `no_evidence` para: tool corrió y dio 0 filas · el modelo se autocensuró · el guard degradó. La queja del screenshot (incidentes/tareas/agenda) es en realidad **datos genuinamente vacíos** reportados con un mensaje que **parece falla**. → Fix: capa determinística que distingue y responde honesto ("No hay incidentes críticos abiertos registrados en Nexus"). **No requiere tocar el guard.**
- **(C + tools faltantes) Dominios invisibles: facturas, órdenes de compra, proveedores.** Sin RPC y sin proyección, con datos ricos (29 facturas / 24 OC / 16 fact. proveedor). → Fix: RPCs read-only aditivas + tools.
- **(Arquitectura / K) Retrieval dirigido por LLM = frágil.** Gemini repite la misma tool 4× (thrashing), se autocensura a NO_EVIDENCE aun con ruteo correcto, y un arg fuera de rango (`limit>50`) **rompe todo el turno**. → Fix: (a) pre-router determinístico para las top-N preguntas estructuradas (SQL calcula último/abierto/vencido/crítico, el modelo solo redacta y cita); (b) coerción robusta de args (clamp, no error fatal).

**Secundarias / no-bug:**
- **(O) Contenido de contratos/compliance:** solo se proyecta la **ficha** (metadata), no el texto del PDF → resúmenes/cláusulas **degradan correctamente**. Mejorarlo = extracción de texto de PDF (pesado, requiere autorización).
- **(B) Drive sync:** **descartado como causa** — corrió hoy con 0 errores.
- **(G) RLS:** no bloquea los casos probados (contratos/compliance respondieron; incidentes/tareas vacíos por datos). *A verificar*: visibilidad bajo RLS de las 6 tareas abiertas para el piloto.
- **(L/M/N) Tools/RPCs/migraciones:** todas presentes e invocadas; proyección poblada (569+231). Descartadas.
- **(P) Source chips:** hay rama aparte `fix/copilot-source-links-anmat`; `entityUrl()` mapea a rutas internas válidas.
- **(Q) Guard:** bien calibrado en la práctica (no sobre-degrada las preguntas legítimas de metadata). No tocar.

**Titular:** el Copilot está **mayormente conectado y funcionando**. Las fallas se reparten en (a) **datos vacíos con mensaje engañoso**, (b) **tres dominios sin tool**, y (c) **fragilidad por delegar el retrieval al LLM**. La solución es exactamente la intuida: **capa determinística de tools/RPCs + mensajes de vacío honestos**, sin aflojar el guardarraíl.

---

## 6. Plan priorizado (todo aditivo y reversible)

**P1 — Quick fix seguro (bajo riesgo, alto impacto, sin SQL):** distinguir vacío-vs-falla en `engine.ts`.
- Cuando una tool corre y devuelve 0 filas, propagar `empty_reason` y devolver un mensaje específico por dominio ("No hay incidentes críticos abiertos registrados en Nexus", "No hay tareas vencidas", etc.) en vez del genérico.
- Clampeo/coerción de `limit` y demás args numéricos antes de zod (o capturar `ToolArgsError` por-call y saltear esa call, en vez de romper el turno).
- Solo TS, sin migraciones, cubierto por tests unitarios del engine/guardrails.

**P2 — Cerrar dominios invisibles (RPCs read-only aditivas + tools):** facturas, OC, proveedores.
- Nuevas RPC SECURITY INVOKER (misma familia `ai_*`): `ai_customer_invoices_overview`, `ai_supplier_invoices_overview`, `ai_purchase_orders_overview`, `ai_suppliers_overview` (modos: último/recientes/por cliente/por proveedor/estado).
- Nuevas entradas en el catálogo `tools.ts` + schemas + system prompt (guía de ruteo).
- Migración **aditiva** (solo `CREATE FUNCTION`), con `DROP FUNCTION` de rollback. **No aplicar a prod sin GO.**

**P3 — Robustez del router (determinismo para top-N):** pre-clasificador liviano que, para intenciones inequívocas (último X, abiertos, vencidos, críticos, próximos N días), invoca la RPC correcta **antes** de Gemini y pasa el resultado como contexto; el modelo solo redacta y cita. Reduce thrashing y autocensura.

**P4 — Observabilidad:** ya existe `ai_messages` con outcome/tools/error/latency. Agregar `empty_reason` explícito y un tablero de "fallback por motivo".

**P5 — (Diferido, requiere autorización) Extracción de texto de PDF** de contratos/compliance para habilitar resúmenes/cláusulas. Pesado; gate de contadora/legal; no ejecutar en masa sin OK.

---

## 7. Recomendación de despliegue
- **P1** es candidato a draft deploy tras tests (sin migración).
- **P2** requiere migración aditiva → revisar SQL + aplicar en local/draft, **prod solo con autorización explícita**.
- **P3** iterativo sobre P1/P2.
- **P5** NO sin autorización + gate funcional.
- Nada de esto toca datos productivos, RLS, ni el guardarraíl anti-alucinación.
