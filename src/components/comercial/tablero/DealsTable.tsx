"use client";

import { useMemo, useState, useTransition } from "react";
import { upsertDealOverlay } from "@/lib/comercial/overlay-actions";
import { dealAlerts, type EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

const HORIZONTES = ["Esta semana", "15 días", "30 días", "60 días", "90 días", "+90 días", "A definir"];
const fmt = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);

export function DealsTable({ deals }: { deals: EnrichedDeal[] }) {
  const today = useMemo(() => new Date(), []); // estable entre renders (evita recomputar alertas)
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="text-sm font-semibold">Oportunidades</h3>
        <p className="text-[11px] text-slate-400">Probabilidad, horizonte y observaciones se guardan para todo el equipo.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800/50">
            <tr>
              <th className="px-4 py-3 text-left">Cliente</th>
              <th className="px-4 py-3 text-left">Pipeline</th>
              <th className="px-4 py-3 text-right">Importe</th>
              <th className="px-4 py-3 text-left">Prob. ★</th>
              <th className="px-4 py-3 text-left">Horizonte ★</th>
              <th className="px-4 py-3 text-left">Observaciones ★</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {deals.map((d) => <Row key={d.deal_id} d={d} today={today} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ d, today }: { d: EnrichedDeal; today: Date }) {
  const [prob, setProb] = useState(d.effective_probability);
  const [hor, setHor] = useState(d.overlay_horizonte ?? "A definir");
  const [obs, setObs] = useState(d.overlay_observaciones ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  type Patch = Omit<Parameters<typeof upsertDealOverlay>[0], "dealId">;
  const save = (patch: Patch) =>
    start(async () => {
      const res = await upsertDealOverlay({ dealId: d.deal_id, ...patch });
      if (!res.ok) {
        // Guardado rechazado (p.ej. la RLS exige rol operaciones): revertir al
        // valor del servidor y avisar, en vez de dejar el cambio "pegado".
        setProb(d.effective_probability);
        setHor(d.overlay_horizonte ?? "A definir");
        setObs(d.overlay_observaciones ?? "");
        setErr(res.error ?? "No se pudo guardar");
      } else {
        setErr(null);
      }
    });
  const alerts = dealAlerts(d, today);

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
      <td className="px-4 py-3">
        <a href={d.href} target="_blank" rel="noreferrer" className="font-medium hover:underline">{d.title}</a>
        <div className="text-[11px] text-slate-400">{d.company_name ?? d.contact_name ?? ""}</div>
        {alerts.map((a) => (
          <span key={a.kind} className="mr-1 mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">{a.label}</span>
        ))}
        {err && <div className="mt-1 text-[10px] text-red-600" title={err}>⚠ {err}</div>}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">{d.pipeline}</td>
      <td className="px-4 py-3 text-right font-mono">{fmt(d.amount)}</td>
      <td className="px-4 py-3">
        <input type="range" min={0} max={100} step={5} value={prob}
          onChange={(e) => setProb(+e.target.value)}
          onMouseUp={() => save({ probabilidad: prob })}
          onTouchEnd={() => save({ probabilidad: prob })} className="w-28" />
        <span className="ml-2 font-mono text-xs">{prob}%</span>
      </td>
      <td className="px-4 py-3">
        <select value={hor} onChange={(e) => { setHor(e.target.value); save({ horizonte: e.target.value }); }}
          className="rounded-lg border-slate-200 py-1 text-xs dark:border-slate-700 dark:bg-slate-800">
          {HORIZONTES.map((h) => <option key={h}>{h}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <input value={obs} onChange={(e) => setObs(e.target.value)} onBlur={() => save({ observaciones: obs })}
          placeholder="Notas…" disabled={pending}
          className="w-56 rounded-lg border-slate-200 py-1 text-xs dark:border-slate-700 dark:bg-slate-800" />
      </td>
    </tr>
  );
}
