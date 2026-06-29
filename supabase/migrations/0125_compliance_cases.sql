-- 0125_compliance_cases.sql
-- Casos regulatorios: estado administrativo + nivel de riesgo + origen/confianza.
-- Semáforo (color) = computado en runtime (no se almacena como verdad).
-- DEPENDE de 0081 (compliance_alerts/compliance_documents).
-- GATING: aplicación manual por Dirección. NO ejecutar automáticamente.

-- 1) Casos regulatorios -------------------------------------------------------
create table if not exists compliance_cases (
  id                     uuid primary key default gen_random_uuid(),
  item_id                text references compliance_items(id) on delete set null,
  sede                   text check (sede in ('MAGALDI','LUJAN')),
  tipo_certificado       text,
  expediente_nro         text,
  organismo              text,
  estado_administrativo  text not null default 'sin_iniciar'
                           check (estado_administrativo in
                           ('sin_iniciar','vigente','en_tramite','observado',
                            'pendiente_emision','aprobado','rechazado')),
  etapa                  text check (etapa in
                           ('iniciado','pronto_despacho','esperando_resolucion','subsanando')),
  nivel_riesgo           text check (nivel_riesgo in ('bajo','medio','alto','critico')),
  fecha_inicio           date,
  fecha_pronto_despacho  date,
  ultima_actuacion       text,
  ultima_actuacion_fecha date,
  proxima_accion         text,
  proxima_accion_fecha   date,
  observaciones          text,
  origen                 text not null default 'sheet'
                           check (origen in ('manual','sheet','documento','correo','ia','nombre_archivo')),
  confianza              text not null default 'confirmada'
                           check (confianza in ('confirmada','alta','media','baja')),
  confianza_score        numeric(4,3),
  activo                 boolean not null default true,
  row_hash               text,
  last_synced_at         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists compliance_cases_item_idx   on compliance_cases(item_id);
create index if not exists compliance_cases_activo_idx  on compliance_cases(item_id) where activo;
create index if not exists compliance_cases_estado_idx  on compliance_cases(estado_administrativo);
create index if not exists compliance_cases_riesgo_idx  on compliance_cases(nivel_riesgo);

alter table compliance_cases enable row level security;
drop policy if exists compliance_cases_select on compliance_cases;
create policy compliance_cases_select on compliance_cases
  for select to authenticated using (true);
-- Escritura sólo service_role (el cron) / admin: sin policy de insert/update/delete
-- para roles autenticados ⇒ denegado por RLS; service_role bypassa RLS.

-- 2) Config de anticipación (parametrizable, sin código) -----------------------
create table if not exists compliance_anticipacion_config (
  frecuencia        text primary key,
  anticipacion_dias int not null,
  descripcion       text,
  updated_at        timestamptz not null default now()
);
insert into compliance_anticipacion_config (frecuencia, anticipacion_dias, descripcion) values
  ('Mensual',     7,   'Aviso 7 días antes'),
  ('Trimestral',  15,  'Aviso 15 días antes'),
  ('Semestral',   30,  'Aviso 30 días antes'),
  ('Anual',       60,  'Aviso 60 días antes'),
  ('Bienal',      90,  'Aviso 90 días antes'),
  ('Trienal',     120, 'Aviso 120 días antes'),
  ('Cuatrienal',  180, 'Aviso 180 días antes'),
  ('__default__', 60,  'Default del sistema cuando la frecuencia no matchea')
on conflict (frecuencia) do nothing;

alter table compliance_anticipacion_config enable row level security;
drop policy if exists compliance_antic_select on compliance_anticipacion_config;
create policy compliance_antic_select on compliance_anticipacion_config
  for select to authenticated using (true);

