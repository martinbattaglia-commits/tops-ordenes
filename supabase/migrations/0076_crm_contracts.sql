-- =========================================================================
-- 0076_crm_contracts — CRM Comercial · Módulo «Contratos» (Entregable 6 · Fase 6)
-- =========================================================================
-- Contexto:
--   Materializa el modelo de datos conceptual de la «Auditoría Contractual
--   Integral — Verotin S.A. / Logística TOPS» (corte 13/06/2026). Seis entidades:
--     · contracts            — entidad central (un registro por relación contractual)
--     · contract_amendments  — adendas, renovaciones, rescisiones, ajustes de canon
--     · contract_documents   — instrumentos vinculados a Google Drive (Fase 5)
--     · contract_alerts      — alertas del motor de vencimientos (90/60/30/15/7/vencido)
--     · contract_events      — bitácora de auditoría (log inmutable)
--     · contract_status      — catálogo de estados + color de semáforo
--
--   Integraciones previstas (Cap. 6.8): Drive (contract_documents.drive_file_id),
--   Clientify (contracts.client_id → public.clients) y facturación (conciliación
--   canon). La sincronización con Drive NO se implementa aquí — sólo el esquema.
--
-- RBAC:
--   Acceso de staff interno (admin/supervisor/operaciones) sobre toda la cartera,
--   consistente con el patrón de las demás tablas internas. No introduce slugs de
--   permiso nuevos (no altera el RBAC existente). El catálogo contract_status es
--   legible por cualquier usuario autenticado.
--
-- Notas:
--   · Idempotente: enums con guarda `duplicate_object`; tablas/índices `if not exists`.
--   · NO aplicada a producción desde esta sesión (esperar aprobación de Dirección).
--   · La carga inicial de los 45 contratos auditados va en el seed acompañante
--     (supabase/seed/0076_contracts_audit_seed.sql), también pendiente de aplicar.
-- =========================================================================

-- ---- Enums (vocabularios controlados) -----------------------------------
do $$ begin create type contract_tipo_t as enum ('ANMAT','Cargas Generales'); exception when duplicate_object then null; end $$;
do $$ begin create type contract_moneda_t as enum ('ARS','USD'); exception when duplicate_object then null; end $$;
do $$ begin create type contract_riesgo_t as enum ('Bajo','Medio','Alto','Crítico'); exception when duplicate_object then null; end $$;
do $$ begin create type contract_semaforo_t as enum ('Verde','Amarillo','Naranja','Rojo','Negro','Gris','Azul'); exception when duplicate_object then null; end $$;
do $$ begin create type contract_modalidad_t as enum ('exclusivo','compartido','racks','por_tonelada'); exception when duplicate_object then null; end $$;
do $$ begin create type contract_ajuste_frecuencia_t as enum ('mensual','trimestral','semestral','anual','condicionado'); exception when duplicate_object then null; end $$;
do $$ begin create type contract_amendment_tipo_t as enum ('adenda','renovacion','rescision','actualizacion_canon','prorroga'); exception when duplicate_object then null; end $$;
do $$ begin create type contract_doc_tipo_t as enum ('contrato','adenda','condiciones','propuesta','acuse','carta_documento','rescision','nosis'); exception when duplicate_object then null; end $$;
do $$ begin create type contract_alert_nivel_t as enum ('90','60','30','15','7','vencido','permanente'); exception when duplicate_object then null; end $$;
do $$ begin create type contract_alert_estado_t as enum ('pendiente','enviada','atendida','descartada'); exception when duplicate_object then null; end $$;
do $$ begin create type contract_event_tipo_t as enum ('alta','firma','renovacion','ajuste','alerta','nota','rescision','cobro'); exception when duplicate_object then null; end $$;

-- ---- Catálogo de estados + color de semáforo ----------------------------
create table if not exists public.contract_status (
  id     text primary key,                 -- código del estado (FK desde contracts.estado)
  nombre text not null,                     -- etiqueta legible
  color  text not null,                     -- color de semáforo asociado (hex)
  orden  int  not null default 100          -- prioridad de visualización
);

