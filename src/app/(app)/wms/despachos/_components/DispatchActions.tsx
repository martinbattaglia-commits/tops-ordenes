"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { LogisticsOrderStatus } from "@/lib/pedidos/types";
import type { ShipmentRow } from "@/lib/dispatch/types";
import { confirmDispatchAction, confirmDeliveryAction, revertDispatchAction } from "../actions";

type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

/**
 * Acciones de Despacho + Entrega. Toda mutación va por Server Action; la UI se
 * actualiza por revalidatePath() — sin router.refresh() (criterio anti-503 4A/4B).
 *
 * - Despachar: EGRESO IRREVERSIBLE → confirmación reforzada.
 * - Entregar: marca el despacho como entregado (receptor opcional).
 * - Revertir: reversión compensatoria de un despacho no entregado → confirmación.
 */
export function DispatchActions({
  orderId,
  orderStatus,
  allClosed,
  openUnits,
  shipment,
}: {
  orderId: string;
  orderStatus: LogisticsOrderStatus;
  allClosed: boolean;
  openUnits: number;
  shipment: ShipmentRow | null;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [received, setReceived] = useState("");

  const run = (fn: () => Promise<ActionResult>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    start(async () => {
      setErr(null);
      const res = await fn();
      if (!res.ok) setErr(res.error);
    });
  };

  const canDispatch = orderStatus === "preparado" && allClosed && openUnits === 0 && !shipment;
  const isDispatched = shipment?.status === "despachado";
  const isDelivered = shipment?.status === "entregado";

  return (
    <div className="nx-surface card card-pad flex flex-wrap items-center gap-2">
      {/* Despachar */}
      {canDispatch && (
        <button
          onClick={() =>
            run(
              () => confirmDispatchAction(orderId),
              "EGRESO IRREVERSIBLE: se descontará el stock (lote FEFO) y se registrará el movimiento en el ledger. ¿Confirmás el despacho?"
            )
          }
          disabled={pending}
          className="btn btn-primary btn-sm"
          title="Confirmar despacho (egreso real de stock)"
        >
          <Icon name="truck" size={12} /> Despachar
        </button>
      )}

      {/* Bloqueo por bultos abiertos */}
      {orderStatus === "preparado" && openUnits > 0 && (
        <span className="text-[11px] text-status-warning inline-flex items-center gap-1.5">
          <Icon name="lock" size={11} /> Cerrá o anulá los {openUnits} bulto(s) abierto(s) antes de despachar.
        </span>
      )}

      {/* Entregar */}
      {isDispatched && (
        <>
          <input
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            placeholder="Recibió (opcional)"
            className="input max-w-[180px]"
            disabled={pending}
          />
          <button
            onClick={() =>
              run(() => confirmDeliveryAction(shipment!.id, orderId, received.trim() || null))
            }
            disabled={pending}
            className="btn btn-primary btn-sm"
            title="Marcar como entregado"
          >
            <Icon name="check" size={12} /> Entregar
          </button>
          <button
            onClick={() =>
              run(
                () => revertDispatchAction(shipment!.id, orderId),
                "Revertir el despacho repondrá el stock con un movimiento compensatorio y devolverá el pedido a Preparado. ¿Continuar?"
              )
            }
            disabled={pending}
            className="btn btn-ghost btn-sm text-status-danger"
            title="Revertir el despacho (reingreso compensatorio)"
          >
            <Icon name="refresh" size={12} /> Revertir despacho
          </button>
        </>
      )}

      {/* Entregado (terminal) */}
      {isDelivered && (
        <span className="text-[11px] text-status-success inline-flex items-center gap-1.5">
          <Icon name="check" size={12} /> Pedido entregado.
        </span>
      )}

      {/* Sin acciones disponibles */}
      {!canDispatch && !isDispatched && !isDelivered && orderStatus === "preparado" && openUnits === 0 && !allClosed && (
        <span className="text-[11px] text-fg-muted">No hay bultos cerrados para despachar.</span>
      )}

      {err && <span className="text-[11px] text-status-danger" title={err}>{err}</span>}
    </div>
  );
}