-- 3) Diccionario de normalización (extensible por filas) -----------------------
create table if not exists compliance_normalizacion (
  id             bigserial primary key,
  dimension      text not null check (dimension in ('estado','etapa','riesgo')),
  sinonimo       text not null,
  valor_canonico text not null,
  unique (dimension, sinonimo)
);
insert into compliance_normalizacion (dimension, sinonimo, valor_canonico) values
  ('estado','en elaboracion','en_tramite'),
  ('estado','en analisis','en_tramite'),
  ('estado','en estudio','en_tramite'),
  ('estado','en proceso','en_tramite'),
  ('estado','en tramite','en_tramite'),
  ('estado','pendiente de resolucion','en_tramite'),
  ('estado','iniciado','en_tramite'),
  ('estado','abierto','en_tramite'),
  ('estado','en gestion','en_tramite'),
  ('estado','expediente abierto','en_tramite'),
  ('estado','pendiente de emision','pendiente_emision'),
  ('estado','pendiente emision','pendiente_emision'),
  ('estado','aprobado sin emitir','pendiente_emision'),
  ('estado','resolucion emitida sin certificado','pendiente_emision'),
  ('estado','a la firma','pendiente_emision'),
  ('estado','aprobado','aprobado'),
  ('estado','resuelto','aprobado'),
  ('estado','emitido','aprobado'),
  ('estado','finalizado','aprobado'),
  ('estado','otorgado','aprobado'),
  ('estado','favorable','aprobado'),
  ('estado','observado','observado'),
  ('estado','requerido','observado'),
  ('estado','con observaciones','observado'),
  ('estado','intimado','observado'),
  ('estado','a subsanar','observado'),
  ('estado','rechazado','rechazado'),
  ('estado','denegado','rechazado'),
  ('estado','desestimado','rechazado'),
  ('estado','archivado','rechazado'),
  ('estado','caducado','rechazado'),
  ('estado','vigente','vigente'),
  ('estado','en vigencia','vigente'),
  ('estado','al dia','vigente'),
  ('estado','sin iniciar','sin_iniciar'),
  ('estado','pendiente de inicio','sin_iniciar'),
  ('etapa','pronto despacho','pronto_despacho'),
  ('etapa','pronto despacho presentado','pronto_despacho'),
  ('etapa','esperando resolucion','esperando_resolucion'),
  ('etapa','elaboracion del proyecto de disposicion','esperando_resolucion'),
  ('etapa','presentado','iniciado'),
  ('etapa','subsanando','subsanando'),
  ('etapa','respondiendo observaciones','subsanando'),
  ('riesgo','bajo','bajo'),
  ('riesgo','medio','medio'),
  ('riesgo','alto','alto'),
  ('riesgo','critico','critico')
on conflict (dimension, sinonimo) do nothing;

alter table compliance_normalizacion enable row level security;
drop policy if exists compliance_norm_select on compliance_normalizacion;
create policy compliance_norm_select on compliance_normalizacion
  for select to authenticated using (true);

-- 4) Anticipación override por ítem -------------------------------------------
alter table compliance_items add column if not exists anticipacion_dias int;

-- 5) Alertas: origen/confianza/case_id + kind 'review' ------------------------
alter table compliance_alerts add column if not exists origen text
  check (origen in ('manual','sheet','documento','correo','ia','nombre_archivo'));
alter table compliance_alerts add column if not exists confianza text
  check (confianza in ('confirmada','alta','media','baja'));
alter table compliance_alerts add column if not exists case_id uuid
  references compliance_cases(id) on delete set null;

-- Extender el CHECK de kind (nombre-agnóstico: introspección).
do $$
declare cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'compliance_alerts'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%kind%';
  if cname is not null then
    execute format('alter table compliance_alerts drop constraint %I', cname);
  end if;
  alter table compliance_alerts add constraint compliance_alerts_kind_chk
    check (kind in ('expiration','missing_doc','audit_observation','regulatory_update','review'));
end $$;

-- Extender el CHECK de nivel para incluir 'info' (nombre-agnóstico: introspección).
do $$
declare cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'compliance_alerts'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%nivel%'
    and pg_get_constraintdef(con.oid) not ilike '%kind%';
  if cname is not null then
    execute format('alter table compliance_alerts drop constraint %I', cname);
  end if;
  alter table compliance_alerts add constraint compliance_alerts_nivel_chk
    check (nivel in ('critical','warning','ok','info'));
end $$;

-- 6) Evidencias: respaldo de cada cambio de estado (D12) ----------------------
create table if not exists compliance_evidence (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid references compliance_cases(id) on delete cascade,
  item_id            text references compliance_items(id) on delete set null,
  from_estado        text,
  to_estado          text not null,
  origen             text not null check (origen in ('manual','sheet','documento','correo','ia','nombre_archivo')),
  nivel_verificacion text not null check (nivel_verificacion in ('confirmada','alta','media','baja')),
  fecha_evidencia    date,
  document_id        uuid references compliance_documents(id) on delete set null,
  drive_file_id      text,
  url                text,
  titulo             text,
  descripcion        text,
  created_at         timestamptz not null default now()
);
create index if not exists compliance_evidence_case_idx on compliance_evidence(case_id);
create index if not exists compliance_evidence_item_idx on compliance_evidence(item_id);

alter table compliance_evidence enable row level security;
drop policy if exists compliance_evidence_select on compliance_evidence;
create policy compliance_evidence_select on compliance_evidence
  for select to authenticated using (true);
