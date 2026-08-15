-- 0241_clients_native_master.sql — NEXUS-CLIENTES-ORDENES-PRECIOS-USUARIOS-001 · Carril A.
-- ─────────────────────────────────────────────────────────────────────────
-- ADITIVA y BACKWARD-COMPATIBLE. No borra ni reescribe ninguna fila, no
-- relaja RLS, no hace backfill de datos de negocio y no toca 0219/0220.
--
-- QUÉ CIERRA
-- `public.clients` es la identidad canónica que ya consumen `orders`,
-- `receptions`, `inventory_items`, `logistics_orders` y `profiles`, pero le
-- faltaban las piezas para ser un REGISTRO MAESTRO administrable:
--
--   · no registra QUIÉN modificó (hay `created_by`, no `updated_by`);
--   · no tiene nombre comercial ni código, que son dos de los criterios de
--     búsqueda que la operación pide;
--   · no tiene auditoría de cambios.
--
-- MEDIDO EN PRODUCCIÓN (2026-08-14): 27 clientes, 27 activos, 0 duplicados
-- por CUIT, 0 duplicados por razón social normalizada, 0 CUIT de longitud
-- distinta de 11. La base está limpia: no hay nada que deduplicar ni reparar,
-- y por eso esta migración NO incluye ninguna resolución automática de
-- duplicados. La unicidad que se agrega es sobre columnas NUEVAS y vacías.
--
-- BÚSQUEDA NORMALIZADA
-- `nx_text_norm` es IMMUTABLE porque usa la forma de dos argumentos de
-- `unaccent` (`unaccent(regdictionary, text)`), que sí lo es; la de un solo
-- argumento es STABLE —depende del search_path para resolver el diccionario—
-- y no puede indexarse. Sin esto, el índice GIN sería rechazado.
--
-- El índice de CUIT indexa la expresión de sólo-dígitos, de modo que
-- "30-71234567-8", "30712345678" y "30 71234567 8" son la misma búsqueda.
--
-- RLS
-- `client_events` replica EXACTAMENTE el scoping de `public.clients`
-- (0001_init.sql:198-206): internos por `current_role()`, y el usuario de
-- portal sólo los eventos de SU propio cliente vía `profiles.client_id`. No
-- se usa `using (true)`: eso filtraría razón social, CUIT, email, teléfono,
-- domicilio y contacto de los 27 clientes —más `actor_email` e `ip` de los
-- operadores internos— a cualquier usuario autenticado del portal.
--
-- La contención de `service_role` viene del `revoke all ... from ...
-- service_role` de más abajo, que le quita el privilegio de tabla que el
-- bootstrap de Supabase le concede por defecto. NO se usa FORCE ROW LEVEL
-- SECURITY: sujetaría al DUEÑO de la tabla a las policies, y una RPC SECURITY
-- DEFINER corre como su dueño, de modo que rompería la única vía de escritura
-- legítima. La contención es el PRIVILEGIO, no la RLS.
--
-- GARANTÍA HONESTA, sin adornos: `client_events` es inalterable frente a los
-- usuarios y a los caminos aplicativos ordinarios, y su única vía de mutación
-- es la RPC autorizada de 0242. NO es inmutable frente al propietario de la
-- base, a un superusuario ni a quien administre la infraestructura. Ninguna
-- construcción de PostgreSQL ofrece esa segunda garantía, y prometerla sería
-- falso.
--
-- Los campos de atribución (`ts`, `actor`, `actor_email`) los SELLA un
-- trigger server-side. Si los aceptara del cliente, cualquier autenticado
-- podría insertar un asiento atribuido a otra persona: una auditoría cuyos
-- asientos escribe el auditado, firmando con nombre ajeno, no es evidencia.
--
-- ALCANCE · CLIENTES 100 % NATIVOS
-- Por decisión expresa de Dirección, Clientify queda FUERA del registro
-- maestro de clientes. Esta migración no crea NADA que dependa de un sistema
-- externo: ni estado de sincronización, ni columnas de procedencia, ni sus
-- índices.
--
-- Se evaluaron `external_source` / `external_id` y su índice único como
-- posible legado, y se retiraron tras MEDIR las cinco condiciones contra
-- producción el 2026-08-14:
--   · no existen en el esquema productivo (0 columnas, 0 índices);
--   · las introducía sólo esta migración, que nunca fue aplicada — lo prueba
--     que tampoco están `nombre_comercial`, `codigo` ni `updated_by`;
--   · por lo tanto no contienen ningún dato histórico;
--   · no tienen un solo consumidor en `src/`;
--   · ninguna migración previa agregó una columna de procedencia externa a
--     `clients`, así que no cumplen función nativa alguna.
-- Introducirlas habría sido dejar columnas e índices muertos en producción.
--
-- La integración de Clientify que usan otros módulos (comercial, prospección,
-- webhooks, dashboards) NO se toca: son 14 archivos ajenos a este flujo.
--
-- LO QUE ESTA MIGRACIÓN NO HACE
--   · no crea ni modifica clientes;
--   · no toca `orders`, `order_services`, `purchase_orders` ni WMS;
--   · no altera el enum de estados de ninguna orden;
--   · no concede permisos a ningún rol: sólo SIEMBRA el catálogo de permisos.
--     La asignación rol→permiso es un acto separado y explícito.
--
-- REQUIERE: 0240 (valor 'clientes' del enum permission_module_t).

