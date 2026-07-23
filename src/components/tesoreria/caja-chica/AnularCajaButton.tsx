"use client";

/**
 * Anular un movimiento de Caja Chica (CCN-001B · F3). RPC-First: sólo
 * anularCajaMovimientoAction. El motivo es OBLIGATORIO (lo exige la RPC y el
 * trigger de auditoría del motor). La baja es lógica: nunca se borra.
 *
 * Espeja la UX de AnularButton de Tesorería (mismo patrón, permiso propio).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anularCajaMovimientoAction } from "@/lib/tesoreria/caja-chica/actions";

export function AnularCajaButton({ movementId }: { movementId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function confirm() {
    setMsg(null);
    start(async () => {
      const r = await anularCajaMovimientoAction({ movement_id: movementId, reason });
      if (r.ok) {
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        setMsg(r.message);
      }
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        Anular
      </button>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2 flex-wrap">
      <input
        className="input w-48"
        placeholder="Motivo (obligatorio)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={pending || !reason.trim()}
        onClick={confirm}
      >
        {pending ? "…" : "Confirmar"}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
        Cancelar
      </button>
      {msg && <span className="text-red-600 text-xs">{msg}</span>}
    </div>
  );
}
