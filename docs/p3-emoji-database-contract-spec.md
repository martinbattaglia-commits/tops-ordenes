# Especificación de Contrato SQL para Reacciones Emoji (P3 / HIGH 4)

**Estado:** `PREPARADA / PENDIENTE DE DIRECCIÓN — AUTORIZACIÓN DE MIGRACIÓN/INFRAESTRUCTURA`
**Expediente:** `HOTFIX-LINK-V2` / `NEXUS-LINK-MAX-RECOVERY`

---

## 1. Alcance Canónico

La plataforma restringe las reacciones en chats internos (Connect) exclusivamente al conjunto de 6 emojis estándar:
`👍 ❤️ 😂 😮 😢 🙏`

Para garantizar defensa en profundidad (defense-in-depth), la restricción se aplica tanto en la capa de servidor (driving adapter Zod) como en la base de datos (Check Constraint, auditoría fail-closed de filas legacy y RPCs SECDEF `connect_react_pre_0246` y `connect_react`).

Preserva expresamente la protección introducida por `supabase/migrations/0246_clientes_fase_b_principals_capabilities.sql` (`nexus_depot_manager_reject_legacy_connect`).

---

## 2. Migración Forward (Preparada — No aplicada)

```sql
-- 0265_connect_reaction_emoji_whitelist.sql
-- Restringe emojis a la allowlist oficial en connect_message_reactions y connect_react de forma fail-closed y data-preserving.

-- 1. Auditoría fail-closed de filas legacy: si existen emojis no conformes, la migración se DETIENE sin mutar datos.
do $$
declare
  v_incompatible_count integer;
begin
  select count(*) into v_incompatible_count
    from public.connect_message_reactions
   where emoji not in ('👍', '❤️', '😂', '😮', '😢', '🙏');

  if v_incompatible_count > 0 then
    raise exception 'MIGRATION_HALTED_NON_CONFORMANT_DATA: Se detectaron % reacciones con emojis no autorizados. La migración se detiene fail-closed sin alterar datos.', v_incompatible_count
      using errcode = 'integrity_constraint_violation';
  end if;
end;
$$;

-- 2. Check constraint en tabla connect_message_reactions
alter table public.connect_message_reactions
  drop constraint if exists connect_message_reactions_emoji_check;

alter table public.connect_message_reactions
  add constraint connect_message_reactions_emoji_check
  check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🙏'));

-- 3. Función base connect_react_pre_0246 endurecida con allowlist
create or replace function public.connect_react_pre_0246(
  p_message_id uuid,
  p_emoji text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv uuid;
  v_part uuid;
begin
  if p_emoji not in ('👍', '❤️', '😂', '😮', '😢', '🙏') then
    raise exception 'emoji no soportado: %', p_emoji using errcode = 'check_violation';
  end if;

  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  if not found then
    raise exception 'mensaje inexistente';
  end if;

  if not public._connect_is_member(v_conv) then
    raise exception 'no es miembro' using errcode = 'insufficient_privilege';
  end if;

  perform public._connect_assert_not_archived(v_conv);
  v_part := public._connect_my_participant(v_conv);

  insert into public.connect_message_reactions (message_id, participant_id, emoji)
  values (p_message_id, v_part, p_emoji)
  on conflict (message_id, participant_id, emoji) do nothing;
end;
$$;

revoke all on function public.connect_react_pre_0246(uuid, text)
  from public, anon, authenticated, service_role;

-- 4. Reemplazo del wrapper público connect_react con nombres nominales para PostgREST
drop function if exists public.connect_react(uuid, text);

create or replace function public.connect_react(
  p_message_id uuid,
  p_emoji text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.nexus_depot_manager_reject_legacy_connect();
  perform public.connect_react_pre_0246(p_message_id, p_emoji);
end;
$$;

revoke all on function public.connect_react(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.connect_react(uuid, text) to authenticated;

notify pgrst, 'reload schema';
```

---

## 3. Rollback de Migración

```sql
-- ROLLBACK_0265_connect_reaction_emoji_whitelist.sql
-- Inversa data-preserving de 0265: retira constraint y restaura funciones a su estado de 0246.

alter table public.connect_message_reactions
  drop constraint if exists connect_message_reactions_emoji_check;

create or replace function public.connect_react_pre_0246(
  p_message_id uuid,
  p_emoji text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv uuid;
  v_part uuid;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  if not found then
    raise exception 'mensaje inexistente';
  end if;

  if not public._connect_is_member(v_conv) then
    raise exception 'no es miembro' using errcode = 'insufficient_privilege';
  end if;

  perform public._connect_assert_not_archived(v_conv);
  v_part := public._connect_my_participant(v_conv);

  insert into public.connect_message_reactions (message_id, participant_id, emoji)
  values (p_message_id, v_part, p_emoji)
  on conflict (message_id, participant_id, emoji) do nothing;
end;
$$;

revoke all on function public.connect_react_pre_0246(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.connect_react(uuid, text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.nexus_depot_manager_reject_legacy_connect();
  perform public.connect_react_pre_0246($1, $2);
end;
$$;

revoke all on function public.connect_react(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.connect_react(uuid, text) to authenticated;

notify pgrst, 'reload schema';
```
