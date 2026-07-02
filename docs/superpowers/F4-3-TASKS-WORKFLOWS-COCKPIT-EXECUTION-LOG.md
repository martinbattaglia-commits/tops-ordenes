# F4.3 · Tareas + Workflows + Cockpit — Execution Log

## 0-bis. 🏁🏁 F4.3 CERRADA FORMALMENTE (Dirección, 2026-07-02)

**Smoke funcional autenticado: PASS 100% validado por Dirección** en producción
(`f30f79d`, deploy `6a45dd06046d9f4002a59a18`): creación · listado · detalle ·
reclamar vacante · asignar/reasignar · seguidores · prioridad · fecha límite
informativa · iniciar · completar · cancelar · reabrir · hilo lazy · comentario ·
mención · tarea desde incidente · workflow seed · avance lineal · cancelación de
cadena · cockpit read-only · notificación al detalle · usuario sin permiso
denegado · funcionamiento general correcto.

**Criterios de cierre completos:** migs `0167-0170` aplicadas · C1-C7 PASS ·
smoke PROD base PASS (0 500/502, 0 PostgREST 300) · smoke funcional autenticado
PASS · **rollback NUNCA requerido** · CERO fixes in-window. Riesgos remanentes =
solo los Bajos documentados en la Parte I §5 (backlog/follow-up, ninguno bloqueante).

### 🎨 Backlog visual registrado: `UI-POLISH-CHAT-DARK-CONTRAST`
Observación de Dirección durante el smoke: en Nexus Link / chat, en **modo
oscuro**, el contraste del área de chat y los mensajes no se ve suficientemente
claro. Clasificación: **visual polish / UX · severidad BAJA · NO bloquea F4.3 ·
sin rollback ni hotfix**. Tratamiento: mini-fase posterior de polish visual
(candidata junto con las deudas UX acumuladas). Referencias técnicas para esa
mini-fase: memoria `nexus_darkmode_token_opacity` (los tokens `var()` no
soportan `/opacity` — falla silenciosa; usar paleta literal o `-400`), superficie
afectada: `ThreadView`/burbujas de mensaje/área de composer.

**Estado final:** prod = `f30f79d` · DB top = `20260702033205 0170` · Knowledge
adapter de tareas APAGADO (activación piloto = decisión Dirección) · scheduler
OPS F4.1 sin tocar · rama `feat/connect-f4-3-tasks-workflows-cockpit` local sin
push/merge · ⚠️ coordinación vigente: el fix Drive paralelo debe rebasarse sobre
`f30f79d` antes de su deploy.

**Próximo bloque:** según Master Plan F4 → **F4.4 (spikes de de-risk WhatsApp/
Email + automatizaciones MVP sobre el outbox)**, HABILITADO SOLO PARA
PLANIFICACIÓN. Nota: las automatizaciones de F4.4 dependen del worker/scheduler
(deuda OPS F4.1 abierta) — resolver o decidir esa deuda es candidata a
precondición del plan F4.4. Sin desarrollo hasta plan aprobado por Dirección.

---

## 0. Ventana apply+deploy ejecutada (2026-07-02 ~03:28-03:40Z, autorizada por Dirección)

**Resultado: ÉXITO — rollback NO requerido · CERO fixes in-window. Prod = `f30f79d`.**

