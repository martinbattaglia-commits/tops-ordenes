"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { podPdfSignedUrlAction, regeneratePodPdfAction } from "../actions";

/**
 * Descarga del POD-PDF server-side (GATE 5.3 · B4). El binario vive en custody-pod
 * y se descarga SIEMPRE por emit_custody_signed_url (auditado · TTL corto). Si el
 * PDF aún no existe (POD viejo), permite generarlo. No usa window.print().
 */
export function PodDownloadButton({
  shipmentId,
  hasPdf,
  revalidate,
}: {
  shipmentId: string;
  hasPdf: boolean;
  revalidate?: string;
}) {
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const download = () =>
    start(async () => {
      setErr(null);
      const res = await podPdfSignedUrlAction(shipmentId);
      if (!res.ok) { setErr(res.error); return; }
      window.open(res.data!.url, "_blank", "noopener,noreferrer");
    });

  const generate = () =>
    start(async () => {
      setErr(null);
      const res = await regeneratePodPdfAction(shipmentId, revalidate);
      if (!res.ok) setErr(res.error);
    });

  return (
    <span className="inline-flex items-center gap-2">
      {hasPdf ? (
        <button onClick={download} disabled={busy} className="btn btn-primary btn-sm" title="Descargar POD-PDF (signed URL auditado)">
          <Icon name="download" size={12} /> Descargar PDF
        </button>
      ) : (
        <button onClick={generate} disabled={busy} className="btn btn-primary btn-sm" title="Generar el POD-PDF server-side">
          <Icon name="file-pdf" size={12} /> {busy ? "Generando…" : "Generar PDF"}
        </button>
      )}
      {hasPdf && (
        <button onClick={generate} disabled={busy} className="btn btn-ghost btn-sm" title="Regenerar el POD-PDF">
          <Icon name="refresh" size={11} />
        </button>
      )}
      {err && <span className="text-[10px] text-status-danger" title={err}>{err}</span>}
    </span>
  );
}
