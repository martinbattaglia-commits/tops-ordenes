-- =========================================================================
-- 0007_extend_service_units — extiende enum service_unit_t con m3 y viaje
-- =========================================================================
-- Contexto:
--   El motor de Precio Inteligente ENERO 2026 introduce dos nuevas unidades:
--     · 'm3'    → servicios de picking, carga palletizada y carga suelta,
--                 que se cobran por metro cúbico.
--     · 'viaje' → transporte por viaje completo (Qubo, Chasis 710,
--                 Balancín 1720, Semi), según tarifario FEBRERO 2026.
--
--   El enum original (migration 0001) solo aceptaba 'hs','km','pal','mes','un'.
--   Si no se agregan estos valores, los inserts de order_services con
--   unit='m3' o unit='viaje' fallan con:
--     "invalid input value for enum service_unit_t"
--
-- Idempotente: usa IF NOT EXISTS.
-- =========================================================================

alter type service_unit_t add value if not exists 'm3';
alter type service_unit_t add value if not exists 'viaje';

-- Verificación (correr post-migración):
--   select unnest(enum_range(NULL::service_unit_t)) as unidad;
-- Esperado: hs, km, pal, mes, un, m3, viaje
