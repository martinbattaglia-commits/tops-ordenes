-- 0242_clients_atomic_mutations.sql — NEXUS-CLIENTES-ORDENES-PRECIOS-USUARIOS-001 · Carril A.
-- ─────────────────────────────────────────────────────────────────────────
-- CIERRA D-1 y D-2 del dictamen C4 FAIL, y fija la identidad canónica de la
-- capacidad `wms.clients.create` (D-5).
--
-- ─── QUÉ ESTABA ROTO ──────────────────────────────────────────────────────
--
-- D-1 · 0241 revocó toda escritura de `client_events` a `service_role` y le
-- dejó sólo SELECT —correcto: una auditoría que el auditado puede borrar no
-- es evidencia—. Pero la aplicación seguía insertando el evento con
-- `createAdminClient()`, que ES `service_role`. Resultado medido: cada
-- mutación de cliente producía `permission denied`, el error se tragaba en
-- `console.error` y la UI devolvía éxito. `client_events` quedaba vacía para
-- siempre, en silencio. El endurecimiento del privilegio era correcto; lo que
-- faltaba era el camino legítimo de escritura.
--
-- D-2 · Las tres escrituras sobre `clients` iban por `service_role`, cuyo JWT
-- no lleva claim `sub`. `auth.uid()` devolvía NULL y el `coalesce` de
-- `clients_stamp_update` conservaba el valor anterior: `updated_by` no se
-- sellaba nunca, que es exactamente la carencia que 0241 decía cerrar.
--
-- ─── CÓMO SE CIERRA ───────────────────────────────────────────────────────
--
-- La mutación del cliente y su evento de auditoría pasan a ser UNA SOLA
-- UNIDAD ATÓMICA dentro de una RPC. El cuerpo de una función plpgsql corre en
-- una única transacción: si el evento falla, la mutación del cliente se
-- revierte con él. Ya no existe forma de que una modificación quede sin su
-- rastro, ni de devolver éxito con la auditoría caída.
--
-- El criterio de fondo lo estableció 0222 para Custodia: «Sólo SELECT para
-- authenticated Y para service_role: sin INSERT/UPDATE/DELETE, toda escritura
-- pasa obligatoriamente por las RPC SECURITY DEFINER».
--
-- PRECISIÓN NECESARIA, porque una versión anterior de este comentario afirmaba
-- que el patrón era «el mismo» y era FALSO: 0222 usa `enable row level
-- security`, NUNCA `force`. Se verificó que `force` aparecía en una sola línea
-- de todo el árbol —la que 0241 introdujo— y es justamente el elemento que
-- rompía el constructo. Ver el bloque siguiente.
--
-- `client_events` queda SIN INSERT para nadie. La única vía de escritura son
-- estas RPC.
--
-- ─── POR QUÉ SECURITY DEFINER, Y CÓMO NO SE VUELVE TAUTOLÓGICO ────────────
--
-- Las RPC son SECURITY DEFINER porque necesitan escribir en una tabla que no
-- concede INSERT a nadie. El riesgo conocido de ese constructo es que dentro
-- de una función DEFINER `current_user` es el DUEÑO de la función, de modo
-- que cualquier autorización basada en él sería tautológica: se estaría
-- preguntando si el dueño puede hacer lo que el dueño acaba de hacer.
--
-- Por eso NINGÚN control de estas funciones mira `current_user`. El actor sale
-- SIEMPRE de `auth.uid()`, que lee el JWT del llamador real y no cambia por
-- estar dentro de un DEFINER. Y el permiso se resuelve con `has_permission`,
-- que también se apoya en `auth.uid()`.
--
-- Defensas del constructo, todas presentes:
--   · `search_path` fijo — sin él, el llamador podría anteponer un esquema y
--     secuestrar la resolución de `clients`, `client_events` o `has_permission`;
--   · sin identidad no se opera: `auth.uid()` NULL aborta;
--   · el actor NO es parámetro — no se puede elegir a nombre de quién se
--     escribe;
--   · `revoke execute from public, anon` + grant explícito a `authenticated`;
--   · el permiso se verifica DENTRO de la función, así que una llamada directa
--     por PostgREST está tan controlada como una desde la UI.
--
-- REQUIERE: 0240 y 0241.

