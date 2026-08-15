-- ROLLBACK_0242_clients_atomic_mutations.sql
-- ─────────────────────────────────────────────────────────────────────────
-- INVERSA DE 0242. NO ES FORWARD. No se ejecuta en un despliegue normal.
--
-- Restituye EXACTAMENTE el estado de base posterior a 0241: vuelven el
-- privilegio de INSERT de `authenticated` Y la policy que lo habilita, y
-- desaparecen las tres RPC transaccionales.
--
-- ─── POR QUÉ HACE FALTA RECREAR LA POLICY ─────────────────────────────────
--
-- 0242 dropea `client_events insert internal` porque, con el INSERT revocado,
-- quedaba como puerta latente. Una versión anterior de este rollback devolvía
-- sólo el `grant` y afirmaba haber restituido la escritura. Era falso y se
-- midió: el privilegio volvía, la policy no, y el INSERT moría con
-- `new row violates row-level security policy`. El sistema quedaba sin RPC y
-- sin vía de escritura, con la inversa declarando lo contrario.
--
-- Un rollback que no restituye lo que promete es peor que no tenerlo: se
-- ejecuta en un incidente, cuando nadie está en condiciones de descubrir que
-- mintió.
--
-- ─── ADVERTENCIA OPERATIVA ────────────────────────────────────────────────
--
-- Revertir 0242 REABRE los dos defectos que cerró:
--   · la mutación de un cliente y su evento dejan de ser atómicos, así que una
--     mutación puede volver a quedar sin rastro;
--   · `updated_by` deja de sellarse si la aplicación escribe con `service_role`.
-- Sólo tiene sentido como paso previo a revertir 0241, nunca como estado final.
--
-- NO TOCA: las filas de `public.clients` ni las de `public.client_events`.
-- Ninguna auditoría ya escrita se pierde.
--
-- ORDEN: ejecutar ANTES que ROLLBACK_0241.

-- ── 1 · RPC transaccionales ────────────────────────────────────────────
-- Primero las funciones: mientras existan, son la vía legítima y quitarles el
-- sustrato antes las dejaría rotas a mitad de camino.
drop function if exists public.client_set_active(uuid, boolean, text);
drop function if exists public.client_update(uuid, text, text, text, text, text, text, text, text, text, text[], text, text, text, text, text[], timestamptz);
drop function if exists public.client_create(text, text, text, text, text, text, text, text[], text, text, text, uuid[], text, text, text, text);

-- ── 2 · Policy de INSERT, con la definición EXACTA de 0241 ─────────────
-- Se recrea ANTES de devolver el grant: un privilegio sin policy es una
-- combinación incoherente que deniega igual, y dejarla aunque sea un instante
-- invita a que alguien mida el bit y concluya que la vía está restituida.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_events'
      and policyname = 'client_events insert internal'
  ) then
    create policy "client_events insert internal"
      on public.client_events for insert
      to authenticated
      with check (
        public.current_role() in ('admin','operaciones','supervisor')
        and actor is not distinct from auth.uid()
      );
  end if;
end$$;

-- ── 3 · Privilegio de escritura, tal como lo dejó 0241 ─────────────────
grant insert on public.client_events to authenticated;

-- Camino legado mínimo compatible. No se reabren DELETE/TRUNCATE ni escritura
-- de anon/service_role: los clientes nunca se eliminan físicamente y una
-- reversa segura no convierte el rollback en una ampliación de privilegios.
revoke insert, update, delete, truncate on public.clients
  from public, anon, authenticated, service_role;
grant insert, update on public.clients to authenticated;
drop policy if exists "clients write internal" on public.clients;
drop policy if exists "clients insert internal" on public.clients;
create policy "clients insert internal" on public.clients for insert to authenticated
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "clients update internal" on public.clients;
create policy "clients update internal" on public.clients for update to authenticated
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

comment on table public.client_events is
  'Auditoría append-only de clientes. Sin UPDATE ni DELETE: un evento no se corrige, se compensa con otro.';

comment on table public.clients is null;

notify pgrst, 'reload schema';
