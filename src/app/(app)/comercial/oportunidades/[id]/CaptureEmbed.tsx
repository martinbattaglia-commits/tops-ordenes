"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { saveCaptureForOpportunity, type SaveResult } from "@/lib/comercial/capture-actions";

/** El artefacto same-origin expone esta función (CB-2). */
interface NexusCaptureWindow extends Window {
  __nexusCapture?: () => unknown;
}

/**
 * CaptureEmbed — embebe un artefacto (cotizador / propuesta) y agrega el botón
 * "Guardar en Nexus" en la barra del HOST. Al click lee window.__nexusCapture()
 * del iframe (same-origin) y persiste vía server action. No toca el artefacto.
 */
export function CaptureEmbed({
  opportunityId,
  slug,
  title,
  onClose,
}: {
  opportunityId: string;
  slug: "cotizador" | "propuesta-anmat" | "propuesta-general";
  title: string;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  async function onSave() {
    setResult(null);
    const win = ref.current?.contentWindow as NexusCaptureWindow | null | undefined;
    const fn = win?.__nexusCapture;
    if (typeof fn !== "function") {
      setResult({ ok: false, message: "El artefacto no expone __nexusCapture() (recargá la herramienta)." });
      return;
    }
    let payload: unknown = null;
    try {
      payload = fn();
    } catch {
      payload = null;
    }
    setBusy(true);
    const res = await saveCaptureForOpportunity(opportunityId, payload);
    setBusy(false);
    setResult(res);
  }

  return (
    <div className="rounded-lg border border-stroke-soft overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stroke-soft bg-bg-surface-alt">
        <span className="text-sm font-semibold text-fg-primary">{title}</span>
        <div className="flex items-center gap-2">
          <button onClick={onSave} disabled={busy} className="btn btn-sm" style={{ background: "#16a34a", color: "#fff", opacity: busy ? 0.6 : 1 }}>
            <Icon name="database" size={13} /> {busy ? "Guardando…" : "Guardar en Nexus"}
          </button>
          {onClose && (
            <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Cerrar">
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      </div>

      {result && (
        <div className="px-3 py-2 text-xs font-semibold flex items-center gap-2"
          style={{ background: result.ok ? "#16a34a0d" : "#dc26260d", color: result.ok ? "#16a34a" : "#dc2626" }}>
          <Icon name={result.ok ? "check-circle" : "x"} size={14} />
          {result.message}{result.publicId ? ` (${result.publicId})` : ""}
        </div>
      )}

      <iframe
        ref={ref}
        src={`/tools/${slug}/index.html`}
        title={title}
        className="w-full bg-bg-page"
        style={{ height: "70vh", border: 0 }}
      />
    </div>
  );
}
