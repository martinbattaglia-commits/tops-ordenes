-- =========================================================================
-- 0041_crm_enums.sql — CRM Comercial F2.1 · tipos enum
--
-- ADDITIVE ONLY. Crea los tipos enum del módulo CRM Comercial. Tipos NUEVOS
-- (no agrega valores a enums existentes), por lo que pueden crearse y usarse
-- en migraciones siguientes sin la restricción de "add value en misma tx".
--
-- El módulo `comercial` YA existe en permission_module_t (0009) — no se toca.
-- NO aplicar a Supabase PROD sin autorización (handoff maestro). Rama de feature.
-- =========================================================================

-- Estado del lead espejado de Clientify.
do $$ begin
  create type public.crm_lead_status_t as enum
    ('nuevo', 'contactado', 'calificado', 'descartado', 'promovido');
exception when duplicate_object then null; end $$;

-- Tipo de servicio (alineado a SERVICES del cotizador y a CapacityCategory del
-- motor corporativo: anmat→anmat, general→general, oficinas→oficina).
do $$ begin
  create type public.crm_service_t as enum
    ('anmat', 'general', 'oficinas');
exception when duplicate_object then null; end $$;

-- Etapa del pipeline canónico (8 estados · COMMERCIAL_PIPELINE_DESIGN §2).
do $$ begin
  create type public.crm_stage_t as enum
    ('nuevo_lead', 'contactado', 'calificado', 'visita',
     'propuesta', 'negociacion', 'ganado', 'perdido');
exception when duplicate_object then null; end $$;

-- Estado de compromiso de capacidad (2 capas · F2.1, decisión F-2/F-3):
--   none → reservado (propuesta/negociación) → comprometido (ganado)
--        → ocupado (onboarding completado; sale del committed por la regla
--          anti-doble-conteo — su m² ya vive en la ocupación física del Twin).
do $$ begin
  create type public.crm_committed_state_t as enum
    ('none', 'reservado', 'comprometido', 'ocupado');
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