-- ── 1 · Se retira FORCE, que rompía la única vía legítima ──────────────
--
-- Una versión anterior de 0241 ponía `force row level security` sobre
-- `client_events`. Con FORCE, el DUEÑO de la tabla queda sujeto a las
-- policies; y una función SECURITY DEFINER se ejecuta como su dueño. La única
-- policy de INSERT era `to authenticated`, rol que el dueño no es, de modo que
-- las RPC de abajo sólo podrían escribir si el dueño tuviera BYPASSRLS. 0241
-- ya no lo pone.
--
-- Eso deja dos desenlaces y los dos son malos: sin BYPASSRLS, toda alta,
-- edición y desactivación de cliente muere con violación de RLS —la misma
-- muerte silenciosa que este expediente vino a cerrar, por un mecanismo
-- nuevo—; y con BYPASSRLS, FORCE no aporta nada frente a ese rol. Depender de
-- un atributo del rol que aplica las migraciones es una precondición no
-- declarada y frágil.
--
-- 0241 ya no lo pone. Esta sentencia queda como DEFENSA IDEMPOTENTE: si algún
-- entorno hubiera aplicado la forma anterior de 0241 —la que sí ponía FORCE—,
-- acá se corrige. Sobre una base donde nunca se puso, no hace nada.
--
-- La contención NO se apoya en la RLS sino en el PRIVILEGIO: nadie tiene
-- INSERT. Se conserva ENABLE.
alter table public.client_events no force row level security;

-- La policy de INSERT `to authenticated` de 0241 queda SIN consumidor
-- legítimo: ese rol ya no tiene el privilegio. Se elimina para que no quede
-- como puerta latente si algún día alguien concediera el grant por descuido.
drop policy if exists "client_events insert internal" on public.client_events;

-- Enumeración COMPLETA. Revocar sólo de `public` no alcanza: el bootstrap de
-- Supabase concede por default privileges a los tres roles.
revoke insert on public.client_events from public, anon, authenticated, service_role;

-- La atomicidad tambien exige cerrar la tabla MAESTRA. Si authenticated o
-- service_role conservaran INSERT/UPDATE/DELETE/TRUNCATE sobre `clients`, un
-- llamador podria saltar las RPC y dejar una mutacion sin su evento. La RLS y
-- el trigger de updated_by no alcanzan: controlan filas/actor, pero no obligan
-- a escribir la auditoria en la misma transaccion.
revoke insert, update, delete, truncate on public.clients
  from public, anon, authenticated, service_role;

-- La policy legacy FOR ALL también actuaba como SELECT permisivo y dejaba
-- leer el maestro a cualquier perfil operaciones/supervisor aunque no tuviera
-- `clientes.view`. Al cerrar toda mutación directa, se retira también esa
-- puerta latente y cualquier variante acotada de un rollback anterior.
drop policy if exists "clients write internal" on public.clients;
drop policy if exists "clients insert internal" on public.clients;
drop policy if exists "clients update internal" on public.clients;

comment on table public.client_events is
  'Auditoría append-only de clientes. Sin INSERT directo para ningún rol: la única vía de escritura son las RPC client_create / client_update / client_set_active de 0242, que la escriben en la MISMA transacción que la mutación auditada. GARANTÍA: inalterable frente a usuarios y caminos aplicativos ordinarios. NO frente al propietario de la base, a un superusuario ni a la administración de infraestructura.';

comment on table public.clients is
  'Registro maestro nativo. Sin mutación directa para anon/authenticated/service_role: altas, cambios y activación/desactivación pasan por las RPC atómicas de 0242.';

