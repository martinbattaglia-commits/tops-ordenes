"use client";

import React, { useState } from "react";
import type { FinanceUnifiedTransaction, FinanceCurrency } from "@/lib/finanzas/types";
import { calculateDailyRollingBalances } from "@/lib/finanzas/engine";
import { fmtCurrency } from "@/lib/utils";
import type { AccountFilterScope } from "./FinanzasHeader";
import { Icon } from "@/components/Icon";

interface CalendarViewProps {
  currentDate?: string;
  currency: FinanceCurrency;
  transactions: FinanceUnifiedTransaction[];
  initialBalance?: number;
  accountScope?: AccountFilterScope;
  onSelectTransaction?: (tx: FinanceUnifiedTransaction) => void;
  onDayClick?: (dateStr: string) => void;
  onDeepLinkToTransaction?: (txId: string) => void;
}

export function CalendarView({
  currentDate = new Date().toISOString().slice(0, 10),
  currency,
  transactions,
  initialBalance = 15400000,
  accountScope = "both_banks",
  onSelectTransaction,
  onDayClick,
  onDeepLinkToTransaction,
}: CalendarViewProps) {
  const [selectedDayDetail, setSelectedDayDetail] = useState<string | null>(null);

  const [year, month] = currentDate.split("-").map(Number);
  const currentMonthIdx = month - 1; // 0-indexed

  // Primer día de la semana (0: domingo, 1: lunes, ...) -> convertir a lunes=0
  const firstDayOfMonth = new Date(year, currentMonthIdx, 1);
  const startingDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7;

  // Cálculo diario acumulativo según la fórmula de Dirección
  const dailyBalances = calculateDailyRollingBalances(
    year,
    currentMonthIdx,
    initialBalance,
    transactions,
    accountScope === "all" ? "all" : accountScope
  );

  const dailyMap = new Map(dailyBalances.map((b) => [b.date, b]));
  const blanksArray = Array.from({ length: startingDayOfWeek }, (_, i) => i);

  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  const formatMoney = (val: number) => {
    return currency === "ARS"
      ? fmtCurrency(val)
      : `U$S ${val.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors">
      {/* Header del Calendario */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-stroke-soft bg-bg-surface-alt/80">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-fg-primary">
            {monthNames[currentMonthIdx]} {year}
          </h2>
          <span className="text-xs px-2.5 py-0.5 font-bold rounded-full bg-tops-blue-700/10 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
            Calendario de Flujo ({currency})
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs text-fg-muted font-medium">
          <div className="flex items-center gap-1.5 mr-3">
            <span className="w-2.5 h-2.5 rounded-full bg-status-success"></span>
            <span className="text-fg-secondary">Ingresos / Cobranzas</span>
          </div>
          <div className="flex items-center gap-1.5 mr-3">
            <span className="w-2.5 h-2.5 rounded-full bg-tops-red"></span>
            <span className="text-fg-secondary">Egresos / Pagos</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#214576] dark:bg-blue-400"></span>
            <span className="font-semibold text-tops-blue-700 dark:text-blue-400">Saldo Proyectado Cierre</span>
          </div>
        </div>
      </div>

      {/* Grilla de Cabecera Días de la Semana */}
      <div className="grid grid-cols-7 border-b border-stroke-soft bg-bg-surface text-center text-xs font-bold text-fg-muted">
        {dayNames.map((d) => (
          <div key={d} className="py-2.5 border-r border-stroke-soft last:border-r-0">
            {d}
          </div>
        ))}
      </div>

      {/* Grilla Principal de Días */}
      <div className="grid grid-cols-7 auto-rows-fr bg-stroke-soft gap-[1px]">
        {/* Espacios vacíos antes del día 1 */}
        {blanksArray.map((_, i) => (
          <div key={`blank-${i}`} className="min-h-[140px] bg-bg-surface-alt/40 p-2 opacity-40" />
        ))}

        {/* Celdas de Días del Mes */}
        {dailyBalances.map((dayBal) => {
          const dateStr = dayBal.date;
          const isSelected = selectedDayDetail === dateStr;
          const dayTxs = dayBal.transactions;

          return (
            <div
              key={dayBal.day}
              onClick={() => {
                setSelectedDayDetail(isSelected ? null : dateStr);
                onDayClick?.(dateStr);
              }}
              className={`min-h-[140px] p-2 transition-all cursor-pointer bg-bg-surface hover:bg-bg-surface-alt/60 flex flex-col justify-between ${
                isSelected
                  ? "ring-2 ring-inset ring-tops-blue-700 dark:ring-blue-400 bg-bg-surface-alt"
                  : ""
              }`}
            >
              <div>
                {/* Cabecera del Día */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-xs font-bold ${dayBal.hasMovements ? "text-fg-primary" : "text-fg-muted"}`}>
                    {dayBal.day}
                  </span>
                  {dayBal.hasMovements && (
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-tops-blue-700/10 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
                      {dayTxs.length}
                    </span>
                  )}
                </div>

                {/* Badges de Movimientos del Día (con Deep Link) */}
                <div className="space-y-1">
                  {dayTxs.slice(0, 3).map((tx) => {
                    let badgeClass = "bg-emerald-50 text-status-success border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/40";
                    if (tx.direction === "egreso") {
                      badgeClass = "bg-rose-50 text-tops-red border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/40";
                    } else if (tx.direction === "transferencia") {
                      badgeClass = "bg-blue-50 text-tops-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/40";
                    }

                    return (
                      <div
                        key={tx.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTransaction?.(tx);
                          onDeepLinkToTransaction?.(tx.id);
                        }}
                        className={`text-[10px] truncate px-1.5 py-0.5 rounded border ${badgeClass} font-semibold transition-transform hover:scale-[1.02] cursor-pointer`}
                        title={`${tx.concept} - ${formatMoney(tx.amount)} (Click para ver en Transacciones)`}
                      >
                        {tx.direction === "ingreso" ? "+" : tx.direction === "egreso" ? "-" : "⇄"} {formatMoney(tx.amount)} {tx.concept}
                      </div>
                    );
                  })}

                  {dayTxs.length > 3 && (
                    <div className="text-[10px] text-fg-muted font-bold text-center">
                      +{dayTxs.length - 3} más
                    </div>
                  )}
                </div>
              </div>

              {/* Pie de Casillero Diario: Totales del Día & Saldo Proyectado Acumulativo */}
              <div className="mt-2 pt-1 border-t border-stroke-soft/60 space-y-0.5">
                {/* Totales de movimientos diarios si existen */}
                {(dayBal.inflows > 0 || dayBal.outflows > 0) && (
                  <div className="flex justify-between text-[9px] font-bold">
                    {dayBal.inflows > 0 ? (
                      <span className="text-status-success">+{formatMoney(dayBal.inflows)}</span>
                    ) : <span></span>}
                    {dayBal.outflows > 0 ? (
                      <span className="text-tops-red">-{formatMoney(dayBal.outflows)}</span>
                    ) : <span></span>}
                  </div>
                )}

                {/* Saldo Proyectado Acumulativo de Cierre Diario en Azul (Abajo a la Derecha) */}
                <div className="text-right">
                  <span className="text-[10px] font-bold text-tops-blue-700 dark:text-blue-400 tabular-nums">
                    {formatMoney(dayBal.projectedClosingBalance)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Panel de detalle del día seleccionado con Deep Links */}
      {selectedDayDetail && (
        <div className="p-5 bg-bg-surface-alt border-t border-stroke-soft transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-fg-primary">
                Movimientos del {selectedDayDetail}
              </h3>
              {dailyMap.get(selectedDayDetail) && (
                <span className="text-xs font-bold text-tops-blue-700 dark:text-blue-400 bg-tops-blue-700/10 dark:bg-blue-950/60 px-2 py-0.5 rounded">
                  Saldo Proyectado Cierre: {formatMoney(dailyMap.get(selectedDayDetail)!.projectedClosingBalance)}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedDayDetail(null)}
              className="text-xs font-semibold text-fg-muted hover:text-fg-primary transition-colors"
            >
              ✕ Cerrar detalle
            </button>
          </div>

          <div className="space-y-2">
            {(dailyMap.get(selectedDayDetail)?.transactions || []).length === 0 ? (
              <div className="p-4 bg-bg-surface rounded-lg border border-stroke-soft text-center text-xs text-fg-muted">
                Sin movimientos registrados en este día. Saldo acumulado anterior preservado.
              </div>
            ) : (
              dailyMap.get(selectedDayDetail)!.transactions.map((tx) => (
                <div
                  key={tx.id}
                  onClick={() => {
                    onSelectTransaction?.(tx);
                    onDeepLinkToTransaction?.(tx.id);
                  }}
                  className="flex items-center justify-between p-3.5 bg-bg-surface rounded-lg border border-stroke-soft hover:border-tops-blue-700 dark:hover:border-blue-400 cursor-pointer transition-all shadow-2xs group"
                >
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        tx.direction === "ingreso" ? "bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400" :
                        tx.direction === "egreso" ? "bg-rose-50 text-tops-red dark:bg-rose-950/60 dark:text-rose-400" :
                        "bg-blue-50 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400"
                      }`}>
                        {tx.direction}
                      </span>
                      <span className="text-xs font-bold text-fg-primary group-hover:text-tops-blue-700 dark:group-hover:text-blue-400 transition-colors">
                        {tx.concept}
                      </span>
                      {tx.counterpart && (
                        <span className="text-xs text-fg-muted">· {tx.counterpart}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-fg-muted mt-1 flex items-center gap-2 flex-wrap">
                      <span>Cuenta: <strong className="text-fg-secondary">{tx.accountName}</strong></span>
                      <span>·</span>
                      <span>Categoría: <strong className="text-fg-secondary">{tx.categoryName}</strong></span>
                      <span>·</span>
                      <span className="text-[10px] uppercase px-1.5 py-0.2 rounded bg-bg-surface-alt text-fg-secondary">
                        {tx.isReal ? "Hecho Tesorería" : "Proyección Finanzas"}
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className={`text-sm font-bold tabular-nums ${
                      tx.direction === "ingreso" ? "text-status-success" : "text-tops-red"
                    }`}>
                      {tx.direction === "ingreso" ? "+" : "-"}{formatMoney(tx.amount)}
                    </div>
                    <div className="text-[10px] text-tops-blue-700 dark:text-blue-400 font-semibold group-hover:underline flex items-center justify-end gap-1 mt-0.5">
                      <span>Ir a Transacción</span>
                      <Icon name="chevron-right" className="w-3 h-3" />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
