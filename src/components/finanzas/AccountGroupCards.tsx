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
            className={`cursor-pointer rounded-xl border p-4 bg-white shadow-xs transition-all hover:shadow-md ${
              isSelected
                ? "border-[#050555] ring-2 ring-[#050555]/20 bg-[#F4F5F8]"
                : "border-[#DDE2EB] hover:border-[#CBD3E0]"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#687087]">
                {grp.label}
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#E9EEF5] flex items-center justify-center text-[#050555]">
                <Icon name={iconName} className="w-4 h-4" />
              </div>
            </div>

            <div className="text-xl font-bold text-[#111331] tracking-tight">
              {currency === "ARS" ? fmtCurrency(balance) : `U$S ${balance.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`}
            </div>

            <div className="flex items-center justify-between text-xs text-[#687087] mt-3 pt-3 border-t border-[#DDE2EB]">
              <span>{grp.accounts.length} {grp.accounts.length === 1 ? "cuenta" : "cuentas"}</span>
              <span className="font-medium text-[#214576]">
                {isSelected ? "Filtro activo" : "Filtrar"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
