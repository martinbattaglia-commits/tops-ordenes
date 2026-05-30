-- =========================================================================
-- TOPS Nexus — F2 · OCR de facturas de proveedor (Opción A: IA llena, humano confirma)
-- Bucket privado `supplier-invoices` para conservar el archivo ORIGINAL
-- (PDF/imagen) que el usuario cargó y sobre el cual el OCR precompletó la
-- factura. El archivo queda vinculado al registro vía supplier_invoices.pdf_url
-- (columna YA existente en 0014 — esta migración NO agrega columnas).
--
-- Trazabilidad "quién confirmó y cuándo": se cubre con las columnas EXISTENTES
-- supplier_invoices.created_by / created_at, porque en el flujo Opción A el
-- INSERT recién ocurre cuando el humano presiona "Confirmar y Guardar".
--
-- NATURALEZA: aditiva y segura. Solo crea un bucket privado + policies de
-- acceso interno. El upload de la app usa service-role (bypassa RLS), así que
-- estas policies no bloquean la carga; existen como defensa en profundidad.
--
-- ⚠️ NO APLICADA A PRODUCCIÓN EN ESTA FASE. Se versiona local; el usuario la
-- aplica manualmente vía Supabase SQL Editor cuando autorice. El código de la
-- app degrada con elegancia si el bucket todavía no existe (el adjunto es
-- best-effort y nunca bloquea el alta de la factura).
--
-- CONVENCIÓN DE PATH:
--   {yyyy}/{mm}/{supplier_invoice_id}-{sha8}.{ext}
--   ej: 2026/05/3f1c…-9a2b1c4d.pdf
-- =========================================================================

-- Bucket privado (idempotente). Acceso solo vía signed URLs / service-role.
insert into storage.buckets (id, name, public)
values ('supplier-invoices', 'supplier-invoices', false)
on conflict (id) do update set public = false;

-- -------------------------------------------------------------------------
-- LECTURA: solo personal interno (admin/operaciones/supervisor).
-- Las facturas de proveedor no se exponen a clientes.
-- -------------------------------------------------------------------------
drop policy if exists "supplier-invoices read internal" on storage.objects;
create policy "supplier-invoices read internal"
  on storage.objects for select
  using (
    bucket_id = 'supplier-invoices'
    and public.current_role() in ('admin','operaciones','supervisor')
  );

-- -------------------------------------------------------------------------
-- ALTA: solo personal interno.
-- -------------------------------------------------------------------------
drop policy if exists "supplier-invoices write internal" on storage.objects;
create policy "supplier-invoices write internal"
  on storage.objects for insert
  with check (
    bucket_id = 'supplier-invoices'
    and public.current_role() in ('admin','operaciones','supervisor')
  );

-- -------------------------------------------------------------------------
-- EDICIÓN: solo personal interno (re-subida/corrección del adjunto).
-- -------------------------------------------------------------------------
drop policy if exists "supplier-invoices update internal" on storage.objects;
create policy "supplier-invoices update internal"
  on storage.objects for update
  using (
    bucket_id = 'supplier-invoices'
    and public.current_role() in ('admin','operaciones','supervisor')
  );

-- -------------------------------------------------------------------------
-- DELETE: solo admin.
-- -------------------------------------------------------------------------
drop policy if exists "supplier-invoices delete admin" on storage.objects;
create policy "supplier-invoices delete admin"
  on storage.objects for delete
  using (
    bucket_id = 'supplier-invoices'
    and public.current_role() = 'admin'
  );

-- Reload del schema cache de PostgREST.
notify pgrst, 'reload schema';
