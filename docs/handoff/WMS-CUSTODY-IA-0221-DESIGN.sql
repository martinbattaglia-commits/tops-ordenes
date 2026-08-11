-- =========================================================================
-- ⚠️  ESTO NO ES UNA MIGRACIÓN. ES UN ARTEFACTO DE DISEÑO.
--
-- MIGRATION STATUS: DESIGN ONLY / NOT EXECUTABLE / NOT READY FOR LEASE
-- ESTADO DEL REQUISITO R-6: CORREGIDO EN DISEÑO · NO VERIFICADO EN DB
--
-- NO copiar a `supabase/migrations/`. SCR-WMS-001 sigue abierto: el harness
-- vanilla no puede aplicar esto porque `custody_evidence` nace en 0036,
-- 0036–0039 están en FROZEN_EXCLUDED_FILES y 0036 exige PostGIS.
--
-- REVISIÓN 4 (R3-5). Cambios respecto de la anterior:
--   · la rama `release` de `decide_custody_integrity` **falla incondicionalmente**
--     mientras falten el enum de inspección y la RPC de atestación. La cuarentena
--     sigue permitida.
--   · el caller YA NO puede declarar como hechos: execution_mode, outcome,
--     verdict, model_confidence, chain_status, chain_events_checked, chain_head
--     ni chain_attested_at. Esas columnas sólo las escribirá una frontera
--     server-side de verificación que todavía no existe: quedan NULL.
--   · `p_current_chain_head` deja de existir: la palabra del caller no acredita
--     el head vigente. Se comprobará bajo el lock, contra la cadena real.
--   · `custody_evidence_scope` y `custody_entity_client_id` son helpers
--     INTERNOS: sin EXECUTE para `authenticated`.
--   · `revoke` explícito a `authenticated` antes de conceder lo mínimo.
--   · `session_id` desde `auth.jwt()` validado contra `auth.sessions`, no desde
--     un GUC individual no demostrado por el entorno real.
--
-- REVISIÓN 3 tras el C4 final:
--   · 🔴 `custody_evidence` NO tiene `packing_unit_id` ni `shipment_id`. Su
--     único vínculo es `event_id → custody_events(id)`, y el scope vive en
--     `custody_events.packing_unit_id | shipment_id`. Todas las consultas de
--     pertenencia se reescribieron con ese join. La revisión anterior
--     referenciaba columnas inexistentes: no habría compilado.
--   · creación/assessment atómicos con lock de entidad y `client_id` derivado;
--   · `p_expected_version` validado (NULL o <= 0 se rechaza);
--   · `UPDATE … RETURNING` + `GET DIAGNOSTICS`: si no afecta exactamente una
--     fila, la transacción aborta y NO queda decisión huérfana;
--   · `actor_session_id` desde el `session_id` real del JWT, validado contra
--     `auth.sessions`; sin fallback a `auth.uid()`;
--   · atestación de cadena (`chain_head`, `attested_at`) persistida y revalidada;
--   · coherencia en AMBAS direcciones + privilegios explícitos además de RLS.
--
-- 🔴 HALLAZGO DE SEGURIDAD DEL ESQUEMA VIGENTE (0009:164)
--   `public.has_permission(text)` devuelve
--       exists(...) OR public.current_role() = 'admin'
--   Con `current_role()` NULL la expresión es `false OR NULL` = NULL. Un guard
--   `if not public.has_permission('x') then raise` evalúa `not NULL` = NULL, no
--   dispara, y la autorización PASA EN SILENCIO. Acá siempre se usa
--   `coalesce(public.has_permission('x'), false)`. Corregir la función en sí
--   afecta a todo el repositorio: es decisión de Dirección.
--
-- 🔴 DECISIÓN DE ESQUEMA PENDIENTE — INSPECCIÓN HUMANA
--   `custody_event_type_t` admite `foto_packing · cargado · en_transito ·
--   foto_entrega · firmado · pod`. Ninguno representa una inspección física
--   humana. Este diseño NO inventa un tipo: define el contrato y deja la
--   liberación BLOQUEADA hasta que Dirección autorice el valor de enum.
--
-- 🔴 PRECONDICIÓN DE IDENTIDAD
--   `logistics_orders.client_id` es anulable (0219: «SIN BACKFILL»). Si el
--   pedido no tiene cliente resuelto, el caso NO se crea. Fail-closed.
-- =========================================================================