-- ── 2 · Alta atómica ───────────────────────────────────────────────────
create or replace function public.client_create(
  p_razon            text,
  p_cuit             text,
  p_nombre_comercial text default null,
  p_codigo           text default null,
  p_telefono         text default null,
  p_contacto         text default null,
  p_email            text default null,
  p_tags             text[] default '{}',
  p_condicion_iva    text default 'RESPONSABLE_INSCRIPTO',
  p_cuenta_contable  text default null,
  p_origen           text default 'clientes',
  -- Ids de los clientes parecidos que se le advirtieron al operador y que aun
  -- así decidió ignorar. Null = alta sin advertencia previa. No participa de
  -- ninguna decisión: sólo se registra, para que la auditoría distinga un alta
  -- limpia de una forzada. La advertencia se resuelve en la aplicación, que es
  -- donde vive el ida y vuelta con la persona.
  p_duplicados_advertidos uuid[] default null,
  p_domicilio         text default null,
  p_localidad         text default null,
  p_deposito_asignado text default null,
  p_observaciones     text default null
)
returns public.clients
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_cuit  text := regexp_replace(coalesce(p_cuit, ''), '\D', '', 'g');
  v_row   public.clients;
  v_cap   text;
begin
  -- Sin identidad no se opera. Un proceso de servicio sin JWT no puede crear
  -- clientes: la auditoría quedaría sin actor y sería inservible.
  if v_actor is null then
    raise exception 'CLIENT_SIN_IDENTIDAD: la creación de clientes exige un usuario autenticado'
      using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_actor and p.active
  ) then
    raise exception 'CLIENT_SIN_PERFIL_ACTIVO: la sesión no tiene un perfil activo'
      using errcode = '42501';
  end if;

  -- El origen decide QUÉ capacidad se exige. `wms` es el alta rápida desde un
  -- flujo operativo, que NO concede acceso al módulo general de Clientes.
  -- La lista es cerrada también en DB: una llamada directa no puede inventar
  -- un origen externo y dejarlo asentado en la auditoría nativa.
  if p_origen not in ('clientes','wms') then
    raise exception 'CLIENT_ORIGEN_INVALIDO: %', p_origen using errcode = '22023';
  end if;
  v_cap := case p_origen when 'wms' then 'wms.clients.create' else 'clientes.create' end;
  if public.has_permission(v_cap) is distinct from true then
    raise exception 'CLIENT_DENEGADO: se requiere el permiso %', v_cap
      using errcode = '42501';
  end if;

  if not public.cuit_is_valid(v_cuit) then
    raise exception 'CLIENT_CUIT_INVALIDO: el CUIT debe tener 11 dígitos y un dígito verificador válido'
      using errcode = '22023';
  end if;
  if btrim(coalesce(p_razon, '')) = '' then
    raise exception 'CLIENT_RAZON_VACIA: la razón social es obligatoria' using errcode = '22023';
  end if;

  insert into public.clients (
    razon, cuit, nombre_comercial, codigo, telefono, contacto, email, tags,
    condicion_iva, cuenta_contable, domicilio, localidad, deposito_asignado,
    observaciones, created_by, updated_by
  ) values (
    btrim(p_razon), v_cuit, nullif(btrim(coalesce(p_nombre_comercial, '')), ''),
    nullif(btrim(coalesce(p_codigo, '')), ''), nullif(btrim(coalesce(p_telefono, '')), ''),
    nullif(btrim(coalesce(p_contacto, '')), ''), nullif(btrim(coalesce(p_email, '')), ''),
    coalesce(p_tags, '{}'), p_condicion_iva::public.condicion_iva_t,
    nullif(btrim(coalesce(p_cuenta_contable, '')), ''),
    nullif(btrim(coalesce(p_domicilio, '')), ''),
    nullif(btrim(coalesce(p_localidad, '')), ''),
    nullif(btrim(coalesce(p_deposito_asignado, '')), '')::public.depot_t,
    nullif(btrim(coalesce(p_observaciones, '')), ''),
    v_actor, v_actor
  )
  returning * into v_row;

  -- MISMA TRANSACCIÓN. Si esto falla, el insert de arriba se va con él.
  insert into public.client_events (client_id, kind, origin, after, motivo)
  values (
    v_row.id, 'created', 'manual', to_jsonb(v_row),
    'alta desde ' || p_origen ||
    case
      when p_duplicados_advertidos is null or cardinality(p_duplicados_advertidos) = 0 then ''
      else ' · confirmada pese a ' || cardinality(p_duplicados_advertidos)
           || ' parecido(s) advertido(s): '
           || array_to_string(p_duplicados_advertidos::text[], ', ')
    end
  );

  return v_row;
