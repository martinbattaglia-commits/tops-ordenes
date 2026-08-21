"use client";

import React, { useState, useEffect } from "react";
import { Icon } from "@/components/Icon";
import type { FinanceUnifiedTransaction, FinanceCurrency } from "@/lib/finanzas/types";
import { fmtCurrency, fmtDate } from "@/lib/utils";

interface TransactionsViewProps {
  currency: FinanceCurrency;
  transactions: FinanceUnifiedTransaction[];
  highlightedTxId?: string | null;
  onSelectTransaction?: (tx: FinanceUnifiedTransaction) => void;
}

export function TransactionsView({
  currency,
  transactions,
  highlightedTxId,
  onSelectTransaction,
}: TransactionsViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [natureFilter, setNatureFilter] = useState<string>("all"); // all, real, projected

  // Auto-scroll to highlighted transaction if provided
  useEffect(() => {
    if (highlightedTxId) {
      const el = document.getElementById(`tx-row-${highlightedTxId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [highlightedTxId]);

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
    <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors">
      {/* Barra de Filtros y Búsqueda */}
      <div className="p-4 border-b border-stroke-soft bg-bg-surface-alt flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Icon name="search" className="absolute left-3 top-2.5 w-4 h-4 text-fg-muted" />
            <input
              type="text"
              placeholder="Buscar por concepto, cliente, proveedor, rubro..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-stroke-soft bg-bg-surface text-fg-primary focus:outline-none focus:ring-2 focus:ring-tops-blue-700 dark:focus:ring-blue-400 placeholder:text-fg-muted"
            />
          </div>

          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stroke-soft bg-bg-surface text-fg-primary focus:outline-none focus:ring-2 focus:ring-tops-blue-700 dark:focus:ring-blue-400"
          >
            <option value="all">Todas las direcciones</option>
            <option value="ingreso">Solo Ingresos / Cobros</option>
            <option value="egreso">Solo Egresos / Pagos</option>
            <option value="transferencia">Solo Transferencias</option>
          </select>

          <select
            value={natureFilter}
            onChange={(e) => setNatureFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stroke-soft bg-bg-surface text-fg-primary focus:outline-none focus:ring-2 focus:ring-tops-blue-700 dark:focus:ring-blue-400"
          >
            <option value="all">Todos los orígenes</option>
            <option value="real">Hechos Reales (Tesorería)</option>
            <option value="projected">Proyecciones (Finanzas)</option>
          </select>
        </div>

        <div className="text-xs text-fg-muted font-semibold">
          {filtered.length} transacciones
        </div>
      </div>

      {/* Banner si hay deep link activo */}
      {highlightedTxId && (
        <div className="px-4 py-2 bg-tops-blue-700/10 dark:bg-blue-950/60 border-b border-tops-blue-700/20 text-xs font-bold text-tops-blue-700 dark:text-blue-400 flex items-center justify-between">
          <span>🎯 Movimiento seleccionado desde el Calendario Financiero</span>
          <span className="text-[11px] font-mono">{highlightedTxId}</span>
        </div>
      )}

      {/* Tabla de Alta Densidad */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-bg-surface-alt text-fg-muted font-bold border-b border-stroke-soft uppercase tracking-wider text-[10px]">
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
          <tbody className="divide-y divide-stroke-soft">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-fg-muted">
                  No se encontraron transacciones con los filtros aplicados.
                </td>
              </tr>
            ) : (
              filtered.map((tx) => {
                let dirColor = "text-status-success";
                if (tx.direction === "egreso") dirColor = "text-tops-red";
                if (tx.direction === "transferencia") dirColor = "text-tops-blue-700 dark:text-blue-400";

                const isHighlighted = highlightedTxId === tx.id;

                return (
                  <tr
                    id={`tx-row-${tx.id}`}
                    key={tx.id}
                    onClick={() => onSelectTransaction?.(tx)}
                    className={`cursor-pointer transition-all ${
                      isHighlighted
                        ? "bg-tops-blue-700/15 dark:bg-blue-950/70 ring-2 ring-inset ring-tops-blue-700 font-bold"
                        : "hover:bg-bg-surface-alt"
                    }`}
                  >
                    <td className="py-3 px-4 font-semibold text-fg-primary whitespace-nowrap">
                      {fmtDate(tx.date)}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        tx.direction === "ingreso" ? "bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400" :
                        tx.direction === "egreso" ? "bg-rose-50 text-tops-red dark:bg-rose-950/60 dark:text-rose-400" :
                        "bg-blue-50 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400"
                      }`}>
                        {tx.direction}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-fg-primary">{tx.concept}</div>
                      {tx.counterpart && <div className="text-[11px] text-fg-muted">{tx.counterpart}</div>}
                    </td>
                    <td className="py-3 px-3 text-fg-muted">
                      <div className="font-semibold text-fg-primary">{tx.accountName}</div>
                      <div className="text-[10px] uppercase font-mono">{tx.accountGroup}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-tops-blue-700/10 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
                        {tx.categoryName}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="text-[11px] font-bold text-fg-primary">
                        {tx.isReal ? "Hecho Tesorería" : "Proyección Finanzas"}
                      </div>
                      <div className="text-[10px] text-fg-muted capitalize">{tx.status}</div>
                    </td>
                    <td className={`py-3 px-4 text-right font-bold text-sm tabular-nums ${dirColor}`}>
                      {tx.direction === "ingreso" ? "+" : tx.direction === "egreso" ? "-" : ""}
                      {currency === "ARS" ? fmtCurrency(tx.amount) : `U$S ${tx.amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`}
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
