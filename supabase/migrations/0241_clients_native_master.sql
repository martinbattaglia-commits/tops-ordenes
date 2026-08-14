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
--   · no tiene identificador externo, así que el vínculo con Clientify se
--     resolvía por CUIT mediante un upsert destructivo con service_role;
--   · no tiene estado de sincronización observable;
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
-- La tabla lleva FORCE ROW LEVEL SECURITY. Lo que eso hace, con precisión:
-- elimina la exención del DUEÑO de la tabla. NO restringe a un superusuario
-- ni a un rol con BYPASSRLS —PostgreSQL los excluye siempre, con o sin
-- FORCE—. La contención de `service_role` NO viene de acá: viene del
-- `revoke all ... from ... service_role` de más abajo, que le quita el
-- privilegio de tabla que el bootstrap de Supabase le concede por defecto.
-- Es el primer objeto del corpus que usa FORCE y se justifica porque es el
-- único cuya utilidad depende de ser inalterable.
--
-- Los campos de atribución (`ts`, `actor`, `actor_email`) los SELLA un
-- trigger server-side. Si los aceptara del cliente, cualquier autenticado
-- podría insertar un asiento atribuido a otra persona: una auditoría cuyos
-- asientos escribe el auditado, firmando con nombre ajeno, no es evidencia.
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
  add column if not exists updated_by            uuid references auth.users(id) on delete set null,
  add column if not exists external_source       text,
  add column if not exists external_id           text,
  add column if not exists sync_state            text not null default 'never',
  add column if not exists sync_last_attempt_at  timestamptz,
  add column if not exists sync_last_result      text,
  add column if not exists sync_last_error       text;

comment on column public.clients.nombre_comercial     is 'Nombre de fantasía. Criterio de búsqueda; NO es identidad.';
comment on column public.clients.codigo               is 'Código interno corto y opcional. Único case-insensitive cuando existe.';
comment on column public.clients.updated_by           is 'Último actor que modificó la fila. Lo estampa el trigger clients_stamp_update.';
comment on column public.clients.external_source      is 'Sistema externo espejo (p.ej. clientify). NUNCA es identidad interna.';
comment on column public.clients.external_id          is 'Identificador en el sistema externo. Opcional y no autoritativo.';
comment on column public.clients.sync_state           is 'never | pending | ok | error | disabled. Estado observable de la sincronización.';
comment on column public.clients.sync_last_error      is 'Error SANEADO del último intento. Prohibido almacenar token, credencial o cuerpo crudo.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_sync_state_chk'
  ) then
    alter table public.clients
      add constraint clients_sync_state_chk
      check (sync_state in ('never','pending','ok','error','disabled'));
  end if;
end$$;

-- Identidad externa: única por sistema, sólo cuando ambas partes existen.
create unique index if not exists clients_external_uk
  on public.clients (external_source, external_id)
  where external_source is not null and external_id is not null;

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
create table if not exists public.client_events (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.clients(id) on delete cascade,
  ts          timestamptz not null default now(),
  kind        text not null check (kind in ('created','updated','activated','deactivated','sync_attempt','sync_conflict')),
  actor       uuid references auth.users(id) on delete set null,
  actor_email text,
  origin      text not null default 'manual' check (origin in ('manual','sync')),
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
-- FORCE: la RLS aplica también al dueño de la tabla. Sin esto, la promesa de
-- append-only sólo vale para roles sin bypass.
alter table public.client_events force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_events' and policyname = 'client_events read internal'
  ) then
    -- Mismo criterio que "clients read internal" (0001_init.sql:198-203).
    create policy "client_events read internal"
      on public.client_events for select
      to authenticated
      using (
        public.current_role() in ('admin','operaciones','supervisor')
        or client_id = (select client_id from public.profiles where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_events' and policyname = 'client_events insert internal'
  ) then
    -- Sólo internos escriben auditoría, y sólo a nombre propio. El `actor`
    -- ya viene sellado por el trigger; la condición lo vuelve explícito en la
    -- frontera, de modo que la policy sea legible sin conocer el trigger.
    create policy "client_events insert internal"
      on public.client_events for insert
      to authenticated
      with check (
        public.current_role() in ('admin','operaciones','supervisor')
        and actor is not distinct from auth.uid()
      );
  end if;
end$$;

-- Sin política de UPDATE ni DELETE: con RLS forzada, quedan denegadas para
-- todos, incluido el dueño de la tabla.

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
language sql
stable
parallel safe
set search_path = public, extensions
as $$
  -- El ORDER BY va en una consulta EXTERNA a propósito: PostgreSQL admite el
  -- alias de salida sólo como referencia desnuda, nunca dentro de una
  -- expresión como `(match_reason = '...')`. Ordenar afuera evita repetir el
  -- CASE y mantiene una sola definición del criterio.
  select id, razon, cuit, match_reason, score
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
$$;

comment on function public.clients_duplicate_candidates(text, text) is
  'Candidatos a duplicado para ADVERTIR en el alta. Informativa: no fusiona, no bloquea y no decide identidad por parecido de nombre.';

revoke execute on function public.clients_duplicate_candidates(text, text) from public, anon, authenticated;
grant execute on function public.clients_duplicate_candidates(text, text) to authenticated;

-- ── 8 · Catálogo de permisos ───────────────────────────────────────────
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
