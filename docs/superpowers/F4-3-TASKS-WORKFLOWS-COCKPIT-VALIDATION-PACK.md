# F4.3 · Tareas + Workflows + Cockpit — Validation Pack

> Kit de la futura ventana apply+deploy de F4.3 (migs `0167`–`0170` + UI).
> SQL read-only / 0-footprint (sentinel `__QA_ROLLBACK__`). Lo corre quien
> ejecute la ventana; complementa `ROLLBACK_0167_0170.md`.
> ⚠️ Apply: cada archivo como UN batch, EN ORDEN — 0167 (enums) debe ir en tx
> separada de 0168/0169 (usan los valores nuevos).

## 0. Precondiciones

- [ ] `/api/version` = commit vigente esperado (hoy `484a447`) y top = `0166`.
- [ ] `0167`-`0170` libres en `schema_migrations`.
- [ ] Autorización expresa de Dirección para ESTA ventana.
- [ ] Restore point / LSN anotado.

## 1. Checkpoints de catálogo

### C1 — 0167 (enums aislados)
```sql
select 'C1.1 kind task', count(*)::text from pg_enum e join pg_type t on t.oid=e.enumtypid
 where t.typname='connect_conversation_kind_t' and e.enumlabel='task';            -- 1
select 'C1.2 action task_admin', count(*)::text from pg_enum e join pg_type t on t.oid=e.enumtypid
 where t.typname='permission_action_t' and e.enumlabel='task_admin';              -- 1
```

### C2 — 0168 (schema)
```sql
select 'C2.1 tablas', count(*)::text from pg_tables where tablename in
 ('connect_tasks','connect_task_followers','connect_workflow_templates',
  'connect_workflow_steps','connect_workflow_instances');                          -- 5
select 'C2.2 RLS', count(*)::text from pg_class where relname like 'connect_task%' and relrowsecurity; -- >=2
select 'C2.3 policies', count(*)::text from pg_policies where tablename in
 ('connect_tasks','connect_task_followers','connect_workflow_templates',
  'connect_workflow_steps','connect_workflow_instances');                          -- 5 (solo SELECT)
select 'C2.4 policy vacantes', count(*)::text from pg_policies
 where tablename='connect_tasks' and qual like '%asignado_a is null%';             -- 1 (fix C-1 FE)
select 'C2.5 policy instancias calificada', count(*)::text from pg_policies
 where tablename='connect_workflow_instances' and qual like '%connect_workflow_instances.id%'; -- 1 (fix I-1)
select 'C2.6 permiso', count(*)::text from public.permissions where slug='connect.task_admin' and action::text='task_admin'; -- 1 (⚠️ 0 = choque tapado)
select 'C2.7 grants', count(*)::text from public.role_permissions rp
 join public.permissions p on p.id=rp.permission_id join public.roles r on r.id=rp.role_id
 where p.slug='connect.task_admin' and r.slug in ('admin','director_ops');         -- 2
select 'C2.8 sin write grants', count(*)::text from information_schema.role_table_grants
 where table_name like 'connect_task%' and grantee in ('anon','authenticated')
   and privilege_type in ('INSERT','UPDATE','DELETE');                             -- 0
select 'C2.9 realtime', count(*)::text from pg_publication_tables
 where pubname='supabase_realtime' and tablename='connect_tasks';                  -- 1
select 'C2.10 uidx instancia/paso', count(*)::text from pg_indexes
 where indexname='connect_tasks_instance_step_uidx';                               -- 1
```

### C3 — 0169 (RPCs + seeds + policy notifications)
```sql
select 'C3.1 RPCs', count(*)::text from pg_proc where proname in
 ('connect_task_create','connect_task_assign','connect_task_set_status',
  'connect_task_set_priority','connect_task_set_due','connect_task_follow',
  'connect_task_ensure_thread','connect_workflow_instantiate');                    -- 8
select 'C3.2 helpers', count(*)::text from pg_proc where proname in
 ('_connect_task_is_admin','_connect_task_prio','_connect_task_notify',
  '_connect_task_notify_involved','_connect_task_assert_internal',
  '_connect_task_is_follower','_connect_task_is_involved');                        -- 7
select 'C3.3 search_path', count(*)::text from pg_proc p
 where (p.proname like '%connect_task%' or p.proname like '%connect_workflow%')
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c where c like 'search_path=%'); -- 0
select 'C3.4 seeds', count(*)::text from public.connect_workflow_templates;        -- 2
select 'C3.5 pasos', count(*)::text from public.connect_workflow_steps;            -- 6
select 'C3.6 policy notif role', count(*)::text from pg_policies
 where tablename='notifications' and policyname='notifications mark read own'
   and qual like '%role_target%';                                                  -- 1 (fix I-2)
```

