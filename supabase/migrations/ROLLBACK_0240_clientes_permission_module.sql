-- ROLLBACK_0240_clientes_permission_module.sql
-- ─────────────────────────────────────────────────────────────────────────
-- INVERSA DE 0240. NO ES FORWARD. No se ejecuta en un despliegue normal.
--
-- POSTGRESQL NO PERMITE QUITAR UN VALOR DE UN ENUM.
-- `alter type ... drop value` no existe. La única forma de eliminar
-- 'clientes' de `permission_module_t` sería recrear el tipo entero y
-- reescribir todas las columnas que lo usan (`permissions.module`), lo cual
-- es destructivo y desproporcionado.
--
-- POR QUÉ NO HACE FALTA
-- Un valor de enum sin filas que lo referencien no tiene ningún efecto
-- observable: no cambia el comportamiento de la aplicación, no ocupa espacio
-- material y no rompe ninguna consulta. Revertir 0241 (que borra las filas de
-- `permissions` del módulo `clientes`) deja el valor huérfano e inerte.
--
-- ACCIÓN DE ESTE ROLLBACK: verificar que no quede ninguna fila usando el
-- valor. Si quedara alguna, aborta ruidosamente en vez de dejar un estado
-- ambiguo: significa que 0241 no fue revertido primero.

do $$
declare
  v_filas bigint;
begin
  select count(*) into v_filas from public.permissions where module = 'clientes';
  if v_filas > 0 then
    raise exception
      'ROLLBACK_0240 abortado: quedan % filas en public.permissions con module=''clientes''. Revertí 0241 primero.', v_filas;
  end if;
  raise notice 'ROLLBACK_0240: sin filas que referencien el valor. El valor de enum queda huérfano e inerte (PostgreSQL no permite quitarlo).';
end$$;
