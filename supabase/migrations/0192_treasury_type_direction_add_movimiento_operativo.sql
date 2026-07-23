-- =========================================================================
-- 0192_treasury_type_direction_add_movimiento_operativo.sql — M4 (integración de tipo)
--
-- Expediente: "Completar operatoria diaria de Tesorería" (2026-07-17).
-- Autoridad: Dirección (dictamen semántico ratificado + autorización expresa).
--
-- Integra el nuevo type 'movimiento_operativo' en el constraint de coherencia
-- type↔direction. Dictamen: 'movimiento_operativo' es de DIRECCIÓN LIBRE, como
-- 'transferencia' y 'ajuste'.
--
-- ALCANCE ESTRICTO (Dirección): recrea EXCLUSIVAMENTE treasury_movements_type_direction_ck,
-- preservando ÍNTEGRAMENTE las cuatro cláusulas históricas e incorporando SOLO
-- la cláusula OR (type = 'movimiento_operativo'). No modifica tablas, columnas,
-- datos, índices, permisos, demás constraints, triggers, funciones, vistas ni políticas.
--
-- ⚠️ NÚMERO PROVISIONAL. Se aplica por MCP bajo GO de Dirección (DA-001). Idempotente
--    (drop if exists + add). Las 8 filas existentes satisfacen las cláusulas históricas.
-- =========================================================================

alter table public.treasury_movements
  drop constraint if exists treasury_movements_type_direction_ck;

alter table public.treasury_movements
  add constraint treasury_movements_type_direction_ck check (
       (type = 'cobranza'          and direction = 'ingreso')
    or (type = 'pago_proveedor'    and direction = 'egreso')
    or (type = 'transferencia')
    or (type = 'ajuste')
    or (type = 'movimiento_operativo')   -- ← M4: dirección libre (dictamen ratificado)
  );
