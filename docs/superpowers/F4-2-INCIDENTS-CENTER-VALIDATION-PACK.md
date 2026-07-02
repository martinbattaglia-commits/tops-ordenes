# F4.2 · Centro de Incidentes — Validation Pack

> **🏁 EJECUTADO Y CERRADO (2026-07-02):** ventana única completada — C1-C7 PASS
> (1 fix in-window declarado, ver Execution Log §0), DRAFT+PROD PASS, smoke
> funcional autenticado **PASS 100% por Dirección**. Prod = `484a447`. Rollback
> no requerido. Este pack queda como guion de referencia/re-validación.

> Kit de validación de la ventana apply+deploy de F4.2 (migs `0164`–`0166` + UI).
> TODO el SQL de este pack es **read-only o 0-footprint** (fixtures transaccionales con
> sentinel `__qa_rollback__`, patrón de los 18 kits del repo). Lo corre Martín; el
> asistente nunca ejecuta escrituras en prod. Complementa: `ROLLBACK_0164_0166.md`.

## 0. Precondiciones de la ventana

- [ ] `/api/version` = commit vigente esperado (hoy `bef2f78`) y `schema_migrations` top = `0163`.
- [ ] `0164` sigue libre: `select count(*) from supabase_migrations.schema_migrations where name like '0164%';` → 0.
- [ ] Autorización expresa de Dirección para ESTA ventana (apply 0164→0165→0166, en orden, cada archivo como un solo batch).
- [ ] Restore point / LSN anotado (patrón F3.2B) antes del primer apply.

## 1. Checkpoints de catálogo (read-only, tras aplicar cada migración)

### C1 — 0164 (schema)
```sql
select 'C1.1 tabla',            (to_regclass('public.connect_incidents') is not null)::text;
select 'C1.2 RLS on',           relrowsecurity::text from pg_class where relname='connect_incidents';
select 'C1.3 policies',         count(*)::text from pg_policies where tablename='connect_incidents';        -- esperado: 1 (solo SELECT)
select 'C1.4 enums',            count(*)::text from pg_type where typname in ('connect_incident_status_t','connect_incident_severity_t'); -- 2
select 'C1.5 uidx 1:1',         count(*)::text from pg_indexes where indexname='connect_incidents_conversation_uidx'; -- 1
select 'C1.6 enum accion',      count(*)::text from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='permission_action_t' and e.enumlabel='incident_admin'; -- 1 (fix C-1: el seed del permiso vive en 0165)
select 'C1.8 realtime',         count(*)::text from pg_publication_tables where pubname='supabase_realtime' and tablename='connect_incidents'; -- 1
-- Escritura de sesión bloqueada (RLS sin policy + revoke):
select 'C1.9 sin grant write',  count(*)::text from information_schema.role_table_grants
 where table_name='connect_incidents' and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE'); -- 0
```

### C2 — 0165 (RPCs)
```sql
select 'C2.1 RPCs', count(*)::text from pg_proc where proname in
 ('connect_incident_open','connect_incident_assign','connect_incident_set_status',
  'connect_incident_set_severity','connect_incident_resolve'); -- 5
select 'C2.2 helpers', count(*)::text from pg_proc where proname in
 ('_connect_incident_notify','_connect_incident_priority','_connect_incident_is_admin'); -- 3
select 'C2.4 permiso', count(*)::text from public.permissions where slug='connect.incident_admin' and action::text='incident_admin'; -- 1 (⚠️ debe ser 1: si es 0, el on conflict tapó un choque — ver C-1)
select 'C2.5 grants',  count(*)::text from public.role_permissions rp join public.permissions p on p.id=rp.permission_id join public.roles r on r.id=rp.role_id where p.slug='connect.incident_admin' and r.slug in ('admin','director_ops'); -- 2
-- search_path fijo en todas las funciones nuevas:
select 'C2.3 search_path', count(*)::text from pg_proc p
 where p.proname like '%connect_incident%'
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%'); -- 0
```

### C3 — 0166 (Knowledge, APAGADO)
```sql
select 'C3.1 source seed', enabled::text from public.knowledge_sources where source_table='connect_incidents'; -- false (D5)
select 'C3.2 trigger',     count(*)::text from pg_trigger where tgname='tg_project_connect_incidents'; -- 1
select 'C3.3 sin eventos', count(*)::text from public.knowledge_events where source_table='connect_incidents'; -- 0
```

### C4 — Idempotencia
Re-ejecutar `0164`, `0165` y `0166` completas una 2ª vez → **0 errores**, y C1–C3 devuelven
los mismos valores (no se duplican policies/grants/seeds/triggers).

## 2. Checkpoint funcional 0-footprint (C5 — máquina de estados y guards)

Correr COMO USUARIO REAL AUTENTICADO (no service_role) con `connect.create`.
Todo dentro de un `do $$ … raise exception '__qa_rollback__' $$;` → nada persiste.

