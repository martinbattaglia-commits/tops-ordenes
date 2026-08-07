-- 0213_ai_suggestions.sql — LINK-WA-002 · FASE 2 E1 (IA COPILOTO).
-- Aplicada por Gate SQL autorizado por Dirección (2026-07-29). SQL exacto del commit 4ad14b8.
--
-- Persistencia de SUGERENCIAS de la IA. Una fila acá NO crea nada en el negocio:
-- es una propuesta esperando decisión humana. El analizador sólo escribe en estas
-- tablas; no tiene acceso a las RPCs de tareas/incidencias/oportunidades/workflows.
--
-- 🔑 INVARIANTE DEL MÓDULO AI (tools.test.ts): «retrieval = sesión del usuario».
-- Ningún archivo de src/lib/ai usa service_role: la IA lee y escribe CON LA SESIÓN
-- del humano que la invoca, de modo que la RLS es la frontera real (la IA nunca ve
-- ni escribe más de lo que ese humano podría). Por eso estas tablas NO son deny-all:
-- llevan policies explícitas por rol.
-- ADITIVA PURA: no toca Connect, CRM, IA existente, enums ni RLS vigentes.

create table if not exists public.ai_suggestions (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null,                       -- agrupa todo lo emitido en un análisis
  conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
  kind            text not null check (kind in ('clasificacion','hallazgo','accion')),
  payload         jsonb not null,                      -- validado por zod ANTES de insertar
  citations       jsonb not null default '[]'::jsonb,  -- message_ids que la sustentan
  confidence      numeric(3,2) check (confidence >= 0 and confidence <= 1),
  status          text not null default 'pendiente'
                    check (status in ('pendiente','descartada','aceptada')),
  decided_by      uuid references auth.users(id) on delete set null,
  decided_at      timestamptz,
  -- Trazabilidad post-aceptación (E4): qué entidad real nació de esta sugerencia.
  -- En E1 permanece NULL: aceptar es conceptual, no ejecuta nada.
  created_entity_type text,
  created_entity_id   uuid,
  provider        text not null default 'mock',        -- 'mock' en E1
  model           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ai_suggestions_conv_idx   on public.ai_suggestions (conversation_id);
create index if not exists ai_suggestions_run_idx    on public.ai_suggestions (run_id);
create index if not exists ai_suggestions_status_idx on public.ai_suggestions (status);

-- Registro de cada corrida de análisis (auditoría + límites + costos).
create table if not exists public.ai_analysis_runs (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
  requested_by    uuid references auth.users(id) on delete set null,
  provider        text not null,
  model           text,
  messages_analyzed int not null default 0,
  window_from     timestamptz,
  window_to       timestamptz,
  outcome         text not null check (outcome in ('ok','killed','denied','budget','invalid_output','error')),
  detail          text,
  input_sha256    text,                                -- hash del prompt (auditoría sin PII)
  suggestions_emitted int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists ai_analysis_runs_conv_idx on public.ai_analysis_runs (conversation_id, created_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.ai_suggestions   enable row level security;
alter table public.ai_analysis_runs enable row level security;

-- anon hereda de PUBLIC: revoke explícito (lección P0-a). authenticated opera SOLO
-- dentro de las policies de abajo.
revoke all on table public.ai_suggestions   from public, anon;
revoke all on table public.ai_analysis_runs from public, anon;
grant select, insert, update on table public.ai_suggestions   to authenticated;
grant select, insert          on table public.ai_analysis_runs to authenticated;

-- Sugerencias: sólo administradores las ven, las crean y las deciden.
drop policy if exists "ai_suggestions admin select" on public.ai_suggestions;
create policy "ai_suggestions admin select" on public.ai_suggestions
  for select to authenticated using (public.is_admin());

drop policy if exists "ai_suggestions admin insert" on public.ai_suggestions;
create policy "ai_suggestions admin insert" on public.ai_suggestions
  for insert to authenticated with check (public.is_admin());

drop policy if exists "ai_suggestions admin update" on public.ai_suggestions;
create policy "ai_suggestions admin update" on public.ai_suggestions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Corridas: cualquier usuario autenticado puede dejar constancia de SU intento
-- (así los intentos denegados quedan auditados sin necesidad de service_role),
-- pero sólo administradores pueden leer la auditoría.
drop policy if exists "ai_analysis_runs own insert" on public.ai_analysis_runs;
create policy "ai_analysis_runs own insert" on public.ai_analysis_runs
  for insert to authenticated
  with check (requested_by is null or requested_by = auth.uid());

drop policy if exists "ai_analysis_runs admin select" on public.ai_analysis_runs;
create policy "ai_analysis_runs admin select" on public.ai_analysis_runs
  for select to authenticated using (public.is_admin());
