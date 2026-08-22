"use client";

import React, { useState } from "react";
import type { FinanceUnifiedTransaction, FinanceCurrency } from "@/lib/finanzas/types";
import { calculateDailyRollingBalances, isProgrammedTransaction } from "@/lib/finanzas/engine";
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
  onMonthChange?: (year: number, month: number) => void;
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
  onMonthChange,
}: CalendarViewProps) {
  const [selectedDayDetail, setSelectedDayDetail] = useState<string | null>(null);

  const [yearStr, monthStr] = currentDate.split("-");
  const year = parseInt(yearStr, 10) || new Date().getFullYear();
  const month = parseInt(monthStr, 10) || new Date().getMonth() + 1;
  const currentMonthIdx = month - 1; // 0-indexed: 0 = Enero, 11 = Diciembre

  // Navegación de Meses
  const handlePrevMonth = () => {
    const prevMonthIdx = currentMonthIdx === 0 ? 11 : currentMonthIdx - 1;
    const prevYear = currentMonthIdx === 0 ? year - 1 : year;
    onMonthChange?.(prevYear, prevMonthIdx);
  };

  const handleNextMonth = () => {
    const nextMonthIdx = currentMonthIdx === 11 ? 0 : currentMonthIdx + 1;
    const nextYear = currentMonthIdx === 11 ? year + 1 : year;
    onMonthChange?.(nextYear, nextMonthIdx);
  };

  const handleCurrentMonth = () => {
    const now = new Date();
    onMonthChange?.(now.getFullYear(), now.getMonth());
  };

  // Primer día de la semana (0: domingo, 1: lunes, ...) -> convertir a lunes=0
  const firstDayOfMonth = new Date(year, currentMonthIdx, 1);
  const startingDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7;

  // Cálculo diario acumulativo según la fórmula canónica
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
      {/* Header del Calendario con Navegación Multimes */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-stroke-soft bg-bg-surface-alt/80">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 bg-bg-surface border border-stroke-soft rounded-lg p-1 shadow-2xs">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 hover:bg-bg-surface-alt rounded text-fg-secondary hover:text-fg-primary transition-colors"
              title="Mes Anterior"
            >
              <Icon name="arrow-left" className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleCurrentMonth}
              className="px-2.5 py-1 text-xs font-bold text-tops-blue-700 dark:text-blue-400 hover:bg-tops-blue-700/10 rounded transition-colors"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 hover:bg-bg-surface-alt rounded text-fg-secondary hover:text-fg-primary transition-colors"
              title="Mes Siguiente"
            >
              <Icon name="arrow-right" className="w-4 h-4" />
            </button>
          </div>

          <h2 className="text-base font-bold text-fg-primary tracking-tight">
            {monthNames[currentMonthIdx]} {year}
          </h2>
          <span className="text-xs px-2.5 py-0.5 font-bold rounded-full bg-tops-blue-700/10 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
            Calendario de Flujo ({currency})
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs text-fg-muted font-medium">
          <div className="flex items-center gap-1.5 mr-3">
            <span className="w-2.5 h-2.5 rounded-full bg-status-success"></span>
            <span className="text-fg-secondary">Ingresos (+)</span>
          </div>
          <div className="flex items-center gap-1.5 mr-3">
            <span className="w-2.5 h-2.5 rounded-full bg-tops-red"></span>
            <span className="text-fg-secondary">Egresos (-)</span>
          </div>
          <div className="flex items-center gap-1.5 mr-3">
            <Icon name="clock" className="w-3 h-3 text-amber-500 dark:text-amber-400" />
            <span className="text-amber-600 dark:text-amber-400 font-semibold">Programadas</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#214576] dark:bg-blue-400"></span>
            <span className="font-semibold text-tops-blue-700 dark:text-blue-400">Saldo Proyectado</span>
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
                  <span
                    className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      isSelected
                        ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700"
                        : "text-fg-secondary"
                    }`}
                  >
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
                    const isProgrammed = isProgrammedTransaction(tx);
                    let badgeClass = "";

                    if (isProgrammed) {
                      if (tx.direction === "egreso") {
                        badgeClass = "bg-rose-500/10 text-rose-700 border-dashed border-rose-400/80 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-700/80";
                      } else if (tx.direction === "transferencia") {
                        badgeClass = "bg-sky-500/10 text-sky-700 border-dashed border-sky-400/80 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-700/80";
                      } else {
                        badgeClass = "bg-emerald-500/10 text-emerald-700 border-dashed border-emerald-400/80 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-700/80";
                      }
                    } else {
                      if (tx.direction === "egreso") {
                        badgeClass = "bg-rose-50 text-tops-red border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/40";
                      } else if (tx.direction === "transferencia") {
                        badgeClass = "bg-blue-50 text-tops-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/40";
                      } else {
                        badgeClass = "bg-emerald-50 text-status-success border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/40";
                      }
                    }

                    return (
                      <div
                        key={tx.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTransaction?.(tx);
                          onDeepLinkToTransaction?.(tx.id);
                        }}
                        className={`text-[10px] truncate px-1.5 py-0.5 rounded border ${badgeClass} font-semibold transition-transform hover:scale-[1.02] cursor-pointer flex items-center gap-1`}
                        title={`${tx.concept} - ${formatMoney(tx.amount)} ${isProgrammed ? "(Programado)" : "(Asentado en Tesorería)"}`}
                      >
                        {isProgrammed && (
                          <Icon name="clock" className="w-2.5 h-2.5 shrink-0 text-amber-500 dark:text-amber-400" />
                        )}
                        <span className="truncate">
                          {tx.direction === "ingreso" ? "+" : tx.direction === "egreso" ? "-" : "⇄"} {formatMoney(tx.amount)} {tx.concept}
                        </span>
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

                {/* Saldo Proyectado Acumulativo de Cierre Diario */}
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
              dailyMap.get(selectedDayDetail)!.transactions.map((tx) => {
                const isProgrammed = isProgrammedTransaction(tx);
                return (
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
                      <span className={`text-[10px] uppercase px-2 py-0.5 rounded font-bold inline-flex items-center gap-1 ${
                        isProgrammed
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-400/30"
                          : "bg-bg-surface-alt text-fg-secondary"
                      }`}>
                        {isProgrammed && <Icon name="clock" className="w-2.5 h-2.5" />}
                        {isProgrammed ? `Previsión (${tx.status})` : "Hecho Tesorería (Asentado)"}
                      </span>
                      {tx.desvio && tx.desvio.varianceAmount != null && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 font-semibold">
                          Desvío: {tx.desvio.varianceAmount >= 0 ? "+" : ""}{formatMoney(tx.desvio.varianceAmount)} ({tx.desvio.varianceDays ?? 0} días)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className={`text-sm font-bold tabular-nums flex items-center justify-end gap-1 ${
                      isProgrammed
                        ? "text-amber-600 dark:text-amber-400"
                        : tx.direction === "ingreso"
                        ? "text-status-success"
                        : "text-tops-red"
                    }`}>
                      {isProgrammed && <Icon name="clock" className="w-3.5 h-3.5 text-amber-500" />}
                      <span>{tx.direction === "ingreso" ? "+" : "-"}{formatMoney(tx.amount)}</span>
                    </div>
                    <div className="text-[10px] text-tops-blue-700 dark:text-blue-400 font-semibold group-hover:underline flex items-center justify-end gap-1 mt-0.5">
                      <span>Ir a Transacción</span>
                      <Icon name="chevron-right" className="w-3 h-3" />
                    </div>
                  </div>
                </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
