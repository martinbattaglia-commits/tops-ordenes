-- =========================================================================
-- Storage buckets — firmas, PDFs, adjuntos
-- =========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('signatures', 'signatures', true, 524288, array['image/png','image/svg+xml']),
  ('pdfs',       'pdfs',       true, 5242880, array['application/pdf']),
  ('attachments','attachments',false, 10485760, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;

-- Lectura pública para signatures y pdfs (URLs van firmadas o públicas)
create policy "public read signatures"
  on storage.objects for select
  using (bucket_id = 'signatures');

create policy "public read pdfs"
  on storage.objects for select
  using (bucket_id = 'pdfs');

-- Escritura sólo para usuarios autenticados internos
create policy "auth write signatures"
  on storage.objects for insert
  with check (
    bucket_id = 'signatures'
    and auth.role() = 'authenticated'
  );
create policy "auth update signatures"
  on storage.objects for update
  using (bucket_id = 'signatures' and auth.role() = 'authenticated')
  with check (bucket_id = 'signatures');

create policy "auth write pdfs"
  on storage.objects for insert
  with check (bucket_id = 'pdfs' and auth.role() = 'authenticated');
create policy "auth update pdfs"
  on storage.objects for update
  using (bucket_id = 'pdfs' and auth.role() = 'authenticated')
  with check (bucket_id = 'pdfs');

create policy "auth read attachments"
  on storage.objects for select
  using (bucket_id = 'attachments' and auth.role() = 'authenticated');
create policy "auth write attachments"
  on storage.objects for insert
  with check (bucket_id = 'attachments' and auth.role() = 'authenticated');
