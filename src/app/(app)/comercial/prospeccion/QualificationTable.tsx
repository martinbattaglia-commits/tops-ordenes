"use client";

import { useState } from "react";
import type { ProspectWithScore } from "@/lib/prospeccion/read/qualification-data";
import { ScoreBadge } from "./ScoreBadge";
import { DecisionBadge } from "./DecisionBadge";

const STATUS_LABEL: Record<string, string> = {
  raw:            "Capturado",
  imported:       "Importado",
  enriquecido:    "Enriquecido",
  scoreado:       "Calificado",
  con_ia:         "En revisión",
  aprobado:       "Aprobado",
  sincronizado:   "Sincronizado",
  cliente_creado: "Cliente",
  rechazado:      "Rechazado",
  duplicado:      "Duplicado",
};

// Estado = posición en el flujo: neutro en tránsito, color solo en estados
// terminales/notables → reduce la carga cromática por fila (Score y Clasificación
// quedan como los elementos con color). Distinto de DecisionBadge por forma
// (rectángulo vs pill) y por la ausencia de punto.
const STATUS_STYLE: Record<string, string> = {
  raw:            "bg-bg-surface-alt text-fg-secondary",
  imported:       "bg-bg-surface-alt text-fg-secondary",
  enriquecido:    "bg-bg-surface-alt text-fg-secondary",
  scoreado:       "bg-bg-surface-alt text-fg-secondary",
  con_ia:         "bg-bg-surface-alt text-fg-secondary",
  aprobado:       "bg-status-success/10 text-emerald-400",
  sincronizado:   "bg-tops-blue-700/10 text-fg-link",
  cliente_creado: "bg-status-success/10 text-emerald-400",
  rechazado:      "bg-tops-red/10 text-red-400",
  duplicado:      "bg-bg-surface-alt text-fg-secondary",
};