-- =========================================================================
-- 0) Helpers
-- =========================================================================

/** Alcance de cliente del usuario. `profiles.client_id` está hoy sin poblar:
    mientras siga así, un rol 'cliente' no verá filas. Correcto y preferible a
    abrir la tabla a toda sesión autenticada. */
create or replace function public.current_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.client_id from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.current_client_id() from public, anon, authenticated;
grant execute on function public.current_client_id() to authenticated;

/** Scope real de una evidencia: custody_evidence → custody_events.
    ESTA es la única ruta válida; `custody_evidence` no tiene columnas de scope. */
create or replace function public.custody_evidence_scope(p_evidence_id uuid)
returns table (packing_unit_id uuid, shipment_id uuid, event_id uuid)
language sql stable security definer set search_path = public as $$
  select evt.packing_unit_id, evt.shipment_id, evt.id
    from public.custody_evidence ev
    join public.custody_events evt on evt.id = ev.event_id
   where ev.id = p_evidence_id;
$$;
-- HELPER INTERNO: sin EXECUTE para authenticated (evita enumeración cross-client).
revoke all on function public.custody_evidence_scope(uuid) from public, anon, authenticated;

/** client_id canónico de una entidad de custodia, vía su pedido. */
create or replace function public.custody_entity_client_id(p_scope text, p_entity_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select lo.client_id
    from public.logistics_orders lo
   where lo.id = case
     when p_scope = 'packing_unit' then (select pu.order_id from public.packing_units pu where pu.id = p_entity_id)
     when p_scope = 'shipment'     then (select s.order_id  from public.shipments s     where s.id = p_entity_id)
   end;
$$;
-- HELPER INTERNO: sin EXECUTE para authenticated.
revoke all on function public.custody_entity_client_id(text, uuid) from public, anon, authenticated;

-- =========================================================================
-- 1) custody_integrity_cases
-- =========================================================================
create sequence if not exists public.custody_integrity_case_short_id_seq start 1;

create table if not exists public.custody_integrity_cases (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.custody_integrity_case_short_id_seq'),
  public_id text not null unique,

  packing_unit_id uuid references public.packing_units(id) on delete restrict,
  shipment_id     uuid references public.shipments(id)     on delete restrict,

  client_id uuid not null references public.clients(id) on delete restrict,
  version   int  not null default 1,

  state        text not null default 'PENDING_EVIDENCE',
  hold_reasons text[] not null default '{}',

  ingress_evidence_id uuid references public.custody_evidence(id) on delete restrict,
  egress_evidence_id  uuid references public.custody_evidence(id) on delete restrict,

  provider text, model text, prompt_version text,
  execution_mode text, outcome text, verdict text,
  model_confidence numeric(4,3), provider_error text,

  -- Atestación de cadena, emitida por la verificación.
  chain_status         text,
  chain_events_checked int,
  chain_head           text,
  chain_attested_at    timestamptz,

  decision_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint custody_integrity_cases_one_scope_chk check (num_nonnulls(packing_unit_id, shipment_id) = 1),
  constraint custody_integrity_cases_state_chk check (state in ('PENDING_EVIDENCE','REVIEW_REQUIRED','RELEASED','QUARANTINED')),
  constraint custody_integrity_cases_version_chk check (version >= 1),

  constraint custody_integrity_cases_exec_mode_chk check (execution_mode is null or execution_mode in ('real','mock','cached')),
  constraint custody_integrity_cases_outcome_chk check (outcome is null or outcome in ('ok','timeout','unavailable','invalid_response','threw','not_executed')),
  constraint custody_integrity_cases_outcome_needs_mode_chk check (outcome is null or execution_mode is not null),
  constraint custody_integrity_cases_verdict_chk check (verdict is null or verdict in ('coincide','diferencias','posible_dano')),
  constraint custody_integrity_cases_verdict_requires_ok_chk check (verdict is null or outcome = 'ok'),
  constraint custody_integrity_cases_confidence_chk check (model_confidence is null or (model_confidence >= 0 and model_confidence <= 1)),
  constraint custody_integrity_cases_confidence_requires_verdict_chk check (model_confidence is null or verdict is not null),

  constraint custody_integrity_cases_chain_status_chk check (chain_status is null or chain_status in ('verified','invalid','unverifiable')),
  -- Atestación completa o no hay 'verified'.
  constraint custody_integrity_cases_chain_attestation_chk check (
    chain_status is distinct from 'verified'
    or (coalesce(chain_events_checked, 0) > 0 and chain_head is not null and chain_attested_at is not null)
  ),

  constraint custody_integrity_cases_evidence_distinct_chk check (
    ingress_evidence_id is null or egress_evidence_id is null or ingress_evidence_id <> egress_evidence_id
  ),

  -- 🔴 REGLA HUMANO–IA acreditada RELACIONALMENTE.
  constraint custody_integrity_cases_terminal_needs_decision_chk check (
    (state in ('RELEASED','QUARANTINED')) = (decision_id is not null)
  )
);

