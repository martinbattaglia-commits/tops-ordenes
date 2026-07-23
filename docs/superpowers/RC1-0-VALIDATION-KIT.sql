-- RC1-0-VALIDATION-KIT.sql — Nexus Link RC1.0 · kit de validación 100% READ-ONLY.
-- Lo CORRE DIRECCIÓN (el asistente no ejecuta WRITES en prod, G3). Sin mutaciones:
-- los bloques de comportamiento usan savepoint + rollback (0 footprint).
-- Proyecto: tops-ordenes-prod / arsksytgdnzukbmfgkju (verificar antes de correr).
-- Correr DESPUÉS de aplicar 0142-0149. Cada SELECT es una aserción OK/FALLO.
-- ─────────────────────────────────────────────────────────────────────────

-- (1) RLS habilitada en las 11 tablas connect (espera 11 con relrowsecurity=true).
select 'RLS_ENABLED' as check, count(*) filter (where relrowsecurity) as con_rls, count(*) as total,
       case when count(*) = count(*) filter (where relrowsecurity) then 'OK' else 'FALLO' end as estado
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('connect_conversations','connect_participants','connect_messages',
    'connect_message_edits','connect_message_reactions','connect_message_mentions',
    'connect_attachments','connect_conversation_links','connect_outbox',
    'connect_pinned','connect_message_flags');

-- (2) connect_outbox: RLS habilitada SIN policy (deny-all). Espera 0 policies.
select 'OUTBOX_DENY_ALL' as check, count(*) as policies,
       case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from pg_policies where schemaname='public' and tablename='connect_outbox';

-- (3) connect_messages: UPDATE de sesión bloqueado (policy using(false)). Espera 1.
select 'MSG_APPEND_ONLY' as check, count(*) as policies_update_false,
       case when count(*) >= 1 then 'OK' else 'FALLO' end as estado
from pg_policies where schemaname='public' and tablename='connect_messages'
  and cmd='UPDATE' and qual='false';

-- (4) Funciones que DEBEN ser SECURITY DEFINER con search_path fijo (excluye mapeo puro + triggers BEFORE).
select 'SECDEF_SEARCHPATH' as check, p.proname,
       p.prosecdef as is_secdef,
       (exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%pg_temp%')) as has_pg_temp,
       case when p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%pg_temp%')
            then 'OK' else 'FALLO' end as estado
from pg_proc p
where p.pronamespace='public'::regnamespace
  and (p.proname like 'connect\_%' escape '\' or p.proname like '\_connect\_%' escape '\'
       or p.proname in ('project_connect_links','knowledge_backfill_connect_links'))
  and p.proname not in ('knowledge_connect_links_to_canonical','_connect_set_context_id','_connect_guard_context_id')
order by p.proname;

-- (4b) Funciones que por DISEÑO NO son SECDEF (mapeo puro = molde 0135; triggers BEFORE que solo
--      mutan/validan NEW): basta con search_path fijo. Esperado: estado=OK, is_secdef=false.
select 'NONSECDEF_SEARCHPATH' as check, p.proname, p.prosecdef as is_secdef,
       (exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%pg_temp%')) as has_pg_temp,
       case when exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%pg_temp%')
            then 'OK' else 'FALLO' end as estado
from pg_proc p
where p.pronamespace='public'::regnamespace
  and p.proname in ('knowledge_connect_links_to_canonical','_connect_set_context_id','_connect_guard_context_id')
order by p.proname;

-- (5) Hardening: ninguna SECDEF de escritura ejecutable por anon/authenticated indebidamente.
--     (El helper _connect_is_member/_my_participant y los RPC de usuario SÍ tienen authenticated;
--      el adapter Knowledge y _connect_enqueue_message NO deben tenerlo.)
select 'ADAPTER_NO_AUTH_EXEC' as check, p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can_exec,
       case when not has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'OK' else 'FALLO' end as estado
from pg_proc p
where p.pronamespace='public'::regnamespace
  and p.proname in ('project_connect_links','knowledge_backfill_connect_links',
                    'knowledge_connect_links_to_canonical','_connect_enqueue_message');

-- (6) Context ID (D-RC1-6): columna NOT NULL + UNIQUE + trigger de generación + guard de inmutabilidad.
select 'CONTEXT_ID_SHAPE' as check,
       (select count(*) from information_schema.columns
         where table_schema='public' and table_name='connect_conversations'
           and column_name='context_id' and is_nullable='NO') as col_notnull,
       (select count(*) from pg_trigger where tgrelid='public.connect_conversations'::regclass
           and tgname in ('trg_connect_conversations_ctxid','trg_connect_conversations_ctxid_guard')) as triggers;

-- (7) Source Registry: la fuente de Connect quedó registrada (enabled=true).
select 'KNW_SOURCE_REGISTERED' as check, enabled,
       case when enabled then 'OK' else 'FALLO' end as estado
from public.knowledge_sources where source_table='connect_conversation_links';

-- (8) Seed RBAC: 5 permisos connect.* presentes.
select 'RBAC_SEED' as check, count(*) as perms,
       case when count(*) = 5 then 'OK' else 'FALLO' end as estado
from public.permissions where module='connect';

-- ─────────────────────────────────────────────────────────────────────────
-- (9) COMPORTAMIENTO RLS — savepoint + rollback (0 footprint). Ajustar los UUID
--     de usuarios/conversación de prueba antes de correr. Patrón RLS_0040_SMOKE_TEST.
-- ─────────────────────────────────────────────────────────────────────────
-- begin;
--   savepoint s;
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub','<UUID_NO_MIEMBRO>')::text, true);
--   -- Espera 0 filas (no es miembro):
--   select count(*) as visibles_no_miembro from public.connect_messages where conversation_id = '<UUID_CONV>';
--   rollback to savepoint s;
-- rollback;

-- (10) FUGA DE VISIBILIDAD (RG-7) — el evento Connect hereda la visibility de la entidad.
--      Para una conversación vinculada a una entidad 'client:<uuid>', el knowledge_event
--      NO debe quedar 'staff' si la entidad resuelve a client. Verificar tras un INSERT de prueba
--      (en savepoint+rollback) comparando knowledge_visibility_for(entity_type, entity_id)
--      contra el visibility_key del evento emitido. (Test detallado a ejecutar en la validación
--      de RC1.3, cuando el linking esté cableado.)
