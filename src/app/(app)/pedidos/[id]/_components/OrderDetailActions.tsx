"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { LogisticsOrderStatus } from "@/lib/pedidos/types";
import {
  submitOrderAction,
  allocateOrderAction,
  cancelOrderAction,
  releaseAllocationAction,
} from "../../actions";

type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export function OrderDetailActions({ id, status }: { id: string; status: LogisticsOrderStatus }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setErr(null);
      const res = await fn();
      if (!res.ok) setErr(res.error);
      // La UI se actualiza por revalidatePath() de la Server Action. No usamos
      // router.refresh(): su GET ?_rsc corría en carrera con la revalidación y daba 503.
    });

  const canSubmit = status === "borrador";
  const canAllocate = status === "pendiente" || status === "en_preparacion";
  const canCancel = !["despachado", "entregado", "cancelado"].includes(status);

  return (
    <div className="flex items-center gap-2">
      {canSubmit && (
        <button onClick={() => run(() => submitOrderAction(id))} disabled={pending} className="btn btn-ghost btn-sm">
          <Icon name="check-circle" size={12} /> Confirmar pedido
        </button>
      )}
      {canAllocate && (
        <button onClick={() => run(() => allocateOrderAction(id))} disabled={pending} className="btn btn-primary btn-sm">
          <Icon name="bolt" size={12} /> Reservar stock
        </button>
      )}
      {canCancel && (
        <button
          onClick={() => { if (confirm("¿Cancelar el pedido y liberar sus reservas?")) run(() => cancelOrderAction(id)); }}
          disabled={pending}
          className="btn btn-ghost btn-sm"
        >
          <Icon name="x" size={12} /> Cancelar
        </button>
      )}
      {err && <span className="text-[11px] text-status-danger" title={err}>{err}</span>}
    </div>
  );
}

export function ReleaseAllocationButton({ allocationId, orderId }: { allocationId: string; orderId: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const release = () =>
    start(async () => {
      setErr(null);
      const res = await releaseAllocationAction(allocationId, orderId);
      if (!res.ok) setErr(res.error);
      // UI actualizada por revalidatePath() de la action (sin router.refresh → sin 503).
    });

  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={release} disabled={pending} className="btn btn-ghost btn-sm" title="Liberar reserva">
        <Icon name="refresh" size={12} /> Liberar
      </button>
      {err && <span className="text-[10px] text-status-danger" title={err}>error</span>}
    </span>
  );
}