```sql
do $$
declare
  v record;
  v_msgs int;
begin
  -- alta
  select * into v from public.connect_incident_open(
    'QA F4.2 — incidente de prueba', 'critica', 'QA', 'sector QA', 'prueba', 'descripción de prueba');
  if v.public_id !~ '^INC-\d{4}-\d{4}$' then raise exception 'FALLO public_id: %', v.public_id; end if;

  -- el hilo existe y tiene el primer mensaje
  select count(*) into v_msgs from public.connect_messages where conversation_id = v.conversation_id;
  if v_msgs <> 1 then raise exception 'FALLO primer mensaje: %', v_msgs; end if;

  -- resolver exige detalle: set_status a resuelto debe FALLAR
  begin
    perform public.connect_incident_set_status(v.id, 'resuelto');
    raise exception 'FALLO: set_status permitió resuelto';
  exception when check_violation then null; end;

  -- transición inválida abierto→en_espera debe FALLAR
  begin
    perform public.connect_incident_set_status(v.id, 'en_espera');
    raise exception 'FALLO: transición abierto→en_espera permitida';
  exception when check_violation or insufficient_privilege then null; end;

  -- auto-asignación + inicio + resolución + cierre (happy path del actor)
  perform public.connect_incident_assign(v.id, auth.uid());
  perform public.connect_incident_set_status(v.id, 'en_progreso');
  perform public.connect_incident_resolve(v.id, 'QA: resuelto de prueba');
  -- reapertura auditada
  perform public.connect_incident_set_status(v.id, 'en_progreso');
  -- re-resolver y cerrar
  perform public.connect_incident_resolve(v.id, 'QA: re-resuelto');
  perform public.connect_incident_set_status(v.id, 'cerrado');
  -- terminal: nada más permitido
  begin
    perform public.connect_incident_set_status(v.id, 'en_progreso');
    raise exception 'FALLO: cerrado no es terminal';
  exception when check_violation then null; end;

  -- auditoría: 1 open + 1 assign + 1 set_status + 2 resolve + 1 reopen + 1 close(set_status)
  if (select count(*) from public.audit_log where entity='connect_incident' and entity_id=v.id) < 6 then
    raise exception 'FALLO: auditoría incompleta';
  end if;

  raise exception '__qa_rollback__';  -- 0 footprint
end $$;
-- Esperado: ERROR __qa_rollback__ (todo lo demás pasó). Cualquier otro error = FALLO.
```

## 3. Checkpoint anti-forja (C6 — usuario SIN permisos, read-only + 0-footprint)

Como usuario autenticado SIN `connect.incident_admin` y NO miembro del hilo de un
incidente ajeno `:INC_ID`:

```sql
select 'C6.1 RLS oculta', count(*)::text from public.connect_incidents where id = :'INC_ID'; -- 0
-- Escrituras directas: deben fallar por falta de privilegio/policy
-- insert into public.connect_incidents (conversation_id, titulo) values (gen_random_uuid(),'x'); -- ERROR esperado
-- update public.connect_incidents set estado='cerrado' where id=:'INC_ID';                       -- 0 filas / ERROR esperado
-- Asignar a un tercero sin incident_admin: ERROR insufficient_privilege esperado
-- select public.connect_incident_assign(:'INC_ID', '<otro-uuid>');
-- Robo de asignación (fix I-1): auto-asignarse un incidente YA asignado sin
-- incident_admin: ERROR insufficient_privilege esperado
-- select public.connect_incident_assign(:'INC_ID', auth.uid());
```

Además, con un usuario que SÍ tiene `connect.incident_admin` pero `profiles.role <> 'admin'`
y NO es miembro del hilo (fix I-3/C-1):
```sql
select 'C6.2 incident_admin ve', count(*)::text from public.connect_incidents; -- > 0 (la policy incluye el permiso)
```

## 4. Notificaciones síncronas (C7 — verificación en vivo con el piloto)

Con dos usuarios reales (A reporta, B = incident_admin):
- [ ] A reporta un incidente severidad crítica → B recibe notificación `connect_incident`
      priority `urgent` INMEDIATA (sin worker; verificar `created_at` ≈ ahora).
- [ ] B asigna a A → A recibe "asignado". Click en la notificación → navega a
      `/connect/incidentes/{id}` (hrefFor entity=`connect_incident`).
- [ ] B resuelve → A recibe "resuelto"; A reabre → B (asignado) recibe "reabierto".
- [ ] Payload de las notificaciones: sin email/PII, sin contenido del hilo.
- [ ] `connect_worker_runs`/outbox: SIN cambios atribuibles a incidentes (D2: nada
      encolado como dependencia crítica; el scheduler OPS F4.1 queda intacto).

## 5. Smoke UI (post-deploy, piloto)

- [ ] `/connect/incidentes` lista con filtros; orden crítica-primero; 0 errores consola.
- [ ] Reportar (< 1 min) → detalle con `INC-…` visible → hilo activo (comentario + foto).
- [ ] Acciones visibles coherentes con el rol (tercero: solo Asignarme; admin: todas).
- [ ] Incidente cerrado → hilo read-only, sin acciones.
- [ ] Sidebar "Incidentes" visible solo con `connect.view` (gate dominio connect).
- [ ] `/api/version` = commit del deploy F4.2; 0 5xx en smoke de rutas.

## 6. GO / NO-GO de cierre de ventana

**GO** = C1–C7 PASS + smoke UI PASS + 0 errores nuevos en logs.
**NO-GO / rollback** (`ROLLBACK_0164_0166.md`) si: cualquier checkpoint de catálogo FALLA
tras re-intento, el checkpoint funcional muestra transición/permiso mal validado, o el
deploy introduce 5xx. La DB puede quedar aplicada con el front anterior (degrada con
gracia) mientras se decide — el front viejo no consulta `connect_incidents`.