| Paso | Resultado | Evidencia |
|---|---|---|
| Pre-flight (15 puntos) | **PASS 15/15** | prod `484a447` sana, top `0166`, `0167-0171` libres, worktree `f30f79d` limpio, package files intactos, sin secretos, Netlify OK, Node v22.23.1, checkout NO-worktree, F4.2 sana (1 incidente real) |
| Apply `0167` (batch AISLADO, regla enums) | **OK** 03:28:14→03:28:20Z | `20260702032820` |
| Apply `0168` | **OK** →03:29:19Z | `20260702032919` — permiso `connect.task_admin` sembrado con `action='task_admin'` SIN conflicto (C2.6=1) |
| Apply `0169` | **OK** →03:31:32Z | `20260702033132` — seeds 2 plantillas + 6 pasos; policy notifications extendida |
| Apply `0170` | **OK** →03:32:05Z | `20260702033205` — fuente `enabled=false` (D-F43-9), 0 eventos |
| Checkpoints catálogo C1-C4 | **PASS 21/21** | enums, 5 tablas, 5 policies (incl. rama VACANTES fix C-1 y instancias CALIFICADAS fix I-1), permiso+grants, 0 write grants (anon+authenticated), realtime, uidx anti doble-avance, 8 RPCs + 7 helpers con search_path 100%, policy notif con rama role_target (fix I-2) |
| Funcional C6 (0-footprint, `__QA_ROLLBACK__`) | **PASS íntegro** | Alta TSK-format · fail-closed sin permisos · claim de vacante + anti-robo · **`ensure_thread` REAL (fix C-1 CASE→enum verificado en prod: hilo creado, creador=owner, idempotente)** · post_message al hilo de tarea · seguidores+notif · máquina completa (start/complete/reopen auditado/cancel-exige-motivo/cancelada terminal; motivo en tabla y SOLO length en audit) · **RLS bajo rol authenticated real: vacante VISIBLE para staff, privada OCULTA a terceros, asignación de terceros denegada** · **workflow 3 pasos end-to-end** (instanciar→notif role_target operaciones→claim→completar→paso 2 vacante+notif supervisor→…→instancia `completado`) · **broadcast role_target MARCADO LEÍDO por el rol (fix I-2, row_count=1)** · **cancelar paso activo → instancia `cancelado` (fix I-1)** · 0 overloads. Footprint final: tasks/instances/notifs/audit/convs = **0/0/0/0/0** |
| Regresiones C7 | **PASS** | incidentes F4.2 intactos (1 real), RPCs F4.1/F4.2 presentes, 0 PostgREST 300, outbox 35 pending (34+1 del mensaje del incidente real del smoke F4.2 — orgánico, inerte, scheduler NO tocado), seeds intactos |
| Deploy DRAFT | **OK** | deploy `6a45dc8ae614c8789f9d2ca5`, draft URL `https://6a45dc8ae614c8789f9d2ca5--tops-ordenes.netlify.app`, build Node 22 sin ENOENT/PLUGIN_DIR |
| Smoke DRAFT | **PASS** | `/api/version=f30f79d`; login 200; tareas/incidentes/notificaciones/canales/dashboard/ejecutivo 307 fail-closed; 0 5xx |
| Deploy PROD | **OK** 03:37→03:39Z | deploy **`6a45dd06046d9f4002a59a18`** → `https://nexus.logisticatops.com`. **Rollback point (no usado): `6a45c96d220b1ec727fecf03` (`484a447`)** |
| Smoke PROD | **PASS** | `/api/version=f30f79d` production; 12/12 rutas OK; **0 500/502; 0 PostgREST 300** |
| Smoke funcional autenticado | **PENDIENTE de Dirección** | Checklist de 23 puntos (mandato Etapa 8) = Validation Pack §3 |

**Nota operativa:** el deploy `f30f79d` NO incluye el fix del incidente Drive
(rama paralela `fix/drive-credentials-provider-f42`, esperando su propio GO) —
tras esta ventana ese fix debe REBASARSE sobre `f30f79d` antes de su deploy,
o su deploy pisaría F4.3.

**Cumplimiento:** cero push/merge · migraciones SOLO 0167-0170 (0171 NO creada) ·
scheduler OPS F4.1 intacto · Knowledge drain intacto · sin WhatsApp/Email/IA/
CCTV/automatizaciones/cron-reminders/portal/kanban/builder/sub-tareas ·
RBAC_ENFORCE intacto · cambios RBAC = `connect.task_admin` + extensión declarada
de la policy de notifications (rollback documentado).

**Cierre formal F4.3** = smoke funcional autenticado PASS por Dirección (o aceptación explícita).

---

# Parte I — Implementación LOCAL (histórico de la preparación)

