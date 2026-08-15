-- =========================================================================
-- 0243 · Órdenes de compra — precio conocido / estimado / pendiente
--
-- Reglas:
--   · pendiente se representa como NULL, nunca como cero;
--   · estimado y pendiente requieren motivo y responsable;
--   · neto/iva/total contienen sólo importes reales (conocidos o conciliados);
--   · planning_* contiene la estimación explícita y nunca existe si hay pendientes;
--   · la conciliación conserva el valor emitido, el real y su diferencia;
--   · po_price_events es append-only.
-- =========================================================================

do $$ begin
  create type public.po_price_state_t as enum ('known', 'estimated', 'pending');
exception when duplicate_object then null; end $$;

alter table public.purchase_orders
  add column if not exists currency text not null default 'ARS',
  add column if not exists price_state public.po_price_state_t not null default 'known',
  add column if not exists planning_neto numeric(14,2),
  add column if not exists planning_iva numeric(14,2),
  add column if not exists planning_total numeric(14,2),
  add column if not exists known_partial_neto numeric(14,2) not null default 0,
  add column if not exists pending_price_lines integer not null default 0,
  add column if not exists price_reconciled_at timestamptz,
  add column if not exists price_reconciled_by uuid references auth.users(id) on delete set null,
  add column if not exists price_reconciled_invoice_id uuid references public.supplier_invoices(id) on delete restrict,
  add column if not exists price_reconciliation_reason text,
  add column if not exists issued_neto numeric(14,2),
  add column if not exists issued_iva numeric(14,2),
  add column if not exists issued_total numeric(14,2),
  add column if not exists vendor_snapshot jsonb,
  add column if not exists pdf_sha256 text,
  add column if not exists pdf_size_bytes integer;

alter table public.purchase_orders drop constraint if exists purchase_orders_pdf_evidence_ck;
alter table public.purchase_orders add constraint purchase_orders_pdf_evidence_ck check (
  (pdf_url is null and pdf_sha256 is null and pdf_size_bytes is null)
  or (
    pdf_url is not null and pdf_url !~ '[\r\n]'
    and pdf_sha256 ~ '^[a-f0-9]{64}$'
    and pdf_size_bytes between 100 and 5242880
  )
);

update public.purchase_orders po
set vendor_snapshot = jsonb_build_object(
  'id',v.id,'razon',v.razon,'cuit',v.cuit,'domicilio',v.domicilio,
  'telefono',v.telefono,'contacto',v.contacto,'email',v.email,
  'categoria',v.categoria,'cond_pago',v.cond_pago
)
from public.vendors v
where v.id=po.vendor_id and po.vendor_snapshot is null;

alter table public.purchase_orders drop constraint if exists purchase_orders_currency_ars_ck;
alter table public.purchase_orders add constraint purchase_orders_currency_ars_ck
  check (currency = 'ARS');

-- Una factura real sólo puede cerrar económicamente una OC.
create unique index if not exists po_price_reconciled_invoice_uq
  on public.purchase_orders(price_reconciled_invoice_id)
  where price_reconciled_invoice_id is not null;

-- Filas históricas: sus importes eran tratados como conocidos.
update public.purchase_orders
set planning_neto = coalesce(planning_neto, neto),
    planning_iva = coalesce(planning_iva, iva),
    planning_total = coalesce(planning_total, total),
    known_partial_neto = coalesce(neto, 0),
    issued_neto = coalesce(issued_neto, neto),
    issued_iva = coalesce(issued_iva, iva),
    issued_total = coalesce(issued_total, total)
where planning_total is null or issued_total is null;

alter table public.purchase_orders
  alter column neto drop not null,
  alter column iva drop not null,
  alter column total drop not null,
  alter column neto drop default,
  alter column iva drop default,
  alter column total drop default;

alter table public.po_items
  alter column price drop not null,
  alter column subtotal drop not null,
  add column if not exists price_state public.po_price_state_t not null default 'known',
  add column if not exists price_reason text,
  add column if not exists price_responsible_user_id uuid references auth.users(id) on delete set null,
  add column if not exists price_responsible_name text,
  add column if not exists actual_unit_price numeric(14,2),
  add column if not exists actual_subtotal numeric(14,2),
  add column if not exists price_reconciled_at timestamptz,
  add column if not exists price_reconciled_by uuid references auth.users(id) on delete set null;

alter table public.po_items drop constraint if exists po_items_price_semantics_ck;
alter table public.po_items add constraint po_items_price_semantics_ck check (
  case price_state
    when 'known' then price is not null and price >= 0 and subtotal is not null
    when 'estimated' then price is not null and price >= 0 and subtotal is not null
                          and length(btrim(coalesce(price_reason, ''))) >= 3
    when 'pending' then price is null and subtotal is null
                        and length(btrim(coalesce(price_reason, ''))) >= 3
  end
);

alter table public.po_items drop constraint if exists po_items_price_subtotal_ck;
alter table public.po_items add constraint po_items_price_subtotal_ck check (
  price is null or abs(subtotal - round(qty * price, 2)) <= 0.01
);

alter table public.po_items drop constraint if exists po_items_actual_price_ck;
alter table public.po_items add constraint po_items_actual_price_ck check (
  (actual_unit_price is null and actual_subtotal is null and price_reconciled_at is null)
  or
  (actual_unit_price is not null and actual_unit_price >= 0
   and actual_subtotal is not null
   and abs(actual_subtotal - round(qty * actual_unit_price, 2)) <= 0.01
   and price_reconciled_at is not null)
);

