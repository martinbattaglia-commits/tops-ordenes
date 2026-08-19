-- ============================================================================
-- 0259 · OC-FIRMANTE-POR-PERMISO
--        El emisor de una orden de compra deja de ser un correo escrito a mano.
-- ============================================================================
--
-- ─── EL DEFECTO QUE CIERRA ──────────────────────────────────────────────────
--
-- `0243_purchase_order_price_lifecycle.sql` resolvía el firmante así:
--
--     select 'José Luis Rodríguez Silva',              -- literal
--            lower(btrim(u.email)),
--            'Director de Operaciones y Apoderado'      -- literal
--       into v_signer, v_emitter_email, v_emitter_role
--      ...
--      where lower(btrim(coalesce(u.email,''))) = 'joseluis@logisticatops.com'  -- literal
--
-- Tres literales: nombre, cargo y correo. Ni un rol, ni un permiso, ni una
-- tabla. La función preguntaba por una IDENTIDAD en vez de por una AUTORIDAD,
-- y con eso saltaba por encima del modelo de seguridad entero: `super_admin` y
-- `gerencia` quedaban afuera aunque `has_permission('compras.sign')` ya les
-- diera TRUE cuatro líneas antes, y morían con «No se pudo resolver el firmante
-- canónico de la sesión» — un mensaje que no dice nada de lo que pasó.
--
-- ─── LA REGLA QUE INSTALA ───────────────────────────────────────────────────
--
--   Quién PUEDE emitir se resuelve por PERMISO: `compras.create` +
--   `compras.sign`. Ese gate ya existía y NO SE TOCA.
--
--   Quién ES el firmante sale del PERFIL del actor de la sesión:
--     · nombre → `public.profiles.full_name`
--     · cargo  → `public.user_roles.position_title`
--
--   Si falta el nombre o el cargo, la emisión RECHAZA con mensaje propio y
--   accionable. Un documento que obliga a la empresa no sale firmado en blanco
--   ni con el cargo de otra persona.
--
-- ─── LO QUE NO CAMBIA ───────────────────────────────────────────────────────
--
--   · la firma de la función sigue siendo `(jsonb, jsonb)` — IDÉNTICA. Un
--     `create or replace` con otra firma crearía una SOBRECARGA, no un
--     reemplazo, y dejaría la versión vieja viva y alcanzable;
--   · el gate de perfil activo, la forma del payload, la validación de líneas,
--     la inmutabilidad de precios y las guardas de precio pendiente de 0243
--     quedan BYTE A BYTE como estaban. El único bloque que cambia es el del
--     firmante, más la declaración de una variable auxiliar;
--   · las 24 órdenes ya emitidas NO se tocan: esta migración no escribe una
--     sola fila de `public.purchase_orders`.
--
-- ─── ROLLBACK ───────────────────────────────────────────────────────────────
--
--   `ROLLBACK_0259_purchase_order_signer_by_permission.sql` restaura la función
--   de 0243 tal cual y revierte los dos datos de cargo que esta migración carga.
--
-- ============================================================================

begin;

-- ── 1 · LOS CARGOS QUE ESTA MIGRACIÓN CARGA ─────────────────────────────────
--
-- Sólo dos, y ninguno inventado:
--
--   · Dirección (`martin.battaglia@` y `martin@`) → 'Presidente'. Dato provisto
--     por Dirección como fuente autoritativa. El valor previo en base era
--     'Presidente · Super Administrador', que mezcla el cargo de la empresa con
--     la etiqueta del rol del sistema; un documento que obliga a la empresa
--     declara el cargo, no el rol técnico.
--
--   · José Luis Rodríguez Silva (`joseluis@`) → 'Director de Operaciones y
--     Apoderado'. NO es un cargo nuevo: es EXACTAMENTE el literal que 0243 ya
--     estampaba en sus 24 órdenes. Se migra del código al dato para que el único
--     firmante histórico siga emitiendo con el mismo cargo de siempre.
--
-- Ningún otro usuario recibe cargo acá. Quien no lo tenga será rechazado con el
-- mensaje propio, que es justamente el comportamiento buscado.

