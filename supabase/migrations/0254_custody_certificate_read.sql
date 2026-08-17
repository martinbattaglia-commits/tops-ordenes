-- =========================================================================
-- 0254 · CUSTODIA DIGITAL · EL CERTIFICADO SE PUEDE LEER (2-C-2)
--
-- Expediente CUSTODIA-CIERRE-CIRCUITO · bloque 2-C-2.
-- Aditiva y forward-only. No edita ninguna migración anterior.
--
-- ─── POR QUÉ HACE FALTA UNA MIGRACIÓN, SI LA TABLA YA EXISTE ─────────────
--
-- `custody_release_certificates` existe desde 0250a, la fila se INSERTA sola
-- al liberar (`0251:257`) y el `grant select ... to authenticated` está puesto
-- (`0250a:1786`). Aun así **ninguna sesión puede leer una sola fila**, y no es
-- un problema de permisos:
--
--     alter table public.custody_release_certificates enable row level security;
--
-- ...sin NINGUNA política de `select`. RLS habilitada sin política deniega
-- todo, y el `grant` queda por encima de una puerta cerrada. Medido sobre este
-- árbol: `grep -n "policy" ` sobre las migraciones no devuelve ninguna política
-- para esta tabla.
--
-- Ése es exactamente el corte que el contrato de cableado registra como
-- **CORTADO EN lectura** (§2 fila 7): «SELECT concedido a `authenticated`, sin
-- consumidor». El consumidor no existía porque no podía existir.
--
-- ─── POR QUÉ UNA POLÍTICA Y NO UNA LECTURA ADMINISTRATIVA ────────────────
--
-- 2-C-1 resolvió un caso parecido —el puente `custody_allocation_physical_units`,
-- también con RLS y sin política— con una lectura `service_role` acotada, y
-- estaba bien: ese puente es genealogía interna, no un documento, y nadie fuera
-- del sistema tiene derecho a verlo.
--
-- El certificado es lo contrario: **es el documento del cliente**. Leerlo con
-- `service_role` sería sacar la autorización de la base y ponerla en el código,
-- en el único artefacto del módulo cuyo valor es probatorio. La política de
-- tenant es la respuesta correcta, y es la misma que el módulo ya usa para
-- `custody_physical_units` (`0250a:68-73`).
--
-- ─── LO QUE ESTA MIGRACIÓN NO HACE ───────────────────────────────────────
--
-- No toca la tabla, ni sus constraints, ni sus triggers de inmutabilidad, ni la
-- inserción, ni ninguna función `custody_assert_*`, ni
-- `complete_custody_integrity_evaluation_v2`. Agrega UNA política de lectura.
-- Una tabla con RLS y sin política deniega todo, así que esto sólo puede
-- ampliar hacia el tenant y nunca aflojar otra cosa.
-- =========================================================================

begin;

-- -------------------------------------------------------------------------
-- La lectura del certificado, acotada por tenant
--
-- Copia literal del criterio de `custody_physical_units_read` (0250a:68-73):
-- los tres roles operativos ven todo el tenant, y un usuario de cliente ve lo
-- suyo. El `client_id` no vive en esta tabla —el certificado cuelga del caso—,
-- así que se resuelve por el caso, que ya tiene su propia RLS.
-- -------------------------------------------------------------------------

drop policy if exists custody_release_certificates_read on public.custody_release_certificates;
create policy custody_release_certificates_read on public.custody_release_certificates
  for select to authenticated
  using (
    exists (
      select 1
        from public.custody_integrity_cases c
       where c.id = custody_release_certificates.case_id
         and (
           public.current_role() in ('admin','operaciones','supervisor')
           or c.client_id = public.current_client_id()
         )
    )
  );

comment on policy custody_release_certificates_read on public.custody_release_certificates is
  '2-C-2 · el certificado es el documento del cliente: se lee por tenant, no por service_role.';

commit;