create unique index if not exists custody_integrity_cases_evidence_pair_uk
  on public.custody_integrity_cases (ingress_evidence_id, egress_evidence_id)
  where ingress_evidence_id is not null and egress_evidence_id is not null;
create index if not exists custody_integrity_cases_pu_idx     on public.custody_integrity_cases (packing_unit_id);
create index if not exists custody_integrity_cases_ship_idx   on public.custody_integrity_cases (shipment_id);
create index if not exists custody_integrity_cases_client_idx on public.custody_integrity_cases (client_id);

-- =========================================================================
-- 2) custody_integrity_decisions — APPEND-ONLY
-- =========================================================================
create table if not exists public.custody_integrity_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.custody_integrity_cases(id) on delete restrict,
  decision text not null,
  actor_user_id    uuid not null references auth.users(id) on delete restrict,
  actor_session_id uuid not null,
  actor_role       text not null,
  client_id        uuid not null references public.clients(id) on delete restrict,
  permission       text not null,
  decided_at   timestamptz not null default now(),
  reason       text not null,
  observations text,
  previous_state text not null,
  new_state      text not null,
  case_version_at_decision int not null,
  chain_head_at_decision   text,
  created_at timestamptz not null default now(),

  constraint custody_integrity_decisions_decision_chk check (decision in ('release','quarantine')),
  constraint custody_integrity_decisions_permission_chk check (permission = 'wms.custody.decide'),
  constraint custody_integrity_decisions_role_chk check (length(btrim(actor_role)) > 0),
  constraint custody_integrity_decisions_reason_chk check (length(btrim(reason)) >= 10),
  constraint custody_integrity_decisions_prev_state_chk check (previous_state = 'REVIEW_REQUIRED'),
  constraint custody_integrity_decisions_new_state_chk check (new_state in ('RELEASED','QUARANTINED')),
  constraint custody_integrity_decisions_coherence_chk check ((decision = 'release') = (new_state = 'RELEASED')),
  constraint custody_integrity_decisions_version_chk check (case_version_at_decision >= 1),
  -- Una liberación sin head de cadena no es defendible.
  constraint custody_integrity_decisions_release_head_chk check (decision <> 'release' or chain_head_at_decision is not null)
);

create unique index if not exists custody_integrity_decisions_case_uk on public.custody_integrity_decisions (case_id);
create index if not exists custody_integrity_decisions_actor_idx on public.custody_integrity_decisions (actor_user_id);

do $$ begin
  alter table public.custody_integrity_cases
    add constraint custody_integrity_cases_decision_fk
    foreign key (decision_id) references public.custody_integrity_decisions(id)
    deferrable initially deferred;
exception when duplicate_object then null; end $$;

create or replace function public.prevent_custody_integrity_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'tabla append-only: % no está permitido', tg_op using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_custody_integrity_decisions_immutable on public.custody_integrity_decisions;
create trigger trg_custody_integrity_decisions_immutable
  before update or delete on public.custody_integrity_decisions
  for each row execute function public.prevent_custody_integrity_mutation();

drop trigger if exists trg_custody_integrity_decisions_no_truncate on public.custody_integrity_decisions;
create trigger trg_custody_integrity_decisions_no_truncate
  before truncate on public.custody_integrity_decisions
  for each statement execute function public.prevent_custody_integrity_mutation();

-- =========================================================================
-- 3) Evidencias de inspección — tabla puente con integridad referencial
-- =========================================================================
create table if not exists public.custody_integrity_inspection_evidence (
  decision_id uuid not null references public.custody_integrity_decisions(id) on delete restrict,
  evidence_id uuid not null references public.custody_evidence(id) on delete restrict,
  primary key (decision_id, evidence_id)
);

