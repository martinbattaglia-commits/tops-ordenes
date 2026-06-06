"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { findAvailability, type CapacityCategory } from "@/lib/wms/corporate-capacity";
import {
  type OpportunityFull, type CrmService, type CrmStage,
  STAGE_ORDER, STAGE_LABEL, STAGE_COLOR, SERVICE_LABEL, COMMITTED_LABEL,
} from "@/lib/comercial/crm-types";

const fmt = (n: number) => n.toLocaleString("es-AR");
const money = (n: number | null, c = "ARS") => (n == null ? "—" : `$${fmt(n)} ${c}`);

const SERVICE_TO_CATEGORY: Record<CrmService, CapacityCategory> = { anmat: "anmat", general: "general", oficinas: "oficina" };

type TabKey = "resumen" | "capacidad" | "cotizaciones" | "propuestas" | "contrato" | "onboarding" | "historial";
const TABS: Array<{ key: TabKey; label: string; icon: IconName }> = [
  { key: "resumen", label: "Resumen", icon: "clients" },
  { key: "capacidad", label: "Capacidad", icon: "building" },
  { key: "cotizaciones", label: "Cotizaciones", icon: "calculator" },
  { key: "propuestas", label: "Propuestas", icon: "file-pdf" },
  { key: "contrato", label: "Contrato", icon: "pen" },
  { key: "onboarding", label: "Onboarding", icon: "check-circle" },
  { key: "historial", label: "Historial", icon: "clock" },
];

function nextAction(estado: CrmStage): { label: string; tab: TabKey } | null {
  switch (estado) {
    case "nuevo_lead": return { label: "Marcar contactado", tab: "resumen" };
    case "contactado": return { label: "Calificar", tab: "resumen" };
    case "calificado": return { label: "Validar capacidad y cotizar", tab: "capacidad" };
    case "visita": return { label: "Cotizar", tab: "cotizaciones" };
    case "propuesta": return { label: "Enviar / negociar propuesta", tab: "propuestas" };
    case "negociacion": return { label: "Marcar ganado", tab: "contrato" };
    case "ganado": return { label: "Gestionar onboarding", tab: "onboarding" };
    default: return null;
  }
}

