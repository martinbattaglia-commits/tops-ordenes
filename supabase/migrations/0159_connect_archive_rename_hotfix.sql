-- 0159_connect_archive_rename_hotfix.sql — Nexus Link · F3 Pilot hotfix (DEFECT-6 / DEFECT-7).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- Idempotente (create or replace) · aditiva · sin borrar datos · sin tocar slugs · sin cambiar RLS.
-- DEPENDE de 0143 (schema), 0144 (RPC connect_set_topic / is_admin / connect_member_role_t),
--            0145 (vistas v_connect_*).
-- ─────────────────────────────────────────────────────────────────────────
-- DEFECT-6 · Archivar canal no se reflejaba en la UI:
--   La DB ya archivaba bien (connect_archive_conversation → archived_at), pero
--   v_connect_channels NO exponía archived_at, así que el directorio/listados no
--   podían filtrar archivados. Acá SOLO agregamos la columna a la vista (los loaders
--   filtran en app). v_connect_inbox ya exponía archived_at (0145) → no se toca.
--
-- DEFECT-7 · Editar canal cambiaba el tema, no el nombre:
--   No existía RPC para renombrar (title). Creamos connect_set_title, espejo del
--   patrón de seguridad de connect_set_topic (SECURITY DEFINER · search_path fijo ·
--   revoke public/anon/authenticated + grant selectivo · gate owner/moderator/admin),
--   pero con validación (no vacío + trim + límite) y guardas extra:
--     · gate NULL-safe (is distinct from) → un no-miembro NO puede renombrar
--       (endurecimiento respecto del literal de connect_set_topic; NO abre permisos);
--     · bloquea renombrar canales archivados;
--     · cambia SOLO title (jamás slug ni topic).
-- ─────────────────────────────────────────────────────────────────────────

-- ===== DEFECT-6: v_connect_channels expone archived_at =======================
-- CREATE OR REPLACE VIEW conserva grants y solo AGREGA columna al final (contrato
-- de Postgres: mismas columnas/orden/tipo + nuevas al final). Mantiene security_invoker.
create or replace view public.v_connect_channels
with (security_invoker = true) as
select c.id, c.context_id, c.slug, c.title, c.topic, c.visibility, c.last_message_at,
       public._connect_is_member(c.id) as is_member,
       c.archived_at
from public.connect_conversations c
where c.kind = 'channel';

-- Re-aserción idempotente del grant de lectura por sesión (defensivo; create-or-replace
-- ya lo preserva). La frontera real sigue siendo la RLS de connect_conversations.
grant select on public.v_connect_channels to authenticated;

-- ===== DEFECT-7: connect_set_title (renombrar canal) =========================
create or replace function public.connect_set_title(p_conversation_id uuid, p_title text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_my_role     public.connect_member_role_t;
  v_archived_at timestamptz;
  v_title       text := nullif(btrim(p_title), '');
begin
  -- Validación de dominio: no vacío + trim (arriba) + límite razonable (espejo MAX_TITLE_LENGTH=120 en app).
  if v_title is null then
    raise exception 'El nombre del canal no puede estar vacío' using errcode = 'check_violation';
  end if;
  v_title := left(v_title, 120);

  -- Gate owner/moderator/admin — NULL-safe: un no-miembro (v_my_role NULL) NO pasa.
  select member_role into v_my_role
    from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if v_my_role is distinct from 'owner'
     and v_my_role is distinct from 'moderator'
     and not public.is_admin() then
    raise exception 'sin permiso para renombrar el canal' using errcode = 'insufficient_privilege';
  end if;

  -- No renombrar canales archivados (coherente con la vista read-only del piloto).
  select archived_at into v_archived_at
    from public.connect_conversations where id = p_conversation_id;
  if v_archived_at is not null then
    raise exception 'no se puede renombrar un canal archivado' using errcode = 'check_violation';
  end if;

  -- Cambia SOLO el nombre visible. NUNCA slug ni topic.
  update public.connect_conversations set title = v_title where id = p_conversation_id;
end;
$$;
revoke all on function public.connect_set_title(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_set_title(uuid, text) to authenticated;

notify pgrst, 'reload schema';
