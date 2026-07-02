# ADR-F4-3 · Tareas colaborativas + Workflows entre áreas

> **Estado: PROPUESTO — pendiente de aprobación de Dirección.**
> Fecha: 2026-07-02. Contexto: F4.2 cerrada (prod `484a447`, migs hasta `0166`).
> Las tareas NO existen en el spec (verificado: §1.4 lista 11 subsistemas sin
> tareas; las menciones a "task" del spec son la visión KIL/agentes de la Parte
> III, no relacionada). Gobernanza del Dossier: capacidad nueva ⇒ ADR aprobado
> ANTES de una línea de código. Este ADR es esa precondición.
> **Solo diseño: nada implementado, producción intacta.**

## Contexto

La coordinación de trabajo entre áreas de TOPS (depósito, flota, compliance,
comercial, administración) hoy vive en WhatsApp personal y planillas. F4.1 dejó
menciones/notificaciones y F4.2 dejó incidentes (lo que se ROMPE). Falta la
unidad para lo que hay que HACER: la tarea. Regla de Decisión del programa:
PASA (reemplaza coordinación fuera de Nexus).

## 1. Qué ES una tarea

Una **unidad de trabajo asignable y verificable**: algo que una persona debe
hacer, con responsable único, estado, prioridad, vencimiento informativo y
trazabilidad completa. Vive en el bounded context `connect` (es
conversación-céntrica cuando necesita discusión) y puede originarse en: un
incidente ("reparar el portón" nace de INC-2026-0001), un paso de workflow
(cadena entre áreas), o directamente de una persona.

## 2. Qué NO es una tarea

- NO es un mensaje ni un reemplazo del chat (la discusión vive en el hilo).
- NO es un incidente (ver §3).
- NO es un proyecto/épica/Gantt: sin jerarquías profundas, sin dependencias
  arbitrarias, sin cronogramas. (Sub-tareas = FUTURO explícito.)
- NO es un recordatorio personal con alarma: `due_at` es INFORMATIVO; los
  recordatorios automáticos dependen de un cron/worker (deuda OPS F4.1) y
  quedan como dependencia futura registrada, NO en F4.3.
- NO es un ticket externo: 100% interno (sin clientes/proveedores hasta F5).
- NO es un motor BPM: los workflows de §13 son secuencias lineales de tareas,
  sin condicionales, sin SLA automático, sin motor genérico.

## 3. Tarea vs. incidente vs. mensaje

| Dimensión | Mensaje | Incidente (F4.2) | Tarea (F4.3) |
|---|---|---|---|
| Naturaleza | Comunicación | Algo se ROMPIÓ (reactivo) | Algo hay que HACER (proactivo) |
| Atributo central | Contenido | Severidad + estado de resolución | Responsable + vencimiento + estado de avance |
| Ciclo | — | abierto→…→resuelto→cerrado (verificación del reportante) | pendiente→en_progreso→completada (sin fase de verificación separada) |
| Identidad | seq en hilo | `INC-AAAA-NNNN` | `TSK-AAAA-NNNN` |
| Relación | vive en conversación | tiene hilo SIEMPRE (1:1) | hilo OPCIONAL (lazy, al primer comentario) |
| Origen típico | persona | evento operativo | persona / incidente / paso de workflow |

Regla práctica: si requiere diagnóstico+resolución de una avería/disrupción →
incidente; si es trabajo planificable con dueño y fecha → tarea; si es
conversación → mensaje. Un incidente puede GENERAR tareas (vínculo navegable).

## 4. Estados

`pendiente → en_progreso → completada` + `cancelada` (terminal desde
pendiente/en_progreso). Reapertura `completada → en_progreso` permitida y
AUDITADA (espejo de la lección F4.2). `cancelada` = terminal absoluto.
- `completada` la marca el asignado, el creador o `task_admin`.
- `cancelada` la marca el creador o `task_admin` (auditada con motivo breve).
- Sin estado "bloqueada/en_espera" en MVP: la espera se expresa con el hilo y
  el vencimiento (D-F43-2 si Dirección quiere `en_espera` como en incidentes).
- "Vencida" NO es estado: es derivado de lectura (`due_at < now()` y no
  terminal) — evita transiciones automáticas dependientes de cron.

## 5. Asignación

Responsable **único** (`asignado_a`). La tarea puede nacer asignada (el creador
elige) o **vacante**. Vacante = reclamable ("claim") por cualquier staff con
`connect.create` — patrón validado en F4.2 (claim SOLO si `asignado_a is null`).
El asignado entra como miembro del hilo si existe.

## 6. Reasignación

- `task_admin` (permiso nuevo, §15): reasigna cualquier tarea a cualquier interno.
- **Creador**: reasigna SUS tareas (es su pedido; a diferencia del incidente,
  donde la reasignación es solo de admin — D-F43-3).
- **Asignado**: puede DEVOLVER la tarea (des-asignarse → vuelve a vacante,
  notifica al creador). No puede pasársela a un tercero.
