-- ============================================================================
-- ROLLBACK 0259 · OC-FIRMANTE-POR-PERMISO
-- ============================================================================
--
-- Deshace 0259 en el orden inverso exacto:
--
--   1 · restituye `purchase_order_issue(jsonb, jsonb)` al cuerpo de 0243, con
--       el firmante resuelto por el correo literal 'joseluis@logisticatops.com',
--       los dos literales de nombre y cargo, y SIN el gate directo del firmante;
--   2 · revierte los cargos que 0259 cargó en `user_roles.position_title`:
--       las DOS cuentas de Dirección vuelven a 'Presidente · Super
--       Administrador', y José Luis y Cynthia vuelven a NULL, que era su estado
--       antes de esta migración;
--   3 · devuelve `compras.sign` a los CINCO roles que lo portaban —medidos en
--       producción: admin_sin_rrhh, administracion_finanzas, director_ops,
--       gerencia_comercial, super_admin— y borra el rol `firmante_oc` con todas
--       sus asignaciones.
--
-- NO toca `public.purchase_orders`: 0259 nunca escribió una sola de sus filas,
-- así que no hay nada que restaurar ahí. Las 24 órdenes emitidas conservan su
-- firmante, su cargo y sus dos hashes en los dos sentidos de la migración.
--
-- ⚠ Después de este rollback, sólo `joseluis@logisticatops.com` vuelve a poder
--   emitir órdenes de compra, y `compras.sign` vuelve a colgar de cinco roles
--   que mezclan a quien firma con quien no. Es el estado previo, con sus tres
--   defectos incluidos: el correo literal, el permiso mal repartido y el bypass
--   de `has_permission` volviendo a ser el único freno real.
--
-- ============================================================================

begin;

-- ── 1 · LA FUNCIÓN DE 0243, TAL CUAL ────────────────────────────────────────

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

-- ── 2 · LOS CARGOS, AL ESTADO PREVIO ────────────────────────────────────────
--
-- Sólo se revierten los cargos que 0259 escribió, y cada uno a su valor previo
-- MEDIDO: las dos cuentas de Dirección tenían el mismo cargo mezclado, y José
-- Luis y Cynthia no tenían ninguno.

update public.user_roles ur
   set position_title = 'Presidente · Super Administrador'
  from auth.users u, public.roles r
 where u.id = ur.user_id
   and r.id = ur.role_id
   and r.slug = 'super_admin'
   and u.id = '7a9ecbdc-3ff0-459e-b340-8a07eed898fa'::uuid
   and lower(btrim(coalesce(u.email, ''))) = 'martin.battaglia@logisticatops.com';

update public.user_roles ur
   set position_title = 'Presidente · Super Administrador'
  from auth.users u, public.roles r
 where u.id = ur.user_id
   and r.id = ur.role_id
   and r.slug = 'super_admin'
   and u.id = '1f39803f-d602-4a89-90b1-72ea5d3b69e1'::uuid
   and lower(btrim(coalesce(u.email, ''))) = 'martin@logisticatops.com';

update public.user_roles ur
   set position_title = null
  from auth.users u, public.roles r
 where u.id = ur.user_id
   and r.id = ur.role_id
   and r.slug = 'director_ops'
   and u.id = '3b1607c9-32c5-4ca0-91e1-19c82099b64d'::uuid
   and lower(btrim(coalesce(u.email, ''))) = 'joseluis@logisticatops.com';

update public.user_roles ur
   set position_title = null
  from auth.users u, public.roles r
 where u.id = ur.user_id
   and r.id = ur.role_id
   and r.slug = 'admin_sin_rrhh'
   and u.id = '4aa1203d-a943-4ef0-b1c5-3127fde3adfb'::uuid
   and lower(btrim(coalesce(u.email, ''))) = 'cynthia@logisticatops.com';

-- ── 3 · EL MODELO DE AUTORIDAD, AL ESTADO PREVIO ────────────────────────────
--
-- `compras.sign` vuelve a los cinco roles de los que 0259 lo sacó. La lista se
-- escribe explícita —y no por negación, como en la revocación— porque restituir
-- de más sería peor que restituir de menos: un rol que NO lo tenía antes no
-- puede terminar teniéndolo por deshacer un cambio.

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r, public.permissions p
where p.slug = 'compras.sign'
  and r.slug in (
        'admin_sin_rrhh',
        'administracion_finanzas',
        'director_ops',
        'gerencia_comercial',
        'super_admin'
      )
on conflict (role_id, permission_id) do nothing;

-- El rol de firma desaparece con todo lo que colgaba de él. Se borra por
-- último: mientras existiera sin `compras.sign`, quedaría un rol asignado a
-- tres personas que no significa nada.
delete from public.user_roles ur
using public.roles r
where ur.role_id = r.id and r.slug = 'firmante_oc';

delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id and r.slug = 'firmante_oc';

delete from public.roles r where r.slug = 'firmante_oc';

-- Post-condición del regreso: el reparto previo, exacto, y ni rastro del rol.
do $post$
declare v_roles text[]; v_quedan integer;
begin
  -- `collate "C"` por la misma razón que en 0259: el orden no puede depender
  -- del collation de la base donde corra el rollback.
  select coalesce(array_agg(r.slug order by r.slug collate "C"), '{}')
    into v_roles
  from public.role_permissions rp
  join public.roles r on r.id = rp.role_id
  join public.permissions p on p.id = rp.permission_id
  where p.slug = 'compras.sign';
  if v_roles is distinct from array[
       'admin_sin_rrhh','administracion_finanzas','director_ops',
       'gerencia_comercial','super_admin'
     ] then
    raise exception 'ROLLBACK_0259_REPARTO_INESPERADO: compras.sign quedó en % (se esperaban los cinco roles previos)', v_roles;
  end if;
  select count(*) into v_quedan from public.roles where slug = 'firmante_oc';
  if v_quedan <> 0 then
    raise exception 'ROLLBACK_0259_ROL_RESIDUAL: firmante_oc sobrevivió al rollback';
  end if;
end;
$post$;

commit;
