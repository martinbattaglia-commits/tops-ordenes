-- 0234_link_notification_badges_tricolor.sql — NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A.
-- ─────────────────────────────────────────────────────────────────────────
-- ADITIVA y BACKWARD-COMPATIBLE. No crea ni borra tablas, no toca datos,
-- no modifica RLS ni otorga permisos nuevos: sólo redefine dos vistas ya
-- existentes (mismos nombres y mismas columnas) y agrega una vista nueva.
--
-- DEFECTO QUE CIERRA (A.3)
-- `connect_messages.seq` es `generated always as identity` a nivel de TABLA:
-- es un identificador GLOBAL, no un contador por conversación (0143 §3).
-- `connect_conversations.last_message_seq` copia ese valor global (0144:34,
-- 0161:214). La vista 0145 calculaba:
--     unread_count = last_message_seq - last_read_seq
-- es decir, restaba un cursor a un ID global. Para toda conversación nunca
-- abierta (`last_read_seq = 0`) el badge mostraba el ID global del último
-- mensaje. Medido en producción (sólo lectura, 2026-08-14):
--     "Maria Soledad" last_message_seq=1572 · mensajes reales=2
--     "Brenda"        last_message_seq=1570 · mensajes reales=1
--     "matias"        last_message_seq=1569 · mensajes reales=3
-- que son exactamente los badges 1572/1570/1569 reportados por Dirección.
--
-- CORRECCIÓN
-- El cursor `last_read_seq` es una marca de agua correcta (0144
-- connect_mark_read la avanza con greatest()). El defecto está sólo en la
-- ARITMÉTICA. Se reemplaza la resta por un CONTEO REAL de mensajes
-- posteriores al cursor, excluyendo lo que el mandato prohíbe contar:
-- eventos técnicos (`kind = 'system'`), mensajes borrados y salientes
-- propios. En conversaciones WhatsApp sólo cuentan los mensajes entrantes
-- reales del contacto (`author_profile_id is null`): todo lo originado en
-- Nexus es saliente y no es un pendiente de lectura ni de respuesta.
--
-- NO INCLUYE: reparación de cursores del histórico importado. El corte de
-- importación todavía no tiene un universo exacto y cerrado verificado
-- (`meta` no lleva marca de procedencia y `created_at` guarda la fecha
-- original del mensaje, no la de ingesta), y el mandato prohíbe reparar
-- sobre un universo ambiguo. Queda fuera de esta entrega.
-- ORDEN DE DESPLIEGUE OBLIGATORIO: primero esta migración, después el código.
-- Al revés no rompe nada —la campanita degrada a cero por diseño— pero deja al
-- operador viendo los badges inflados de 0145 en la bandeja y la campanita
-- apagada al mismo tiempo, que es peor que el defecto original. Aplicar 0234 y
-- recién entonces publicar el build.
--
-- DEPENDE de 0143/0144/0145. Rollback: ROLLBACK_0234_link_notification_badges_tricolor.sql
-- ─────────────────────────────────────────────────────────────────────────

-- Bandeja: idéntico contrato de columnas que 0145; sólo cambia el cálculo
-- de unread_count (resta de secuencias → conteo real de mensajes).
create or replace view public.v_connect_inbox
with (security_invoker = true) as
select
  c.id                as conversation_id,
  c.context_id,
  c.kind,
  c.title,
  c.slug,
  c.topic,
  c.last_message_at,
  c.last_message_seq,
  p.last_read_seq,
  (
    select count(*)
      from public.connect_messages m
     where m.conversation_id = c.id
       and m.seq > coalesce(p.last_read_seq, 0)
       and m.deleted_at is null
       and m.kind <> 'system'
       and case
             when c.kind = 'whatsapp' then m.author_profile_id is null
             else coalesce(m.author_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  is distinct from p.profile_id
           end
  )::bigint          as unread_count,
  p.is_favorite,
  p.muted_until,
  c.archived_at
from public.connect_conversations c
join public.connect_participants  p
  on p.conversation_id = c.id and p.profile_id = auth.uid();

-- Contador global heredado (compatibilidad): misma columna `unread_total`,
-- ahora sobre el conteo real y sin conversaciones silenciadas ni archivadas.
--
-- El tipo se preserva DELIBERADAMENTE en `numeric`, que es el que produce
-- `coalesce(sum(...),0)` en 0145. `create or replace view` rechaza cualquier
-- cambio de tipo de una columna existente ("cannot change data type of view
-- column"), así que castear a bigint haría fallar la migración contra toda
-- base que ya tenga 0145 aplicada — incluida producción. Verificado por
-- T-LINK-A1-01 contra PostgreSQL real.
create or replace view public.v_connect_unread_total
with (security_invoker = true) as
select coalesce(sum(i.unread_count), 0) as unread_total
  from public.v_connect_inbox i
 where (i.muted_until is null or i.muted_until < now())
   and i.archived_at is null;

-- Campanita de tres colores (A.1/A.2): tres contadores independientes.
--   red    = notificaciones del sistema dirigidas a mí, sin leer (respeta el
--            snooze `remind_at`)
--   green  = mensajes de WhatsApp pendientes
--   yellow = mensajes pendientes en chats internos nativos
--
-- COEXISTENCIA ROJO+AMARILLO — DELIBERADA. Una mención o un mensaje de un hilo
-- de tarea/incidente inserta fila en `notifications` (fan-out 0161/0165/0169) Y
-- deja el mensaje pendiente. El mandato lo fija de forma expresa: "menciones
-- notificadas" están enumeradas bajo ROJO, y "Una mención puede producir: ROJO
-- por la notificación; AMARILLO por el mensaje pendiente. No suprimir una
-- categoría mediante la otra." No es duplicación: son dos hechos distintos
-- —me avisaron / me falta leer— y el mandato prohíbe que uno tape al otro.
-- (La deduplicación D-F41-2 de src/lib/notifications/data.ts es otra cosa: evita
-- que la LISTA del Centro muestre dos filas del mismo hecho. No aplica a los
-- contadores por categoría.)
create or replace view public.v_link_notification_badges
with (security_invoker = true) as
select
  (
    -- C4 · B-1: el filtro de destinatario va DENTRO de la vista, no delegado a
    -- la RLS. La policy de `notifications` (0004 + 0162) incluye la rama
    -- `current_role() = 'admin'`, pensada para que un administrador AUDITE
    -- todo el sistema. Si el contador se apoyara sólo en ella, los cuatro
    -- perfiles admin verían las 28 no leídas de toda la organización y su
    -- badge rojo jamás podría llegar a cero por su propia acción. La RLS es
    -- frontera de seguridad; "mis pendientes" es una definición de negocio y
    -- se escribe acá.
    select count(*)
      from public.notifications n
     where n.read_at is null
       and (n.remind_at is null or n.remind_at <= now())
       and (
            n.user_id      = auth.uid()
         or n.delegated_to = auth.uid()
         or (n.user_id is null and n.role_target is not null
             and n.role_target = public.current_role())
       )
  )::bigint as red_system_count,
  coalesce((
    select sum(i.unread_count)
      from public.v_connect_inbox i
     where i.kind = 'whatsapp'
       and (i.muted_until is null or i.muted_until < now())
       and i.archived_at is null
  ), 0)::bigint as green_whatsapp_count,
  coalesce((
    select sum(i.unread_count)
      from public.v_connect_inbox i
     where i.kind <> 'whatsapp'
       and (i.muted_until is null or i.muted_until < now())
       and i.archived_at is null
  ), 0)::bigint as yellow_internal_count;

grant select on public.v_link_notification_badges to authenticated;

notify pgrst, 'reload schema';