- Destinos válidos: mismo criterio F4.2/0162 (interno activo, `client_id null`).
- Todo cambio de asignación: auditado + notificación síncrona.

## 7. Responsables y seguidores

- 1 **responsable** (`asignado_a`) — el que la debe completar.
- N **seguidores** (`connect_task_followers`): reciben notificaciones de
  cambios relevantes sin ser responsables. El **creador es seguidor implícito**
  (no se puede des-seguir de lo que pidió). Cualquier involucrado puede
  seguir/dejar de seguir; el creador/task_admin pueden agregar seguidores
  (quedan notificados al ser agregados).

## 8. Prioridad

Enum `baja | media | alta | urgente` (default `media`). Mapea a la prioridad de
notificación existente (`urgente→urgent`, `alta→high`, resto `normal`).
La cambian creador, asignado o `task_admin`; auditado. (Nota: se llama
"prioridad" y no "severidad" a propósito — severidad describe impacto de un
incidente; prioridad describe orden de trabajo.)

## 9. Fecha límite

`due_at timestamptz` opcional, **INFORMATIVA** (misma decisión que `sla_due_at`
de A2/F4.2): ordena y colorea la UI ("vence hoy", "vencida"), NO dispara nada.
Recordatorios/escalamiento automáticos = dependencia del scheduler (deuda OPS
F4.1, registrada) → FUTURO, fuera de F4.3. La cambian creador/asignado/task_admin,
auditado.

## 10. Comentarios

Reusan el motor Connect al 100%: la tarea tiene conversación `kind='task'`
**opcional y lazy** — se crea recién al primer comentario/adjunto (a diferencia
del incidente, cuyo hilo nace siempre). Motivo: se esperan muchas tareas
livianas ("comprar precintos") que no necesitan hilo; crear miles de
conversaciones vacías ensucia bandeja/búsqueda. Al crearse el hilo entran como
miembros: creador, asignado y seguidores. Menciones, adjuntos y fijados
funcionan gratis (F4.1/F3). Requiere valor de enum `'task'` en
`connect_conversation_kind_t` (migración aislada, regla enum-en-tx-propia).

## 11. Auditoría

`audit_log` append-only, `entity='connect_task'`, acciones:
`connect.task.create / assign / return / set_status / reopen / cancel /
set_priority / set_due / follow_added / workflow_advance`. Payload = IDs,
estados y longitudes — **NUNCA texto libre** (lección I-4 de F4.2: audit_log es
legible por `supervisor`; los textos viven en la tarea/hilo bajo su RLS).

## 12. Notificaciones

Kind `connect_task`, `entity='connect_task'`, `entity_id = task_id`
(hrefFor → `/connect/tareas/{id}`), **SÍNCRONAS en las RPCs** (D2 heredada de
F4.2: cero dependencia del worker/scheduler). Fan-out ACOTADO por evento
(actor siempre excluido; dedupe si un usuario cumple 2 roles — lección M-3):
- creación asignada → asignado; creación vacante de paso de workflow → ver §13.
- claim/reasignación/devolución → asignado nuevo + anterior + creador.
- completada / cancelada / reabierta → creador + asignado + seguidores.
- escalada a `urgente` → asignado + creador.
- SIN notificación por vencimiento (requiere cron — futuro).
- SIN coalescing en MVP (eventos humanos de baja frecuencia; se mide en piloto).

## 13. Workflows entre áreas

**Definición acotada (sin motor genérico):** un workflow es una **plantilla de
secuencia LINEAL de pasos**, donde cada paso instancia una tarea al completarse
el anterior. Ejemplo: "Ingreso de mercadería ANMAT" = 1) Recepción documenta
(depósito) → 2) Verificación compliance → 3) Alta de stock (WMS) → 4) Aviso a
comercial.
- `connect_workflow_templates` (nombre, descripción, activo) +
  `connect_workflow_steps` (orden, título, descripción, área/rol sugerido,
  offset de vencimiento en días, prioridad).
- **Instanciar** un workflow (staff con `connect.create`) crea la instancia y
  la TAREA del paso 1. **Completar** la tarea de un paso crea SÍNCRONAMENTE la
  tarea del paso siguiente (en la misma RPC `connect_task_set_status`) y
  notifica; la última completa la instancia.
- Tareas de paso nacen **vacantes** con `role_target` de notificación al rol
  sugerido del paso (usa `notifications.role_target` existente — el área se
  entera y alguien la reclama) — D-F43-5.
- Plantillas: en MVP se administran **por seed/migración** (sin UI de edición
  de plantillas; la UI de administración de workflows es F4.3+/F4.4) — D-F43-6.
- Explícitamente FUERA: ramas condicionales, paralelismo, SLA automático,
  triggers por eventos externos, motor de reglas (eso es F4.4/automatizaciones).

## 14. Relación con el cockpit

