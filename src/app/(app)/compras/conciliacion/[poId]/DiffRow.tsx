// src/app/(app)/compras/conciliacion/[poId]/DiffRow.tsx
"use client";
import { useState } from "react";
import type { ReconDiffRecord } from "@/lib/recon/types";
import { RECON_DIFF_FIELD_LABEL } from "@/lib/recon/types";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/components/Icon";

interface Props {
  diff: ReconDiffRecord;
  onAccept: (diffId: string, note?: string) => Promise<void>;
  canEdit: boolean;
}

const SEVERITY_CLS: Record<string, string> = {
  info:    "border-l-[var(--status-info)]    bg-[var(--status-info)]/5",
  warning: "border-l-[var(--status-warning)] bg-[var(--status-warning)]/5",
  error:   "border-l-[var(--status-danger)]  bg-[var(--status-danger)]/5",
};

const SEVERITY_ICON: Record<string, string> = {
  info: "bell", warning: "bell", error: "x",
};

export function DiffRow({ diff, onAccept, canEdit }: Props) {
  const [loading, setLoading] = useState(false);
  const [note, setNote]       = useState("");
  const [showNote, setShowNote] = useState(false);

  const handleAccept = async () => {
    setLoading(true);
    try {
      await onAccept(diff.id, note || undefined);
      setShowNote(false);
    } finally {
      setLoading(false);
    }
  };

  const label = RECON_DIFF_FIELD_LABEL[diff.field] ?? diff.field;

  return (
    <div className={`border-l-2 rounded-lg px-4 py-3 ${SEVERITY_CLS[diff.severity]} ${diff.accepted ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={SEVERITY_ICON[diff.severity] as IconName} size={14} className={
            diff.severity === "error" ? "text-[var(--status-danger)]"
            : diff.severity === "warning" ? "text-[var(--status-warning)]"
            : "text-[var(--status-info)]"
          } />
          <span className="text-xs font-semibold text-fg-secondary uppercase tracking-wide shrink-0">
            {label}
          </span>
        </div>
        {diff.accepted ? (
          <span className="badge badge-success text-xs shrink-0">Aceptada</span>
        ) : canEdit ? (
          <button
            onClick={() => setShowNote(v => !v)}
            className="btn btn-ghost btn-sm text-xs shrink-0"
          >
            Aceptar diferencia
          </button>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-eyebrow-sm text-fg-muted mb-0.5">Orden de Compra</div>
          <div className="font-medium text-fg-primary">{diff.val_oc || "—"}</div>
        </div>
        <div>
          <div className="text-eyebrow-sm text-fg-muted mb-0.5">Factura Proveedor</div>
          <div className={`font-medium ${diff.val_oc !== diff.val_factura ? "text-[var(--status-danger)]" : "text-fg-primary"}`}>
            {diff.val_factura || "—"}
          </div>
        </div>
      </div>

      {diff.delta_num !== null && diff.delta_num !== undefined && (
        <div className="mt-1 text-xs text-fg-muted">
          Diferencia: <span className={diff.delta_num > 0 ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"}>
            {diff.delta_num > 0 ? "+" : ""}{diff.delta_num.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
          </span>
        </div>
      )}

      {showNote && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder="Nota de aceptación (opcional)…"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="flex-1 input input-sm"
          />
          <button
            onClick={handleAccept}
            disabled={loading}
            className="btn btn-primary btn-sm"
          >
            {loading ? "…" : "Confirmar"}
          </button>
        </div>
      )}

      {diff.accepted && diff.accept_note && (
        <p className="mt-1 text-xs text-fg-muted italic">Nota: {diff.accept_note}</p>
      )}
    </div>
  );
}
