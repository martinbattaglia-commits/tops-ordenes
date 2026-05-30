-- =========================================================================
-- TOPS NEXUS — FASE E1 · Cierre de R4
-- Aislamiento multi-tenant del bucket `invoices` (storage.objects)
--
-- CONTEXTO (R4, hallazgo GATE 2 / ARCA-SANDBOX-VALIDATION):
--   La policy creada en 0011 para el bucket `invoices` era:
--     using (bucket_id = 'invoices' and auth.role() = 'authenticated')
--   ⇒ CUALQUIER usuario autenticado podía leer/escribir CUALQUIER PDF fiscal
--     (sin scoping por cliente). Es el mismo riesgo que se cerró para
--     `documents` en GATE 1C con `split_part(name,'/',1) = client_id`.
--
-- ESTA MIGRACIÓN replica EXACTAMENTE el patrón validado (enforced) para
-- `documents` (0010, líneas 380-449), ya probado en GATE 2 (T1/T2 storage):
--   - LECTURA: internos ven todo; el cliente solo ve objetos cuyo PRIMER
--     segmento del path == su client_id.
--   - ALTA / EDICIÓN: solo personal interno.
--   - DELETE: solo admin.
--
-- CONVENCIÓN DE PATH CANÓNICO (enforced por la app vía buildInvoicePdfPath):
--   {client_id|'_global'}/{yyyy}/{mm}/{cbte_tipo}-{pto_venta}-{nro}-{sha8}.pdf
--   El primer segmento DEBE ser el client_id para que el scoping aplique.
--
-- NATURALEZA: aditiva y segura. Hoy el bucket `invoices` está VACÍO
-- (los PDFs se generan on-demand; pdf_bucket/pdf_path = null). No hay objetos
-- que reclasificar. El upload de la app usa service-role (bypassa RLS), así
-- que estas policies no rompen la materialización futura.
--
-- AISLAMIENTO FASE E: NO se aplica a producción en esta fase. Reservado para
-- validación en staging + gate ejecutivo. 0012 queda reservada para RBAC
-- (MIGRATION-0012-DESIGN-REVIEW); R4 toma 0013 para no tocar ese slot.
-- =========================================================================

-- Asegurar bucket privado (idempotente; ya creado en 0011 como private).
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do update set public = false;

-- -------------------------------------------------------------------------
-- Eliminar la policy permisiva de 0011 (y cualquier alias previo).
-- -------------------------------------------------------------------------
drop policy if exists "invoices bucket internal" on storage.objects;
drop policy if exists "invoices read auth" on storage.objects;
drop policy if exists "invoices write auth" on storage.objects;

-- -------------------------------------------------------------------------
-- LECTURA: internos (admin/operaciones/supervisor) ven todo;
-- el cliente solo ve objetos cuyo primer segmento del path == su client_id.
-- Mismo predicado que "documents read scoped".
-- -------------------------------------------------------------------------
drop policy if exists "invoices read scoped" on storage.objects;
create policy "invoices read scoped"
  on storage.objects for select
  using (
    bucket_id = 'invoices' and (
      public.current_role() in ('admin','operaciones','supervisor')
      or split_part(name, '/', 1) =
         (select client_id::text from public.profiles where id = auth.uid())
    )
  );

-- -------------------------------------------------------------------------
-- ALTA de objetos: SOLO personal interno (los clientes nunca suben comprobantes).
-- -------------------------------------------------------------------------
drop policy if exists "invoices write internal" on storage.objects;
create policy "invoices write internal"
  on storage.objects for insert
  with check (
    bucket_id = 'invoices'
    and public.current_role() in ('admin','operaciones','supervisor')
  );

-- -------------------------------------------------------------------------
-- EDICIÓN de objetos: SOLO personal interno.
-- (Nota: un comprobante AUTORIZADO es inmutable a nivel tabla por trigger;
--  esto cubre el blob de storage.)
-- -------------------------------------------------------------------------
drop policy if exists "invoices update internal" on storage.objects;
create policy "invoices update internal"
  on storage.objects for update
  using (
    bucket_id = 'invoices'
    and public.current_role() in ('admin','operaciones','supervisor')
  );

-- -------------------------------------------------------------------------
-- DELETE de objetos: SOLO admin (separa el `for all` peligroso del 0011).
-- -------------------------------------------------------------------------
drop policy if exists "invoices delete admin obj" on storage.objects;
create policy "invoices delete admin obj"
  on storage.objects for delete
  using (bucket_id = 'invoices' and public.current_role() = 'admin');

-- -------------------------------------------------------------------------
-- Reload del schema cache de PostgREST.
-- -------------------------------------------------------------------------
notify pgrst, 'reload schema';
