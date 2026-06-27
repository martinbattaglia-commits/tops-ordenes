"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReconRecord } from "@/lib/recon/types";
import { Icon } from "@/components/Icon";

export function ReconActions({ recon, poId }: { recon: ReconRecord; poId: string }) {
  const router  = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectText, setRejectText] = useState("");

  const call = async (path: string, body: object) => {
    const r = await fetch(`/api/compras/conciliar/${poId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const { error } = await r.json();
      alert(error ?? "Error al procesar");
    } else {
      router.refresh();
    }
  };

  const canApprove   = recon.status === "pendiente" || recon.status === "en_revision";
  const canReject    = recon.status === "pendiente" || recon.status === "en_revision";
  const canReview    = recon.status === "pendiente";
  const hasPendDiffs = recon.diffs.some(d => d.severity !== "info" && !d.accepted);

  return (
    <div className="nx-surface rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-fg-primary">Acciones</h3>

      {canReview && (
        <button
          disabled={!!loading}
          onClick={async () => {
            setLoading("review");
            await call("review", { reconId: recon.id });
            setLoading(null);
          }}
          className="btn btn-ghost btn-sm w-full justify-start gap-2"
        >
          <Icon name="send" size={14} />
          Enviar a revisión
        </button>
      )}

      {canApprove && (
        <button
          disabled={!!loading || hasPendDiffs}
          title={hasPendDiffs ? "Primero aceptá todas las diferencias marcadas" : undefined}
          onClick={async () => {
            setLoading("approve");
            await call("approve", { reconId: recon.id });
            setLoading(null);
          }}
          className="btn btn-primary btn-sm w-full justify-start gap-2 disabled:opacity-50"
        >
          <Icon name="check-circle" size={14} />
          Aprobar conciliación
        </button>
      )}

      {canReject && (
        <>
          <button
            onClick={() => setRejectOpen(v => !v)}
            className="btn btn-danger btn-sm w-full justify-start gap-2"
          >
            <Icon name="x" size={14} />
            Rechazar
          </button>
          {rejectOpen && (
            <div className="space-y-2">
              <textarea
                rows={3}
                placeholder="Motivo del rechazo (obligatorio)…"
                value={rejectText}
                onChange={e => setRejectText(e.target.value)}
                className="w-full input text-sm"
              />
              <button
                disabled={rejectText.trim().length < 5}
                onClick={async () => {
                  setLoading("reject");
                  await call("reject", { reconId: recon.id, note: rejectText });
                  setLoading(null);
                  setRejectOpen(false);
                }}
                className="btn btn-danger btn-sm w-full disabled:opacity-50"
              >
                Confirmar rechazo
              </button>
            </div>
          )}
        </>
      )}

      <hr className="border-[var(--stroke-soft)]" />

      <button
        onClick={() => setNoteOpen(v => !v)}
        className="btn btn-ghost btn-sm w-full justify-start gap-2 text-fg-secondary"
      >
        <Icon name="mail" size={14} />
        Agregar nota
      </button>
      {noteOpen && (
        <div className="space-y-2">
          <textarea
            rows={2}
            placeholder="Nota…"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            className="w-full input text-sm"
          />
          <button
            disabled={!noteText.trim()}
            onClick={async () => {
              setLoading("note");
              await call("note", { reconId: recon.id, note: noteText });
              setNoteText("");
              setNoteOpen(false);
              setLoading(null);
            }}
            className="btn btn-primary btn-sm w-full disabled:opacity-50"
          >
            Guardar nota
          </button>
        </div>
      )}

      {(recon.status === "conciliada" || recon.status === "con_diferencias") && (
        <div className="rounded-lg bg-[var(--status-success)]/10 border border-[var(--status-success)]/30 p-3 text-xs text-[var(--status-success)] flex gap-2">
          <Icon name="check-circle" size={14} className="shrink-0 mt-0.5" />
          <span>Esta factura está habilitada para pago en Tesorería.</span>
        </div>
      )}

      {recon.status === "rechazada" && (
        <div className="rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/30 p-3 text-xs text-[var(--status-danger)] flex gap-2">
          <Icon name="x" size={14} className="shrink-0 mt-0.5" />
          <span>Factura BLOQUEADA para pago. Se requiere nota de crédito o nueva factura.</span>
        </div>
      )}
    </div>
  );
}
