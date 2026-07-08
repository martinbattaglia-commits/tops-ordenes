-- ============================================================
-- Migración 0123 — Valores FCE MiPyME en comprobante_tipo_t
-- ------------------------------------------------------------
-- Agrega los tipos de Factura de Crédito Electrónica MiPyME al enum de
-- comprobantes. PREPARADO para activación: el flujo de emisión seguirá
-- usando los comprobantes comunes hasta que se active la FCE (credenciales
-- ARCA + Opcionales/CBU). Migración aislada (solo ALTER TYPE), por ADR-011.
-- Idempotente (ADD VALUE IF NOT EXISTS).
-- ============================================================

ALTER TYPE comprobante_tipo_t ADD VALUE IF NOT EXISTS 'FACTURA_MIPYME_A';
ALTER TYPE comprobante_tipo_t ADD VALUE IF NOT EXISTS 'NOTA_DEBITO_MIPYME_A';
ALTER TYPE comprobante_tipo_t ADD VALUE IF NOT EXISTS 'NOTA_CREDITO_MIPYME_A';
ALTER TYPE comprobante_tipo_t ADD VALUE IF NOT EXISTS 'FACTURA_MIPYME_B';
ALTER TYPE comprobante_tipo_t ADD VALUE IF NOT EXISTS 'NOTA_DEBITO_MIPYME_B';
ALTER TYPE comprobante_tipo_t ADD VALUE IF NOT EXISTS 'NOTA_CREDITO_MIPYME_B';
