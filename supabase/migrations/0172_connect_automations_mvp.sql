-- 0172_connect_automations_mvp.sql — Nexus Link F4.4-E4 (Automatizaciones MVP).
-- ENTREGADA, NO APLICADA (G3/D-F44-8). Aplicar a mano en el SQL Editor de prod
-- (arsksytgdnzukbmfgkju) en ventana autorizada. Rollback: ROLLBACK_0171_0172.md.
-- ─────────────────────────────────────────────────────────────────────────
-- Reglas de automatización INTERNAS y REVERSIBLES (D-F44-6) sobre el outbox:
--   · automation_rules  — catálogo seed-only (sin UI). Kill-switch por regla:
--     `update automation_rules set enabled=false where key='…'` (sin deploy).
--   · automation_runs   — telemetría por evaluación + IDEMPOTENCIA dura:
--     UNIQUE(rule_key, outbox_seq) evita efectos duplicados ante re-entrega.
--   · Trigger ADITIVO en connect_incidents que encola `connect.incident.opened`
--     (NO toca las RPCs 0165 — cero riesgo de regresión G2 sobre F4.2).
--   · Seed R1: incidente crítico ⇒ broadcast urgent al rol admin (efecto 100%
--     interno; la evaluación/efecto vive en el processor TS del worker F4.1).
--
-- El consumo depende del scheduler (finding F4.1, riel E1): hasta que el
-- workflow connect-dispatch-outbox corra, los eventos solo se acumulan
-- (inertes, igual que el backlog actual). Los avisos críticos de F4.2 siguen
-- siendo SÍNCRONOS (D2-F4.2) — esta regla es un broadcast ADICIONAL por rol.
--
-- 100% ADITIVA · IDEMPOTENTE. Sin enums nuevos. Sin cambios a objetos existentes.
-- ─────────────────────────────────────────────────────────────────────────

-- ===== 1) automation_rules (seed-only, kill-switch sin deploy) =====
create table if not exists public.automation_rules (
  key        text primary key,
  topic      text not null,
  enabled    boolean not null default false,
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.automation_rules is
  'F4.4-E4: reglas de automatización MVP (seed-only, sin UI). enabled=false = kill-switch sin deploy. Solo efectos internos (notify_role).';

create index if not exists automation_rules_topic_idx
  on public.automation_rules (topic) where enabled;

alter table public.automation_rules enable row level security;
drop policy if exists automation_rules_select on public.automation_rules;
create policy automation_rules_select on public.automation_rules
  for select using (public.has_permission('connect.view'));
-- Sin policies de escritura: altas/cambios SOLO por migración o SQL de
-- Dirección; el worker (service_role) solo LEE.

-- ===== 2) automation_runs (telemetría + idempotencia) =====
create table if not exists public.automation_runs (
  id          bigserial primary key,
  rule_key    text not null references public.automation_rules(key) on delete cascade,
  outbox_seq  bigint not null,
  result      text not null default 'claimed'
                check (result in ('claimed','fired','skipped','error')),
  detail      text,
  duration_ms int,
  created_at  timestamptz not null default now(),
  unique (rule_key, outbox_seq)
);
comment on table public.automation_runs is
  'F4.4-E4: una fila por evaluación regla×evento. UNIQUE(rule_key,outbox_seq) = idempotencia dura del dispatcher ante re-entrega del worker.';

create index if not exists automation_runs_created_idx
  on public.automation_runs (created_at desc);

alter table public.automation_runs enable row level security;
drop policy if exists automation_runs_select on public.automation_runs;
create policy automation_runs_select on public.automation_runs
  for select using (public.has_permission('connect.view'));
-- Sin policies de escritura: escribe solo el worker (service_role, bypassa RLS).

-- ===== 3) Enqueue de connect.incident.opened (trigger ADITIVO) =====
-- AFTER INSERT: public_id ya viene seteado por el trigger BEFORE de 0164.
create or replace function public._connect_outbox_enqueue_incident_opened()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.connect_outbox (topic, payload)
  values (
    'connect.incident.opened',
    jsonb_build_object(
      'incident_id', new.id,
      'public_id',   new.public_id,
      'severidad',   new.severidad::text
    )
  );
  return new;
end;
$$;
revoke all on function public._connect_outbox_enqueue_incident_opened() from public, anon, authenticated;

drop trigger if exists connect_incidents_enqueue_opened on public.connect_incidents;
create trigger connect_incidents_enqueue_opened
  after insert on public.connect_incidents
  for each row execute function public._connect_outbox_enqueue_incident_opened();

-- ===== 4) Seed R1 — incidente crítico ⇒ broadcast interno al rol admin =====
insert into public.automation_rules (key, topic, enabled, config)
values (
  'r1_incidente_critico_broadcast',
  'connect.incident.opened',
  true,
  jsonb_build_object(
    'when', jsonb_build_object('field', 'severidad', 'equals', 'critica'),
    'effect', jsonb_build_object(
      'type', 'notify_role',
      'role_target', 'admin',
      'kind', 'connect_incident',
      'priority', 'urgent',
      'title', 'Incidente crítico abierto',
      'message_template', '{public_id} — abierto con severidad crítica (automatización R1).',
      'entity', 'connect_incident',
      'entity_id_field', 'incident_id'
    )
  )
)
on conflict (key) do nothing;
