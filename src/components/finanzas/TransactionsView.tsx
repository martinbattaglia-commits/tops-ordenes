"use client";

import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import type { FinanceUnifiedTransaction, FinanceCurrency, FinanceDirection } from "@/lib/finanzas/types";
import { fmtCurrency, fmtDate } from "@/lib/utils";

interface TransactionsViewProps {
  currency: FinanceCurrency;
  transactions: FinanceUnifiedTransaction[];
  onSelectTransaction?: (tx: FinanceUnifiedTransaction) => void;
}

export function TransactionsView({
  currency,
  transactions,
  onSelectTransaction,
}: TransactionsViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [natureFilter, setNatureFilter] = useState<string>("all"); // all, real, projected

  const filtered = transactions.filter((tx) => {
    if (directionFilter !== "all" && tx.direction !== directionFilter) return false;
    if (natureFilter === "real" && !tx.isReal) return false;
    if (natureFilter === "projected" && tx.isReal) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchConcept = tx.concept.toLowerCase().includes(q);
      const matchCounterpart = tx.counterpart?.toLowerCase().includes(q);
      const matchCategory = tx.categoryName.toLowerCase().includes(q);
      const matchAccount = tx.accountName.toLowerCase().includes(q);
      if (!matchConcept && !matchCounterpart && !matchCategory && !matchAccount) return false;
    }
    return true;
  });

  return (
    <div className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
      {/* Barra de Filtros y Búsqueda */}
      <div className="p-4 border-b border-[#DDE2EB] bg-[#F4F5F8] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Icon name="search" className="absolute left-3 top-2.5 w-4 h-4 text-[#687087]" />
            <input
              type="text"
              placeholder="Buscar por concepto, cliente, proveedor, categoría..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-[#DDE2EB] bg-white text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
            />
          </div>

          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-[#DDE2EB] bg-white text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
          >
            <option value="all">Todas las direcciones</option>
            <option value="ingreso">Solo Ingresos / Cobros</option>
            <option value="egreso">Solo Egresos / Pagos</option>
            <option value="transferencia">Solo Transferencias</option>
          </select>

          <select
            value={natureFilter}
            onChange={(e) => setNatureFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-[#DDE2EB] bg-white text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
          >
            <option value="all">Todos los orígenes</option>
            <option value="real">Hechos Reales (Tesorería)</option>
            <option value="projected">Proyecciones (Finanzas)</option>
          </select>
        </div>

        <div className="text-xs text-[#687087] font-medium">
          {filtered.length} transacciones
        </div>
      </div>

      {/* Tabla de Alta Densidad */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F4F5F8] text-[#687087] font-semibold border-b border-[#DDE2EB]">
            <tr>
              <th className="py-2.5 px-4">Fecha</th>
              <th className="py-2.5 px-3">Tipo</th>
              <th className="py-2.5 px-4">Concepto / Contraparte</th>
              <th className="py-2.5 px-3">Cuenta / Agrupador</th>
              <th className="py-2.5 px-3">Categoría</th>
              <th className="py-2.5 px-3">Naturaleza</th>
              <th className="py-2.5 px-4 text-right">Monto ({currency})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#DDE2EB]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[#687087]">
                  No se encontraron transacciones con los filtros aplicados.
                </td>
              </tr>
            ) : (
              filtered.map((tx) => {
                let dirColor = "text-[#137333]";
                if (tx.direction === "egreso") dirColor = "text-[#C9070D]";
                if (tx.direction === "transferencia") dirColor = "text-[#214576]";

                return (
                  <tr
                    key={tx.id}
                    onClick={() => onSelectTransaction?.(tx)}
                    className="hover:bg-[#F4F5F8] cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-[#111331]">
                      {fmtDate(tx.date)}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        tx.direction === "ingreso" ? "bg-[#E6F4EA] text-[#137333]" :
                        tx.direction === "egreso" ? "bg-[#FBE9EA] text-[#C9070D]" :
                        "bg-[#E9EEF5] text-[#214576]"
                      }`}>
                        {tx.direction}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#111331]">{tx.concept}</div>
                      {tx.counterpart && <div className="text-[11px] text-[#687087]">{tx.counterpart}</div>}
                    </td>
                    <td className="py-3 px-3 text-[#687087]">
                      <div className="font-medium text-[#111331]">{tx.accountName}</div>
                      <div className="text-[10px] uppercase">{tx.accountGroup}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#E9EEF5] text-[#214576]">
                        {tx.categoryName}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="text-[11px] font-semibold text-[#050555]">
                        {tx.isReal ? "Hecho Tesorería" : "Proyección Finanzas"}
                      </div>
                      <div className="text-[10px] text-[#687087] capitalize">{tx.status}</div>
                    </td>
                    <td className={`py-3 px-4 text-right font-bold text-sm tabular-nums ${dirColor}`}>
                      {tx.direction === "ingreso" ? "+" : tx.direction === "egreso" ? "-" : ""}
                      {fmtCurrency(tx.amount)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