end;
$$;

-- ── 3 · Modificación atómica ───────────────────────────────────────────
-- ── SEMÁNTICA TRIESTADO ────────────────────────────────────────────────
-- Un parámetro nulo significa «no lo toques», no «vacialo». Sin una tercera
-- señal, LIMPIAR un campo opcional era imposible: `coalesce(nuevo, viejo)`
-- conserva el valor anterior ante un nulo.
--
-- Eso produjo un defecto real y silencioso: quitar una cuenta contable mal
-- imputada devolvía «Guardado», la cuenta seguía ahí, toda la facturación
-- posterior seguía imputando al lugar equivocado, y encima quedaba un evento
-- de auditoría con `before == after` — un cambio registrado que no ocurrió.
--
-- `p_limpiar` es esa tercera señal: enumera EXPLÍCITAMENTE qué campos se
-- vacían. Vaciar es un acto declarado, no el efecto lateral de mandar null.
create or replace function public.client_update(
  p_id               uuid,
  p_razon            text default null,
  p_nombre_comercial text default null,
  p_codigo           text default null,
  p_telefono         text default null,
  p_contacto         text default null,
  p_email            text default null,
  p_condicion_iva    text default null,
  p_cuenta_contable  text default null,
  p_motivo           text default null,
  p_limpiar          text[] default '{}',
  p_domicilio        text default null,
  p_localidad        text default null,
  p_deposito_asignado text default null,
  p_observaciones    text default null,
  p_tags             text[] default null,
  p_expected_updated_at timestamptz default null
)
returns public.clients
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor  uuid := auth.uid();
  v_before public.clients;
  v_row    public.clients;
  v_campo  text;
