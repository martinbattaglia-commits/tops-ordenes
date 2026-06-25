-- 0088 — Agrega el valor 'prospeccion' al enum permission_module_t.
--
-- CONTEXTO: en prod el enum permission_module_t NO incluye 'prospeccion' (sí 'comercial').
-- El módulo de Prospección Inteligente necesita su propio módulo de permisos para que el
-- guard RBAC de /comercial/prospeccion pueda evaluar prospeccion.* (view/create/edit/delete/admin).
--
-- IMPORTANTE: este ALTER va en su propia migración/transacción. Postgres no permite USAR un
-- valor de enum recién agregado dentro de la misma transacción → la creación de los permisos
-- y los grants viven en 0089 (molde idéntico: 0086 → 0087 de mi_espacio).
alter type public.permission_module_t add value if not exists 'prospeccion';

-- PostgREST: refrescar el caché de esquema para que el nuevo valor de enum sea visible vía API.
select pg_notify('pgrst', 'reload schema');
