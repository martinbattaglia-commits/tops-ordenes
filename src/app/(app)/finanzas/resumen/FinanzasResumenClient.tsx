"use client";

import React, { useState } from "react";
import { FinanzasHeader, type AccountFilterScope } from "@/components/finanzas/FinanzasHeader";
import { ExecutiveCockpit } from "@/components/finanzas/ExecutiveCockpit";
import type {
  FinanceCurrency,
  AccountGroupPosition,
  ProfitAndLossStatement,
  FinanceUnifiedTransaction,
} from "@/lib/finanzas/types";

interface FinanzasResumenClientProps {
  accountPositions: AccountGroupPosition[];
  pnlArs: ProfitAndLossStatement;
  pnlUsd: ProfitAndLossStatement;
  initialTransactions?: FinanceUnifiedTransaction[];
}

export function FinanzasResumenClient({
  accountPositions,
  pnlArs,
  pnlUsd,
  initialTransactions = [],
}: FinanzasResumenClientProps) {
  const [currency, setCurrency] = useState<FinanceCurrency>("ARS");
  const [activeAccountScope, setActiveAccountScope] = useState<AccountFilterScope>("both_banks");

  const activePnl = currency === "ARS" ? pnlArs : pnlUsd;

  // Derivación de alertas financieras estrictamente a partir de hechos y saldos reales
  const realAlerts: { id: string; type: "critical" | "warning" | "info"; title: string; detail: string }[] = [];

  // Alerta de saldos negativos en agrupadores de cuentas
  accountPositions.forEach((g) => {
    const bal = currency === "ARS" ? g.arsBalance : g.usdBalance;
    if (bal < 0) {
      realAlerts.push({
        id: `alert-neg-${g.group}`,
        type: "critical",
        title: `Saldo Negativo en ${g.label}`,
        detail: `La posición actual registra un descubierto de ${currency === "ARS" ? "$" : "U$S"} ${Math.abs(bal).toLocaleString("es-AR", { minimumFractionDigits: 2 })}.`,
      });
    }
  });

  // Alerta de compromisos inmediatos si existen transacciones proyectadas
  const todayStr = new Date().toISOString().slice(0, 10);
  const overdueTxs = initialTransactions.filter(
    (t) => t.currency === currency && t.direction === "egreso" && t.date < todayStr && t.status === "proyectado"
  );
  if (overdueTxs.length > 0) {
    const totalOverdue = overdueTxs.reduce((s, t) => s + t.amount, 0);
    realAlerts.push({
      id: "alert-overdue-txs",
      type: "warning",
      title: "Compromisos de Pago Vencidos",
      detail: `Existen ${overdueTxs.length} pagos pendientes anteriores a hoy por un total de ${currency === "ARS" ? "$" : "U$S"} ${totalOverdue.toLocaleString("es-AR", { minimumFractionDigits: 2 })}.`,
    });
  }

  const realDecisions: { id: string; title: string; impact: string; deadline: string; owner: string; status: string }[] = [];

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <FinanzasHeader
        title="Resumen Ejecutivo Financiero"
        subtitle="Cockpit de dirección: posición consolidada, rentabilidad EBITDA, alertas y agenda de decisiones basada en datos reales de Supabase."
        currentCurrency={currency}
        onCurrencyChange={setCurrency}
        accountPositions={accountPositions}
        activeAccountScope={activeAccountScope}
        onAccountScopeChange={setActiveAccountScope}
      />

      <ExecutiveCockpit
        currency={currency}
        accountPositions={accountPositions}
        pnl={activePnl}
        transactions={initialTransactions}
        alerts={realAlerts}
        decisions={realDecisions}
      />
    </div>
  );
}
