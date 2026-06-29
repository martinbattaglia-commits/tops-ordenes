-- =========================================================================
-- 0107_prospeccion_approval — Prospección Inteligente F2 · Aprobación humana + Export log
-- =========================================================================
-- Agrega el gate de aprobación humana (approve/reject) sobre prospectos
-- scoreados, y el registro de exportaciones hacia Clientify (y futuros CRMs).
-- Los nuevos permisos prospeccion.approve / prospeccion.export habilitan el
-- acceso granular sin alterar los permisos F0 existentes.
--
-- 100% ADITIVA · IDEMPOTENTE. Convenciones (0009/0082/0085/0089):
--   DO $$ ... IF NOT EXISTS ... ALTER TABLE ADD COLUMN ... END $$;
--   CREATE TABLE IF NOT EXISTS; ON CONFLICT DO NOTHING;
--   drop policy if exists + create policy;
--   RPC security definer + search_path fijo;
--   revoke from public/anon/authenticated + grant a service_role.
--   Seed RBAC via joins roles.slug + permissions.slug (patrón 0089).
--
-- DEPENDE de: prospeccion_prospects + prospeccion_status_t (0089),
--   has_permission() + roles + permissions + role_permissions (0009),
--   auth.users (Supabase Auth).
-- =========================================================================

-- =========================================================================
-- (A) Columnas de aprobación / rechazo en prospeccion_prospects
-- Se añaden solo si no existen (idempotente).
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'prospeccion_prospects'
      AND column_name  = 'approved_at'
  ) THEN
    ALTER TABLE public.prospeccion_prospects
      ADD COLUMN approved_at      timestamptz,
      ADD COLUMN approved_by      uuid REFERENCES auth.users(id),
      ADD COLUMN rejected_at      timestamptz,
      ADD COLUMN rejected_by      uuid REFERENCES auth.users(id),
      ADD COLUMN rejection_reason text;
  END IF;
END;
$$;

-- =========================================================================
-- (B) Tabla prospeccion_export_log
-- Registro append-only de cada lote exportado a Clientify (o futuro CRM).
-- results / errors guardan el detalle por prospecto (jsonb array).
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.prospeccion_export_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  exported_at    timestamptz NOT NULL DEFAULT now(),
  exported_by    uuid        NOT NULL REFERENCES auth.users(id),
  prospect_count int         NOT NULL,
  provider       text        NOT NULL DEFAULT 'clientify',
  results        jsonb       NOT NULL DEFAULT '[]',
  errors         jsonb       NOT NULL DEFAULT '[]',
  total_ok       int         NOT NULL DEFAULT 0,
  total_errors   int         NOT NULL DEFAULT 0
);

-- RLS
ALTER TABLE public.prospeccion_export_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS export_log_select ON public.prospeccion_export_log;
CREATE POLICY export_log_select ON public.prospeccion_export_log
  FOR SELECT TO authenticated
  USING (public.has_permission('prospeccion.view'));

DROP POLICY IF EXISTS export_log_insert ON public.prospeccion_export_log;
CREATE POLICY export_log_insert ON public.prospeccion_export_log
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('prospeccion.admin'));

