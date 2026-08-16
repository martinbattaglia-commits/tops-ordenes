-- =========================================================================
-- 0250 · CUSTODIA VISIÓN PRODUCTIVA 001 · VOCABULARIO FÍSICO
--
-- PostgreSQL no permite consumir de forma segura un valor nuevo de enum en la
-- misma transacción que ejecuta ALTER TYPE ... ADD VALUE. Por eso este archivo
-- se limita deliberadamente al vocabulario. El núcleo vive en 0250a.
-- =========================================================================

alter type public.custody_stage_t
  add value if not exists 'recepcion' before 'packing';

alter type public.custody_event_type_t
  add value if not exists 'foto_ingreso' before 'foto_packing';

alter type public.custody_event_type_t
  add value if not exists 'foto_egreso' before 'cargado';

notify pgrst, 'reload schema';
