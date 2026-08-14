-- ROLLBACK_0235a_nexus_link_permission_module.sql
--
-- Lógico, no destructivo — mismo criterio que ROLLBACK 0142-0149 (sección A):
-- un valor de enum agregado con ADD VALUE no puede DROPearse sin recrear el
-- tipo completo (`permission_module_t` es referenciado por `permissions.module`
-- en TODA la base, así que recrearlo es una operación mayor, fuera de alcance
-- de un rollback rutinario). Los dos valores nuevos ('nexus_link_chat',
-- 'nexus_link_whatsapp') quedan en el tipo, inertes: sin filas de
-- `permissions` que los usen —ROLLBACK_0236 ya las borra por slug antes que
-- éste corra— un valor de enum sin filas no tiene efecto observable.
--
-- Si en algún momento se necesitara removerlos del tipo, es una operación de
-- Dirección, a mano, fuera de este candidato (idéntica reserva que 0142).

select 1; -- no-op deliberado: ver nota arriba.
