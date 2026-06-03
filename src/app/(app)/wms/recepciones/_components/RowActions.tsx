"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReceptionStatus } from "@/lib/wms/types";
import {
  confirmReceptionAction,
  releaseQuarantineAction,
  cancelReceptionAction,
} from "../actions";

type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export function RowActions({ id, status }: { id: string; status: ReceptionStatus }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const run = (fn: (id: string) => Promise<ActionResult>) =>
    start(async () => {
      setErr(null);
      const r = await fn(id);
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });

  const confirmable = status === "pendiente" || status === "en_recepcion";

  return (
    <div className="flex items-center gap-1.5 justify-end">
      {confirmable && (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(confirmReceptionAction)}
            className="btn btn-primary btn-sm disabled:opacity-50"
          >
            Confirmar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(cancelReceptionAction)}
            className="btn btn-ghost btn-sm disabled:opacity-50"
          >
            Anular
          </button>
        </>
      )}
      {status === "cuarentena" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(releaseQuarantineAction)}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          Liberar cuarentena
        </button>
      )}
      {err && <span className="text-[10px] text-status-danger max-w-[180px] truncate" title={err}>{err}</span>}
    </div>
  );
}
