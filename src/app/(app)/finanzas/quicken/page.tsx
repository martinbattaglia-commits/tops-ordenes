"use client";

import React, { useState } from "react";
import { FinanzasHeader } from "@/components/finanzas/FinanzasHeader";
import { QuickenConsole } from "@/components/finanzas/QuickenConsole";
import type { FinanceCurrency } from "@/lib/finanzas/types";

export default function QuickenImportPage() {
  const [currency, setCurrency] = useState<FinanceCurrency>("ARS");

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <FinanzasHeader
        title="Importación Histórica Quicken"
        subtitle="Herramienta gobernada con validación SHA-256, mapeo canónico de categorías y balance de sumas."
        currentCurrency={currency}
        onCurrencyChange={setCurrency}
      />

      <QuickenConsole />
    </div>
  );
}
