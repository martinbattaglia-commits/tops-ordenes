"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { LogisticsOrderStatus } from "@/lib/pedidos/types";
import { submitOrderAction, allocateOrderAction, cancelOrderAction } from "../actions";

type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export function OrderRowActions({ id, status }: { id: string; status: LogisticsOrderStatus }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: (id: string) => Promise<ActionResult>) =>
    start(async () => {
      setErr(null);
      const res = await fn(id);
      if (!res.ok) setErr(res.error);
      // UI actualizada por revalidatePath('/pedidos') de la action (sin router.refresh → sin 503).
    });

  const canSubmit = status === "borrador";
  const canAllocate = status === "pendiente" || status === "en_preparacion";
  const canCancel = !["despachado", "entregado", "cancelado"].includes(status);

  return (
    <span className="inline-flex items-center gap-1.5">
      {canSubmit && (
        <button onClick={() => run(submitOrderAction)} disabled={pending} className="btn btn-ghost btn-sm" title="Confirmar pedido (pasa a pendiente, listo para reservar)">
          <Icon name="check-circle" size={12} /> Confirmar
        </button>
      )}
      {canAllocate && (
        <button onClick={() => run(allocateOrderAction)} disabled={pending} className="btn btn-primary btn-sm" title="Reservar stock (FEFO)">
          <Icon name="bolt" size={12} /> Reservar
        </button>
      )}
      {canCancel && (
        <button
          onClick={() => { if (confirm("¿Cancelar el pedido y liberar sus reservas?")) run(cancelOrderAction); }}
          disabled={pending}
          className="btn btn-ghost btn-sm"
          title="Cancelar pedido"
        >
          <Icon name="x" size={12} /> Cancelar
        </button>
      )}
      {err && <span className="text-[10px] text-status-danger" title={err}>error</span>}
    </span>
  );
}