drop trigger if exists trg_custody_integrity_inspection_immutable on public.custody_integrity_inspection_evidence;
create trigger trg_custody_integrity_inspection_immutable
  before update or delete on public.custody_integrity_inspection_evidence
  for each row execute function public.prevent_custody_integrity_mutation();

drop trigger if exists trg_custody_integrity_inspection_no_truncate on public.custody_integrity_inspection_evidence;
create trigger trg_custody_integrity_inspection_no_truncate
  before truncate on public.custody_integrity_inspection_evidence
  for each statement execute function public.prevent_custody_integrity_mutation();

-- =========================================================================
-- 4) Coherencia en AMBAS direcciones (constraint triggers diferidos)
-- =========================================================================
create or replace function public.assert_custody_integrity_case_coherence()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.custody_integrity_cases;
  d public.custody_integrity_decisions;
  v_entity_client uuid;
  v_scope text;
  v_entity uuid;
begin
  select * into c from public.custody_integrity_cases where id = new.id;
  if not found then return null; end if;

  v_scope  := case when c.packing_unit_id is not null then 'packing_unit' else 'shipment' end;
  v_entity := coalesce(c.packing_unit_id, c.shipment_id);

  v_entity_client := public.custody_entity_client_id(v_scope, v_entity);
  if v_entity_client is null or v_entity_client <> c.client_id then
    raise exception 'client_id del caso % no coincide con el de su entidad', c.public_id
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Pertenencia de las evidencias comparadas, vía custody_events.
  if exists (
    select 1
      from public.custody_evidence e
      join public.custody_events ev on ev.id = e.event_id
     where e.id in (c.ingress_evidence_id, c.egress_evidence_id)
       and coalesce(ev.packing_unit_id, ev.shipment_id) is distinct from v_entity
  ) then
    raise exception 'evidencia ajena a la entidad del caso %', c.public_id
      using errcode = 'integrity_constraint_violation';
  end if;

  if c.state in ('RELEASED','QUARANTINED') then
    select * into d from public.custody_integrity_decisions where id = c.decision_id;
    if not found then
      raise exception 'caso % terminal sin fila de decisión', c.public_id using errcode = 'integrity_constraint_violation';
    end if;
    if d.case_id <> c.id or d.new_state <> c.state or d.client_id <> c.client_id then
      raise exception 'decisión incoherente con el caso %', c.public_id using errcode = 'integrity_constraint_violation';
    end if;
    if d.decision = 'release' and not exists (
      select 1 from public.custody_integrity_inspection_evidence i where i.decision_id = d.id
    ) then
      raise exception 'liberación del caso % sin evidencia de inspección', c.public_id
        using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  return null;
end;
$$;

/** Dirección inversa: ninguna decisión puede quedar huérfana ni apuntar a un
    caso que no la referencia. */
create or replace function public.assert_custody_integrity_decision_coherence()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.custody_integrity_cases;
begin
  select * into c from public.custody_integrity_cases where id = new.case_id;
  if not found then
    raise exception 'decisión huérfana: caso inexistente' using errcode = 'integrity_constraint_violation';
  end if;
  if c.decision_id is distinct from new.id then
    raise exception 'decisión no referenciada por su caso' using errcode = 'integrity_constraint_violation';
  end if;
  if c.client_id <> new.client_id or c.state <> new.new_state then
    raise exception 'decisión incoherente con el caso' using errcode = 'integrity_constraint_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_custody_integrity_case_coherence on public.custody_integrity_cases;
create constraint trigger trg_custody_integrity_case_coherence
  after insert or update on public.custody_integrity_cases
  deferrable initially deferred for each row
  execute function public.assert_custody_integrity_case_coherence();

drop trigger if exists trg_custody_integrity_decision_coherence on public.custody_integrity_decisions;
create constraint trigger trg_custody_integrity_decision_coherence
  after insert on public.custody_integrity_decisions
  deferrable initially deferred for each row
  execute function public.assert_custody_integrity_decision_coherence();

-- =========================================================================
-- 5) RLS + privilegios explícitos
-- =========================================================================
alter table public.custody_integrity_cases               enable row level security;
alter table public.custody_integrity_decisions           enable row level security;
alter table public.custody_integrity_inspection_evidence enable row level security;

-- Privilegios además de RLS: sin GRANT no hay acceso aunque la policy permita.
revoke all on public.custody_integrity_cases               from public, anon, authenticated;
revoke all on public.custody_integrity_decisions           from public, anon, authenticated;
revoke all on public.custody_integrity_inspection_evidence from public, anon, authenticated;
grant select on public.custody_integrity_cases               to authenticated;
grant select on public.custody_integrity_decisions           to authenticated;
grant select on public.custody_integrity_inspection_evidence to authenticated;

