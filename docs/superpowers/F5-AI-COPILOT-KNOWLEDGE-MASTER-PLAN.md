# F5 — Nexus AI / Copilot / Knowledge-RAG — MASTER PLAN

> **Estado 2026-07-03: APROBADO por Dirección · F5.0 + F5.2-lite EN PRODUCCIÓN (fail-closed).**
> Migraciones 0173–0175 aplicadas; deploy prod `8aa97a4` (`6a474ed1afe8a06286068508`); Copilot
> **2026-07-03 (mini-ventana Gemili): Copilot ACTIVADO en MOCK en prod** (`45f59b7`, deploy
> `6a4756db5ddf138b8a855179`, `AI_ENABLED=1`+`AI_PROVIDER=mock`). Gate `ai_pilot_users` y
> kill-switch **probados en vivo** (usuario admin no-piloto → "piloto cerrado"). Gemini LISTO a
> 1 env var, **NO activado** (la consulta de verificación requiere login de piloto). Proveedor IA
> confirmado por Dirección: **GEMINI/Google AI** (principal; Anthropic secundario no preferido).
> Detalle: `F5-GEMINI-ACTIVATION-EXECUTION-LOG.md`. Knowledge documental = F5.1-b. Historia previa:
> `F5-2-LITE-EXECUTION-LOG.md` (rama `feat/f5-ai-copilot-readonly`). Texto original del plan:
> Fecha: 2026-07-03 · Autor: asistente (sesión de planificación F5) · Autoridad: Martín Battaglia (Dirección).
> Gobernanza aplicable: G1–G11 (`.claude/skills/_shared/GOVERNANCE.md`). Este documento es un archivo
> nuevo **sin commitear**; no hubo cambios de código, DB, RBAC, deploy, push ni merge en su producción.

---

## 1. Resumen ejecutivo

F5 es la capa de inteligencia de Nexus OS: un Copilot interno que consulta la operación (incidentes,
tareas, workflows, documentos, compliance, clientes, facturación), resume, detecta riesgos y sugiere
acciones — siempre con permisos del usuario, cita de fuentes, auditoría completa y aprobación humana
para cualquier acción.

La tesis arquitectónica central de este plan: **F5 no necesita infraestructura nueva para nacer.**
El *spine* de Knowledge (migs 0125–0140 + adapters Connect 0149/0166/0170) ya está aplicado en prod
y proyecta eventos normalizados de casi todos los módulos. La propuesta es montar el Copilot sobre
ese spine y sobre RPCs read-only que respetan RLS ("retrieval estructurado"), y **diferir los
embeddings/pgvector a F5.1** con plan propio. Esto reduce el riesgo inicial a casi cero: sin
indexación, sin datos saliendo a un proveedor sin política aprobada, sin migraciones especulativas.

Recomendación: **GO para implementación LOCAL de F5.0 + F5.2-lite (Copilot read-only sin embeddings)**
una vez que Dirección resuelva las 8 decisiones de la sección 30. **NO GO para indexar datos
productivos (embeddings/RAG vectorial) y para cualquier agente** hasta cerrar política de PII,
proveedor de modelo y DPA.

---

## 2. Objetivo F5

Que Nexus pueda: consultar información operativa en lenguaje natural; resumir incidentes, tareas,
workflows e hilos largos; razonar sobre documentos; detectar riesgos y pendientes; asistir a
Dirección y áreas internas; sugerir acciones **sin ejecutarlas**; y hacer todo eso con permisos,
trazabilidad de fuentes, auditoría y anti-alucinación por diseño.

Separación conceptual: F4 = ecosistema colaborativo operativo (hecho). F5 = inteligencia sobre ese
ecosistema. F5 no crea flujos operativos nuevos: los lee, los explica y los mejora.

## 3. Alcance incluido (diseño F5 completo; implementación por subfases)

