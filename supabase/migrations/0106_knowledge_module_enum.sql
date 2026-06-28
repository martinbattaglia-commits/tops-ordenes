-- ENTREGADA, NO APLICADA — F0.5 Knowledge Layer; verificar numeración contra prod arsksytgdnzukbmfgkju
-- 0106 — Agrega el valor 'knowledge' al enum permission_module_t.
--
-- Bounded context propio cross-cutting. En prod permission_module_t NO incluye 'knowledge'.
-- ALTER en su PROPIA transacción: Postgres no permite USAR un valor de enum recién agregado
-- en la misma transacción → el seed de permisos/roles vive en 0110 (molde 0086→0087 / 0088→0089).
alter type public.permission_module_t add value if not exists 'knowledge';

-- PostgREST: refrescar caché de esquema.
select pg_notify('pgrst', 'reload schema');
