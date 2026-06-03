"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { EVIDENCE_KIND_META, type CustodyEvidenceRef } from "@/lib/custody/types";
import { evidenceSignedUrlAction, redactEvidenceAction } from "../actions";

/**
 * Visor seguro de evidencia (GATE 5 · FASE 7). El binario NUNCA se accede directo
 * a Storage: cada vista/descarga pasa por emit_custody_signed_url (auditado, vía
 * Server Action) que devuelve un signed URL de TTL corto. La redacción (erasure de
 * PII) marca la evidencia y deja la fila/cadena intactas.
 */
export function EvidenceViewer({
  evidence,
  allowRedact = false,
  revalidate,
}: {
  evidence: CustodyEvidenceRef;
  allowRedact?: boolean;
  revalidate?: string;
}) {
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const meta = EVIDENCE_KIND_META[evidence.kind];

  const open = () =>
    start(async () => {
      setErr(null);
      const res = await evidenceSignedUrlAction(evidence.evidence_id, "visualizacion");
      if (!res.ok) { setErr(res.error); return; }
      window.open(res.data!.url, "_blank", "noopener,noreferrer");
    });

  const redact = () => {
    if (!window.confirm("Redactar elimina el binario (erasure de PII) y es irreversible. La cadena se preserva. ¿Continuar?")) return;
    start(async () => {
      setErr(null);
      const res = await redactEvidenceAction(evidence.evidence_id, "erasure manual", revalidate);
      if (!res.ok) setErr(res.error);
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] text-fg-secondary">
        <Icon name={meta.icon as "eye"} size={11} /> {meta.label}
      </span>
      {evidence.redacted ? (
        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-surface-alt text-fg-muted" title="PII eliminada">
          Redactada
        </span>
      ) : (
        <button onClick={open} disabled={busy} className="btn btn-ghost btn-sm" title="Ver evidencia (signed URL auditado)">
          <Icon name="eye" size={11} /> Ver
        </button>
      )}
      {allowRedact && !evidence.redacted && (
        <button onClick={redact} disabled={busy} className="btn btn-ghost btn-sm text-status-danger" title="Redactar (erasure de PII)">
          <Icon name="trash" size={11} />
        </button>
      )}
      {evidence.bucket === "custody-pii" && (
        <span className="text-[10px] text-fg-muted" title="PII · acceso restringido">PII</span>
      )}
      {err && <span className="text-[10px] text-status-danger" title={err}>error</span>}
    </span>
  );
}
