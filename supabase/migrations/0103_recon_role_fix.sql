-- 0103_recon_role_fix.sql
-- ──────────────────────────────────────────────────────────────────────────
-- FIX CRÍTICO: control de rol del módulo de Conciliación.
--
-- El módulo usaba `auth.jwt() ->> 'role'` para autorizar, pero ese claim
-- contiene el ROL POSTGRES ('authenticated'), nunca el rol de aplicación.
-- Resultado: TODO usuario real era rechazado, tanto en escritura
-- (_recon_assert_role, llamada por los RPCs) como en lectura (políticas RLS).
-- Por eso `po_reconciliations` quedó vacía: nunca se pudo iniciar ni ver una
-- conciliación desde la UI.
--
-- Se reemplaza por `public."current_role"()` (= profiles.role del usuario),
-- el idioma canónico que ya usa el resto del ERP (accounting_*, bank_accounts,
-- attachments, audit_log, cash_box_*, etc.).
-- ──────────────────────────────────────────────────────────────────────────

-- 1) Función de aserción de rol (usada por los RPCs SECURITY DEFINER en escritura)
CREATE OR REPLACE FUNCTION public._recon_assert_role()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (public."current_role"() = ANY (ARRAY['admin','operaciones','supervisor']::user_role_t[])) THEN
    RAISE EXCEPTION 'Sin permisos para operar conciliaciones';
  END IF;
END;
$$;

-- 2) Política RLS de lectura sobre po_reconciliations
ALTER POLICY recon_read ON public.po_reconciliations
  USING (public."current_role"() = ANY (ARRAY['admin','operaciones','supervisor']::user_role_t[]));

-- 3) Política RLS de lectura sobre recon_events (timeline / auditoría)
ALTER POLICY recon_events_read ON public.recon_events
  USING (public."current_role"() = ANY (ARRAY['admin','operaciones','supervisor']::user_role_t[]));

-- 4) Política RLS de lectura sobre po_reconciliation_diffs (vía la conciliación padre)
ALTER POLICY recon_diffs_read ON public.po_reconciliation_diffs
  USING (EXISTS (
    SELECT 1
    FROM public.po_reconciliations r
    WHERE r.id = po_reconciliation_diffs.reconciliation_id
      AND public."current_role"() = ANY (ARRAY['admin','operaciones','supervisor']::user_role_t[])
  ));
