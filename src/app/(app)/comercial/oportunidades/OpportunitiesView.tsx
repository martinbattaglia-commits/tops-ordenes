"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import {
  STAGE_LABEL, STAGE_COLOR, STAGE_ORDER, type Opportunity, type CrmService, type CrmStage,
} from "@/lib/comercial/crm-types";
import { opportunityDisplayTitle } from "@/lib/comercial/opportunity-title";

const SERVICE_TITLE: Record<CrmService, string> = {
  anmat: "Depósito ANMAT",
  general: "Almacenaje · Cargas Generales",
  oficinas: "Oficinas Corporativas",
};
function oppTitle(o: Opportunity): string {
  const base = SERVICE_TITLE[o.serviceType] ?? "Oportunidad";
  return o.m2 ? `${base} · ${o.m2} m²` : base;
}
function relTime(iso: string | null): string {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const days = Math.floor(d / 86400000);
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 7) return `Hace ${days} días`;
  if (days < 14) return "Hace 1 semana";
  if (days < 30) return `Hace ${Math.floor(days / 7)} semanas`;
  if (days < 60) return "Hace 1 mes";
  return `Hace ${Math.floor(days / 30)} meses`;
}
const money = (n: number | null, c: string) => (n == null ? "—" : `${c === "ARS" ? "$" : c + " "}${n.toLocaleString("es-AR")}`);

function StageBadge({ estado }: { estado: CrmStage }) {
  const hex = STAGE_COLOR[estado];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-pill"
      style={{ color: hex, background: `${hex}22`, border: `1px solid ${hex}55` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: hex }} />{STAGE_LABEL[estado]}
    </span>
  );
}
function OriginBadge({ pipeline }: { pipeline: string | null }) {
  if (!pipeline) return <span className="text-fg-muted text-xs">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-pill bg-tops-blue-700/15 text-fg-link border border-tops-blue-700/30">
      <Icon name="tag" size={10} />{pipeline}
    </span>
  );
}

const SITE_LABEL: Record<string, string> = {
  MAGALDI_1765: "Magaldi 1765",
  PEDRO_LUJAN_3159: "Pedro Luján 3159",
};