1. **F5.0** Gobierno IA: política de lectura, permisos, auditoría, anti-alucinación, GO/NO GO.
2. **F5.1** Knowledge/RAG base (embeddings diferidos a plan propio).
3. **F5.2** Nexus AI Copilot **read-only** (primera entrega visible).
4. **F5.3** Document Intelligence (PDFs, contratos, vencimientos, clasificación).
5. **F5.4** IA sobre incidentes/tareas/workflows (resúmenes, severidad sugerida, próximos pasos).
6. **F5.5** Inteligencia predictiva (alertas de atraso, repetición, sobrecarga, vencimientos).
7. **F5.6** Agentes internos controlados (borradores + aprobación humana).
8. **F5.7** Automatización inteligente (reglas + IA, sin acciones externas sin OK).
9. **F5.8** Evaluación, seguridad, hardening y cierre.

## 4. Alcance excluido (explícito)

- Toda implementación en esta sesión (código, migraciones, deploy, push, merge, RBAC, embeddings).
- IA con capacidad de escritura directa en DB o acciones externas (email/WhatsApp/Clientify) en
  cualquier subfase de F5 — como máximo, **borradores** que un humano aprueba (F5.6+).
- Agentes autónomos sin aprobación humana (queda para F6+, si alguna vez).
- WhatsApp productivo (pendiente `F4.4-WA-WABA-CLIENTIFY-DEPENDENCY`, decisión de Dirección).
- Email productivo saliente (dominio Resend sin verificar — bloqueado hasta acción de Dirección).
- Reconciliación de `main` (`MAIN-RECONCILIATION` = tarea OPS separada, prerequisito de crons F5).
- IA de cara a clientes externos (portal B2B) — fuera de F5 por completo.
- Reemplazo de Clientify o del flujo comercial de WhatsApp.

## 5. Estado actual verificado (2026-07-03, comandos read-only)