Card **read-only** "Colaboración" en el Cockpit Ejecutivo (patrón
`src/lib/ejecutivo/command-center.ts`): incidentes abiertos por severidad
(F4.2), tareas abiertas/vencidas/por vencer, workflows en curso, con
navegación a los centros. Sin escritura, sin migración propia (consultas/vistas
de lectura), visible con el gate ejecutivo existente.

## 15. Permisos

- Ver/crear/comentar: `connect.view` / `connect.create` (existentes).
- **`connect.task_admin`** (nuevo): reasignar tareas ajenas, cancelar/cerrar
  cross, gestionar seguidores de terceros, instanciar cualquier plantilla.
  Grants iniciales: `admin`, `director_ops` (espejo D3 de F4.2).
- ⚠️ Gotcha estructural VERIFICADO en F4.2: `permissions` tiene
  `UNIQUE (module, action)` → el permiso requiere un valor NUEVO de
  `permission_action_t` (`'task_admin'`), agregado en migración/tx separada del
  seed (regla enum; patrón exacto de 0164/0165). PROHIBIDO
  `on conflict do nothing` sin target en el seed (precedente 0070).

## 16. RLS / RBAC

- RLS habilitada en TODA tabla nueva. `connect_tasks` SELECT =
  `connect.view` AND (creador OR asignado OR seguidor OR miembro del hilo OR
  `is_admin()` OR `connect.task_admin`) — **privado-por-involucrados por
  default** (D-F43-4 si Dirección quiere tableros por área con lectura amplia).
- Escrituras: deny-all para sesión (sin policies de INSERT/UPDATE/DELETE +
  revoke) — TODO por RPC SECDEF con `search_path` fijo, guards NULL-safe con
  `coalesce(has_permission(...), false)` (lección I-2), `FOR UPDATE` en
  transiciones, y pragma `#variable_conflict use_column` en toda función con
  OUT params que toque `ON CONFLICT` (lección 42702 de la ventana F4.2).
- `RBAC_ENFORCE` NO se toca. Espejo de UX en front = fail-closed vía RPC
  `has_permission` (patrón `hasIncidentAdmin`), nunca `canAccess` fail-open.

## 17. Alcance incluido (F4.3)

Tareas (modelo + ciclo + claim + seguidores + prioridad + due informativo +
hilo lazy + notificaciones síncronas + audit + vínculo con incidentes/ERP) ·
Workflows lineales por plantilla (seed) con avance síncrono · Centro de Tareas
(`/connect/tareas`: lista/alta/detalle) · Card cockpit read-only ·
`connect.task_admin` · adapter Knowledge PREPARADO y APAGADO (espejo D5).

## 18. Alcance excluido (explícito)

WhatsApp · Email · IA · CCTV · automatizaciones externas · portal/usuarios
externos · calendario externo · recordatorios/escalamiento por vencimiento y
cualquier cosa dependiente del scheduler (dependencia futura registrada; deuda
OPS F4.1 intacta) · sub-tareas/jerarquías · dependencias arbitrarias entre
tareas (solo la secuencia del workflow) · UI de edición de plantillas ·
workflows condicionales/paralelos/SLA · tableros kanban drag&drop (MVP = lista
filtrable; kanban evaluable post-piloto) · métricas/reportes de productividad.

## 19. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Scope creep hacia gestor de proyectos | §2/§18 vinculantes; NO GO ante scope nuevo |
| R2 | Doble sistema con incidentes (confusión operativa) | §3 en la UI (el alta de incidente ofrece "crear tarea" y viceversa NO — una sola dirección incidente→tarea); piloto con guía de 1 página |
| R3 | Fatiga de notificaciones (tareas ≫ incidentes en volumen) | fan-out acotado + prioridades + snooze/delegar F4.1; medir en piloto; coalescing como palanca |
| R4 | Workflows con paso a área sin nadie que reclame | notificación `role_target` + tablero de vacantes + visibilidad del creador de la instancia; escalamiento automático = futuro |
| R5 | Visibilidad privado-por-involucrados frustra supervisión de área | D-F43-4: task_admin ve todo; ampliar por decisión, no por default |
| R6 | Hilo lazy: comentarios "perdidos" si UI falla al crear hilo | RPC atómica ensure-thread + tests |

## 20. Criterios GO / NO GO

**GO a Master Plan → implementación local** (todos): (1) este ADR aprobado por
Dirección; (2) decisiones D-F43-1..7 ratificadas (ver Master Plan §28);
(3) Master Plan F4.3 aprobado; (4) numeración re-verificada (`0167`+ libre).
**NO GO / STOP:** cualquier ítem que exija tocar prod sin ventana autorizada ·
scope fuera de §17 · contradicción con el Dossier/spec sin ADR nuevo ·
dependencia del scheduler para funcionalidad core.

---
*Decisiones numeradas D-F43-1..7 consolidadas en el Master Plan §28 para la
ratificación de Dirección.*
