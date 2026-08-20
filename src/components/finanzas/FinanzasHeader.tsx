"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import type { FinanceCurrency } from "@/lib/finanzas/types";

interface FinanzasHeaderProps {
  title: string;
  subtitle: string;
  currentCurrency: FinanceCurrency;
  onCurrencyChange: (c: FinanceCurrency) => void;
  onNewMovementClick?: () => void;
  selectedDate?: string;
  onDateChange?: (d: string) => void;
  versionLabel?: string;
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
}: FinanzasHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#DDE2EB]">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-[#214576] bg-[#E9EEF5] rounded">
            NEXUS FINANZAS
          </span>
          <span className="px-2 py-0.5 text-xs font-medium text-[#687087] bg-white border border-[#DDE2EB] rounded">
            Versión: {versionLabel}
          </span>
        </div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#050555]">
          {title}
        </h1>
        <p className="text-sm text-[#687087] mt-0.5">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Moneda selector */}
        <div className="inline-flex rounded-lg border border-[#DDE2EB] bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => onCurrencyChange("ARS")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              currentCurrency === "ARS"
                ? "bg-[#050555] text-white shadow-xs"
                : "text-[#687087] hover:text-[#111331]"
            }`}
          >
            ARS ($)
          </button>
          <button
            type="button"
            onClick={() => onCurrencyChange("USD")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              currentCurrency === "USD"
                ? "bg-[#050555] text-white shadow-xs"
                : "text-[#687087] hover:text-[#111331]"
            }`}
          >
            USD (U$S)
          </button>
        </div>

        {/* Date Selector */}
        {selectedDate && onDateChange && (
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium border border-[#DDE2EB] bg-white rounded-lg text-[#111331] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#214576]"
          />
        )}

        {/* New Movement Button */}
        {onNewMovementClick && (
          <button
            type="button"
            onClick={onNewMovementClick}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C9070D] hover:bg-[#a41a20] rounded-lg shadow-sm transition-all focus:ring-2 focus:ring-offset-2 focus:ring-[#C9070D]"
          >
            <Icon name="plus" className="w-4 h-4" />
            <span>Nuevo Movimiento</span>
          </button>
        )}
      </div>
    </div>
  );
}
