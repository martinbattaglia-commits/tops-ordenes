"use client";

/**
 * ContractsTable.tsx — Cartera contractual (Entregable 3): tabla ordenable con
 * buscador global (cliente o CUIT) y filtros por tipo, riesgo y semáforo. Cada
 * fila abre la ficha lateral. Réplica de la maqueta.
 */

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  SEMAFORO_META,
  formatCanon,
  formatFecha,
  estadoLabel,
  type ContractRecord,
  type ContractSemaforo,
  type ContractRiesgo,
  type ContractTipo,
} from "@/lib/comercial/contracts-types";
import { SemaforoDot, RiesgoTag, TipoTag } from "./ui";

type SortKey = "n" | "tipo" | "canon" | "m2" | "venc" | "meses_rest" | "riesgo" | "estado";

const RIESGO_ORDER: Record<ContractRiesgo, number> = { Crítico: 0, Alto: 1, Medio: 2, Bajo: 3 };

export function ContractsTable({
  items,
  onOpen,
}: {
  items: ContractRecord[];
  onOpen: (c: ContractRecord) => void;
}) {
  const [q, setQ] = useState("");
  const [fTipo, setFTipo] = useState<"" | ContractTipo>("");
  const [fRiesgo, setFRiesgo] = useState<"" | ContractRiesgo>("");
  const [fSem, setFSem] = useState<"" | ContractSemaforo>("");
  const [sortKey, setSortKey] = useState<SortKey>("meses_rest");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = items.filter(
      (c) =>
        (!term || c.n.toLowerCase().includes(term) || (c.cuit ?? "").toLowerCase().includes(term)) &&
        (!fTipo || c.tipo === fTipo) &&
        (!fRiesgo || c.riesgo === fRiesgo) &&
        (!fSem || c.semaforo === fSem),
    );
    const val = (c: ContractRecord, k: SortKey): number | string => {
      if (k === "riesgo") return RIESGO_ORDER[c.riesgo];
      if (k === "canon") return c.canon ?? Infinity * sortDir;
      if (k === "m2") return c.m2 ?? Infinity * sortDir;
      if (k === "meses_rest") return c.meses_rest ?? Infinity * sortDir;
      if (k === "venc") return c.venc ?? (sortDir > 0 ? "9999" : "0000");
      if (k === "tipo") return c.tipo;
      if (k === "estado") return c.estado;
      return c.n;
    };
    return [...filtered].sort((aRow, bRow) => {
      const x = val(aRow, sortKey);
      const y = val(bRow, sortKey);
      if (x < y) return -1 * sortDir;
      if (x > y) return 1 * sortDir;
      return 0;
    });
  }, [items, q, fTipo, fRiesgo, fSem, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(1);
    }
  };

  const Th = ({ k, children, align = "left" }: { k?: SortKey; children: React.ReactNode; align?: "left" | "right" | "center" }) => (
    <th
      className={`px-2.5 py-2 text-[11.5px] font-semibold text-white select-none ${
        k ? "cursor-pointer hover:bg-[#143a5e]" : ""
      } ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`}
      onClick={k ? () => toggleSort(k) : undefined}
    >
      {children}
      {k && sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente o CUIT…"
            className="input pl-9"
          />
        </div>
        <select value={fTipo} onChange={(e) => setFTipo(e.target.value as "" | ContractTipo)} className="input w-auto">
          <option value="">Todos los tipos</option>
          <option value="ANMAT">ANMAT</option>
          <option value="Cargas Generales">Cargas Generales</option>
        </select>
        <select value={fRiesgo} onChange={(e) => setFRiesgo(e.target.value as "" | ContractRiesgo)} className="input w-auto">
          <option value="">Todo riesgo</option>
          <option value="Crítico">Crítico</option>
          <option value="Alto">Alto</option>
          <option value="Medio">Medio</option>
          <option value="Bajo">Bajo</option>
        </select>
        <select value={fSem} onChange={(e) => setFSem(e.target.value as "" | ContractSemaforo)} className="input w-auto">
          <option value="">Todo semáforo</option>
          <option value="Verde">🟢 &gt;90 días</option>
          <option value="Amarillo">🟡 60–90</option>
          <option value="Naranja">🟠 30–60</option>
          <option value="Rojo">🔴 &lt;30</option>
          <option value="Negro">⚫ Vencido / sin instr.</option>
          <option value="Azul">🔵 Indeterminado</option>
          <option value="Gris">⚪ Incierto</option>
        </select>
        <span className="ml-auto text-xs text-fg-muted">
          {rows.length} de {items.length} contratos
        </span>
      </div>

      {/* Tabla */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-[#0E2A47]">
                <Th k="n">Cliente</Th>
                <Th k="tipo">Tipo</Th>
                <Th k="canon" align="right">Canon</Th>
                <Th k="m2" align="right">m²</Th>
                <Th k="venc" align="center">Vencimiento</Th>
                <Th k="meses_rest" align="center">Meses</Th>
                <Th k="riesgo" align="center">Riesgo</Th>
                <Th k="estado">Estado</Th>
                <Th align="center">Sem.</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-fg-muted">
                    Sin resultados para los filtros aplicados.
                  </td>
                </tr>
              )}
              {rows.map((c) => (
                <tr
                  key={c.cuit + c.n}
                  onClick={() => onOpen(c)}
                  className="cursor-pointer border-b border-stroke-soft hover:bg-bg-surface-alt"
                >
                  <td className="px-2.5 py-2 font-semibold text-fg-primary">{c.n}</td>
                  <td className="px-2.5 py-2">
                    <TipoTag tipo={c.tipo} />
                  </td>
                  <td className="px-2.5 py-2 text-right tabular text-fg-primary">
                    {formatCanon(c)} <span className="text-[10px] text-fg-muted">{c.mon}</span>
                  </td>
                  <td className="px-2.5 py-2 text-right tabular text-fg-secondary">{c.m2 ?? "—"}</td>
                  <td className="px-2.5 py-2 text-center text-fg-secondary">{formatFecha(c.venc)}</td>
                  <td className="px-2.5 py-2 text-center tabular text-fg-secondary">
                    {c.meses_rest == null ? "—" : Math.round(c.meses_rest)}
                  </td>
                  <td className="px-2.5 py-2 text-center">
                    <RiesgoTag riesgo={c.riesgo} />
                  </td>
                  <td className="px-2.5 py-2 text-[11.5px] text-fg-secondary">{estadoLabel(c.estado)}</td>
                  <td className="px-2.5 py-2 text-center">
                    <SemaforoDot semaforo={c.semaforo} title={`${c.semaforo} · ${SEMAFORO_META[c.semaforo].label}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
