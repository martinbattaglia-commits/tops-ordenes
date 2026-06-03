"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { confirmPackingOrderAction } from "../actions";

/**
 * Botón "Empacar todo" para la fila de la cola. La UI se actualiza por
 * revalidatePath() de la Server Action — sin router.refresh() (carrera 503).
 * D2: el caller solo lo renderiza cuando NO hay bultos abiertos (open_units===0).
 */
export function PackOrderButton({ orderId, pending }: { orderId: string; pending: number }) {
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (pending <= 0) return null;

  const run = () =>
    start(async () => {
      setErr(null);
      const res = await confirmPackingOrderAction(orderId);
      if (!res.ok) setErr(res.error);
    });

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={run}
        disabled={busy}
        className="btn btn-primary btn-sm"
        title="Crear un bulto, empacar todo lo pickeado y cerrarlo"
      >
        <Icon name="package" size={12} /> Empacar todo
      </button>
      {err && <span className="text-[11px] text-status-danger" title={err}>{err}</span>}
    </span>
  );
}
