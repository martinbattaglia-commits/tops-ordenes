"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReconRecord } from "@/lib/recon/types";
import { Icon } from "@/components/Icon";
import { VoiceField } from "@/components/voice/VoiceField";

interface Props {
  recon: ReconRecord;
  poId: string;
  canApprove?: boolean; // solo supervisor o admin pueden aprobar
}

export function ReconActions({ recon, poId, canApprove = false }: Props) {
  const router  = useRouter();
  const [loading, setLoading]     = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [noteOpen, setNoteOpen]   = useState(false);
  const [noteText, setNoteText]   = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectText, setRejectText] = useState("");

  const call = async (path: string, body: object, label: string) => {
    setLoading(label);
    setError(null);
    try {
      const r = await fetch(`/api/compras/conciliar/${poId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok) {
        setError(json.error ?? "Error al procesar la operación");
      } else {
        router.refresh();
      }
    } catch {
      setError("Error de red. Verificá tu conexión e intentá nuevamente.");
    } finally {
      setLoading(null);
    }
  };

  const canAct      = recon.status === "pendiente" || recon.status === "en_revision";
  const canReview   = recon.status === "pendiente";
  const hasPendDiffs = recon.diffs.some(d => d.severity !== "info" && !d.accepted);

  return (
    <div className="nx-surface rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-fg-primary">Acciones</h3>

      {error && (
        <div className="rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/30 p-3 text-xs text-[var(--status-danger)] flex gap-2">
          <Icon name="x" size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {canReview && (
        <button
          disabled={!!loading}
          onClick={() => call("review", { reconId: recon.id }, "review")}
          className="btn btn-ghost btn-sm w-full justify-start gap-2"
        >
          <Icon name="send" size={14} />
          {loading === "review" ? "Enviando…" : "Enviar a revisión"}
        </button>
      )}

      {canAct && canApprove && (
        <button
          disabled={!!loading || hasPendDiffs}
          title={hasPendDiffs ? "Primero aceptá todas las diferencias marcadas" : undefined}
          onClick={() => call("approve", { reconId: recon.id }, "approve")}
          className="btn btn-primary btn-sm w-full justify-start gap-2 disabled:opacity-50"
        >
          <Icon name="check-circle" size={14} />
          {loading === "approve" ? "Aprobando…" : "Aprobar conciliación"}
        </button>
      )}

      {canAct && !canApprove && (
        <div className="rounded-lg bg-[var(--surface-dim)]/50 border border-[var(--stroke-soft)] p-3 text-xs text-fg-muted">
          <Icon name="lock" size={12} className="inline mr-1.5" />
          La aprobación requiere rol <strong>Supervisor</strong> o <strong>Admin</strong>.
        </div>
      )}

      {canAct && (
        <>
          <button
            disabled={!!loading}
            onClick={() => setRejectOpen(v => !v)}
            className="btn btn-danger btn-sm w-full justify-start gap-2"
          >
            <Icon name="x" size={14} />
            Rechazar
          </button>
          {rejectOpen && (
            <div className="space-y-2">
              <VoiceField>
                <textarea
                  rows={3}
                  placeholder="Motivo del rechazo (obligatorio, mínimo 5 caracteres)…"
                  value={rejectText}
                  onChange={e => setRejectText(e.target.value)}
                  className="w-full input text-sm"
                />
              </VoiceField>
              <button
                disabled={!!loading || rejectText.trim().length < 5}
                onClick={async () => {
                  await call("reject", { reconId: recon.id, note: rejectText }, "reject");
                  setRejectOpen(false);
                  setRejectText("");
                }}
                className="btn btn-danger btn-sm w-full disabled:opacity-50"
              >
                {loading === "reject" ? "Rechazando…" : "Confirmar rechazo"}
              </button>
            </div>
          )}
        </>
      )}

      <hr className="border-[var(--stroke-soft)]" />

      <button
        disabled={!!loading}
        onClick={() => setNoteOpen(v => !v)}
        className="btn btn-ghost btn-sm w-full justify-start gap-2 text-fg-secondary"
      >
        <Icon name="mail" size={14} />
        Agregar nota
      </button>
      {noteOpen && (
        <div className="space-y-2">
          <VoiceField>
            <textarea
              rows={2}
              placeholder="Nota…"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              className="w-full input text-sm"
            />
          </VoiceField>
          <button
            disabled={!!loading || !noteText.trim()}
            onClick={async () => {
              await call("note", { reconId: recon.id, note: noteText }, "note");
              setNoteText("");
              setNoteOpen(false);
            }}
            className="btn btn-primary btn-sm w-full disabled:opacity-50"
          >
            {loading === "note" ? "Guardando…" : "Guardar nota"}
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
