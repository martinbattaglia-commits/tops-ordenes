# Nexus Link RC1.0 — Fundación DB + RBAC + Integración Knowledge (Paquete de diseño G7)

> **Estado:** DISEÑO PREVIO A APROBACIÓN (G7). Nada de código de aplicación, nada aplicado a prod (G1/G3).
> **Base canónica:** `release/nexus-base` (`55b7530` = FIS ⊕ KN). **Proyecto único:** `tops-ordenes-prod` / `arsksytgdnzukbmfgkju` (STOP ante cualquier otro).
> **Fuentes de verdad (sin docs paralelos):** Master Dossier v1.2 + spec Connect aprobado (`docs/superpowers/specs/2026-06-28-nexus-connect-design.md`, arquitectura CERRADA). Este doc **reconcilia y renumera** el spec; no rediseña.
> **Gobernanza:** G1–G11 + skills `architecture-tops-nexus` / `postgres-tops-nexus`.

---

## 1. Alcance de RC1.0 (sub-fase de fundación)

RC1.0 entrega la **capa DB completa de la fundación de Nexus Link** + el seed RBAC + el gating invisible + la **integración con Knowledge** (adapter Connect→`knowledge_emit_event`). **Cero UI, cero server actions** (eso es RC1.1+; espera G7).

| En RC1.0 | Diferido a sub-fase |
|---|---|
| Enums + 9 tablas core `connect_*` + favoritos/fijados/importantes (A1) | Incidentes `connect_incidents` → **RC1.8** |
| 15 RPCs `SECURITY DEFINER` + `_connect_is_member` + trigger outbox | KPIs `connect_kpi_*` + panel admin → **RC1.11** |
| Vistas `security_invoker` (bandeja/canales/no-leídos) | FTS search RPC → **RC1.9** (el índice GIN sí va en RC1.0) |
| Seed RBAC `connect.*` + gating invisible | Notif center A4 (prioridad/snooze/delegar) → RC1.4 (columnas aditivas ya en RC1.0) |
| Buckets storage + RLS | Cockpit card → RC1.11 |
| **Adapter Connect→Knowledge** (conversación↔entidad en Entity360) | Adapter de incidentes → RC1.8 |

**Invariante:** Connect **emite** a Knowledge como una fuente más (igual que recon/po/treasury); **Knowledge nunca escribe en Connect**. No se toca E1/E2 (migs 0125-0140 vivas en prod intactas).

---

## 2. Numeración (verificada contra base + prod, 2026-06-29)

- Base `release/nexus-base`: máximo label `0140`. Prod en vivo (`schema_migrations`): máximo `0140` (`20260630004647`). `0141` reservado a Compliance (paralelo).
- **RC1.0 = `0142`–`0149`** (8 migraciones). Re-verificar contra `schema_migrations` al aplicar (prod numera por timestamp).
- Reserva forward: incidentes RC1.8 = `0150+`; KPIs RC1.11 = el siguiente libre entonces.

| # | Archivo | Contenido | Origen |
|---|---|---|---|
| 0142 | `connect_module_enum.sql` | `alter type permission_module_t add value 'connect'` — **AISLADA** (tx propia; Postgres prohíbe usar el valor nuevo en la misma tx) | spec 5.1 (renum) |
| 0143 | `connect_schema.sql` | enums `connect_*` + 9 tablas core + A1 (`connect_pinned`, `connect_message_flags`, `participants.is_favorite`) + índices (incl. GIN FTS español) + RLS + triggers `tg_touch_updated_at` | spec 5.2 §B2 + Addendum A1 (renum) |
| 0144 | `connect_rpc.sql` | 15 RPCs `SECURITY DEFINER` (`set search_path=public,pg_temp`, revoke/grant) + `_connect_is_member` + trigger outbox | spec 5.3 + Sección D §3 (renum) |
| 0145 | `connect_views.sql` | vistas `security_invoker=true`: bandeja, canales, contadores no-leídos | spec 5.4 (renum) |
| 0146 | `connect_rbac_seed.sql` | permisos `connect.{view,create,edit,delete,admin}` + grants por rol staff | spec 5.5 (renum) |
| 0147 | `connect_notifications_ext.sql` | publicación realtime de tablas connect + **columnas A4** (`priority`/`remind_at`/`delegated_to`) + kinds `connect_*` (doc) | spec 5.6 + Addendum A4 |
| 0148 | `connect_storage.sql` | buckets `connect-files`/`connect-files-pii` + RLS `storage.objects` | spec 5.7 (renum) |
| 0149 | `connect_knowledge_adapter.sql` | **NUEVO** — adapter Connect→Knowledge (mapeo canónico + trigger defensivo + backfill + seed `knowledge_sources` + hardening H-E1-1) | autorado (molde 0135) |

