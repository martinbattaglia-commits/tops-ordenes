-- 0236_nexus_link_channel_capabilities.sql — NEXUS LINK · frontera de canal.
-- ─────────────────────────────────────────────────────────────────────────
-- ADITIVA. No borra datos, no quita ningún permiso vigente, no relaja RLS.
--
-- QUÉ CIERRA
-- Hasta acá Nexus Link no tenía dimensión de CANAL: las conversaciones de
-- WhatsApp son filas `kind='whatsapp'` en las mismas tablas de Connect y el
-- único permiso era `connect.view`/`connect.create`. Lo único que separaba a un
-- usuario de WhatsApp era no ser participante. Medido en producción
-- (2026-08-14): los dos encargados de depósito tienen 0 conversaciones de
-- WhatsApp, así que la prohibición se cumplía POR ACCIDENTE, no por diseño:
-- alcanzaba con agregarlos como participantes para que vieran todo.
--
-- Se introducen seis capacidades por canal y la función que las resuelve.
--
-- DOS REGLAS INNEGOCIABLES
--
--  1. Los permisos legacy `connect.view/create/edit` NO son bypass. La función
--     `nexus_link_can()` no los consulta: una capacidad de canal se tiene o no
--     se tiene, con independencia de lo que el usuario pueda hacer en Connect.
--
--  2. `nexus_link_can()` NO tiene rama administrativa: una capacidad se concede
--     o no existe. La autoridad administrativa vive aparte, en
--     `nexus_link_is_admin()`, que exige doble evidencia —`profiles.role='admin'`
--     Y una asignación canónica con `connect.admin`—, de modo que escribir esa
--     columna no convierta a nadie en administrador. Capacidad y autoridad son
--     dimensiones distintas y se resuelven por separado.
--
-- MEMBRESÍA Y CAPACIDAD SON ACUMULATIVAS: la capacidad no da acceso a ninguna
-- conversación de la que el usuario no sea participante, y la membresía no
-- alcanza sin la capacidad.
--
-- Rollback: ROLLBACK_0236_nexus_link_channel_capabilities.sql
-- ─────────────────────────────────────────────────────────────────────────

-- ═══ (1) Las seis capacidades ═══
-- CORRECCIÓN C5 (2026-08-14), dos defectos reales que el arnés sintético
-- previo no podía detectar — ver 0235a para la medición completa:
--   1. la columna real de `public.permissions` es `label`, no `name`;
--   2. `module='connect'` habría violado `unique(module,action)`:
--      `connect` ya ocupa `view`/`create`/`edit`/`delete`/`admin`/
--      `incident_admin`/`task_admin` en producción, y estas seis filas
--      pedían dos veces `view` y cuatro veces `create` bajo ese mismo módulo.
--      Se usan los dos módulos nuevos de 0235a, con exactamente tres acciones
--      cada uno (view=leer, create=enviar, edit=adjuntar). Ninguna fila
--      existente de `permissions` se toca.
-- Nunca se aplicó a producción: corregir acá no reescribe una migración
-- sellada, es la única aplicación que va a tener.
insert into public.permissions (slug, module, action, label, description) values
  ('nexus_link.internal_chat.read',  'nexus_link_chat', 'view',
   'Nexus Link · leer chat interno',
   'Ver conversaciones internas nativas donde es participante'),
  ('nexus_link.internal_chat.send',  'nexus_link_chat', 'create',
   'Nexus Link · escribir en chat interno',
   'Postear mensajes en conversaciones internas donde es participante'),
  ('nexus_link.internal_chat.media', 'nexus_link_chat', 'edit',
   'Nexus Link · adjuntar en chat interno',
   'Adjuntar imágenes, documentos y audios en conversaciones internas'),
  ('nexus_link.whatsapp.read',       'nexus_link_whatsapp', 'view',
   'Nexus Link · leer WhatsApp',
   'Ver conversaciones de WhatsApp Comercial donde es participante'),
  ('nexus_link.whatsapp.send',       'nexus_link_whatsapp', 'create',
   'Nexus Link · escribir por WhatsApp',
   'Enviar mensajes por WhatsApp Comercial'),
  ('nexus_link.whatsapp.media',      'nexus_link_whatsapp', 'edit',
   'Nexus Link · enviar media por WhatsApp',
   'Enviar imágenes, documentos y audios por WhatsApp Comercial')
on conflict (slug) do nothing;

-- ═══ (2) Concesión: replica el acceso VIGENTE, no lo amplía ═══
--
-- Quien hoy tiene `connect.view` puede ver una conversación de WhatsApp si es
-- participante; quien tiene `connect.create` puede escribir en ella. Se replica
-- exactamente ese estado de hecho — ni un rol más— y se EXCEPTÚA
-- 'Jefe de Deposito', que por rectificación de Dirección queda con chat interno
-- y sin WhatsApp.
--
-- Ningún rol pierde nada: esto es sólo `insert`.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.role_permissions rp_legacy on rp_legacy.role_id = r.id
  join public.permissions p_legacy on p_legacy.id = rp_legacy.permission_id
  join public.permissions p
    on p.slug = case p_legacy.slug
         when 'connect.view'   then 'nexus_link.internal_chat.read'
         when 'connect.create' then 'nexus_link.internal_chat.send'
       end
 where p_legacy.slug in ('connect.view','connect.create')
on conflict do nothing;