insert into public.contract_status (id, nombre, color, orden) values
  ('Vigente',                'Vigente',                  '#1F9D55', 10),
  ('Vigente-Indet',          'Vigente (plazo indet.)',   '#2E6FB0', 20),
  ('Renov-No-Instrumentada', 'Renovación no instrumentada','#E0B400', 30),
  ('En-Conflicto',           'En conflicto',             '#E07A1F', 40),
  ('En-Litigio',             'En litigio',               '#D14343', 50),
  ('Incierto',               'Incierto',                 '#8A94A6', 60),
  ('Sin-Instrumento',        'Sin instrumento',          '#33373D', 70),
  ('Rescindido',             'Rescindido',               '#33373D', 80)
on conflict (id) do update
  set nombre = excluded.nombre, color = excluded.color, orden = excluded.orden;

-- ---- Entidad central: contracts -----------------------------------------
create sequence if not exists public.contracts_public_seq;

create table if not exists public.contracts (
  id                    uuid primary key default gen_random_uuid(),
  public_id             text unique,                                 -- CTR-AAAA-NNNN (trigger)
  client_id             uuid references public.clients(id) on delete set null,
  tipo                  contract_tipo_t not null,
  razon_social          text not null,
  cuit                  text,
  contraparte_tops      text not null default 'VEROTIN S.A.',
  deposito              text,                                        -- sede (Magaldi / Luján)
  ubicacion             text,                                        -- unidad/depósito detallado
  m2                    numeric(10,2),
  modalidad             contract_modalidad_t,
  canon                 numeric(15,2),
  moneda                contract_moneda_t not null default 'ARS',
  canon_desactualizado  boolean not null default false,             -- canon a valor histórico
  ajuste                text,                                        -- texto crudo («CEDOL trimestral»)
  ajuste_indice         text,                                        -- índice («CEDOL» | «IPCBA»)
  ajuste_frecuencia     contract_ajuste_frecuencia_t,
  fecha_firma           date,
  fecha_inicio          date,
  fecha_fin             date,                                        -- vencimiento (null = indeterminado)
  plazo_meses           int,
  preaviso_dias         int,
  renovacion_automatica boolean not null default false,
  max_periodos          int,
  estado                text not null references public.contract_status(id),
  riesgo                contract_riesgo_t not null default 'Medio',
  semaforo              contract_semaforo_t not null default 'Verde',
  hallazgos             text,
  recomendacion         text,
  penalidad             text,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) on delete set null,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id) on delete set null
);

create index if not exists contracts_tipo_idx     on public.contracts (tipo);
create index if not exists contracts_estado_idx    on public.contracts (estado);
create index if not exists contracts_riesgo_idx    on public.contracts (riesgo);
create index if not exists contracts_client_idx    on public.contracts (client_id);
create index if not exists contracts_fecha_fin_idx on public.contracts (fecha_fin);

-- ---- contract_amendments (adendas / renovaciones / rescisiones) ---------
create table if not exists public.contract_amendments (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  tipo            contract_amendment_tipo_t not null,
  fecha           date,
  vigencia_desde  date,
  campo_modificado text,
  valor_anterior  text,
  valor_nuevo     text,
  documento_id    uuid,                                             -- FK lógica → contract_documents
  detalle         text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null
);
create index if not exists contract_amendments_contract_idx on public.contract_amendments (contract_id);

-- ---- contract_documents (instrumentos vinculados a Drive) ---------------
create table if not exists public.contract_documents (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.contracts(id) on delete cascade,
  tipo_doc      contract_doc_tipo_t not null,
  titulo        text not null,
  drive_file_id text,                                               -- arquitectura Drive (Fase 5)
  url           text,
  fecha         date,
  firmado       boolean not null default false,
  hash_firma    text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);
create index if not exists contract_documents_contract_idx on public.contract_documents (contract_id);

