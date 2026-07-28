-- 0209_connect_audio.sql — LINK-MEDIA-001 · Mensajes de audio (MVP).
-- ADITIVA PURA: agrega el valor 'audio' al enum de mensajes y habilita los MIME de
-- audio estrictamente necesarios en el bucket connect-files. Nada existente se toca.
-- Rollback: el valor de enum queda inerte (Postgres no remueve valores); la lista
-- previa del bucket está documentada en 0148 (9 tipos imagen/pdf/texto/oficina).

alter type public.connect_message_kind_t add value if not exists 'audio';

-- Append-if-missing (idempotente): preserva la lista vigente y suma sólo lo ausente.
update storage.buckets b
   set allowed_mime_types = b.allowed_mime_types || (
     select coalesce(array_agg(m), '{}'::text[])
     from unnest(array['audio/webm','audio/mp4','audio/ogg','audio/mpeg']::text[]) m
     where not (m = any (b.allowed_mime_types))
   )
 where b.id = 'connect-files';
