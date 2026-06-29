"use client";

interface BulkActionsBarProps {
  selectedIds: string[];
  totalGreen: number;
  onApproveAll: () => void;
  onApproveSelected: () => void;
  onRejectSelected: () => void;
  onExportApproved: () => void;
  onExportAll: () => void;
  isPending: boolean;
}

export function BulkActionsBar({
  selectedIds,
  totalGreen,
  onApproveAll,
  onApproveSelected,
  onRejectSelected,
  onExportApproved,
  onExportAll,
  isPending,
}: BulkActionsBarProps) {
  const hasSelection = selectedIds.length > 0;

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 card px-4 py-3">
      {/* Aprobar todos los verdes */}
      <button
        onClick={onApproveAll}
        disabled={isPending || totalGreen === 0}
        className="flex items-center gap-1.5 rounded-lg bg-status-success px-3 py-1.5 text-xs font-semibold text-white hover:bg-status-success/90 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Aprobar todos los 🟢 ({totalGreen})
      </button>

      {/* Aprobar selección */}
      <button
        onClick={onApproveSelected}
        disabled={isPending || !hasSelection}
        className="flex items-center gap-1.5 rounded-lg bg-status-success/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-status-success/20 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Aprobar selección ({selectedIds.length})
      </button>

      {/* Descartar selección */}
      <button
        onClick={onRejectSelected}
        disabled={isPending || !hasSelection}
        className="flex items-center gap-1.5 rounded-lg bg-tops-red/10 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-tops-red/20 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Descartar selección
      </button>

      {/* Separador */}
      <div className="h-5 w-px bg-stroke-soft" />

      {/* Exportar aprobados */}
      <button
        onClick={onExportApproved}
        disabled={isPending}
        className="flex items-center gap-1.5 rounded-lg bg-tops-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-tops-blue-900 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
      >
        {isPending ? (
          <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
          </svg>
        )}
        Exportar aprobados a Clientify
      </button>

      {/* Exportar todo */}
      <button
        onClick={onExportAll}
        disabled={isPending}
        className="flex items-center gap-1.5 rounded-lg border border-stroke-soft px-3 py-1.5 text-xs font-semibold text-fg-secondary hover:bg-bg-surface-alt hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        Exportar todo
      </button>
    </div>
  );
}
