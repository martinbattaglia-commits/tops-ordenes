-- ROLLBACK_0238_nexus_link_upload_lifecycle.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Revierte 0238 al estado exacto anterior.
--
-- ORDEN: primero el trigger, después las funciones, después la tabla. Si se
-- soltara la tabla con el trigger vivo, cualquier `insert` en
-- `connect_attachments` fallaría por función rota.
--
-- LA LISTA DE MIME SE RESTITUYE LITERAL, tal como fue MEDIDA en producción el
-- 2026-08-14 antes de aplicar 0238 (13 entradas, sin HEIC/HEIF ni PPTX). No se
-- "quitan los agregados": se reescribe el valor original completo, que es lo
-- único que garantiza volver al mismo estado aunque alguien haya tocado la
-- lista en el medio.
--
-- CONSECUENCIA ACEPTADA: al soltar `connect_pending_uploads` se pierde el
-- rastro de las subidas pendientes vivas. Los objetos ya finalizados NO se
-- tocan —están en `connect_attachments`, que esta migración no modifica—; los
-- pendientes sin finalizar vuelven a ser huérfanos, que es exactamente la
-- situación previa a 0238.
-- ─────────────────────────────────────────────────────────────────────────

drop trigger if exists connect_attachments_upload_binding on public.connect_attachments;
drop function if exists public._connect_attachment_requires_finalized_upload();

drop function if exists public.connect_upload_mark_purged(uuid);
drop function if exists public.connect_upload_reclaim_expired(integer);
drop function if exists public.connect_upload_claim_finalize(uuid, text, text);
drop function if exists public.connect_upload_begin(uuid, text, integer);

drop table if exists public.connect_pending_uploads;

update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg','image/png','image/webp','image/gif',
     'application/pdf','text/plain','text/csv',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'audio/webm','audio/mp4','audio/ogg','audio/mpeg'
   ]
 where id = 'connect-files';

notify pgrst, 'reload schema';
