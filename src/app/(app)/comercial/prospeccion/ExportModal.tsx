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

  // Cerrar con Escape
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
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl"
      >
        {results ? (
          /* Estado post-exportación */
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Exportación completa</h2>
                <p className="mt-1 text-sm text-gray-500">
                  <span className="text-emerald-700 font-medium">{successCount} exitosos</span>
                  {errorCount > 0 && (
                    <span className="ml-2 text-red-700 font-medium">{errorCount} errores</span>
                  )}
                </p>
              </div>
            </div>

            {errorItems.length > 0 && (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 space-y-1">
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                  Errores
                </p>
                <ul className="space-y-1 text-xs text-red-700">
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
                className="rounded-md bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          /* Estado de confirmación */
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
                </svg>
              </span>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Exportar a Clientify</h2>
                <p className="mt-1 text-sm text-gray-500">
                  ¿Exportar{" "}
                  <span className="font-medium text-gray-700">
                    {approvedCount} prospecto{approvedCount !== 1 ? "s" : ""} aprobado{approvedCount !== 1 ? "s" : ""}
                  </span>{" "}
                  a Clientify CRM?
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Esta acción crea o actualiza contactos en Clientify. Es reversible desde el CRM.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                disabled={isPending}
                className="rounded-md border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={onConfirm}
                disabled={isPending || approvedCount === 0}
                className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
