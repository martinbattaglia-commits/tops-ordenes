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

  const sampleAlerts = [
    { id: "a1", type: "critical" as const, title: "Vencimiento Pago AFIP Quincenal", detail: "Monto comprometido $ 8.900.000 antes del 22/08 en Banco Galicia." },
    { id: "a2", type: "warning" as const, title: "Límite de Tarjeta Santander Operaciones", detail: "Utilización al 82% del disponible mensual ($ 12.000.000)." },
    { id: "a3", type: "info" as const, title: "Cobranza Prevista Roemmers Farmacia", detail: "Ingreso programado $ 13.297.400 confirmado para el día 25/08." },
  ];

  const sampleDecisions = [
    { id: "d1", title: "Renovación Póliza de Carga Flota Luján", impact: "Costo $ 3.200.000 / mes", deadline: "30/08/2026", owner: "Dirección / Compras", status: "En evaluación" },
    { id: "d2", title: "Ajuste Tarifa Flete Cargas Generales (+6.5%)", impact: "Ingreso incremental proyectado $ 3.100.000", deadline: "01/09/2026", owner: "Gerencia Comercial", status: "Aprobado" },
    { id: "d3", title: "Colocación Excedente en FCI T+0 vs Plazo Fijo", impact: "Rendimiento estimado 3.2% mensual", deadline: "24/08/2026", owner: "Tesorería", status: "Pendiente" },
  ];

  const activePnl = currency === "ARS" ? pnlArs : pnlUsd;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <FinanzasHeader
        title="Resumen Ejecutivo Financiero"
        subtitle="Cockpit de dirección: posición consolidada, rentabilidad EBITDA, alertas y agenda de decisiones."
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
        alerts={sampleAlerts}
        decisions={sampleDecisions}
      />
    </div>
  );
}