function StatusChip({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? "bg-bg-surface-alt text-fg-secondary";
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

interface QualificationTableProps {
  items: ProspectWithScore[];
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onExport: (id: string) => void;
  onSelectionChange: (ids: string[]) => void;
  isPending: boolean;
}

function truncate(str: string | null, max: number): string {
  if (!str) return "—";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

export function QualificationTable({
  items,
  onApprove,
  onReject,
  onExport,
  onSelectionChange,
  isPending,
}: QualificationTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(Array.from(next));
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
      onSelectionChange([]);
    } else {
      const all = new Set(items.map((i) => i.id));
      setSelectedIds(all);
      onSelectionChange(Array.from(all));
    }
  }

  function handleRejectConfirm(id: string) {
    onReject(id, rejectReason);
    setRejectingId(null);
    setRejectReason("");
  }

  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < items.length;

  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full divide-y divide-stroke-soft text-sm">
        <thead className="bg-bg-surface text-left">
          <tr>
            <th className="w-8 px-3 py-2.5">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 cursor-pointer rounded accent-tops-blue-700"
              />
            </th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">ID</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">Empresa</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">Contacto</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">Cargo</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">Industria</th>
            <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-fg-muted">Score</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">Clasificación IA</th>
            <th className="max-w-[200px] px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">Justificación</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">Estado</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-widest text-fg-muted">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stroke-soft">
          {items.length === 0 ? (
            <tr>
              <td colSpan={11} className="px-4 py-10 text-center text-fg-muted">
                Sin prospectos para mostrar. Importá un CSV para comenzar.
              </td>
            </tr>
          ) : (
            items.map((p) => (
              <>
                <tr
                  key={p.id}
                  className={`transition-colors duration-150 ${
                    selectedIds.has(p.id)
                      ? "bg-tops-blue-700/10"
                      : "bg-bg-surface hover:bg-bg-surface-alt"
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="h-3.5 w-3.5 cursor-pointer rounded accent-tops-blue-700"
                    />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-fg-muted">
                    {p.shortId ?? p.id.slice(0, 8)}
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-2.5 font-semibold text-fg-primary">
                    {p.companyName ?? "—"}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2.5 text-fg-secondary">
                    {p.fullName ?? "—"}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2.5 text-fg-muted">
                    {p.cargo ?? "—"}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2.5 text-fg-muted">
                    {p.industryNormalized ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {p.score !== null ? (
                      <ScoreBadge score={p.score} />
                    ) : (
                      <span className="text-xs text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {p.decision ? (
                      <DecisionBadge decision={p.decision} />
                    ) : (
                      <span className="text-xs text-fg-muted">Sin calificar</span>
                    )}
                  </td>
                  <td className="max-w-[200px] px-3 py-2.5">
                    {p.explanation ? (
                      <span
                        title={p.explanation}
                        className="block cursor-help truncate text-xs text-fg-muted"
                      >
                        {truncate(p.explanation, 60)}
                      </span>
                    ) : (
                      <span className="text-xs text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusChip status={p.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-0.5">
                      {/* Ver detalle */}
                      <button
                        onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                        title="Ver detalle"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-surface-alt hover:text-fg-secondary transition-colors"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>

                      {/* Aprobar */}
                      {(p.status === "scoreado" || p.status === "imported" || p.status === "raw") && (
                        <button
                          onClick={() => onApprove(p.id)}
                          disabled={isPending}
                          title="Aprobar"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-40 transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                      )}

                      {/* Rechazar */}
                      {p.status !== "rechazado" && p.status !== "aprobado" && p.status !== "sincronizado" && (
                        <button
                          onClick={() => {
                            setRejectingId(p.id);
                            setRejectReason("");
                          }}
                          disabled={isPending}
                          title="Rechazar"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}

                      {/* Enviar a Clientify */}
                      {p.status === "aprobado" && (
                        <button
                          onClick={() => onExport(p.id)}
                          disabled={isPending}
                          title="Enviar a Clientify"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-tops-blue-700/10 hover:text-fg-link disabled:opacity-40 transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Detalle expandido */}
                {expandedId === p.id && (
                  <tr key={`${p.id}-detail`} className="bg-bg-surface-alt">
                    <td colSpan={11} className="px-5 py-4">
                      <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3 lg:grid-cols-4">
                        <div>
                          <p className="font-semibold text-fg-muted">Email</p>
                          <p className="mt-0.5 text-fg-secondary">{p.email ?? "—"}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-fg-muted">CUIT</p>
                          <p className="mt-0.5 font-mono text-fg-secondary">{p.cuit ?? "—"}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-fg-muted">Sitio web</p>
                          {p.website ? (
                            <a href={p.website} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-fg-link hover:underline">
                              {p.website}
                            </a>
                          ) : (
                            <p className="mt-0.5 text-fg-secondary">—</p>
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-fg-muted">LinkedIn</p>
                          {p.linkedinUrl ? (
                            <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-fg-link hover:underline">
                              Ver perfil
                            </a>
                          ) : (
                            <p className="mt-0.5 text-fg-secondary">—</p>
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-fg-muted">Confianza</p>
                          <p className="mt-0.5 text-fg-secondary">{p.confidence !== null ? `${p.confidence}%` : "—"}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-fg-muted">Prioridad</p>
                          <p className="mt-0.5 text-fg-secondary">{p.priorityTier ?? "—"}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-fg-muted">Banda de empleados</p>
                          <p className="mt-0.5 text-fg-secondary">{p.employeeBand ?? "—"}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-fg-muted">Argentina</p>
                          <p className="mt-0.5 text-fg-secondary">
                            {p.isArgentina === null ? "—" : p.isArgentina ? "Sí" : "No"}
                          </p>
                        </div>
                        {p.explanation && (
                          <div className="col-span-full">
                            <p className="font-semibold text-fg-muted">Justificación IA</p>
                            <p className="mt-0.5 text-fg-secondary">{p.explanation}</p>
                          </div>
                        )}
                        {p.rejectionReason && (
                          <div className="col-span-full">
                            <p className="font-semibold text-red-400">Motivo de rechazo</p>
                            <p className="mt-0.5 text-fg-secondary">{p.rejectionReason}</p>
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-fg-muted">Creado</p>
                          <p className="mt-0.5 text-fg-secondary">{p.createdAt.slice(0, 10)}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Inline reject form */}
                {rejectingId === p.id && (
                  <tr key={`${p.id}-reject`} className="bg-tops-red/10">
                    <td colSpan={11} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          placeholder="Motivo del rechazo (opcional)"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          className="flex-1 rounded-lg border border-tops-red/30 bg-bg-surface px-3 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-tops-red/30"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRejectConfirm(p.id);
                            if (e.key === "Escape") setRejectingId(null);
                          }}
                        />
                        <button
                          onClick={() => handleRejectConfirm(p.id)}
                          disabled={isPending}
                          className="rounded-lg bg-tops-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-tops-red/90 disabled:opacity-40 transition-colors"
                        >
                          Confirmar rechazo
                        </button>
                        <button
                          onClick={() => setRejectingId(null)}
                          className="rounded-lg border border-stroke-soft px-3 py-1.5 text-xs font-semibold text-fg-secondary hover:bg-bg-surface-alt transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
