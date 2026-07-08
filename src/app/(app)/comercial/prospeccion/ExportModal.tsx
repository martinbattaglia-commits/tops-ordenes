"use client";

import { useEffect, useRef } from "react";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  approvedCount: number;
  isPending: boolean;
  results?: Array<{ prospect_id: string; ok: boolean; error: string | null }>;
}

export function ExportModal({
  isOpen,
  onClose,
  onConfirm,
  approvedCount,
  isPending,
  results,
}: ExportModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const successCount = results ? results.filter((r) => r.ok).length : 0;
  const errorCount = results ? results.filter((r) => !r.ok).length : 0;
  const errorItems = results ? results.filter((r) => !r.ok) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-xl border border-stroke-soft bg-bg-surface p-6 shadow-lg"
      >
        {results ? (
          /* Post-exportación */
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-status-success/10">
                <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <div>
                <h2 className="text-base font-semibold text-fg-primary">Exportación completa</h2>
                <p className="mt-1 text-sm text-fg-secondary">
                  <span className="font-semibold text-emerald-400">{successCount} exitosos</span>
                  {errorCount > 0 && (
                    <span className="ml-2 font-semibold text-red-400">{errorCount} errores</span>
                  )}
                </p>
              </div>
            </div>

            {errorItems.length > 0 && (
              <div className="rounded-lg bg-tops-red/10 p-3 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-400">Errores</p>
                <ul className="space-y-1 text-xs text-red-400">
                  {errorItems.map((r) => (
                    <li key={r.prospect_id} className="font-mono">
                      {r.prospect_id.slice(0, 8)}… — {r.error ?? "Error desconocido"}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-stroke-soft px-4 py-2 text-sm font-semibold text-fg-secondary hover:bg-bg-surface-alt hover:text-fg-primary transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          /* Confirmación */
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tops-blue-700/10">
                <svg className="h-5 w-5 text-fg-link" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
                </svg>
              </span>
              <div>
                <h2 className="text-base font-semibold text-fg-primary">Exportar a Clientify</h2>
                <p className="mt-1 text-sm text-fg-secondary">
                  ¿Exportar{" "}
                  <span className="font-semibold text-fg-primary">
                    {approvedCount} prospecto{approvedCount !== 1 ? "s" : ""} aprobado{approvedCount !== 1 ? "s" : ""}
                  </span>{" "}
                  a Clientify CRM?
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  Esta acción crea o actualiza contactos en Clientify. Es reversible desde el CRM.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                disabled={isPending}
                className="rounded-lg border border-stroke-soft px-4 py-2 text-sm font-semibold text-fg-secondary hover:bg-bg-surface-alt disabled:opacity-40 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={onConfirm}
                disabled={isPending || approvedCount === 0}
                className="flex items-center gap-2 rounded-lg bg-tops-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tops-blue-900 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                {isPending ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Exportando…
                  </>
                ) : (
                  "Confirmar exportación"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
