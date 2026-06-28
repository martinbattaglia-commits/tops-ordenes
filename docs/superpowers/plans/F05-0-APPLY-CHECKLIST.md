# F0.5 — Checklist de aplicación manual (Martín)

> Las migraciones se ENTREGAN, NO se aplican (G3). Aplicar SOLO cuando el bloque F0.5 esté completo.

## Precondición
- [ ] `ls supabase/migrations/ | sort` confirma que 0106–0119 están libres como nombre de archivo (prod rastrea por timestamp; NO usar list_migrations).
- [ ] El bloque F0.5 (0106, 0107, 0108, 0109, 0110, 0111) está completo. (0108/0109/0111 los entrega F0.5.1.)

## Orden de aplicación (en el SQL editor de Supabase, prod arsksytgdnzukbmfgkju)
1. [ ] Aplicar `0106_knowledge_module_enum.sql` SOLA, en su propia transacción. Verificar: `select unnest(enum_range(null::public.permission_module_t));` incluye `knowledge`.
2. [ ] Aplicar `0107_knowledge_core.sql`. Verificar: las 9 tablas `knowledge_*` existen con RLS habilitada (`select relname, relrowsecurity from pg_class where relname like 'knowledge_%'`).
3. [ ] Aplicar `0108`, `0109`, `0111` (de F0.5.1) en orden.
4. [ ] Aplicar `0110_knowledge_rbac_seed.sql`. Verificar: `select slug from public.permissions where module='knowledge';` devuelve 5 filas.
5. [ ] `get_advisors` (security + performance) sin hallazgos nuevos.

## Smoke de RLS (post-aplicación)
- [ ] Un usuario `comercial` ve `knowledge.view` en su set de permisos; un `cliente_b2b` NO.

## Rollback
- Todo es aditivo. Rollback = `drop table` de las tablas `knowledge_*` nuevas + revocar los grants `knowledge.*`. El valor de enum `knowledge` NO se puede quitar fácilmente (es inocuo si queda).
