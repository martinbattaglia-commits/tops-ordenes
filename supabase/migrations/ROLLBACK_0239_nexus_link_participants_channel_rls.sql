-- ROLLBACK_0239_nexus_link_participants_channel_rls.sql
--
-- Revierte 0239 dejando la policy exactamente como la dejó 0143 (el estado que
-- también tenía tras 0236/0237/0238, que nunca la tocaron).
--
-- ⚠️ Al revertir, `connect_participants.external_ref` —incluido el teléfono de
-- la contraparte— vuelve a ser legible por cualquier participante del hilo sin
-- capacidad de WhatsApp, y por `is_admin()`. Es el estado ANTERIOR a este
-- candidato, no una degradación nueva, pero conviene tenerlo presente antes de
-- ejecutar este rollback contra un ambiente con datos reales.
--
-- No toca `_connect_channel_allowed`, `nexus_link_can` ni ningún otro helper:
-- son de 0236/0237 y su rollback es responsabilidad de esos archivos.

drop policy if exists "connect_participants select" on public.connect_participants;
create policy "connect_participants select"
  on public.connect_participants for select
  using (
    public.has_permission('connect.view')
    and (public._connect_is_member(conversation_id) or public.is_admin())
  );

notify pgrst, 'reload schema';
