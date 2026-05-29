-- =========================================================================
-- TOPS NEXUS — Facturación Electrónica ARCA (ex-AFIP)
-- Régimen de Comprobantes Electrónicos / WSFEv1 (FECAE)
-- Emisor: VEROTIN S.A. · CUIT 33-60489698-9 · Responsable Inscripto
--
-- NO genera PDFs arbitrarios: cada comprobante nace BORRADOR, se valida,
-- se solicita CAE a ARCA (sandbox/mock hasta tener credenciales), se sella
-- con CAE + QR fiscal y recién entonces se materializa el PDF.
-- Aplicar DESPUÉS de 0001-0010.
-- =========================================================================

-- ---- Enums --------------------------------------------------------------
do $$ begin
  create type condicion_iva_t as enum (
    'RESPONSABLE_INSCRIPTO',
    'MONOTRIBUTO',
    'EXENTO',
    'CONSUMIDOR_FINAL',
    'NO_RESPONSABLE',
    'NO_CATEGORIZADO'
  );
exception when duplicate_object then null; end $$;

-- Tipo de comprobante legible. El código numérico ARCA (cbte_tipo_arca)
-- se guarda aparte para el web service.
do $$ begin
  create type comprobante_tipo_t as enum (
    'FACTURA_A','NOTA_DEBITO_A','NOTA_CREDITO_A',
    'FACTURA_B','NOTA_DEBITO_B','NOTA_CREDITO_B',
    'FACTURA_C','NOTA_DEBITO_C','NOTA_CREDITO_C',
    'FACTURA_E'
  );
exception when duplicate_object then null; end $$;

-- Estados del ciclo de vida fiscal del comprobante.
do $$ begin
  create type invoice_arca_status_t as enum (
    'BORRADOR',
    'PENDIENTE_ARCA',
    'ENVIADO_ARCA',
    'AUTORIZADO_ARCA',
    'RECHAZADO_ARCA',
    'ERROR_ARCA',
    'ANULADO'
  );
exception when duplicate_object then null; end $$;

-- Ambiente de conexión con ARCA.
do $$ begin
  create type arca_ambiente_t as enum ('SANDBOX','HOMOLOGACION','PRODUCCION');
exception when duplicate_object then null; end $$;

-- Tipo de punto de venta (web service vs controlador fiscal vs manual).
do $$ begin
  create type punto_venta_tipo_t as enum ('WEBSERVICE','CONTROLADOR_FISCAL','MANUAL');
exception when duplicate_object then null; end $$;

-- ---- clients: campos fiscales -------------------------------------------
-- Necesarios para emitir A/B/C según condición del receptor.
alter table public.clients
  add column if not exists condicion_iva condicion_iva_t not null default 'RESPONSABLE_INSCRIPTO',
  add column if not exists tipo_doc smallint not null default 80,  -- 80 = CUIT (tabla ARCA)
  add column if not exists localidad text;

