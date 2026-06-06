"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { reassignLead, setLeadStatus, promoteLead } from "@/lib/comercial/lead-actions";
import {
  type CrmLead, type LeadStatus, type CrmService,
  LEAD_STATUS_LABEL, LEAD_STATUS_COLOR, SERVICE_LABEL,
} from "@/lib/comercial/crm-types";
import type { CommercialUser } from "@/lib/comercial/leads-supabase";

const SERVICES: CrmService[] = ["anmat", "general", "oficinas"];

const STATUSES: LeadStatus[] = ["nuevo", "contactado", "calificado", "descartado", "promovido"];

/** Siguiente(s) acción(es) de calificación por estado (sin promoción · F2.2-4). */
function statusActions(s: LeadStatus): Array<{ label: string; to: LeadStatus; color: string }> {
  switch (s) {
    case "nuevo": return [{ label: "Contactar", to: "contactado", color: "#0891b2" }, { label: "Descartar", to: "descartado", color: "#94a3b8" }];
    case "contactado": return [{ label: "Calificar", to: "calificado", color: "#16a34a" }, { label: "Descartar", to: "descartado", color: "#94a3b8" }];
    case "calificado": return [{ label: "Descartar", to: "descartado", color: "#94a3b8" }];
    case "descartado": return [{ label: "Reactivar", to: "nuevo", color: "#2563eb" }];
    default: return []; // promovido → sin acciones
  }
}