create table if not exists public.po_price_events (
  id bigserial primary key,
  order_id uuid not null references public.purchase_orders(id) on delete restrict,
  item_id uuid references public.po_items(id) on delete restrict,
  ts timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null check (action in ('issued_known','issued_estimated','issued_pending','reconciled')),
  reason text,
  issued_state public.po_price_state_t,
  issued_unit_price numeric(14,2),
  actual_unit_price numeric(14,2),
  delta_unit_price numeric(14,2),
  supplier_invoice_id uuid references public.supplier_invoices(id) on delete restrict,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists po_price_events_order_idx on public.po_price_events(order_id, id);
create index if not exists po_price_events_item_idx on public.po_price_events(item_id, id);

alter table public.po_price_events enable row level security;
drop policy if exists "po_price_events read" on public.po_price_events;
create policy "po_price_events read" on public.po_price_events for select to authenticated
  using (coalesce(public.has_permission('compras.view'), false));

-- Las policies heredadas de 0008 exponían cabeceras, líneas y ledgers a
-- cualquier sesión autenticada. FASE A pasa a RBAC explícito y fail-closed.
drop policy if exists "po read" on public.purchase_orders;
create policy "po read" on public.purchase_orders for select to authenticated
  using (coalesce(public.has_permission('compras.view'), false));
drop policy if exists "po_items read" on public.po_items;
create policy "po_items read" on public.po_items for select to authenticated
  using (coalesce(public.has_permission('compras.view'), false));
-- La policy heredada FOR ALL también autorizaba SELECT de forma permisiva.
-- El DML directo se revoca más abajo y esta policy debe salir para que no
-- eluda la nueva frontera explícita de lectura.
drop policy if exists "po_items write" on public.po_items;
drop policy if exists "po_events read" on public.po_events;
create policy "po_events read" on public.po_events for select to authenticated
  using (coalesce(public.has_permission('compras.view'), false));
drop policy if exists "po_email read" on public.po_email_sends;
create policy "po_email read" on public.po_email_sends for select to authenticated
  using (coalesce(public.has_permission('compras.view'), false));
drop policy if exists "po_email write" on public.po_email_sends;

create or replace function public._po_price_events_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Los eventos de precio de OC son inmutables (append-only)';
end;
$$;
drop trigger if exists trg_po_price_events_immutable on public.po_price_events;
create trigger trg_po_price_events_immutable
before update or delete on public.po_price_events
for each row execute function public._po_price_events_immutable();

create table if not exists public.po_signature_evidence (
  order_id uuid primary key references public.purchase_orders(id) on delete restrict,
  png bytea not null check (octet_length(png) between 67 and 524288),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

drop trigger if exists trg_po_signature_evidence_immutable on public.po_signature_evidence;
create trigger trg_po_signature_evidence_immutable
before update or delete on public.po_signature_evidence
for each row execute function public._po_price_events_immutable();

create or replace function public._po_events_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Los eventos de OC son inmutables (append-only)';
end;
$$;
drop trigger if exists trg_po_events_immutable on public.po_events;
create trigger trg_po_events_immutable
before update or delete on public.po_events
for each row execute function public._po_events_immutable();

-- Cada intento de email tiene una clave estable generada por el backend. Las
-- filas históricas quedan con NULL; las nuevas son idempotentes por OC+clave.
alter table public.po_email_sends
  add column if not exists attempt_key text;
alter table public.po_email_sends
  drop constraint if exists po_email_attempt_key_ck,
  add constraint po_email_attempt_key_ck check (
    attempt_key is null or (length(attempt_key) between 1 and 256 and attempt_key !~ '[\r\n]')
  );
create unique index if not exists po_email_order_attempt_uq
  on public.po_email_sends(order_id, attempt_key)
  where attempt_key is not null;

create or replace function public._po_email_sends_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op='DELETE' then
    raise exception 'La evidencia de email de OC no se elimina';
  end if;
  if coalesce(current_setting('po.email_delivery', true), 'off') <> 'on' then
    raise exception 'La evidencia de email sólo cambia mediante su RPC';
  end if;
  if row(new.id,new.order_id,new.to_email,new.tag,new.attempt_key)
     is distinct from row(old.id,old.order_id,old.to_email,old.tag,old.attempt_key) then
    raise exception 'La identidad del intento de email es inmutable';
  end if;
  if old.status='queued' and new.status in ('sent','failed','unknown') then
    return new;
  end if;
  if old.status='unknown' and new.status in ('sent','failed') then
    return new;
  end if;
  if old.status='unknown' and new.status='unknown'
     and new.provider_id is null and new.sent_at is null
     and new.opened_at is not distinct from old.opened_at then
    return new;
  end if;
  if old.status=new.status
     and new.provider_id is not distinct from old.provider_id
     and new.error is not distinct from old.error
     and new.sent_at is not distinct from old.sent_at
     and new.opened_at is not distinct from old.opened_at then
    return new;
  end if;
  raise exception 'Transición de evidencia de email inválida';
end;
$$;
drop trigger if exists trg_po_email_sends_guard on public.po_email_sends;
create trigger trg_po_email_sends_guard
before update or delete on public.po_email_sends
for each row execute function public._po_email_sends_guard();

create or replace function public._po_items_price_prepare()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.price_state = 'pending' then
    new.price := null;
    new.subtotal := null;
  else
    new.subtotal := round(new.qty * new.price, 2);
  end if;
  if new.price_state <> 'known' then
    new.price_responsible_user_id := coalesce(new.price_responsible_user_id, auth.uid());
    new.price_responsible_name := coalesce(
      nullif(btrim(new.price_responsible_name), ''),
      nullif(auth.jwt() ->> 'email', ''),
      'usuario autenticado'
    );
  end if;
  return new;
end;
$$;
drop trigger if exists trg_po_items_price_prepare on public.po_items;
create trigger trg_po_items_price_prepare
before insert on public.po_items
for each row execute function public._po_items_price_prepare();

create or replace function public._po_items_price_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.po_price_events(
    order_id, item_id, actor_user_id, actor_email, action, reason,
    issued_state, issued_unit_price, meta
  ) values (
    new.order_id,
    new.id,
    coalesce(new.price_responsible_user_id, auth.uid()),
    coalesce(nullif(auth.jwt() ->> 'email', ''), new.price_responsible_name),
    ('issued_' || new.price_state::text),
    new.price_reason,
    new.price_state,
    new.price,
    jsonb_build_object('qty', new.qty, 'subtotal', new.subtotal, 'position', new.pos)
  );
  return new;
end;
$$;
revoke all on function public._po_items_price_audit()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_po_items_price_audit on public.po_items;
create trigger trg_po_items_price_audit
after insert on public.po_items
for each row execute function public._po_items_price_audit();

create or replace function public._po_items_issued_price_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if row(old.price_state, old.price, old.subtotal, old.price_reason,
         old.price_responsible_user_id, old.price_responsible_name)
     is distinct from
     row(new.price_state, new.price, new.subtotal, new.price_reason,
         new.price_responsible_user_id, new.price_responsible_name) then
    raise exception 'El precio emitido es inmutable; concilie contra la factura real';
  end if;
  if row(old.actual_unit_price, old.actual_subtotal, old.price_reconciled_at,
         old.price_reconciled_by)
     is distinct from
     row(new.actual_unit_price, new.actual_subtotal, new.price_reconciled_at,
         new.price_reconciled_by)
     and coalesce(current_setting('po.reconcile_prices', true), 'off') <> 'on' then
    raise exception 'El precio real sólo puede registrarse mediante la conciliación';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_po_items_issued_price_immutable on public.po_items;
create trigger trg_po_items_issued_price_immutable
before update on public.po_items
for each row execute function public._po_items_issued_price_immutable();

create or replace function public._po_price_summary_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if row(old.price_state, old.planning_neto, old.planning_iva, old.planning_total,
         old.known_partial_neto, old.pending_price_lines,
         old.issued_neto, old.issued_iva, old.issued_total)
     is distinct from
     row(new.price_state, new.planning_neto, new.planning_iva, new.planning_total,
         new.known_partial_neto, new.pending_price_lines,
         new.issued_neto, new.issued_iva, new.issued_total) then
    raise exception 'El resumen de precio emitido es inmutable';
  end if;
  if row(old.neto, old.iva, old.total, old.price_reconciled_at,
         old.price_reconciled_by, old.price_reconciled_invoice_id,
         old.price_reconciliation_reason, old.supplier_invoice_id)
     is distinct from
     row(new.neto, new.iva, new.total, new.price_reconciled_at,
         new.price_reconciled_by, new.price_reconciled_invoice_id,
         new.price_reconciliation_reason, new.supplier_invoice_id)
     and coalesce(current_setting('po.reconcile_prices', true), 'off') <> 'on' then
    raise exception 'El importe real sólo puede registrarse mediante la conciliación';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_po_price_summary_immutable on public.purchase_orders;
create trigger trg_po_price_summary_immutable
before update on public.purchase_orders
for each row execute function public._po_price_summary_immutable();

-- Emisión atómica: header, líneas y auditoría de precio comparten transacción.
create or replace function public._po_png_crc32(p_bytes bytea)
returns bigint language plpgsql immutable strict set search_path = pg_catalog as $$
declare
  v_crc bigint := 4294967295;
  v_i integer;
  v_bit integer;
begin
  if octet_length(p_bytes) > 524288 then return -1; end if;
  for v_i in 0..octet_length(p_bytes)-1 loop
    v_crc := (v_crc # get_byte(p_bytes,v_i)) & 4294967295;
    for v_bit in 1..8 loop
      if (v_crc & 1) = 1 then
        v_crc := ((v_crc >> 1) # 3988292384) & 4294967295;
      else
        v_crc := (v_crc >> 1) & 4294967295;
      end if;
    end loop;
  end loop;
  return (v_crc # 4294967295) & 4294967295;
end;
$$;

create or replace function public._po_png_is_valid(p_png bytea)
returns boolean language plpgsql immutable strict set search_path = pg_catalog as $$
declare
  v_len integer := octet_length(p_png);
  v_pos integer := 8;
  v_chunk_len integer;
  v_type text;
  v_stored_crc bigint;
  v_width bigint;
  v_height bigint;
  v_seen_ihdr boolean := false;
  v_seen_idat boolean := false;
  v_seen_iend boolean := false;
begin
  if v_len < 67 or v_len > 524288
     or substring(p_png from 1 for 8) <> decode('89504e470d0a1a0a','hex') then
    return false;
  end if;
  while v_pos + 12 <= v_len loop
    v_chunk_len := get_byte(p_png,v_pos)::bigint * 16777216
      + get_byte(p_png,v_pos+1)::bigint * 65536
      + get_byte(p_png,v_pos+2)::bigint * 256
      + get_byte(p_png,v_pos+3)::bigint;
    if v_chunk_len > 524288 or v_pos + 12 + v_chunk_len > v_len then return false; end if;
    begin
      v_type := convert_from(substring(p_png from v_pos+5 for 4),'UTF8');
    exception when others then
      return false;
    end;
    v_stored_crc := get_byte(p_png,v_pos+8+v_chunk_len)::bigint * 16777216
      + get_byte(p_png,v_pos+9+v_chunk_len)::bigint * 65536
      + get_byte(p_png,v_pos+10+v_chunk_len)::bigint * 256
      + get_byte(p_png,v_pos+11+v_chunk_len)::bigint;
    if public._po_png_crc32(substring(p_png from v_pos+5 for 4+v_chunk_len))
       is distinct from v_stored_crc then return false; end if;

    if not v_seen_ihdr then
      if v_type <> 'IHDR' or v_chunk_len <> 13 then return false; end if;
      v_width := get_byte(p_png,v_pos+8)::bigint * 16777216
        + get_byte(p_png,v_pos+9)::bigint * 65536
        + get_byte(p_png,v_pos+10)::bigint * 256
        + get_byte(p_png,v_pos+11)::bigint;
      v_height := get_byte(p_png,v_pos+12)::bigint * 16777216
        + get_byte(p_png,v_pos+13)::bigint * 65536
        + get_byte(p_png,v_pos+14)::bigint * 256
        + get_byte(p_png,v_pos+15)::bigint;
      if v_width < 1 or v_height < 1 or v_width > 2048 or v_height > 2048
         or v_width * v_height > 4194304
         or get_byte(p_png,v_pos+18) <> 0
         or get_byte(p_png,v_pos+19) <> 0
         or get_byte(p_png,v_pos+20) not in (0,1) then return false; end if;
      v_seen_ihdr := true;
    elsif v_type = 'IDAT' then
      if v_chunk_len = 0 or v_seen_iend then return false; end if;
      v_seen_idat := true;
    elsif v_type = 'IEND' then
      if v_chunk_len <> 0 or not v_seen_idat or v_pos + 12 <> v_len then return false; end if;
      v_seen_iend := true;
    elsif ascii(substr(v_type,1,1)) between 65 and 90 and v_type <> 'PLTE' then
      return false;
    end if;
    v_pos := v_pos + 12 + v_chunk_len;
    exit when v_seen_iend;
  end loop;
  return v_seen_ihdr and v_seen_idat and v_seen_iend and v_pos = v_len;
end;
$$;

revoke all on function public._po_png_crc32(bytea) from public, anon, authenticated, service_role;
revoke all on function public._po_png_is_valid(bytea) from public, anon, authenticated, service_role;

create or replace function public.purchase_order_issue(p_order jsonb, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_signer text;
  v_issued_at timestamptz;
  v_signature_b64 text;
  v_signature_bytes bytea;
  v_signature_hash text;
  v_integrity_hash text;
  v_emitter_name text;
  v_emitter_email text;
  v_emitter_role text;
  v_integrity_lines jsonb := '[]'::jsonb;
  v_id uuid;
  v_public_id text;
  v_item jsonb;
  v_key text;
  v_line_state text;
  v_qty numeric;
  v_price numeric;
  v_subtotal numeric;
  v_count integer := 0;
  v_pending integer := 0;
  v_estimated integer := 0;
  v_known_partial numeric(14,2) := 0;
  v_planning_neto numeric(14,2);
  v_planning_iva numeric(14,2);
  v_planning_total numeric(14,2);
  v_real_neto numeric(14,2);
  v_real_iva numeric(14,2);
  v_real_total numeric(14,2);
  v_state public.po_price_state_t;
  v_vendor public.vendors%rowtype;
  v_vendor_snapshot jsonb;
  v_depot public.depot_t;
  v_destination text;
begin
  if v_actor is null then
    raise exception 'PO_ISSUE_SIN_IDENTIDAD' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_actor and p.active
  ) then
    raise exception 'PO_ISSUE_SIN_PERFIL_ACTIVO' using errcode = '42501';
  end if;
  if public.has_permission('compras.create') is distinct from true
     or public.has_permission('compras.sign') is distinct from true then
    raise exception 'Sin permisos compras.create/compras.sign' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(jsonb_typeof(p_order), 'missing') <> 'object' then
    raise exception 'p_order debe ser un objeto';
  end if;
  if coalesce(jsonb_typeof(p_items), 'missing') <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La OC requiere al menos una línea';
  end if;

  select
    'José Luis Rodríguez Silva',
    lower(btrim(u.email)),
    'Director de Operaciones y Apoderado'
  into v_signer, v_emitter_email, v_emitter_role
  from auth.users u
  join public.profiles p on p.id=u.id
  where u.id = v_actor
    and p.active
    and lower(btrim(coalesce(u.email,''))) = 'joseluis@logisticatops.com'
  for share of p, u;
  if not found
     or v_emitter_email is null or length(v_emitter_email) > 254
     or v_emitter_email !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$'
     or length(btrim(coalesce(v_emitter_role,''))) < 2 then
    raise exception 'No se pudo resolver el firmante canónico de la sesión'
      using errcode = 'insufficient_privilege';
  end if;
  v_emitter_name := v_signer;
  v_issued_at := clock_timestamp();

  -- El navegador aporta los píxeles de la firma, nunca su identidad, fecha ni
  -- digest. PostgreSQL valida el PNG y calcula SHA-256 sobre los bytes reales.
  if p_order ?| array[
    'signed_by','signed_at','signature_hash','integrity_hash','date',
    'emisor_name','emisor_email','emisor_role','drive_folder','ip'
  ] then
    raise exception 'Firmante, fecha, emisor y hashes son datos canónicos del servidor';
  end if;
  if coalesce(jsonb_typeof(p_order -> 'signature_data_url'), 'missing') <> 'string'
     or (p_order ->> 'signature_data_url') !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'Firma PNG inválida';
  end if;
  v_signature_b64 := substr(p_order ->> 'signature_data_url', 23);
  if length(v_signature_b64) < 4 or length(v_signature_b64) > 700000
     or length(v_signature_b64) % 4 <> 0 then
    raise exception 'Firma PNG fuera de rango';
  end if;
  begin
    v_signature_bytes := decode(v_signature_b64, 'base64');
  exception when others then
    raise exception 'Firma PNG inválida';
  end;
  if not public._po_png_is_valid(v_signature_bytes) then
    raise exception 'Firma PNG inválida o fuera de rango';
  end if;
  v_signature_hash := encode(sha256(v_signature_bytes), 'hex');

  if p_order ? 'status' and (p_order ->> 'status') is distinct from 'firmada' then
    raise exception 'El estado de emisión es canónico: firmada';
  end if;
  if p_order ? 'currency' and upper(btrim(coalesce(p_order ->> 'currency', ''))) <> 'ARS' then
    raise exception 'La OC sólo puede emitirse en ARS; no existe conversión implícita';
  end if;
  if coalesce(jsonb_typeof(p_order -> 'vendor_id'), 'missing') <> 'string'
     or coalesce(p_order ->> 'vendor_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Proveedor inválido';
  end if;
  if coalesce(jsonb_typeof(p_order -> 'depot'), 'missing') <> 'string'
     or (p_order ->> 'depot') not in ('MAGALDI','LUJAN') then
    raise exception 'Depósito inválido';
  end if;
  if jsonb_array_length(p_items) > 500
     or coalesce(jsonb_typeof(p_order -> 'entrega'), 'missing') <> 'string'
     or length(btrim(p_order ->> 'entrega')) < 1 or length(p_order ->> 'entrega') > 80
     or coalesce(jsonb_typeof(p_order -> 'categoria'), 'missing') <> 'string'
     or length(btrim(p_order ->> 'categoria')) < 2 or length(p_order ->> 'categoria') > 80
     or coalesce(jsonb_typeof(p_order -> 'cond_pago'), 'missing') <> 'string'
     or length(btrim(p_order ->> 'cond_pago')) < 2 or length(p_order ->> 'cond_pago') > 40
     or (p_order ? 'observ' and coalesce(jsonb_typeof(p_order -> 'observ'),'null') not in ('string','null'))
     or length(coalesce(p_order ->> 'observ','')) > 2000 then
    raise exception 'Metadatos o cantidad de líneas de OC inválidos';
  end if;

  select * into v_vendor
  from public.vendors
  where id=(p_order ->> 'vendor_id')::uuid and coalesce(active,true)
  for share;
  if not found then
    raise exception 'Proveedor inexistente o inactivo';
  end if;
  v_vendor_snapshot := jsonb_build_object(
    'id',v_vendor.id,'razon',v_vendor.razon,'cuit',v_vendor.cuit,
    'domicilio',v_vendor.domicilio,'telefono',v_vendor.telefono,
    'contacto',v_vendor.contacto,'email',lower(btrim(v_vendor.email)),
    'categoria',v_vendor.categoria,'cond_pago',v_vendor.cond_pago,
    'active',true
  );
  v_depot := (p_order ->> 'depot')::public.depot_t;
  v_destination := case v_depot
    when 'MAGALDI' then 'Agustín Magaldi 1765 · CABA'
    when 'LUJAN' then 'Pedro de Luján 3159 · CABA'
  end;
  if p_order ? 'destino' and btrim(coalesce(p_order ->> 'destino','')) <> v_destination then
    raise exception 'Destino inconsistente con el depósito canónico';
  end if;

  -- Las líneas son la única fuente de verdad económica. Se validan y agregan
  -- antes de crear el header; cualquier claim de cabecera se comprueba luego.
  for v_item in select value from jsonb_array_elements(p_items) as items(value) loop
    if coalesce(jsonb_typeof(v_item), 'missing') <> 'object' then
      raise exception 'Cada línea de la OC debe ser un objeto';
    end if;
    if coalesce(jsonb_typeof(v_item -> 'label'), 'missing') <> 'string'
       or length(btrim(v_item ->> 'label')) < 2
       or length(v_item ->> 'label') > 200
       or coalesce(jsonb_typeof(v_item -> 'unit'), 'missing') <> 'string'
       or length(btrim(v_item ->> 'unit')) < 1
       or length(v_item ->> 'unit') > 20
       or (v_item ? 'sku' and jsonb_typeof(v_item -> 'sku') not in ('string','null'))
       or (v_item ? 'price_reason' and jsonb_typeof(v_item -> 'price_reason') not in ('string','null')) then
      raise exception 'Descripción, unidad o metadatos de línea inválidos';
    end if;
    if coalesce(jsonb_typeof(v_item -> 'pos'), 'missing') <> 'number'
       or coalesce(v_item ->> 'pos','') !~ '^\d+$'
       or length(v_item ->> 'pos') > 6
       or (v_item ->> 'pos')::numeric is distinct from v_count::numeric then
      raise exception 'Posición de línea inconsistente: se esperaba %', v_count;
    end if;
    v_line_state := v_item ->> 'price_state';
    if v_line_state is null or v_line_state not in ('known', 'estimated', 'pending') then
      raise exception 'Estado de precio de línea inválido';
    end if;

    if coalesce(jsonb_typeof(v_item -> 'qty'), 'missing') <> 'number' then
      raise exception 'Cantidad de línea inválida';
    end if;
    v_qty := (v_item ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0
       or v_qty::text in ('NaN', 'Infinity', '-Infinity')
       or v_qty <> round(v_qty, 2) or v_qty >= 10000000000 then
      raise exception 'Cantidad de línea inválida o con más de dos decimales';
    end if;

    if v_line_state = 'pending' then
      if (v_item ->> 'price') is not null or (v_item ->> 'subtotal') is not null then
        raise exception 'Una línea pendiente no puede declarar precio ni subtotal';
      end if;
      if length(btrim(coalesce(v_item ->> 'price_reason', ''))) < 3 then
        raise exception 'El precio pendiente requiere un motivo';
      end if;
      v_pending := v_pending + 1;
    else
      if coalesce(jsonb_typeof(v_item -> 'price'), 'missing') <> 'number' then
        raise exception 'Precio de línea inválido';
      end if;
      v_price := (v_item ->> 'price')::numeric;
      if v_price is null or v_price < 0
         or v_price::text in ('NaN', 'Infinity', '-Infinity')
         or v_price <> round(v_price, 2) or v_price >= 1000000000000 then
        raise exception 'Precio de línea inválido o con más de dos decimales';
      end if;
      if v_line_state = 'estimated'
         and length(btrim(coalesce(v_item ->> 'price_reason', ''))) < 3 then
        raise exception 'El precio estimado requiere un motivo';
      end if;

      v_subtotal := round(v_qty * v_price, 2);
      if v_subtotal >= 1000000000000 then
        raise exception 'Subtotal de línea fuera de rango';
      end if;
      if v_item ? 'subtotal'
         and (
           jsonb_typeof(v_item -> 'subtotal') <> 'number'
           or (v_item ->> 'subtotal')::numeric is distinct from v_subtotal
         ) then
        raise exception 'Subtotal de línea inconsistente con cantidad y precio';
      end if;
      if v_line_state = 'known' then
        v_known_partial := v_known_partial + v_subtotal;
      else
        v_estimated := v_estimated + 1;
      end if;
      v_planning_neto := coalesce(v_planning_neto, 0) + v_subtotal;
    end if;
    v_integrity_lines := v_integrity_lines || jsonb_build_array(jsonb_build_object(
      'pos', v_count,
      'sku', nullif(v_item ->> 'sku',''),
      'label', btrim(v_item ->> 'label'),
      'unit', btrim(v_item ->> 'unit'),
      'qty', v_qty,
      'price_state', v_line_state,
      'price', case when v_line_state='pending' then null else v_price end,
      'subtotal', case when v_line_state='pending' then null else v_subtotal end,
      'price_reason', nullif(btrim(coalesce(v_item ->> 'price_reason','')),'')
    ));
    v_count := v_count + 1;
  end loop;

  if v_pending > 0 then
    v_state := 'pending';
    v_planning_neto := null;
  elsif v_estimated > 0 then
    v_state := 'estimated';
  else
    v_state := 'known';
  end if;

  if v_planning_neto is not null then
    v_planning_neto := round(v_planning_neto, 2);
    v_planning_iva := round(v_planning_neto * 0.21, 2);
    v_planning_total := v_planning_neto + v_planning_iva;
  end if;
  if v_state = 'known' then
    v_real_neto := v_planning_neto;
    v_real_iva := v_planning_iva;
    v_real_total := v_planning_total;
  end if;

  -- La cabecera económica se reconstruye exclusivamente desde las líneas.
  -- Un caller que intente declarar importes o conteos paralelos falla cerrado:
  -- no hay casts de JSON hostil ni dos fuentes de verdad que puedan divergir.
  foreach v_key in array array[
    'neto','iva','total','planning_neto','planning_iva','planning_total',
    'known_partial_neto','pending_price_lines','price_state'
  ] loop
    if p_order ? v_key then
      raise exception 'La cabecera económica no admite el claim %', v_key;
    end if;
  end loop;

  v_integrity_hash := encode(sha256(convert_to(jsonb_build_object(
    'vendor', v_vendor_snapshot,
    'depot', v_depot,
    'destination', v_destination,
    'currency', 'ARS',
    'issued_at', v_issued_at,
    'signer_id', v_actor,
    'signer_name', v_signer,
    'signer_email', v_emitter_email,
    'signer_role', v_emitter_role,
    'signature_hash', v_signature_hash,
    'price_state', v_state,
    'planning_total', v_planning_total,
    'lines', v_integrity_lines
  )::text, 'UTF8')), 'hex');

  insert into public.purchase_orders(
    date, depot, destino, entrega, categoria, cond_pago, currency, status, vendor_id,
    emisor_name, emisor_email, emisor_role,
    observ,
    neto, iva, total, price_state,
    planning_neto, planning_iva, planning_total, known_partial_neto, pending_price_lines,
    issued_neto, issued_iva, issued_total, vendor_snapshot,
    signed_by, signed_at, signature_hash, integrity_hash, created_by
  ) values (
    v_issued_at,
    v_depot,
    v_destination, btrim(p_order ->> 'entrega'), btrim(p_order ->> 'categoria'),
    btrim(p_order ->> 'cond_pago'), 'ARS', 'pendiente', v_vendor.id,
    v_emitter_name, v_emitter_email, v_emitter_role,
    nullif(p_order ->> 'observ', ''),
    v_real_neto, v_real_iva, v_real_total, v_state,
    v_planning_neto, v_planning_iva, v_planning_total,
    v_known_partial, v_pending,
    v_planning_neto, v_planning_iva, v_planning_total, v_vendor_snapshot,
    v_signer, null,
    v_signature_hash, v_integrity_hash, v_actor
  ) returning id, public_id, emisor_name, emisor_email, emisor_role
    into v_id, v_public_id, v_emitter_name, v_emitter_email, v_emitter_role;

  insert into public.po_signature_evidence(order_id,png,sha256,created_at)
  values (v_id,v_signature_bytes,v_signature_hash,v_issued_at);

  v_count := 0;
  for v_item in select value from jsonb_array_elements(p_items) as items(value) loop
    insert into public.po_items(
      order_id, sku, label, unit, qty, price, subtotal, pos,
      price_state, price_reason, price_responsible_user_id, price_responsible_name
    ) values (
      v_id, nullif(v_item ->> 'sku', ''), btrim(v_item ->> 'label'), v_item ->> 'unit',
      (v_item ->> 'qty')::numeric,
      case when v_item ->> 'price_state' = 'pending' then null else (v_item ->> 'price')::numeric end,
      case when v_item ->> 'price_state' = 'pending' then null
           else round((v_item ->> 'qty')::numeric * (v_item ->> 'price')::numeric, 2) end,
      v_count,
      (v_item ->> 'price_state')::public.po_price_state_t,
      nullif(v_item ->> 'price_reason', ''), auth.uid(),
      coalesce(nullif(auth.jwt() ->> 'email', ''), 'usuario autenticado')
    );
    v_count := v_count + 1;
  end loop;

  -- El evento signed se agrega sólo cuando el PDF privado queda congelado.
  insert into public.po_events(order_id,kind,actor,actor_email,ip,meta)
  values (v_id,'created',v_signer,v_emitter_email,null,
    jsonb_build_object('currency','ARS','vendor_id',v_vendor.id,'depot',v_depot));

  return jsonb_build_object(
    'id', v_id, 'public_id', v_public_id, 'items', v_count,
    'price_state', v_state, 'currency', 'ARS',
    'neto', v_real_neto, 'iva', v_real_iva, 'total', v_real_total,
    'planning_neto', v_planning_neto, 'planning_iva', v_planning_iva,
    'planning_total', v_planning_total, 'known_partial_neto', v_known_partial,
    'pending_price_lines', v_pending,
    'signed_by', v_signer, 'issued_at', v_issued_at,
    'signature_hash', v_signature_hash, 'integrity_hash', v_integrity_hash,
    'emisor_name', v_emitter_name, 'emisor_email', v_emitter_email,
    'emisor_role', v_emitter_role, 'vendor_snapshot', v_vendor_snapshot
  );
end;
$$;
revoke all on function public.purchase_order_issue(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.purchase_order_issue(jsonb, jsonb) to authenticated;

create or replace function public.purchase_order_finalize_document(
  p_order_id uuid, p_pdf_path text, p_pdf_sha256 text, p_pdf_size integer
) returns jsonb
language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare v_po public.purchase_orders%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'PO_DOCUMENT_SERVICE_ONLY' using errcode='42501';
  end if;
  if coalesce(p_pdf_path,'') !~ '^[0-9a-f-]{36}/[a-f0-9]{64}\.pdf$'
     or p_pdf_sha256 !~ '^[a-f0-9]{64}$'
     or p_pdf_path is distinct from p_order_id::text || '/' || p_pdf_sha256 || '.pdf'
     or p_pdf_size not between 100 and 5242880 then
    raise exception 'PO_DOCUMENT_EVIDENCE_INVALID';
  end if;
  select * into strict v_po from public.purchase_orders where id=p_order_id for update;
  if v_po.status='firmada' then
    if row(v_po.pdf_url,v_po.pdf_sha256,v_po.pdf_size_bytes)
       is distinct from row(p_pdf_path,p_pdf_sha256,p_pdf_size) then
      raise exception 'PO_DOCUMENT_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object('status','firmada','signed_at',v_po.signed_at);
  end if;
  if v_po.status <> 'pendiente' or v_po.vendor_snapshot is null
     or not exists (
       select 1 from storage.objects where bucket_id='po-pdfs-private' and name=p_pdf_path
         and coalesce((metadata->>'size')::bigint,-1)=p_pdf_size
     ) then
    raise exception 'PO_DOCUMENT_NOT_MATERIALIZED';
  end if;
  update public.purchase_orders
     set status='firmada',signed_at=date,pdf_url=p_pdf_path,
         pdf_sha256=p_pdf_sha256,pdf_size_bytes=p_pdf_size
   where id=p_order_id returning * into v_po;
  insert into public.po_events(order_id,kind,actor,actor_email,ip,meta)
  values (v_po.id,'signed',v_po.emisor_name,v_po.emisor_email,null,
    jsonb_build_object('signature_hash',v_po.signature_hash,
      'integrity_hash',v_po.integrity_hash,'pdf_sha256',p_pdf_sha256,
      'pdf_size_bytes',p_pdf_size));
  return jsonb_build_object('status','firmada','signed_at',v_po.signed_at,
    'pdf_path',v_po.pdf_url,'pdf_sha256',v_po.pdf_sha256);
end;
$$;
revoke all on function public.purchase_order_finalize_document(uuid,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.purchase_order_finalize_document(uuid,text,text,integer)
  to service_role;

-- Prepara el intento ANTES del egress. El destinatario sale del maestro de
-- proveedores y la clave es determinista por OC, de modo que un retry usa la
-- misma operación del proveedor y nunca fabrica una segunda entrega.
create or replace function public.purchase_order_prepare_email_delivery(
  p_order_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_attempt text := 'purchase-order/vendor/' || p_order_id::text;
  v_row public.po_email_sends%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'PO_EMAIL_SERVICE_ONLY' using errcode='42501';
  end if;
  select btrim(po.vendor_snapshot->>'email') into v_email
  from public.purchase_orders po
  where po.id=p_order_id and po.status='firmada' and po.pdf_url is not null
  for update of po;
  if not found then raise exception 'OC o proveedor inexistente'; end if;
  if v_email is null or length(v_email) > 254
     or v_email !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$' then
    raise exception 'El proveedor no tiene un email canónico válido';
  end if;

  insert into public.po_email_sends(
    order_id,to_email,tag,status,attempt_key,provider_id,error,sent_at
  ) values (
    p_order_id,v_email,'Proveedor','queued',v_attempt,null,null,null
  )
  on conflict (order_id,attempt_key) where attempt_key is not null do nothing;

  select * into strict v_row from public.po_email_sends
  where order_id=p_order_id and attempt_key=v_attempt
  for update;
  if v_row.to_email is distinct from v_email or v_row.tag is distinct from 'Proveedor' then
    raise exception 'El intento existente no coincide con el destinatario canónico';
  end if;
  return jsonb_build_object(
    'attempt_key',v_attempt,'status',v_row.status,'provider_id',v_row.provider_id,
    'to_email',v_row.to_email
  );
end;
$$;
revoke all on function public.purchase_order_prepare_email_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.purchase_order_prepare_email_delivery(uuid)
  to service_role;

-- Antes del egress la fila deja de estar `queued` y queda explícitamente en
-- conciliación. Si el proceso muere después de que Resend aceptó el mensaje,
-- nunca se reenvía a ciegas: la misma clave se confirma contra el proveedor.
create or replace function public.purchase_order_begin_email_delivery(
  p_order_id uuid,
  p_attempt_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row public.po_email_sends%rowtype;
  v_expected text := 'purchase-order/vendor/' || p_order_id::text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'PO_EMAIL_SERVICE_ONLY' using errcode='42501';
  end if;
  if p_attempt_key is distinct from v_expected then
    raise exception 'Clave de intento de email inválida';
  end if;
  select * into v_row from public.po_email_sends
   where order_id=p_order_id and attempt_key=p_attempt_key
   for update;
  if not found then raise exception 'Intento de email no preparado'; end if;
  if v_row.status='queued' then
    perform set_config('po.email_delivery','on',true);
    update public.po_email_sends
       set status='unknown',provider_id=null,error='PO_EMAIL_SEND_IN_PROGRESS',sent_at=null
     where id=v_row.id
     returning * into v_row;
  elsif v_row.status <> 'unknown' then
    raise exception 'El intento no está disponible para entrega';
  end if;
  return jsonb_build_object(
    'attempt_key',p_attempt_key,'status',v_row.status,'to_email',v_row.to_email
  );
end;
$$;
revoke all on function public.purchase_order_begin_email_delivery(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.purchase_order_begin_email_delivery(uuid,text)
  to service_role;

-- Finaliza el ledger y el evento sent_email en UNA transacción. Un retry con
-- la misma clave y provider_id devuelve el mismo evento; un resultado distinto
-- aborta para no reescribir la evidencia.
create or replace function public.purchase_order_finalize_email_delivery(
  p_order_id uuid,
  p_attempt_key text,
  p_status text,
  p_provider_id text default null,
  p_error_code text default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row public.po_email_sends%rowtype;
  v_event_id bigint;
  v_expected text := 'purchase-order/vendor/' || p_order_id::text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'PO_EMAIL_SERVICE_ONLY' using errcode='42501';
  end if;
  if p_attempt_key is distinct from v_expected then
    raise exception 'Clave de intento de email inválida';
  end if;
  if p_status not in ('sent','failed','unknown') then
    raise exception 'Estado final de email inválido';
  end if;

  select * into v_row from public.po_email_sends
  where order_id=p_order_id and attempt_key=p_attempt_key
  for update;
  if not found then raise exception 'Intento de email no preparado'; end if;

  if p_status='sent' then
    if length(btrim(coalesce(p_provider_id,''))) < 2 or length(p_provider_id) > 200 then
      raise exception 'Identificador del proveedor de email inválido';
    end if;
    if v_row.status='sent' then
      if v_row.provider_id is distinct from p_provider_id then
        raise exception 'El intento ya fue finalizado con otra evidencia';
      end if;
      select id into strict v_event_id from public.po_events
       where order_id=p_order_id and kind='sent_email'
         and meta->>'attempt_key'=p_attempt_key
         and meta->>'provider_id'=p_provider_id;
      return v_event_id;
    end if;
    if v_row.status not in ('queued','unknown') then
      raise exception 'El intento fallido no puede convertirse en enviado';
    end if;
    perform set_config('po.email_delivery','on',true);
    update public.po_email_sends
       set status='sent',provider_id=p_provider_id,error=null,sent_at=clock_timestamp()
     where id=v_row.id;
    insert into public.po_events(order_id,kind,actor,meta)
    values (p_order_id,'sent_email','system',jsonb_build_object(
      'attempt_key',p_attempt_key,'provider_id',p_provider_id,
      'recipient_kind','vendor','delivery_kind','notification_only'
    )) returning id into v_event_id;
    return v_event_id;
  end if;

  if p_error_code not in (
    'PO_EMAIL_NOT_CONFIGURED','PO_VENDOR_EMAIL_MISSING','PO_EMAIL_PROVIDER_REJECTED',
    'PO_EMAIL_PROVIDER_RESPONSE_INVALID','PO_EMAIL_SEND_FAILED'
  ) then
    raise exception 'Código de fallo de email inválido';
  end if;
  if v_row.status='sent' then
    raise exception 'Un email enviado no puede degradarse a fallido';
  end if;
  if p_status='unknown' then
    if p_error_code not in ('PO_EMAIL_PROVIDER_RESPONSE_INVALID','PO_EMAIL_SEND_FAILED') then
      raise exception 'Sólo un resultado ambiguo puede quedar pendiente de conciliación';
    end if;
    if v_row.status='unknown' then
      if v_row.error is distinct from p_error_code then
        perform set_config('po.email_delivery','on',true);
        update public.po_email_sends set error=p_error_code where id=v_row.id;
      end if;
      return null;
    end if;
    if v_row.status <> 'queued' then
      raise exception 'El intento ya tiene un resultado definitivo';
    end if;
    perform set_config('po.email_delivery','on',true);
    update public.po_email_sends
       set status='unknown',provider_id=null,error=p_error_code,sent_at=null
     where id=v_row.id;
    return null;
  end if;
  if v_row.status='failed' then
    if v_row.error is distinct from p_error_code then
      raise exception 'El intento ya fue finalizado con otro resultado';
    end if;
    return null;
  end if;
  perform set_config('po.email_delivery','on',true);
  update public.po_email_sends
     set status='failed',provider_id=null,error=p_error_code,sent_at=null
   where id=v_row.id;
  return null;
end;
$$;
revoke all on function public.purchase_order_finalize_email_delivery(uuid,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.purchase_order_finalize_email_delivery(uuid,text,text,text,text)
  to service_role;

-- Drive conserva una RPC separada e idempotente. `sent_email` sólo puede nacer
-- desde la finalización atómica de `po_email_sends` anterior.
create or replace function public.purchase_order_record_delivery_event(
  p_order_id uuid,
  p_kind text,
  p_meta jsonb
) returns bigint
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_event_id bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'PO_DELIVERY_SERVICE_ONLY' using errcode='42501';
  end if;
  if p_kind <> 'drive_synced'
     or coalesce(jsonb_typeof(p_meta), 'missing') <> 'object' then
    raise exception 'Evento de entrega de OC inválido';
  end if;
  perform 1 from public.purchase_orders where id=p_order_id for update;
  if not found then
    raise exception 'OC inexistente';
  end if;
  if length(btrim(coalesce(p_meta->>'file_id',''))) < 2
     or length(p_meta->>'file_id') > 500
     or length(btrim(coalesce(p_meta->>'folder',''))) < 2
     or length(p_meta->>'folder') > 1000 then
    raise exception 'Evidencia de Drive de OC incompleta';
  end if;

  select id into v_event_id from public.po_events
   where order_id=p_order_id and kind='drive_synced'
     and meta->>'file_id'=p_meta->>'file_id'
   limit 1;
  if found then return v_event_id; end if;

  update public.purchase_orders
     set drive_file_id=btrim(p_meta->>'file_id'),
         drive_folder=btrim(p_meta->>'folder')
   where id=p_order_id;
  insert into public.po_events(order_id,kind,actor,meta)
  values (p_order_id,p_kind::public.po_event_kind_t,'system',p_meta)
  returning id into v_event_id;
  return v_event_id;
end;
$$;
revoke all on function public.purchase_order_record_delivery_event(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.purchase_order_record_delivery_event(uuid,text,jsonb)
  to service_role;

-- La RPC es la unica via de emision: evita headers huerfanos y lineas creadas
-- fuera de la misma transaccion/auditoria. Las actualizaciones no economicas
-- de la cabecera (PDF, Drive, estado) siguen por las policies preexistentes.
revoke insert, update, delete, truncate on public.purchase_orders from authenticated, service_role;
revoke insert, update, delete, truncate on public.po_items from authenticated, service_role;
alter table public.po_signature_evidence enable row level security;
revoke all on public.po_signature_evidence from public, anon, authenticated, service_role;

-- FASE A no modifica el bucket legado `po-pdfs`: hacerlo público/privado acá
-- rompería su rollback y cambiaría una superficie ajena ya publicada. Los
-- documentos nuevos viven en un bucket dedicado, privado y service-only.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'po-pdfs-private','po-pdfs-private',false,5242880,
  array['application/pdf']::text[]
)
on conflict (id) do update
set name=excluded.name, public=false, file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

-- Concilia el importe emitido contra una factura real. Los valores originales
-- permanecen en price/planning_*; los reales quedan en actual_* y neto/iva/total.
create or replace function public.po_reconcile_prices(
  p_order_id uuid,
  p_invoice_id uuid,
  p_lines jsonb,
  p_reason text
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_po public.purchase_orders%rowtype;
  v_inv public.supplier_invoices%rowtype;
  v_recon_id uuid;
  v_line jsonb;
  v_item public.po_items%rowtype;
  v_actual numeric(14,2);
  v_actual_neto numeric(14,2) := 0;
  v_seen integer := 0;
  v_seen_ids uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception 'PO_RECONCILE_SIN_IDENTIDAD' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_actor and p.active
  ) then
    raise exception 'PO_RECONCILE_SIN_PERFIL_ACTIVO' using errcode = '42501';
  end if;
  if public.has_permission('compras.edit') is distinct from true then
    raise exception 'Sin permiso compras.edit' using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'La conciliación requiere un motivo';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'p_lines debe ser un array';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0
     or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 500 then
    raise exception 'Cantidad de precios reales inválida';
  end if;

  select * into v_po from public.purchase_orders where id = p_order_id for update;
  if not found then raise exception 'OC inexistente' using errcode = 'no_data_found'; end if;
  if v_po.price_reconciled_at is not null then raise exception 'La OC ya fue conciliada'; end if;

  select * into v_inv from public.supplier_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Factura inexistente' using errcode = 'no_data_found'; end if;
  if v_inv.vendor_id <> v_po.vendor_id then raise exception 'La factura pertenece a otro proveedor'; end if;
  if v_inv.purchase_order_id is distinct from p_order_id then
    raise exception 'La factura no está vinculada de forma canónica a esta OC';
  end if;
  if upper(btrim(coalesce(v_inv.moneda, ''))) <> 'ARS' then
    raise exception 'La factura no está en ARS; se prohíbe una conversión monetaria implícita';
  end if;
  if v_inv.status::text = 'anulada' then
    raise exception 'Una factura anulada no puede conciliar precios';
  end if;

  select id into v_recon_id
    from public.po_reconciliations
   where purchase_order_id = p_order_id
     and supplier_invoice_id = p_invoice_id
     and status::text <> 'rechazada'
   for update;
  if not found then
    raise exception 'No existe una conciliación activa para el par OC/factura';
  end if;
  if exists (
    select 1 from public.po_reconciliations
     where supplier_invoice_id = p_invoice_id
       and purchase_order_id <> p_order_id
       and status::text <> 'rechazada'
  ) then
    raise exception 'La factura ya participa de otra conciliación activa';
  end if;

  -- Primera pasada: valida cobertura, unicidad y que el neto de los precios
  -- reales cierre contra el neto fiscal. No se escribe nada antes de cerrar.
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Cada precio real debe ser un objeto';
    end if;
    if coalesce(jsonb_typeof(v_line -> 'item_id'),'missing') <> 'string'
       or coalesce(v_line ->> 'item_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(jsonb_typeof(v_line -> 'actual_unit_price'),'missing') <> 'number' then
      raise exception 'Precio real malformado';
    end if;
    select * into v_item
      from public.po_items
     where id = (v_line ->> 'item_id')::uuid and order_id = p_order_id
     for update;
    if not found then raise exception 'Línea de OC inexistente o ajena'; end if;
    if v_item.id = any(v_seen_ids) then raise exception 'Línea duplicada en la conciliación'; end if;
    v_actual := (v_line ->> 'actual_unit_price')::numeric;
    if v_actual is null or v_actual < 0
       or v_actual::text in ('NaN', 'Infinity', '-Infinity')
       or v_actual <> round(v_actual, 2) or v_actual >= 1000000000000 then
      raise exception 'Precio real inválido o con más de dos decimales';
    end if;
    if v_item.price_reconciled_at is not null then raise exception 'Línea ya conciliada'; end if;

    v_seen_ids := array_append(v_seen_ids, v_item.id);
    v_actual_neto := v_actual_neto + round(v_item.qty * v_actual, 2);
    v_seen := v_seen + 1;
  end loop;

  if v_seen <> (select count(*) from public.po_items where order_id = p_order_id) then
    raise exception 'Debe conciliar cada línea de la OC exactamente una vez';
  end if;
  if abs(v_actual_neto - v_inv.neto) > 0.02 then
    raise exception 'Los precios reales no cierran contra el neto de factura: líneas %, factura %',
      v_actual_neto, v_inv.neto;
  end if;

  perform set_config('po.reconcile_prices', 'on', true);

  -- Segunda pasada: guarda el snapshot real y su diferencia contra lo emitido.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item
      from public.po_items
     where id = (v_line ->> 'item_id')::uuid and order_id = p_order_id
     for update;
    v_actual := (v_line ->> 'actual_unit_price')::numeric;

    update public.po_items
       set actual_unit_price = v_actual,
           actual_subtotal = round(qty * v_actual, 2),
           price_reconciled_at = now(),
           price_reconciled_by = v_actor
     where id = v_item.id;

    insert into public.po_price_events(
      order_id, item_id, actor_user_id, actor_email, action, reason,
      issued_state, issued_unit_price, actual_unit_price, delta_unit_price,
      supplier_invoice_id, meta
    ) values (
      p_order_id, v_item.id, v_actor, auth.jwt() ->> 'email', 'reconciled', btrim(p_reason),
      v_item.price_state, v_item.price, v_actual,
      case when v_item.price is null then null else v_actual - v_item.price end,
      p_invoice_id,
      jsonb_build_object(
        'qty', v_item.qty,
        'issued_subtotal', v_item.subtotal,
        'actual_subtotal', round(v_item.qty * v_actual, 2),
        'delta_subtotal', case when v_item.subtotal is null then null
                               else round(v_item.qty * v_actual, 2) - v_item.subtotal end,
        'invoice_public_id', v_inv.public_id,
        'invoice_currency', v_inv.moneda,
        'invoice_neto', v_inv.neto,
        'invoice_iva', v_inv.iva,
        'invoice_total', v_inv.total,
        'reconciliation_id', v_recon_id
      )
    );
  end loop;

  update public.purchase_orders
     set neto = v_inv.neto,
         iva = v_inv.iva,
         total = v_inv.total,
         price_reconciled_at = now(),
         price_reconciled_by = v_actor,
         price_reconciled_invoice_id = p_invoice_id,
         price_reconciliation_reason = btrim(p_reason),
         supplier_invoice_id = p_invoice_id
   where id = p_order_id;
end;
$$;

revoke all on function public.po_reconcile_prices(uuid, uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.po_reconcile_prices(uuid, uuid, jsonb, text) to authenticated;
revoke insert, update, delete, truncate on public.po_price_events from authenticated, service_role;
revoke insert, update, delete, truncate on public.po_events from authenticated, service_role;
revoke insert, update, delete, truncate on public.po_email_sends from authenticated, service_role;
grant select on public.po_price_events to authenticated;

-- Resumen del MISMO universo filtrado que la grilla, calculado en PostgreSQL.
-- Evita descargar filas para sumar en Node y no depende del max-rows de
-- PostgREST; un pendiente/estimado cuenta como no real, nunca como cero.
create or replace function public.purchase_order_list_metrics(
  p_status text default null,
  p_depot text default null,
  p_vendor_id uuid default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
as $$
  with base as (
    select po.*
    from public.purchase_orders po
    where (p_depot is null or p_depot='' or p_depot='todos' or po.depot::text=p_depot)
      and (p_vendor_id is null or po.vendor_id=p_vendor_id)
      and (p_search is null or btrim(p_search)='' or po.public_id ilike '%' || btrim(p_search) || '%')
      and (p_from is null or po.date >= p_from)
      and (p_to is null or po.date <= p_to)
  ), selected as (
    select * from base
    where p_status is null or p_status='' or p_status='todas' or status::text=p_status
  ), status_counts as (
    select coalesce(jsonb_object_agg(status::text,n),'{}'::jsonb) counts
    from (select status,count(*)::integer n from base group by status) grouped
  ), summary as (
    select
      count(*)::integer total,
      coalesce(sum(total) filter (
        where total is not null and (price_state='known' or price_reconciled_at is not null)
      ),0)::numeric real_total,
      count(*) filter (
        where not (total is not null and (price_state='known' or price_reconciled_at is not null))
      )::integer non_real_count
    from selected
  )
  select jsonb_build_object(
    'counts', status_counts.counts || jsonb_build_object('todas',(select count(*) from base)),
    'total', summary.total,
    'real_total', summary.real_total,
    'non_real_count', summary.non_real_count
  )
  from status_counts cross join summary
$$;
revoke all on function public.purchase_order_list_metrics(text,text,uuid,text,timestamptz,timestamptz)
  from public, anon;
grant execute on function public.purchase_order_list_metrics(text,text,uuid,text,timestamptz,timestamptz)
  to authenticated;

create or replace function public._recon_requires_real_purchase_price()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_state public.po_price_state_t;
  v_reconciled timestamptz;
begin
  if new.status in ('conciliada', 'con_diferencias')
     and old.status is distinct from new.status then
    select price_state, price_reconciled_at into v_state, v_reconciled
      from public.purchase_orders where id = new.purchase_order_id;
    if v_state <> 'known' and v_reconciled is null then
      raise exception 'La OC tiene precio estimado/pendiente: registre el precio real antes de aprobar';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_recon_requires_real_purchase_price on public.po_reconciliations;
create trigger trg_recon_requires_real_purchase_price
before update on public.po_reconciliations
for each row execute function public._recon_requires_real_purchase_price();

-- Las herramientas analíticas reciben NULL/leyenda para lo no real. Nunca se
-- transforma un pendiente en cero ni se suma un estimado como compromiso real.
create or replace function public.ai_purchase_orders_overview(
  p_mode text default 'recientes', p_query text default null, p_limit int default 30
) returns table (
  public_id text, proveedor text, total numeric, fecha date, estado text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    coalesce(nullif(btrim(po.public_id), ''), 'OC#' || left(po.id::text, 8)),
    public.ai_docs_redact(coalesce(v.razon, 'Proveedor')),
    po.total,
    po.date::date,
    po.status::text,
    public.ai_docs_redact(concat_ws(' · ',
      'Orden de compra',
      'proveedor ' || coalesce(nullif(btrim(v.razon), ''), 's/d'),
      case
        when po.price_reconciled_at is not null and po.total is not null
          then 'total real conciliado ARS ' || to_char(po.total, 'FM999G999G990D00')
        when po.price_state = 'known' and po.total is not null
          then 'total conocido ARS ' || to_char(po.total, 'FM999G999G990D00')
        when po.price_state = 'estimated' then 'importe estimado, no contable'
        else 'precio pendiente, sin importe real'
      end,
      'estado ' || coalesce(po.status::text, 's/d'),
      case when po.date is not null then to_char(po.date, 'YYYY-MM-DD') end
    ))
  from public.purchase_orders po
  left join public.vendors v on v.id = po.vendor_id
  where (
      p_query is null or btrim(p_query) = ''
      or v.razon ilike '%' || btrim(p_query) || '%'
      or coalesce(po.public_id, '') ilike '%' || btrim(p_query) || '%'
    )
    and case coalesce(nullif(btrim(p_mode), ''), 'recientes')
      when 'por_proveedor' then (p_query is not null and btrim(p_query) <> '')
      else true
    end
  order by po.date desc nulls last
  limit case when coalesce(nullif(btrim(p_mode), ''), 'recientes') = 'ultima'
             then 1 else least(greatest(coalesce(p_limit, 30), 1), 50) end
$$;

create or replace function public.ai_supplier_spend_overview(
  p_base text default 'gasto', p_periodo text default 'todo', p_limit int default 10
) returns table (
  proveedor text, total numeric, cantidad int, periodo text, base text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with params as (
    select case when coalesce(nullif(btrim(p_base), ''), 'gasto') = 'compromiso'
                then 'compromiso' else 'gasto' end as base,
           coalesce(nullif(btrim(p_periodo), ''), 'todo') as periodo
  ),
  gasto as (
    select public.ai_docs_redact(coalesce(v.razon, 'Proveedor')) as proveedor,
           sum(si.total) as total, count(*)::int as cantidad
      from public.supplier_invoices si
      join public.vendors v on v.id = si.vendor_id
      cross join params p
     where p.base = 'gasto'
       and si.status::text is distinct from 'anulada'
       and case p.periodo
         when 'mes_actual' then date_trunc('month', si.fecha_emision) = date_trunc('month', current_date)
         when 'ultimo_mes' then date_trunc('month', si.fecha_emision) = date_trunc('month', current_date - interval '1 month')
         when 'ultimos_30_dias' then si.fecha_emision >= current_date - 30
         else true end
     group by 1
  ),
  compromiso as (
    select public.ai_docs_redact(coalesce(v.razon, 'Proveedor')) as proveedor,
           sum(po.total) as total, count(*)::int as cantidad
      from public.purchase_orders po
      join public.vendors v on v.id = po.vendor_id
      cross join params p
     where p.base = 'compromiso'
       and po.status::text not in ('anulada', 'borrador')
       and po.total is not null
       and (po.price_state = 'known' or po.price_reconciled_at is not null)
       and case p.periodo
         when 'mes_actual' then date_trunc('month', po.date) = date_trunc('month', current_date)
         when 'ultimo_mes' then date_trunc('month', po.date) = date_trunc('month', current_date - interval '1 month')
         when 'ultimos_30_dias' then po.date >= current_date - interval '30 days'
         else true end
     group by 1
  ),
  ranking as (select * from gasto union all select * from compromiso)
  select r.proveedor, r.total, r.cantidad, (select periodo from params), (select base from params),
         (case when (select base from params) = 'compromiso'
               then 'Compromiso real (excluye precios estimados o pendientes)'
               else 'Gasto (facturas de proveedor)' end)
         || ' · ' || r.proveedor || ' · ARS ' || to_char(r.total, 'FM999G999G999G990D00')
         || ' · ' || r.cantidad || case when (select base from params) = 'compromiso' then ' OC' else ' facturas' end
         || ' · período: ' || (select periodo from params)
    from ranking r
   order by r.total desc nulls last
   limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

revoke all on function public.ai_purchase_orders_overview(text, text, int) from public, anon;
revoke all on function public.ai_supplier_spend_overview(text, text, int) from public, anon;
grant execute on function public.ai_purchase_orders_overview(text, text, int) to authenticated;
grant execute on function public.ai_supplier_spend_overview(text, text, int) to authenticated;

notify pgrst, 'reload schema';
