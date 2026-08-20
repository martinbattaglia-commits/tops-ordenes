"use client";

import React, { useState } from "react";
import { FinanzasHeader } from "@/components/finanzas/FinanzasHeader";
import { AccountGroupCards } from "@/components/finanzas/AccountGroupCards";
import { CalendarView } from "@/components/finanzas/CalendarView";
import { ListView } from "@/components/finanzas/ListView";
import { TransactionsView } from "@/components/finanzas/TransactionsView";
import { Cashflow13WeeksTable } from "@/components/finanzas/Cashflow13WeeksTable";
import { NewMovementModal } from "@/components/finanzas/NewMovementModal";
import type {
  FinanceCurrency,
  FinanceAccountGroup,
  AccountGroupPosition,
  FinanceUnifiedTransaction,
  FinanceCategory,
  FinanceCostCenter,
  WeeklyCashflowItem,
} from "@/lib/finanzas/types";
import { calculate13WeekCashflow } from "@/lib/finanzas/engine";
import { Icon } from "@/components/Icon";

interface CajaLiquidezClientProps {
  initialAccountGroups: AccountGroupPosition[];
  initialTransactions: FinanceUnifiedTransaction[];
  initialCategories: FinanceCategory[];
  initialCostCenters: FinanceCostCenter[];
  initialWeeks13: WeeklyCashflowItem[];
}

export function CajaLiquidezClient({
  initialAccountGroups,
  initialTransactions,
  initialCategories,
  initialCostCenters,
  initialWeeks13,
}: CajaLiquidezClientProps) {
  const [currency, setCurrency] = useState<FinanceCurrency>("ARS");
  const [activeTab, setActiveTab] = useState<"calendario" | "lista" | "transacciones" | "13semanas">("calendario");
  const [selectedGroup, setSelectedGroup] = useState<FinanceAccountGroup | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));

  const [accountGroups] = useState<AccountGroupPosition[]>(initialAccountGroups);
  const [transactions, setTransactions] = useState<FinanceUnifiedTransaction[]>(initialTransactions);
  const [categories] = useState<FinanceCategory[]>(initialCategories);
  const [costCenters] = useState<FinanceCostCenter[]>(initialCostCenters);
  const [weeks13, setWeeks13] = useState<WeeklyCashflowItem[]>(initialWeeks13);

  const handleCurrencyChange = (newCurr: FinanceCurrency) => {
    setCurrency(newCurr);
    const totalArs = accountGroups.reduce((acc, g) => acc + g.arsBalance, 0);
    const totalUsd = accountGroups.reduce((acc, g) => acc + g.usdBalance, 0);
    setWeeks13(calculate13WeekCashflow(selectedDate, totalArs, totalUsd, transactions));
  };

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    const totalArs = accountGroups.reduce((acc, g) => acc + g.arsBalance, 0);
    const totalUsd = accountGroups.reduce((acc, g) => acc + g.usdBalance, 0);
    setWeeks13(calculate13WeekCashflow(newDate, totalArs, totalUsd, transactions));
  };

  const handleSaveMovement = (data: {
    mode: "ejecutado" | "programado" | "recurrente";
    direction: "ingreso" | "egreso" | "transferencia";
    amount: number;
    currency: FinanceCurrency;
    accountGroup: FinanceAccountGroup;
    concept: string;
    counterpart?: string;
    date: string;
    certainty: "alta" | "media" | "baja";
  }) => {
    const newTx: FinanceUnifiedTransaction = {
      id: `manual-${Date.now()}`,
      date: data.date,
      direction: data.direction,
      concept: data.concept,
      counterpart: data.counterpart || null,
      amount: data.amount,
      currency: data.currency,
      accountGroup: data.accountGroup,
      accountName: data.accountGroup.toUpperCase(),
      categoryName: "Operativo Manual",
      isReal: data.mode === "ejecutado",
      status: data.mode === "ejecutado" ? "ejecutado" : "proyectado",
      certainty: data.certainty,
    };

    setTransactions((prev) => [newTx, ...prev]);
  };

  const filteredTransactions = transactions
    .filter((t) => (currency ? t.currency === currency : true))
    .filter((t) => (selectedGroup ? t.accountGroup === selectedGroup : true));

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <FinanzasHeader
        title="Caja y Liquidez"
        subtitle="Posición diaria consolidada, calendario financiero y proyección de 13 semanas."
        currentCurrency={currency}
        onCurrencyChange={handleCurrencyChange}
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
        onNewMovementClick={() => setIsModalOpen(true)}
      />

      <AccountGroupCards
        groups={accountGroups}
        currency={currency}
        selectedGroup={selectedGroup}
        onSelectGroup={setSelectedGroup}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="inline-flex rounded-xl border border-[#DDE2EB] bg-white p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab("calendario")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === "calendario"
                ? "bg-[#050555] text-white shadow-xs"
                : "text-[#687087] hover:text-[#111331] hover:bg-[#F4F5F8]"
            }`}
          >
            <Icon name="calendar" className="w-4 h-4" />
            <span>Calendario</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("lista")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === "lista"
                ? "bg-[#050555] text-white shadow-xs"
                : "text-[#687087] hover:text-[#111331] hover:bg-[#F4F5F8]"
            }`}
          >
            <Icon name="menu" className="w-4 h-4" />
            <span>Lista</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("transacciones")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === "transacciones"
                ? "bg-[#050555] text-white shadow-xs"
                : "text-[#687087] hover:text-[#111331] hover:bg-[#F4F5F8]"
            }`}
          >
            <Icon name="report" className="w-4 h-4" />
            <span>Transacciones</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("13semanas")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === "13semanas"
                ? "bg-[#050555] text-white shadow-xs"
                : "text-[#687087] hover:text-[#111331] hover:bg-[#F4F5F8]"
            }`}
          >
            <Icon name="trend-up" className="w-4 h-4" />
            <span>Flujo 13 Semanas</span>
          </button>
        </div>

        {selectedGroup && (
          <div className="flex items-center gap-2 text-xs bg-[#E9EEF5] text-[#214576] px-3 py-1.5 rounded-lg font-medium">
            <span>Filtrando por: <strong className="uppercase">{selectedGroup}</strong></span>
            <button
              type="button"
              onClick={() => setSelectedGroup(null)}
              className="text-[#C9070D] font-bold ml-1 hover:underline"
            >
              Quitar filtro
            </button>
          </div>
        )}
      </div>

      {activeTab === "calendario" && (
        <CalendarView
          currentDate={selectedDate}
          currency={currency}
          transactions={filteredTransactions}
        />
      )}

      {activeTab === "lista" && (
        <ListView
          currency={currency}
          transactions={filteredTransactions}
        />
      )}

      {activeTab === "transacciones" && (
        <TransactionsView
          currency={currency}
          transactions={filteredTransactions}
        />
      )}

      {activeTab === "13semanas" && (
        <Cashflow13WeeksTable
          weeks={weeks13}
          currency={currency}
        />
      )}

      <NewMovementModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        categories={categories}
        costCenters={costCenters}
        accountGroups={accountGroups}
        onSave={handleSaveMovement}
      />
    </div>
  );
}
