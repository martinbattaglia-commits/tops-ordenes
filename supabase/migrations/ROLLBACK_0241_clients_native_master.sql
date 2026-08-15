-- ROLLBACK_0241_clients_native_master.sql
-- ─────────────────────────────────────────────────────────────────────────
-- INVERSA DE 0241. NO ES FORWARD. No se ejecuta en un despliegue normal.
--
-- ALCANCE: deshace exactamente lo que 0241 creó y NADA más.
--
-- QUÉ PRESERVA, DELIBERADAMENTE
--   · Las 27 filas de `public.clients` y todas sus columnas previas a 0241.
--   · `created_by`, `created_at`, `updated_at`, `activo` y el resto del modelo
--     anterior, que 0241 no tocó.
--   · Las FK de `orders`, `receptions`, `inventory_items` y `logistics_orders`
--     hacia `clients`, que vienen de 0219/0220 y son ajenas a esta migración.
--
-- QUÉ NO PUEDE PERDER
--   · El contenido de `client_events` ni valores de las columnas nuevas.
--     El preflight aborta antes de cualquier DROP cuando existe cualquiera
--     de esas evidencias; no hay exportación manual ni borrado silencioso.
--
-- ORDEN: ejecutar ANTES que ROLLBACK_0240.

-- ── 0 · Preflight preservante ──────────────────────────────────────────
-- Esta inversa es estructural y predeploy. Nunca elimina auditoría, datos
-- nativos ni asignaciones de permisos. Debe ejecutarse en la misma
-- transacción exterior que ROLLBACK_0242 (primero) y ROLLBACK_0240 (después).
do $$
begin
  if to_regprocedure('public.client_create(text,text,text,text,text,text,text,text[],text,text,text,uuid[],text,text,text,text)') is not null
     or to_regprocedure('public.client_update(uuid,text,text,text,text,text,text,text,text,text,text[],text,text,text,text,text[],timestamp with time zone)') is not null
     or to_regprocedure('public.client_set_active(uuid,boolean,text)') is not null then
    raise exception 'ROLLBACK_0241_ORDER_INVALID: revertir 0242 primero';
  end if;

  lock table public.clients, public.client_events,
    public.permissions, public.role_permissions in share row exclusive mode;

  if exists (select 1 from public.client_events)
     or exists (
       select 1 from public.clients
       where nombre_comercial is not null
          or codigo is not null
          or observaciones is not null
          or updated_by is not null
     )
     or exists (
       select 1
       from public.role_permissions rp
       join public.permissions p on p.id = rp.permission_id
       where p.slug in (
         'clientes.view','clientes.create','clientes.edit',
         'clientes.delete','wms.clients.create'
       )
     ) then
    raise exception 'ROLLBACK_0241_BLOCKED: existen datos, auditoría o asignaciones que deben preservarse';
  end if;
end;
$$;

-- ── 1 · Trigger y función de sello ─────────────────────────────────────
drop trigger if exists clients_stamp_update_trg on public.clients;
drop function if exists public.clients_stamp_update();
-- `clients_touch_updated_at` (0004) NO se toca: 0241 nunca lo modificó.
drop trigger if exists client_events_seal_trg on public.client_events;
drop function if exists public.client_events_seal();

-- ── 2 · Funciones de búsqueda ──────────────────────────────────────────
drop function if exists public.clients_duplicate_candidates(text, text);
drop function if exists public.clients_search(text, int, boolean);
drop function if exists public.clients_active_refs(text);
drop function if exists public.clients_service_order_candidates(text);

-- ── 3 · Auditoría ──────────────────────────────────────────────────────
-- El preflight garantiza que la tabla está vacía antes de este DROP.
drop table if exists public.client_events;

-- ── 4 · Índices ────────────────────────────────────────────────────────
drop index if exists public.clients_email_norm_trgm_idx;
drop index if exists public.clients_cuit_digits_trgm_idx;
drop index if exists public.clients_cuit_digits_uk;
drop index if exists public.clients_fantasia_trgm_idx;
drop index if exists public.clients_razon_trgm_idx;
drop index if exists public.clients_codigo_uk;

-- ── 5 · Normalizadores ─────────────────────────────────────────────────
-- Se eliminan DESPUÉS de los índices que dependen de ellos.
alter table public.clients drop constraint if exists clients_cuit_checksum_ck;
drop function if exists public.cuit_is_valid(text);
drop function if exists public.nx_digits(text);
drop function if exists public.nx_text_norm(text);

-- ── 6 · Constraint y columnas ──────────────────────────────────────────
alter table public.clients
  drop column if exists updated_by,
  drop column if exists observaciones,
  drop column if exists codigo,
  drop column if exists nombre_comercial;

-- Restaura la policy previa de 0001 antes de retirar el permiso introducido
-- por 0241. Sin esta inversa, la policy quedaría apuntando a un slug borrado.
drop policy if exists "clients read internal" on public.clients;
create policy "clients read internal"
  on public.clients for select
  using (
    public.current_role() in ('admin','operaciones','supervisor')
    or id = (select client_id from public.profiles where id = auth.uid())
  );

-- R0242 crea dos policies transitorias sólo para una reversa estructural. No
-- pueden sobrevivir a R0241 porque no existían antes de FASE A. Tampoco se
-- reabre service_role ni DELETE/TRUNCATE. Si R0241 se ensaya sin 0242, la
-- policy original preexistente se conserva intacta; en la cadena completa la
-- reversa queda fail-closed y exige aplicación compatible con ese estado.
drop policy if exists "clients insert internal" on public.clients;
drop policy if exists "clients update internal" on public.clients;

-- ── 7 · Catálogo de permisos ───────────────────────────────────────────
-- Sólo los cinco slugs que 0241 sembró. No toca ningún otro permiso.
--
-- EFECTO EN CASCADA DECLARADO: `role_permissions.permission_id` tiene
-- `on delete cascade` (0009_rbac.sql:84). Borrar estos permisos REVOCA
-- también, en la misma sentencia, toda asignación rol→permiso que los
-- referencie. Es el comportamiento deseado —un permiso que deja de existir no
-- puede quedar concedido— pero es una mutación de `role_permissions` y por
-- eso se declara acá en vez de quedar implícita.
delete from public.permissions
 where slug in (
   'clientes.view',
   'clientes.create',
   'clientes.edit',
   'clientes.delete',
   'wms.clients.create'
 );

notify pgrst, 'reload schema';
