-- =========================================================================
-- 0189_treasury_operational_movement_enum.sql — Movimientos Operativos de Tesorería · Gate 1 (enums)
--
-- Expediente: "Completar operatoria diaria de Tesorería" (2026-07-17).
-- Autoridad: Dirección (arquitectura funcional cerrada). ADITIVO. No crea tablas ni toca datos.
--
-- ⚠️ Debe correrse AISLADA y COMMITEARSE antes de 0190. Postgres no permite
--    USAR un valor nuevo de enum en la misma transacción que el ALTER TYPE
--    ("unsafe use of new value of enum type"). Mismo patrón que 0052 y 0088:
--    el valor nuevo se agrega acá; su USO vive en 0190.
--
-- ⚠️ NÚMERO PROVISIONAL. Reservar el número libre real al aplicar, contra las
--    migraciones de prod (high-water = 0179) y las ramas activas. Se aplica A MANO
--    por Dirección (G3 / DA-001). El asistente NO aplica.
-- =========================================================================

-- Identidad propia del movimiento operativo. NO reutiliza 'ajuste' (reservado a
-- la baseline del reinicio) ni la palabra "manual" (forma de carga).
alter type public.treasury_movement_type_t add value if not exists 'movimiento_operativo';

-- Categoría operativa. 'regularizacion' reemplaza al antiguo 'ajuste' operativo;
-- la palabra "ajuste" queda reservada institucionalmente a la baseline.
-- (Sin 'transferencia_extraordinaria': las transferencias usan el flujo existente.)
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'treasury_operational_category_t' and n.nspname = 'public') then
    create type public.treasury_operational_category_t as enum (
      'adelanto_director',
      'adelanto_efectivo',
      'reintegro',
      'regularizacion',
      'gasto_operativo',
      'otro'
    );
  end if;
end $$;

notify pgrst, 'reload schema';