-- `internal_chat.media` acompaña a `internal_chat.send`: adjuntar es una forma
-- de postear, y 0146 ya describe `connect.create` como "postear mensajes …,
-- adjuntar". No se amplía nada.
insert into public.role_permissions (role_id, permission_id)
select rp.role_id, p_media.id
  from public.role_permissions rp
  join public.permissions p_send on p_send.id = rp.permission_id
                                and p_send.slug = 'nexus_link.internal_chat.send'
  cross join lateral (
    select id from public.permissions where slug = 'nexus_link.internal_chat.media'
  ) p_media
on conflict do nothing;

-- WhatsApp: mismo criterio, EXCLUYENDO 'Jefe de Deposito'.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.role_permissions rp_legacy on rp_legacy.role_id = r.id
  join public.permissions p_legacy on p_legacy.id = rp_legacy.permission_id
  join public.permissions p
    on p.slug = case p_legacy.slug
         when 'connect.view'   then 'nexus_link.whatsapp.read'
         when 'connect.create' then 'nexus_link.whatsapp.send'
       end
 where p_legacy.slug in ('connect.view','connect.create')
   and r.name <> 'Jefe de Deposito'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select rp.role_id, p_media.id
  from public.role_permissions rp
  join public.permissions p_send on p_send.id = rp.permission_id
                                and p_send.slug = 'nexus_link.whatsapp.send'
  cross join lateral (
    select id from public.permissions where slug = 'nexus_link.whatsapp.media'
  ) p_media
on conflict do nothing;

-- ═══ (3) El resolvedor de capacidades ═══
create or replace function public.nexus_link_can(p_capability text)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  -- SIN ATAJOS. Una capacidad se tiene por CONCESIÓN EXPLÍCITA o no se tiene:
  --   · no se consultan los permisos legacy `connect.*`;
  --   · NO hay rama administrativa. Un administrador canónico obtiene estas
  --     capacidades por la concesión de (2), como cualquier otro rol, no por
  --     ser administrador.
  --
  -- La rama administrativa existió en una versión previa de esta migración y se
  -- quitó a pedido de Dirección: hacía irreproducible la combinación
  -- "administrador canónico SIN capacidad del canal", porque el atajo se la
  -- concedía igual. Verificado antes de quitarla: los seis roles que portan
  -- `connect.admin` en producción portan también `connect.view`/`connect.create`,
  -- así que (2) les concede las capacidades y ninguno pierde acceso efectivo.
  --
  -- La autoridad administrativa NO desaparece: vive en `nexus_link_is_admin()`,
  -- separada y con doble evidencia. Capacidad y autoridad son cosas distintas.
  select coalesce(
    exists (
      select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        join public.permissions p on p.id = rp.permission_id
       where ur.user_id = auth.uid()
         and p.slug = p_capability
    ),
    false
  );
$$;
revoke all on function public.nexus_link_can(text) from public, anon;
grant execute on function public.nexus_link_can(text) to authenticated;

-- ═══ (3-bis) Autoridad administrativa canónica ═══
--
-- `is_admin()` (0005) es sólo `profiles.role = 'admin'`: una columna
-- denormalizada. Alcanza para un menú cosmético, no para autorizar el
-- importador de WhatsApp Comercial, que ve historial de clientes.
--
-- Esta función aplica la MISMA regla de doble evidencia que la rama
-- administrativa de `nexus_link_can()`: la columna Y una asignación canónica
-- real que porte `connect.admin`. Escribir 'admin' en `profiles.role` no
-- concede nada por sí solo.
create or replace function public.nexus_link_is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_role() = 'admin'
    and exists (
      select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        join public.permissions p on p.id = rp.permission_id
       where ur.user_id = auth.uid()
         and p.slug = 'connect.admin'
    ),
    false
  );
$$;
revoke all on function public.nexus_link_is_admin() from public, anon, authenticated;
grant execute on function public.nexus_link_is_admin() to authenticated;

-- ═══ (4) La frontera, dentro de la vista ═══
--
-- `v_connect_inbox` es la fuente única de la bandeja Y de los contadores verde
-- y amarillo (0234). Filtrando acá, un usuario sin `whatsapp.read`:
--   · no ve ninguna conversación de WhatsApp aunque sea participante;
--   · su verde da 0 SIN consultar ninguna fila prohibida;
--   · no puede deducir metadata por diferencia.
--
-- Para quien SÍ tiene la capacidad el resultado es idéntico al de 0234: FASE A
-- queda intacta para todos los que hoy operan WhatsApp.
create or replace view public.v_connect_inbox
with (security_invoker = true) as
select
  c.id                as conversation_id,
  c.context_id,
  c.kind,
  c.title,
  c.slug,
  c.topic,
  c.last_message_at,
  c.last_message_seq,
  p.last_read_seq,
  (
    select count(*)
      from public.connect_messages m
     where m.conversation_id = c.id
       and m.seq > coalesce(p.last_read_seq, 0)
       and m.deleted_at is null
       and m.kind <> 'system'
       and case
             when c.kind = 'whatsapp' then m.author_profile_id is null
             else coalesce(m.author_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  is distinct from p.profile_id
           end
  )::bigint          as unread_count,
  p.is_favorite,
  p.muted_until,
  c.archived_at
from public.connect_conversations c
join public.connect_participants  p
  on p.conversation_id = c.id and p.profile_id = auth.uid()
where c.kind <> 'whatsapp'
   or public.nexus_link_can('nexus_link.whatsapp.read');

notify pgrst, 'reload schema';