-- ── 1 · Registro maestro: columnas faltantes ────────────────────────────
alter table public.clients
  add column if not exists nombre_comercial      text,
  add column if not exists codigo                text,
  add column if not exists observaciones         text,
  add column if not exists updated_by            uuid references auth.users(id) on delete set null;

comment on column public.clients.nombre_comercial     is 'Nombre de fantasía. Criterio de búsqueda; NO es identidad.';
comment on column public.clients.codigo               is 'Código interno corto y opcional. Único case-insensitive cuando existe.';
comment on column public.clients.observaciones        is 'Notas operativas internas del registro maestro nativo. No se sincronizan con sistemas externos.';
comment on column public.clients.updated_by           is 'Último actor que modificó la fila. Lo estampa el trigger clients_stamp_update.';

-- La policy legacy de 0001 concedía lectura por `profiles.role`, incluso si
-- el usuario no tenía la capacidad del módulo. El maestro nativo se gobierna
-- por permiso explícito; el portal conserva únicamente la lectura de su propia
-- identidad contractual.
drop policy if exists "clients read internal" on public.clients;
create policy "clients read internal"
  on public.clients for select
  to authenticated
  using (
    public.has_permission('clientes.view')
    or id = (select client_id from public.profiles where id = auth.uid())
  );

-- Código interno: único sin distinguir mayúsculas, sólo cuando existe.
create unique index if not exists clients_codigo_uk
  on public.clients (lower(codigo))
  where codigo is not null;

-- ── 2 · Normalizador indexable de texto ────────────────────────────────
-- lower + sin tildes + espacios colapsados + recortado.
create or replace function public.nx_text_norm(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select btrim(
           regexp_replace(
             lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, ''))),
             '\s+', ' ', 'g'
           )
         );
$$;

comment on function public.nx_text_norm(text) is
  'Normalización de búsqueda: minúsculas, sin tildes, espacios colapsados. IMMUTABLE (usa unaccent de dos argumentos) para poder indexarse.';

