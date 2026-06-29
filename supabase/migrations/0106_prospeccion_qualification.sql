-- =========================================================================
-- 0106_prospeccion_qualification — Prospección Inteligente F2 · Enriquecimiento y Scoring
-- =========================================================================
-- Agrega la capa de calificación (enrichment + scoring) al módulo prospeccion.
-- El scoring es append-only (immutable audit trail). La RPC prospeccion_record_qualification
-- es la ÚNICA puerta de escritura: enriquece y scorea de forma atómica por prospecto.
--
-- 100% ADITIVA · IDEMPOTENTE. Convenciones (0009/0082/0085/0089):
--   id uuid default gen_random_uuid(); created_at default now();
--   RLS con public.has_permission() (RBAC dormido → RLS es la frontera real);
--   RPC security definer + search_path fijo;
--   drop policy if exists + create policy (sin "IF NOT EXISTS" en policy);
--   revoke from public/anon/authenticated + grant a service_role.
--
-- DEPENDE de: prospeccion_prospects + prospeccion_status_t (0089),
--   has_permission() (0009), auth.users (Supabase Auth).
-- =========================================================================

-- =========================================================================
-- (A) Tabla prospeccion_enrichment
-- Perfil enriquecido del prospecto (empresa). Append-only por diseño: cada
-- pipeline de enrichment crea una versión nueva (profile_version incremental).
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.prospeccion_enrichment (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id                uuid        NOT NULL REFERENCES public.prospeccion_prospects(id) ON DELETE CASCADE,
  profile_version            int         NOT NULL DEFAULT 1,
  evidence_source            text        NOT NULL DEFAULT 'csv',
  source_event_id            uuid,
  -- Industria
  industry                   text,
  industry_normalized        text        CHECK (industry_normalized IN ('ideal', 'compatible', 'neutral', 'incompatible')),
  -- Tamaño
  employee_band              text        CHECK (employee_band IN ('XS', 'S', 'M', 'L', 'XL')),
  employees_raw              int,
  revenue_band               text,
  -- Geografía
  country                    text,
  is_argentina               boolean     NOT NULL DEFAULT false,
  -- Tipo de negocio
  is_b2b                     boolean,
  -- Señales de fit logístico
  has_depositos              boolean     NOT NULL DEFAULT false,
  has_import_export          boolean     NOT NULL DEFAULT false,
  has_distribucion_nacional  boolean     NOT NULL DEFAULT false,
  has_cds                    boolean     NOT NULL DEFAULT false,
  terceriza_almacenamiento   boolean     NOT NULL DEFAULT false,
  dentro_mercado_objetivo    boolean     NOT NULL DEFAULT false,
  -- Señal de crecimiento
  growth_signal              text        NOT NULL DEFAULT 'none'
                               CHECK (growth_signal IN ('none', 'low', 'mid', 'high')),
  -- Payload crudo del pipeline de enriquecimiento
  profile_raw                jsonb       NOT NULL DEFAULT '{}',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid        REFERENCES auth.users(id)
);

-- Índices
CREATE INDEX IF NOT EXISTS prospeccion_enrichment_prospect_idx
  ON public.prospeccion_enrichment (prospect_id);

CREATE INDEX IF NOT EXISTS prospeccion_enrichment_industry_idx
  ON public.prospeccion_enrichment (industry_normalized);

CREATE INDEX IF NOT EXISTS prospeccion_enrichment_source_idx
  ON public.prospeccion_enrichment (evidence_source);

-- RLS
ALTER TABLE public.prospeccion_enrichment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enrichment_select ON public.prospeccion_enrichment;
CREATE POLICY enrichment_select ON public.prospeccion_enrichment
  FOR SELECT TO authenticated
  USING (public.has_permission('prospeccion.view'));

DROP POLICY IF EXISTS enrichment_insert ON public.prospeccion_enrichment;
CREATE POLICY enrichment_insert ON public.prospeccion_enrichment
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('prospeccion.create'));

