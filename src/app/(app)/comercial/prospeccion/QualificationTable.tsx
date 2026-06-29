"use client";

import { useState } from "react";
import type { ProspectWithScore } from "@/lib/prospeccion/read/qualification-data";
import { ScoreBadge } from "./ScoreBadge";
import { DecisionBadge } from "./DecisionBadge";

const STATUS_LABEL: Record<string, string> = {
  raw: "Capturado",
  imported: "Importado",
  enriquecido: "Enriquecido",
  scoreado: "Calificado",
  con_ia: "En revisión",
  aprobado: "Aprobado",
  sincronizado: "Sincronizado",
  cliente_creado: "Cliente",
  rechazado: "Rechazado",
  duplicado: "Duplicado",
};

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
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 cursor-pointer"
              />
            </th>
            <th className="px-3 py-2">ID</th>
            <th className="px-3 py-2">Empresa</th>
            <th className="px-3 py-2">Contacto</th>
            <th className="px-3 py-2">Cargo</th>
            <th className="px-3 py-2">Industria</th>
            <th className="px-3 py-2 text-center">Score</th>
            <th className="px-3 py-2">Clasificación</th>
            <th className="px-3 py-2 max-w-[200px]">Motivo</th>
            <th className="px-3 py-2">Estado</th>
            <th className="px-3 py-2 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {items.length === 0 ? (
            <tr>
              <td colSpan={11} className="px-4 py-8 text-center text-gray-400">
                Sin prospectos para mostrar. Importá un CSV para comenzar.
              </td>
            </tr>
          ) : (
            items.map((p) => (
              <>
                <tr
                  key={p.id}
                  className={`hover:bg-gray-50 transition-colors ${selectedIds.has(p.id) ? "bg-blue-50" : ""}`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">
                    {p.shortId ?? p.id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900 max-w-[140px] truncate">
                    {p.companyName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-700 max-w-[120px] truncate">
                    {p.fullName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-600 max-w-[120px] truncate">
                    {p.cargo ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-600 max-w-[120px] truncate">
                    {p.industryNormalized ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {p.score !== null ? (
                      <ScoreBadge score={p.score} />
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.decision ? (
                      <DecisionBadge decision={p.decision} />
                    ) : (
                      <span className="text-xs text-gray-400">Sin calificar</span>
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-[200px]">
                    {p.explanation ? (
                      <span
                        title={p.explanation}
                        className="block truncate text-xs text-gray-500 cursor-help"
                      >
                        {truncate(p.explanation, 60)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Ver detalle */}
                      <button
                        onClick={() =>
                          setExpandedId(expandedId === p.id ? null : p.id)
                        }
                        title="Ver detalle"
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
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
                          className="rounded p-1 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40 transition-colors"
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
                          className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 transition-colors"
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
                          className="rounded p-1 text-blue-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40 transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Fila expandida de detalle */}
                {expandedId === p.id && (
                  <tr key={`${p.id}-detail`} className="bg-gray-50">
                    <td colSpan={11} className="px-4 py-4">
                      <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3 lg:grid-cols-4">
                        <div>
                          <p className="font-medium text-gray-500">Email</p>
                          <p className="text-gray-700">{p.email ?? "—"}</p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-500">CUIT</p>
                          <p className="font-mono text-gray-700">{p.cuit ?? "—"}</p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-500">Sitio web</p>
                          {p.website ? (
                            <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block">
                              {p.website}
                            </a>
                          ) : (
                            <p className="text-gray-700">—</p>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-500">LinkedIn</p>
                          {p.linkedinUrl ? (
                            <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block">
                              Ver perfil
                            </a>
                          ) : (
                            <p className="text-gray-700">—</p>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-500">Confianza</p>
                          <p className="text-gray-700">{p.confidence !== null ? `${p.confidence}%` : "—"}</p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-500">Prioridad</p>
                          <p className="text-gray-700">{p.priorityTier ?? "—"}</p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-500">Banda de empleados</p>
                          <p className="text-gray-700">{p.employeeBand ?? "—"}</p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-500">Argentina</p>
                          <p className="text-gray-700">
                            {p.isArgentina === null ? "—" : p.isArgentina ? "Sí" : "No"}
                          </p>
                        </div>
                        {p.explanation && (
                          <div className="col-span-full">
                            <p className="font-medium text-gray-500">Justificación IA</p>
                            <p className="text-gray-700">{p.explanation}</p>
                          </div>
                        )}
                        {p.rejectionReason && (
                          <div className="col-span-full">
                            <p className="font-medium text-red-500">Motivo de rechazo</p>
                            <p className="text-gray-700">{p.rejectionReason}</p>
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-gray-500">Creado</p>
                          <p className="text-gray-700">{p.createdAt.slice(0, 10)}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Inline reject form */}
                {rejectingId === p.id && (
                  <tr key={`${p.id}-reject`} className="bg-red-50">
                    <td colSpan={11} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          placeholder="Motivo del rechazo (opcional)"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          className="flex-1 rounded-md border border-red-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRejectConfirm(p.id);
                            if (e.key === "Escape") setRejectingId(null);
                          }}
                        />
                        <button
                          onClick={() => handleRejectConfirm(p.id)}
                          disabled={isPending}
                          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
                        >
                          Confirmar rechazo
                        </button>
                        <button
                          onClick={() => setRejectingId(null)}
                          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
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