> Fecha: 2026-07-02. ADR-F4-3 + Master Plan aprobados por Dirección con
> D-F43-1..9 ratificadas (defaults). **Paquete 100% LOCAL: cero escrituras en
> producción, cero deploy/push/merge; migraciones ENTREGADAS-NO-APLICADAS (G3).**
> Worktree `~/CODE/tops-ordenes-f43-tasks` · rama
> `feat/connect-f4-3-tasks-workflows-cockpit` (base = `484a447` = prod; los
> commits previos son docs + el fix SQL 0165 ya aplicado en prod).

## 1. Decisiones D-F43 aplicadas

| D | Aplicación | Ajuste técnico declarado |
|---|---|---|
| D-F43-1 | ADR íntegro: tarea ≠ incidente ≠ mensaje; workflows lineales; cockpit read-only | `pendiente→completada` directo permitido (necesario para completar pasos vacantes por el creador/iniciador; el ADR §4 lo implicaba en "completada la marca el asignado, el creador o task_admin") |
| D-F43-2 | Sin estado `en_espera` | — |
| D-F43-3 | Creador reasigna sus tareas; asignado devuelve; claim solo vacantes | — |
| D-F43-4 | RLS privado-por-involucrados + task_admin/admin | **+ rama de VACANTES abiertas visibles con `connect.view`** — requerida por el propio ADR §5 ("reclamable por cualquier staff") y el flujo role_target→claim; sin ella el feature central no funcionaba (hallazgo C-1 frontend). Al asignarse vuelve a ser privada |
| D-F43-5 | Pasos de workflow nacen vacantes + aviso `role_target` al rol | + fix I-2: la policy de UPDATE de notifications se extendió para que el rol destino pueda marcar leído el broadcast (F4.3 = primer emisor de role_target ≠ 'admin'; rollback documentado) |
| D-F43-6 | 2 plantillas seed: "Seguimiento post-incidente" y "Preparación de documentación entre áreas" (3 pasos c/u: operaciones→supervisor→admin) | Sin UI de edición (excluida) |
| D-F43-7 | Resolver incidente NO exige tareas completas | El detalle del incidente lista sus tareas (aviso visual) |
| D-F43-8 | Migs `0167` enums AISLADA / `0168` schema+permiso / `0169` RPCs+seeds / `0170` Knowledge | El seed del permiso vive en 0168 (regla enum-tx; el mandato nombró 0167 "enums_permissions": los permisos entran como VALOR de enum ahí, el INSERT en 0168) |
| D-F43-9 | Adapter Knowledge APAGADO (`enabled=false`); drain intacto | Payload incluye `context_id` (contrato 0149/0166) |

## 2. Entregado

**Migraciones (entregadas-NO-aplicadas)** + `ROLLBACK_0167_0170.md`:
`0167` valores de enum (`task`, `task_admin`) aislados · `0168` 5 tablas
(tasks/followers/templates/steps/instances) + TSK-AAAA-NNNN + índices (incl.
unique instancia/paso anti doble-avance) + RLS con helpers SECDEF
anti-recursión + realtime + permiso `connect.task_admin` · `0169` 8 RPCs + 7
helpers NULL-safe + avance/cancelación de workflow síncronos + policy
notifications extendida + seeds · `0170` adapter apagado.

**Frontend:** capa hexagonal espejo de incidentes (domain/port/adapter/
use-cases/actions) · `/connect/tareas` (+`/nueva`, +`/[taskId]`) · panel de
workflows · vínculo incidente→tarea bidireccionalmente navegable (creación
unidireccional) · card Colaboración en Cockpit (Suspense, auto-ocultable) ·
sidebar · `hrefFor('connect_task')` · seeds demo · 28 tests nuevos.

**Commits locales (SIN push/merge):**
| Commit | Contenido |
|---|---|
| `a92f29e` | docs: ADR + Master Plan aprobados |
| `6d54cef` | feat: 0167 enums |
| `eb4fd68` | feat: 0168 schema |
| `cbaa371` | feat: 0169 RPCs + 0170 Knowledge |
| `9a32c3f` | feat: UI tareas + workflows + cockpit |
| `040261c` | fix: hardening por revisión adversarial |
| (final) | docs: validation package |

## 3. QA (final, tras fixes)

