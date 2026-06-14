"use client";

/**
 * ContractsAlerts.tsx — Motor de alertas escalonadas (Cap. 6.6). Avisos a
 * 90/60/30/15/7 días del vencimiento + alerta roja permanente para contratos
 * vencidos o sin instrumento, cada uno con responsable y acción esperada.
 */

import { formatFecha, type ContractAlert } from "@/lib/comercial/contracts-types";
import { RiesgoTag } from "./ui";

export function ContractsAlerts({
  alerts,
  onOpen,
}: {
  alerts: ContractAlert[];
  onOpen: (c: ContractAlert["contract"]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border-l-4 border-[#C8A24B] bg-[#FBF6E9] px-4 py-3 text-[12.5px] text-[#1C2733]">
        <b>Motor de alertas escalonadas.</b> Genera avisos a 90 / 60 / 30 / 15 / 7 días del
        vencimiento y una alerta roja permanente para contratos vencidos o sin instrumento. Cada
        nivel asigna responsable y acción esperada.
      </div>

      {alerts.length === 0 && <p className="text-fg-muted">Sin alertas activas.</p>}

      <div className="space-y-2.5">
        {alerts.map((a) => {
          const c = a.contract;
          return (
            <button
              key={a.level + c.cuit + c.n}
              onClick={() => onOpen(c)}
              className="w-full flex items-center gap-3.5 rounded-lg border border-stroke-soft bg-bg-surface px-4 py-3 text-left hover:bg-bg-surface-alt"
              style={{ borderLeft: `5px solid ${a.color}` }}
            >
              <span
                className="w-24 shrink-0 rounded-md py-1.5 text-center text-[12px] font-extrabold text-white"
                style={{ background: a.color }}
              >
                {a.level}
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 font-bold text-fg-primary">
                  <span className="truncate">{c.n}</span>
                  <RiesgoTag riesgo={c.riesgo} size="xs" />
                </span>
                <span className="block text-[12px] text-fg-muted">
                  {a.title} ·{" "}
                  {c.venc
                    ? `vence ${formatFecha(c.venc)}${a.order >= 0 ? ` (${a.order} días)` : ""}`
                    : c.estado.replace(/-/g, " ")}
                </span>
              </span>
              <span className="w-44 shrink-0 text-right text-[11px] text-fg-muted">{a.responsable}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
