"use client";

/**
 * ContratosWorkspace.tsx — Contenedor del módulo Contratos. Navegación interna por
 * vistas (Dashboard · Cartera · Calendario · Alertas · Modelo) y estado de la ficha
 * lateral, replicando la maqueta oficial dentro del shell de TOPS NEXUS.
 */

import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import type { ContractRecord, ContractsPortfolio } from "@/lib/comercial/contracts-types";
import { ContractsDashboard } from "@/components/contratos/ContractsDashboard";
import { ContractsTable } from "@/components/contratos/ContractsTable";
import { ContractsCalendar } from "@/components/contratos/ContractsCalendar";
import { ContractsAlerts } from "@/components/contratos/ContractsAlerts";
import { ContractsDataModel } from "@/components/contratos/ContractsDataModel";
import { ContractDrawer } from "@/components/contratos/ContractDrawer";
import { ContractsSyncStatus } from "./ContractsSyncStatus";

type ViewId = "dashboard" | "cartera" | "calendario" | "alertas" | "sincronizacion" | "modelo";

const TABS: { id: ViewId; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Tablero ejecutivo", icon: "dashboard" },
  { id: "cartera", label: "Cartera de contratos", icon: "clients" },
  { id: "calendario", label: "Calendario", icon: "calendar" },
  { id: "alertas", label: "Alertas", icon: "bell" },
  { id: "sincronizacion", label: "Sincronización", icon: "refresh" },
  { id: "modelo", label: "Modelo de datos", icon: "database" },
];

const SOURCE_META: Record<
  string,
  { icon: IconName; label: string; title: string }
> = {
  drive: {
    icon: "cloud-check",
    label: "Google Drive",
    title: "Datos sincronizados desde Google Drive (fuente de verdad operativa)",
  },
  db: {
    icon: "database",
    label: "Base de datos",
    title: "Datos persistidos en Supabase — aún sin sincronización desde Drive",
  },
  audit: {
    icon: "shield",
    label: "Carga inicial (sin sincronizar)",
    title: "Carga inicial auditada (fallback) — migraciones 0076/0077 pendientes o sin sincronizar",
  },
};

export function ContratosWorkspace({ portfolio }: { portfolio: ContractsPortfolio }) {
  const [view, setView] = useState<ViewId>("dashboard");
  const [selected, setSelected] = useState<ContractRecord | null>(null);
  const { items, aggregates, alerts, corte, source, sync } = portfolio;
  const srcMeta = SOURCE_META[source] ?? SOURCE_META.audit;

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      {/* Cabecera */}
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">CRM Comercial → Contratos</div>
          <h1 className="page-title">Gestión contractual</h1>
          <p className="text-sm text-fg-secondary">
            Cartera 3PL · ANMAT y Cargas Generales · Verotin S.A.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-fg-muted">
          <span>
            Fecha de corte: <b className="text-fg-secondary">{formatCorte(corte)}</b>
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-pill border border-stroke-soft px-2 py-0.5"
            title={srcMeta.title}
          >
            <Icon name={srcMeta.icon} size={12} />
            {srcMeta.label}
          </span>
        </div>
      </div>

      {/* Navegación interna */}
      <nav className="mb-5 flex flex-wrap gap-1 border-b border-stroke-soft">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors ${
              view === t.id
                ? "border-[#C8A24B] text-fg-brand"
                : "border-transparent text-fg-muted hover:text-fg-secondary"
            }`}
            aria-current={view === t.id ? "page" : undefined}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
            {t.id === "alertas" && alerts.length > 0 && (
              <span className="rounded-pill bg-[#D14343] px-1.5 text-[10px] font-bold text-white">
                {alerts.length}
              </span>
            )}
            {t.id === "sincronizacion" && sync.alerts.length > 0 && (
              <span className="rounded-pill bg-[#E07A1F] px-1.5 text-[10px] font-bold text-white">
                {sync.alerts.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Vistas */}
      {view === "dashboard" && (
        <ContractsDashboard items={items} aggregates={aggregates} corte={corte} onOpen={setSelected} />
      )}
      {view === "cartera" && <ContractsTable items={items} onOpen={setSelected} />}
      {view === "calendario" && <ContractsCalendar items={items} onOpen={setSelected} />}
      {view === "alertas" && <ContractsAlerts alerts={alerts} onOpen={setSelected} />}
      {view === "sincronizacion" && <ContractsSyncStatus sync={sync} />}
      {view === "modelo" && <ContractsDataModel />}

      <ContractDrawer contract={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function formatCorte(iso: string): string {
  return iso.split("-").reverse().join("/");
}
