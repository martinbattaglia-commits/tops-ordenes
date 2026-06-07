"use client";

/** Anular movimiento (ERP-A4). RPC-First: solo voidMovementAction. */
import { useState, useTransition } from "react";
import { voidMovementAction } from "@/lib/tesoreria/actions";
import type { VoidTarget } from "@/lib/tesoreria/types";

export function AnularButton({ targetType, targetId }: { targetType: VoidTarget; targetId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function confirm() {
    setMsg(null);
    start(async () => {
      const r = await voidMovementAction({ target_type: targetType, target_id: targetId, reason });
      if (r.ok) {
        setOpen(false);
        setReason("");
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
    <div className="flex items-center gap-2">
      <input
        className="input w-48"
        placeholder="Motivo (obligatorio)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button type="button" className="btn btn-primary btn-sm" disabled={pending || !reason.trim()} onClick={confirm}>
        {pending ? "…" : "Confirmar"}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancelar</button>
      {msg && <span className="text-red-600 text-xs">{msg}</span>}
    </div>
  );
}
