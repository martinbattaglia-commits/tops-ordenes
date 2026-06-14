"use client";

/**
 * ContractsCalendar.tsx — Calendario contractual (Cap. 6.5). Hitos de vencimiento
 * agrupados por mes o trimestre, con cliente, canon, riesgo y semáforo. Las
 * relaciones sin fecha (indeterminadas / sin instrumento) se listan aparte.
 */

import { useMemo, useState } from "react";
import {
  SEMAFORO_META,
  formatCanon,
  estadoLabel,
  type ContractRecord,
} from "@/lib/comercial/contracts-types";
import { SemaforoDot } from "./ui";

const MES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type Mode = "mensual" | "trimestral";

function groupKey(venc: string, mode: Mode): { key: string; label: string } {
  const [y, m] = venc.split("-");
  if (mode === "trimestral") {
    const q = Math.floor((+m - 1) / 3) + 1;
    return { key: `${y}-Q${q}`, label: `${q}.º trimestre ${y}` };
  }
  return { key: `${y}-${m}`, label: `${MES[+m - 1]} ${y}` };
}

function CalItem({ c, onOpen }: { c: ContractRecord; onOpen: (c: ContractRecord) => void }) {
  const [, m, d] = c.venc ? c.venc.split("-") : ["", "", ""];
  return (
    <button
      onClick={() => onOpen(c)}
      className="w-full flex items-center gap-3 px-3 py-2 mb-1.5 rounded-lg border border-stroke-soft bg-bg-surface text-left hover:bg-bg-surface-alt"
      style={{ borderLeft: `5px solid ${SEMAFORO_META[c.semaforo].color}` }}
    >
      <span className="w-16 shrink-0 text-[12px] font-bold text-fg-brand">{c.venc ? `${d}/${m}` : "—"}</span>
      <span className="flex-1 truncate font-semibold text-fg-primary">{c.n}</span>
      <span className="w-28 shrink-0 text-right text-[12px] text-fg-muted">
        {formatCanon(c)} {c.mon}
      </span>
      <span className="w-36 shrink-0 flex items-center justify-end gap-1.5 text-[11px] text-fg-secondary">
        <SemaforoDot semaforo={c.semaforo} />
        {c.venc ? SEMAFORO_META[c.semaforo].label : estadoLabel(c.estado)}
      </span>
    </button>
  );
}

export function ContractsCalendar({
  items,
  onOpen,
}: {
  items: ContractRecord[];
  onOpen: (c: ContractRecord) => void;
}) {
  const [mode, setMode] = useState<Mode>("mensual");

  const { groups, sinFecha } = useMemo(() => {
    const withDate = items.filter((c) => c.venc).sort((a, b) => (a.venc! < b.venc! ? -1 : 1));
    const map = new Map<string, { label: string; rows: ContractRecord[] }>();
    for (const c of withDate) {
      const { key, label } = groupKey(c.venc!, mode);
      if (!map.has(key)) map.set(key, { label, rows: [] });
      map.get(key)!.rows.push(c);
    }
    return {
      groups: Array.from(map.values()),
      sinFecha: items.filter((c) => !c.venc),
    };
  }, [items, mode]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1 rounded-pill border border-stroke-soft p-0.5">
          {(["mensual", "trimestral"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded-pill text-xs font-semibold capitalize ${
                mode === m ? "bg-[#0E2A47] text-white" : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          {(["Verde", "Amarillo", "Naranja", "Rojo", "Negro"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-fg-secondary">
              <SemaforoDot semaforo={s} /> {SEMAFORO_META[s].label}
            </span>
          ))}
        </div>
      </div>

      {groups.map((g) => (
        <div key={g.label}>
          <div className="mb-2 border-b-2 border-[#C8A24B] pb-1.5 text-[13px] font-bold capitalize text-fg-brand">
            {g.label}
          </div>
          {g.rows.map((c) => (
            <CalItem key={c.cuit + c.n} c={c} onOpen={onOpen} />
          ))}
        </div>
      ))}

      {sinFecha.length > 0 && (
        <div>
          <div className="mb-2 border-b-2 border-[#33373D] pb-1.5 text-[13px] font-bold text-fg-brand">
            Sin fecha de vencimiento (indeterminados / sin instrumento)
          </div>
          {sinFecha.map((c) => (
            <CalItem key={c.cuit + c.n} c={c} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
