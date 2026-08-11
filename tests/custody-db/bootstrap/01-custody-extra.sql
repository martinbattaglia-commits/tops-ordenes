-- =========================================================================
-- DB-1 · Bootstrap ADICIONAL de custodia. EXCLUSIVO DE TESTS.
--
-- Se aplica DESPUÉS del bootstrap vanilla (`tests/db/bootstrap/`), que crea
-- schema auth, auth.users, auth.uid(), auth.role() y auth.jwt() sobre GUCs.
-- El vanilla NO se modifica: es byte-invariante por decisión D4.
--
-- POR QUÉ HACE FALTA: `decide_custody_integrity` (0223) valida la sesión real
-- contra `auth.sessions`, tabla que el stub vanilla no crea porque ninguna
-- prueba A0 la necesitaba. Sin ella la RPC fallaría por tabla inexistente y no
-- por la regla que se quiere ejercitar — y una prueba que falla por la razón
-- equivocada no prueba nada.
--
-- No es esquema productivo: en Supabase `auth.sessions` la administra la
-- plataforma. Acá se replica sólo la forma mínima que la RPC consulta
-- (id, user_id).
-- =========================================================================

create table if not exists auth.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists auth_sessions_user_idx on auth.sessions (user_id);
