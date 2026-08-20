"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import type { LogisticsOrderStatus } from "@/lib/pedidos/types";
import type { ShipmentRow } from "@/lib/dispatch/types";
import { createSingleFlightGuard } from "@/lib/custody/single-flight";
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
  custodyStatus,
  custodyAllAllowed,
}: {
  orderId: string;
  orderStatus: LogisticsOrderStatus;
  allClosed: boolean;
  openUnits: number;
  shipment: ShipmentRow | null;
  custodyStatus: "not_applicable" | "unavailable" | "required";
  custodyAllAllowed: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [received, setReceived] = useState("");
  const guard = useMemo(() => createSingleFlightGuard(), []);

  const run = (
    fn: () => Promise<ActionResult>,
    confirmMsg?: string,
    onSuccess?: () => void,
  ) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    void guard.run("dispatch-mutation", async () => {
      setPending(true);
      setErr(null);
      try {
        const res = await fn();
        if (!res.ok) setErr(res.error);
        else onSuccess?.();
      } finally {
        setPending(false);
      }
    });
  };

  const logisticsReady = orderStatus === "preparado" && allClosed && openUnits === 0 && !shipment;
  const custodyReady =
    custodyStatus === "not_applicable" ||
    (custodyStatus === "required" && custodyAllAllowed);
  const canDispatch = logisticsReady && custodyReady;
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

      {logisticsReady && custodyStatus === "unavailable" && (
        <span className="text-[11px] text-status-warning inline-flex items-center gap-1.5">
          <Icon name="lock" size={11} /> Custodia no verificable: despacho bloqueado.
        </span>
      )}

      {logisticsReady && custodyStatus === "required" && !custodyAllAllowed && (
        <span className="text-[11px] text-status-warning inline-flex items-center gap-1.5">
          <Icon name="lock" size={11} /> Resolvé la liberación CINT antes de despachar.
        </span>
      )}

      {/* Entregar */}
      {isDispatched && custodyReady && (
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
              run(
                () => confirmDeliveryAction(shipment!.id, orderId, received.trim() || null),
                undefined,
                () => setReceived(""),
              )
            }
            disabled={pending}
            className="btn btn-primary btn-sm"
            title="Marcar como entregado"
          >
            <Icon name="check" size={12} /> Entregar
          </button>
        </>
      )}

      {isDispatched && !custodyReady && (
        <span className="text-[11px] text-status-warning inline-flex items-center gap-1.5">
          <Icon name="lock" size={11} /> Custodia no liberada o no verificable: entrega bloqueada.
        </span>
      )}

      {isDispatched && (
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