> Las verbatim de 0143/0144/0145 = cuerpos aprobados del spec §B (5.2/5.3/5.4) renumerados +36; se materializan como archivos al dar el go-ahead (entregado-no-aplicado). Las nuevas/reconciliadas (0142/0146/0147/0148/0149) van completas en §6.

---

## 3. Arquitectura (referencia del spec — sin rediseño)

- Bounded context `connect` transversal; capa `src/lib/connect/` (core **hexagonal** molde `prospeccion` + entidades **flat** molde `recon`), páginas `src/app/(app)/connect/*`, API `src/app/api/connect/*`. Guard `isMock()` obligatorio. **(Solo estructura — el código es RC1.1+.)**
- Escritura **RPC-first** `SECURITY DEFINER`; lectura por vistas `security_invoker`.
- Acoplamiento a otros módulos por `(entity_type, entity_id)` textual, **sin FK** (no-acoplamiento entre bounded contexts).

---

## 4. Modelo de datos (RC1.0)

9 tablas core (spec §B2) + A1:

| Tabla | Esencia | RLS (SELECT / escritura) |
|---|---|---|
| `connect_conversations` | dm/group/channel/erp/incident/whatsapp/ai; `last_message_seq/at` denorm | view + (miembro ∨ canal público ∨ admin) / RPC |
| `connect_participants` | membresía; `member_role` owner/moderator/member/guest; `last_read_seq`; `is_favorite` (A1) | view + (miembro ∨ admin) / propio last_read/muted ∨ RPC |
| `connect_messages` | **append-only**, `seq bigint identity` (orden total), `client_msg_id` (idempotencia), `external_msg_id` (F4) | view + miembro / **UPDATE `using(false)`** (solo RPC) |
| `connect_message_edits` | historial append-only | view + miembro(msg) / solo RPC |
| `connect_message_reactions` | `(message,participant,emoji)` único | view + miembro / propio ∨ RPC |
| `connect_message_mentions` | `@menciones` (dispara notif) | view + miembro / solo RPC |
| `connect_attachments` | metadata; binario solo por signed-URL RPC; `scan_status` | view + miembro (metadata) / RPC + uploader |
| `connect_conversation_links` | **vínculo polimórfico ERP** (uuid + `entity_id_text` para compliance) | view + miembro / RPC |
| `connect_outbox` | superficie de máquina; `seq` PK; índice parcial de cola | **RLS sin policy** (deny-all; trigger DEFINER escribe, worker `service_role` consume) |
| `connect_pinned`, `connect_message_flags` (A1) | fijados (owner/mod) + importantes (per-usuario) | view + miembro / RPC |

Índices clave: `unique(conversation_id, seq)` (orden+keyset), `unique(external_msg_id) where not null`, `unique(client_msg_id por conversación)` (idempotencia), `gin(to_tsvector('spanish', body))` (FTS RC1.9), `connect_outbox(available_at, seq) where status in('pending','failed')`.

`_connect_is_member(conversation_id)` = `SECURITY DEFINER` con `revoke from public` (anti-recursión RLS, molde `is_staff`/`is_admin` de 0005).

---

## 5. Contratos (Sección D del spec)