### C4 — 0170 (Knowledge, APAGADO)
```sql
select 'C4.1 source apagada', enabled::text from public.knowledge_sources where source_table='connect_tasks'; -- false
select 'C4.2 trigger', count(*)::text from pg_trigger where tgname='tg_project_connect_tasks'; -- 1
select 'C4.3 sin eventos', count(*)::text from public.knowledge_events where source_table='connect_tasks'; -- 0
```

### C5 — Idempotencia
Re-ejecutar `0167`-`0170` una 2ª vez → 0 errores; C1-C4 devuelven lo mismo.

## 2. C6 — Funcional 0-footprint (`__QA_ROLLBACK__`)

Con claims simulados (patrón F4.2: admin legacy + operaciones-con-user_role +
operaciones-sin-permisos), un DO block que cubra y aserte:
1. `connect_task_create` (título, TSK-format, vacante) + con asignado (notif).
2. **⚠️ `connect_task_ensure_thread` en tarea con creador+asignado+seguidor**
   (verifica el fix C-1 del CASE→enum: fue el bloqueante; el hilo debe crearse
   con los miembros correctos) + re-llamada devuelve el mismo id.
3. Claim de vacante por staff (OK) · claim de asignada por tercero (DENEGADO) ·
   devolución (asignado_a null + notif al creador sin duplicado si creador=asignado).
4. Máquina: start (solo asignado/admin) · complete (asignado/creador/admin) ·
   cancel sin motivo (DENEGADO) · cancel con motivo (motivo_len en audit, texto
   solo en tabla) · reopen auditado · cancelada terminal.
5. Workflow: `connect_workflow_instantiate` (instancia + paso 1 vacante + notif
   role_target) → claim → complete paso 1 → paso 2 creado + current_step=2 →
   complete pasos 2 y 3 → instancia `completado`. Segunda instancia: cancelar el
   paso activo → instancia `cancelado` (fix I-1).
6. RLS: usuario sin involucrar NO ve tarea asignada ajena; SÍ ve la vacante
   (fix C-1); ve la instancia si es asignado de un paso (fix I-1); escritura
   directa DENEGADA.
7. role_target: como usuario `operaciones`, `update notifications set read_at=now()`
   sobre el broadcast del workflow → 1 fila (fix I-2).
8. Sin permisos: create/assign/set_status DENEGADOS (fail-closed).
9. Regresiones: `connect_post_message` e `connect_incident_open` operativos;
   0 overloads; outbox pending sin cambios atribuibles.
Cierre: `raise exception '__QA_ROLLBACK__'` → footprint 0 en tasks/instances/
notifications/audit… verificar counts en 0.

## 3. C7 — Smoke UI (post-deploy, piloto)

- [ ] `/connect/tareas` lista + vistas (mías/creadas/vacantes) + filtros; sidebar "Tareas".
- [ ] Crear tarea (< 1 min) → detalle `TSK-…` → reclamar/iniciar/completar/reabrir/cancelar-con-motivo.
- [ ] "Iniciar conversación" crea el hilo (comentario + mención + foto) — NO disponible en terminales.
- [ ] Workflow: iniciar desde el panel → notificación al rol → click navega al detalle → completar 3 pasos → instancia completa. Cancelar un paso detiene la cadena (aviso previo en UI).
- [ ] Incidente → "Crear tarea" prefillea el vínculo; el detalle del incidente lista sus tareas.
- [ ] Card Colaboración en el Cockpit con contadores coherentes; no bloquea la carga.
- [ ] Notificación role_target se puede marcar leída por un usuario del rol.
- [ ] Usuario sin permisos: sin acciones indebidas. 0 errores consola · 0 5xx · sin dependencia del scheduler.

## 4. GO / NO-GO

**GO** = C1–C7 PASS. **NO-GO / rollback** (`ROLLBACK_0167_0170.md`) ante fallo
de catálogo persistente, transición/permiso mal validado, regresión F4.1/F4.2
o 5xx del deploy. DB aplicada + front anterior degrada con gracia (la card se
auto-oculta; el front viejo no consulta `connect_tasks`).
