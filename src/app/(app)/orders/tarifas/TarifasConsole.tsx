"use client";

import React, { useState, useMemo } from "react";
import { Icon } from "@/components/Icon";
import { ClientCustomRatesEditor, type ServiceItemRate, type ClientCustomRateData } from "@/components/tarifas/ClientCustomRatesEditor";
import { formatTariffAmount } from "@/components/tarifas/currency";

interface Props {
  pricing: {
    versionCode: string;
    currency: "ARS" | "USD";
    generalRates: Record<string, { label: string; unit: string; rate: number | null; requiresQuote: boolean; category: string }>;
    clientRateManagement: Record<string, Record<string, { clientRateId: string; rate: number; minQty: number | null; minBilling: number | null; validFrom: string; status: "active" | "scheduled"; futureCount: number }>>;
    canAdjust: boolean;
  };
  services: ServiceItemRate[];
  clients: Array<{ id: string; razon: string; cuit: string; activo?: boolean }>;
}

export function TarifasConsole({ pricing, services, clients }: Props) {
  const [selectedClientId, setSelectedClientId] = useState<string>(clients[0]?.id ?? "");
  const [activeTab, setActiveTab] = useState<"general" | "custom">("general");

  const selectedClientRates = useMemo(() => {
    if (!selectedClientId) return {};
    const raw = pricing.clientRateManagement[selectedClientId] || {};
    const result: Record<string, ClientCustomRateData> = {};
    for (const [slug, data] of Object.entries(raw)) {
      result[slug] = {
        clientRateId: data.clientRateId,
        rate: data.rate,
        minQty: data.minQty,
        minBilling: data.minBilling,
        validFrom: data.validFrom,
        status: data.status,
        futureCount: data.futureCount,
      };
    }
    return result;
  }, [pricing.clientRateManagement, selectedClientId]);

  return (
    <div className="space-y-6">
      {/* Selector de pestañas para mobile */}
      <div className="flex sm:hidden p-1 bg-bg-surface border border-stroke-soft rounded-xl gap-1">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
            activeTab === "general" ? "bg-fg-primary text-bg-page" : "text-fg-secondary"
          }`}
        >
          Tarifas de Lista
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("custom")}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
            activeTab === "custom" ? "bg-fg-primary text-bg-page" : "text-fg-secondary"
          }`}
        >
          Tarifas por Cliente
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-6 items-start">
        {/* Panel Izquierdo: Tarifas de Lista Vigentes */}
        <div className={`card overflow-hidden border border-stroke-soft rounded-2xl ${activeTab === "custom" ? "hidden sm:block" : ""}`}>
          <div className="card-pad border-b border-stroke-soft bg-bg-surface flex items-center justify-between">
            <div>
              <div className="font-bold text-fg-brand flex items-center gap-2">
                <Icon name="tag-alt" size={15} />
                Tarifas de Lista Vigentes
              </div>
              <div className="text-xs text-fg-muted mt-0.5">
                Snapshot de la versión aprobada {pricing.versionCode} · Moneda {pricing.currency}
              </div>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
              VIGENTE
            </span>
          </div>

          <div className="divide-y divide-stroke-soft/60 max-h-[640px] overflow-auto">
            {services.map((service) => {
              const rate = pricing.generalRates[service.slug];
              return (
                <div key={service.slug} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-bg-surface/40 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-fg-primary">{service.label}</div>
                    <div className="text-[11px] text-fg-muted">
                      {service.unit} · <span className="font-mono">{service.slug}</span>
                    </div>
                  </div>
                  {rate?.requiresQuote || rate?.rate == null ? (
                    <span className="badge badge-warning">A COTIZAR</span>
                  ) : (
                    <span className="text-sm font-bold tabular text-fg-brand">
                      {formatTariffAmount(rate.rate, pricing.currency)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel Derecho: Gestión Interactiva de Tarifas por Cliente */}
        <div className={`card card-pad border border-stroke-soft rounded-2xl bg-bg-card shadow-sm ${activeTab === "general" ? "hidden sm:block" : ""}`}>
          <div className="mb-4">
            <div className="font-bold text-fg-brand flex items-center gap-2">
              <Icon name="building" size={16} />
              Gestión de Tarifas por Cliente
            </div>
            <p className="text-xs text-fg-muted mt-1">
              Consultá, asigná o restablecé tarifas personalizadas para cada cliente.
            </p>
          </div>

          <ClientCustomRatesEditor
            currency={pricing.currency}
            canAdjust={pricing.canAdjust}
            services={services}
            clientRates={selectedClientRates}
            clients={clients}
            mode="panel"
            onSelectClient={(id) => setSelectedClientId(id)}
          />
        </div>
      </div>
    </div>
  );
}