typecheck 0 · lint 0 errores/0 warnings nuevos · vitest **465/465 PASS**
(base F4.2 = 437; +28) · build OK (rutas `/connect/tareas{,/nueva,/[taskId]}` +
`/ejecutivo` compilando) · preview demo: lista con chips y "Vencida" derivada,
vacante con "Reclamar", panel de workflows, detalle con botonera por rol e
"Iniciar conversación" lazy; 0 errores de consola.

## 4. Revisión adversarial (2 revisores independientes: SQL y frontend)

| # | Hallazgo | Clase | Disposición |
|---|---|---|---|
| SQL C-1 | `CASE` de literales unknown se resuelve como TEXT → `text→enum` sin coerción de asignación → **42804 en `ensure_thread` en la 1ª ejecución** (hilo lazy muerto de fábrica) | **Bloqueante** | **CORREGIDO** — cast explícito `::connect_member_role_t`. **GOTCHA NUEVO del catálogo** (no lo detecta ningún lint; el kit C6.2 lo prueba con ejecución real) |
| FE C-1 | RLS privado-por-involucrados hacía INVISIBLES las vacantes → claim/tablero/notificación de workflow rotos para no-admins (contradicción con ADR §5) | **Bloqueante** (de producto) | **CORREGIDO** — rama de vacantes abiertas en la policy (registrada como ajuste de D-F43-4, ver §1) |
| SQL I-1 | Policy de instancias: `= id` sin calificar capturado por el alias interno → rama "veo mis pasos" siempre falsa | Alto | **CORREGIDO** — `connect_workflow_instances.id` calificado |
| SQL I-2 / FE I-2 | Broadcasts `role_target` ∉ {'admin'} imborrables (policy UPDATE de 0162 sin rama de rol) → badge unread eterno para operaciones/supervisor | Alto | **CORREGIDO** — policy extendida en 0169 (+rollback a cuerpo 0162 documentado) |
| FE I-1 / SQL M-5 | Cancelar el paso activo dejaba la instancia `en_curso` eterna ('cancelado' era código muerto) | Alto | **CORREGIDO** — la instancia pasa a `cancelado` + notif al iniciador + aviso en la UI de cancelación |
| FE I-3 | "Iniciar conversación" ofrecido/aceptado en estados terminales (hilo read-only inútil) | Alto | **CORREGIDO** — gate UI + guard en el RPC |
| FE I-4 | Seguidor no podía dejar de seguir una tarea cancelada | Alto | **CORREGIDO** (dominio + test; usa `isFollower`) |
| SQL I-3 / FE M-8 | Descripción del permiso decía "instanciar workflows" pero la RPC (y el ADR §13 ratificado) exige solo `connect.create` | Medio | **CORREGIDO** — descripción alineada al ADR §13 |
| SQL M-3 | Notif duplicada en devolución si creador=asignado | Medio | **CORREGIDO** (guard `is distinct from`) |
| SQL M-7 | Payload Knowledge sin `context_id` (contrato 0149/0166) | Medio | **CORREGIDO** |
| SQL M-8 | Revokes sin `anon` | Medio | **CORREGIDO** |
| FE M-2/M-3/M-4/M-6 | Mock≠SQL en vistas; mias/creadas sin uid degradaba a todas; collab-summary con ceros silenciosos + card bloqueaba TTFB; due sin prefill | Medio | **CORREGIDOS** (incl. `<Suspense>` en el cockpit) |
| SQL M-1 | Claim ciego: conocer el uuid de una vacante permitía auto-otorgarse acceso | Bajo→resuelto de facto | La rama de vacantes visibles (FE C-1) alinea visibilidad con reclamabilidad; documentado |
| SQL M-2 / FE M-5 | Oráculo de estado/existencia pre-autorización (no-op antes de guards) | Bajo | **DOCUMENTADO** — patrón compartido con 0165 (prod); ticket conjunto F4.2+F4.3 |
| SQL M-4 | Unfollow sin audit; quitar seguidor/reasignar NO revoca la membresía del hilo (des-compartir efectivo requiere `connect_remove_member`) | Bajo | **DOCUMENTADO** — consecuencia del modelo; guía de piloto |
| SQL M-6 | FK instances SET NULL + check workflow/step: un DELETE de instancia por mantenimiento fallaría confuso | Bajo | **DOCUMENTADO** (deny-all lo hace teórico) |
| SQL M-9 | `connect_create_conversation` acepta `kind='task'` huérfano (pre-existente para 'incident') | Bajo | **DOCUMENTADO** — follow-up compartido |
| FE M-1 | Claim/instanciar ofrecidos sin modelar `connect.create` en el viewer (error claro post-click) | Bajo | **DOCUMENTADO** (paridad F4.2 M-7) |
| SQL M-3b/M-5b | Iniciador puede recibir aviso doble (individual+broadcast); reabrir el último paso no re-abre la instancia; pasos no contiguos truncarían plantillas futuras | Bajo | **DOCUMENTADOS** (seeds actuales contiguos; medir en piloto) |
| FE M-7 | Búsqueda de perfiles sin debounce | Bajo | Paridad F4.2 — deuda compartida documentada |

