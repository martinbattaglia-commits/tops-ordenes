"use client";

import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import type {
  FinanceCurrency,
  AccountGroupPosition,
  ProfitAndLossStatement,
  FinanceUnifiedTransaction,
} from "@/lib/finanzas/types";
import { calculateFinanceDashboardMetrics } from "@/lib/finanzas/engine";
import { fmtCurrency } from "@/lib/utils";

interface ExecutiveCockpitProps {
  currency: FinanceCurrency;
  accountPositions: AccountGroupPosition[];
  pnl: ProfitAndLossStatement;
  transactions?: FinanceUnifiedTransaction[];
  alerts: { id: string; type: "critical" | "warning" | "info"; title: string; detail: string }[];
  decisions: { id: string; title: string; impact: string; deadline: string; owner: string; status: string }[];
}

export function ExecutiveCockpit({
  currency,
  accountPositions,
  pnl,
  transactions = [],
  alerts,
  decisions,
}: ExecutiveCockpitProps) {
  const [monthlyPeriodLimit, setMonthlyPeriodLimit] = useState<3 | 6 | 12>(6);
  const [categoryPeriod, setCategoryPeriod] = useState<"mes" | "trimestre" | "anio">("mes");

  const totalBalance = accountPositions.reduce((acc, g) => {
    return acc + (currency === "ARS" ? g.arsBalance : g.usdBalance);
  }, 0);

  const metrics = calculateFinanceDashboardMetrics(
    transactions,
    pnl,
    totalBalance,
    currency
  );

  const formatMoney = (val: number) => {
    return currency === "ARS"
      ? fmtCurrency(val)
      : `U$S ${val.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Donut SVG Math
  const totalCategoryAmount = metrics.expensesByCategory.reduce((s, c) => s + c.amount, 0);
  let cumulativeAngle = 0;
  const donutSlices = metrics.expensesByCategory.slice(0, 6).map((cat) => {
    const angle = totalCategoryAmount > 0 ? (cat.amount / totalCategoryAmount) * 360 : 0;
    const startAngle = cumulativeAngle;
    cumulativeAngle += angle;
    return {
      ...cat,
      startAngle,
      angle,
    };
  });

  const visibleMonthly = metrics.monthlyComparison.slice(-monthlyPeriodLimit);
  const maxMonthlyVal = Math.max(...visibleMonthly.map((m) => Math.max(m.income, m.expense)), 0);
  const hasMonthlyData = visibleMonthly.some((m) => m.income > 0 || m.expense > 0);

  return (
    <div className="space-y-6">
      {/* 1. KPIs Principales de Nivel Ejecutivo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Posición de Fondos Total */}
        <div className="p-5 bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-xs font-bold text-fg-muted uppercase tracking-wider mb-2">
            <span>Posición de Fondos Total</span>
            <div className="w-7 h-7 rounded-lg bg-tops-blue-700/10 dark:bg-blue-950/60 flex items-center justify-center text-tops-blue-700 dark:text-blue-400">
              <Icon name="wallet" className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-fg-primary tracking-tight">
            {formatMoney(totalBalance)}
          </div>
          <p className="text-xs text-status-success mt-2 font-semibold flex items-center gap-1">
            <Icon name="trend-up" className="w-3.5 h-3.5" /> Posición consolidada en 4 agrupadores
          </p>
        </div>

        {/* Ingresos del Período */}
        <div className="p-5 bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-xs font-bold text-fg-muted uppercase tracking-wider mb-2">
            <span>Ingresos del Período</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-status-success dark:text-emerald-400">
              <Icon name="trend-up" className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-fg-primary tracking-tight">
            {formatMoney(pnl.ingresos.total)}
          </div>
          <p className="text-xs text-fg-muted mt-2">
            Facturación, fletes y servicios cobrados
          </p>
        </div>

        {/* EBITDA Operativo */}
        <div className="p-5 bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-xs font-bold text-fg-muted uppercase tracking-wider mb-2">
            <span>EBITDA Operativo</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-tops-blue-700 dark:text-blue-400">
              <Icon name="report" className="w-4 h-4" />
            </div>
          </div>
          <div className={`text-2xl font-bold tracking-tight ${pnl.ebitda >= 0 ? "text-status-success" : "text-tops-red"}`}>
            {formatMoney(pnl.ebitda)}
          </div>
          <p className="text-xs text-fg-muted mt-2 font-medium">
            Margen EBITDA: <strong className="text-fg-primary">{pnl.ebitdaPorcentaje}%</strong>
          </p>
        </div>

        {/* Margen Bruto */}
        <div className="p-5 bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-xs font-bold text-fg-muted uppercase tracking-wider mb-2">
            <span>Margen Bruto</span>
            <div className="w-7 h-7 rounded-lg bg-tops-blue-700/10 dark:bg-blue-950/60 flex items-center justify-center text-tops-blue-700 dark:text-blue-400">
              <Icon name="check-circle" className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-fg-primary tracking-tight">
            {pnl.margenBrutoPorcentaje}%
          </div>
          <p className="text-xs text-fg-muted mt-2">
            Bruto: {formatMoney(pnl.margenBruto)}
          </p>
        </div>
      </div>

      {/* 2. Gráficos Centrales: Gastos por Categoría (Donut) & Top 10 Destinatarios (Barras Horizontales) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gastos por Categoría (Donut Chart) */}
        <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs p-5 transition-colors flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-stroke-soft mb-4">
            <div>
              <h3 className="text-sm font-bold text-fg-primary">
                1. Gastos por Categoría
              </h3>
              <p className="text-xs text-fg-muted">Distribución porcentual y montos por rubro real</p>
            </div>
            <div className="inline-flex rounded-lg border border-stroke-soft bg-bg-surface-alt p-0.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setCategoryPeriod("mes")}
                className={`px-2 py-0.5 rounded ${categoryPeriod === "mes" ? "bg-bg-surface text-fg-primary shadow-2xs" : "text-fg-muted"}`}
              >
                Mes
              </button>
              <button
                type="button"
                onClick={() => setCategoryPeriod("trimestre")}
                className={`px-2 py-0.5 rounded ${categoryPeriod === "trimestre" ? "bg-bg-surface text-fg-primary shadow-2xs" : "text-fg-muted"}`}
              >
                Trimestre
              </button>
              <button
                type="button"
                onClick={() => setCategoryPeriod("anio")}
                className={`px-2 py-0.5 rounded ${categoryPeriod === "anio" ? "bg-bg-surface text-fg-primary shadow-2xs" : "text-fg-muted"}`}
              >
                Año
              </button>
            </div>
          </div>

          {metrics.expensesByCategory.length === 0 ? (
            <div className="py-12 text-center text-fg-muted space-y-2">
              <div className="w-10 h-10 rounded-full bg-bg-surface-alt flex items-center justify-center text-fg-muted mx-auto">
                <Icon name="report" className="w-5 h-5" />
              </div>
              <div className="text-xs font-bold text-fg-primary">Sin gastos registrados para el período</div>
              <p className="text-[11px] text-fg-muted max-w-xs mx-auto">
                Los egresos registrados en Tesorería y pagos a proveedores se categorizarán automáticamente en este gráfico.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              {/* Donut SVG Representation */}
              <div className="relative flex items-center justify-center p-2">
                <svg viewBox="0 0 160 160" className="w-36 h-36 transform -rotate-90">
                  {donutSlices.map((slice, idx) => {
                    const strokeDasharray = `${(slice.percentage * 3.77).toFixed(1)} 377`;
                    const strokeDashoffset = `-${(donutSlices.slice(0, idx).reduce((s, x) => s + x.percentage, 0) * 3.77).toFixed(1)}`;
                    return (
                      <circle
                        key={slice.code}
                        cx="80"
                        cy="80"
                        r="60"
                        fill="none"
                        stroke={slice.color}
                        strokeWidth="24"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        className="transition-all duration-300 hover:opacity-80 cursor-pointer"
                      />
                    );
                  })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[10px] uppercase font-bold text-fg-muted">Total Egresos</span>
                  <span className="text-xs font-bold text-fg-primary">{formatMoney(totalCategoryAmount)}</span>
                </div>
              </div>

              {/* Legend with percentages */}
              <div className="space-y-2 text-xs">
                {metrics.expensesByCategory.slice(0, 5).map((cat) => (
                  <div key={cat.code} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }}></span>
                      <span className="text-fg-secondary truncate text-[11px] font-medium">{cat.name}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-bold text-fg-primary">{cat.percentage}%</span>
                      <span className="text-[10px] text-fg-muted block">{formatMoney(cat.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Principales Destinatarios de Pagos (Top 10 Barras Horizontales) */}
        <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs p-5 transition-colors">
          <div className="flex items-center justify-between pb-3 border-b border-stroke-soft mb-4">
            <div>
              <h3 className="text-sm font-bold text-fg-primary">
                2. Principales Destinatarios de Pagos (Top 10)
              </h3>
              <p className="text-xs text-fg-muted">Proveedores, acreedores y beneficiarios con mayor desembolso real</p>
            </div>
            <span className="text-[11px] font-bold text-tops-blue-700 dark:text-blue-400 bg-tops-blue-700/10 dark:bg-blue-950/60 px-2 py-0.5 rounded">
              Top 10
            </span>
          </div>

          <div className="space-y-3">
            {metrics.topPayees.length === 0 ? (
              <div className="py-12 text-center text-fg-muted space-y-2">
                <div className="w-10 h-10 rounded-full bg-bg-surface-alt flex items-center justify-center text-fg-muted mx-auto">
                  <Icon name="truck" className="w-5 h-5" />
                </div>
                <div className="text-xs font-bold text-fg-primary">Sin destinatarios de pago registrados</div>
                <p className="text-[11px] text-fg-muted max-w-xs mx-auto">
                  Los pagos efectuados o facturas a proveedores imputadas aparecerán ordenados por volumen.
                </p>
              </div>
            ) : (
              metrics.topPayees.slice(0, 7).map((payee) => {
                const maxPayee = metrics.topPayees[0]?.amount || 1;
                const barWidth = Math.min(100, Math.max(6, Math.round((payee.amount / maxPayee) * 100)));

                return (
                  <div key={payee.payee} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-fg-primary truncate max-w-[200px]">{payee.payee}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-fg-muted text-[10px]">{payee.sharePercentage}% del total</span>
                        <span className="font-bold text-fg-primary">{formatMoney(payee.amount)}</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-bg-surface-alt rounded-full overflow-hidden">
                      <div
                        className="h-full bg-tops-blue-700 dark:bg-blue-500 rounded-full transition-all duration-300"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 3. Comparativa Mensual: Ingresos vs Egresos (3, 6, 12 Meses) */}
      <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs p-5 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stroke-soft mb-4">
          <div>
            <h3 className="text-sm font-bold text-fg-primary">
              3. Ingresos vs Egresos — Comparativa Histórica
            </h3>
            <p className="text-xs text-fg-muted">Evolución mensual de facturación real, costos y resultado neto operativo</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-3 text-xs mr-2">
              <span className="flex items-center gap-1 text-fg-secondary">
                <span className="w-2.5 h-2.5 rounded-full bg-status-success"></span> Ingresos
              </span>
              <span className="flex items-center gap-1 text-fg-secondary">
                <span className="w-2.5 h-2.5 rounded-full bg-tops-red"></span> Egresos
              </span>
              <span className="flex items-center gap-1 text-fg-secondary">
                <span className="w-2.5 h-2.5 rounded-full bg-tops-blue-700 dark:bg-blue-400"></span> Neto
              </span>
            </div>

            <div className="inline-flex rounded-lg border border-stroke-soft bg-bg-surface-alt p-0.5 text-xs font-bold">
              {[3, 6, 12].map((limit) => (
                <button
                  key={limit}
                  type="button"
                  onClick={() => setMonthlyPeriodLimit(limit as any)}
                  className={`px-2.5 py-1 rounded transition-all ${
                    monthlyPeriodLimit === limit
                      ? "bg-bg-surface text-fg-primary shadow-2xs font-bold"
                      : "text-fg-muted hover:text-fg-primary"
                  }`}
                >
                  {limit} Meses
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Gráfico de Columnas Comparativas o Empty State */}
        {!hasMonthlyData ? (
          <div className="py-12 text-center text-fg-muted space-y-2">
            <div className="w-10 h-10 rounded-full bg-bg-surface-alt flex items-center justify-center text-fg-muted mx-auto">
              <Icon name="calendar" className="w-5 h-5" />
            </div>
            <div className="text-xs font-bold text-fg-primary">Sin transacciones registradas en los últimos 12 meses</div>
            <p className="text-[11px] text-fg-muted max-w-sm mx-auto">
              Las cobranzas y pagos registrados en el sistema alimentarán la serie histórica mes a mes.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2 pt-2 items-end min-h-[180px]">
            {visibleMonthly.map((m) => {
              const incHeight = maxMonthlyVal > 0 ? Math.max(m.income > 0 ? 8 : 2, Math.round((m.income / maxMonthlyVal) * 120)) : 2;
              const expHeight = maxMonthlyVal > 0 ? Math.max(m.expense > 0 ? 8 : 2, Math.round((m.expense / maxMonthlyVal) * 120)) : 2;

              return (
                <div key={m.period} className="flex flex-col items-center gap-1.5 group">
                  <div className="text-[10px] font-bold text-fg-muted">{m.label}</div>
                  <div className="flex items-end gap-1 h-[120px] w-full justify-center">
                    {/* Barra Ingreso */}
                    <div
                      title={`Ingresos: ${formatMoney(m.income)}`}
                      style={{ height: `${incHeight}px` }}
                      className="w-3 sm:w-4 bg-status-success rounded-t-sm transition-all group-hover:opacity-80"
                    />
                    {/* Barra Egreso */}
                    <div
                      title={`Egresos: ${formatMoney(m.expense)}`}
                      style={{ height: `${expHeight}px` }}
                      className="w-3 sm:w-4 bg-tops-red rounded-t-sm transition-all group-hover:opacity-80"
                    />
                  </div>
                  {/* Resultado Neto */}
                  <span className={`text-[9px] font-bold tabular-nums px-1 rounded ${
                    m.net > 0 ? "text-status-success bg-emerald-50 dark:bg-emerald-950/60" : m.net < 0 ? "text-tops-red bg-rose-50 dark:bg-rose-950/60" : "text-fg-muted bg-bg-surface-alt"
                  }`}>
                    {m.net > 0 ? "+" : ""}{(m.net / 1000000).toFixed(1)}M
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Presupuesto vs Real & Próximos Vencimientos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Presupuesto vs Real */}
        <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs p-5 transition-colors space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-stroke-soft">
            <div>
              <h3 className="text-sm font-bold text-fg-primary">
                4. Presupuesto vs Real
              </h3>
              <p className="text-xs text-fg-muted">Cumplimiento presupuestario sobre líneas reales</p>
            </div>
            {metrics.budgetVsReal.hasBudgetConfigured ? (
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                metrics.budgetVsReal.netSurplus >= 0
                  ? "bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400"
                  : "bg-rose-50 text-tops-red dark:bg-rose-950/60 dark:text-rose-400"
              }`}>
                {metrics.budgetVsReal.netSurplus >= 0 ? "✓ Superávit Presupuestario" : "⚠️ Exceso de Costos"}
              </span>
            ) : (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-bg-surface-alt text-fg-muted border border-stroke-soft">
                Sin Presupuesto Activo
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-3.5 bg-bg-surface-alt/60 rounded-xl border border-stroke-soft">
              <span className="text-[10px] uppercase font-bold text-fg-muted block mb-1">Ingresos Reales vs Presupuesto</span>
              <div className="text-base font-bold text-fg-primary">{formatMoney(metrics.budgetVsReal.actualIncome)}</div>
              <div className="text-xs text-fg-muted mt-1">
                Presupuestado: {metrics.budgetVsReal.hasBudgetConfigured ? formatMoney(metrics.budgetVsReal.budgetedIncome) : "No asignado"}
              </div>
              {metrics.budgetVsReal.hasBudgetConfigured && (
                <div className={`text-xs font-bold mt-2 ${metrics.budgetVsReal.incomeVariance >= 0 ? "text-status-success" : "text-tops-red"}`}>
                  {metrics.budgetVsReal.incomeVariance >= 0 ? "+" : ""}{formatMoney(metrics.budgetVsReal.incomeVariance)} de desvío
                </div>
              )}
            </div>

            <div className="p-3.5 bg-bg-surface-alt/60 rounded-xl border border-stroke-soft">
              <span className="text-[10px] uppercase font-bold text-fg-muted block mb-1">Gastos Reales vs Presupuesto</span>
              <div className="text-base font-bold text-fg-primary">{formatMoney(metrics.budgetVsReal.actualExpense)}</div>
              <div className="text-xs text-fg-muted mt-1">
                Presupuestado: {metrics.budgetVsReal.hasBudgetConfigured ? formatMoney(metrics.budgetVsReal.budgetedExpense) : "No asignado"}
              </div>
              {metrics.budgetVsReal.hasBudgetConfigured && (
                <div className={`text-xs font-bold mt-2 ${metrics.budgetVsReal.expenseVariance <= 0 ? "text-status-success" : "text-tops-red"}`}>
                  {metrics.budgetVsReal.expenseVariance >= 0 ? "+" : ""}{formatMoney(metrics.budgetVsReal.expenseVariance)} vs plan
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Próximos Vencimientos (7, 15, 30 Días) */}
        <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs p-5 transition-colors space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-stroke-soft">
            <div>
              <h3 className="text-sm font-bold text-fg-primary">
                6. Próximos Vencimientos y Compromisos
              </h3>
              <p className="text-xs text-fg-muted">Cuentas por pagar vs cobrar en ventanas de 7, 15 y 30 días</p>
            </div>
            <span className="text-xs font-bold text-tops-blue-700 dark:text-blue-400 bg-tops-blue-700/10 dark:bg-blue-950/60 px-2 py-0.5 rounded">
              Outlook Financiero
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Próximos 7 Días", data: metrics.upcomingMaturities.days7 },
              { label: "Próximos 15 Días", data: metrics.upcomingMaturities.days15 },
              { label: "Próximos 30 Días", data: metrics.upcomingMaturities.days30 },
            ].map((v) => (
              <div key={v.label} className="p-3 bg-bg-surface-alt/60 rounded-xl border border-stroke-soft text-center">
                <span className="text-[10px] font-bold text-fg-muted uppercase block mb-1">{v.label}</span>
                <div className="text-xs font-semibold text-tops-red mb-0.5">
                  Pagos: {formatMoney(v.data.payables)}
                </div>
                <div className="text-xs font-semibold text-status-success mb-2">
                  Cobros: {formatMoney(v.data.receivables)}
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  v.data.net > 0 ? "bg-emerald-50 text-status-success dark:bg-emerald-950/60" : v.data.net < 0 ? "bg-rose-50 text-tops-red dark:bg-rose-950/60" : "bg-bg-surface text-fg-muted"
                }`}>
                  Neto: {formatMoney(v.data.net)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. Alertas Materiales y Agenda de Decisiones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alertas Materiales */}
        <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors">
          <div className="px-6 py-4 border-b border-stroke-soft bg-bg-surface-alt flex items-center justify-between">
            <h2 className="text-sm font-bold text-fg-primary flex items-center gap-2">
              <Icon name="bell" className="w-4 h-4 text-tops-red" /> Alertas Financieras Reales
            </h2>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              alerts.length > 0
                ? "bg-rose-50 text-tops-red dark:bg-rose-950/60 dark:text-rose-400"
                : "bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400"
            }`}>
              {alerts.length > 0 ? `${alerts.length} activas` : "0 activas"}
            </span>
          </div>

          <div className="divide-y divide-stroke-soft p-2">
            {alerts.length === 0 ? (
              <div className="py-8 text-center text-fg-muted text-xs flex flex-col items-center justify-center gap-1">
                <Icon name="check-circle" className="w-5 h-5 text-status-success mb-1" />
                <span className="font-bold text-fg-primary">Sin alertas financieras activas</span>
                <span className="text-[11px] text-fg-muted">Todas las posiciones y compromisos operan dentro de los parámetros normales.</span>
              </div>
            ) : (
              alerts.map((alert) => {
                let alertBorder = "border-l-4 border-l-tops-red";
                if (alert.type === "warning") alertBorder = "border-l-4 border-l-amber-500";
                if (alert.type === "info") alertBorder = "border-l-4 border-l-tops-blue-700";

                return (
                  <div key={alert.id} className={`p-3.5 my-1 bg-bg-surface-alt/50 rounded-lg ${alertBorder}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-fg-primary">{alert.title}</h4>
                        <p className="text-xs text-fg-muted mt-0.5">{alert.detail}</p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Agenda de Decisiones y Minutas */}
        <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors">
          <div className="px-6 py-4 border-b border-stroke-soft bg-bg-surface-alt flex items-center justify-between">
            <h2 className="text-sm font-bold text-fg-primary flex items-center gap-2">
              <Icon name="check" className="w-4 h-4 text-tops-blue-700 dark:text-blue-400" /> Agenda de Decisiones y Acuerdos
            </h2>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-tops-blue-700/10 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
              {decisions.length} pendientes
            </span>
          </div>

          <div className="divide-y divide-stroke-soft">
            {decisions.length === 0 ? (
              <div className="py-8 text-center text-fg-muted text-xs flex flex-col items-center justify-center gap-1">
                <Icon name="check" className="w-5 h-5 text-tops-blue-700 dark:text-blue-400 mb-1" />
                <span className="font-bold text-fg-primary">Sin decisiones pendientes registradas</span>
                <span className="text-[11px] text-fg-muted">Las minutas y acuerdos formalizados en gobernanza aparecerán en esta sección.</span>
              </div>
            ) : (
              decisions.map((dec) => (
                <div key={dec.id} className="p-4 hover:bg-bg-surface-alt/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-bold text-fg-primary">{dec.title}</span>
                      <div className="flex items-center gap-3 text-[11px] text-fg-muted mt-1 flex-wrap">
                        <span>Impacto: {dec.impact}</span>
                        <span>•</span>
                        <span>Vencimiento: {dec.deadline}</span>
                        <span>•</span>
                        <span>Responsable: {dec.owner}</span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-tops-blue-700/10 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400 uppercase">
                      {dec.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
