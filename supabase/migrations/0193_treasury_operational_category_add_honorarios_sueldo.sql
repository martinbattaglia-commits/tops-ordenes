-- =========================================================================
-- 0193_treasury_operational_category_add_honorarios_sueldo.sql — T-004 · Gate 1 (enum)
--
-- Expediente: "Tesorería Stabilization Pack" (2026-07-22) · entregable T-004.
-- Autoridad: Dirección — instrucción expresa de completar los pendientes
--   funcionales: categoría Honorarios, categoría Adelanto de Sueldo y selección
--   formal de Beneficiario. ADITIVO. No crea tablas, no toca datos.
--
-- ⚠️ Debe correrse AISLADA y COMMITEARSE antes de 0194. Postgres no permite USAR
--    un valor nuevo de enum en la misma transacción que el ALTER TYPE
--    ("unsafe use of new value of enum type"). Mismo patrón que 0189 → 0190.
--    0194 usa 'honorarios' y 'adelanto_sueldo' dentro de un CHECK ⇒ dependencia real.
--
-- ⚠️ Se aplica A MANO por Dirección (G3 / DA-001). El asistente NO aplica.
--    Idempotente (`add value if not exists`).
--
-- Nota de diseño: 'adelanto_sueldo' NO reemplaza a 'adelanto_efectivo'. Son
--   distintos: 'adelanto_efectivo' es entrega de caja sin vínculo laboral;
--   'adelanto_sueldo' es anticipo de remuneración y la Contadora lo imputa
--   distinto. Ninguna fila existente cambia de categoría.
-- =========================================================================

alter type public.treasury_operational_category_t add value if not exists 'honorarios';
alter type public.treasury_operational_category_t add value if not exists 'adelanto_sueldo';

notify pgrst, 'reload schema';