-- =========================================================================
-- (B) Tabla prospeccion_scores (append-only)
-- Registro inmutable de cada ejecución del pipeline de scoring.
-- La vista prospeccion_scores_current expone la última puntuación vigente.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.prospeccion_scores (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id         uuid        NOT NULL REFERENCES public.prospeccion_prospects(id),
  enrichment_id       uuid        REFERENCES public.prospeccion_enrichment(id),
  -- Puntuación principal
  score               int         NOT NULL CHECK (score >= 0 AND score <= 100),
  confidence          int         NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  -- Prioridad y decisión
  priority_tier       text        NOT NULL CHECK (priority_tier IN ('alta', 'media', 'baja')),
  priority_value      numeric     NOT NULL,
  decision            text        NOT NULL CHECK (decision IN ('import', 'review', 'discard')),
  -- Desglose del scoring
  factors             jsonb       NOT NULL DEFAULT '{}',
  penalties           jsonb       NOT NULL DEFAULT '[]',
  hard_fails          jsonb       NOT NULL DEFAULT '[]',
  explanation         text        NOT NULL,
  -- Unidad de negocio y versionado del modelo
  business_unit       text        NOT NULL DEFAULT 'general',
  model_version       text        NOT NULL,
  strategy_id         text        NOT NULL,
  icp_config_version  text        NOT NULL,
  confidence_version  text        NOT NULL,
  -- Traza de decisión (reproducibilidad)
  decision_trace      jsonb       NOT NULL DEFAULT '{}',
  source_event_id     uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        REFERENCES auth.users(id)
);

-- Índices
CREATE INDEX IF NOT EXISTS prospeccion_scores_prospect_idx
  ON public.prospeccion_scores (prospect_id, created_at DESC);

CREATE INDEX IF NOT EXISTS prospeccion_scores_decision_idx
  ON public.prospeccion_scores (decision);

CREATE INDEX IF NOT EXISTS prospeccion_scores_score_idx
  ON public.prospeccion_scores (score);

-- RLS
ALTER TABLE public.prospeccion_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scores_select ON public.prospeccion_scores;
CREATE POLICY scores_select ON public.prospeccion_scores
  FOR SELECT TO authenticated
  USING (public.has_permission('prospeccion.view'));

DROP POLICY IF EXISTS scores_insert ON public.prospeccion_scores;
CREATE POLICY scores_insert ON public.prospeccion_scores
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('prospeccion.create'));

-- =========================================================================
-- (C) Vista prospeccion_scores_current
-- Última puntuación vigente por prospecto (DISTINCT ON = última created_at).
-- security_invoker = true: hereda la RLS del llamador (no eleva privilegios).
-- =========================================================================
CREATE OR REPLACE VIEW public.prospeccion_scores_current
  WITH (security_invoker = true) AS
  SELECT DISTINCT ON (prospect_id) *
  FROM public.prospeccion_scores
  ORDER BY prospect_id, created_at DESC;

