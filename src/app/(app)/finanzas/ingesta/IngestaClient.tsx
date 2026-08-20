"use client";

import React, { useState } from "react";
import { FinanzasHeader } from "@/components/finanzas/FinanzasHeader";
import { InboxView } from "@/components/finanzas/InboxView";
import type { FinanceCurrency, FinanceDocumentInboxItem } from "@/lib/finanzas/types";

interface IngestaClientProps {
  initialItems: FinanceDocumentInboxItem[];
}

export function IngestaClient({ initialItems }: IngestaClientProps) {
  const [currency, setCurrency] = useState<FinanceCurrency>("ARS");

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <FinanzasHeader
        title="Bandeja de Ingesta Documental"
        subtitle="Extracción automática de comprobantes, facturas de proveedores y validación previa a Tesorería."
        currentCurrency={currency}
        onCurrencyChange={setCurrency}
      />

      <InboxView items={initialItems} />
    </div>
  );
}