drop policy if exists "custody_integrity_cases read" on public.custody_integrity_cases;
create policy "custody_integrity_cases read" on public.custody_integrity_cases
  for select to authenticated
  using (
    coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
    or client_id = public.current_client_id()
  );

drop policy if exists "custody_integrity_decisions read" on public.custody_integrity_decisions;
create policy "custody_integrity_decisions read" on public.custody_integrity_decisions
  for select to authenticated
  using (
    coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
    or client_id = public.current_client_id()
  );

drop policy if exists "custody_integrity_inspection read" on public.custody_integrity_inspection_evidence;
create policy "custody_integrity_inspection read" on public.custody_integrity_inspection_evidence
  for select to authenticated
  using (exists (
    select 1 from public.custody_integrity_decisions d
     where d.id = decision_id
       and (coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
            or d.client_id = public.current_client_id())
  ));

-- =========================================================================
-- 6) Creación/assessment ATÓMICOS
--    client_id derivado bajo lock; nunca recibido del caller.
-- =========================================================================
create or replace function public.upsert_custody_integrity_assessment(
  p_scope text,
  p_entity_id uuid,
  p_expected_version int,
  p_ingress_evidence_id uuid,
  p_egress_evidence_id uuid,
  p_state text,
  p_hold_reasons text[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_client uuid; v_case public.custody_integrity_cases; v_id uuid; v_rows int;
begin
  -- 🔴 R3-5.3 — NINGÚN hecho de evaluación o de cadena entra por parámetro.
  -- execution_mode, outcome, verdict, model_confidence, chain_status,
  -- chain_events_checked, chain_head y chain_attested_at sólo podrán escribirse
  -- desde una frontera server-side de verificación que todavía NO existe. Hasta
  -- entonces quedan NULL, y por lo tanto la liberación es estructuralmente
  -- imposible: `release` exige chain_status='verified' y outcome='ok'.
  if auth.uid() is null then
    raise exception 'sesión inexistente' using errcode = 'insufficient_privilege';
  end if;
  if not coalesce(public.has_permission('wms.edit'), false) then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;
  if p_state not in ('PENDING_EVIDENCE','REVIEW_REQUIRED') then
    raise exception 'estado no derivable' using errcode = 'check_violation';
  end if;

  if p_scope = 'packing_unit' then
    perform 1 from public.packing_units where id = p_entity_id for update;
  else
    perform 1 from public.shipments where id = p_entity_id for update;
  end if;
  v_client := public.custody_entity_client_id(p_scope, p_entity_id);
  if v_client is null then
    raise exception 'entidad sin client_id resuelto: no se crea el caso' using errcode = 'check_violation';
  end if;

  select * into v_case from public.custody_integrity_cases
   where coalesce(packing_unit_id, shipment_id) = p_entity_id
     and ingress_evidence_id is not distinct from p_ingress_evidence_id
     and egress_evidence_id  is not distinct from p_egress_evidence_id
   for update;

  if not found then
    insert into public.custody_integrity_cases (
      public_id, packing_unit_id, shipment_id, client_id, version, state, hold_reasons,
      ingress_evidence_id, egress_evidence_id
    ) values (
      'CINT-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.custody_integrity_case_short_id_seq')::text, 4, '0'),
      case when p_scope = 'packing_unit' then p_entity_id end,
      case when p_scope = 'shipment'     then p_entity_id end,
      v_client, 1, p_state, coalesce(p_hold_reasons, '{}'),
      p_ingress_evidence_id, p_egress_evidence_id
    ) returning id into v_id;
    return v_id;
  end if;

  if v_case.state in ('RELEASED','QUARANTINED') then
    raise exception 'caso ya decidido' using errcode = 'unique_violation';
  end if;
  if p_expected_version is null or p_expected_version <= 0 or v_case.version <> p_expected_version then
    raise exception 'conflicto de versión' using errcode = 'serialization_failure';
  end if;

  update public.custody_integrity_cases
     set state = p_state, hold_reasons = coalesce(p_hold_reasons,'{}'),
         version = v_case.version + 1, updated_at = now()
   where id = v_case.id and version = p_expected_version
   returning id into v_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'assessment no aplicado' using errcode = 'serialization_failure';
  end if;
  return v_id;