-- =========================================================================
-- fiscal_config — configuración fiscal de la empresa (singleton)
-- Toda la data fiscal vive acá; NUNCA hardcodeada en código.
-- =========================================================================
create table if not exists public.fiscal_config (
  id smallint primary key default 1 check (id = 1),
  razon_social text not null,
  nombre_fantasia text,
  cuit text not null,
  ingresos_brutos text,
  inicio_actividades date,
  domicilio_comercial text,
  localidad text,
  provincia text,
  condicion_iva condicion_iva_t not null default 'RESPONSABLE_INSCRIPTO',
  -- Ambiente activo de ARCA. SANDBOX = mock local sin tocar AFIP.
  ambiente arca_ambiente_t not null default 'SANDBOX',
  -- Alias / referencia del certificado X.509 (la key vive en el host, jamás acá).
  cert_alias text,
  -- Punto de venta usado por defecto al emitir.
  default_punto_venta int,
  logo_url text,
  pie_legal text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- Seed VEROTIN S.A. (editable desde /settings/fiscal).
insert into public.fiscal_config (
  id, razon_social, nombre_fantasia, cuit, ingresos_brutos, inicio_actividades,
  domicilio_comercial, localidad, provincia, condicion_iva, ambiente,
  default_punto_venta, pie_legal
) values (
  1,
  'VEROTIN S.A.',
  'Logística TOPS',
  '33-60489698-9',
  '646677-10',
  '1985-03-01',
  'Agustín Magaldi 1765',
  'Ciudad Autónoma de Buenos Aires',
  'CABA',
  'RESPONSABLE_INSCRIPTO',
  'SANDBOX',
  2,
  'No abonándose esta factura a su vencimiento devengará intereses punitorios a razón de la tasa bancaria actual. Cualquier reclamo u observación deberá efectuarse por escrito dentro de los 5 días hábiles de la fecha de recepción.'
) on conflict (id) do nothing;

-- =========================================================================
-- puntos_venta — administración de múltiples puntos de venta
-- =========================================================================
create table if not exists public.puntos_venta (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique,
  descripcion text not null,
  tipo punto_venta_tipo_t not null default 'WEBSERVICE',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.puntos_venta (numero, descripcion, tipo, activo) values
  (2, 'Casa Central — Magaldi', 'CONTROLADOR_FISCAL', true),
  (3, 'Web Service — Nexus', 'WEBSERVICE', true)
on conflict (numero) do nothing;

-- =========================================================================
-- customer_invoices — comprobantes electrónicos
-- =========================================================================
create table if not exists public.customer_invoices (
  id uuid primary key default gen_random_uuid(),

  -- Receptor (snapshot al momento de emitir — el cliente puede cambiar luego)
  client_id uuid references public.clients(id) on delete restrict,
  cuit_cliente text,
  razon_social text not null,
  condicion_iva condicion_iva_t not null default 'RESPONSABLE_INSCRIPTO',
  domicilio_cliente text,
  doc_tipo smallint not null default 80,   -- tabla ARCA: 80 CUIT, 86 CUIL, 96 DNI, 99 CF

  -- Identificación del comprobante
  tipo_comprobante comprobante_tipo_t not null default 'FACTURA_A',
  cbte_tipo_arca smallint not null default 1,  -- código numérico ARCA (1=FA A)
  concepto smallint not null default 2,        -- 1 prod, 2 serv, 3 ambos
  punto_venta int not null,
  numero_comprobante bigint,                   -- asignado al obtener CAE

  -- Fechas de servicio (obligatorias para concepto 2/3)
  fch_serv_desde date,
  fch_serv_hasta date,
  fch_vto_pago date,
  periodo text,                                -- '2026-05' para facturación mensual

  -- CAE / autorización fiscal
  cae text,
  fecha_vencimiento_cae date,
  fecha_autorizacion_arca timestamptz,

  -- QR fiscal (RG 4892/2020)
  qr_data text,    -- JSON crudo codificado en el QR
  qr_url text,     -- URL https://www.afip.gob.ar/fe/qr/?p=<base64>
  qr_hash text,    -- sha256 del payload (verificación futura)

  -- Importes (numeric para precisión fiscal)
  subtotal numeric(15,2) not null default 0,   -- neto gravado
  importe_no_gravado numeric(15,2) not null default 0,
  importe_exento numeric(15,2) not null default 0,
  iva numeric(15,2) not null default 0,
  percepciones numeric(15,2) not null default 0,
  tributos numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0,
  moneda text not null default 'PES',
  cotizacion numeric(15,6) not null default 1,

  -- Estado fiscal + trazabilidad request/response ARCA
  estado_arca invoice_arca_status_t not null default 'BORRADOR',
  request_arca jsonb,
  response_arca jsonb,
  ambiente arca_ambiente_t not null default 'SANDBOX',
  error_msg text,

  -- NC/ND: comprobante asociado al que anulan/ajustan
  comprobante_asociado_id uuid references public.customer_invoices(id) on delete set null,
  anulada boolean not null default false,      -- anulación lógica interna

  -- PDF materializado
  pdf_bucket text,
  pdf_path text,
  pdf_url text,

  observ text,
  emitido_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Numeración secuencial por (PtoVta, TipoCbte) — sólo cuando hay número asignado
  unique (punto_venta, cbte_tipo_arca, numero_comprobante)
);

create index if not exists customer_invoices_client_idx on public.customer_invoices(client_id);
create index if not exists customer_invoices_estado_idx on public.customer_invoices(estado_arca);
create index if not exists customer_invoices_periodo_idx on public.customer_invoices(periodo);
create index if not exists customer_invoices_fecha_idx on public.customer_invoices(created_at desc);
create index if not exists customer_invoices_cae_idx on public.customer_invoices(cae);

-- =========================================================================
-- invoice_items — renglones del comprobante
-- =========================================================================
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.customer_invoices(id) on delete cascade,
  -- Orden de servicio consolidada (opcional — facturación desde OS firmadas)
  order_id uuid references public.orders(id) on delete set null,
  descripcion text not null,
  cantidad numeric(12,2) not null default 1,
  precio_unitario numeric(15,2) not null default 0,
  alicuota_iva numeric(5,2) not null default 21,   -- 0 / 10.5 / 21 / 27
  alic_iva_id smallint not null default 5,          -- ARCA: 3=0, 4=10.5, 5=21, 6=27
  importe_neto numeric(15,2) not null default 0,
  importe_iva numeric(15,2) not null default 0,
  importe_total numeric(15,2) not null default 0,
  orden int not null default 0
);
create index if not exists invoice_items_invoice_idx on public.invoice_items(invoice_id);
create index if not exists invoice_items_order_idx on public.invoice_items(order_id);

-- =========================================================================
-- invoice_audit — auditoría fiscal append-only
-- Registra usuario, fecha/hora, request, response, CAE, estado.
-- =========================================================================
create table if not exists public.invoice_audit (
  id bigserial primary key,
  invoice_id uuid references public.customer_invoices(id) on delete cascade,
  ts timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,            -- 'emitir' | 'solicitar_cae' | 'autorizado' | 'rechazado' | 'error' | 'anular' | 'pdf'
  estado invoice_arca_status_t,
  cae text,
  request jsonb,
  response jsonb,
  ip text
);
create index if not exists invoice_audit_invoice_idx on public.invoice_audit(invoice_id, ts desc);

-- ---- orders: vínculo a la factura emitida --------------------------------
alter table public.orders
  add column if not exists invoice_id uuid references public.customer_invoices(id) on delete set null;
create index if not exists orders_invoice_idx on public.orders(invoice_id);

-- =========================================================================
-- Guard: no permitir modificar comprobantes AUTORIZADOS
-- Sólo se permite pasar a ANULADO (anulación lógica) o tocar el PDF.
-- =========================================================================
create or replace function public.tg_lock_authorized_invoice()
returns trigger language plpgsql as $$
begin
  if old.estado_arca = 'AUTORIZADO_ARCA' then
    -- Permitido: anulación lógica, materializar PDF, marcar updated_at.
    if new.cae is distinct from old.cae
       or new.numero_comprobante is distinct from old.numero_comprobante
       or new.total is distinct from old.total
       or new.subtotal is distinct from old.subtotal
       or new.iva is distinct from old.iva
       or new.cbte_tipo_arca is distinct from old.cbte_tipo_arca
       or new.punto_venta is distinct from old.punto_venta
       or new.cuit_cliente is distinct from old.cuit_cliente then
      raise exception 'Comprobante AUTORIZADO por ARCA: no se pueden modificar datos fiscales. Emití una Nota de Crédito/Débito.';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customer_invoices_lock on public.customer_invoices;
create trigger customer_invoices_lock
  before update on public.customer_invoices
  for each row execute function public.tg_lock_authorized_invoice();

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.fiscal_config enable row level security;
alter table public.puntos_venta enable row level security;
alter table public.customer_invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_audit enable row level security;

-- fiscal_config: lectura interna, escritura admin.
drop policy if exists "fiscal_config read internal" on public.fiscal_config;
create policy "fiscal_config read internal"
  on public.fiscal_config for select
  using (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "fiscal_config write admin" on public.fiscal_config;
create policy "fiscal_config write admin"
  on public.fiscal_config for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- puntos_venta: lectura interna, escritura admin.
drop policy if exists "puntos_venta read internal" on public.puntos_venta;
create policy "puntos_venta read internal"
  on public.puntos_venta for select
  using (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "puntos_venta write admin" on public.puntos_venta;
create policy "puntos_venta write admin"
  on public.puntos_venta for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- customer_invoices: internos leen; admin/operaciones emiten.
drop policy if exists "invoices read internal" on public.customer_invoices;
create policy "invoices read internal"
  on public.customer_invoices for select
  using (
    public.current_role() in ('admin','operaciones','supervisor')
    or client_id = (select client_id from public.profiles where id = auth.uid())
  );
drop policy if exists "invoices write internal" on public.customer_invoices;
create policy "invoices write internal"
  on public.customer_invoices for all
  using (public.current_role() in ('admin','operaciones'))
  with check (public.current_role() in ('admin','operaciones'));

-- invoice_items: siguen la regla de la factura.
drop policy if exists "invoice_items read" on public.invoice_items;
create policy "invoice_items read"
  on public.invoice_items for select
  using (exists (select 1 from public.customer_invoices i where i.id = invoice_id));
drop policy if exists "invoice_items write internal" on public.invoice_items;
create policy "invoice_items write internal"
  on public.invoice_items for all
  using (public.current_role() in ('admin','operaciones'))
  with check (public.current_role() in ('admin','operaciones'));

-- invoice_audit: append-only. Lectura admin/supervisor, insert interno.
drop policy if exists "invoice_audit read admin" on public.invoice_audit;
create policy "invoice_audit read admin"
  on public.invoice_audit for select
  using (public.current_role() in ('admin','supervisor'));
drop policy if exists "invoice_audit insert internal" on public.invoice_audit;
create policy "invoice_audit insert internal"
  on public.invoice_audit for insert
  with check (public.current_role() in ('admin','operaciones'));

-- Realtime sobre facturas (el frontend escucha cambios de estado).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.customer_invoices;
  end if;
exception when duplicate_object then null; end $$;

-- Bucket privado para PDFs fiscales (URLs firmadas en F3).
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists "invoices bucket internal" on storage.objects;
create policy "invoices bucket internal"
  on storage.objects for all
  using (bucket_id = 'invoices' and auth.role() = 'authenticated')
  with check (bucket_id = 'invoices' and auth.role() = 'authenticated');

notify pgrst, 'reload schema';
