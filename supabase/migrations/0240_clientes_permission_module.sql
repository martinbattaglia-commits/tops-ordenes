-- 0240_clientes_permission_module.sql — NEXUS-CLIENTES-ORDENES-PRECIOS-USUARIOS-001 · Carril A.
-- ─────────────────────────────────────────────────────────────────────────
-- ADITIVA. Extiende `permission_module_t` con el módulo `clientes`.
--
-- POR QUÉ VA SOLA
-- PostgreSQL prohíbe usar un valor de enum recién agregado dentro de la misma
-- transacción que lo agrega ("unsafe use of new value of enum type"). El
-- catálogo de permisos de `clientes` se siembra en 0241, que corre en su
-- propia transacción. Es el mismo patrón que ya usaron 0021 (`wms`), 0029
-- (`pedidos`), 0052 (`tesoreria`) y 0056 (`rrhh`): una migración diminuta cuyo
-- único acto es extender el enum.
--
-- ORDEN OBLIGATORIO: 0240 antes que 0241. Invertirlo hace fallar 0241 con
-- «invalid input value for enum permission_module_t: "clientes"».
--
-- IDEMPOTENTE: `add value if not exists` no falla si ya existe.
-- REVERSIBILIDAD: PostgreSQL NO permite quitar un valor de un enum. El
-- rollback documenta esa imposibilidad y explica por qué es inocua: un valor
-- de enum sin filas que lo referencien no tiene efecto observable.

alter type public.permission_module_t add value if not exists 'clientes';

-- PostgREST: refrescar el cache de esquema.
notify pgrst, 'reload schema';
