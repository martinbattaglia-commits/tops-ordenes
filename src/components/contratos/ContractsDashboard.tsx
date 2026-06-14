"use client";

/**
 * ContractsDashboard.tsx — Tablero ejecutivo (Cap. 6.2–6.4 de la auditoría).
 * 8 KPIs + 3 donuts (estado/riesgo/tipo) + barras de vencimientos (12 meses) +
 * acciones prioritarias + facturación comprometida ARS por tipo y USD por contrato.
 */

import { useMemo } from "react";
import {
  RIESGO_META,
  TIPO_META,
  estadoLabel,
  type ContractRecord,
  type ContractsAggregates,
} from "@/lib/comercial/contracts-types";
import {
  estadoGroupDistribution,
  facturacionPorTipo,
  vencimientosPorMes,
  accionesPrioritarias,
} from "@/lib/comercial/contracts-engine";
import { Kpi, SemaforoDot, RiesgoTag } from "./ui";
import { Donut, VencimientosBars, HBars, type Segment } from "./charts";

const ESTADO_GROUP_COLOR: Record<string, string> = {
  Vigente: "#1F9D55",
  "Próximo a vencer": "#E0B400",
  "Crítico/Vencido": "#D14343",
  Indeterminado: "#2E6FB0",
};

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13px] font-bold text-fg-brand mb-3">{children}</h3>;
}

export function ContractsDashboard({
  items,
  aggregates: a,
  corte,
  onOpen,
}: {
  items: ContractRecord[];
  aggregates: ContractsAggregates;
  corte: string;
  onOpen: (c: ContractRecord) => void;
}) {
  const estadoSegs: Segment[] = useMemo(() => {
    const dist = estadoGroupDistribution(items);
    return Object.entries(dist).map(([label, value]) => ({
      label,
      value,
      color: ESTADO_GROUP_COLOR[label],
    }));
  }, [items]);

  const riesgoSegs: Segment[] = useMemo(
    () =>
      (["Bajo", "Medio", "Alto", "Crítico"] as const).map((r) => ({
        label: r,
        value: a.riesgos[r] ?? 0,
        color: RIESGO_META[r].color,
      })),
    [a],
  );

  const tipoSegs: Segment[] = [
    { label: "ANMAT", value: a.anmat, color: TIPO_META.ANMAT.color },
    { label: "Cargas Generales", value: a.cg, color: TIPO_META["Cargas Generales"].color },
  ];

  const venc = useMemo(() => vencimientosPorMes(items, corte, 13), [items, corte]);
  const factTipo = useMemo(() => facturacionPorTipo(items), [items]);
  const prio = useMemo(() => accionesPrioritarias(items), [items]);
  const usd = useMemo(
    () =>
      items
        .filter((c) => c.mon === "USD" && c.canon)
        .map((c) => ({ label: c.n.split(" ")[0], value: c.canon as number, color: "#C8A24B" })),
    [items],
  );

  const fmtArs = (v: number) => "$" + Math.round(v).toLocaleString("es-AR");
  const fmtUsd = (v: number) => "US$" + Math.round(v).toLocaleString("es-AR");

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi value={a.activos} label="Contratos activos" accent="navy" />
        <Kpi value={a.anmat} label="Contratos ANMAT" accent="navy" />
        <Kpi value={a.cg} label="Cargas Generales" accent="gold" />
        <Kpi value={a.m2Total.toLocaleString("es-AR")} label="m² contratados" accent="navy" />
        <Kpi value={`$${(a.factArs / 1e6).toFixed(1)}M`} label="Facturación mensual ARS" accent="green" />
        <Kpi value={`$${(a.factArsAnual / 1e6).toFixed(0)}M`} label="Facturación anual ARS" accent="green" />
        <Kpi value={a.prox180} label="Vencen ≤180 días" accent="orange" />
        <Kpi value={a.estados["Renov-No-Instrumentada"] ?? 0} label="Renovaciones pendientes" accent="red" />
      </div>

      {/* Donuts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <div className="card p-4">
          <CardTitle>Contratos por estado</CardTitle>
          <Donut segments={estadoSegs} centerLabel="contratos" centerValue={a.total} />
        </div>
        <div className="card p-4">
          <CardTitle>Distribución por riesgo</CardTitle>
          <Donut segments={riesgoSegs} centerLabel="riesgo" centerValue={a.total} />
        </div>
        <div className="card p-4">
          <CardTitle>ANMAT vs Cargas Generales</CardTitle>
          <Donut segments={tipoSegs} centerLabel="tipo" centerValue={a.total} />
        </div>
      </div>

      {/* Vencimientos + Acciones prioritarias */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3.5">
        <div className="card p-4">
          <CardTitle>Vencimientos próximos (12 meses)</CardTitle>
          <VencimientosBars data={venc} />
        </div>
        <div className="card p-4">
          <CardTitle>Acciones prioritarias</CardTitle>
          <ul className="text-[12.5px]">
            {prio.map((c) => (
              <li key={c.cuit + c.n}>
                <button
                  onClick={() => onOpen(c)}
                  className="w-full flex items-center gap-2.5 py-1.5 border-b border-dotted border-stroke-soft text-left hover:bg-bg-surface-alt"
                >
                  <SemaforoDot semaforo={c.semaforo} />
                  <b className="flex-1 truncate text-fg-primary">{c.n}</b>
                  <RiesgoTag riesgo={c.riesgo} />
                  <span className="w-[88px] shrink-0 text-right text-[11px] text-fg-muted">
                    {estadoLabel(c.estado)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Facturación */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <div className="card p-4">
          <CardTitle>Facturación comprometida por tipo (ARS/mes)</CardTitle>
          <HBars
            items={[
              { label: "ANMAT", value: factTipo.ANMAT, color: TIPO_META.ANMAT.color },
              { label: "Cargas Generales", value: factTipo["Cargas Generales"], color: TIPO_META["Cargas Generales"].color },
            ]}
            format={fmtArs}
          />
        </div>
        <div className="card p-4">
          <CardTitle>Facturación en USD (mensual)</CardTitle>
          <HBars items={usd} format={fmtUsd} />
        </div>
      </div>
    </div>
  );
}
