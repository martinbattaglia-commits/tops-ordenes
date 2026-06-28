-- ============================================================
-- Migración 0122 — Fundación Factura Electrónica MiPyME (FCE)
-- ------------------------------------------------------------
-- Requerimiento 3 (Contadora): antes de emitir, validar si el cliente
-- pertenece al Registro MiPyME y si el importe supera el mínimo, para
-- emitir FCE MiPyME y bloquear la emisión de comprobante común cuando
-- corresponde.
--
-- DISEÑO SEGURO: el bloqueo está DESACTIVADO por defecto
-- (mipyme_config.activo = false). No cambia el comportamiento de emisión
-- actual hasta que la Contadora confirme: (a) que VEROTIN es MiPyME emisor,
-- (b) el monto mínimo vigente, y (c) active la validación. La emisión real
-- de FCE (Opcionales/CBU + WS de padrón + credenciales ARCA) queda preparada.
-- ============================================================

-- ─── Estado MiPyME del cliente (Registro PyME) ───────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS es_mipyme           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mipyme_categoria    text,
  ADD COLUMN IF NOT EXISTS mipyme_verificado_at timestamptz,
  ADD COLUMN IF NOT EXISTS mipyme_fuente       text;
COMMENT ON COLUMN public.clients.es_mipyme        IS 'Cliente inscripto en el Registro MiPyME (fuente: manual u ARCA padrón cuando se active).';
COMMENT ON COLUMN public.clients.mipyme_categoria IS 'Categoría PyME (Micro/Pequeña/Mediana tramo 1-2), si se conoce.';
COMMENT ON COLUMN public.clients.mipyme_verificado_at IS 'Fecha/hora de la última verificación del estado MiPyME.';
COMMENT ON COLUMN public.clients.mipyme_fuente    IS 'Origen del dato: manual | arca_padron | importacion.';

-- ─── Estado MiPyME del emisor (VEROTIN) ──────────────────────
ALTER TABLE public.fiscal_config
  ADD COLUMN IF NOT EXISTS emisor_es_mipyme       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emisor_mipyme_categoria text;
COMMENT ON COLUMN public.fiscal_config.emisor_es_mipyme IS 'El emisor (VEROTIN) está inscripto como MiPyME y habilitado a emitir FCE.';

-- ─── Configuración de la validación FCE MiPyME (singleton) ────
CREATE TABLE IF NOT EXISTS public.mipyme_config (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  activo        boolean NOT NULL DEFAULT false,
  monto_minimo  numeric(14,2) NOT NULL DEFAULT 0,
  vigente_desde date NOT NULL DEFAULT current_date,
  notas         text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);
COMMENT ON TABLE public.mipyme_config IS
  'Parámetros de la validación FCE MiPyME. activo=false => validación desactivada (no bloquea). La Contadora debe confirmar monto_minimo y activar.';

INSERT INTO public.mipyme_config (id, activo, monto_minimo, notas)
VALUES (1, false, 0,
  'Pendiente de confirmación de la Contadora: emisor MiPyME (fiscal_config.emisor_es_mipyme) y monto mínimo vigente. Activar (activo=true) recién tras esa confirmación.')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.mipyme_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mipyme_config read" ON public.mipyme_config;
CREATE POLICY "mipyme_config read" ON public.mipyme_config FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "mipyme_config write" ON public.mipyme_config;
CREATE POLICY "mipyme_config write" ON public.mipyme_config FOR ALL
  USING ("current_role"() = 'admin'::user_role_t OR has_permission('contabilidad.edit'))
  WITH CHECK ("current_role"() = 'admin'::user_role_t OR has_permission('contabilidad.edit'));

CREATE INDEX IF NOT EXISTS clients_es_mipyme_idx ON public.clients(es_mipyme) WHERE es_mipyme = true;
