"use client";

import { Icon } from "@/components/Icon";

/** Imprimir / Guardar como PDF (POD Surface · FASE 8) — print-to-PDF del navegador. */
export function PrintButton({ label = "Imprimir / Guardar PDF" }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="btn btn-primary btn-sm">
      <Icon name="file-pdf" size={12} /> {label}
    </button>
  );
}
