"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { VoiceField } from "@/components/voice/VoiceField";
import { upsertDealOverlay } from "@/lib/comercial/overlay-actions";
import {
  getOpportunityAlert,
  getSuggestedAction,
  calculateWeightedForecast,
} from "@/lib/comercial/commercial-score";
import type { SemaforoColor } from "@/lib/comercial/commercial-score";
import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

// ─── Constants ────────────────────────────────────────────────────────────────

const HORIZONTES = [
  "Esta semana",
  "15 días",
  "30 días",
  "60 días",
  "90 días",
  "+90 días",
  "A definir",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScoredDeal = EnrichedDeal & {
  _score?: number;
  _staleDays?: number;
  _semaforoColor?: SemaforoColor;
  _suggestedAction?: string;
  _weightedForecast?: number;
};

interface Props {
  deal: ScoredDeal | null;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000) {
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  }
  return "$ " + v.toLocaleString("es-AR");
};

const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  try {
    return new Date(s + "T12:00:00").toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
};

const fmtDateTime = (s: string | null | undefined) => {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
};

const semaforoClass = (c: SemaforoColor | undefined) => {
  if (c === "green") return "bg-status-success";
  if (c === "yellow") return "bg-status-warning";
  return "bg-status-danger";
};

const scoreBadgeClass = (score: number | undefined) => {
  if (score === undefined) return "bg-fg-muted/20 text-fg-muted";
  if (score >= 65) return "bg-status-success/20 text-status-success";
  if (score >= 35) return "bg-status-warning/20 text-status-warning";
  return "bg-status-danger/20 text-status-danger";
};

const statusLabel = (status: EnrichedDeal["status"]) => {
  switch (status) {
    case "open":
      return { label: "Activa", cls: "badge badge-success" };
    case "won":
      return { label: "Ganada", cls: "badge badge-info" };
    case "lost":
      return { label: "Perdida", cls: "badge badge-danger" };
    case "expired":
      return { label: "Vencida", cls: "badge badge-warning" };
    default:
      return { label: "Otra", cls: "badge badge-muted" };
  }
};

const staleColor = (days: number | undefined) => {
  if (days === undefined || days === Infinity) return "text-fg-muted";
  if (days < 7) return "text-status-success";
  if (days < 14) return "text-fg-secondary";
  if (days < 21) return "text-status-warning";
  return "text-status-danger";
};

