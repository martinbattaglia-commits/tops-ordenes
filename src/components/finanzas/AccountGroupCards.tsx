"use client";

import React from "react";
import { Icon, type IconName } from "@/components/Icon";
import type { AccountGroupPosition, FinanceCurrency, FinanceAccountGroup } from "@/lib/finanzas/types";
import { fmtCurrency } from "@/lib/utils";

interface AccountGroupCardsProps {
  groups: AccountGroupPosition[];
  currency: FinanceCurrency;
  selectedGroup?: FinanceAccountGroup | null;
  onSelectGroup?: (g: FinanceAccountGroup | null) => void;
}

const GROUP_ICONS: Record<FinanceAccountGroup, IconName> = {
  bancos: "building",
  caja: "wallet",
  ahorros: "trend-up",
  tarjetas: "bill",
};

export function AccountGroupCards({
  groups,
  currency,
  selectedGroup,
  onSelectGroup,
}: AccountGroupCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {groups.map((grp) => {
        const balance = currency === "ARS" ? grp.arsBalance : grp.usdBalance;
        const iconName = GROUP_ICONS[grp.group] || "wallet";
        const isSelected = selectedGroup === grp.group;

        return (
          <div
            key={grp.group}
            onClick={() => onSelectGroup?.(isSelected ? null : grp.group)}
            className={`cursor-pointer rounded-xl border p-4 bg-bg-surface shadow-2xs transition-all hover:shadow-xs ${
              isSelected
                ? "border-tops-blue-700 dark:border-blue-400 ring-2 ring-tops-blue-700/20 dark:ring-blue-400/20 bg-bg-surface-alt"
                : "border-stroke-soft hover:border-stroke-strong"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-fg-secondary">
                {grp.label}
              </span>
              <div className="w-8 h-8 rounded-lg bg-tops-blue-700/10 dark:bg-blue-950/60 flex items-center justify-center text-tops-blue-700 dark:text-blue-400">
                <Icon name={iconName} className="w-4 h-4" />
              </div>
            </div>

            <div className="text-xl font-bold text-fg-primary tracking-tight">
              {currency === "ARS" ? fmtCurrency(balance) : `U$S ${balance.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </div>

            <div className="flex items-center justify-between text-xs text-fg-muted mt-3 pt-3 border-t border-stroke-soft">
              <span>{grp.accounts.length} {grp.accounts.length === 1 ? "cuenta" : "cuentas"}</span>
              <span className={`font-semibold ${isSelected ? "text-tops-blue-700 dark:text-blue-400" : "text-fg-secondary hover:text-fg-primary"}`}>
                {isSelected ? "Filtro activo ✓" : "Filtrar"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
