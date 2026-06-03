"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { AllocStatus } from "@/lib/picking/types";
import {
  confirmPickingAction,
  confirmPickingOrderAction,
  unpickAllocationAction,
} from "../actions";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Botón por parada: "Pickear" (reservada → pickeada) / "Deshacer"
 * (pickeada → reservada). La UI se actualiza por revalidatePath() de la Server
 * Action — NO usamos router.refresh() (carrera ?_rsc → 503).
 */
export function PickStopButton({
  allocationId,
  orderId,
  status,
}: {
  allocationId: string;
  orderId: string;
  status: AllocStatus;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setErr(null);
      const res = await fn();
      if (!res.ok) setErr(res.error);
    });

  if (status === "reservada") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          onClick={() => run(() => confirmPickingAction(allocationId, orderId))}
          disabled={pending}
          className="btn btn-primary btn-sm"
          title="Confirmar picking de esta parada"
        >
          <Icon name="check" size={12} /> Pickear
        </button>
        {err && <span className="text-[10px] text-status-danger" title={err}>error</span>}
      </span>
    );
  }

  if (status === "pickeada") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          onClick={() => run(() => unpickAllocationAction(allocationId, orderId))}
          disabled={pending}
          className="btn btn-ghost btn-sm"
          title="Deshacer picking de esta parada"
        >
          <Icon name="refresh" size={12} /> Deshacer
        </button>
        {err && <span className="text-[10px] text-status-danger" title={err}>error</span>}
      </span>
    );
  }

  return null;
}

/**
 * Botón de cabecera: pickea todas las paradas pendientes del pedido. Solo se
 * muestra si hay paradas 'reservada'. Sin router.refresh().
 */
export function PickOrderButton({ orderId, pending }: { orderId: string; pending: number }) {
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (pending <= 0) return null;

  const run = () =>
    start(async () => {
      setErr(null);
      const res = await confirmPickingOrderAction(orderId);
      if (!res.ok) setErr(res.error);
    });

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={run}
        disabled={busy}
        className="btn btn-primary btn-sm"
        title="Pickear todas las paradas pendientes del pedido"
      >
        <Icon name="forklift" size={12} /> Pickear todo
      </button>
      {err && <span className="text-[11px] text-status-danger" title={err}>{err}</span>}
    </span>
  );
}