export function OpportunitiesView({ opps, source }: { opps: Opportunity[]; source: string }) {
  const [view, setView] = useState<"tabla" | "kanban">("kanban");

  // P2 — Reserva directa desde el mapa: el deep link trae la unidad a precargar.
  const sp = useSearchParams();
  const resSite = sp.get("resSite");
  const resUnit = sp.get("resUnit");
  const resCat = sp.get("resCat");
  const resM2 = sp.get("resM2");
  const reserveMode = Boolean(resSite && resUnit);
  const resQ = reserveMode
    ? "?" + new URLSearchParams(
        Object.entries({ resSite, resUnit, resCat, resM2 }).filter(
          (e): e is [string, string] => e[1] != null && e[1] !== "",
        ),
      ).toString()
    : "";

  // Buscador global client-side: filtra sobre las oportunidades ya cargadas
  // (sin llamadas nuevas). Match case- y acento-insensitive.
  const [q, setQ] = useState("");
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const filtered = useMemo(() => {
    const term = norm(q.trim());
    if (!term) return opps;
    return opps.filter((o) => {
      const hay = norm([
        opportunityDisplayTitle(o), // Título visible (deal name / empresa / contacto / servicio)
        o.dealName,           // Nombre real de la oportunidad (Clientify)
        o.empresa,            // Empresa (saneada anti-URL en el mapper)
        o.contacto,           // Contacto (contact_name)
        oppTitle(o),          // Oportunidad (title + service name)
        SERVICE_TITLE[o.serviceType],
        o.publicId,           // ID (public_id)
        o.pipeline,           // Pipeline (ANMAT / Cargas Generales / Oficinas)
        o.ownerName,
      ].filter(Boolean).join("  "));
      return hay.includes(term);
    });
  }, [opps, q]);

  const byStage = useMemo(() => {
    const m: Record<string, Opportunity[]> = {};
    for (const s of STAGE_ORDER) m[s] = [];
    for (const o of filtered) (m[o.estado] ??= []).push(o);
    return m;
  }, [filtered]);

  const tabBtn = (on: boolean) =>
    `inline-flex items-center gap-1.5 text-xs font-bold rounded-lg px-3.5 py-2 border transition-colors cursor-pointer ${on
      ? "bg-tops-blue-700 text-white border-tops-blue-700"
      : "bg-bg-surface-alt text-fg-secondary border-stroke-soft hover:text-fg-primary hover:border-tops-blue-700/40"}`;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Comercial · CRM</div>
          <h1 className="page-title">Oportunidades 360°</h1>
          <p className="page-subtitle">
            {q.trim() ? `${filtered.length} de ${opps.length} oportunidades` : `${opps.length} oportunidades`} · fuente: {source === "supabase" ? "Clientify → CRM360" : "muestra local"}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={tabBtn(view === "tabla")} onClick={() => setView("tabla")}><Icon name="menu" size={13} /> Tabla</button>
          <button type="button" className={tabBtn(view === "kanban")} onClick={() => setView("kanban")}><Icon name="dashboard" size={13} /> Kanban</button>
        </div>
      </div>

      {reserveMode && (
        <div className="nx-surface card mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-l-4"
          style={{ borderLeftColor: "#16a34a", background: "#16a34a10" }}>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: "#16a34a" }}>
            <Icon name="pin" size={13} /> Reserva desde el mapa
          </span>
          <span className="text-sm text-fg-primary">
            Unidad <span className="font-mono font-bold">{resUnit}</span>
            {resSite ? <> · {SITE_LABEL[resSite] ?? resSite}</> : null}
            {resCat ? <> · {resCat}</> : null}
            {resM2 ? <> · {resM2} m²</> : null}
          </span>
          <span className="text-[11px] text-fg-secondary">
            Abrí una oportunidad para precargar esta unidad en su pestaña <strong>Capacidad</strong>, o creá una nueva.
          </span>
        </div>
      )}

      {/* Buscador global — debajo del título, encima de las columnas. Tiempo real, sin botón. */}
      <div className="relative mb-4">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted text-sm">🔍</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar oportunidad, empresa, contacto o ID..."
          aria-label="Buscar oportunidades"
          className="w-full rounded-lg border border-stroke-soft bg-bg-surface pl-9 pr-9 py-2.5 text-sm text-fg-primary placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700 focus-visible:border-tops-blue-700"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Limpiar búsqueda"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-primary cursor-pointer">
            <Icon name="x" size={15} />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="nx-surface card flex flex-col items-center justify-center text-center py-16 px-6">
          <div className="w-12 h-12 rounded-full grid place-items-center bg-bg-surface-alt mb-3">
            <Icon name="search" size={20} className="text-fg-muted" />
          </div>
          <p className="text-sm font-bold text-fg-primary">No se encontraron oportunidades</p>
          <p className="text-[12px] text-fg-secondary mt-1">
            {q.trim() ? <>Sin coincidencias para <span className="font-semibold text-fg-primary">“{q.trim()}”</span>.</> : "No hay oportunidades para mostrar."}
          </p>
          {q && (
            <button type="button" onClick={() => setQ("")} className="btn btn-ghost btn-sm mt-3">
              <Icon name="x" size={13} /> Limpiar búsqueda
            </button>
          )}
        </div>
      ) : view === "tabla" ? (
        <div className="nx-surface card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted text-[10.5px] uppercase tracking-wide border-b border-stroke-soft">
                <th className="px-3 py-2.5">Empresa · Contacto</th>
                <th className="px-3 py-2.5">Oportunidad</th>
                <th className="px-3 py-2.5">Origen</th>
                <th className="px-3 py-2.5">Responsable</th>
                <th className="px-3 py-2.5">Últ. actividad</th>
                <th className="px-3 py-2.5">Etapa</th>
                <th className="px-3 py-2.5 text-right">Monto</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const empresa = opportunityDisplayTitle(o);
                return (
                  <tr key={o.id} className="border-b border-stroke-soft/60 hover:bg-bg-surface-alt transition-colors">
                    <td className="px-3 py-2.5">
                      <Link href={`/comercial/oportunidades/${o.id}${resQ}`} className="font-bold text-fg-link hover:underline">{empresa}</Link>
                      <div className="text-[11px] text-fg-secondary">{o.contacto ?? "—"}</div>
                      <div className="text-[9px] font-mono text-fg-muted mt-0.5">{o.publicId}</div>
                    </td>
                    <td className="px-3 py-2.5 text-fg-primary">{oppTitle(o)}</td>
                    <td className="px-3 py-2.5"><OriginBadge pipeline={o.pipeline} /></td>
                    <td className="px-3 py-2.5 text-fg-secondary">{o.ownerName}</td>
                    <td className="px-3 py-2.5 text-fg-secondary whitespace-nowrap">{relTime(o.lastActivityAt)}</td>
                    <td className="px-3 py-2.5"><StageBadge estado={o.estado} /></td>
                    <td className="px-3 py-2.5 text-right tabular font-semibold text-fg-primary whitespace-nowrap">{money(o.monto, o.currency)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Link href={`/comercial/oportunidades/${o.id}${resQ}`} className="btn btn-ghost btn-sm whitespace-nowrap">Ficha 360° <Icon name="chevron-right" size={12} /></Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {STAGE_ORDER.map((s) => {
            const col = byStage[s] ?? [];
            const hex = STAGE_COLOR[s];
            return (
              <div key={s} className="flex-shrink-0 w-72">
                <div className="flex items-center justify-between px-2 py-2 rounded-t-lg" style={{ background: `${hex}1a`, borderBottom: `2px solid ${hex}` }}>
                  <span className="text-xs font-bold" style={{ color: hex }}>{STAGE_LABEL[s]}</span>
                  <span className="text-[11px] tabular font-bold" style={{ color: hex }}>{col.length}</span>
                </div>
                <div className="space-y-2 mt-2 min-h-[40px]">
                  {col.map((o) => {
                    const empresa = opportunityDisplayTitle(o);
                    return (
                      <Link key={o.id} href={`/comercial/oportunidades/${o.id}${resQ}`}
                        className="block card p-3 nx-interactive border-l-4" style={{ borderLeftColor: hex }}>
                        <div className="font-bold text-fg-primary text-[13px] leading-tight truncate">{empresa}</div>
                        <div className="text-[11px] text-fg-secondary truncate">{o.contacto ?? oppTitle(o)}</div>
                        <div className="text-[11px] text-fg-muted mt-1 truncate">{oppTitle(o)}</div>
                        <div className="flex items-center justify-between mt-2">
                          <OriginBadge pipeline={o.pipeline} />
                          <span className="tabular text-[11px] font-semibold text-fg-primary">{money(o.monto, o.currency)}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1.5 text-[10px] text-fg-muted">
                          <span className="truncate">{o.ownerName}</span>
                          <span className="whitespace-nowrap">{relTime(o.lastActivityAt)}</span>
                        </div>
                      </Link>
                    );
                  })}
                  {col.length === 0 && <div className="text-[11px] text-fg-muted px-2 py-3">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
