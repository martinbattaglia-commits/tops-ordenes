"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import type { FinanceCurrency, ProfitAndLossStatement, AccountGroupPosition } from "@/lib/finanzas/types";
import { fmtCurrency } from "@/lib/utils";

interface ExecutiveCockpitProps {
  currency: FinanceCurrency;
  accountPositions: AccountGroupPosition[];
  pnl: ProfitAndLossStatement;
  alerts: { id: string; type: "critical" | "warning" | "info"; title: string; detail: string; actionUrl?: string }[];
  decisions: { id: string; title: string; impact: string; deadline: string; owner: string; status: string }[];
}

export function ExecutiveCockpit({
  currency,
  accountPositions,
  pnl,
  alerts,
  decisions,
}: ExecutiveCockpitProps) {
  const totalBalance = accountPositions.reduce((acc, g) => {
    return acc + (currency === "ARS" ? g.arsBalance : g.usdBalance);
  }, 0);

  return (
    <div className="space-y-6">
      {/* KPIs Principales de Nivel Ejecutivo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-white rounded-xl border border-[#DDE2EB] shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-[#687087] uppercase tracking-wider mb-2">
            <span>Posición de Fondos Total</span>
            <Icon name="wallet" className="w-4 h-4 text-[#050555]" />
          </div>
          <div className="text-2xl font-bold text-[#050555] tracking-tight">
            {currency === "ARS" ? fmtCurrency(totalBalance) : `U$S ${totalBalance.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`}
          </div>
          <p className="text-xs text-[#137333] mt-2 font-medium flex items-center gap-1">
            <Icon name="trend-up" className="w-3.5 h-3.5" /> Posición consolidada en 4 agrupadores
          </p>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#DDE2EB] shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-[#687087] uppercase tracking-wider mb-2">
            <span>Ingresos del Período</span>
            <Icon name="trend-up" className="w-4 h-4 text-[#137333]" />
          </div>
          <div className="text-2xl font-bold text-[#111331] tracking-tight">
            {fmtCurrency(pnl.ingresos.total)}
          </div>
          <p className="text-xs text-[#687087] mt-2">
            Facturación y fletes consolidados
          </p>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#DDE2EB] shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-[#687087] uppercase tracking-wider mb-2">
            <span>EBITDA Operativo</span>
            <Icon name="report" className="w-4 h-4 text-[#214576]" />
          </div>
          <div className={`text-2xl font-bold tracking-tight ${pnl.ebitda >= 0 ? "text-[#137333]" : "text-[#C9070D]"}`}>
            {fmtCurrency(pnl.ebitda)}
          </div>
          <p className="text-xs text-[#687087] mt-2 font-medium">
            Margen EBITDA: {pnl.ebitdaPorcentaje}%
          </p>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#DDE2EB] shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-[#687087] uppercase tracking-wider mb-2">
            <span>Margen Bruto</span>
            <Icon name="check-circle" className="w-4 h-4 text-[#050555]" />
          </div>
          <div className="text-2xl font-bold text-[#050555] tracking-tight">
            {pnl.margenBrutoPorcentaje}%
          </div>
          <p className="text-xs text-[#687087] mt-2">
            Bruto: {fmtCurrency(pnl.margenBruto)}
          </p>
        </div>
      </div>

      {/* Grid de 2 Columnas: Alertas Materiales y Agenda de Decisiones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alertas Materiales */}
        <div className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#050555] flex items-center gap-2">
              <Icon name="bell" className="w-4 h-4 text-[#C9070D]" /> Alertas Financieras Materiales
            </h2>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#FBE9EA] text-[#C9070D]">
              {alerts.length} activas
            </span>
          </div>

          <div className="divide-y divide-[#DDE2EB] p-2">
            {alerts.map((alert) => {
              let alertBorder = "border-l-4 border-l-[#C9070D]";
              if (alert.type === "warning") alertBorder = "border-l-4 border-l-amber-500";
              if (alert.type === "info") alertBorder = "border-l-4 border-l-[#214576]";

              return (
                <div key={alert.id} className={`p-3.5 my-1 bg-[#F4F5F8]/40 rounded-lg ${alertBorder}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-[#111331]">{alert.title}</h4>
                      <p className="text-xs text-[#687087] mt-0.5">{alert.detail}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agenda de Decisiones y Minutas */}
        <div className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#050555] flex items-center gap-2">
              <Icon name="check" className="w-4 h-4 text-[#050555]" /> Agenda de Decisiones y Acuerdos
            </h2>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#E9EEF5] text-[#214576]">
              {decisions.length} pendientes
            </span>
          </div>

          <div className="divide-y divide-[#DDE2EB]">
            {decisions.map((dec) => (
              <div key={dec.id} className="p-4 hover:bg-[#F4F5F8]/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs font-bold text-[#111331]">{dec.title}</span>
                    <div className="flex items-center gap-3 text-[11px] text-[#687087] mt-1">
                      <span>Impacto: {dec.impact}</span>
                      <span>•</span>
                      <span>Vencimiento: {dec.deadline}</span>
                      <span>•</span>
                      <span>Responsable: {dec.owner}</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#E9EEF5] text-[#214576] uppercase">
                    {dec.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Rentabilidad por Línea de Negocio */}
      <div className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-[#DDE2EB] bg-[#F4F5F8]">
          <h2 className="text-sm font-bold text-[#050555]">
            Rentabilidad por Línea de Negocio (P&L Gerencial)
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[#DDE2EB]">
          {pnl.rentabilidadPorLinea.slice(0, 4).map((line) => (
            <div key={line.linea} className="p-5">
              <span className="text-xs font-bold text-[#050555] uppercase tracking-wider block mb-1">
                {line.label}
              </span>
              <div className="text-lg font-bold text-[#111331] mt-1">
                {fmtCurrency(line.ingresos)}
              </div>
              <div className="text-xs text-[#687087] mt-1">
                Costos: {fmtCurrency(line.costos)}
              </div>
              <div className="flex items-center justify-between text-xs mt-3 pt-3 border-t border-[#DDE2EB]">
                <span className="text-[#687087]">Margen Operativo</span>
                <span className={`font-bold ${line.margen >= 0 ? "text-[#137333]" : "text-[#C9070D]"}`}>
                  {line.margenPorcentaje}% ({fmtCurrency(line.margen)})
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
