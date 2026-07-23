-- 0148_connect_storage.sql — Nexus Link RC1.0.
-- ENTREGADA, NO APLICADA (G3).
-- ─────────────────────────────────────────────────────────────────────────
-- Buckets privados de Connect + storage RLS. Patrón 0037_custody_storage:
-- insert con on conflict do update + RLS por bucket. La lectura del binario
-- es SIEMPRE vía connect_emit_attachment_signed_url (0144); connect-files-pii
-- NO tiene policy de lectura authenticated (solo vía RPC).
-- ⚠️ Storage NO tiene PITR/backup de DB → backup PROPIO de binarios OBLIGATORIO
--    antes de operar adjuntos en prod (mismo aviso que 0037). NO hay antivirus hoy.
-- DEPENDE de 0143 (connect_attachments).
-- ─────────────────────────────────────────────────────────────────────────

-- (1) Buckets privados.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('connect-files','connect-files', false, 26214400,            -- 25 MiB · adjuntos generales
     array['image/jpeg','image/png','image/webp','image/gif','application/pdf',
           'text/plain','text/csv',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('connect-files-pii','connect-files-pii', false, 10485760,    -- 10 MiB · adjuntos sensibles (PII)
     array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- (2) Storage RLS (storage.objects). Lectura DIRECTA del binario: solo connect-files
--     (defensa en capas; el flujo real es signed-url). connect-files-pii: SIN policy
--     de lectura authenticated → solo accesible vía RPC + service_role.
drop policy if exists "connect-files read members" on storage.objects;
create policy "connect-files read members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'connect-files'
    and public.has_permission('connect.view')
  );

-- ALTA: staff interno (la app sube via createAdminClient/RPC; upsert:false).
-- FLAG SEC-STORAGE-1 (aceptado, fiel al spec §2.7): el INSERT/UPDATE está gateado solo por
-- has_permission('connect.create'), SIN atar el path a una conversación de la que el usuario sea miembro
-- (scoping coarse). NO hay fuga de LECTURA (el binario PII solo se sirve por signed-URL RPC que re-valida
-- membership); el riesgo acotado es de integridad (binarios huérfanos). Endurecimiento
-- (storage.foldername(name)→_connect_is_member, o alta SOLO por server-action) diferido a un RC posterior.
drop policy if exists "connect-files write internal" on storage.objects;
create policy "connect-files write internal"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('connect-files','connect-files-pii')
    and public.has_permission('connect.create')
  );

-- EDICIÓN: interno (binarios inmutables en la práctica).
drop policy if exists "connect-files update internal" on storage.objects;
create policy "connect-files update internal"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('connect-files','connect-files-pii')
    and public.has_permission('connect.create')
  );

-- BORRADO: solo admin.
drop policy if exists "connect-files delete admin" on storage.objects;
create policy "connect-files delete admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('connect-files','connect-files-pii')
    and public.is_admin()
  );

-- (3) La RPC connect_emit_attachment_signed_url se define en 0144 (portón + auditoría).

notify pgrst, 'reload schema';
