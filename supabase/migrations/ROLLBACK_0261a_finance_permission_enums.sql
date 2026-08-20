-- ROLLBACK_0261a_finance_permission_enums.sql
--
-- Lógico, no destructivo — mismo criterio que ROLLBACK_0235a:
-- un valor de enum agregado con ADD VALUE no puede eliminarse con DROP VALUE sin
-- recrear el tipo completo (`permission_module_t` y `permission_action_t` son
-- referenciados por `permissions.module` y `permissions.action` en toda la base).
-- Los tres valores ('finanzas', 'plan', 'approve') quedan en el tipo, inertes:
-- tras el rollback de 0262 (que elimina las filas de `permissions`), los valores
-- de enum sin filas asociadas no producen ningún efecto observable.
--
-- Si en algún momento se necesitara removerlos del tipo, es una operación de
-- Dirección, a mano, fuera de este candidato.

select 1; -- no-op deliberado: ver nota arriba.