begin
  if v_actor is null then
    raise exception 'CLIENT_SIN_IDENTIDAD: la edición de clientes exige un usuario autenticado'
      using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_actor and p.active
  ) then
    raise exception 'CLIENT_SIN_PERFIL_ACTIVO: la sesión no tiene un perfil activo'
      using errcode = '42501';
  end if;
  if public.has_permission('clientes.edit') is distinct from true then
    raise exception 'CLIENT_DENEGADO: se requiere el permiso clientes.edit' using errcode = '42501';
  end if;

  -- El lock se toma ANTES de fotografiar `before`. Sin `for update`, dos
  -- ediciones concurrentes pueden leer la misma versión, pisarse y dejar dos
  -- eventos que afirman partir del mismo estado. El lock serializa la cadena
  -- probatoria y el CAS OBLIGATORIO evita que una llamada directa omita el
  -- token para sobrescribir silenciosamente una corrección ya confirmada.
  select * into v_before from public.clients where id = p_id for update;
  if not found then
    raise exception 'CLIENT_INEXISTENTE: %', p_id using errcode = 'P0002';
  end if;

  if p_expected_updated_at is null then
    raise exception 'CLIENT_CONFLICTO_CONCURRENTE: falta la versión esperada de la ficha'
      using errcode = '40001';
  end if;
  if v_before.updated_at is distinct from p_expected_updated_at then
    raise exception
      'CLIENT_CONFLICTO_CONCURRENTE: la ficha cambió desde que fue abierta (esperado %, actual %)',
      p_expected_updated_at, v_before.updated_at using errcode = '40001';
  end if;

  if p_razon is not null and btrim(p_razon) = '' then
    raise exception 'CLIENT_RAZON_VACIA: la razón social es obligatoria' using errcode = '22023';
  end if;

  -- Sólo se pueden vaciar campos OPCIONALES y enumerados. Un nombre no
  -- reconocido aborta: fallar es preferible a ignorar en silencio lo que
  -- alguien pidió limpiar.
  if p_limpiar is not null then
    foreach v_campo in array p_limpiar loop
      if v_campo not in (
        'nombre_comercial','codigo','telefono','contacto','email','cuenta_contable',
        'domicilio','localidad','deposito_asignado','observaciones'
      ) then
        raise exception 'CLIENT_CAMPO_NO_LIMPIABLE: %', v_campo using errcode = '22023';
      end if;
    end loop;
  end if;

  -- `cuit` NO es parámetro y NO es limpiable: es la unicidad de la tabla y la
  -- clave por la que se resuelve identidad en media docena de módulos.
  -- `razon` tampoco: es obligatoria.
  update public.clients set
    razon            = coalesce(nullif(btrim(coalesce(p_razon, '')), ''), razon),
    nombre_comercial = case when 'nombre_comercial' = any(coalesce(p_limpiar,'{}')) then null
                            else coalesce(nullif(btrim(coalesce(p_nombre_comercial, '')), ''), nombre_comercial) end,
    codigo           = case when 'codigo' = any(coalesce(p_limpiar,'{}')) then null
                            else coalesce(nullif(btrim(coalesce(p_codigo, '')), ''), codigo) end,
    telefono         = case when 'telefono' = any(coalesce(p_limpiar,'{}')) then null
                            else coalesce(nullif(btrim(coalesce(p_telefono, '')), ''), telefono) end,
    contacto         = case when 'contacto' = any(coalesce(p_limpiar,'{}')) then null
                            else coalesce(nullif(btrim(coalesce(p_contacto, '')), ''), contacto) end,
    email            = case when 'email' = any(coalesce(p_limpiar,'{}')) then null
                            else coalesce(nullif(btrim(coalesce(p_email, '')), ''), email) end,
    condicion_iva    = coalesce(p_condicion_iva::public.condicion_iva_t, condicion_iva),
    cuenta_contable  = case when 'cuenta_contable' = any(coalesce(p_limpiar,'{}')) then null
                            else coalesce(nullif(btrim(coalesce(p_cuenta_contable, '')), ''), cuenta_contable) end,
    domicilio        = case when 'domicilio' = any(coalesce(p_limpiar,'{}')) then null
                            else coalesce(nullif(btrim(coalesce(p_domicilio, '')), ''), domicilio) end,
    localidad        = case when 'localidad' = any(coalesce(p_limpiar,'{}')) then null
                            else coalesce(nullif(btrim(coalesce(p_localidad, '')), ''), localidad) end,
    deposito_asignado = case when 'deposito_asignado' = any(coalesce(p_limpiar,'{}')) then null
                             else coalesce(nullif(btrim(coalesce(p_deposito_asignado, '')), '')::public.depot_t, deposito_asignado) end,
    observaciones    = case when 'observaciones' = any(coalesce(p_limpiar,'{}')) then null
                            else coalesce(nullif(btrim(coalesce(p_observaciones, '')), ''), observaciones) end,
    tags             = coalesce(p_tags, tags)
  where id = p_id
  returning * into v_row;

  -- Un evento de auditoría que registre un cambio que no ocurrió es ruido que
  -- ensucia la evidencia. Si nada cambió, no se escribe nada.
  --
  -- La comparación EXCLUYE `updated_at` y `updated_by`: son sellos, no
  -- contenido. `clients_touch_updated_at` (0004) estampa `updated_at` en TODO
  -- update, así que compararlos haría que la guarda no dispare nunca y todo
  -- ciclo vacío dejara su evento igual.
  if (to_jsonb(v_before) - 'updated_at' - 'updated_by')
     is distinct from
     (to_jsonb(v_row) - 'updated_at' - 'updated_by') then
    insert into public.client_events (client_id, kind, origin, before, after, motivo)
    values (p_id, 'updated', 'manual', to_jsonb(v_before), to_jsonb(v_row), p_motivo);
  end if;

  return v_row;
end;
$$;

-- ── 4 · Activación / desactivación atómica ─────────────────────────────
create or replace function public.client_set_active(
  p_id     uuid,
  p_activo boolean,
  p_motivo text
)
returns public.clients
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor  uuid := auth.uid();
  v_before public.clients;
  v_row    public.clients;
