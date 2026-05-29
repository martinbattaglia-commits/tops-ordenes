"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { emitFromClientOrdersAction } from "./actions";

interface Props {
  clientId: string;
  razon: string;
}

export function EmitInvoiceButton({ clientId, razon }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const emit = () => {
    setError(null);
    start(async () => {
      const r = await emitFromClientOrdersAction(clientId);
      if (r.ok) {
        // Abrir el PDF fiscal autorizado en una pestaña nueva.
        window.open(`/api/invoices/${r.invoice.id}/pdf`, "_blank");
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
        onClick={emit}
        disabled={pending}
        className="btn btn-primary btn-sm"
        title={`Emitir Factura A a ${razon}`}
      >
        <Icon name={pending ? "refresh" : "bill"} size={12} />
        {pending ? "Emitiendo…" : "Emitir Factura A"}
      </button>
      {error && <span className="text-[11px] text-fg-danger max-w-[220px]">{error}</span>}
    </div>
  );
}