**15 RPCs** (`SECURITY DEFINER`, `set search_path=public,pg_temp`, revoke public/anon, grant selectivo):
`connect_create_conversation`, `connect_post_message` (→`table(id,seq)`, idempotente por `client_msg_id`), `connect_edit_message`, `connect_delete_message` (soft), `connect_react`/`connect_unreact`, `connect_mark_read`, `connect_add_member`/`connect_remove_member`/`connect_set_member_role`, `connect_archive_conversation`/`connect_set_topic`, `connect_link_entity`/`connect_unlink_entity`, `connect_emit_attachment_signed_url` (audita en `audit_log`). + helper `_connect_is_member` (revocado).

Contratos transversales: error = discriminated union `{ok:true|false, message}` + `mapPgError`; paginación **keyset por `seq`**; idempotencia `client_msg_id`; optimistic update + retry. (Implementación TS = RC1.1+.)

---

## 6. SQL nuevo / reconciliado (completo, entregado-NO-aplicado)

### 0142_connect_module_enum.sql
```sql
-- 0142_connect_module_enum.sql — RC1.0. AISLADA (tx propia): el valor 'connect' se usa recién en 0146.
alter type public.permission_module_t add value if not exists 'connect';
notify pgrst, 'reload schema';
```

### 0146_connect_rbac_seed.sql (renum de spec 5.5; roles verificados 0009:217-224)
```sql
insert into public.permissions (slug, module, action, label, description) values
  ('connect.view',   'connect', 'view',   'Ver Nexus Connect',        'Acceso a conversaciones donde es miembro y canales públicos'),
  ('connect.create', 'connect', 'create', 'Crear / enviar en Connect', 'Crear conversaciones, postear mensajes, reaccionar, adjuntar'),
  ('connect.edit',   'connect', 'edit',   'Editar en Connect',         'Editar mensajes propios, vincular entidades, moderar (segun member_role)'),
  ('connect.delete', 'connect', 'delete', 'Eliminar en Connect',       'Borrado fisico (admin)'),
  ('connect.admin',  'connect', 'admin',  'Administrar Nexus Connect', 'Gestion total del modulo de colaboracion')
on conflict (slug) do nothing;
insert into public.role_permissions (role_id, permission_id)
  select ro.id, p.id from public.roles ro
  join public.permissions p on p.slug in ('connect.view','connect.create')
  where ro.slug in ('director_ops','admin','operaciones','compliance','comercial','seguridad')
  on conflict do nothing;
insert into public.role_permissions (role_id, permission_id)
  select ro.id, p.id from public.roles ro
  join public.permissions p on p.slug = 'connect.edit'
  where ro.slug in ('director_ops','admin','operaciones','compliance','comercial')
  on conflict do nothing;
insert into public.role_permissions (role_id, permission_id)
  select ro.id, p.id from public.roles ro
  join public.permissions p on p.slug in ('connect.admin','connect.delete')
  where ro.slug in ('admin','director_ops')
  on conflict do nothing;
-- cliente_b2b / externos: NO reciben connect.* en RC1 (entran en un RC posterior).
notify pgrst, 'reload schema';
```
> **Gating invisible (fail-closed):** sin estas filas, el dominio "Nexus Link" no se renderiza y los RPC niegan. Deploy de código y activación funcional quedan **desacoplados**.

### 0147_connect_notifications_ext.sql (spec 5.6 + Addendum A4)
```sql
-- Realtime: publicar tablas connect (patrón idempotente 0016).
do $$ declare t text; begin
  foreach t in array array['connect_conversations','connect_participants','connect_messages',
    'connect_message_reactions','connect_message_mentions','connect_attachments','connect_conversation_links'] loop
    if not exists (select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then null; end $$;
-- Centro de notificaciones (A4) — columnas ADITIVAS (no rompe trigger de orders; kind sigue siendo text).
alter table public.notifications add column if not exists priority text
  check (priority in ('low','normal','high','urgent')) default 'normal';
alter table public.notifications add column if not exists remind_at timestamptz;
alter table public.notifications add column if not exists delegated_to uuid references auth.users(id) on delete set null;
-- kinds connect_*: 'connect_message'|'connect_mention'|'connect_channel_invite'|'connect_incident' (sin DDL: kind es text).
notify pgrst, 'reload schema';
```