begin
  if v_actor is null then
    raise exception 'CLIENT_SIN_IDENTIDAD: exige un usuario autenticado' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_actor and p.active
  ) then
    raise exception 'CLIENT_SIN_PERFIL_ACTIVO: la sesión no tiene un perfil activo'
      using errcode = '42501';
  end if;
  if public.has_permission('clientes.delete') is distinct from true then
    raise exception 'CLIENT_DENEGADO: se requiere el permiso clientes.delete' using errcode = '42501';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'CLIENT_MOTIVO_REQUERIDO: el motivo es obligatorio' using errcode = '22023';
  end if;

  -- Serializa también los cambios de estado: `before` debe ser la versión
  -- realmente reemplazada, no una lectura obsoleta tomada antes de otro actor.
  select * into v_before from public.clients where id = p_id for update;
  if not found then
    raise exception 'CLIENT_INEXISTENTE: %', p_id using errcode = 'P0002';
  end if;

  -- Repetir el mismo estado es idempotente y no fabrica un evento falso.
  if v_before.activo is not distinct from p_activo then
    return v_before;
  end if;

  -- Un cliente NUNCA se elimina físicamente: las órdenes y recepciones
  -- históricas lo referencian y su valor probatorio depende de que siga ahí.
  update public.clients set activo = p_activo where id = p_id returning * into v_row;

  insert into public.client_events (client_id, kind, origin, before, after, motivo)
  values (
    p_id,
    case when p_activo then 'activated' else 'deactivated' end,
    'manual',
    jsonb_build_object('activo', v_before.activo),
    jsonb_build_object('activo', v_row.activo),
    btrim(p_motivo)
  );

  return v_row;
end;
$$;

-- ── 5 · Privilegios de las RPC ─────────────────────────────────────────
-- Toda función nace con EXECUTE para PUBLIC, y Supabase suma default
-- privileges por rol: revocar sólo de `public` dejaría la RPC alcanzable por
-- `anon`. Se usa la enumeración completa, igual que 0222:92 y 0235:184.
revoke execute on function public.client_create(text, text, text, text, text, text, text, text[], text, text, text, uuid[], text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.client_update(uuid, text, text, text, text, text, text, text, text, text, text[], text, text, text, text, text[], timestamptz) from public, anon, authenticated, service_role;
revoke execute on function public.client_set_active(uuid, boolean, text)                                             from public, anon, authenticated, service_role;

grant execute on function public.client_create(text, text, text, text, text, text, text, text[], text, text, text, uuid[], text, text, text, text) to authenticated;
grant execute on function public.client_update(uuid, text, text, text, text, text, text, text, text, text, text[], text, text, text, text, text[], timestamptz) to authenticated;
grant execute on function public.client_set_active(uuid, boolean, text)                                             to authenticated;

-- ── 6 · La capacidad de alta desde WMS queda REGISTRADA o la migración aborta ──
-- 0241 la sembró con `on conflict do nothing` sin target. Eso protege el
-- despliegue de un choque en `(module, action)` —`permissions` tiene DOS
-- restricciones únicas, 0009:44,50— pero a cambio la omitiría EN SILENCIO si
-- el slot estuviera ocupado, dejando un permiso muerto que ningún rol podría
-- recibir. Un permiso que la UI exige y el catálogo no tiene es una denegación
-- permanente sin explicación.
--
-- Acá se verifica la fila EXACTA. Si no quedó registrada con su slug, su
-- módulo y su acción, la migración falla y dice por qué.
do $$
declare
  v_slug   text;
  v_ocupa  text;
begin
  select slug into v_slug
    from public.permissions
   where slug = 'wms.clients.create' and module = 'wms' and action = 'create';

  if v_slug is null then
    select slug into v_ocupa
      from public.permissions where module = 'wms' and action = 'create';
    raise exception
      'CAPACIDAD_NO_REGISTRADA: wms.clients.create no quedó en el catálogo. El slot (wms, create) está ocupado por %. Resolver la representación canónica antes de continuar: la UI exige esa capacidad y sin la fila sería una denegación permanente.',
      coalesce(v_ocupa, '(nadie: la fila no se insertó por otra causa)');
  end if;
end$$;

notify pgrst, 'reload schema';