-- =========================================================================
-- (D) RPC prospeccion_record_qualification
-- Puerta ÚNICA de escritura para enriquecimiento + scoring. Recibe un array
-- jsonb de calificaciones (p_rows). Por cada elemento:
--   1. INSERT en prospeccion_enrichment (perfil de empresa)
--   2. UPDATE prospeccion_prospects: status 'imported' → 'enriquecido'
--   3. INSERT en prospeccion_scores (puntuación)
--   4. UPDATE prospeccion_prospects: status 'enriquecido' → 'scoreado'
-- Procesamiento por-prospecto: si uno falla continúa con los demás (SAVEPOINT).
-- Retorna { persisted: int, errors: int }.
--
-- Estructura esperada de cada elemento de p_rows:
-- {
--   prospect_id:         uuid (obligatorio),
--   company_profile: {
--     industry, industry_normalized, employees_raw, employee_band,
--     country, is_argentina, is_b2b, has_depositos, has_import_export,
--     has_distribucion_nacional, has_cds, terceriza_almacenamiento,
--     dentro_mercado_objetivo, growth_signal, profile_raw, revenue_band
--   },
--   score:               int (0-100),
--   confidence:          int (0-100),
--   priority_tier:       text ('alta'|'media'|'baja'),
--   priority_value:      numeric,
--   decision:            text ('import'|'review'|'discard'),
--   explanation:         text,
--   factors:             jsonb,
--   penalties:           jsonb,
--   hard_fails:          jsonb,
--   decision_trace:      jsonb,
--   business_unit:       text,
--   model_version:       text,
--   strategy_id:         text,
--   icp_config_version:  text,
--   confidence_version:  text,
--   created_by:          uuid (nullable)
-- }
-- =========================================================================
CREATE OR REPLACE FUNCTION public.prospeccion_record_qualification(
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row            jsonb;
  v_prospect_id    uuid;
  v_profile        jsonb;
  v_enrichment_id  uuid;
  v_created_by     uuid;
  v_persisted      int := 0;
  v_errors         int := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_ROWS: p_rows debe ser un array jsonb'
      USING errcode = 'check_violation';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    BEGIN
      -- Extraer campos del elemento
      v_prospect_id := (v_row->>'prospect_id')::uuid;
      v_profile     := COALESCE(v_row->'company_profile', '{}'::jsonb);
      v_created_by  := NULLIF(v_row->>'created_by', '')::uuid;

      -- Verificar que el prospecto exista
      IF NOT EXISTS (
        SELECT 1 FROM public.prospeccion_prospects WHERE id = v_prospect_id
      ) THEN
        RAISE EXCEPTION 'PROSPECT_NOT_FOUND: %', v_prospect_id;
      END IF;

      -- 1. INSERT en prospeccion_enrichment
      INSERT INTO public.prospeccion_enrichment (
        prospect_id,
        evidence_source,
        industry,
        industry_normalized,
        employee_band,
        employees_raw,
        revenue_band,
        country,
        is_argentina,
        is_b2b,
        has_depositos,
        has_import_export,
        has_distribucion_nacional,
        has_cds,
        terceriza_almacenamiento,
        dentro_mercado_objetivo,
        growth_signal,
        profile_raw,
        created_by
      )
      VALUES (
        v_prospect_id,
        COALESCE(v_row->>'evidence_source', 'csv'),
        NULLIF(v_profile->>'industry', ''),
        NULLIF(v_profile->>'industry_normalized', ''),
        NULLIF(v_profile->>'employee_band', ''),
        (NULLIF(v_profile->>'employees_raw', ''))::int,
        NULLIF(v_profile->>'revenue_band', ''),
        NULLIF(v_profile->>'country', ''),
        COALESCE((v_profile->>'is_argentina')::boolean, false),
        (v_profile->>'is_b2b')::boolean,
        COALESCE((v_profile->>'has_depositos')::boolean, false),
        COALESCE((v_profile->>'has_import_export')::boolean, false),
        COALESCE((v_profile->>'has_distribucion_nacional')::boolean, false),
        COALESCE((v_profile->>'has_cds')::boolean, false),
        COALESCE((v_profile->>'terceriza_almacenamiento')::boolean, false),
        COALESCE((v_profile->>'dentro_mercado_objetivo')::boolean, false),
        COALESCE(NULLIF(v_profile->>'growth_signal', ''), 'none'),
        COALESCE(v_profile->'profile_raw', '{}'::jsonb),
        v_created_by
      )
      RETURNING id INTO v_enrichment_id;

      -- 2. Transición de estado: imported → enriquecido (solo si está en imported)
      UPDATE public.prospeccion_prospects
        SET status = 'enriquecido'::public.prospeccion_status_t,
            updated_at = now()
      WHERE id = v_prospect_id
        AND status = 'imported'::public.prospeccion_status_t;

      -- 3. INSERT en prospeccion_scores
      INSERT INTO public.prospeccion_scores (
        prospect_id,
        enrichment_id,
        score,
        confidence,
        priority_tier,
        priority_value,
        decision,
        factors,
        penalties,
        hard_fails,
        explanation,
        business_unit,
        model_version,
        strategy_id,
        icp_config_version,
        confidence_version,
        decision_trace,
        source_event_id,
        created_by
      )
      VALUES (
        v_prospect_id,
        v_enrichment_id,
        (v_row->>'score')::int,
        (v_row->>'confidence')::int,
        v_row->>'priority_tier',
        (v_row->>'priority_value')::numeric,
        v_row->>'decision',
        COALESCE(v_row->'factors',        '{}'::jsonb),
        COALESCE(v_row->'penalties',      '[]'::jsonb),
        COALESCE(v_row->'hard_fails',     '[]'::jsonb),
        COALESCE(v_row->>'explanation',   ''),
        COALESCE(NULLIF(v_row->>'business_unit', ''), 'general'),
        v_row->>'model_version',
        v_row->>'strategy_id',
        v_row->>'icp_config_version',
        v_row->>'confidence_version',
        COALESCE(v_row->'decision_trace', '{}'::jsonb),
        NULLIF(v_row->>'source_event_id', '')::uuid,
        v_created_by
      );

      -- 4. Transición de estado: enriquecido → scoreado
      UPDATE public.prospeccion_prospects
        SET status = 'scoreado'::public.prospeccion_status_t,
            updated_at = now()
      WHERE id = v_prospect_id
        AND status = 'enriquecido'::public.prospeccion_status_t;

      v_persisted := v_persisted + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Continúa con los demás prospectos; registra el error en el contador
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'persisted', v_persisted,
    'errors',    v_errors
  );
END;
$$;

-- Grants
REVOKE ALL ON FUNCTION public.prospeccion_record_qualification(jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospeccion_record_qualification(jsonb)
  TO service_role;

-- ---- Refrescar caché de esquema PostgREST ---------------------------------
NOTIFY pgrst, 'reload schema';