### 0148_connect_storage.sql (renum de spec 5.7 — buckets + RLS; binario solo por signed-URL RPC de 0144)
*(Cuerpo verbatim del spec 5.7: buckets privados `connect-files` 25MiB / `connect-files-pii` 10MiB + 4 policies `storage.objects` por `has_permission('connect.view'/'connect.create')` / `is_admin()`. `connect-files-pii` sin policy de lectura `authenticated`. ⚠️ backup propio de binarios obligatorio antes de operar — no hay PITR de Storage.)*

### 0149_connect_knowledge_adapter.sql — **NUEVO** (integración Knowledge; molde 0135)
```sql
-- 0149_connect_knowledge_adapter.sql — Nexus Link RC1.0 · Connect como FUENTE de knowledge_events.
-- Unidireccional (SoR→SoK): Connect EMITE; Knowledge NUNCA escribe en Connect. 100% aditiva; E1/E2 intactos.
-- Evento alto-valor/bajo-ruido: "una conversación quedó vinculada a una entidad ERP" → Entity360.
-- NO emite por-mensaje (evita inundar el timeline). Incidentes = adapter propio en RC1.8.
-- visibility_key HEREDADA de la entidad vinculada (reusa knowledge_visibility_for → respeta D-1 ya resuelto).
-- DEPENDE de 0143 (connect_conversation_links) + Knowledge en prod (0125-0140).

create or replace function public.knowledge_connect_links_to_canonical(p public.connect_conversation_links)
returns public.knowledge_event_canonical
language sql stable set search_path = public, pg_temp
as $$
  select row(
    'connect.conversation_linked',
    p.created_at,
    case when p.linked_by is not null then 'user' else 'system' end,
    p.linked_by,
    null,
    p.entity_type,
    coalesce(p.entity_id::text, p.entity_id_text),
    'Conversación vinculada (' || p.entity_type || ')',
    jsonb_build_object('conversation_id', p.conversation_id, 'link_id', p.id),
    public.knowledge_visibility_for(p.entity_type, coalesce(p.entity_id::text, p.entity_id_text)),
    'connect_conversation_links',
    p.id::text,
    null
  )::public.knowledge_event_canonical
$$;

create or replace function public.project_connect_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources where source_table='connect_conversation_links'), false) then
      perform public.knowledge_emit_event(public.knowledge_connect_links_to_canonical(NEW));
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object(
      'component','project_connect_links','source_pk',NEW.id::text,'error',sqlerrm);
  end;
  return null;
end;
$$;

do $$ begin
  if to_regclass('public.connect_conversation_links') is not null then
    drop trigger if exists tg_project_connect_links on public.connect_conversation_links;
    create trigger tg_project_connect_links
      after insert on public.connect_conversation_links
      for each row execute function public.project_connect_links();
  end if;
end $$;

create or replace function public.knowledge_backfill_connect_links(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.connect_conversation_links; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.connect_conversation_links') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources where source_table='connect_conversation_links'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.connect_conversation_links order by id limit p_limit loop
    begin
      v_id := public.knowledge_emit_event(public.knowledge_connect_links_to_canonical(a));
      if v_id is not null then v_count := v_count + 1; end if;
    exception when others then
      v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object(
        'component','knowledge_backfill_connect_links','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now() where source_table='connect_conversation_links';
  return v_count;
end;
$$;

insert into public.knowledge_sources (source_table, enabled, notes)
values ('connect_conversation_links', true, 'Fuente RC1.0 — Connect (conversaciones vinculadas a entidades ERP)')
on conflict (source_table) do nothing;

revoke all     on function public.knowledge_backfill_connect_links(int) from public;
revoke execute on function public.knowledge_backfill_connect_links(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_connect_links(int) to service_role;
revoke all     on function public.project_connect_links() from public;
revoke execute on function public.project_connect_links() from anon, authenticated;
revoke all     on function public.knowledge_connect_links_to_canonical(public.connect_conversation_links) from public;
revoke execute on function public.knowledge_connect_links_to_canonical(public.connect_conversation_links) from anon, authenticated;

select pg_notify('pgrst', 'reload schema');
```