| # | Ítem | Evidencia | Estado |
|---|------|-----------|--------|
| 1 | `/api/version` | `{"version":"93e6c9b","builtAt":"2026-07-03T01:41:01.992Z","environment":"production"}` | ✅ coincide con handoff |
| 2 | Deploy publicado | Netlify site `tops-ordenes` (`d84a7d34-b90c-4e61-aff6-678abf1ac432`) → `published_deploy.id = 6a47132a3cfb0dba2ba13b51` | ✅ |
| 3 | Lock auto-publish | `published_deploy.locked = true`; `allowed_branches = ["main"]` | ✅ lock activo |
| 4 | Última migración aplicada | `list_migrations` (read-only) → `0172_connect_automations_mvp` (ts `20260703013227`) | ✅ |
| 5 | Próxima migración libre | **0173** (no reusar 0012/0028; huecos 0108–0119 sin uso local: verificar antes de asignar; prod numera por timestamp) | ✅ |
| 6 | F4.1–F4.4 | Migs 0142–0172 aplicadas; webhook WA sin firma → **HTTP 401** (probe real); sandbox+HMAC activos | ✅ deployadas y sanas |
| 7 | Worker/outbox | `connect-dispatch-outbox.yml` en `origin/main` (PR #44, commit `0acf4a3`); corridas `workflow_dispatch`: success 01:55Z, **failure 02:36Z**, success 03:30Z (hoy). **Sin evidencia `event=schedule` aún** | 🟡 operativo con observación |
| 8 | WABA pendiente | Decisión vigente: no tocar WABA productiva (Clientify). Sandbox preparado | ✅ pendiente aceptado |
| 9 | main / reconciliación | `origin/main` @ `0acf4a3` = el commit del incidente de auto-deploy. `main` ≠ línea de prod (`93e6c9b`) | 🔴 `MAIN-RECONCILIATION` vigente |
| 10 | Knowledge / Drive | Migs 0125–0140 + adapters Connect 0149/0166/0170 **aplicadas en prod**; `/api/knowledge/drain` existe fail-closed (`CRON_SECRET`); **sin schedule → drain apagado operativamente**. Drive: incidente 2026-07 cerrado, Compliance verde | ✅ spine vivo, drain apagado |
| 11 | Nada modificado | Solo `curl` GET/POST de prueba, `git log/show/rev-parse/fetch`, `ls/grep`, `list_migrations`, `netlify api listSites` | ✅ |

Notas honestas: (a) la corrida fallida 02:36Z del outbox no estaba en el handoff (decía 2/2 success);
no bloquea F5 pero debe registrarse; (b) el worktree principal `~/CODE/tops-ordenes` está en
`release/fiscal-f1-unified` con el fix de auth email-link staged sin deployar (fuera de alcance F5).

## 6. Dependencias con F4.1/F4.2/F4.3/F4.4

- **F4.1 (outbox/notificaciones):** F5.5/F5.6 entregan alertas y borradores *a través* del outbox
  existente — la IA nunca notifica directo. Dependencia dura: worker sano (hoy 🟡, corrida fallida
  intermedia + `event=schedule` sin evidencia).
- **F4.2 (incidentes) y F4.3 (tareas/workflows/cockpit):** son la materia prima de F5.4. Sus knowledge
  adapters (0166/0170) ya proyectan al spine → F5 lee del spine, no de las tablas operativas.
- **F4.4 (integraciones/automatizaciones):** el motor de automatizaciones R1 (0172) es el rail sobre
  el que F5.7 monta "reglas + IA". La IA sugiere/parametriza reglas; el motor determinista ejecuta.
- **Knowledge F0.5 (0125–0140):** dependencia central — es la fuente canónica de retrieval de F5.1.

## 7. Pendientes F4.4 que impactan F5

1. **`F4.4-WA-WABA-CLIENTIFY-DEPENDENCY`** — sin WhatsApp productivo, las notificaciones IA quedan
   limitadas a in-app (Connect). Aceptable para F5.0–F5.5.
2. **Email outbound roto** (56/56 failed, dominio Resend sin verificar) — ídem: canal IA = in-app.
3. **`MAIN-RECONCILIATION`** — todo cron nuevo (drain de Knowledge, refresh de embeddings F5.1,
   jobs predictivos F5.5) requiere workflow en la default branch → **bloqueado hasta reconciliar
   `main`**. F5.0/F5.2-lite no necesitan cron; F5.1+ sí.
4. **Observación `event=schedule`** — antes de colgar jobs IA del cron de GH Actions, confirmar que
   el schedule real corre (hoy solo hay evidencia `workflow_dispatch`).
5. **DEPLOY LOCK** — cualquier deploy F5 sigue el procedimiento manual seguro (Node 22, checkout
   limpio no-worktree, DRAFT + smoke, PROD + smoke). Sin excepciones.

## 8. Arquitectura IA propuesta

### Principios (no negociables, heredan G9/G10 y RBAC-ARCHITECTURE)

1. **La IA es un cliente más de Nexus, no un superusuario.** Todo retrieval corre con la sesión del
   usuario (cliente anon + RLS). **Prohibido `service_role` en el camino de retrieval.** Corolario:
   la IA no puede filtrar nada que el usuario no pueda ver ya — la escalación de privilegios vía
   prompt queda estructuralmente imposible.
2. **Read-only por capa de transporte:** el Copilot v1 solo invoca RPCs `SECURITY INVOKER` de lectura
   y vistas. Ningún tool de escritura existe siquiera como código en F5.2.
3. **Retrieval estructurado antes que vectorial:** primero SQL determinista sobre el spine Knowledge
   y las vistas existentes; embeddings recién cuando una necesidad concreta lo justifique (F5.1).
4. **Cita o silencio:** toda afirmación del Copilot referencia entidades Nexus (deep-link a
   incidente/tarea/documento/OS). Sin fuente recuperada → responde "no tengo evidencia en Nexus".
5. **Todo auditado, append-only:** prompts, contexto recuperado, respuesta, fuentes, costo, feedback.
6. **Contenido de Nexus = untrusted input:** mensajes de chat, documentos y comentarios entran al
   contexto como datos delimitados, nunca como instrucciones (defensa prompt-injection, ver §12).

### Bounded context y capas (patrón canónico)

```
src/app/(app)/copilot/            ← UI (panel lateral + página), read-only
  └─ server actions               ← auth + validación + auditoría
       └─ src/lib/ai/
            ├─ data.ts            ← retrieval: RPCs read-only vía cliente RLS del usuario
            ├─ provider.ts        ← adapter del modelo (Claude API primario; interfaz agnóstica)
            ├─ guardrails.ts      ← allowlist de fuentes, redacción PII, límites, injection
            ├─ audit.ts           ← escritura de ai_* vía RPC SECURITY DEFINER (única escritura)
            └─ prompts/           ← system prompts versionados en repo (revisables por PR)
```

- Módulo RBAC nuevo: `ai` (enum + permisos `ai.copilot.use`, `ai.copilot.admin`), seed idempotente.
- `isMock()` respetado: en demo mode el Copilot responde sobre datos mock, sin llamar al proveedor.
- Server-side only: la API key del proveedor jamás toca el cliente (G9). Sin streaming directo del
  proveedor al browser en v1 (simplifica auditoría); streaming vía server action si UX lo exige.
- El proveedor se llama con: no-training/no-retention contractual, timeout duro, presupuesto por
  usuario/día, y payload mínimo (solo chunks recuperados, nunca tablas enteras).

### Flujo de una consulta (F5.2)

1. Usuario pregunta en `/copilot` → server action valida sesión + permiso `ai.copilot.use`.
2. Planner acotado clasifica la intención contra un **catálogo cerrado de herramientas de lectura**
   (p.ej. `buscar_incidentes`, `resumen_tarea`, `vencimientos_compliance`, `buscar_knowledge`).
3. Cada herramienta = RPC read-only ejecutada con el cliente RLS del usuario. Resultados → chunks
   con metadata (entidad, id, timestamp, URL interna).
4. Guardrails: redacción de campos PII no permitidos, truncado, delimitación anti-injection.
5. Modelo genera respuesta **obligada a citar** chunk-ids; post-proceso valida que cada cita exista
   (respuesta con citas inválidas se descarta y se reintenta o se degrada a "sin evidencia").
6. Persistencia de auditoría (ai_messages + ai_sources) y render con deep-links.

## 9. Knowledge/RAG

- **Sustrato existente (aplicado en prod):** spine 0125–0140 — eventos normalizados con emisor,
  entidad, payload y estado de emisión (0132) + adapters (recon, PO, treasury, custody, rrhh,
  Connect: mensajes/incidentes/tareas) + vistas (0130) + grants endurecidos (0131).
- **F5.1-a (sin embeddings):** retrieval = full-text search de Postgres (`tsvector` español) sobre
  el spine + filtros estructurados. Cubre "buscá/resumime/qué pasó con X" con costo cero de
  infraestructura nueva y sin datos saliendo del perímetro para indexar.
- **F5.1-b (embeddings, plan propio, NO ahora):** pgvector en el mismo Postgres prod (extensión ya
  disponible en Supabase; verificar con `list_extensions` en su momento). Tabla `ai_chunks` con
  **ACL por fila** (copia de las claves de visibilidad de la entidad origen: módulo, conversación,
  rol requerido) para que el filtro de permisos se aplique **antes** del ranking vectorial. Refresh
  incremental colgado del spine (mismo patrón que el drain). Requiere: `MAIN-RECONCILIATION`
  (cron), política PII aprobada, DPA con el proveedor de embeddings, y migración 0173+ aprobada.
- **Documentos/Drive:** los binarios no se indexan en F5.1; solo metadata ya proyectada. El texto de
  PDFs entra recién con F5.3 y pipeline propio de extracción.

## 10. Fuentes de datos (catálogo inicial propuesto)

| Fuente | Subfase | Clasificación | Nota |
|---|---|---|---|
| Incidentes / Tareas / Workflows (spine) | F5.2 | Interna | núcleo del Copilot |
| Nexus Link (mensajes) | F5.2 | Interna-sensible | solo conversaciones donde el usuario es miembro (RLS ya lo garantiza); riesgo injection máximo → delimitación estricta |
| Compliance / casos / vencimientos | F5.2 | Interna | semáforo + docs metadata |
| Clientes / Operaciones / OS | F5.2 | Interna | vía vistas existentes |
| Facturación / Tesorería / Compras | F5.3+ | Sensible-financiera | solo agregados en v1; detalle con permiso del módulo |
| Documentos (contenido PDF) | F5.3 | Según documento | pipeline Document Intelligence |
| RRHH / legajos | **Excluida** hasta política PII | PII alta | sueldos, documentación personal: fuera del retrieval por defecto |
| `profiles` (PII: teléfono, etc.) | **Excluida** (finding F-01-R P1) | PII | solo nombre visible + rol |
| Caja chica | F5.3+ | Sensible | espejo Drive, no implementado aún |

Regla: **allowlist explícita** — una fuente no listada no es consultable, aunque RLS la permita.

## 11. Permisos y RLS/RBAC

- RLS es la frontera real (auditoría 2026-06-28): el retrieval con cliente-del-usuario la hereda
  completa. Ninguna policy nueva relaja nada; las tablas `ai_*` nacen con RLS estricta (cada usuario
  ve solo sus sesiones; `ai.copilot.admin` ve todo para auditoría).
- RBAC hoy está dormido/fail-open (`RBAC_ENFORCE` off, 1 asignación). F5 **no activa RBAC** (regla
  del handoff). Mitigación: guard propio en la feature (patrón page-guard) + permiso `ai.copilot.use`
  seedeado pero con enforcement local del módulo, como hacen los módulos existentes.
- `current_role()` autoritativo desde `profiles.role` — los prompts jamás deciden permisos; el
  contexto de rol se usa solo para tono/alcance de respuesta, nunca como control de acceso.
- Escrituras de auditoría: única vía RPC `SECURITY DEFINER` dedicada (`ai_log_interaction`),
  append-only, sin UPDATE/DELETE concedidos (G10).

## 12. PII y seguridad

- **PII:** allowlist de campos por fuente (§10); redacción en `guardrails.ts` antes de armar el
  prompt (DNI/CUIT/CBU/teléfonos/emails de terceros se enmascaran salvo permiso explícito del
  módulo); `profiles` PII y RRHH excluidos hasta política aprobada por Dirección.
- **Proveedor:** contrato con no-training + retención mínima; región/data-residency a decidir (§30).
  Payload mínimo necesario. API key en Netlify env, server-only, rotación documentada.
- **Prompt injection:** (a) contexto delimitado con marcado estructural y system prompt que ordena
  tratarlo como datos; (b) catálogo cerrado de tools read-only → un injection exitoso no puede
  ejecutar nada, solo sesgar texto; (c) retrieval RLS-scoped → no puede exfiltrar lo que el usuario
  no ve; (d) citas validadas → no puede inventar fuentes; (e) tests adversariales en F5.8.
- **Denegación de servicio / costo:** rate limit por usuario + presupuesto diario de tokens con
  corte duro + circuit breaker si el proveedor degrada (fallback: "Copilot no disponible", G11).
- **Secretos:** ninguno nuevo en repo; `AI_PROVIDER_API_KEY` (nombre tentativo) solo en Netlify.

## 13. Auditoría

Tablas propuestas (migración 0173+, **no creada**): `ai_sessions` (usuario, inicio, canal),
`ai_messages` (rol, contenido, tokens, costo, latencia, modelo, versión de prompt),
`ai_sources` (message_id → entidad Nexus citada, chunk, score), `ai_feedback` (👍/👎 + motivo).
Append-only, RLS estricta, retención a definir por Dirección. Dashboard admin en F5.8 (volumen,
costo, tasa de "sin evidencia", feedback). Los system prompts viven versionados en el repo → todo
cambio de comportamiento del Copilot queda en el historial de git y pasa por revisión.

## 14. Anti-alucinación

1. Cita obligatoria validada post-generación (§8, paso 5) — el mecanismo principal.
2. Grounding cerrado: el system prompt prohíbe conocimiento externo sobre datos de negocio; el
   modelo solo afirma lo que está en los chunks.
3. "Sin evidencia" como respuesta de primera clase (se mide, no se penaliza en UX).
4. Números y fechas: siempre extraídos de los chunks, nunca calculados por el modelo cuando exista
   una RPC que los dé (los agregados los hace SQL, no el LLM).
5. Temperatura baja + eval set de regresión (§20) antes de cada cambio de prompt/modelo.
6. Disclaimer permanente en UI: "Respuesta generada por IA — verificá las fuentes citadas".

## 15. Copilot read-only (F5.2 — primera entrega visible)

- Superficie: página `/copilot` + panel lateral invocable desde Cockpit/Incidentes/Tareas con el
  contexto de la entidad activa ("resumime este incidente").
- Capacidades v1: responder preguntas operativas, buscar, resumir entidades e hilos, explicar
  estados y pendientes del usuario, preparar borrador de reporte (texto para copiar, no envía),
  navegar a entidades (deep-links).
- Explícitamente ausente en v1: cualquier escritura, cualquier canal saliente, cualquier memoria
  entre sesiones más allá de la auditoría.

## 16. Acciones sugeridas

Desde F5.4 el Copilot puede *proponer*: severidad de incidente, responsable, próxima acción, tarea
faltante. La propuesta es un objeto UI con botón que lleva al formulario existente **pre-cargado**
— el submit lo hace el usuario por el flujo normal (server action existente, con sus permisos y
auditoría). La IA nunca llama a la RPC de escritura, ni siquiera "con confirmación": el que escribe
es el flujo de siempre.

## 17. Agentes controlados (F5.6)

- Agentes internos = jobs con identidad propia (`agent_id`), catálogo cerrado de capacidades
  read-only + creación de **borradores** en tablas `ai_drafts` (estado `pending_approval`).
- Todo borrador requiere OK humano explícito en UI; al aprobar, ejecuta el flujo normal del módulo
  con la identidad del aprobador. Rechazo con motivo alimenta `ai_feedback`.
- Sin cadenas de agentes, sin auto-invocación, sin acciones externas. Presupuesto y kill-switch por
  agente (`AI_AGENTS_ENABLED=0` apaga todo, fail-closed).

## 18. Document Intelligence (F5.3)

Pipeline: documento (Drive/Storage) → extracción de texto server-side → resumen/campos clave/
vencimientos con IA → resultado como **metadata sugerida** con estado `pending_review` (nunca pisa
metadata validada, G2/G10). Casos: resumen de contratos, detección de vencimientos, validación de
completitud documental (cruce con checklist Compliance), comparación de versiones, clasificación.
Nota ANMAT: la habilitación es del cliente, no de TOPS — el copy de cualquier análisis de
compliance debe respetarlo. OCR: ya existe integración OpenAI para OCR de compras; F5.3 decide si
unifica proveedor o mantiene dual (decisión §30).

## 19. Inteligencia predictiva (F5.5)

Primera ola = **heurísticas SQL + redacción IA** (no ML): tareas por vencer sin actividad,
incidentes repetidos (misma entidad/categoría en ventana), documentación por vencer (ya existe el
dato en Compliance), áreas sobrecargadas (conteo de asignaciones abiertas), OS con fricción
(reintentos/retrabajos). La IA redacta el porqué y el contexto; el trigger es determinista y
testeable. Salida: notificaciones vía outbox F4.1 con opt-in por usuario. ML real: fuera de F5.

## 20. Evaluación y métricas

- **Eval set versionado en repo:** ≥50 preguntas doradas con respuesta esperada y fuentes esperadas,
  sobre datos de staging/mock. Corre en CI local antes de cambiar prompt/modelo.
- Métricas online: groundedness (% afirmaciones con cita válida), tasa "sin evidencia", precisión
  percibida (feedback 👍/👎), latencia p95, costo por consulta/usuario/día, tasa de degradación.
- Umbrales GO F5.2→F5.3 (propuestos): groundedness ≥95% en eval set; 0 fugas PII en tests
  adversariales; feedback positivo ≥70% en piloto con Dirección.

## 21. Modelo de datos propuesto (si hiciera falta — NO creado)

`ai_sessions`, `ai_messages`, `ai_sources`, `ai_feedback` (§13); `ai_drafts` (F5.6);
`ai_chunks` + índice pgvector (F5.1-b); enum `module` + permisos `ai.*` (seed idempotente).
Todo con RLS, append-only donde aplique, y rollback doc por ventana de migraciones.

## 22. Migraciones previstas (si hicieran falta — NO creadas)

- Ventana 1 (F5.2): `0173_ai_module_enum`, `0174_ai_core` (sesiones/mensajes/fuentes/feedback +
  RPCs de auditoría), `0175_ai_rbac_seed`. + `ROLLBACK_0173_0175.md`.
- Ventana 2 (F5.1-b): `017x_ai_chunks_pgvector` + refresh. Solo con plan propio aprobado.
- Ventana 3 (F5.6): `017x_ai_drafts`.
- Números tentativos: confirmar el siguiente libre en el momento (regla: no reusar 0012/0028;
  verificar huecos 0108–0119; prod numera por timestamp). Aplicación: a mano por Dirección (G3).

## 23. Cambios frontend previstos

Página `/copilot` + panel lateral contextual; componentes de cita/fuente con deep-link; estado
"pensando/degradado"; feedback 👍/👎; disclaimer IA; badge "sugerido por IA" en F5.4+; bandeja de
borradores pendientes de aprobación en F5.6. Todo dark-mode-safe (regla de tokens: nada de
`/opacity` sobre `var()`; usar `.card` y `hover:bg-bg-surface-alt`).

## 24. Cambios backend previstos

`src/lib/ai/*` (§8); server actions de consulta; RPCs read-only `SECURITY INVOKER` por herramienta
del catálogo; RPC `SECURITY DEFINER` solo para auditoría; helper de presupuesto/rate-limit; sin
rutas públicas nuevas (nada entra a la allowlist del middleware); sin webhooks nuevos; sin crons
nuevos hasta F5.1-b (y solo post-`MAIN-RECONCILIATION`).

## 25. Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Alucinación en dato operativo | Media | Alto | §14 (citas validadas, números por SQL) |
| Fuga PII al proveedor | Media | Alto | allowlist §10, redacción §12, DPA, fuentes RRHH/profiles excluidas |
| Prompt injection vía chat/docs | Alta | Medio (v1 read-only) | §12; re-evaluar al agregar drafts |
| Costo descontrolado | Media | Medio | presupuesto duro por usuario/día, corte + telemetría |
| Dependencia proveedor (outage) | Media | Bajo | circuit breaker, Copilot degradado, ERP intacto (G11) |
| Retrieval lento (spine grande) | Baja | Medio | índices tsvector, límites de chunks, p95 monitoreado |
| Sobre-confianza del usuario | Media | Alto | disclaimer, citas visibles, cultura "verificá la fuente" |
| Cron F5 sobre main sin reconciliar | Alta si se ignora | Alto | F5.1-b bloqueado hasta `MAIN-RECONCILIATION` (§7) |
| Scope creep hacia escritura | Media | Alto | §16: la IA jamás escribe; gate por subfase con OK de Dirección |

## 26. Plan de TDD

Unit: guardrails (redacción PII, delimitación, validación de citas — casos adversariales como
fixtures); provider adapter (mock, timeouts, presupuesto); planner (intención → tool correcta).
Integración: RPCs read-only contra seed local (respetan RLS: usuario A no recupera datos de B —
test con dos sesiones); RPC de auditoría append-only (UPDATE/DELETE deniegan). E2E local: flujo
consulta→cita→deep-link con proveedor mockeado. El eval set (§20) corre como suite aparte.
Regla del repo: typecheck 0, lint 0, build verde, tests existentes (285+) intactos.

## 27. Plan de QA

Smoke autenticado por Dirección (patrón F4): consulta simple, resumen de incidente real, pregunta
sin respuesta esperable ("sin evidencia"), verificación de citas, intento de acceso cruzado
(usuario sin permiso al módulo pregunta por ese módulo → no recupera), feedback, presupuesto
agotado → degradación. QA de PII: batería de preguntas-trampa ("pasame el teléfono de X", "cuánto
gana Y") → rechazo/redacción. Todo con evidencia real (G5), checklist de 10 entregables + GO/NO GO.

## 28. Revisión adversarial esperada

Antes de cualquier deploy F5: red-team interno con foco en (1) injection vía mensajes de Nexus Link
y PDFs, (2) exfiltración cross-usuario (probar con dos cuentas reales), (3) citas falsificadas,
(4) DoS de presupuesto, (5) bypass del allowlist de fuentes, (6) fuga de secretos en logs/auditoría.
Criterio: 0 bloqueantes; ALTOs corregidos antes de GO (mismo estándar que F4.4).

## 29. Subfases F5.1/F5.2/F5.3 — orden recomendado

Propuesta de secuencia real (difiere del orden nominal, con motivo):
1. **F5.0** (gobierno, este doc + decisiones §30) →
2. **F5.2-lite** (Copilot read-only con retrieval estructurado + tsvector, **sin** embeddings):
   valor visible temprano, riesgo mínimo, sin cron, sin `main`. →
3. **F5.1-b** (embeddings/pgvector) solo si F5.2-lite muestra límites concretos de recall, y
   post-`MAIN-RECONCILIATION` + política PII + DPA. →
4. **F5.3** (Document Intelligence) → **F5.4** → **F5.5** → **F5.6/F5.7** → **F5.8** transversal.

## 30. Decisiones que Dirección debe aprobar (bloqueantes de implementación)

1. **Proveedor de modelo** (recomendación: Claude API para el Copilot; mantener OpenAI donde ya
   opera —OCR compras— hasta evaluar unificación) + DPA/no-training + región.
2. **Política PII**: confirmar exclusión de RRHH/legajos/`profiles`-PII del retrieval en todo F5.
3. **Catálogo de fuentes v1** (§10): confirmar allowlist F5.2.
4. **Presupuesto**: tope mensual de API y tope por usuario/día.
5. **Retención de auditoría** `ai_*` (propuesta: indefinida, es el historial de decisiones IA).
6. **Piloto**: quiénes usan F5.2 primero (propuesta: Dirección + 2 usuarios internos).
7. **Umbrales GO/NO GO** de §20 (o ajustarlos).
8. **Confirmar la secuencia** §29 (F5.2-lite antes que embeddings).

## 31. Criterios GO / NO GO para implementación local

**GO a implementación LOCAL de F5.2-lite cuando:** las 8 decisiones de §30 estén resueltas; el
diseño técnico detallado (spec de RPCs + tablas 0173–0175 + prompts) esté aprobado (G7); y el
worker/outbox esté verde (la observación `event=schedule` no bloquea porque F5.2-lite no usa cron).

**NO GO permanente (hasta nueva decisión de Dirección):** indexar datos productivos (embeddings),
cualquier escritura por IA, agentes, canales salientes (email/WhatsApp), activar `RBAC_ENFORCE`,
tocar `main`, y todo deploy — que además del GO propio requiere el procedimiento manual seguro.

**Hoy: NO GO a implementación. GO solo a la fase de decisión (§30) y al diseño detallado.**

---

*Fin del Master Plan F5. Ningún código, migración, secreto, deploy, push, merge ni dato productivo
fue creado o modificado durante la elaboración de este documento.*
