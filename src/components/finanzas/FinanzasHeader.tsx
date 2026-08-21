"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import type { FinanceCurrency, AccountGroupPosition } from "@/lib/finanzas/types";
import { getBankBalancesSummary } from "@/lib/finanzas/engine";
import { fmtCurrency } from "@/lib/utils";

export type AccountFilterScope = "both_banks" | "galicia" | "santander" | "caja" | "banks_and_cash" | "all";

interface FinanzasHeaderProps {
  title: string;
  subtitle: string;
  currentCurrency: FinanceCurrency;
  onCurrencyChange: (c: FinanceCurrency) => void;
  onNewMovementClick?: () => void;
  selectedDate?: string;
  onDateChange?: (d: string) => void;
  versionLabel?: string;
  accountPositions?: AccountGroupPosition[];
  activeAccountScope?: AccountFilterScope;
  onAccountScopeChange?: (scope: AccountFilterScope) => void;
}

export function FinanzasHeader({
  title,
  subtitle,
  currentCurrency,
  onCurrencyChange,
  onNewMovementClick,
  selectedDate,
  onDateChange,
  versionLabel = "BUDGET-2026-V1",
  accountPositions = [],
  activeAccountScope = "both_banks",
  onAccountScopeChange,
}: FinanzasHeaderProps) {
  const bankSummary = getBankBalancesSummary(accountPositions, currentCurrency);

  const formatAmount = (amount: number) => {
    return currentCurrency === "ARS"
      ? fmtCurrency(amount)
      : `U$S ${amount.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-4 pb-6 border-b border-stroke-soft transition-colors duration-200">
      {/* Top row: Title, Subtitle, Currency and Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-tops-blue-700 bg-tops-blue-700/10 dark:text-blue-400 dark:bg-blue-950/50 rounded-md">
              NEXUS FINANZAS
            </span>
            <span className="px-2.5 py-0.5 text-[11px] font-medium text-fg-muted bg-bg-surface border border-stroke-soft rounded-md shadow-2xs">
              Versión: <strong className="text-fg-primary">{versionLabel}</strong>
            </span>
            <span className="px-2.5 py-0.5 text-[11px] font-semibold text-status-success bg-status-success/10 rounded-md flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse"></span> Hechos Reales Tesorería + Proyecciones
            </span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-fg-primary">
            {title}
          </h1>
          <p className="text-xs sm:text-sm text-fg-secondary mt-0.5">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Moneda selector */}
          <div className="inline-flex rounded-lg border border-stroke-soft bg-bg-surface p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => onCurrencyChange("ARS")}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                currentCurrency === "ARS"
                  ? "bg-tops-blue-900 dark:bg-tops-blue-700 text-white shadow-xs"
                  : "text-fg-secondary hover:text-fg-primary hover:bg-bg-surface-alt"
              }`}
            >
              ARS ($)
            </button>
            <button
              type="button"
              onClick={() => onCurrencyChange("USD")}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                currentCurrency === "USD"
                  ? "bg-tops-blue-900 dark:bg-tops-blue-700 text-white shadow-xs"
                  : "text-fg-secondary hover:text-fg-primary hover:bg-bg-surface-alt"
              }`}
            >
              USD (U$S)
            </button>
          </div>

          {/* Date Selector */}
          {selectedDate && onDateChange && (
            <div className="relative">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => onDateChange(e.target.value)}
                className="px-3 py-1.5 text-xs font-semibold border border-stroke-soft bg-bg-surface rounded-lg text-fg-primary shadow-2xs focus:outline-none focus:ring-2 focus:ring-tops-blue-700 dark:focus:ring-blue-400"
              />
            </div>
          )}

          {/* New Movement Button */}
          {onNewMovementClick && (
            <button
              type="button"
              onClick={onNewMovementClick}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-tops-red hover:bg-red-700 active:scale-[0.98] rounded-lg shadow-xs transition-all focus:ring-2 focus:ring-offset-2 focus:ring-tops-red"
            >
              <Icon name="plus" className="w-3.5 h-3.5" />
              <span>Nuevo Movimiento</span>
            </button>
          )}
        </div>
      </div>

      {/* Requirement D: Zona Superior de Saldos Bancarios con Visibilidad Individual y Consolidada */}
      {accountPositions.length > 0 && (
        <div className="bg-bg-surface rounded-xl border border-stroke-soft p-3.5 shadow-2xs space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Display de Saldos Bancarios Individuales y Total Consolidado */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
              {/* Banco Galicia */}
              <div
                onClick={() => onAccountScopeChange?.("galicia")}
                className={`p-3 rounded-lg border transition-all cursor-pointer ${
                  activeAccountScope === "galicia"
                    ? "border-tops-blue-700 bg-tops-blue-700/10 dark:border-blue-400 dark:bg-blue-950/40 ring-1 ring-tops-blue-700"
                    : "border-stroke-soft bg-bg-surface-alt/60 hover:bg-bg-surface-alt hover:border-stroke-strong"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-bold text-fg-secondary mb-1">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-orange-500"></span> Banco Galicia
                  </span>
                  <span className="text-[10px] text-fg-muted uppercase">CC</span>
                </div>
                <div className="text-base font-bold text-fg-primary tracking-tight">
                  {bankSummary.hasGaliciaAccount ? (
                    formatAmount(bankSummary.galiciaBalance)
                  ) : (
                    <span className="text-xs text-fg-muted font-normal italic">Saldo no disponible</span>
                  )}
                </div>
              </div>

              {/* Banco Santander */}
              <div
                onClick={() => onAccountScopeChange?.("santander")}
                className={`p-3 rounded-lg border transition-all cursor-pointer ${
                  activeAccountScope === "santander"
                    ? "border-tops-blue-700 bg-tops-blue-700/10 dark:border-blue-400 dark:bg-blue-950/40 ring-1 ring-tops-blue-700"
                    : "border-stroke-soft bg-bg-surface-alt/60 hover:bg-bg-surface-alt hover:border-stroke-strong"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-bold text-fg-secondary mb-1">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-600"></span> Banco Santander
                  </span>
                  <span className="text-[10px] text-fg-muted uppercase">CC</span>
                </div>
                <div className="text-base font-bold text-fg-primary tracking-tight">
                  {bankSummary.hasSantanderAccount ? (
                    formatAmount(bankSummary.santanderBalance)
                  ) : (
                    <span className="text-xs text-fg-muted font-normal italic">Saldo no disponible</span>
                  )}
                </div>
              </div>

              {/* Total Consolidado Bancos */}
              <div
                onClick={() => onAccountScopeChange?.("both_banks")}
                className={`p-3 rounded-lg border transition-all cursor-pointer ${
                  activeAccountScope === "both_banks"
                    ? "border-tops-blue-700 bg-tops-blue-700/10 dark:border-blue-400 dark:bg-blue-950/40 ring-1 ring-tops-blue-700"
                    : "border-stroke-soft bg-bg-surface-alt/60 hover:bg-bg-surface-alt hover:border-stroke-strong"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-bold text-tops-blue-700 dark:text-blue-400 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Icon name="building" className="w-3.5 h-3.5 text-tops-blue-700 dark:text-blue-400" />
                    Total Ambos Bancos
                  </span>
                  <span className="text-[10px] font-bold bg-tops-blue-700/15 dark:bg-blue-900/60 px-1.5 py-0.2 rounded text-tops-blue-700 dark:text-blue-300">
                    CONSOLIDADO
                  </span>
                </div>
                <div className="text-base font-bold text-fg-primary tracking-tight">
                  {formatAmount(bankSummary.bothBanksBalance)}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Scope Filter Chips */}
          {onAccountScopeChange && (
            <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-stroke-soft text-xs">
              <span className="text-[11px] font-semibold text-fg-muted mr-1">Filtro de Cuentas:</span>
              <button
                type="button"
                onClick={() => onAccountScopeChange("both_banks")}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                  activeAccountScope === "both_banks"
                    ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700"
                    : "bg-bg-surface-alt text-fg-secondary hover:text-fg-primary"
                }`}
              >
                Ambos Bancos
              </button>
              <button
                type="button"
                onClick={() => onAccountScopeChange("galicia")}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                  activeAccountScope === "galicia"
                    ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700"
                    : "bg-bg-surface-alt text-fg-secondary hover:text-fg-primary"
                }`}
              >
                Galicia
              </button>
              <button
                type="button"
                onClick={() => onAccountScopeChange("santander")}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                  activeAccountScope === "santander"
                    ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700"
                    : "bg-bg-surface-alt text-fg-secondary hover:text-fg-primary"
                }`}
              >
                Santander
              </button>
              <button
                type="button"
                onClick={() => onAccountScopeChange("caja")}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                  activeAccountScope === "caja"
                    ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700"
                    : "bg-bg-surface-alt text-fg-secondary hover:text-fg-primary"
                }`}
              >
                Caja ({formatAmount(bankSummary.cajaBalance)})
              </button>
              <button
                type="button"
                onClick={() => onAccountScopeChange("banks_and_cash")}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                  activeAccountScope === "banks_and_cash"
                    ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700"
                    : "bg-bg-surface-alt text-fg-secondary hover:text-fg-primary"
                }`}
              >
                Bancos + Caja ({formatAmount(bankSummary.banksAndCashBalance)})
              </button>
              <button
                type="button"
                onClick={() => onAccountScopeChange("all")}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                  activeAccountScope === "all"
                    ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700"
                    : "bg-bg-surface-alt text-fg-secondary hover:text-fg-primary"
                }`}
              >
                Todas las Cuentas ({formatAmount(bankSummary.totalBalance)})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