---

## 7. Integración con RBAC
- 5 permisos `connect.*` + grants por rol (0146). Roles reales del corpus (0009:217-224): `director_ops, admin, operaciones, compliance, comercial, seguridad`. Externos NO reciben (RC posterior).
- `connect.admin` (KPIs/panel, RC1.11) exigirá **rol explícito** (mitiga RG-3 fail-open: no apoyarse en `OR current_role()='admin'`).
- Gating invisible fail-closed (sin seed → módulo invisible + RPC niegan).

## 8. Validaciones (kit read-only, entregado para que lo corra Dirección)
- Catálogo: `pg_class.relrowsecurity` en las 11 tablas; `pg_policies` por tabla = matriz §4; `pg_proc.prosecdef` + `proconfig` (search_path) en los 15 RPCs + adapter; grants (anon/authenticated SIN execute en SECDEF).
- Comportamiento RLS sin mutar (savepoint + `set local role` + `set_config jwt` + `rollback`): no-miembro ve 0 mensajes; miembro ve los suyos; `using(false)` bloquea UPDATE directo de `connect_messages`.
- **Test de fuga (RG-7):** evento Connect emitido a Knowledge hereda `visibility_key` de la entidad (no `staff` por defecto si la entidad es `client:`); verificar contra `v_knowledge_entity_360`.
- Idempotencia adapter: doble INSERT del mismo link → 1 solo `knowledge_events` (dedup `(source_table,source_pk,event_type)`).
- typecheck 0 / build 0 / vitest (se mantienen los 337 de la base + tests nuevos en RC1.1+).

## 9. Rollback
- **Preferido (lógico):** revocar `connect.*` de `role_permissions` → módulo invisible al instante, datos inertes. + re-deploy previo (Netlify CLI).
- **Adapter Knowledge:** `update knowledge_sources set enabled=false where source_table='connect_conversation_links'` → deja de emitir sin tocar nada más.
- **Duro:** `ROLLBACK_0142_0149.md` (DROP en orden inverso: adapter fns/trigger → vistas → RPCs → policies → triggers → tablas → enums → buckets). DROP de buckets borra binarios (R4).

## 10. Run Log
`docs/superpowers/RC1-0-RUN-LOG.md` (a abrir al ejecutar): por cada migración/commit = objetivo, archivos, gates (typecheck/build/test), evidencia, decisión, restore point. Mismo estándar que `F05-E2-RUN-LOG.md`.

---

## 11. Decisiones que requieren tu firma G7
- **D-RC1-1:** El adapter Knowledge emite en **conversación↔entidad vinculada** (alto valor / bajo ruido), **no por-mensaje**. ✅ recomendado.
- **D-RC1-2:** `visibility_key` del evento Connect = **heredada de la entidad** (`knowledge_visibility_for`), no `staff` fijo. ✅ recomendado (respeta RLS de la entidad).
- **D-RC1-3:** RC1.0 entrega `0142`–`0149`; incidentes/KPIs en sus sub-fases (`0150+`). ✅ recomendado (subfase cerrada antes de la siguiente).
- **D-RC1-4:** Columnas A4 de notificaciones (priority/remind_at/delegated_to) se agregan ya en `0147` (aditivas), aunque el centro de notif se cablee en RC1.4. ✅ recomendado (evita re-migrar).

Al aprobar (G7): materializo los 8 archivos `0142`–`0149` (verbatim renumerados + los nuevos de §6) en `supabase/migrations/`, entrego `ROLLBACK_0142_0149.md` + kit de validación, abro `RC1-0-RUN-LOG.md`, y **recién entonces** (con tu OK) ejecuto RC1.0 (que sigue siendo entregado-no-aplicado: las migra Martín a mano).