update public.user_roles ur
   set position_title = 'Presidente'
  from auth.users u, public.roles r
 where u.id = ur.user_id
   and r.id = ur.role_id
   and r.slug = 'super_admin'
   and lower(btrim(coalesce(u.email, ''))) in (
         'martin.battaglia@logisticatops.com',
         'martin@logisticatops.com'
       );

update public.user_roles ur
   set position_title = 'Director de Operaciones y Apoderado'
  from auth.users u, public.roles r
 where u.id = ur.user_id
   and r.id = ur.role_id
   and r.slug = 'director_ops'
   and lower(btrim(coalesce(u.email, ''))) = 'joseluis@logisticatops.com';

-- ── 2 · LA COMPUERTA ────────────────────────────────────────────────────────
--
-- Cuerpo completo de `purchase_order_issue` reemitido con la MISMA firma. El
-- delta contra 0243 son exactamente dos bloques: la declaración de
-- `v_role_titles` y la resolución del firmante.

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
  -- 0259 · cantidad de cargos distintos declarados por los roles del actor.
  v_role_titles integer;
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

  -- OC-FIRMANTE-POR-PERMISO · 0259 · LA IDENTIDAD DEL FIRMANTE SALE DEL PERFIL.
  --
  -- Hasta 0243 este bloque comparaba el correo del actor contra un literal
  -- ('joseluis@logisticatops.com') y devolvía otros dos literales como nombre y
  -- cargo. Esa condición saltaba por encima del modelo de seguridad completo:
  -- no preguntaba por un rol ni por un permiso, y dejaba afuera a super_admin y
  -- a gerencia aunque `compras.sign` ya les diera TRUE cuatro líneas más arriba.
  --
  -- QUIÉN PUEDE emitir ya quedó resuelto por ese gate de permisos, que NO se
  -- toca. Acá sólo se resuelve QUIÉN ES, y sale del perfil del actor.
  select p.full_name, lower(btrim(u.email))
  into v_signer, v_emitter_email
  from auth.users u
  join public.profiles p on p.id=u.id
  where u.id = v_actor
    and p.active
  for share of p, u;
  if not found then
    raise exception 'No se pudo resolver el perfil activo del firmante de la sesión'
      using errcode = 'insufficient_privilege';
  end if;

  -- EL CARGO sale de `user_roles.position_title`, la única columna de cargo que
  -- existe en el esquema. Se exige exactamente UNO distinto y no vacío:
  --   · cero  => el perfil no tiene cargo cargado;
  --   · más de uno => el cargo es ambiguo.
  -- Los dos casos rechazan con mensaje propio. Un documento que obliga a la
  -- empresa no sale firmado en blanco ni con el cargo de otra persona.
  select count(distinct btrim(ur.position_title)), min(btrim(ur.position_title))
  into v_role_titles, v_emitter_role
  from public.user_roles ur
  where ur.user_id = v_actor
    and length(btrim(coalesce(ur.position_title, ''))) >= 2;

  if v_signer is null or length(btrim(v_signer)) < 2 then
    raise exception 'El perfil del firmante no tiene nombre cargado: cargá el nombre del usuario antes de emitir'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(v_role_titles, 0) = 0 then
    raise exception 'El perfil del firmante no tiene cargo cargado: cargá el cargo del usuario en su rol antes de emitir'
      using errcode = 'insufficient_privilege';
  end if;
  if v_role_titles > 1 then
    raise exception 'El cargo del firmante es ambiguo: el usuario declara más de un cargo en sus roles'
      using errcode = 'insufficient_privilege';
  end if;
  if v_emitter_email is null or length(v_emitter_email) > 254
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

commit;