-- Sólo dígitos: unifica CUIT escrito con guiones, espacios o pegado.
create or replace function public.nx_digits(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select regexp_replace(coalesce(p_text, ''), '\D', '', 'g');
$$;

comment on function public.nx_digits(text) is
  'Deja únicamente los dígitos. Usada para comparar CUIT sin depender del formato.';

-- ── 3 · Índices de búsqueda ────────────────────────────────────────────
-- Validador de CUIT argentino: once dígitos y dígito verificador módulo 11.
-- Acepta la representación con o sin guiones; la identidad y la unicidad se
-- resuelven sobre `nx_digits`, no sobre la presentación elegida.
create or replace function public.cuit_is_valid(p_cuit text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  v_digits text := regexp_replace(coalesce(p_cuit, ''), '\D', '', 'g');
  v_weights constant int[] := array[5,4,3,2,7,6,5,4,3,2];
  v_sum int := 0;
  v_check int;
  i int;
begin
  if v_digits !~ '^[0-9]{11}$' then
    return false;
  end if;

  for i in 1..10 loop
    v_sum := v_sum + substring(v_digits from i for 1)::int * v_weights[i];
  end loop;
  v_check := 11 - (v_sum % 11);
  if v_check = 11 then v_check := 0; end if;
  if v_check = 10 then v_check := 9; end if;
  return v_check = substring(v_digits from 11 for 1)::int;
end;
$$;

comment on function public.cuit_is_valid(text) is
  'Valida longitud y dígito verificador módulo 11 de un CUIT argentino.';

-- La restricción se declara NOT VALID primero para poder emitir una causa
-- operativa clara si la cartera preexistente contiene un CUIT inválido. No se
-- corrige ni inventa ningún CUIT: el despliegue falla cerrado y exige resolver
-- el dato con su fuente documental.
alter table public.clients
  add constraint clients_cuit_checksum_ck
  check (public.cuit_is_valid(cuit)) not valid;

do $$
declare
  v_invalidos bigint;
begin
  select count(*) into v_invalidos
    from public.clients
   where not public.cuit_is_valid(cuit);
  if v_invalidos <> 0 then
    raise exception
      'CLIENT_CUIT_PREEXISTENTE_INVALIDO: % cliente(s) no superan el dígito verificador. Corregirlos contra evidencia antes de desplegar; 0241 no altera identidades.',
      v_invalidos using errcode = '23514';
  end if;
end$$;

alter table public.clients validate constraint clients_cuit_checksum_ck;

-- La UNIQUE original de 0001 compara el texto crudo. Esta segunda frontera
-- impide que el mismo CUIT se duplique por usar guiones o espacios distintos.
create unique index if not exists clients_cuit_digits_uk
  on public.clients (public.nx_digits(cuit));

-- Estas cuatro expresiones coinciden con cuatro de los seis predicados de
-- `clients_search`. Un índice sobre una concatenación
-- (razon || ' ' || nombre_comercial || …) no lo usaría ninguna consulta,
-- porque el WHERE aplica `nx_text_norm` columna por columna: sería
-- mantenimiento puro sin beneficio.
--
-- QUEDAN SIN ÍNDICE, a propósito: el predicado de `codigo` (compara con
-- `nx_text_norm`, mientras `clients_codigo_uk` indexa `lower(codigo)`: son
-- expresiones distintas y el índice único no sirve para esa búsqueda) y el de
-- `telefono`. Con 27 filas ninguno de los seis decide nada; se declara para
-- no aparentar una estrategia de indexado más completa de la que hay.
--
-- Todos son GIN trigram porque los predicados son `like '%…%'`, que un btree
-- no puede satisfacer (no sargable).
create index if not exists clients_razon_trgm_idx
  on public.clients using gin (public.nx_text_norm(razon) extensions.gin_trgm_ops);

create index if not exists clients_fantasia_trgm_idx
  on public.clients using gin (public.nx_text_norm(coalesce(nombre_comercial, '')) extensions.gin_trgm_ops);

create index if not exists clients_cuit_digits_trgm_idx
  on public.clients using gin (public.nx_digits(cuit) extensions.gin_trgm_ops);

create index if not exists clients_email_norm_trgm_idx
  on public.clients using gin (public.nx_text_norm(coalesce(email, '')) extensions.gin_trgm_ops);

-- ADVERTENCIA OPERATIVA · `unaccent` es IMMUTABLE por DECRETO, no por
-- naturaleza: su resultado depende del diccionario `extensions.unaccent` y de
-- su archivo de reglas. Si un upgrade de la extensión o un
-- `alter text search dictionary` cambia esas reglas, las entradas ya escritas
-- en estos índices quedan desincronizadas con los datos EN SILENCIO: filas
-- que existen dejan de encontrarse, sin error. El remedio es `reindex table
-- public.clients` después de cualquier cambio del diccionario.

-- ── 4 · Auditoría de clientes ──────────────────────────────────────────
--
-- ─── VOCABULARIO SIN SINCRONIZACIÓN ────────────────────────────────────
--
-- `kind` y `origin` admiten EXCLUSIVAMENTE actos nativos. Una versión previa
-- de esta tabla aceptaba los tipos `sync_attempt` y `sync_conflict` y el
-- origen `sync`, heredados del diseño en que Clientify participaba del
-- registro maestro. Ese diseño quedó sin efecto por decisión de Dirección, y
-- dejar el vocabulario habría sido peor que inútil: una tabla que sabe
-- nombrar la sincronización invita a reintroducirla, y un revisor que lee el
-- esquema no puede distinguir el residuo de la intención.
--
-- El CHECK es la frontera: hoy no existe forma de escribir un evento de
-- sincronización, ni siquiera por SQL directo.
create table if not exists public.client_events (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.clients(id) on delete cascade,
  ts          timestamptz not null default now(),
  kind        text not null check (kind in ('created','updated','activated','deactivated')),
  actor       uuid references auth.users(id) on delete set null,
  actor_email text,
  origin      text not null default 'manual' check (origin in ('manual')),
  before      jsonb,
  after       jsonb,
  motivo      text,
  ip          text
);

comment on table public.client_events is
  'Auditoría append-only de clientes. Sin UPDATE ni DELETE: un evento no se corrige, se compensa con otro.';

create index if not exists client_events_client_ts_idx on public.client_events (client_id, ts desc);
create index if not exists client_events_kind_idx      on public.client_events (kind);

alter table public.client_events enable row level security;
-- NO se usa FORCE: sujetaría al DUEÑO de la tabla a las policies, y una RPC
-- SECURITY DEFINER corre como su dueño. La contención no viene de la RLS sino
-- del privilegio — nadie tiene INSERT (ver 0242).

drop policy if exists "client_events read internal" on public.client_events;
create policy "client_events read internal"
  on public.client_events for select
  to authenticated
  using (coalesce(public.has_permission('clientes.view'), false));

drop policy if exists "client_events insert internal" on public.client_events;
create policy "client_events insert internal"
  on public.client_events for insert
  to authenticated
  with check (
    coalesce(public.has_permission('clientes.create'), false)
    and actor is not distinct from auth.uid()
  );

-- Sin política de UPDATE ni DELETE: quedan denegadas para los roles
-- alcanzados por la RLS. La garantía completa está declarada una sola vez, en
-- la cabecera de este archivo; no se repite acá para que no puedan divergir.

-- Privilegios EXPLÍCITOS, con la convención EXACTA de 0222:1000-1003 y
-- 0231:142 — que incluye `service_role`.
--
-- Revocar sólo de `public` no alcanza: el bootstrap de Supabase ejecuta
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO service_role` (lo
-- documenta 0222:991-993), de modo que sin esta revocación `service_role`
-- nacería con UPDATE y DELETE sobre la auditoría y la promesa de
-- inalterabilidad sería decorativa.
revoke all on public.client_events from public, anon, authenticated, service_role;

-- `authenticated` escribe la auditoría desde la sesión del usuario, que es
-- como ya lo hace `audit_log` en el resto del ERP. `service_role` LEE pero no
-- escribe: si un camino de servidor necesitara escribir, debe fallar
-- ruidosamente y resolverse por una RPC, no por privilegio directo.
grant select, insert on public.client_events to authenticated;
grant select          on public.client_events to service_role;

-- Sello server-side de la atribución. `ts`, `actor` y `actor_email` NUNCA se
-- toman del cliente.
create or replace function public.client_events_seal()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.ts := now();
  new.actor := auth.uid();
  -- Email del JWT vigente. Null-safe: si no hay claim (proceso de servicio,
  -- sustrato de pruebas), queda null en vez de fallar.
  new.actor_email := nullif(
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''),
    ''
  );
  return new;
end;
$$;

drop trigger if exists client_events_seal_trg on public.client_events;
create trigger client_events_seal_trg
  before insert on public.client_events
  for each row execute function public.client_events_seal();

-- ── 5 · Sello automático de modificación ───────────────────────────────
-- ALCANCE DELIBERADAMENTE ACOTADO A `updated_by`.
--
-- `public.clients` YA tiene un trigger BEFORE UPDATE desde 0004:
-- `clients_touch_updated_at` → `public.tg_touch_updated_at()`, que sella
-- `updated_at`. Este trigger NO lo duplica ni lo reemplaza: sella únicamente
-- la columna nueva. Dos triggers BEFORE UPDATE con la misma responsabilidad
-- sobre la misma columna se pisarían entre sí según el orden alfabético de
-- ejecución, y cualquier cambio futuro en uno quedaría enmascarado por el
-- otro.
create or replace function public.clients_stamp_update()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  -- auth.uid() es null en procesos de servicio; en ese caso se conserva el valor anterior.
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end;
$$;

drop trigger if exists clients_stamp_update_trg on public.clients;
create trigger clients_stamp_update_trg
  before update on public.clients
  for each row execute function public.clients_stamp_update();

-- ── 6 · Búsqueda canónica de clientes ──────────────────────────────────
-- SECURITY INVOKER (por defecto): la RLS del llamador sigue vigente. NO se usa
-- SECURITY DEFINER porque dentro de una función DEFINER `current_user` es el
-- dueño de la función y cualquier control de autorización basado en él sería
-- tautológico.
create or replace function public.clients_search(
  p_q          text default null,
  p_limit      int  default 20,
  p_solo_activos boolean default true
)
returns table (
  id               uuid,
  razon            text,
  nombre_comercial text,
  cuit             text,
  codigo           text,
  email            text,
  telefono         text,
  localidad        text,
  activo           boolean,
  score            real
)
language sql
stable
parallel safe
set search_path = public, extensions
as $$
  with q as (
    select
      public.nx_text_norm(p_q) as qn,
      public.nx_digits(p_q)    as qd
  )
  select
    c.id, c.razon, c.nombre_comercial, c.cuit, c.codigo,
    c.email, c.telefono, c.localidad, c.activo,
    greatest(
      extensions.similarity(public.nx_text_norm(c.razon), q.qn),
      extensions.similarity(public.nx_text_norm(coalesce(c.nombre_comercial, '')), q.qn)
    )::real as score
  from public.clients c, q
  where (not p_solo_activos or c.activo)
    and (
      q.qn = '' or
      public.nx_text_norm(c.razon)                        like '%' || q.qn || '%' or
      public.nx_text_norm(coalesce(c.nombre_comercial,'')) like '%' || q.qn || '%' or
      public.nx_text_norm(coalesce(c.codigo,''))           =    q.qn                or
      public.nx_text_norm(coalesce(c.email,''))            like '%' || q.qn || '%' or
      (length(q.qd) >= 3 and public.nx_digits(c.cuit)      like '%' || q.qd || '%') or
      (length(q.qd) >= 3 and public.nx_digits(coalesce(c.telefono,'')) like '%' || q.qd || '%')
    )
  order by
    -- coincidencia exacta de CUIT primero, después parecido de nombre, después alfabético
    (length(q.qd) = 11 and public.nx_digits(c.cuit) = q.qd) desc,
    score desc,
    c.razon asc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

comment on function public.clients_search(text, int, boolean) is
  'Búsqueda normalizada de clientes por razón social, nombre comercial, CUIT, código, email o teléfono. SECURITY INVOKER: respeta la RLS del llamador.';

-- En PostgreSQL toda función nace con EXECUTE para PUBLIC, y Supabase suma
-- default privileges por rol: revocar sólo de `public` dejaría la RPC
-- ejecutable por `anon`. Se usa la enumeración completa de 0222:92 y 0235:184.
revoke execute on function public.clients_search(text, int, boolean) from public, anon, authenticated;
grant execute on function public.clients_search(text, int, boolean) to authenticated;

-- ── 7 · Detección de posible duplicado (NO decide, informa) ─────────────
-- Devuelve candidatos parecidos para ADVERTIR antes de crear. Nunca fusiona,
-- nunca bloquea por sí sola y nunca deduplica por similitud de nombre a solas:
-- el único criterio determinante es el CUIT, que ya tiene unicidad en la tabla.
create or replace function public.clients_duplicate_candidates(
  p_razon text,
  p_cuit  text default null
)
returns table (
  id            uuid,
  razon         text,
  cuit          text,
  match_reason  text,
  score         real
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  -- Esta RPC atraviesa RLS únicamente para que un alta WMS pueda comparar
  -- contra TODO el maestro. El bypass no sustituye autorización: identidad y
  -- capacidad exacta se verifican dentro de la misma frontera privilegiada.
  if auth.uid() is null then
    raise exception 'CLIENT_SIN_IDENTIDAD: la verificación de duplicados exige sesión'
      using errcode = '28000';
  end if;
  if not (
    coalesce(public.has_permission('clientes.view'), false)
    or coalesce(public.has_permission('clientes.create'), false)
    or coalesce(public.has_permission('wms.clients.create'), false)
  ) then
    raise exception 'CLIENT_DENEGADO: sin capacidad para verificar duplicados'
      using errcode = '42501';
  end if;

  -- El ORDER BY va en una consulta EXTERNA a propósito: PostgreSQL admite el
  -- alias de salida sólo como referencia desnuda, nunca dentro de una
  -- expresión como `(match_reason = '...')`. Ordenar afuera evita repetir el
  -- CASE y mantiene una sola definición del criterio.
  return query
  select q.id, q.razon, q.cuit, q.match_reason, q.score
  from (
    select
      c.id, c.razon, c.cuit,
      case
        when p_cuit is not null and public.nx_digits(p_cuit) <> ''
         and public.nx_digits(c.cuit) = public.nx_digits(p_cuit) then 'cuit_identico'
        else 'razon_similar'
      end as match_reason,
      extensions.similarity(public.nx_text_norm(c.razon), public.nx_text_norm(p_razon))::real as score
    from public.clients c
    where
      (p_cuit is not null and public.nx_digits(p_cuit) <> ''
        and public.nx_digits(c.cuit) = public.nx_digits(p_cuit))
      or extensions.similarity(public.nx_text_norm(c.razon), public.nx_text_norm(p_razon)) >= 0.55
  ) q
  order by (q.match_reason = 'cuit_identico') desc, q.score desc
  limit 10;
end;
$$;

comment on function public.clients_duplicate_candidates(text, text) is
  'Candidatos contra el maestro completo para ADVERTIR en altas autorizadas. SECURITY DEFINER fail-closed; devuelve sólo identidad mínima, no fusiona ni decide por parecido.';

revoke execute on function public.clients_duplicate_candidates(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.clients_duplicate_candidates(text, text) to authenticated;

-- ── 8 · Referencias acotadas para WMS, Pedidos y OS ───────────────────
-- Ninguna de estas RPC expone la ficha completa. WMS/Pedidos reciben sólo
-- id+razón; el wizard OS recibe además el CUIT necesario para fijar la
-- identidad canónica. Contactos, teléfonos, domicilios y emails se releen
-- exclusivamente en el servidor al emitir la orden.
create or replace function public.clients_active_refs(p_scope text)
returns table (id uuid, razon text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_permission text;
begin
  if auth.uid() is null then
    raise exception 'CLIENT_REFS_SIN_IDENTIDAD' using errcode = '28000';
  end if;
  v_permission := case p_scope
    when 'wms' then 'wms.edit'
    when 'pedidos' then 'pedidos.edit'
    else null
  end;
  if v_permission is null
     or not coalesce(public.has_permission(v_permission), false) then
    raise exception 'CLIENT_REFS_DENEGADO' using errcode = '42501';
  end if;
  return query
    select c.id, c.razon
    from public.clients c
    where coalesce(c.activo, true)
    order by c.razon;
end;
$$;

revoke execute on function public.clients_active_refs(text)
  from public, anon, authenticated, service_role;
grant execute on function public.clients_active_refs(text) to authenticated;

create or replace function public.clients_service_order_candidates(p_scope text)
returns table (id uuid, razon text, cuit text, tags text[], activo boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_permission text;
begin
  if auth.uid() is null then
    raise exception 'OS_CLIENTS_SIN_IDENTIDAD' using errcode = '28000';
  end if;
  v_permission := case p_scope
    when 'create' then 'servicios.create'
    when 'edit' then 'servicios.edit'
    else null
  end;
  if v_permission is null
     or not coalesce(public.has_permission(v_permission), false) then
    raise exception 'OS_CLIENTS_DENEGADO' using errcode = '42501';
  end if;
  if p_scope = 'create'
     and not coalesce(public.has_permission('servicios.sign'), false) then
    raise exception 'OS_CLIENTS_DENEGADO' using errcode = '42501';
  end if;
  return query
    select c.id, c.razon, c.cuit, c.tags, c.activo
    from public.clients c
    where coalesce(c.activo, true)
    order by c.razon;
end;
$$;

revoke execute on function public.clients_service_order_candidates(text)
  from public, anon, authenticated, service_role;
grant execute on function public.clients_service_order_candidates(text) to authenticated;

-- ── 9 · Catálogo de permisos ───────────────────────────────────────────
-- Sólo se SIEMBRA el catálogo. No se asigna a ningún rol acá: la concesión es
-- un acto explícito y separado (mínimo privilegio).
-- `on conflict do nothing` SIN target, a propósito. `public.permissions`
-- tiene DOS restricciones únicas: `slug` y `unique (module, action)`
-- (0009_rbac.sql:44,50). Un `on conflict (slug)` sólo absorbe la primera y
-- deja que un choque en `(module, action)` aborte la migración entera. Es
-- exactamente el defecto que 0070 sufrió y que
-- `20260811230310_rbac_gerencia_finanzas_constraint_safe.sql` corrigió; sin
-- target se cubre cualquier restricción única, que es lo que el seed quiere
-- decir. Medido contra producción 2026-08-14: `(wms,'create')` está libre
-- hoy, así que el conflicto no es actual — pero las migraciones 0205-0218
-- fueron aplicadas remotamente y no existen en ningún árbol, de modo que el
-- catálogo de permisos no es auditable desde el repositorio.
insert into public.permissions (slug, module, action, label, description) values
  ('clientes.view',       'clientes', 'view',   'Clientes · ver',        'Consultar y buscar el registro maestro de clientes.'),
  ('clientes.create',     'clientes', 'create', 'Clientes · crear',      'Dar de alta un cliente nativo de Nexus.'),
  ('clientes.edit',       'clientes', 'edit',   'Clientes · editar',     'Modificar los datos de un cliente existente.'),
  ('clientes.delete',     'clientes', 'delete', 'Clientes · desactivar', 'Desactivar un cliente. No borra: un cliente nunca se elimina físicamente.'),
  ('wms.clients.create',  'wms',      'create', 'WMS · crear cliente',   'Crear un cliente nativo desde un flujo operativo del WMS sin abandonar el formulario.')
on conflict do nothing;

-- CONSECUENCIA DECLARADA de `unique (module, action)`: `wms.clients.create`
-- consume el slot (wms,'create'), que es único e irrepetible para el módulo.
-- Dos efectos: ya no podrá existir un `wms.create` genérico distinto, y si el
-- slot estuviera ocupado en producción por alguna de las migraciones
-- 0205-0218 —aplicadas remotamente, ausentes de todo árbol— el permiso se
-- omite EN SILENCIO en vez de abortar. Es el precio de no romper el
-- despliegue, y se verifica con la consulta de más abajo antes de conceder el
-- permiso a ningún rol.
--   select slug from public.permissions where module='wms' and action='create';

notify pgrst, 'reload schema';
