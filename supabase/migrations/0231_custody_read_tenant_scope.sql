-- =========================================================================
-- 0231 · WMS · LECTURA DE CUSTODIA ACOTADA POR TENANT
--
-- ─── QUÉ SE ARREGLA ─────────────────────────────────────────────────────
--
-- El roundtrip G6 midió, contra un stack real, que las policies históricas de
-- 0036 eran:
--
--     "custody_events read"   using (auth.role() = 'authenticated')
--     "custody_evidence read" using (auth.role() = 'authenticated')
--
-- Es decir: CUALQUIER usuario autenticado podía leer los metadatos de custodia
-- de CUALQUIER cliente —public_id, etapa, tipo de evento, fechas, digest de la
-- evidencia—. La frontera de tenant existía en la escritura
-- (`assert_custody_tenant`) y en el acceso al binario
-- (`emit_custody_signed_url`), pero no en la lectura. Un operador de un cliente
-- veía la actividad logística de otro.
--
-- ─── CÓMO SE CIERRA ─────────────────────────────────────────────────────
--
-- Se reemplazan por policies `TO authenticated` que derivan el tenant de la
-- fila SERVER-SIDE y lo comparan contra `current_client_id()`:
--
--   · rol interno (admin/operaciones/supervisor) → acceso operativo completo,
--     que es el que la operación de depósito necesita y ya tenía;
--   · usuario client-bound → EXCLUSIVAMENTE las filas cuyo pedido pertenece a
--     su cliente;
--   · `current_client_id()` nulo y rol no interno → nada. Falla cerrado.
--
-- El tenant NUNCA se recibe: se resuelve por `packing_unit → order → client` o
-- `shipment → order → client` dentro de funciones SECURITY DEFINER, que además
-- evitan que la policy de una tabla dependa de la RLS de la otra.
--
-- ─── LO QUE ESTA MIGRACIÓN NO HACE ──────────────────────────────────────
--
-- No amplía ninguna superficie de escritura: `custody_events` y
-- `custody_evidence` siguen sin INSERT/UPDATE/DELETE para `authenticated` y
-- `service_role`; el único camino de escritura sigue siendo las RPC SECURITY
-- DEFINER de 0038/0226. Tampoco toca Storage: los binarios se siguen sirviendo
-- sólo por `emit_custody_signed_url`.
--
-- Forward-only e idempotente. No toca 0227–0230 (WhatsApp).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Resolución del tenant de una fila de custodia
-- -------------------------------------------------------------------------

/** client_id del pedido dueño de la entidad. SECURITY DEFINER: la policy no
    puede depender de que el lector vea `logistics_orders`. */
create or replace function public.custody_row_client_id(
  p_packing_unit_id uuid,
  p_shipment_id     uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select lo.client_id
    from public.logistics_orders lo
   where lo.id = coalesce(
     (select pu.order_id from public.packing_units pu where pu.id = p_packing_unit_id),
     (select s.order_id  from public.shipments     s  where s.id = p_shipment_id)
   );
$$;

-- Privilegio EXPLÍCITO, no heredado: se revoca a todos y se concede sólo a los
-- roles que la necesitan. `authenticated` SÍ la necesita: una policy se evalúa
-- con los privilegios del rol que consulta, así que sin EXECUTE la lectura
-- fallaría por permisos en vez de filtrar por tenant. Es segura de conceder
-- porque sólo devuelve el client_id derivado de ids que el llamador ya tiene,
-- es STABLE y tiene `search_path` fijo.
revoke execute on function public.custody_row_client_id(uuid, uuid) from public, anon, authenticated;
grant execute on function public.custody_row_client_id(uuid, uuid) to authenticated, service_role;

comment on function public.custody_row_client_id(uuid, uuid) is
  '0231: tenant canónico de una fila de custodia, derivado del pedido. Lo consumen las policies de lectura.';

/** Tenant de una EVIDENCIA, vía su evento. Evita que la policy de
    `custody_evidence` tenga que atravesar la RLS de `custody_events`. */
create or replace function public.custody_evidence_client_id(p_evidence_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.custody_row_client_id(ev.packing_unit_id, ev.shipment_id)
    from public.custody_evidence e
    join public.custody_events   ev on ev.id = e.event_id
   where e.id = p_evidence_id;
$$;

revoke execute on function public.custody_evidence_client_id(uuid) from public, anon, authenticated;
grant execute on function public.custody_evidence_client_id(uuid) to authenticated, service_role;

comment on function public.custody_evidence_client_id(uuid) is
  '0231: tenant canónico de una evidencia de custodia, derivado de su evento.';

-- -------------------------------------------------------------------------
-- 2) Policies de lectura acotadas por tenant
-- -------------------------------------------------------------------------

alter table public.custody_events   enable row level security;
alter table public.custody_evidence enable row level security;

drop policy if exists "custody_events read" on public.custody_events;
create policy "custody_events read"
  on public.custody_events
  for select
  to authenticated
  using (
    coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
    or (
      public.current_client_id() is not null
      and public.custody_row_client_id(packing_unit_id, shipment_id) = public.current_client_id()
    )
  );

drop policy if exists "custody_evidence read" on public.custody_evidence;
create policy "custody_evidence read"
  on public.custody_evidence
  for select
  to authenticated
  using (
    coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
    or (
      public.current_client_id() is not null
      and public.custody_evidence_client_id(id) = public.current_client_id()
    )
  );

-- -------------------------------------------------------------------------
-- 3) Privilegios mínimos EXPLÍCITOS
--
--    No se depende de default privileges. Se revoca todo y se concede sólo
--    SELECT: la escritura vive exclusivamente en las RPC SECURITY DEFINER.
-- -------------------------------------------------------------------------

revoke all on public.custody_events   from public, anon, authenticated, service_role;
revoke all on public.custody_evidence from public, anon, authenticated, service_role;

grant select on public.custody_events   to authenticated, service_role;
grant select on public.custody_evidence to authenticated, service_role;

comment on policy "custody_events read" on public.custody_events is
  '0231: lectura acotada por tenant. Reemplaza el auth.role()=authenticated de 0036, que permitía leer metadatos de otros clientes.';
comment on policy "custody_evidence read" on public.custody_evidence is
  '0231: lectura acotada por tenant, derivada del evento de la evidencia.';