-- =========================================================================
-- (C) RPC prospeccion_approve_prospect
-- Gate humano: mueve un prospecto a 'aprobado'.
-- Statuses permitidos: scoreado | enriquecido | imported
-- (acepta los tres para no bloquear prospectos que saltaron etapas de IA).
-- Retorna { ok: boolean, prospect_id: uuid }.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.prospeccion_approve_prospect(
  p_prospect_id uuid,
  p_actor_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current_status public.prospeccion_status_t;
BEGIN
  -- Verificar existencia y estado actual
  SELECT status INTO v_current_status
  FROM public.prospeccion_prospects
  WHERE id = p_prospect_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROSPECT_NOT_FOUND: %', p_prospect_id
      USING errcode = 'no_data_found';
  END IF;

  IF v_current_status NOT IN (
    'scoreado'::public.prospeccion_status_t,
    'enriquecido'::public.prospeccion_status_t,
    'imported'::public.prospeccion_status_t
  ) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: prospecto % tiene status % (se requiere scoreado/enriquecido/imported)',
      p_prospect_id, v_current_status
      USING errcode = 'check_violation';
  END IF;

  -- Transición a aprobado
  UPDATE public.prospeccion_prospects
  SET
    status       = 'aprobado'::public.prospeccion_status_t,
    approved_at  = now(),
    approved_by  = p_actor_id,
    -- Limpiar campos de rechazo previo si hubiese un ciclo approve→reject→approve
    rejected_at      = NULL,
    rejected_by      = NULL,
    rejection_reason = NULL,
    updated_at       = now()
  WHERE id = p_prospect_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'prospect_id', p_prospect_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prospeccion_approve_prospect(uuid, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospeccion_approve_prospect(uuid, uuid)
  TO service_role;

-- =========================================================================
-- (D) RPC prospeccion_reject_prospect
-- Gate humano: mueve un prospecto a 'rechazado' con motivo.
-- Retorna { ok: boolean }.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.prospeccion_reject_prospect(
  p_prospect_id uuid,
  p_actor_id    uuid,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Verificar existencia
  IF NOT EXISTS (
    SELECT 1 FROM public.prospeccion_prospects WHERE id = p_prospect_id
  ) THEN
    RAISE EXCEPTION 'PROSPECT_NOT_FOUND: %', p_prospect_id
      USING errcode = 'no_data_found';
  END IF;

  -- Transición a rechazado (desde cualquier estado que no sea ya rechazado o cliente_creado)
  UPDATE public.prospeccion_prospects
  SET
    status           = 'rechazado'::public.prospeccion_status_t,
    rejected_at      = now(),
    rejected_by      = p_actor_id,
    rejection_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
    -- Limpiar campos de aprobación si el prospecto había sido aprobado previamente
    approved_at  = NULL,
    approved_by  = NULL,
    updated_at   = now()
  WHERE id = p_prospect_id
    AND status <> 'cliente_creado'::public.prospeccion_status_t;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: prospecto % ya es cliente_creado y no puede rechazarse',
      p_prospect_id
      USING errcode = 'check_violation';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.prospeccion_reject_prospect(uuid, uuid, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospeccion_reject_prospect(uuid, uuid, text)
  TO service_role;

-- =========================================================================
-- (E) Seed RBAC — permisos prospeccion.approve + prospeccion.export
-- Idempotente: ON CONFLICT DO NOTHING.
-- Los roles usan la misma convención que 0089 (joins por slug).
-- =========================================================================

-- Permiso: aprobación humana
INSERT INTO public.permissions (slug, module, action, label, description)
VALUES (
  'prospeccion.approve',
  'prospeccion',
  'approve',
  'Aprobar / rechazar prospectos',
  'Gate humano antes de exportar a Clientify'
)
ON CONFLICT (slug) DO NOTHING;

-- Permiso: exportación a CRM
INSERT INTO public.permissions (slug, module, action, label, description)
VALUES (
  'prospeccion.export',
  'prospeccion',
  'export',
  'Exportar a Clientify',
  'Envía prospectos aprobados al CRM'
)
ON CONFLICT (slug) DO NOTHING;

-- Grant prospeccion.approve a comercial, director_ops, admin
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT ro.id, p.id
FROM public.roles ro
JOIN public.permissions p ON p.slug = 'prospeccion.approve'
WHERE ro.slug IN ('comercial', 'director_ops', 'admin')
ON CONFLICT DO NOTHING;

-- Grant prospeccion.export a comercial, director_ops, admin
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT ro.id, p.id
FROM public.roles ro
JOIN public.permissions p ON p.slug = 'prospeccion.export'
WHERE ro.slug IN ('comercial', 'director_ops', 'admin')
ON CONFLICT DO NOTHING;

-- ---- Refrescar caché de esquema PostgREST ---------------------------------
NOTIFY pgrst, 'reload schema';
