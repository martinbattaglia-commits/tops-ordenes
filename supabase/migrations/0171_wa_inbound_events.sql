-- 0171_wa_inbound_events.sql — Nexus Link F4.4-E3 (spike WhatsApp sandbox).
-- ENTREGADA, NO APLICADA (G3/D-F44-8). Aplicar a mano en el SQL Editor de prod
-- (arsksytgdnzukbmfgkju) en ventana autorizada. Rollback: ROLLBACK_0171.md.
-- ─────────────────────────────────────────────────────────────────────────
-- Persistencia CRUDA y append-only de los eventos inbound del webhook de
-- WhatsApp (Meta Cloud API), DESPUÉS de la verificación HMAC del route
-- (F4.4-E2: solo se insertan eventos con firma válida; los rechazos van a
-- audit_log, no acá). Sin parsing de negocio en F4.4 — la tabla ES la
-- auditoría del canal y el insumo del análisis para F5.
--
-- PII (D-F44-7): el payload contiene teléfonos y texto libre de terceros →
-- RLS DENY-ALL (cero policies; solo service_role, que bypassa RLS) + revoke
-- defensivo. Sin exposición en UI en F4.4. Retención propuesta: 90 días para
-- el sandbox (purga manual documentada en el Validation Pack; sin cron nuevo).
--
-- 100% ADITIVA · IDEMPOTENTE. No toca objetos existentes. Sin enums.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.wa_inbound_events (
  seq             bigserial primary key,
  payload         jsonb   not null,
  signature_valid boolean not null default true,
  received_at     timestamptz not null default now(),
  processed       boolean not null default false,
  notes           text
);

comment on table public.wa_inbound_events is
  'F4.4-E3: eventos inbound del webhook WhatsApp (Meta), crudos y post-HMAC. Deny-all: PII de terceros. Append-only; processed/notes reservados para F5.';

create index if not exists wa_inbound_events_received_idx
  on public.wa_inbound_events (received_at desc);
create index if not exists wa_inbound_events_unprocessed_idx
  on public.wa_inbound_events (seq)
  where processed = false;

alter table public.wa_inbound_events enable row level security;
-- DENY-ALL deliberado: ninguna policy. service_role (bypassa RLS) es el único
-- lector/escritor (el route handler usa createAdminClient()).
revoke all on table public.wa_inbound_events from public, anon, authenticated;
revoke all on sequence public.wa_inbound_events_seq_seq from public, anon, authenticated;
