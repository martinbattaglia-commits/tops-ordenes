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
-- QUÉ PIERDE, IRREVERSIBLEMENTE
--   · El contenido de `client_events` (auditoría). Es la única pérdida de
--     datos real de este rollback y es inevitable: la tabla se elimina.
--     Si la auditoría ya tuviera valor probatorio, exportarla ANTES.
--   · Los valores cargados en las columnas nuevas (nombre_comercial, codigo,
--     external_source, external_id, sync_*).
--
-- ORDEN: ejecutar ANTES que ROLLBACK_0240.

-- ── 1 · Trigger y función de sello ─────────────────────────────────────
drop trigger if exists clients_stamp_update_trg on public.clients;
drop function if exists public.clients_stamp_update();
-- `clients_touch_updated_at` (0004) NO se toca: 0241 nunca lo modificó.
drop trigger if exists client_events_seal_trg on public.client_events;
drop function if exists public.client_events_seal();

-- ── 2 · Funciones de búsqueda ──────────────────────────────────────────
drop function if exists public.clients_duplicate_candidates(text, text);
drop function if exists public.clients_search(text, int, boolean);

-- ── 3 · Auditoría ──────────────────────────────────────────────────────
-- PÉRDIDA DE DATOS ACEPTADA Y DECLARADA: se va el histórico de client_events.
drop table if exists public.client_events;

-- ── 4 · Índices ────────────────────────────────────────────────────────
drop index if exists public.clients_email_norm_trgm_idx;
drop index if exists public.clients_cuit_digits_trgm_idx;
drop index if exists public.clients_fantasia_trgm_idx;
drop index if exists public.clients_razon_trgm_idx;
drop index if exists public.clients_codigo_uk;
drop index if exists public.clients_external_uk;

-- ── 5 · Normalizadores ─────────────────────────────────────────────────
-- Se eliminan DESPUÉS de los índices que dependen de ellos.
drop function if exists public.nx_digits(text);
drop function if exists public.nx_text_norm(text);

-- ── 6 · Constraint y columnas ──────────────────────────────────────────
alter table public.clients drop constraint if exists clients_sync_state_chk;

alter table public.clients
  drop column if exists sync_last_error,
  drop column if exists sync_last_result,
  drop column if exists sync_last_attempt_at,
  drop column if exists sync_state,
  drop column if exists external_id,
  drop column if exists external_source,
  drop column if exists updated_by,
  drop column if exists codigo,
  drop column if exists nombre_comercial;

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