end;
$$;

revoke all on function public.upsert_custody_integrity_assessment(text,uuid,int,uuid,uuid,text,text[]) from public, anon, authenticated;
grant execute on function public.upsert_custody_integrity_assessment(text,uuid,int,uuid,uuid,text,text[]) to authenticated;

-- =========================================================================
-- 7) RPC transaccional de decisión — única vía a un estado terminal
-- =========================================================================
create or replace function public.decide_custody_integrity(
  p_case_id uuid,
  p_expected_version int,
  p_decision text,
  p_reason text,
  p_observations text default null,
  p_inspection_evidence_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.custody_integrity_cases;
  v_role text; v_new_state text; v_decision_id uuid; v_evidence uuid;
  v_session uuid; v_entity uuid; v_rows int; v_updated uuid;
begin
  -- 🔴 R3-5.1 — RAMA RELEASE DESHABILITADA INCONDICIONALMENTE.
  -- Faltan dos dependencias reales y ninguna se sustituye con una suposición:
  --   (a) un valor canónico de `custody_event_type_t` para inspección humana;
  --   (b) una RPC que produzca la atestación de cadena (scope, entity_id,
  --       chain_head, attested_at, events_checked, verified_event_ids).
  -- Mientras falten, liberar sería afirmar lo que no se puede acreditar.
  -- La CUARENTENA sigue permitida: retener no requiere esas garantías.
  if p_decision = 'release' then
    raise exception
      'LIBERACIÓN DESHABILITADA: faltan el tipo canónico de evidencia de inspección '
      'humana y la RPC de atestación de cadena. Decisión de esquema pendiente.'
      using errcode = 'feature_not_supported';
  end if;
  -- 1. Sesión y permiso NULL-SAFE.
  if auth.uid() is null then
    raise exception 'sesión inexistente' using errcode = 'insufficient_privilege';
  end if;
  if not coalesce(public.has_permission('wms.custody.decide'), false) then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;
  v_role := public.current_role();
  if v_role is null then
    raise exception 'rol no asignado' using errcode = 'insufficient_privilege';
  end if;

  -- 2. session_id REAL desde el JWT ya validado por la plataforma, comprobado
  --    contra auth.sessions. NO se usa un GUC individual (`request.jwt.claim.*`)
  --    cuya presencia no está demostrada por el entorno real, ni auth.uid() como
  --    sustituto: una sesión no acreditada no decide.
  v_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if v_session is null then
    raise exception 'sesión no acreditada en el token' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from auth.sessions s where s.id = v_session and s.user_id = auth.uid()) then
    raise exception 'sesión inválida para el usuario' using errcode = 'insufficient_privilege';
  end if;

  -- 3. Forma del comando.
  if p_decision not in ('release','quarantine') then
    raise exception 'decisión inválida' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'motivo insuficiente' using errcode = 'check_violation';
  end if;
  if p_expected_version is null or p_expected_version <= 0 then
    raise exception 'versión esperada inválida' using errcode = 'check_violation';
  end if;

  -- 4. Lock + CAS.
  select * into c from public.custody_integrity_cases where id = p_case_id for update;
  if not found then raise exception 'caso inexistente' using errcode = 'no_data_found'; end if;
  if c.decision_id is not null or c.state in ('RELEASED','QUARANTINED') then
    raise exception 'caso ya decidido' using errcode = 'unique_violation';
  end if;
  if c.state <> 'REVIEW_REQUIRED' then
    raise exception 'estado no decidible: %', c.state using errcode = 'check_violation';
  end if;
  if c.version <> p_expected_version then
    raise exception 'conflicto de versión' using errcode = 'serialization_failure';
  end if;
  if v_role not in ('admin','operaciones','supervisor')
     and public.current_client_id() is distinct from c.client_id then
    raise exception 'cliente ajeno' using errcode = 'insufficient_privilege';
  end if;

  v_new_state := case when p_decision = 'release' then 'RELEASED' else 'QUARANTINED' end;
  v_entity := coalesce(c.packing_unit_id, c.shipment_id);

  -- 5. Política conservadora de liberación (espejo de release-policy.ts).
  if p_decision = 'release' then
    if not (c.hold_reasons @> array['NO_CALIBRATED_THRESHOLD']
            and array_length(c.hold_reasons,1) = 1) then
      raise exception 'liberación bloqueada: retenciones distintas de NO_CALIBRATED_THRESHOLD'
        using errcode = 'check_violation';
    end if;
    if c.chain_status is distinct from 'verified' or coalesce(c.chain_events_checked,0) <= 0
       or c.chain_head is null or c.chain_attested_at is null then
      raise exception 'liberación bloqueada: cadena no verificada' using errcode = 'check_violation';
    end if;
    -- R3-5.4/6: el head vigente NO lo aporta el caller. Se recomputa bajo el
    -- lock desde la cadena real y se compara con la atestación, junto con su
    -- antigüedad máxima.
    if c.chain_head is distinct from (
         select ev.row_hash from public.custody_events ev
          where coalesce(ev.packing_unit_id, ev.shipment_id) = v_entity
          order by ev.chain_seq desc limit 1
       ) then
      raise exception 'liberación bloqueada: la cadena avanzó desde la atestación'
        using errcode = 'check_violation';
    end if;
    if c.chain_attested_at is null or now() - c.chain_attested_at > interval '60 minutes' then
      raise exception 'liberación bloqueada: atestación de cadena vencida' using errcode = 'check_violation';
    end if;
    if c.outcome is distinct from 'ok' or c.execution_mode is distinct from 'real'
       or c.verdict is distinct from 'coincide'
       or c.model_confidence is null or c.model_confidence < 0 or c.model_confidence > 1 then
      raise exception 'liberación bloqueada: evaluación no apta' using errcode = 'check_violation';
    end if;
    if c.ingress_evidence_id is null or c.egress_evidence_id is null then
      raise exception 'liberación bloqueada: evidencias incompletas' using errcode = 'check_violation';
    end if;
    if coalesce(array_length(p_inspection_evidence_ids,1),0) = 0 then
      raise exception 'liberación bloqueada: sin evidencia de inspección' using errcode = 'check_violation';
    end if;
  end if;

  -- 6. Decisión append-only.
  insert into public.custody_integrity_decisions
    (case_id, decision, actor_user_id, actor_session_id, actor_role, client_id, permission,
     reason, observations, previous_state, new_state, case_version_at_decision, chain_head_at_decision)
  values
    (c.id, p_decision, auth.uid(), v_session, v_role, c.client_id, 'wms.custody.decide',
     btrim(p_reason), nullif(btrim(coalesce(p_observations,'')),''),
     c.state, v_new_state, c.version, c.chain_head)
  returning id into v_decision_id;

  -- 7. Evidencias de inspección, verificadas por el JOIN REAL.
  --    🔴 R3-5.7: mientras no exista el tipo canónico de inspección humana,
  --    NINGUNA fila de custody_evidence puede reinterpretarse como tal. Cuando
  --    el enum exista, este bloque deberá exigir además: par stage/eventType
  --    exacto de inspección, misma entidad y cliente, no redactada, y distinta
  --    de las evidencias de ingreso y egreso. Hoy es inalcanzable: la rama
  --    release aborta antes de llegar acá.
  foreach v_evidence in array coalesce(p_inspection_evidence_ids,'{}') loop
    if not exists (
      select 1
        from public.custody_evidence e
        join public.custody_events ev on ev.id = e.event_id
       where e.id = v_evidence
         and e.redacted = false
         and coalesce(ev.packing_unit_id, ev.shipment_id) = v_entity
    ) then
      raise exception 'evidencia de inspección ajena, inexistente o redactada' using errcode = 'check_violation';
    end if;
    insert into public.custody_integrity_inspection_evidence (decision_id, evidence_id)
    values (v_decision_id, v_evidence);
  end loop;

  -- 8. Cierre del caso. RETURNING + GET DIAGNOSTICS: si no afecta exactamente
  --    una fila, se aborta y la decisión NO queda huérfana (misma transacción).
  update public.custody_integrity_cases
     set state = v_new_state, decision_id = v_decision_id,
         version = c.version + 1, updated_at = now()
   where id = c.id and version = p_expected_version and decision_id is null
   returning id into v_updated;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 or v_updated is null then
    raise exception 'cierre del caso no aplicado; decisión revertida' using errcode = 'serialization_failure';
  end if;

  return v_decision_id;
end;
$$;

revoke all on function public.decide_custody_integrity(uuid,int,text,text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.decide_custody_integrity(uuid,int,text,text,text,uuid[]) to authenticated;

notify pgrst, 'reload schema';
