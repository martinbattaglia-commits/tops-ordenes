# F4.3 · Nexus Link — Tareas + Workflows + Cockpit colaborativo · Master Plan

> **Estado: PROPUESTA — pendiente de aprobación de Dirección (junto con
> `ADR-F4-3-TASKS-WORKFLOWS.md`, precondición dura).**
> Fecha: 2026-07-02. **Solo planificación: cero código, cero migraciones
> creadas/aplicadas, cero cambios en producción/DB/RBAC/env, cero
> deploy/push/merge/commit.**
> Fuentes: ADR-F4-3 (diseño conceptual), Master Plan F4 (§3.7-9, §10),
> F4.1/F4.2 (patrones y lecciones), spec Connect (motor de conversaciones),
> verificación read-only en vivo (§5).

## 1. Resumen ejecutivo

F4.2 dejó el Centro de Incidentes vivo (ya hay 1 incidente real cargado por
Dirección). F4.3 completa el trío colaborativo con **Tareas** (la unidad de "hay
que hacer X", diseñada en el ADR-F4-3 porque NO existía en el spec),
**Workflows lineales entre áreas** (plantillas que encadenan tareas
Recepción→Compliance→WMS→Comercial) y el **Cockpit colaborativo** (card
read-only con el pulso de incidentes+tareas). Todo reusa la fundación
existente: hilos, menciones, notificaciones síncronas, RBAC, audit, y las
lecciones de F4.2 (UNIQUE(module,action), NULL-safety, claim-de-vacantes,
pragma ON CONFLICT, audit sin texto libre). Migraciones estimadas
**`0167`–`0170`** (verificadas libres), ~15–20 días-dev.

## 2. Objetivo

Que un pedido de trabajo entre personas o áreas de TOPS se cree, asigne (o
reclame), siga, discuta y complete DENTRO de Nexus con trazabilidad completa —
reemplazando WhatsApp/planillas — y que las secuencias repetitivas entre áreas
corran como workflows encadenados sin coordinación manual.

## 3. Alcance incluido

| # | Ítem | Detalle |
|---|---|---|
| 1 | Modelo de tareas (ADR §1-§12) | `connect_tasks` + followers, TSK-AAAA-NNNN, estados, claim, prioridad, due informativo, hilo lazy `kind='task'` |
| 2 | Vínculos | tarea↔incidente (columna directa `incident_id`) y tarea↔entidad ERP (vía links del hilo, patrón existente) |
| 3 | Workflows lineales (ADR §13) | templates+steps por seed; instanciar; avance síncrono al completar; notificación `role_target` al área |
| 4 | Centro de Tareas | `/connect/tareas` (lista con filtros: mías/creadas/seguidas/vacantes/estado/prioridad/vencimiento), `/nueva`, `/[taskId]` (detalle+acciones+hilo lazy) |
| 5 | Notificaciones | kind `connect_task` síncronas + navegación al detalle + item sidebar |
| 6 | Cockpit colaborativo | card read-only incidentes+tareas+workflows (patrón command-center) |
| 7 | RBAC | permiso `connect.task_admin` (enum action nuevo, patrón F4.2) |
| 8 | Knowledge | adapter `connect_tasks` (created/completed) PREPARADO y APAGADO (espejo D5) |
| 9 | Incidente→Tarea | botón "Crear tarea" en el detalle del incidente (pre-carga vínculo) |

## 4. Alcance excluido

El del ADR §18 íntegro (WhatsApp/Email/IA/CCTV/automatizaciones/externos/
recordatorios-por-cron/sub-tareas/kanban/UI-de-plantillas/condicionales/SLA) +
sin cambios a incidentes F4.2 salvo el botón del ítem 9 + `RBAC_ENFORCE`
intacto + scheduler OPS F4.1 intacto (solo registrado como dependencia futura
de recordatorios).

## 5. Estado actual verificado (read-only, 2026-07-02 ~02:37Z)

| Ítem | Valor |
|---|---|
| `/api/version` | **`484a447`** production (deploy `6a45c96d220b1ec727fecf03`) |
| Última migración | **`0166_connect_incidents_knowledge`** (`20260702020617`) |
| Próxima libre | **`0167`** (0167-0170 sin colisiones en `schema_migrations`, worktrees ni historial; `connect_tasks` no existe) |
| F4.2 | CERRADA (smoke autenticado PASS 100%); 1 incidente real en prod |
| Diseño previo de tareas | **NO existe** (spec §1.4 sin tareas; "task" del spec = visión KIL Parte III, no relacionada) → ADR-F4-3 creado |
| Worktree | `tops-ordenes-f42-incidents` @ `add4dac`, tree limpio; nada modificado en esta sesión |

## 6. Dependencias con F4.1 / F4.2 (todas EN PROD)

Motor de hilos/menciones/adjuntos (F3/F4.1) · notificaciones extendidas +
acciones snooze/delegar/prioridad (0147/0162) · fan-out síncrono (patrón 0161)
· `connect_search_profiles` (0158) para elegir asignados · `has_permission` +
catálogo RBAC (0009/0146/0155/0165) · `audit_log` · patrón public_id ·
incidentes (0164-0166) para el vínculo y la card · `profiles_public` (0046)
para nombres · procedimiento de deploy validado (Node 22.23.1, NO-worktree,
draft-first) · **scheduler F4.1 = NO dependencia** (nada core lo usa; solo
recordatorios futuros).

## 7. Modelo conceptual de tareas

El del ADR §1-§12 (aprobación conjunta). Síntesis: unidad de trabajo con
responsable único, `pendiente→en_progreso→completada|cancelada` + reapertura
auditada, claim de vacantes, seguidores, prioridad, `due_at` informativo, hilo
lazy, origen persona/incidente/workflow.

## 8. Workflows entre áreas

ADR §13: plantillas lineales (seed) → instancia → tarea por paso → avance
síncrono al completar → notificación al rol del paso siguiente → instancia
completa al último paso. Cancelar instancia (task_admin) cancela la tarea
activa y detiene la cadena (auditado). 1-2 plantillas semilla reales definidas
CON Dirección en E1 (candidata: ingreso de mercadería con verificación
compliance).

## 9. Cockpit colaborativo

Card "Colaboración" en Cockpit Ejecutivo: incidentes abiertos (por severidad),
tareas abiertas/vencidas (derivado read-only), instancias de workflow en curso;
links a los centros. Datos por funciones de lectura (`src/lib/ejecutivo/`),
gate ejecutivo existente, cero migración adicional (a lo sumo una vista
`security_invoker` en 0168 si simplifica).

## 10. Modelo de datos propuesto (detalle a congelar en E1)

- **`connect_tasks`**: id uuid PK · public_id text unique (TSK-AAAA-NNNN,
  sequence+trigger con fix lpad/greatest) · titulo text NOT NULL ·
  descripcion text · estado `connect_task_status_t` · prioridad
  `connect_task_priority_t` · due_at timestamptz · creado_por / asignado_a
  (FK auth.users, set null) · conversation_id uuid NULL UNIQUE (hilo lazy, FK
  restrict) · incident_id uuid NULL (FK `connect_incidents` set null) ·
  workflow_instance_id uuid NULL + step_no int NULL · area text NULL ·
  completed_at · cancel_reason (breve) · created_at/updated_at.
  Índices: (estado, prioridad) · (asignado_a) where no-terminal · (creado_por)
  · (due_at) where no-terminal · (incident_id) · (workflow_instance_id) ·
  created_at desc.
- **`connect_task_followers`**: task_id + profile_id (PK compuesta), added_by,
  created_at.
- **`connect_workflow_templates`**: id, nombre unique, descripcion, activo bool.
- **`connect_workflow_steps`**: template_id, step_no, titulo, descripcion,
  rol_sugerido (user_role_t o slug), due_offset_days int, prioridad;
  unique(template_id, step_no).
- **`connect_workflow_instances`**: id, template_id, iniciado_por, estado
  (`en_curso|completado|cancelado`), current_step, created_at/completed_at.
- Enums nuevos: `connect_task_status_t`, `connect_task_priority_t` (tablas
  propias, creación normal) + **valores agregados a enums EXISTENTES** (ver
  §11, migración aislada): `'task'` en `connect_conversation_kind_t` y
  `'task_admin'` en `permission_action_t`.
- RLS según ADR §16; escritura deny-all + revoke; realtime para
  `connect_tasks` (lista viva).

## 11. Migraciones previstas (desde `0167` — re-verificar al autorar)

| Mig | Contenido | Nota crítica |
|---|---|---|
| `0167_connect_tasks_enum_values` | SOLO `alter type … add value`: `'task'` (conversation kind) + `'task_admin'` (permission action) | AISLADA: regla enum-nuevo-no-se-usa-en-la-misma-tx (patrón 0021/0029 + lección C-1 F4.2) |
| `0168_connect_tasks_schema` | Enums propios + 5 tablas + índices + RLS + realtime + triggers public_id/touch | usa `'task'`/`'task_admin'` recién acá (tx separada) — seed del permiso INCLUIDO acá con `on conflict (slug)` explícito |
| `0169_connect_tasks_rpcs` | RPCs (§12) + helpers NULL-safe + seed de 1-2 plantillas de workflow | `#variable_conflict use_column` en toda fn con OUT params |
| `0170_connect_tasks_knowledge` | Adapter created/completed APAGADO + backfill | espejo exacto de 0166 (D5) |

Entregadas-NO-aplicadas (G3) + `ROLLBACK_0167_0170.md` (nota: los valores de
enum agregados son irreversibles — residuo aceptado, como F4.2).

## 12. RPCs previstas (SECDEF · P-1 con coalesce · FOR UPDATE · audit · notifs síncronas)

`connect_task_create(titulo, descripcion, prioridad, due_at, asignado, incident_id, …)`
→ table(id, public_id) · `connect_task_assign(p_id, p_to)` (claim de vacante /
reasignación creador·task_admin / `p_to=null` = devolución del asignado) ·
`connect_task_set_status(p_id, estado)` (start/complete/cancel/reopen; al
completar paso de workflow: crea tarea del paso siguiente síncrono) ·
`connect_task_set_priority` · `connect_task_set_due` ·
`connect_task_follow(p_id, p_user, p_on)` ·
`connect_task_ensure_thread(p_id)` → conversation_id (lazy, atómica, agrega
miembros) · `connect_workflow_instantiate(template_id)` → instance+tarea paso 1.
Helper compartido `_connect_task_notify` (espejo `_connect_incident_notify`) y
`_connect_task_is_admin()` (coalesce).

## 13. Cambios frontend previstos

Capa hexagonal espejo de incidentes: `domain/task.ts` (máquina espejo UX +
availableActions + validaciones, TDD) · `ports/task-port` · adapter RPC ·
use-cases · server actions (zod alineado a límites del RPC — lección M-3) ·
`read/tasks-data.ts` (orden de negocio EN SQL pre-límite — lección I-4;
nombres vía `profiles_public`; `hasTaskAdmin()` fail-closed) · seeds demo ·
componentes (lista, form, detalle con acciones + hilo lazy + botón seguir,
chips de prioridad/estado) · card cockpit · botón "Crear tarea" en detalle de
incidente · item sidebar "Tareas" · caso `connect_task` en `hrefFor` · tests.

## 14. Rutas previstas

`/connect/tareas` (lista+filtros) · `/connect/tareas/nueva` ·
`/connect/tareas/[taskId]` (detalle) · (cockpit ya existe: solo card nueva).

## 15. Notificaciones — ADR §12 (síncronas, acotadas, sin cron).
## 16. Auditoría — ADR §11 (append-only, sin texto libre).
## 17. Permisos y roles — ADR §15 (`connect.task_admin` a admin/director_ops; resto reusa connect.*).
## 18. RLS/RBAC — ADR §16 (privado-por-involucrados + task_admin/admin; escritura solo RPC; RBAC_ENFORCE intacto).

## 19. Relación con incidentes

Unidireccional incidente→tarea: desde el detalle del incidente se crean tareas
vinculadas (`incident_id`); el detalle del incidente lista sus tareas; la
resolución del incidente NO exige tareas completas en MVP (decisión D-F43-7).
Las tareas NO generan incidentes.

## 20. Relación con futuras automatizaciones (F4.4)

Los workflows lineales son el sustrato: F4.4 podrá agregar reglas sobre el
outbox ("incidente crítico → instanciar workflow X") SIN rediseñar tareas. El
enqueue estándar del outbox ya registra los eventos de mensajes; los eventos de
tarea quedan en audit_log + (si se enciende) Knowledge. Nada de F4.3 depende de
F4.4 ni del scheduler.

## 21. Riesgos — ADR §19 (R1-R6) + RT-1: volumen de tareas ≫ incidentes puede
estresar la bandeja de notificaciones (mitigación: fan-out acotado + medición
piloto + coalescing como palanca preparada) + RO-1: adopción (piloto por área
con 1 workflow real que duela hoy).

## 22. Seguridad / PII

Payloads de notificación/audit/Knowledge sin texto libre ni PII (títulos =
dato operativo, criterio 0161) · descripciones/comentarios solo bajo RLS de
involucrados/hilo · nombres vía `profiles_public` (sin email) · guards
NULL-safe con coalesce (lección I-2) · claim-only-vacante (lección I-1) ·
pragma `use_column` (lección 42702) · seed de permiso con conflict target
explícito (lecciones C-1/0070) · sin superficie externa; validación de
asignables = criterio 0162.

## 23. Plan de TDD

Dominio puro primero (vitest): máquina de estados de tarea (matriz completa
por rol: creador/asignado/seguidor/task_admin/tercero, incl. claim solo
vacante, devolución, reapertura, cancelada terminal) · validaciones de alta ·
avance de workflow (paso N completo → spec del paso N+1; último paso →
instancia completa) · use-cases con fake port (validación temprana sin llegar
al puerto). Meta: no bajar la base (437) y sumar ~30-40 tests.

## 24. Plan de QA

typecheck 0 · lint 0 nuevos · vitest completo · build OK · preview demo
(seeds mock) verificando lista/alta/detalle/acciones por rol · revisión
adversarial (§27) antes de declarar el paquete.

## 25. Smoke plan (ventana futura)

Validation Pack F4.3 espejo del de F4.2: checkpoints de catálogo por migración
· funcional 0-footprint (`__QA_ROLLBACK__`) con 3 usuarios simulados cubriendo
ciclo completo + workflow de 2 pasos + anti-robo + fail-closed · regresiones
F4.1/F4.2 (incidentes intactos, post_message, 0 overloads) · smoke UI 20
puntos para Dirección (crear/claim/completar/reabrir/workflow/notif→detalle).

## 26. Rollback

`ROLLBACK_0167_0170.md`: drop de tablas/funciones/policies nuevas + delete de
catálogo (`connect.task_admin`, plantillas seed) en orden inverso; residuos
aceptados documentados: valores de enum (`'task'`, `'task_admin'`) no
dropeables, filas de audit/notifications, conversaciones `kind='task'`
huérfanas. Front se revierte re-deployando el commit anterior; DB y front
degradan con gracia por separado (patrón F4.2 verificado).

## 27. Revisión adversarial esperada

2 revisores independientes (SQL/seguridad y frontend) con los focos de F4.2 +
específicos: escalamiento vía claim/devolución/seguidores, fuga de títulos por
`role_target`, integridad del avance de workflow bajo concurrencia (doble
complete del mismo paso → FOR UPDATE + unique(instance, step)), hilo lazy
(carreras ensure-thread), y verificación contra los 4 gotchas conocidos
(UNIQUE module/action, ON CONFLICT pragma, has_permission NULL, on-conflict
silencioso). Criterio: 0 bloqueantes / 0 altos abiertos antes de pedir ventana.

## 28. Decisiones que Dirección debe aprobar ANTES de implementar

| D | Decisión | Default recomendado |
|---|---|---|
| D-F43-1 | Aprobar el ADR-F4-3 completo (definición de tarea, §1-§16) | Sí |
| D-F43-2 | ¿Estado `en_espera` en tareas? | NO en MVP (hilo + due lo cubren) |
| D-F43-3 | ¿El creador reasigna sus tareas (además de task_admin)? | SÍ (es su pedido) |
| D-F43-4 | Visibilidad: ¿privado-por-involucrados o lectura por área? | Privado-por-involucrados (ampliar post-piloto) |
| D-F43-5 | Tareas de paso de workflow: ¿vacantes con aviso al rol, o asignación fija por plantilla? | Vacantes + `role_target` (claim del área) |
| D-F43-6 | Plantillas de workflow por seed/migración (sin UI de edición en F4.3) | Sí; definir 1-2 plantillas reales con Dirección en E1 |
| D-F43-7 | ¿Resolver un incidente exige sus tareas completas? | NO en MVP (aviso visual, no bloqueo) |
| D-F43-8 | Numeración `0167`-`0170` (4 migs; enum aislada primero) | Sí |
| D-F43-9 | Adapter Knowledge de tareas apagado hasta piloto | Sí (espejo D5) |

## 29. Criterio GO / NO GO para implementación local

**GO (todos):** ADR aprobado · D-F43-1..9 ratificadas · este plan aprobado ·
`0167` re-verificada libre · worktree/rama nueva desde la punta real
(`484a447`/`add4dac`).
**NO GO / STOP:** scope fuera de §3 · cualquier toque a prod fuera de ventana
autorizada por ítem · dependencia core del scheduler · contradicción con
Dossier/spec sin ADR · hallazgo adversarial bloqueante sin resolver.
Etapas de ejecución (post-GO): espejo de F4.2 — E0 setup → E1 diseño detallado
congelado (incl. plantillas seed con Dirección) → E2 migs+rollback → E3 lib+TDD
→ E4 UI → E5 kits → E6 adversarial → E7 ventana (autorización aparte) → E8 cierre.
Estimación: **~15-20 días-dev** (tareas 8-10 + workflows 4-6 + cockpit 1-2 +
QA/adversarial 2).

## Confirmación de no-implementación

En esta sesión NO se implementó nada: cero código, cero migraciones, cero
cambios DB/RBAC/env, cero deploy/push/merge/commit. Consultas a prod = solo
SELECT read-only de verificación. Artefactos producidos: este plan +
`ADR-F4-3-TASKS-WORKFLOWS.md`, en el working tree del worktree
`tops-ordenes-f42-incidents`, **sin commitear** (G1).

---

**Próximo paso:** decisión de Dirección sobre el ADR + D-F43-1..9 + GO §29.
Hasta entonces, STOP.
