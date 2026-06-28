-- 0105_recon_approve_admin_self_approval.sql
-- ──────────────────────────────────────────────────────────────────────────
-- DECISIÓN DE NEGOCIO (2026-06-28, aprobada por Presidencia):
-- Excepción autorizada al control de doble firma en la aprobación de
-- conciliaciones de OC.
--
-- Regla anterior (0098/0104): el INICIADOR nunca podía aprobar su propia
-- conciliación (doble control para TODOS los roles). En la operación real,
-- un mismo administrador realiza el ciclo completo y quedaba bloqueado con
-- "El iniciador de la conciliación no puede aprobarla (doble control requerido)".
--
-- Regla nueva: el doble control se MANTIENE para 'supervisor'; se EXCEPTÚA
-- únicamente para rol 'admin' (un admin puede aprobar su propia conciliación).
-- 'operaciones' sigue sin poder aprobar (chequeo de rol previo).
--
-- Trazabilidad: toda aprobación queda registrada en recon_events (append-only,
-- con resolved_by = auth.uid()), por lo que la excepción es auditable.
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

  -- Doble control: el iniciador no puede aprobar su propia conciliación,
  -- EXCEPTO rol 'admin' (excepción autorizada — ver cabecera de esta migración).
  IF v_initiated_by = auth.uid() AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'El iniciador de la conciliación no puede aprobarla (doble control requerido). Pedí a un supervisor o administrador distinto que la apruebe.';
  END IF;

  PERFORM _recon_execute_approval(p_recon_id, p_note, auth.uid());
END;
$function$;
