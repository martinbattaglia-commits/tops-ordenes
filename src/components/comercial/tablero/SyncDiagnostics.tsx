"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { SyncStatus, SyncRun } from "@/lib/comercial/dashboard-data";

interface Props {
  syncStatus: SyncStatus | null;
  syncHistory: SyncRun[];
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "completed"
    ? "bg-status-success/10 text-status-success"
    : status === "error"
    ? "bg-status-danger/10 text-status-danger"
    : "bg-status-warning/10 text-status-warning";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export function SyncDiagnostics({ syncStatus, syncHistory }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card card-pad flex flex-col gap-3 border border-fg-muted/10">
      {/* Header colapsable */}
      <button
        className="flex items-center justify-between w-full text-left"
        onClick={() => setOpen((p) => !p)}
      >
        <div className="flex items-center gap-2">
          <Icon name="refresh" size={14} />
          <span className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">
            Diagnóstico del Sincronizador
          </span>
          {syncStatus?.syncVersion && (
            <span className="text-xs text-fg-muted font-mono bg-bg-surface-alt px-1.5 py-0.5 rounded">
              v{syncStatus.syncVersion}
            </span>
          )}
        </div>
        <Icon name="chevron-down" size={14} style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>

      {/* Panel expandido */}
      {open && (
        <div className="flex flex-col gap-4 border-t border-fg-muted/10 pt-3">
          {/* Última sincronización */}
          {syncStatus ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
              <Stat label="Estado" value={<StatusBadge status={syncStatus.status} />} />
              <Stat label="Última ejecución" value={formatDate(syncStatus.finishedAt)} />
              <Stat label="Duración" value={formatDuration(syncStatus.durationMs)} />
              <Stat label="Deals sincronizados" value={syncStatus.dealsSynced} />
              <Stat label="Pipelines" value={syncStatus.pipelines} />
              <Stat label="Errores" value={syncStatus.errors} highlight={syncStatus.errors > 0 ? "error" : null} />
              <Stat label="Lost enriquecidos" value={syncStatus.lostReasonEnriched} note="GET /deals/{id}/ en este run" />
              <Stat label="Lost omitidos" value={syncStatus.lostReasonSkipped} note="ya tenían lost_reason" />
            </div>
          ) : (
            <p className="text-xs text-fg-muted">Sin ejecuciones registradas.</p>
          )}

          {/* Historial de las últimas N ejecuciones */}
          {syncHistory.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-fg-secondary uppercase tracking-wide mb-1">
                Historial (últimas {syncHistory.length} ejecuciones)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-fg-muted text-left">
                      <th className="pb-1 pr-3 font-medium">Fecha</th>
                      <th className="pb-1 pr-3 font-medium">Estado</th>
                      <th className="pb-1 pr-3 font-medium tabular-nums">Deals</th>
                      <th className="pb-1 pr-3 font-medium tabular-nums">Duración</th>
                      <th className="pb-1 pr-3 font-medium tabular-nums">Enriq.</th>
                      <th className="pb-1 pr-3 font-medium tabular-nums">Omitidos</th>
                      <th className="pb-1 pr-3 font-medium">Versión</th>
                      <th className="pb-1 font-medium tabular-nums">Errores</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncHistory.map((run) => (
                      <tr key={run.runId} className="border-t border-fg-muted/5 hover:bg-bg-surface-alt/30">
                        <td className="py-1 pr-3 text-fg-muted whitespace-nowrap">{formatDate(run.finishedAt)}</td>
                        <td className="py-1 pr-3"><StatusBadge status={run.status} /></td>
                        <td className="py-1 pr-3 tabular-nums text-fg-primary">{run.dealsSynced}</td>
                        <td className="py-1 pr-3 tabular-nums text-fg-muted">{formatDuration(run.durationMs)}</td>
                        <td className="py-1 pr-3 tabular-nums text-status-success">{run.lostReasonEnriched || "—"}</td>
                        <td className="py-1 pr-3 tabular-nums text-fg-muted">{run.lostReasonSkipped || "—"}</td>
                        <td className="py-1 pr-3 font-mono text-fg-muted">{run.syncVersion ?? "—"}</td>
                        <td className={`py-1 tabular-nums ${run.errors > 0 ? "text-status-danger" : "text-fg-muted"}`}>
                          {run.errors}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Notas técnicas */}
          <div className="text-xs text-fg-muted leading-relaxed border-t border-fg-muted/10 pt-2 flex flex-col gap-1">
            <p>
              <span className="font-medium text-fg-secondary">Enriquecidos:</span> deals perdidos para los que se
              ejecutó <code className="font-mono bg-bg-surface-alt px-1 rounded">GET /deals/&#123;id&#125;/</code> en
              este run (nuevos o sin <code className="font-mono bg-bg-surface-alt px-1 rounded">lost_reason</code>).
            </p>
            <p>
              <span className="font-medium text-fg-secondary">Omitidos:</span> deals perdidos que ya tenían{" "}
              <code className="font-mono bg-bg-surface-alt px-1 rounded">lost_reason</code> en caché — no se
              re-consultan (optimización incremental).
            </p>
            <p>
              <span className="font-medium text-fg-secondary">Cron:</span> GitHub Actions dispara el sync
              diariamente a las 21:00 ART. También ejecutable manualmente vía{" "}
              <code className="font-mono bg-bg-surface-alt px-1 rounded">POST /api/clientify/sync-deals</code>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  highlight?: "error" | null;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${highlight === "error" ? "text-status-danger" : "text-fg-primary"}`}>
        {value}
      </span>
      {note && <span className="text-xs text-fg-muted/70">{note}</span>}
    </div>
  );
}