**Verificado limpio por los revisores:** los 4 gotchas conocidos (UNIQUE
module/action; 42702/ON CONFLICT función por función; has_permission NULL con
coalesce en todo; on-conflict-sin-target solo sobre PK inambigua) · recursión
RLS (helpers SECDEF) · PII en broadcasts (role_target solo lleva títulos de
PASOS de plantilla seedeados, nunca de tareas) · idempotencia de los 4 archivos
· compatibilidad 0142-0166 (cero redefiniciones salvo la policy declarada) ·
matriz dominio↔RPC línea por línea · rollback objeto por objeto · locks sin
deadlock + anti doble-avance.
**Resultado final: 0 Bloqueantes / 0 Altos abiertos.**

## 5. Riesgos remanentes

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Vacantes visibles para todo staff con connect.view (título+descripción) | Por diseño ratificable (ADR §5); no poner datos sensibles en tareas vacantes — guía de piloto |
| R2 | Marcar leído un broadcast de rol lo marca para TODO el rol | Semántica inherente del modelo 0004; alternativa (fan-out por usuario) anotada como follow-up |
| R3 | Des-compartir efectivo requiere también sacar del hilo | Documentado (SQL M-4); follow-up F4.3.x |
| R4 | Volumen de notifs de tareas ≫ incidentes | Fan-out acotado + medición piloto; coalescing como palanca |
| R5 | Oráculo de metadata pre-guard (compartido con F4.2 en prod) | Ticket conjunto; payloads sin contenido |
| R6 | Activar Knowledge de tareas expone metadata a todo staff (visibility 'staff') | APAGADO; la activación re-ratifica el trade-off (nota en 0170) |
| R7 | Deploy: riesgo DEPLOY-1 de siempre | Procedimiento validado obligatorio |

## 6. Smoke plan y GO/NO-GO de ventana

`F4-3-TASKS-WORKFLOWS-COCKPIT-VALIDATION-PACK.md` (C1–C7; el funcional C6
DEBE ejecutar `ensure_thread` real — verifica el fix del bloqueante SQL C-1).

## 7. Recomendación

**GO** para solicitar a Dirección la ventana única de apply (`0167`→`0168`→
`0169`→`0170`, cada archivo un batch, 0167 en tx separada) + deploy draft-first
+ smoke + piloto. Paquete completo, revisado adversarialmente (2 bloqueantes y
5 altos corregidos y re-verificados), QA verde, rollback listo.

## 8. Confirmaciones de cumplimiento

- Producción NO modificada (solo SELECT read-only de verificación).
- CERO push / merge / deploy / apply. `0171+` NO creadas.
- Scheduler OPS F4.1 NO tocado (registrado solo como dependencia futura de recordatorios).
- WhatsApp / Email / IA / CCTV / automatizaciones externas / cron reminders /
  portal externo / kanban / builder de workflows / sub-tareas: NO implementados.
- `RBAC_ENFORCE` intacto; único cambio RBAC = `connect.task_admin` + la
  extensión declarada de la policy de notifications (rollback documentado).
- package files sin cambios; sin secretos.