export function LeadsInboxView({
  leads, commercialUsers, source,
}: {
  leads: CrmLead[];
  commercialUsers: CommercialUser[];
  source: "supabase" | "local";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const writable = source === "supabase";

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      const r = await fn();
      setFeedback({ kind: r.ok ? "ok" : "err", msg: r.message });
      if (r.ok) router.refresh();
    });

  // Promoción → oportunidad (mini-form de service_type por lead)
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoSvc, setPromoSvc] = useState<CrmService>("general");
  const [promoM2, setPromoM2] = useState("");
  const doPromote = (leadId: string) =>
    startTransition(async () => {
      const r = await promoteLead(leadId, { serviceType: promoSvc, m2: promoM2 ? Number(promoM2) : undefined });
      setFeedback({ kind: r.ok ? "ok" : "err", msg: r.message });
      if (r.ok) {
        setPromotingId(null);
        setPromoM2("");
        router.push(`/comercial/oportunidades/${r.opportunityId}`);
      }
    });

  // ── Filtros ──────────────────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<LeadStatus | "">("");
  const [fOwner, setFOwner] = useState<string>("");      // "" todos · "none" sin asignar · uuid
  const [fSource, setFSource] = useState<string>("");
  const [fDup, setFDup] = useState(false);

  const sources = useMemo(() => [...new Set(leads.map((l) => l.source).filter((x): x is string => !!x))].sort(), [leads]);

  const filtered = useMemo(() => leads.filter((l) => {
    if (fStatus && l.status !== fStatus) return false;
    if (fOwner === "none" && l.ownerId) return false;
    if (fOwner && fOwner !== "none" && l.ownerId !== fOwner) return false;
    if (fSource && l.source !== fSource) return false;
    if (fDup && !l.posibleDuplicado) return false;
    if (q.trim()) {
      const hay = `${l.fullName ?? ""} ${l.email ?? ""} ${l.companyName ?? ""} ${l.publicId ?? ""}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }), [leads, fStatus, fOwner, fSource, fDup, q]);

  // ── Indicadores ────────────────────────────────────────────────────────────
  const kpi = useMemo(() => ({
    total: leads.length,
    nuevos: leads.filter((l) => l.status === "nuevo").length,
    contactados: leads.filter((l) => l.status === "contactado").length,
    calificados: leads.filter((l) => l.status === "calificado").length,
    sinAsignar: leads.filter((l) => !l.ownerId).length,
    duplicados: leads.filter((l) => l.posibleDuplicado).length,
  }), [leads]);

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Comercial · CRM</div>
          <h1 className="page-title">Bandeja de Leads</h1>
          <p className="page-subtitle">
            Leads entrantes desde Clientify · fuente:{" "}
            <span className="font-semibold">{source === "supabase" ? "Supabase (crm_leads)" : "muestra local (sin tabla)"}</span>
          </p>
        </div>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
        <Kpi label="Total" value={kpi.total} />
        <Kpi label="Nuevos" value={kpi.nuevos} color="#2563eb" />
        <Kpi label="Contactados" value={kpi.contactados} color="#0891b2" />
        <Kpi label="Calificados" value={kpi.calificados} color="#16a34a" />
        <Kpi label="Sin asignar" value={kpi.sinAsignar} color="#d97706" />
        <Kpi label="Pos. duplicados" value={kpi.duplicados} color="#dc2626" />
      </div>

      {!writable && (
        <div className="mb-3 text-[11px] text-fg-muted">
          Vista de muestra — la reasignación y la calificación operan sobre datos reales (Supabase).
        </div>
      )}
      {feedback && (
        <div className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" role="status"
          style={{ background: feedback.kind === "ok" ? "#16a34a14" : "#dc262614", color: feedback.kind === "ok" ? "#16a34a" : "#dc2626" }}>
          <Icon name={feedback.kind === "ok" ? "check-circle" : "x"} size={14} /> {feedback.msg}
        </div>
      )}

      {/* Filtros */}
      <div className="nx-surface card p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <Icon name="search" size={14} className="text-fg-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre / email / empresa…"
            className="flex-1 bg-transparent text-sm outline-none" />
        </div>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value as LeadStatus | "")} className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1 text-xs">
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
        </select>
        <select value={fOwner} onChange={(e) => setFOwner(e.target.value)} className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1 text-xs">
          <option value="">Todos los owners</option>
          <option value="none">Sin asignar</option>
          {commercialUsers.map((u) => <option key={u.id} value={u.id}>{u.fullName ?? u.id.slice(0, 8)}</option>)}
        </select>
        {sources.length > 0 && (
          <select value={fSource} onChange={(e) => setFSource(e.target.value)} className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1 text-xs">
            <option value="">Todas las fuentes</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <button onClick={() => setFDup((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold"
          style={fDup ? { background: "#dc262614", color: "#dc2626", borderColor: "#dc2626" } : { borderColor: "var(--stroke-soft,#e2e8f0)", color: "var(--fg-muted,#64748b)" }}>
          <Icon name="filter" size={12} /> Posible duplicado
        </button>
      </div>

      {/* Tabla */}
      <div className="nx-surface card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-fg-muted text-[11px] uppercase tracking-wide border-b border-stroke-soft">
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Contacto</th>
              <th className="px-3 py-2">Fuente</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} className="border-b border-stroke-soft/60 hover:bg-bg-surface-alt transition-colors align-top">
                <td className="px-3 py-2 font-mono text-xs font-bold text-fg-brand whitespace-nowrap">{l.publicId ?? l.id.slice(0, 8)}</td>
                <td className="px-3 py-2">
                  <div className="font-semibold text-fg-primary flex items-center gap-1.5">
                    {l.fullName ?? "—"}
                    {l.posibleDuplicado && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#dc262614", color: "#dc2626" }}>
                        <Icon name="copy" size={9} /> dup
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-fg-muted">{l.companyName ?? "—"}{l.cuit ? ` · ${l.cuit}` : ""}</div>
                </td>
                <td className="px-3 py-2 text-[11px] text-fg-secondary">
                  <div>{l.email ?? "—"}</div>
                  <div className="text-fg-muted">{l.phone ?? ""}</div>
                </td>
                <td className="px-3 py-2 text-xs text-fg-secondary">{l.source ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded whitespace-nowrap" style={{ background: `${LEAD_STATUS_COLOR[l.status]}1a`, color: LEAD_STATUS_COLOR[l.status] }}>
                    {LEAD_STATUS_LABEL[l.status]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={l.ownerId ?? ""}
                    disabled={!writable || isPending || l.status === "promovido"}
                    onChange={(e) => run(() => reassignLead(l.id, e.target.value || null))}
                    className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1 text-xs max-w-[150px] disabled:opacity-50"
                  >
                    <option value="">{l.ownerName ?? "— sin asignar —"}</option>
                    {commercialUsers.map((u) => <option key={u.id} value={u.id}>{u.fullName ?? u.id.slice(0, 8)}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1 items-center">
                    {statusActions(l.status).map((a) => (
                      <button key={a.to} disabled={!writable || isPending}
                        onClick={() => run(() => setLeadStatus(l.id, a.to))}
                        className="btn btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: `${a.color}1a`, color: a.color }}>
                        {a.label}
                      </button>
                    ))}
                    {l.status === "calificado" && (
                      <button disabled={!writable || isPending}
                        onClick={() => { setPromotingId(promotingId === l.id ? null : l.id); setPromoM2(""); }}
                        className="btn btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: "#7c3aed", color: "#fff" }}>
                        <Icon name="arrow-up-right" size={12} /> Promover
                      </button>
                    )}
                    {l.status === "promovido" && (
                      l.opportunityId
                        ? <a href={`/comercial/oportunidades/${l.opportunityId}`} className="text-[11px] text-fg-brand font-semibold">ver oportunidad →</a>
                        : <span className="text-[11px] text-fg-muted italic">ya es oportunidad</span>
                    )}
                  </div>
                  {promotingId === l.id && writable && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-stroke-soft p-2 bg-bg-surface-alt">
                      <span className="text-[10px] uppercase tracking-wide text-fg-muted">Servicio</span>
                      <select value={promoSvc} onChange={(e) => setPromoSvc(e.target.value as CrmService)} disabled={isPending}
                        className="rounded border border-stroke-soft bg-bg-surface px-2 py-1 text-xs">
                        {SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}
                      </select>
                      <input value={promoM2} onChange={(e) => setPromoM2(e.target.value)} inputMode="numeric" placeholder="m² (opc.)" disabled={isPending}
                        className="w-20 rounded border border-stroke-soft bg-bg-surface px-2 py-1 text-xs" />
                      <button disabled={isPending} onClick={() => doPromote(l.id)} className="btn btn-sm disabled:opacity-50" style={{ background: "#7c3aed", color: "#fff" }}>
                        {isPending ? "Promoviendo…" : "Confirmar"}
                      </button>
                      <button disabled={isPending} onClick={() => setPromotingId(null)} className="btn btn-ghost btn-sm">Cancelar</button>
                      {!l.cuit && <span className="text-[10px] text-fg-muted">⚠ sin CUIT: requiere cliente enlazable</span>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-fg-muted italic">Sin leads para los filtros aplicados.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-fg-muted mt-4">
        Bandeja de leads. La <strong>promoción a oportunidad</strong> (calificado → Ficha 360°) está activa
        (F2.2-4). La sincronización <strong>outbound</strong> a Clientify queda fuera de este frente.
      </p>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg bg-bg-surface-alt px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-xl font-black tabular mt-0.5" style={{ color: color ?? "var(--fg-primary,#0f172a)" }}>{value}</div>
    </div>
  );
}
