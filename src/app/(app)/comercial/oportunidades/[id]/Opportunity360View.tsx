"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { CaptureEmbed } from "./CaptureEmbed";
import { findAvailability, type CapacityCategory } from "@/lib/wms/corporate-capacity";
import {
  advanceStage, reserveCapacity, completeOnboarding,
  type ActionResult, type AssignedSite,
} from "@/lib/comercial/stage-actions";
import {
  type OpportunityFull, type CrmService, type CrmStage,
  STAGE_ORDER, STAGE_LABEL, STAGE_COLOR, SERVICE_LABEL, COMMITTED_LABEL,
} from "@/lib/comercial/crm-types";

/** Tipo de acción que dispara cada subcomponente (cierra sobre la server action). */
type RunAction = (fn: () => Promise<ActionResult>) => void;

/** Unidades sugeridas por sede (editables; no es un catálogo oficial). */
const UNIT_SUGGESTIONS: Record<AssignedSite, string[]> = {
  PEDRO_LUJAN_3159: ["Cubículo ANMAT (2º piso)", "Sector racks", "Depósito general"],
  MAGALDI_1765: ["Isla coworking", "Oficina PB", "Sector cargas generales", "Cubículo ANMAT PB30"],
};
const SITE_LABEL: Record<AssignedSite, string> = {
  PEDRO_LUJAN_3159: "Pedro Luján 3159",
  MAGALDI_1765: "Agustín Magaldi 1765",
};
const KNOWN_SITES: AssignedSite[] = ["PEDRO_LUJAN_3159", "MAGALDI_1765"];

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

type Cta =
  | { label: string; mode: "advance"; to: CrmStage }
  | { label: string; mode: "tab"; tab: TabKey };

/** CTA primaria por etapa: transición directa (advance) o navegación a la tab donde se opera. */
function primaryCta(estado: CrmStage): Cta | null {
  switch (estado) {
    case "nuevo_lead": return { label: "Marcar contactado", mode: "advance", to: "contactado" };
    case "contactado": return { label: "Calificar", mode: "advance", to: "calificado" };
    case "calificado": return { label: "Validar capacidad y reservar", mode: "tab", tab: "capacidad" };
    case "visita": return { label: "Cotizar", mode: "tab", tab: "cotizaciones" };
    case "propuesta": return { label: "Pasar a negociación", mode: "advance", to: "negociacion" };
    case "negociacion": return { label: "Marcar ganado", mode: "advance", to: "ganado" };
    case "ganado": return { label: "Gestionar onboarding", mode: "tab", tab: "onboarding" };
    default: return null;
  }
}

/**
 * Avance de etapa para estados cuyo CTA primario es navegación a una tab (no
 * un advance) pero que sí tienen una transición hacia adelante en el backend.
 * P0.3: `calificado → propuesta` (el único hueco real; `propuesta`/`negociacion`
 * ya avanzan vía primaryCta). Reusa crm_advance_stage (0047) — sin tocar backend.
 * `visita` queda fuera de scope: la UI no ofrece entrada a `visita` hoy.
 */
function forwardAdvance(estado: CrmStage): { to: CrmStage; label: string } | null {
  if (estado === "calificado") return { to: "propuesta", label: "Pasar a propuesta" };
  return null;
}