export function Opportunity360View({ full }: { full: OpportunityFull }) {
  const { opportunity: o, quotes, proposals, contract, onboarding, history } = full;
  const [tab, setTab] = useState<TabKey>("resumen");

  const cap = useMemo(
    () => (o.m2 != null ? findAvailability({ category: SERVICE_TO_CATEGORY[o.serviceType], m2: o.m2 }) : null),
    [o.serviceType, o.m2],
  );
  const next = nextAction(o.estado);
  const stageColor = STAGE_COLOR[o.estado];

  const tabCount: Partial<Record<TabKey, number>> = {
    cotizaciones: quotes.length,
    propuestas: proposals.length,
    contrato: contract ? 1 : 0,
    onboarding: onboarding ? 1 : 0,
  };

  return (
    <div className="p-4 lg:p-8 nx-page-fade" id="ficha-root">
      <PrintStyles />

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-fg-muted mb-2 no-print">
        <Link href="/comercial/oportunidades" className="hover:text-fg-brand">Comercial</Link>
        <Icon name="chevron-right" size={11} />
        <Link href="/comercial/oportunidades" className="hover:text-fg-brand">Oportunidades</Link>
        <Icon name="chevron-right" size={11} />
        <span className="font-mono text-fg-secondary">{o.publicId}</span>
      </div>

      {/* Header */}
      <div className="nx-surface card p-4 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-fg-brand">{o.publicId}</span>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: `${stageColor}1a`, color: stageColor }}>
                {STAGE_LABEL[o.estado]}
              </span>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-bg-surface-alt text-fg-secondary">
                {COMMITTED_LABEL[o.committedState]}
              </span>
            </div>
            <h1 className="text-2xl font-black text-fg-primary tracking-tight mt-1">{o.empresa}</h1>
            <div className="text-xs text-fg-muted mt-0.5">
              {SERVICE_LABEL[o.serviceType]} · {o.m2 != null ? `${fmt(o.m2)} m²` : "m² s/d"} · Owner: {o.ownerName}
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            {next && (
              <button onClick={() => setTab(next.tab)} className="btn btn-sm" style={{ background: stageColor, color: "#fff" }}>
                {next.label} <Icon name="arrow-right" size={13} />
              </button>
            )}
            <button onClick={() => window.print()} className="btn btn-ghost btn-sm" aria-label="PDF">
              <Icon name="file-pdf" size={13} /> PDF
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
          <Kpi label="Servicio" value={SERVICE_LABEL[o.serviceType]} />
          <Kpi label="Superficie" value={o.m2 != null ? `${fmt(o.m2)} m²` : "—"} />
          <Kpi label="Monto" value={money(o.monto, o.currency)} />
          <Kpi label="Probabilidad" value={`${o.probabilidad}%`} />
          <Kpi label="Cierre esperado" value={o.expectedClose ?? "—"} />
        </div>

        {/* Capacidad — badge */}
        {cap && (
          <div className="mt-3 rounded-lg border-2 p-2.5 flex items-center gap-2" style={{ borderColor: cap.feasible ? "#16a34a" : "#dc2626", background: `${cap.feasible ? "#16a34a" : "#dc2626"}0d` }}>
            <Icon name={cap.feasible ? "check-circle" : "x"} size={16} style={{ color: cap.feasible ? "#16a34a" : "#dc2626" }} />
            <span className="text-sm font-semibold text-fg-primary">{cap.note}</span>
            <button onClick={() => setTab("capacidad")} className="ml-auto text-xs text-fg-brand font-semibold no-print">ver detalle →</button>
          </div>
        )}
      </div>

      {/* Pipeline stepper */}
      <PipelineStepper estado={o.estado} />

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 my-4 no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all border"
            style={tab === t.key ? { background: "var(--fg-brand, #0f172a)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--stroke-soft, #e2e8f0)" }}
          >
            <Icon name={t.icon} size={13} /> {t.label}
            {tabCount[t.key] != null && tabCount[t.key]! > 0 && (
              <span className="text-[10px] tabular opacity-80">({tabCount[t.key]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="nx-surface card p-4">
        {tab === "resumen" && <ResumenTab full={full} />}
        {tab === "capacidad" && <CapacidadTab o={o} cap={cap} />}
        {tab === "cotizaciones" && <CotizacionesTab quotes={quotes} />}
        {tab === "propuestas" && <PropuestasTab proposals={proposals} />}
        {tab === "contrato" && <ContratoTab contract={contract} />}
        {tab === "onboarding" && <OnboardingTab onboarding={onboarding} />}
        {tab === "historial" && <HistorialTab history={history} />}
      </div>

      <p className="text-[11px] text-fg-muted mt-4">
        Datos de muestra (F2.1-6). Las transiciones de etapa y la persistencia se conectan a Supabase en F2.1-7;
        Clientify y el webhook HMAC quedan fuera de este frente.
      </p>
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────────────

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-surface-alt px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-sm font-bold text-fg-primary tabular mt-0.5">{value}</div>
    </div>
  );
}

function PipelineStepper({ estado }: { estado: CrmStage }) {
  const stages = estado === "perdido" ? STAGE_ORDER : STAGE_ORDER.filter((s) => s !== "perdido");
  const idx = stages.indexOf(estado);
  return (
    <div className="nx-surface card p-3 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        {stages.map((s, i) => {
          const done = i < idx, current = i === idx;
          const c = STAGE_COLOR[s];
          return (
            <div key={s} className="flex items-center gap-1">
              <div
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  background: current ? c : done ? `${c}1a` : "transparent",
                  color: current ? "#fff" : done ? c : "var(--fg-muted, #94a3b8)",
                  border: current ? "none" : `1px solid ${done ? c : "var(--stroke-soft,#e2e8f0)"}`,
                }}
              >
                {done && <Icon name="check" size={10} />}
                {STAGE_LABEL[s]}
              </div>
              {i < stages.length - 1 && <span className="text-fg-muted">·</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-stroke-soft/60">
      <span className="text-[11px] uppercase tracking-wide text-fg-muted">{label}</span>
      <span className="text-sm font-semibold text-fg-primary text-right">{value}</span>
    </div>
  );
}

function ResumenTab({ full }: { full: OpportunityFull }) {
  const o = full.opportunity;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
      <div>
        <SectionLabel text="Contacto" />
        <Row label="Contacto" value={o.contacto ?? "—"} />
        <Row label="Email" value={o.email ?? "—"} />
        <Row label="Teléfono" value={o.telefono ?? "—"} />
        <Row label="CUIT" value={o.cuit ?? "—"} />
      </div>
      <div>
        <SectionLabel text="Asignación / capacidad" />
        <Row label="Depósito sugerido" value={o.deposito ?? "—"} />
        <Row label="Sede asignada" value={o.assignedSite ?? "—"} />
        <Row label="Unidades" value={o.assignedUnits?.join(" · ") ?? "—"} />
        <Row label="Estado de compromiso" value={COMMITTED_LABEL[o.committedState]} />
        <Row label="Deal Clientify" value={o.clientifyDealId ?? "—"} />
      </div>
    </div>
  );
}

function CapacidadTab({ o, cap }: { o: OpportunityFull["opportunity"]; cap: ReturnType<typeof findAvailability> | null }) {
  if (!cap) return <Empty text="Sin m² definidos para evaluar capacidad." />;
  return (
    <div>
      <div className="rounded-lg border-2 p-3 mb-3" style={{ borderColor: cap.feasible ? "#16a34a" : "#dc2626", background: `${cap.feasible ? "#16a34a" : "#dc2626"}0d` }}>
        <div className="flex items-center gap-2">
          <Icon name={cap.feasible ? "check-circle" : "x"} size={16} style={{ color: cap.feasible ? "#16a34a" : "#dc2626" }} />
          <span className="font-semibold text-fg-primary text-sm">{cap.note}</span>
        </div>
        <div className="text-[11px] text-fg-muted mt-1">
          Demanda: {fmt(o.m2 ?? 0)} m² {SERVICE_LABEL[o.serviceType]} · matching contra el Motor Corporativo de Capacidad.
        </div>
      </div>
      <SectionLabel text="Disponibilidad por sede" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {cap.options.map((opt) => (
          <div key={opt.siteCode} className="flex items-center justify-between rounded-lg border border-stroke-soft px-3 py-2">
            <span className="text-sm font-medium text-fg-primary">{opt.siteName}</span>
            <span className="inline-flex items-center gap-1.5 text-xs tabular text-fg-secondary">
              {fmt(opt.availableM2)} m²
              <span className="w-2 h-2 rounded-full" style={{ background: opt.fitsSingleSite ? "#16a34a" : "#94a3b8" }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CotizacionesTab({ quotes }: { quotes: OpportunityFull["quotes"] }) {
  if (quotes.length === 0) return <Empty text="Sin cotizaciones. Usá el cotizador para generar una (se persiste en F2.1-7)." />;
  return (
    <div className="flex flex-col gap-4">
      {quotes.map((q) => (
        <div key={q.id} className="rounded-lg border border-stroke-soft p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-sm font-bold text-fg-brand">{q.publicId}</span>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-bg-surface-alt text-fg-secondary">{q.status}</span>
          </div>
          <table className="w-full text-xs mb-2">
            <thead><tr className="text-left text-fg-muted"><th className="py-1">Concepto</th><th className="text-right">Cant.</th><th className="text-right">P. unit</th><th className="text-right">Importe</th></tr></thead>
            <tbody>
              {q.items.map((it, i) => (
                <tr key={i} className="border-t border-stroke-soft/50">
                  <td className="py-1">{it.concepto}</td>
                  <td className="text-right tabular">{fmt(it.cantidad)} {it.unidad}</td>
                  <td className="text-right tabular">${fmt(it.precioUnit)}</td>
                  <td className="text-right tabular">${fmt(it.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-4 text-xs tabular">
            <span className="text-fg-muted">Subtotal ${fmt(q.subtotal)}</span>
            {q.descuentoTotal > 0 && <span className="text-fg-muted">Desc. -${fmt(q.descuentoTotal)}</span>}
            <span className="text-fg-muted">IVA ${fmt(q.iva)}</span>
            <span className="font-bold text-fg-primary">Total ${fmt(q.total)}</span>
          </div>
          <div className="text-[10px] text-fg-muted mt-1">Tarifario {q.tarifarioRef} · {q.createdAt}</div>
        </div>
      ))}
    </div>
  );
}

function PropuestasTab({ proposals }: { proposals: OpportunityFull["proposals"] }) {
  if (proposals.length === 0) return <Empty text="Sin propuestas generadas." />;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {proposals.map((p) => (
        <div key={p.id} className="rounded-lg border border-stroke-soft p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-bold text-fg-brand">{p.publicId}</span>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-bg-surface-alt text-fg-secondary">{p.status}</span>
          </div>
          <div className="text-sm font-semibold text-fg-primary mt-1">Propuesta {p.tipo.toUpperCase()} · v{p.version}</div>
          <Row label="Enviada" value={p.sentAt ?? "—"} />
          <Row label="Vista" value={p.viewedAt ?? "—"} />
          <Row label="Cotización" value={p.quotePublicId ?? "—"} />
        </div>
      ))}
    </div>
  );
}

function ContratoTab({ contract }: { contract: OpportunityFull["contract"] }) {
  if (!contract) return <Empty text="Sin contrato. Se genera al pasar a Ganado." />;
  return (
    <div className="max-w-md">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-lg font-bold text-fg-brand">{contract.publicId}</span>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: "#16a34a1a", color: "#16a34a" }}>{contract.status}</span>
      </div>
      <Row label="Versión" value={`v${contract.version}`} />
      <Row label="Firmado por" value={contract.signedBy ?? "—"} />
      <Row label="Firmado el" value={contract.signedAt ?? "—"} />
      <Row label="Vigencia" value={`${contract.validFrom ?? "—"} → ${contract.validUntil ?? "—"}`} />
      <Row label="Propuesta" value={contract.proposalPublicId ?? "—"} />
    </div>
  );
}

function OnboardingTab({ onboarding }: { onboarding: OpportunityFull["onboarding"] }) {
  if (!onboarding) return <Empty text="Sin onboarding. Se dispara automáticamente al ganar (cliente activo)." />;
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono text-sm font-bold text-fg-brand">{onboarding.publicId}</span>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-bg-surface-alt text-fg-secondary">{onboarding.status}</span>
        <div className="flex-1 max-w-xs">
          <div className="h-2 rounded-full bg-bg-surface-alt overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${onboarding.progressPct}%`, background: "#16a34a" }} />
          </div>
        </div>
        <span className="text-sm font-bold tabular" style={{ color: "#16a34a" }}>{onboarding.progressPct}%</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {onboarding.tasks.map((t) => {
          const color = t.status === "completado" ? "#16a34a" : t.status === "en_curso" ? "#d97706" : t.status === "na" ? "#94a3b8" : "#64748b";
          return (
            <div key={t.tipo} className="flex items-center gap-2 rounded-lg border border-stroke-soft px-3 py-2">
              <Icon name={t.status === "completado" ? "check-circle" : t.status === "na" ? "minus" : "clock"} size={14} style={{ color }} />
              <span className="text-sm text-fg-primary">{t.titulo}</span>
              {t.hasDocument && <Icon name="paperclip" size={12} className="text-fg-muted" />}
              <span className="ml-auto text-[10px] font-bold uppercase" style={{ color }}>{t.status}</span>
              {t.assignee && <span className="text-[10px] text-fg-muted">· {t.assignee}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistorialTab({ history }: { history: OpportunityFull["history"] }) {
  if (history.length === 0) return <Empty text="Sin historial." />;
  return (
    <div className="flex flex-col gap-0">
      {history.map((h, i) => (
        <div key={i} className="flex gap-3 pb-3">
          <div className="flex flex-col items-center">
            <span className="w-2.5 h-2.5 rounded-full mt-1" style={{ background: STAGE_COLOR[h.toStage] }} />
            {i < history.length - 1 && <span className="flex-1 w-px bg-stroke-soft my-1" />}
          </div>
          <div className="pb-2">
            <div className="text-sm font-semibold text-fg-primary">
              {h.fromStage ? `${STAGE_LABEL[h.fromStage]} → ` : ""}{STAGE_LABEL[h.toStage]}
            </div>
            <div className="text-[11px] text-fg-muted">{h.changedAt} · {h.changedBy}{h.note ? ` · ${h.note}` : ""}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <div className="text-[11px] font-bold uppercase tracking-wide text-fg-secondary mb-1 mt-1">{text}</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="text-sm text-fg-muted italic py-8 text-center">{text}</div>;
}
function PrintStyles() {
  return <style>{`@media print { .no-print{display:none!important} #ficha-root{padding:0!important} .nx-surface{box-shadow:none!important;border:1px solid #ccc!important} @page{size:A4 portrait;margin:10mm} }`}</style>;
}
