"use client";

import { useEffect, useState } from "react";
import { ScoreGauge } from "@/components/compliance/ui";
import {
  RISK_HEX, RISK_LABEL, riskDistribution,
  complianceScore, complianceColor, riskScore, riskBand, riskBandColor, criticalCount,
  type ComplianceItem, type Sede,
} from "@/lib/compliance/data";

const SEDES: { key: Sede; label: string }[] = [
  { key: "MAGALDI", label: "Magaldi" },
  { key: "LUJAN", label: "Luján" },
];

export function SedeTabs({ items }: { items: ComplianceItem[] }) {
  const [active, setActive] = useState<Sede>("MAGALDI");
  useEffect(() => {
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (/sede-LUJAN/.test(h)) setActive("LUJAN");
    else if (/sede-MAGALDI/.test(h)) setActive("MAGALDI");
  }, []);

  const rows = items.filter((i) => i.sede === active);
  const cs = complianceScore(rows);
  const rs = riskScore(rows);
  const band = riskBand(rs);
  const criticos = criticalCount(rows);
  const warnings = rows.filter((i) => i.riesgo === "Naranja" || i.riesgo === "Amarillo").length;
  const csHex = RISK_HEX[complianceColor(cs)];
  const rsHex = RISK_HEX[riskBandColor(band)];
  const dist = riskDistribution(rows);
  const docs = rows.reduce((s, i) => s + i.docs, 0);
  const venc = rows.filter((i) => i.dias !== null && (i.dias as number) <= 90).sort((a, b) => (a.dias as number) - (b.dias as number));

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {SEDES.map((s) => (
          <button key={s.key} onClick={() => setActive(s.key)}
            className={`text-sm font-bold rounded-lg px-4 py-2 border transition-colors cursor-pointer ${active === s.key
              ? "bg-tops-blue-700 text-white border-tops-blue-700"
              : "bg-bg-surface-alt text-fg-secondary border-stroke-soft hover:border-tops-blue-700/40"}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-start">
        {/* Score + meta */}
        <div className="flex flex-col items-center gap-3">
          <ScoreGauge score={cs} hex={csHex} caption="cumplimiento" size={160} />
          <div className="flex flex-wrap gap-2 justify-center">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-pill" style={{ color: rsHex, background: `${rsHex}22` }}>Risk {rs} · {band}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-pill" style={{ color: RISK_HEX.Rojo, background: `${RISK_HEX.Rojo}22` }}>{criticos} críticos</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-pill" style={{ color: RISK_HEX.Naranja, background: `${RISK_HEX.Naranja}22` }}>{warnings} a resolver</span>
          </div>
          <div className="text-xs text-fg-muted text-center">{rows.length} ítems · {docs} documentos</div>
        </div>

        {/* Riesgos + vencimientos */}
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {dist.map((d) => (
              <div key={d.riesgo} className="card p-3 text-center">
                <div className="text-2xl font-black tabular" style={{ color: RISK_HEX[d.riesgo] }}>{d.count}</div>
                <div className="text-[10px] uppercase tracking-wide text-fg-muted mt-0.5">{RISK_LABEL[d.riesgo]}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="text-xs font-bold text-fg-secondary uppercase tracking-wide mb-2">Vencimientos ≤ 90 días</div>
            <div className="space-y-1.5">
              {venc.length === 0 && <div className="text-xs text-fg-muted">Sin vencimientos en ventana de 90 días.</div>}
              {venc.map((i) => (
                <div key={i.id} className="flex items-center gap-3 card p-2.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: RISK_HEX[i.riesgo] }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-fg-primary truncate">{i.documento}</div>
                    <div className="text-[10.5px] text-fg-muted truncate">{i.organismo}</div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <div className="text-[11px] tabular font-bold" style={{ color: RISK_HEX[i.riesgo] }}>
                      {i.dias !== null && i.dias < 0 ? `${Math.abs(i.dias)}d venc.` : `${i.dias}d`}
                    </div>
                    <div className="text-[10px] text-fg-muted">{i.venc_fmt}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