export function Opportunity360View({ full, source = "local" }: { full: OpportunityFull; source?: "supabase" | "local" }) {
  const { opportunity: o, quotes, proposals, contract, onboarding, history } = full;
  const [tab, setTab] = useState<TabKey>("resumen");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [lostMode, setLostMode] = useState(false);
  const [lostReason, setLostReason] = useState("");

  // La persistencia real opera sobre la fuente Supabase; en la muestra local se
  // deshabilitan las escrituras (la opp no existe en la base → evita errores).
  const writable = source === "supabase";

  // Ejecuta una server action dentro de una transición; refresca la Ficha y el
  // Dashboard (vía revalidatePath de la action) al confirmar.
  const run: RunAction = (fn) =>
    startTransition(async () => {
      const r = await fn();
      setFeedback({ kind: r.ok ? "ok" : "err", msg: r.message });
      if (r.ok) router.refresh();
    });

  const cap = useMemo(
    () => (o.m2 != null ? findAvailability({ category: SERVICE_TO_CATEGORY[o.serviceType], m2: o.m2 }) : null),
    [o.serviceType, o.m2],
  );
  const cta = primaryCta(o.estado);
  const fwd = forwardAdvance(o.estado);
  const canLose = o.estado !== "ganado" && o.estado !== "perdido";
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
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded"
          style={{ background: source === "supabase" ? "#16a34a1a" : "#64748b1a", color: source === "supabase" ? "#16a34a" : "#64748b" }}>
          <Icon name="database" size={10} /> {source === "supabase" ? "Supabase" : "muestra local"}
        </span>
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
            {cta && (
              <button
                disabled={!writable || isPending}
                onClick={() => (cta.mode === "advance" ? run(() => advanceStage(o.id, cta.to)) : setTab(cta.tab))}
                className="btn btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: stageColor, color: "#fff" }}
              >
                {isPending && cta.mode === "advance" ? "Procesando…" : cta.label} <Icon name="arrow-right" size={13} />
              </button>
            )}
            {fwd && (
              <button
                disabled={!writable || isPending}
                onClick={() => run(() => advanceStage(o.id, fwd.to))}
                className="btn btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: STAGE_COLOR[fwd.to], color: "#fff" }}
              >
                {isPending ? "Procesando…" : fwd.label} <Icon name="arrow-right" size={13} />
              </button>
            )}
            {canLose && (
              <button
                disabled={!writable || isPending}
                onClick={() => setLostMode((v) => !v)}
                className="btn btn-ghost btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon name="x" size={13} /> Perder
              </button>
            )}
            <button onClick={() => window.print()} className="btn btn-ghost btn-sm" aria-label="PDF">
              <Icon name="file-pdf" size={13} /> PDF
            </button>
          </div>
        </div>

        {/* Estado de escritura / feedback de acciones */}
        {!writable && (
          <div className="mt-3 text-[11px] text-fg-muted no-print">
            Vista de muestra — las acciones de etapa operan sobre datos reales (Supabase).
          </div>
        )}
        {lostMode && writable && (
          <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
            <input
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="Motivo de la pérdida (opcional)…"
              className="flex-1 min-w-[200px] rounded-lg border border-stroke-soft bg-bg-surface px-3 py-1.5 text-sm"
            />
            <button
              disabled={isPending}
              onClick={() => { run(() => advanceStage(o.id, "perdido", lostReason || undefined)); setLostMode(false); setLostReason(""); }}
              className="btn btn-sm disabled:opacity-50"
              style={{ background: "#dc2626", color: "#fff" }}
            >
              Confirmar pérdida
            </button>
            <button onClick={() => setLostMode(false)} className="btn btn-ghost btn-sm">Cancelar</button>
          </div>
        )}
        {feedback && (
          <div
            className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium no-print"
            style={{
              background: feedback.kind === "ok" ? "#16a34a14" : "#dc262614",
              color: feedback.kind === "ok" ? "#16a34a" : "#dc2626",
            }}
            role="status"
          >
            <Icon name={feedback.kind === "ok" ? "check-circle" : "x"} size={14} />
            {feedback.msg}
          </div>
        )}

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
        {tab === "capacidad" && <CapacidadTab o={o} cap={cap} run={run} isPending={isPending} writable={writable} />}
        {tab === "cotizaciones" && <CotizacionesTab quotes={quotes} opportunityId={o.id} />}
        {tab === "propuestas" && <PropuestasTab proposals={proposals} opportunityId={o.id} serviceType={o.serviceType} />}
        {tab === "contrato" && <ContratoTab contract={contract} />}
        {tab === "onboarding" && <OnboardingTab onboarding={onboarding} estado={o.estado} opportunityId={o.id} run={run} isPending={isPending} writable={writable} />}
        {tab === "historial" && <HistorialTab history={history} />}
      </div>

      <p className="text-[11px] text-fg-muted mt-4">
        Write-Path activo (F2.1-8): las transiciones de etapa, la reserva de capacidad y el cierre de onboarding
        persisten vía server actions (RPC transaccionales) sobre la fuente Supabase. Clientify y el webhook HMAC
        quedan fuera de este frente.
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

function CapacidadTab({
  o, cap, run, isPending, writable,
}: {
  o: OpportunityFull["opportunity"];
  cap: ReturnType<typeof findAvailability> | null;
  run: RunAction;
  isPending: boolean;
  writable: boolean;
}) {
  const initialSite: AssignedSite | "" =
    o.assignedSite && KNOWN_SITES.includes(o.assignedSite as AssignedSite) ? (o.assignedSite as AssignedSite) : "";
  const [site, setSite] = useState<AssignedSite | "">(initialSite);
  const [units, setUnits] = useState<string[]>(o.assignedUnits ?? []);
  const [unitDraft, setUnitDraft] = useState("");

  const addUnit = (u: string) => {
    const v = u.trim();
    if (v && !units.includes(v)) setUnits((prev) => [...prev, v]);
    setUnitDraft("");
  };
  const removeUnit = (u: string) => setUnits((prev) => prev.filter((x) => x !== u));
  const canReserve = writable && !isPending && site !== "" && units.length > 0;

  return (
    <div>
      {cap ? (
        <>
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
        </>
      ) : (
        <Empty text="Sin m² definidos: la disponibilidad no se evalúa, pero podés reservar un sitio/unidades." />
      )}

      {/* Reserva de capacidad → reserveCapacity */}
      <div className="mt-4 rounded-lg border border-stroke-soft p-3 no-print">
        <SectionLabel text="Reservar capacidad" />
        <div className="flex flex-col gap-2">
          <label className="text-[11px] uppercase tracking-wide text-fg-muted">Sede asignada</label>
          <select
            value={site}
            disabled={!writable || isPending}
            onChange={(e) => { setSite(e.target.value as AssignedSite | ""); setUnits([]); }}
            className="rounded-lg border border-stroke-soft bg-bg-surface px-3 py-1.5 text-sm disabled:opacity-50"
          >
            <option value="">— Elegí una sede —</option>
            {KNOWN_SITES.map((s) => <option key={s} value={s}>{SITE_LABEL[s]}</option>)}
          </select>

          <label className="text-[11px] uppercase tracking-wide text-fg-muted mt-1">Unidades</label>
          {units.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {units.map((u) => (
                <span key={u} className="inline-flex items-center gap-1 rounded-full bg-bg-surface-alt px-2.5 py-1 text-xs text-fg-primary">
                  {u}
                  <button type="button" onClick={() => removeUnit(u)} disabled={!writable || isPending} className="text-fg-muted hover:text-fg-brand">
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={unitDraft}
              disabled={!writable || isPending}
              onChange={(e) => setUnitDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUnit(unitDraft); } }}
              placeholder="Agregar unidad y Enter…"
              className="flex-1 rounded-lg border border-stroke-soft bg-bg-surface px-3 py-1.5 text-sm disabled:opacity-50"
            />
            <button type="button" disabled={!writable || isPending || !unitDraft.trim()} onClick={() => addUnit(unitDraft)} className="btn btn-ghost btn-sm disabled:opacity-50">
              <Icon name="plus" size={13} /> Agregar
            </button>
          </div>
          {site !== "" && (
            <div className="flex flex-wrap gap-1.5">
              {UNIT_SUGGESTIONS[site].filter((u) => !units.includes(u)).map((u) => (
                <button key={u} type="button" disabled={!writable || isPending} onClick={() => addUnit(u)} className="text-[11px] rounded-full border border-stroke-soft px-2 py-0.5 text-fg-secondary hover:text-fg-brand disabled:opacity-50">
                  + {u}
                </button>
              ))}
            </div>
          )}

          <button
            disabled={!canReserve}
            onClick={() => run(() => reserveCapacity(o.id, { site: site as AssignedSite, units }))}
            className="btn btn-sm mt-1 self-start disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#2563eb", color: "#fff" }}
          >
            {isPending ? "Reservando…" : "Reservar capacidad"} <Icon name="check" size={13} />
          </button>
          {!writable && <div className="text-[11px] text-fg-muted">Reserva disponible sobre datos reales (Supabase).</div>}
        </div>
      </div>
    </div>
  );
}

function CotizacionesTab({ quotes, opportunityId }: { quotes: OpportunityFull["quotes"]; opportunityId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="no-print">
        {open ? (
          <CaptureEmbed opportunityId={opportunityId} slug="cotizador" title="Cotizador · Guardar en Nexus" onClose={() => setOpen(false)} />
        ) : (
          <button onClick={() => setOpen(true)} className="btn btn-sm self-start" style={{ background: "var(--fg-brand,#0f172a)", color: "#fff" }}>
            <Icon name="calculator" size={13} /> Cotizar y capturar a Nexus
          </button>
        )}
      </div>
      {quotes.length === 0 && <Empty text="Sin cotizaciones. Abrí el cotizador y guardá en Nexus." />}
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

function PropuestasTab({ proposals, opportunityId }: { proposals: OpportunityFull["proposals"]; opportunityId: string; serviceType: CrmService }) {
  const [open, setOpen] = useState<null | "propuesta-anmat" | "propuesta-general">(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="no-print">
        {open ? (
          <CaptureEmbed
            opportunityId={opportunityId}
            slug={open}
            title={`Propuesta ${open === "propuesta-anmat" ? "ANMAT" : "General"} · Guardar en Nexus`}
            onClose={() => setOpen(null)}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setOpen("propuesta-anmat")} className="btn btn-sm" style={{ background: "#2563eb", color: "#fff" }}>
              <Icon name="file-pdf" size={13} /> Propuesta ANMAT
            </button>
            <button onClick={() => setOpen("propuesta-general")} className="btn btn-sm" style={{ background: "#dc2626", color: "#fff" }}>
              <Icon name="file-pdf" size={13} /> Propuesta General
            </button>
          </div>
        )}
      </div>
      {proposals.length === 0 && <Empty text="Sin propuestas. Generá una y guardá en Nexus." />}
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

function OnboardingTab({
  onboarding, estado, opportunityId, run, isPending, writable,
}: {
  onboarding: OpportunityFull["onboarding"];
  estado: CrmStage;
  opportunityId: string;
  run: RunAction;
  isPending: boolean;
  writable: boolean;
}) {
  if (!onboarding) return <Empty text="Sin onboarding. Se dispara automáticamente al ganar (cliente activo)." />;
  const done = onboarding.status === "completado";
  return (
    <div>
      {writable && estado === "ganado" && (
        <div className="mb-3 flex items-center gap-2 no-print">
          <button
            disabled={isPending || done}
            onClick={() => run(() => completeOnboarding(opportunityId))}
            className="btn btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#16a34a", color: "#fff" }}
          >
            {done ? "Onboarding completado" : isPending ? "Procesando…" : "Completar onboarding (→ ocupado)"} <Icon name="check-circle" size={13} />
          </button>
          {!done && <span className="text-[11px] text-fg-muted">Marca la capacidad como ocupada (sale del committed).</span>}
        </div>
      )}
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
