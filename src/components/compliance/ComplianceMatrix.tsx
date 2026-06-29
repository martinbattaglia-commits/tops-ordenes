"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { RISK_HEX, RISK_ORDER, type ComplianceItem, type Riesgo, type Sede } from "@/lib/compliance/data";
import { CaseChips } from "@/components/compliance/ui";

const RIESGOS: Riesgo[] = ["Rojo", "Naranja", "Amarillo", "Verde"];

export function ComplianceMatrix({ items }: { items: ComplianceItem[] }) {
  const [sede, setSede] = useState<"all" | Sede>("all");
  const [risks, setRisks] = useState<Set<Riesgo>>(new Set());
  const [q, setQ] = useState("");

  // Deep-link inicial: #matriz?riesgo=Rojo
  useEffect(() => {
    const h = typeof window !== "undefined" ? window.location.hash : "";
    const m = h.match(/riesgo=(Rojo|Naranja|Amarillo|Verde)/);
    if (m) setRisks(new Set([m[1] as Riesgo]));
    if (/sede=MAGALDI/.test(h)) setSede("MAGALDI");
    if (/sede=LUJAN/.test(h)) setSede("LUJAN");
  }, []);

  const rows = useMemo(() => {
    const lo = q.toLowerCase();
    return items
      .filter((i) => (sede === "all" || i.sede === sede) && (risks.size === 0 || risks.has(i.riesgo)) &&
        (lo === "" || (i.documento + i.organismo + i.nota + i.categoria + i.id).toLowerCase().includes(lo)))
      .sort((a, b) => RISK_ORDER[a.riesgo] - RISK_ORDER[b.riesgo] || (a.dias ?? 9999) - (b.dias ?? 9999));
  }, [items, sede, risks, q]);

  const toggleRisk = (r: Riesgo) => setRisks((s) => { const n = new Set(s); n.has(r) ? n.delete(r) : n.add(r); return n; });
  const btn = (active: boolean) =>
    `text-[11.5px] font-semibold rounded-lg px-3 py-1.5 border transition-colors cursor-pointer ${active
      ? "bg-tops-blue-700 text-white border-tops-blue-700"
      : "bg-bg-surface-alt text-fg-secondary border-stroke-soft hover:border-tops-blue-700/40"}`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className={btn(sede === "all")} onClick={() => setSede("all")}>Todos</button>
        <button className={btn(sede === "MAGALDI")} onClick={() => setSede("MAGALDI")}>MAGALDI</button>
        <button className={btn(sede === "LUJAN")} onClick={() => setSede("LUJAN")}>LUJÁN</button>
        <span className="w-px h-5 bg-stroke-soft mx-1" />
        {RIESGOS.map((r) => {
          const on = risks.has(r);
          return (
            <button key={r} onClick={() => toggleRisk(r)}
              className="text-[11.5px] font-semibold rounded-lg px-3 py-1.5 border transition-colors cursor-pointer"
              style={on
                ? { background: RISK_HEX[r], color: "#fff", borderColor: RISK_HEX[r] }
                : { background: "var(--bg-surface-alt)", color: RISK_HEX[r], borderColor: `${RISK_HEX[r]}55` }}>
              ● {r}
            </button>
          );
        })}
        <div className="relative flex-1 min-w-[200px]">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-9"
            placeholder="Buscar documento, organismo, n° de trámite…" />
        </div>
      </div>

      <div className="text-[11px] text-fg-muted mb-2">{rows.length} de {items.length} ítems</div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-fg-muted text-[10.5px] uppercase tracking-wide border-b border-stroke-soft">
              <th className="py-2 pr-2">ID</th><th className="pr-2">Sede</th><th className="pr-2">Categoría</th>
              <th className="pr-2">Documento</th><th className="pr-2">Organismo</th><th className="pr-2">Emisión</th>
              <th className="pr-2">Vence</th><th className="pr-2 text-right">Días</th><th className="pr-2">Estado</th>
              <th className="pr-2">Riesgo</th><th>Fuente</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="border-b border-stroke-soft/40 align-top hover:bg-bg-surface-alt/50">
                <td className="py-2.5 pr-2"><Link href={`/anmat/${i.id}`} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-surface-alt text-fg-link hover:underline">{i.id}</Link></td>
                <td className="pr-2 text-xs text-fg-secondary whitespace-nowrap">{i.sede}</td>
                <td className="pr-2 text-xs text-fg-secondary whitespace-nowrap">{i.categoria}</td>
                <td className="pr-2 max-w-[320px]">
                  <Link href={`/anmat/${i.id}`} className="text-[12.5px] font-semibold text-fg-link hover:underline leading-tight cursor-pointer" title="Abrir ficha regulatoria">{i.documento}</Link>
                  <div className="text-[10.5px] text-fg-muted mt-0.5 leading-snug">{i.nota}</div>
                  <CaseChips item={i} />
                </td>
                <td className="pr-2 text-[11px] text-fg-muted max-w-[200px]">{i.organismo}</td>
                <td className="pr-2 text-xs text-fg-secondary whitespace-nowrap">{i.emi_fmt}</td>
                <td className="pr-2 text-xs text-fg-secondary whitespace-nowrap">{i.venc_fmt}</td>
                <td className="pr-2 text-right text-xs tabular font-bold whitespace-nowrap"
                  style={{ color: i.dias !== null && i.dias < 90 ? RISK_HEX[i.riesgo] : "var(--fg-muted)" }}>
                  {i.dias === null ? "—" : i.dias}
                </td>
                <td className="pr-2"><span className="text-[10px] font-bold px-2 py-0.5 rounded-pill whitespace-nowrap"
                  style={{ color: RISK_HEX[i.riesgo], background: `${RISK_HEX[i.riesgo]}22`, border: `1px solid ${RISK_HEX[i.riesgo]}66` }}>{i.estado}</span></td>
                <td className="pr-2"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: RISK_HEX[i.riesgo] }} title={i.riesgo} /></td>
                <td className="text-[10.5px] text-fg-muted">{i.fuente}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-fg-muted text-sm">Sin coincidencias.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
