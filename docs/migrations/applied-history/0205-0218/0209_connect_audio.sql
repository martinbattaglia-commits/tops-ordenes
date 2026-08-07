-- 0209_connect_audio.sql — LINK-MEDIA-001 (aditiva pura).
alter type public.connect_message_kind_t add value if not exists 'audio';

update storage.buckets b
   set allowed_mime_types = b.allowed_mime_types || (
     select coalesce(array_agg(m), '{}'::text[])
     from unnest(array['audio/webm','audio/mp4','audio/ogg','audio/mpeg']::text[]) m
     where not (m = any (b.allowed_mime_types))
   )
 where b.id = 'connect-files';