-- ---- contract_alerts (motor de vencimientos) ----------------------------
create table if not exists public.contract_alerts (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.contracts(id) on delete cascade,
  nivel         contract_alert_nivel_t not null,
  fecha_disparo date,
  estado        contract_alert_estado_t not null default 'pendiente',
  destinatario  text,                                               -- rol responsable
  canal         text,                                               -- email | CRM | WhatsApp
  created_at    timestamptz not null default now()
);
create index if not exists contract_alerts_contract_idx on public.contract_alerts (contract_id);
create index if not exists contract_alerts_pend_idx on public.contract_alerts (estado) where estado = 'pendiente';

-- ---- contract_events (bitácora de auditoría inmutable) ------------------
create table if not exists public.contract_events (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.contracts(id) on delete cascade,
  tipo_evento  contract_event_tipo_t not null,
  fecha        timestamptz not null default now(),
  usuario      uuid references auth.users(id) on delete set null,
  detalle      text
);
create index if not exists contract_events_contract_idx on public.contract_events (contract_id, fecha desc);

-- ---- Trigger: public_id + updated_at en contracts -----------------------
create or replace function public.tg_contracts_set_public_id()
returns trigger language plpgsql as $$
begin
  if new.public_id is null or new.public_id = '' then
    new.public_id := 'CTR-' || to_char(coalesce(new.created_at, now()), 'YYYY')
                     || '-' || lpad(nextval('public.contracts_public_seq')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_contracts_public_id on public.contracts;
create trigger trg_contracts_public_id
  before insert on public.contracts
  for each row execute function public.tg_contracts_set_public_id();

drop trigger if exists trg_contracts_touch on public.contracts;
create trigger trg_contracts_touch
  before update on public.contracts
  for each row execute function public.tg_touch_updated_at();

-- ---- RLS ----------------------------------------------------------------
alter table public.contracts           enable row level security;
alter table public.contract_amendments enable row level security;
alter table public.contract_documents  enable row level security;
alter table public.contract_alerts     enable row level security;
alter table public.contract_events     enable row level security;
alter table public.contract_status     enable row level security;

-- Catálogo: lectura para cualquier autenticado; escritura sólo staff.
drop policy if exists "contract_status read" on public.contract_status;
create policy "contract_status read" on public.contract_status
  for select to authenticated using (true);
drop policy if exists "contract_status write" on public.contract_status;
create policy "contract_status write" on public.contract_status
  for all to authenticated
  using (public.current_role() in ('admin','supervisor','operaciones'))
  with check (public.current_role() in ('admin','supervisor','operaciones'));

-- Tablas operativas: staff interno ve y administra toda la cartera.
do $$
declare t text;
begin
  foreach t in array array[
    'contracts','contract_amendments','contract_documents','contract_alerts','contract_events'
  ] loop
    -- `create policy` no admite IF NOT EXISTS → drop previo para idempotencia.
    execute format('drop policy if exists "%1$s read" on public.%1$s', t);
    execute format($f$
      create policy "%1$s read" on public.%1$s
        for select to authenticated
        using (public.current_role() in ('admin','supervisor','operaciones'));
    $f$, t);
    execute format('drop policy if exists "%1$s write" on public.%1$s', t);
    execute format($f$
      create policy "%1$s write" on public.%1$s
        for all to authenticated
        using (public.current_role() in ('admin','supervisor','operaciones'))
        with check (public.current_role() in ('admin','supervisor','operaciones'));
    $f$, t);
  end loop;
end $$;

-- ---- Grants -------------------------------------------------------------
grant select, insert, update, delete on
  public.contracts, public.contract_amendments, public.contract_documents,
  public.contract_alerts, public.contract_events, public.contract_status
  to authenticated;
grant usage on sequence public.contracts_public_seq to authenticated;

-- =========================================================================
-- Verificación (correr post-migración):
--   select count(*) from public.contract_status;          -- 8 estados
--   select tablename from pg_tables where tablename like 'contract%';
--   select polname, tablename from pg_policies where tablename like 'contract%';
-- =========================================================================
