"use client";

import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import type { FinanceUnifiedTransaction, FinanceCurrency } from "@/lib/finanzas/types";
import { fmtCurrency } from "@/lib/utils";

interface CalendarViewProps {
  currentDate: string; // YYYY-MM-DD
  currency: FinanceCurrency;
  transactions: FinanceUnifiedTransaction[];
  onSelectTransaction?: (tx: FinanceUnifiedTransaction) => void;
  onDayClick?: (dateStr: string) => void;
}

export function CalendarView({
  currentDate,
  currency,
  transactions,
  onSelectTransaction,
  onDayClick,
}: CalendarViewProps) {
  const [selectedDayDetail, setSelectedDayDetail] = useState<string | null>(null);

  const baseDate = new Date(currentDate);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();

  // Primer día del mes y cantidad de días
  const firstDay = new Date(year, month, 1);
  const startingDayOfWeek = (firstDay.getDay() + 6) % 7; // Lunes = 0, Domingo = 6
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Indexar transacciones por fecha
  const txByDate = new Map<string, FinanceUnifiedTransaction[]>();
  for (const tx of transactions) {
    const list = txByDate.get(tx.date) || [];
    list.push(tx);
    txByDate.set(tx.date, list);
  }

  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanksArray = Array.from({ length: startingDayOfWeek }, (_, i) => i);

  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  return (
    <div className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
      {/* Header del Calendario */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#DDE2EB] bg-[#F4F5F8]">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-[#050555]">
            {monthNames[month]} {year}
          </h2>
          <span className="text-xs px-2 py-0.5 font-medium rounded-full bg-[#E9EEF5] text-[#214576]">
            Calendario de Flujo ({currency})
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[#687087] mr-4">
            <span className="w-2.5 h-2.5 rounded-full bg-[#137333]"></span> Cobro / Ingreso
            <span className="w-2.5 h-2.5 rounded-full bg-[#C9070D] ml-2"></span> Pago / Egreso
            <span className="w-2.5 h-2.5 rounded-full bg-[#214576] ml-2"></span> Transferencia
          </div>
        </div>
      </div>

      {/* Grilla de Días */}
      <div className="grid grid-cols-7 border-b border-[#DDE2EB] bg-white text-center text-xs font-semibold text-[#687087]">
        {dayNames.map((d) => (
          <div key={d} className="py-2.5 border-r border-[#DDE2EB] last:border-r-0">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-fr bg-[#DDE2EB] gap-[1px]">
        {/* Espacios vacíos antes del día 1 */}
        {blanksArray.map((_, i) => (
          <div key={`blank-${i}`} className="min-h-[100px] bg-[#F4F5F8]/50 p-2 opacity-50" />
        ))}

        {/* Celdas de días */}
        {daysArray.map((day) => {
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayTxs = txByDate.get(dateStr) || [];
          const dayInflows = dayTxs.filter((t) => t.direction === "ingreso").reduce((s, t) => s + t.amount, 0);
          const dayOutflows = dayTxs.filter((t) => t.direction === "egreso").reduce((s, t) => s + t.amount, 0);
          const hasTxs = dayTxs.length > 0;
          const isSelected = selectedDayDetail === dateStr;

          return (
            <div
              key={day}
              onClick={() => {
                setSelectedDayDetail(isSelected ? null : dateStr);
                onDayClick?.(dateStr);
              }}
              className={`min-h-[110px] p-2 transition-colors cursor-pointer bg-white hover:bg-[#F4F5F8] ${
                isSelected ? "ring-2 ring-inset ring-[#050555]" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-xs font-bold ${hasTxs ? "text-[#050555]" : "text-[#687087]"}`}>
                  {day}
                </span>
                {hasTxs && (
                  <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-[#E9EEF5] text-[#214576]">
                    {dayTxs.length}
                  </span>
                )}
              </div>

              {/* Badges de movimientos del día */}
              <div className="space-y-1">
                {dayTxs.slice(0, 3).map((tx) => {
                  let badgeColor = "bg-[#E6F4EA] text-[#137333] border-[#CEEAD6]";
                  if (tx.direction === "egreso") badgeColor = "bg-[#FBE9EA] text-[#C9070D] border-[#F0B0B4]";
                  if (tx.direction === "transferencia") badgeColor = "bg-[#E9EEF5] text-[#214576] border-[#AFBEE2]";

                  return (
                    <div
                      key={tx.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTransaction?.(tx);
                      }}
                      className={`text-[10px] truncate px-1.5 py-0.5 rounded border ${badgeColor} font-medium`}
                      title={`${tx.concept} - ${fmtCurrency(tx.amount)}`}
                    >
                      {tx.direction === "ingreso" ? "+" : tx.direction === "egreso" ? "-" : "⇄"} {fmtCurrency(tx.amount)} {tx.concept}
                    </div>
                  );
                })}

                {dayTxs.length > 3 && (
                  <div className="text-[10px] text-[#687087] font-medium text-center">
                    +{dayTxs.length - 3} más
                  </div>
                )}
              </div>

              {/* Totales diarios al pie */}
              {(dayInflows > 0 || dayOutflows > 0) && (
                <div className="mt-2 pt-1 border-t border-[#DDE2EB]/60 flex justify-between text-[9px] text-[#687087]">
                  {dayInflows > 0 && <span className="text-[#137333]">+{fmtCurrency(dayInflows)}</span>}
                  {dayOutflows > 0 && <span className="text-[#C9070D]">-{fmtCurrency(dayOutflows)}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Panel de detalle del día seleccionado */}
      {selectedDayDetail && (
        <div className="p-4 bg-[#F4F5F8] border-t border-[#DDE2EB]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-[#050555]">
              Movimientos del {selectedDayDetail}
            </h3>
            <button
              type="button"
              onClick={() => setSelectedDayDetail(null)}
              className="text-xs text-[#687087] hover:text-[#111331]"
            >
              Cerrar detalle
            </button>
          </div>

          <div className="space-y-2">
            {(txByDate.get(selectedDayDetail) || []).map((tx) => (
              <div
                key={tx.id}
                onClick={() => onSelectTransaction?.(tx)}
                className="flex items-center justify-between p-3 bg-white rounded-lg border border-[#DDE2EB] hover:border-[#214576] cursor-pointer"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      tx.direction === "ingreso" ? "bg-[#E6F4EA] text-[#137333]" :
                      tx.direction === "egreso" ? "bg-[#FBE9EA] text-[#C9070D]" :
                      "bg-[#E9EEF5] text-[#214576]"
                    }`}>
                      {tx.direction.toUpperCase()}
                    </span>
                    <span className="text-xs font-bold text-[#111331]">{tx.concept}</span>
                    {tx.counterpart && (
                      <span className="text-xs text-[#687087]">· {tx.counterpart}</span>
                    )}
                  </div>
                  <div className="text-xs text-[#687087] mt-1">
                    Cuenta: {tx.accountName} | Categoría: {tx.categoryName} | Estado: {tx.status}
                  </div>
                </div>

                <div className="text-right">
                  <div className={`text-sm font-bold ${
                    tx.direction === "ingreso" ? "text-[#137333]" : "text-[#C9070D]"
                  }`}>
                    {tx.direction === "ingreso" ? "+" : "-"}{fmtCurrency(tx.amount)}
                  </div>
                  <div className="text-[10px] text-[#687087] uppercase font-medium">
                    {tx.isReal ? "Hecho Tesorería" : "Proyección Finanzas"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
