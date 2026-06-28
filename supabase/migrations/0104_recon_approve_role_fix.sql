-- 0104_recon_approve_role_fix.sql
-- ──────────────────────────────────────────────────────────────────────────
-- FIX CRÍTICO (continuación de 0103): recon_approve tenía un control de rol
-- INLINE adicional que seguía usando auth.jwt() ->> 'role' (rol Postgres
-- 'authenticated', no el rol de aplicación). Por eso la aprobación fallaba
-- para CUALQUIER usuario — incluso admin/supervisor — con
-- "Solo un supervisor o administrador puede aprobar conciliaciones",
-- antes siquiera de llegar al control de doble firma (self-approval).
--
-- Se reemplaza por public."current_role"() (profiles.role). Se preserva
-- intacto el control de doble firma (el iniciador no puede aprobar).
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recon_approve(p_recon_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_initiated_by  uuid;
  v_role          text;
BEGIN
  PERFORM _recon_assert_role();

  v_role := public."current_role"()::text;

  IF v_role NOT IN ('supervisor','admin') THEN
    RAISE EXCEPTION 'Solo un supervisor o administrador puede aprobar conciliaciones';
  END IF;

  SELECT initiated_by INTO v_initiated_by
    FROM po_reconciliations WHERE id = p_recon_id;

  IF v_initiated_by = auth.uid() THEN
    RAISE EXCEPTION 'El iniciador de la conciliación no puede aprobarla (doble control requerido)';
  END IF;

  PERFORM _recon_execute_approval(p_recon_id, p_note, auth.uid());
END;
$function$;
