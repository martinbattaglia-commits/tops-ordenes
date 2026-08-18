-- =========================================================================
-- ROLLBACK LOGICO · 0256 · LA PERILLA DE CONTRATACION
--
-- Inversa logica e IDEMPOTENTE de 0256. NO es forward.
--
-- ORDEN: no depende de ninguna otra inversa. No toca `client_update`,
-- `client_create` ni `client_set_active`, asi que la guarda de orden de
-- ROLLBACK_0241:27-30 queda intacta y sigue disparando con sus tres
-- condiciones. Esa fue la razon de elegir una RPC hermana.
--
-- ─── LO QUE NO DESHACE, A PROPOSITO ──────────────────────────────────────
--
-- 1. No borra ningun `client_events`. La auditoria de quien contrato o
--    rescindio custodia es probatoria y sobrevive a la inversa. Mismo criterio
--    que ROLLBACK_0241, cuyo preflight declara que nunca elimina auditoria.
--
-- 2. No modifica `clients.custody_level` de ningun cliente. Revertir el codigo
--    que escribe el nivel no es revertir el servicio contratado: bajar
--    clientes en silencio dejaria mercaderia bajo custodia sin su aparato, que
--    es justamente el incidente que este bloque evita.
--
-- 3. No quita el valor 'custody_contract' del enum: PostgreSQL no lo admite.
--    Queda inerte, sin ninguna fila que lo use. Ver 0255.
--
-- 4. No borra el permiso si algun rol lo tiene asignado. Las asignaciones son
--    decision de Direccion y ROLLBACK_0241 las declara intocables. Si el
--    permiso quedo sin asignar —el estado en que nace— se retira; si alguien
--    ya lo repartio, se conserva y la inversa lo dice.
-- =========================================================================

begin;

drop function if exists public.client_set_custody_level(uuid, smallint, text, timestamptz);

do $$
declare
  v_asignaciones int;
begin
  select count(*) into v_asignaciones
    from public.role_permissions rp
    join public.permissions p on p.id = rp.permission_id
   where p.slug = 'clientes.custody.contract';

  if v_asignaciones = 0 then
    delete from public.permissions where slug = 'clientes.custody.contract';
  else
    raise notice
      'ROLLBACK_0256: el permiso clientes.custody.contract tiene % asignacion(es) y se conserva', 
      v_asignaciones;
  end if;
end $$;

commit;