// ─── Component ────────────────────────────────────────────────────────────────

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function DealDetailPanel({ deal, onClose }: Props) {
  const today = new Date();
  const panelRef = useRef<HTMLDivElement>(null);

  // Overlay form state
  const [horizonte, setHorizonte] = useState(deal?.overlay_horizonte ?? "");
  const [observaciones, setObservaciones] = useState(deal?.overlay_observaciones ?? "");
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form values when the selected deal changes
  useEffect(() => {
    setHorizonte(deal?.overlay_horizonte ?? "");
    setObservaciones(deal?.overlay_observaciones ?? "");
    setSaved(false);
    setError(null);
  }, [deal]);

  // Focus first focusable element when panel opens
  useEffect(() => {
    if (deal && panelRef.current) {
      const first = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
      first?.focus();
    }
  }, [deal]);

  // ESC key to close + focus trap
  useEffect(() => {
    if (!deal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [deal, onClose]);

  // Body scroll lock when open
  useEffect(() => {
    if (deal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [deal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deal) return;
    startSave(async () => {
      const res = await upsertDealOverlay({
        dealId: deal.deal_id,
        horizonte: horizonte || null,
        observaciones: observaciones || null,
      });
      if (!res.ok) {
        setError(res.error ?? "No se pudo guardar");
        setSaved(false);
      } else {
        setSaved(true);
        setError(null);
        // Auto-clear the "saved" indicator after 3s
        setTimeout(() => setSaved(false), 3000);
      }
    });
  };

  // Derived values from deal
  const weightedForecast = deal ? (deal._weightedForecast ?? calculateWeightedForecast(deal)) : 0;
  const alert = deal ? getOpportunityAlert(deal, today) : null;
  const suggestedAction = deal ? (deal._suggestedAction ?? getSuggestedAction(deal, today)) : "";
  const statusInfo = deal ? statusLabel(deal.status) : null;

  return (
    <>
      {/* Backdrop */}
      {deal && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Slide-in panel — always in DOM for animation */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={deal ? `Detalle: ${deal.title}` : "Detalle de oportunidad"}
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col bg-[var(--bg-surface,#fff)] shadow-2xl transition-transform duration-300 ease-in-out ${
          deal ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {deal && (
          <>
            {/* ── Header ── */}
            <div className="flex shrink-0 items-start gap-3 border-b border-stroke-soft p-4">
              {/* Semáforo dot */}
              <span
                className={`mt-1 h-3 w-3 shrink-0 rounded-full ${semaforoClass(deal._semaforoColor)}`}
                title={
                  deal._semaforoColor === "green"
                    ? "Prioritaria"
                    : deal._semaforoColor === "yellow"
                    ? "En seguimiento"
                    : "En riesgo"
                }
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg-primary">
                  {deal.company_name ?? deal.contact_name ?? "—"}
                </p>
                <p className="truncate text-xs text-fg-muted">{deal.title}</p>
              </div>
              {/* Score badge */}
              {deal._score !== undefined && (
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${scoreBadgeClass(
                    deal._score
                  )}`}
                >
                  {deal._score}
                </span>
              )}
              {/* Close button */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar panel"
                className="shrink-0 rounded-lg p-1 text-fg-muted hover:bg-fg-primary/10 hover:text-fg-primary transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto p-4 pb-6 space-y-5">
              {/* Read-only fields */}
              <section>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  Datos de la oportunidad
                </h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  <div>
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Importe</dt>
                    <dd className="text-sm font-semibold text-fg-primary tabular-nums">{fmt(deal.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Valor esperado</dt>
                    <dd className="text-sm font-semibold text-fg-secondary tabular-nums">{fmt(weightedForecast)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Probabilidad</dt>
                    <dd className={`text-sm font-semibold tabular-nums ${deal.effective_probability >= 50 ? "text-status-success" : deal.effective_probability <= 20 ? "text-status-danger" : "text-fg-secondary"}`}>
                      {deal.effective_probability}%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Estado</dt>
                    <dd>
                      {statusInfo && (
                        <span className={statusInfo.cls}>
                          <span className="dot" />
                          {statusInfo.label}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Pipeline</dt>
                    <dd className="text-sm text-fg-primary">{deal.pipeline ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Etapa</dt>
                    <dd className="text-sm text-fg-primary">{deal.stage ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Fuente</dt>
                    <dd className="text-sm text-fg-primary">{deal.deal_source ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Responsable</dt>
                    <dd className="text-sm text-fg-primary">{deal.owner_name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Cierre estimado</dt>
                    <dd className="text-sm text-fg-primary">{fmtDate(deal.expected_close)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Días sin act.</dt>
                    <dd className={`text-sm font-semibold tabular-nums ${staleColor(deal._staleDays)}`}>
                      {deal._staleDays === undefined || deal._staleDays === Infinity ? "—" : `${deal._staleDays}d`}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[10px] text-fg-muted uppercase tracking-wide">Última actividad</dt>
                    <dd className="text-sm text-fg-primary">{fmtDateTime(deal.modified_src)}</dd>
                  </div>
                </dl>
              </section>

              {/* Computed / intelligence fields */}
              <section>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  Inteligencia comercial
                </h3>
                <div className="space-y-2">
                  {/* Alert */}
                  <div
                    className={`rounded-lg px-3 py-2 text-xs ${
                      alert
                        ? alert.severity === "critica"
                          ? "bg-status-danger/10 text-status-danger"
                          : alert.severity === "atencion"
                          ? "bg-status-warning/10 text-status-warning"
                          : "bg-status-info/10 text-status-info"
                        : "bg-status-success/10 text-status-success"
                    }`}
                  >
                    <span className="font-semibold">
                      {alert ? "⚠ Alerta: " : "✓ Sin alertas"}
                    </span>
                    {alert?.label}
                  </div>

                  {/* Suggested action */}
                  {suggestedAction && (
                    <div className="rounded-lg bg-tops-blue-700/8 px-3 py-2 text-xs text-tops-blue-700">
                      <span className="font-semibold">Acción sugerida: </span>
                      {suggestedAction}
                    </div>
                  )}
                </div>
              </section>

              {/* Overlay editor */}
              <section>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  Notas de Nexus ★
                </h3>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <label htmlFor="panel-horizonte" className="block text-xs text-fg-secondary mb-1">
                      Horizonte de cierre
                    </label>
                    <select
                      id="panel-horizonte"
                      value={horizonte}
                      onChange={(e) => setHorizonte(e.target.value)}
                      disabled={saving}
                      className="w-full rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1.5 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-tops-blue-700/40 disabled:opacity-60"
                    >
                      <option value="">Sin definir</option>
                      {HORIZONTES.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="panel-observaciones" className="block text-xs text-fg-secondary mb-1">
                      Observaciones
                    </label>
                    <VoiceField>
                      <textarea
                        id="panel-observaciones"
                        value={observaciones}
                        onChange={(e) => setObservaciones(e.target.value)}
                        disabled={saving}
                        rows={4}
                        maxLength={2000}
                        placeholder="Notas internas sobre la oportunidad…"
                        className="w-full resize-y rounded-lg border border-stroke-soft bg-bg-surface px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-tops-blue-700/40 disabled:opacity-60"
                      />
                    </VoiceField>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-lg bg-tops-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-tops-blue-700/90 disabled:opacity-60 transition-colors"
                    >
                      {saving ? "Guardando…" : "Guardar"}
                    </button>
                    {saved && (
                      <span className="text-xs text-status-success font-medium">✓ Guardado</span>
                    )}
                    {error && (
                      <span className="text-xs text-status-danger">{error}</span>
                    )}
                  </div>
                </form>
              </section>
            </div>

            {/* ── Footer ── */}
            <div className="shrink-0 border-t border-stroke-soft px-4 py-3 flex items-center justify-between gap-2">
              <a
                href={deal.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-fg-primary/5 px-3 py-1.5 text-sm font-medium text-fg-primary hover:bg-fg-primary/10 transition-colors"
              >
                Abrir en Clientify
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:bg-fg-primary/5 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
