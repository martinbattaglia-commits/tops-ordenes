-- 0154_profile_experience.sql — Nexus Link RC1.4 · Perfil de Usuario (D-RC1.4-2/3).
-- ENTREGADA, NO APLICADA (G3). Bloque RC1. NO toca 0142-0153 ni crea tablas nuevas:
-- REUSA public.profiles agregando 4 columnas + 2 RPCs SECDEF fail-closed (perfil propio).
-- Presencia PERSISTENTE simple (D-RC1.4-3: NO Supabase Presence realtime → RC2).
-- Sin IA. profile_meta jsonb centraliza preferencias (tema/idioma/formato/firma texto).
-- DEPENDE de: profiles (0001/0004), tg_touch_updated_at (0004) no aplica (profiles no lo tiene).
-- RLS de profiles (0040: select propia o admin) intacta; la escritura va por RPC (auth.uid()).
-- ─────────────────────────────────────────────────────────────────────────

-- ===== Columnas aditivas (idempotentes) =====
alter table public.profiles add column if not exists avatar_url        text;
alter table public.profiles add column if not exists presence_status   text not null default 'offline';
alter table public.profiles add column if not exists profile_meta      jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists notif_freq_default text not null default 'instant';
alter table public.profiles add column if not exists last_activity_at  timestamptz;

-- CHECK de dominio (idempotentes, vía guard porque Postgres no tiene "add constraint if not exists").
do $$ begin
  alter table public.profiles add constraint profiles_presence_status_ck
    check (presence_status in ('online','idle','busy','offline'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_notif_freq_ck
    check (notif_freq_default in ('instant','daily','weekly','mute'));
exception when duplicate_object then null; end $$;

-- ===== RPC: presencia propia (P-1 fail-closed: valida estado, solo perfil del caller) =====
create or replace function public.set_my_presence(p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sesión no autenticada' using errcode = 'insufficient_privilege';
  end if;
  if p_status is null or p_status not in ('online','idle','busy','offline') then
    raise exception 'estado de presencia inválido: %', p_status using errcode = 'check_violation';
  end if;
  update public.profiles
     set presence_status = p_status, last_activity_at = now()
   where id = auth.uid();
end;
$$;
revoke all on function public.set_my_presence(text) from public, anon, authenticated;
grant execute on function public.set_my_presence(text) to authenticated;

-- ===== RPC: actualizar mi perfil (avatar / preferencias / frecuencia de notif) =====
-- p_meta se MERGE-a sobre profile_meta (preferencias parciales). Solo perfil del caller.
create or replace function public.update_my_profile(
  p_avatar_url text default null,
  p_notif_freq text default null,
  p_meta       jsonb default null
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sesión no autenticada' using errcode = 'insufficient_privilege';
  end if;
  if p_notif_freq is not null and p_notif_freq not in ('instant','daily','weekly','mute') then
    raise exception 'frecuencia inválida: %', p_notif_freq using errcode = 'check_violation';
  end if;
  update public.profiles
     set avatar_url         = coalesce(p_avatar_url, avatar_url),
         notif_freq_default = coalesce(p_notif_freq, notif_freq_default),
         profile_meta       = case when p_meta is null then profile_meta
                                   else profile_meta || p_meta end
   where id = auth.uid();
end;
$$;
revoke all on function public.update_my_profile(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.update_my_profile(text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
