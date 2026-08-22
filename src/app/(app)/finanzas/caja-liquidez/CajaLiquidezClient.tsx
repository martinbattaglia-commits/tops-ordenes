"use client";

import React, { useState, useEffect, useMemo } from "react";
import { FinanzasHeader, type AccountFilterScope } from "@/components/finanzas/FinanzasHeader";
import { AccountGroupCards } from "@/components/finanzas/AccountGroupCards";
import { CalendarView } from "@/components/finanzas/CalendarView";
import { ListView } from "@/components/finanzas/ListView";
import { TransactionsView } from "@/components/finanzas/TransactionsView";
import { Cashflow13WeeksTable } from "@/components/finanzas/Cashflow13WeeksTable";
import { NewMovementModal } from "@/components/finanzas/NewMovementModal";
import { Icon } from "@/components/Icon";
import { createForecastAdjustmentAction } from "@/lib/finanzas/actions";
import type {
  AccountGroupPosition,
  FinanceUnifiedTransaction,
  FinanceCategory,
  FinanceCostCenter,
  WeeklyCashflowItem,
  FinanceCurrency,
  FinanceAccountGroup,
} from "@/lib/finanzas/types";
import { calculate13WeekCashflow, getBankBalancesSummary, calculateDailyRollingBalances } from "@/lib/finanzas/engine";

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
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<"calendario" | "lista" | "transacciones" | "13semanas">("calendario");
  const [selectedGroup, setSelectedGroup] = useState<FinanceAccountGroup | null>(null);
  const [activeAccountScope, setActiveAccountScope] = useState<AccountFilterScope>("both_banks");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [highlightedTxId, setHighlightedTxId] = useState<string | null>(null);

  const [accountGroups] = useState<AccountGroupPosition[]>(initialAccountGroups);
  const [transactions, setTransactions] = useState<FinanceUnifiedTransaction[]>(initialTransactions);
  const [categories] = useState<FinanceCategory[]>(initialCategories);
  const [costCenters] = useState<FinanceCostCenter[]>(initialCostCenters);
  const [weeks13, setWeeks13] = useState<WeeklyCashflowItem[]>(initialWeeks13);

  // Parsear deep link al montar
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get("tab");
      const txParam = urlParams.get("txId");

      if (tabParam === "transacciones" || tabParam === "lista" || tabParam === "calendario" || tabParam === "13semanas") {
        setActiveTab(tabParam);
      }
      if (txParam) {
        setHighlightedTxId(txParam);
      }
    }
  }, []);

  const handleDeepLinkToTransaction = (txId: string) => {
    setHighlightedTxId(txId);
    setActiveTab("transacciones");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "transacciones");
      url.searchParams.set("txId", txId);
      window.history.replaceState({}, "", url.toString());
    }
  };

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

  const handleMonthChange = (newYear: number, newMonthIdx: number) => {
    const nextDate = `${newYear}-${String(newMonthIdx + 1).padStart(2, "0")}-01`;
    handleDateChange(nextDate);
  };

  const handleSaveMovement = async (data: {
    mode: "ejecutado" | "programado" | "recurrente";
    direction: "ingreso" | "egreso" | "transferencia";
    amount: number;
    currency: FinanceCurrency;
    accountGroup: FinanceAccountGroup;
    concept: string;
    counterpart?: string;
    date: string;
    certainty: "alta" | "media" | "baja";
    categoryId?: string;
    costCenterId?: string;
    notes?: string;
  }) => {
    const isRecurring = data.mode === "recurrente";
    const dir = data.direction === "ingreso" ? "ingreso" : "egreso";

    // Persistir en Supabase si es programado o recurrente
    if (data.mode === "programado" || data.mode === "recurrente") {
      await createForecastAdjustmentAction({
        date: data.date,
        direction: dir,
        amount: data.amount,
        currency: data.currency,
        account_group: data.accountGroup,
        concept: data.concept,
        counterpart: data.counterpart,
        category_id: data.categoryId,
        cost_center_id: data.costCenterId,
        certainty_level: data.certainty,
        is_recurring: isRecurring,
        recurrence_rule: isRecurring ? "mensual" : null,
        notes: data.notes,
      });
    }

    const newTx: FinanceUnifiedTransaction = {
      id: `manual-${Date.now()}`,
      date: data.date,
      direction: data.direction,
      concept: data.concept,
      counterpart: data.counterpart || null,
      amount: data.amount,
      currency: data.currency,
      accountGroup: data.accountGroup,
      accountName: data.accountGroup === "caja" ? "Caja" : data.accountGroup.toUpperCase(),
      categoryName: data.mode === "recurrente" ? "Previsión Recurrente" : "Previsión Financiera",
      isReal: data.mode === "ejecutado",
      status: data.mode === "ejecutado" ? "ejecutado" : "proyectado",
      certainty: data.certainty,
      createdAt: new Date().toISOString(),
    };

    setTransactions((prev) => [newTx, ...prev]);
  };

  // Cálculo del saldo inicial para el mes actual
  const bankSummary = getBankBalancesSummary(accountGroups, currency);
  let baseInitialBalance = bankSummary.bothBanksBalance;
  if (activeAccountScope === "galicia") baseInitialBalance = bankSummary.galiciaBalance;
  else if (activeAccountScope === "santander") baseInitialBalance = bankSummary.santanderBalance;
  else if (activeAccountScope === "caja") baseInitialBalance = bankSummary.cajaBalance;
  else if (activeAccountScope === "banks_and_cash") baseInitialBalance = bankSummary.banksAndCashBalance;
  else if (activeAccountScope === "all") baseInitialBalance = bankSummary.totalBalance;

  // Continuidad matemática de saldos entre meses
  const calendarInitialBalance = useMemo(() => {
    const [selYear, selMonth] = selectedDate.split("-").map(Number);
    const targetYear = selYear || new Date().getFullYear();
    const targetMonthIdx = (selMonth || new Date().getMonth() + 1) - 1;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIdx = now.getMonth();

    const monthDiff = (targetYear - currentYear) * 12 + (targetMonthIdx - currentMonthIdx);

    if (monthDiff === 0) {
      return baseInitialBalance;
    }

    let rollingBal = baseInitialBalance;

    if (monthDiff > 0) {
      // Meses futuros: acumular flujos netos proyectados desde el mes actual hasta el anterior al target
      for (let m = 0; m < monthDiff; m++) {
        const iterMonth = (currentMonthIdx + m) % 12;
        const iterYear = currentYear + Math.floor((currentMonthIdx + m) / 12);
        const days = calculateDailyRollingBalances(
          iterYear,
          iterMonth,
          rollingBal,
          transactions,
          activeAccountScope === "all" ? "all" : activeAccountScope
        );
        const lastDay = days[days.length - 1];
        if (lastDay) {
          rollingBal = lastDay.projectedClosingBalance;
        }
      }
    } else {
      // Meses pasados: deducir flujos netos
      for (let m = 0; m > monthDiff; m--) {
        const iterMonth = (currentMonthIdx + m - 1 + 1200) % 12;
        const iterYear = currentYear + Math.floor((currentMonthIdx + m - 1) / 12);
        // Calcular el flujo neto del mes pasado
        const days = calculateDailyRollingBalances(
          iterYear,
          iterMonth,
          0,
          transactions,
          activeAccountScope === "all" ? "all" : activeAccountScope
        );
        const netMonth = days.reduce((sum, d) => sum + d.netFlow, 0);
        rollingBal = rollingBal - netMonth;
      }
    }

    return rollingBal;
  }, [selectedDate, baseInitialBalance, transactions, activeAccountScope]);

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
        accountPositions={accountGroups}
        activeAccountScope={activeAccountScope}
        onAccountScopeChange={setActiveAccountScope}
      />

      <AccountGroupCards
        groups={accountGroups}
        currency={currency}
        selectedGroup={selectedGroup}
        onSelectGroup={setSelectedGroup}
      />

      {/* Selector de Solapas y Filtro Activo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="inline-flex rounded-xl border border-stroke-soft bg-bg-surface p-1 shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveTab("calendario")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === "calendario"
                ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700 shadow-xs"
                : "text-fg-secondary hover:text-fg-primary hover:bg-bg-surface-alt"
            }`}
          >
            <Icon name="calendar" className="w-4 h-4" />
            <span>Calendario</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("lista")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === "lista"
                ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700 shadow-xs"
                : "text-fg-secondary hover:text-fg-primary hover:bg-bg-surface-alt"
            }`}
          >
            <Icon name="menu" className="w-4 h-4" />
            <span>Lista</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("transacciones")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === "transacciones"
                ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700 shadow-xs"
                : "text-fg-secondary hover:text-fg-primary hover:bg-bg-surface-alt"
            }`}
          >
            <Icon name="report" className="w-4 h-4" />
            <span>Transacciones</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("13semanas")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === "13semanas"
                ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700 shadow-xs"
                : "text-fg-secondary hover:text-fg-primary hover:bg-bg-surface-alt"
            }`}
          >
            <Icon name="trend-up" className="w-4 h-4" />
            <span>Flujo 13 Semanas</span>
          </button>
        </div>

        {selectedGroup && (
          <div className="flex items-center gap-2 text-xs bg-tops-blue-700/10 dark:bg-blue-950/60 text-tops-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-lg font-bold">
            <span>Filtrando por: <strong className="uppercase">{selectedGroup}</strong></span>
            <button
              type="button"
              onClick={() => setSelectedGroup(null)}
              className="text-tops-red font-bold ml-1 hover:underline"
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
          initialBalance={calendarInitialBalance}
          accountScope={activeAccountScope}
          onDeepLinkToTransaction={handleDeepLinkToTransaction}
          onMonthChange={handleMonthChange}
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
          highlightedTxId={highlightedTxId}
          onSelectTransaction={(tx) => setHighlightedTxId(tx.id)}
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
