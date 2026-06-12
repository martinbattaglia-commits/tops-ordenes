"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { anularInvoiceAction } from "./actions";

interface Props {
  invoiceId: string;
  nro: string;
}

/**
 * H1 (FISCAL-HARDENING) — anulación por documento rectificativo: emite una
 * Nota de Crédito total vinculada (CbtesAsoc) y marca el original anulado.
 * Nunca edita importes (append-only).
 */
export function AnularInvoiceButton({ invoiceId, nro }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const anular = () => {
    if (
      !window.confirm(
        `¿Anular el comprobante ${nro}?\n\nSe emitirá una Nota de Crédito TOTAL asociada (RG 4540) y el original quedará marcado como anulado. La operación es irreversible.`
      )
    )
      return;
    setError(null);
    start(async () => {
      const r = await anularInvoiceAction(invoiceId);
      if (r.ok) {
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={anular}
        disabled={pending}
        className="btn btn-ghost btn-sm text-status-danger"
        title={`Anular ${nro} emitiendo NC total`}
      >
        <Icon name={pending ? "refresh" : "x"} size={12} />
        {pending ? "Anulando…" : "Anular"}
      </button>
      {error && <span className="text-[11px] text-fg-danger max-w-[220px]">{error}</span>}
    </div>
  );
}
