-- 0239_nexus_link_participants_channel_rls.sql — NEXUS LINK · cierre de H1.
-- ─────────────────────────────────────────────────────────────────────────
-- ADITIVA. No borra `external_ref`, no migra datos, no quita ningún permiso
-- vigente. Cierra un ÚNICO predicado que 0237 dejó abierto.
--
-- QUÉ CIERRA
-- `connect_participants.external_ref->>'phone'` guarda, en claro, el teléfono
-- de la contraparte de WhatsApp (lo escriben `connect/wa-import/ingest.ts` y
-- `whatsapp/link-projection.supabase.ts`). Medido en producción (2026-08-14,
-- sólo lectura): 21 de 26 participantes `participant_type='whatsapp'` lo
-- tienen. La policy SELECT de esta tabla —reproducida literal de 0143:372-375—
-- NO tiene predicado de canal, y ni 0236 ni 0237 la tocaron: 0237 enumera
-- explícitamente las superficies que cierra (mensajes, adjuntos,
-- conversaciones, signed URL) y `connect_participants` no está entre ellas.
-- Resultado: un participante del hilo SIN `nexus_link.whatsapp.read` —el
-- escenario exacto que 0236 declara su amenaza— lee el teléfono por
-- PostgREST y lo recibe por realtime, porque la tabla está publicada desde
-- 0147.
--
-- CÓMO CIERRA
-- Se reutiliza `_connect_channel_allowed(uuid)` (0237), SIN definir ninguna
-- función nueva: es la misma que ya filtra mensajes, adjuntos y
-- conversaciones, con las mismas garantías ya endurecidas (SECURITY DEFINER,
-- `search_path` fijo, sin grant a `anon`/`public`). Aplicarla acá no
-- introduce una superficie nueva que auditar — extiende una ya auditada.
--
-- El predicado va como AND EXTERNO, exactamente como en la policy de
-- `connect_conversations` de 0237: alcanza tanto a la rama `_connect_is_member`
-- como a la rama `is_admin()`, así que ninguna de las dos lo esquiva.
--
-- POR QUÉ NO HAY CAMBIO DE INSERT/UPDATE/DELETE
-- `connect_participants` (0143) no tiene policy INSERT para `authenticated`:
-- las altas sólo ocurren vía funciones SECURITY DEFINER o `service_role`
-- (proyección del inbound, importador, RPCs de membresía), que no pasan por
-- RLS. UPDATE está limitado por grant de columna a
-- `last_read_seq/muted_until/notif_pref/is_favorite` (SEC-PARTICIPANTS-1,
-- 0143) — ninguna de esas columnas es `external_ref`. DELETE ya exige
-- `is_admin()`. Ninguna de las tres es la vía de fuga medida.
--
-- LO QUE QUEDA EXPLÍCITAMENTE FUERA (no es H1, no se toca acá)
-- El INSERT de `connect_messages` (0143) no exige `_connect_channel_allowed`:
-- un participante sin capacidad de envío podría insertar por PostgREST un
-- mensaje en un hilo de WhatsApp (no sale a Meta, pero los operadores
-- autorizados lo verían como propio del equipo). Es un hallazgo real
-- (H3 en el registro C4 de esta rama), pero no es el que Dirección autorizó
-- cerrar en este candidato: el mandato nombra específicamente
-- `connect_participants`. Queda documentado y pendiente de autorización
-- separada, para no ampliar el candidato más allá de lo pedido.
--
-- DEPENDE de: `_connect_channel_allowed` (0237), `nexus_link_can` (0236).
-- Rollback: ROLLBACK_0239_nexus_link_participants_channel_rls.sql
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "connect_participants select" on public.connect_participants;
create policy "connect_participants select"
  on public.connect_participants for select
  using (
    public.has_permission('connect.view')
    and (public._connect_is_member(conversation_id) or public.is_admin())
    and public._connect_channel_allowed(conversation_id)
  );

notify pgrst, 'reload schema';
