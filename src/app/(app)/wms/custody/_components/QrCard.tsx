"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Tarjeta de QR (GATE 5 · FASE 3). El QR (data URL) se genera SERVER-SIDE con la
 * lib `qrcode` (sin enviar el token a terceros) y se pasa como prop. Codifica
 * `/c/{token}`; al escanearlo, get_custody_by_token resuelve la entidad sin exponer
 * IDs internos ni PII. Imprimible (etiqueta de bulto / remito).
 */
export function QrCard({
  dataUrl,
  url,
  publicId,
  label,
}: {
  dataUrl: string;
  url: string;
  publicId: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard no disponible */
    }
  };

  return (
    <div className="nx-surface card card-pad flex flex-col items-center gap-2 text-center">
      <div className="text-[10px] font-bold uppercase tracking-wide text-fg-muted inline-flex items-center gap-1">
        <Icon name="qr" size={12} /> {label ?? "QR de custodia"}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL local generado server-side, no optimizable por next/image */}
      <img src={dataUrl} alt={`QR ${publicId}`} width={160} height={160} className="rounded bg-white p-1" />
      <div className="font-mono text-xs font-semibold">{publicId}</div>
      <div className="flex items-center gap-1.5">
        <button onClick={copy} className="btn btn-ghost btn-sm" title={url}>
          <Icon name="copy" size={11} /> {copied ? "Copiado" : "Copiar link"}
        </button>
        <button onClick={() => window.print()} className="btn btn-ghost btn-sm" title="Imprimir etiqueta">
          <Icon name="export" size={11} /> Imprimir
        </button>
      </div>
    </div>
  );
}
