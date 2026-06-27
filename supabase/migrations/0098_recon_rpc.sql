-- supabase/migrations/0098_recon_rpc.sql
-- ============================================================
-- RPCs de Conciliación — única vía de escritura (SECURITY DEFINER)
-- ============================================================

-- Función auxiliar: obtener rol del JWT
CREATE OR REPLACE FUNCTION _recon_assert_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF auth.jwt() ->> 'role' NOT IN ('admin','operaciones','supervisor') THEN
    RAISE EXCEPTION 'Sin permisos para operar conciliaciones';
  END IF;
END;
$$;

-- --------------------------------------------------------
-- recon_start: inicia una conciliación (o la reabre si ya existe)
-- p_diffs: array de objetos {field, val_oc, val_factura, delta_num, severity}
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION recon_start(
  p_po_id       uuid,
  p_invoice_id  uuid,
  p_score       smallint,
  p_diffs       jsonb        -- array de diff objects
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_recon_id  uuid;
  v_diff      jsonb;
BEGIN
  PERFORM _recon_assert_role();

  -- Si ya existe, eliminar diffs viejos y actualizar header
  SELECT id INTO v_recon_id
    FROM po_reconciliations
   WHERE purchase_order_id = p_po_id FOR UPDATE;

  IF v_recon_id IS NOT NULL THEN
    -- Sólo se puede re-iniciar si estaba rechazada o pendiente
    IF (SELECT status FROM po_reconciliations WHERE id = v_recon_id) NOT IN ('rechazada','pendiente') THEN
      RAISE EXCEPTION 'La conciliación no puede re-iniciarse en su estado actual';
    END IF;
    DELETE FROM po_reconciliation_diffs WHERE reconciliation_id = v_recon_id;
    UPDATE po_reconciliations SET
      supplier_invoice_id = p_invoice_id,
      status              = 'pendiente',
      score               = p_score,
      initiated_by        = auth.uid(),
      initiated_at        = now(),
      resolved_by         = NULL,
      resolved_at         = NULL,
      resolution_note     = NULL
    WHERE id = v_recon_id;
  ELSE
    INSERT INTO po_reconciliations
      (purchase_order_id, supplier_invoice_id, status, score, initiated_by)
    VALUES
      (p_po_id, p_invoice_id, 'pendiente', p_score, auth.uid())
    RETURNING id INTO v_recon_id;
  END IF;

  -- Insertar diffs
  FOR v_diff IN SELECT * FROM jsonb_array_elements(p_diffs)
  LOOP
    INSERT INTO po_reconciliation_diffs
      (reconciliation_id, field, val_oc, val_factura, delta_num, severity)
    VALUES (
      v_recon_id,
      (v_diff->>'field')::recon_diff_field_t,
      v_diff->>'val_oc',
      v_diff->>'val_factura',
      (v_diff->>'delta_num')::numeric,
      v_diff->>'severity'
    );
  END LOOP;

  -- Evento
  INSERT INTO recon_events (reconciliation_id, user_id, action, to_status, meta)
  VALUES (v_recon_id, auth.uid(), 'iniciar', 'pendiente',
          jsonb_build_object('score', p_score, 'n_diffs', jsonb_array_length(p_diffs)));

  -- Actualizar estado de la OC a 'conciliada' si score=100 y sin diffs error
  IF p_score = 100 AND NOT EXISTS (
    SELECT 1 FROM po_reconciliation_diffs
    WHERE reconciliation_id = v_recon_id AND severity = 'error'
  ) THEN
    PERFORM recon_approve(v_recon_id, 'Aprobación automática — score 100%');
  END IF;

  RETURN v_recon_id;
END;
$$;

-- --------------------------------------------------------
-- recon_approve
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION recon_approve(p_recon_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_status  recon_status_t;
  v_has_diffs   boolean;
  v_new_status  recon_status_t;
  v_po_id       uuid;
BEGIN
  PERFORM _recon_assert_role();

  SELECT status, purchase_order_id INTO v_old_status, v_po_id
    FROM po_reconciliations WHERE id = p_recon_id FOR UPDATE;

  IF v_old_status NOT IN ('pendiente','en_revision') THEN
    RAISE EXCEPTION 'Sólo se puede aprobar desde pendiente o en_revision';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM po_reconciliation_diffs
    WHERE reconciliation_id = p_recon_id
      AND severity IN ('warning','error')
      AND NOT accepted
  ) INTO v_has_diffs;

  IF v_has_diffs THEN
    RAISE EXCEPTION 'Existen diferencias sin aceptar. Aceptar o rechazar antes de aprobar.';
  END IF;

  v_new_status := CASE WHEN EXISTS (
    SELECT 1 FROM po_reconciliation_diffs WHERE reconciliation_id = p_recon_id
  ) THEN 'con_diferencias' ELSE 'conciliada' END;

  UPDATE po_reconciliations SET
    status          = v_new_status,
    resolved_by     = auth.uid(),
    resolved_at     = now(),
    resolution_note = p_note
  WHERE id = p_recon_id;

  -- Actualizar estado de la OC
  UPDATE purchase_orders SET status = 'conciliada', factura_id = (
    SELECT supplier_invoice_id FROM po_reconciliations WHERE id = p_recon_id
  ) WHERE id = v_po_id;

  INSERT INTO recon_events (reconciliation_id, user_id, action, from_status, to_status, note)
  VALUES (p_recon_id, auth.uid(), 'aprobar', v_old_status, v_new_status, p_note);
END;
$$;

-- --------------------------------------------------------
-- recon_reject
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION recon_reject(p_recon_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_status  recon_status_t;
BEGIN
  PERFORM _recon_assert_role();

  SELECT status INTO v_old_status
    FROM po_reconciliations WHERE id = p_recon_id FOR UPDATE;

  IF v_old_status NOT IN ('pendiente','en_revision') THEN
    RAISE EXCEPTION 'Sólo se puede rechazar desde pendiente o en_revision';
  END IF;

  IF p_note IS NULL OR trim(p_note) = '' THEN
    RAISE EXCEPTION 'El rechazo requiere una nota obligatoria';
  END IF;

  UPDATE po_reconciliations SET
    status          = 'rechazada',
    resolved_by     = auth.uid(),
    resolved_at     = now(),
    resolution_note = p_note
  WHERE id = p_recon_id;

  INSERT INTO recon_events (reconciliation_id, user_id, action, from_status, to_status, note)
  VALUES (p_recon_id, auth.uid(), 'rechazar', v_old_status, 'rechazada', p_note);
END;
$$;

-- --------------------------------------------------------
-- recon_accept_diff: acepta una diferencia individual
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION recon_accept_diff(p_diff_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_recon_id  uuid;
BEGIN
  PERFORM _recon_assert_role();

  SELECT reconciliation_id INTO v_recon_id
    FROM po_reconciliation_diffs WHERE id = p_diff_id;

  IF NOT EXISTS (
    SELECT 1 FROM po_reconciliations WHERE id = v_recon_id AND status IN ('pendiente','en_revision')
  ) THEN
    RAISE EXCEPTION 'No se pueden aceptar diferencias en este estado';
  END IF;

  UPDATE po_reconciliation_diffs SET
    accepted    = true,
    accepted_by = auth.uid(),
    accepted_at = now(),
    accept_note = p_note
  WHERE id = p_diff_id;

  INSERT INTO recon_events (reconciliation_id, user_id, action, meta)
  VALUES (v_recon_id, auth.uid(), 'aceptar_dif',
          jsonb_build_object('diff_id', p_diff_id, 'note', p_note));
END;
$$;

-- --------------------------------------------------------
-- recon_add_note
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION recon_add_note(p_recon_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _recon_assert_role();
  IF p_note IS NULL OR trim(p_note) = '' THEN
    RAISE EXCEPTION 'La nota no puede estar vacía';
  END IF;
  INSERT INTO recon_events (reconciliation_id, user_id, action, note)
  VALUES (p_recon_id, auth.uid(), 'nota', p_note);
END;
$$;

-- recon_send_to_review
CREATE OR REPLACE FUNCTION recon_send_to_review(p_recon_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_old recon_status_t; BEGIN
  PERFORM _recon_assert_role();
  SELECT status INTO v_old FROM po_reconciliations WHERE id = p_recon_id FOR UPDATE;
  IF v_old <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo se puede enviar a revisión desde estado pendiente';
  END IF;
  UPDATE po_reconciliations SET status = 'en_revision' WHERE id = p_recon_id;
  INSERT INTO recon_events (reconciliation_id, user_id, action, from_status, to_status, note)
  VALUES (p_recon_id, auth.uid(), 'enviar_revision', 'pendiente', 'en_revision', p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION recon_start TO authenticated;
GRANT EXECUTE ON FUNCTION recon_approve TO authenticated;
GRANT EXECUTE ON FUNCTION recon_reject TO authenticated;
GRANT EXECUTE ON FUNCTION recon_accept_diff TO authenticated;
GRANT EXECUTE ON FUNCTION recon_add_note TO authenticated;
GRANT EXECUTE ON FUNCTION recon_send_to_review TO authenticated;
