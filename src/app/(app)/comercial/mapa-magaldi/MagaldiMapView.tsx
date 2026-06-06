"use client";

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import {
  MAGALDI_1765,
  getMagaldiCommercialSummary,
  CATEGORY_META,
  STATUS_META,
  FLOOR_LABEL,
  type MagaldiSpace,
  type SpaceCategory,
  type CommercialStatus,
  type FloorCode,
} from "@/lib/wms/magaldi1765-map";

type ViewKey = "comercial" | "infraestructura" | "anmat" | "general" | "coworking" | "corporativa" | "vacancia";
const VIEWS: Array<{ key: ViewKey; label: string; icon: IconName }> = [
  { key: "comercial", label: "Comercial", icon: "tag" },
  { key: "infraestructura", label: "Infraestructura", icon: "building" },
  { key: "anmat", label: "ANMAT", icon: "shield" },
  { key: "general", label: "Cargas Generales", icon: "package" },
  { key: "coworking", label: "Coworking", icon: "users" },
  { key: "corporativa", label: "Corporativa", icon: "user" },
  { key: "vacancia", label: "Vacancia", icon: "trend-up" },
];

type FilterKey = "todos" | "disponible" | "ocupado" | "anmat" | "general" | "oficina" | "con-racks" | "no-vendible";
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "disponible", label: "Disponible" },
  { key: "ocupado", label: "Ocupado" },
  { key: "anmat", label: "ANMAT" },
  { key: "general", label: "Cargas Generales" },
  { key: "oficina", label: "Oficinas" },
  { key: "con-racks", label: "Con racks" },
  { key: "no-vendible", label: "No vendible" },
];

const FLOORS: FloorCode[] = ["PA", "PB"];
const fmt = (n: number) => n.toLocaleString("es-AR");

export function MagaldiMapView() {
  const [view, setView] = useState<ViewKey>("comercial");
  const [filter, setFilter] = useState<FilterKey>("todos");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<MagaldiSpace | null>(null);

  const summary = useMemo(() => getMagaldiCommercialSummary(), []);
  const totals = MAGALDI_1765.meta.totals;
  const cwp = MAGALDI_1765.coworkingPremium;
  const q = query.trim().toLowerCase();

  const inView = (s: MagaldiSpace): boolean => {
    switch (view) {
      case "anmat":
        return s.category === "anmat";
      case "general":
        return s.category === "general";
      case "coworking":
        return s.category === "coworking" || (s.category === "oficina" && s.status === "disponible");
      case "corporativa":
        return s.status === "interno" || s.category === "publica";
      case "vacancia":
        return s.status === "disponible";
      default:
        return true; // comercial, infraestructura
    }
  };

  const passesFilter = (s: MagaldiSpace): boolean => {
    switch (filter) {
      case "disponible":
        return s.status === "disponible";
      case "ocupado":
        return s.status === "ocupado";
      case "anmat":
        return s.category === "anmat";
      case "general":
        return s.category === "general";
      case "oficina":
        return s.category === "oficina" || s.category === "coworking";
      case "con-racks":
        return s.rackPositions != null;
      case "no-vendible":
        return s.status === "na" || s.status === "interno";
      default:
        return true;
    }
  };

  const passesQuery = (s: MagaldiSpace): boolean =>
    !q || `${s.id} ${s.name} ${s.category} ${s.status}`.toLowerCase().includes(q);

  const visible = MAGALDI_1765.spaces.filter((s) => inView(s) && passesFilter(s) && passesQuery(s));
  const byFloor = (f: FloorCode) => visible.filter((s) => s.floor === f);

  const legendItems =
    view === "comercial" || view === "vacancia"
      ? (Object.keys(STATUS_META) as CommercialStatus[]).map((k) => ({ label: STATUS_META[k].label, color: STATUS_META[k].color }))
      : (Object.keys(CATEGORY_META) as SpaceCategory[]).map((k) => ({ label: CATEGORY_META[k].label, color: CATEGORY_META[k].color }));

  return (
    <div className="p-4 lg:p-8 nx-page-fade" id="magaldi-map-root">
      <PrintStyles />

      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Comercial · Digital Twin Corporativo</div>
          <h1 className="page-title">Sede Central — Agustín Magaldi 1765</h1>
          <p className="page-subtitle">
            CD Central · VEROTIN S.A. · Infraestructura y disponibilidad comercial · Cubierta registrada{" "}
            {fmt(totals.cubiertaM2)} m² (Cert. 460/19) · Relevamiento {MAGALDI_1765.meta.relevamiento}
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <button onClick={() => exportCsv()} className="btn btn-ghost btn-sm" aria-label="Exportar CSV">
            <Icon name="download" size={13} /> CSV
          </button>
          <button onClick={() => window.print()} className="btn btn-ghost btn-sm" aria-label="Imprimir o PDF">
            <Icon name="file-pdf" size={13} /> PDF
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <Kpi label="Cubierta total" value={`${fmt(totals.cubiertaM2)} m²`} icon="building" />
        <Kpi label="ANMAT disponible" value={`${fmt(summary.anmatDisponibleM2)} m²`} icon="shield" tone="#2563eb" />
        <Kpi label="CG disponible" value={`${fmt(summary.generalDisponibleM2)} m²`} icon="package" tone="#dc2626" />
        <Kpi label="Oficinas disp." value={`${fmt(summary.oficinaVendibleDisponibleM2)} m²`} icon="user" tone="#16a34a" />
        <Kpi label="Coworking" value={`${cwp.islasTotal} islas`} icon="users" tone="#0d9488" />
        <Kpi label="Racks (selec.)" value={`${fmt(summary.rackPositionsDisponibles)} / ${fmt(totals.rackPositionsTotal)}`} icon="package" tone="#1e293b" />
      </div>

      {/* Vistas */}
      <div className="flex flex-wrap items-center gap-2 mb-4 no-print">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all border"
            style={
              view === v.key
                ? { background: "var(--fg-brand, #0f172a)", color: "#fff", borderColor: "transparent" }
                : { background: "transparent", borderColor: "var(--stroke-soft, #e2e8f0)" }
            }
          >
            <Icon name={v.icon} size={13} /> {v.label}
          </button>
        ))}
      </div>

      {/* Filtros + buscador */}
      <div className="flex flex-wrap items-center gap-2 mb-5 no-print">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-all"
              style={filter === f.key ? { background: "var(--fg-brand, #0f172a)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--stroke-soft, #e2e8f0)" }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[200px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted">
            <Icon name="search" size={13} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar sector, oficina…"
            className="w-full rounded-lg border border-stroke-soft bg-bg-surface-alt pl-8 pr-3 py-1.5 text-xs outline-none focus:border-fg-brand"
          />
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5 text-[11px] text-fg-secondary">
        {legendItems.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>

      {/* Panel especial Coworking Premium */}
      {view === "coworking" && <CoworkingPremiumPanel />}

      {/* Panel especial Vacancia */}
      {view === "vacancia" && <VacancyPanel summary={summary} />}

      {visible.length === 0 && view !== "vacancia" && (
        <div className="text-sm text-fg-muted italic py-10 text-center">Sin resultados para el filtro / búsqueda actual.</div>
      )}

      {/* Espacios por planta */}
      <div className="flex flex-col gap-6">
        {FLOORS.map((f) => {
          const spaces = byFloor(f);
          if (spaces.length === 0) return null;
          return (
            <section key={f} className="nx-surface card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-stroke-soft flex items-center gap-2">
                <Icon name="building" size={14} className="text-fg-muted" />
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-secondary">{FLOOR_LABEL[f]}</span>
                <span className="text-[11px] text-fg-muted ml-auto">{spaces.length} espacios</span>
              </div>
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
                {spaces.map((s) => (
                  <SpaceCard key={s.id} space={s} view={view} onClick={() => setSel(s)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-[11px] text-fg-muted mt-6 leading-relaxed">
        Fuente: {MAGALDI_1765.meta.sources.join(" · ")}. Inventario validado por cruce (ANMAT 1.441 m² · CG 2.520 m² ·
        racks 964 · coworking 50 m² + 11 islas). Capa local · no Supabase. Maniobra descubierta ({fmt(totals.maniobraDescubiertaM2)} m²)
        y ~{fmt(totals.cubiertaNoDesglosadaM2Approx)} m² de cubierta no desglosada (oficinas internas/públicas/servicios) — ver inconsistencias M-3/M-4.
      </p>

      {sel && <SidePanel space={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────────────

function Kpi({ label, value, icon, tone }: { label: string; value: string; icon: IconName; tone?: string }) {
  return (
    <div className="nx-surface card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
        <span style={tone ? { color: tone } : undefined}>
          <Icon name={icon} size={12} />
        </span>
        {label}
      </div>
      <div className="text-lg font-bold tabular mt-0.5" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

function SpaceCard({ space, view, onClick }: { space: MagaldiSpace; view: ViewKey; onClick: () => void }) {
  const cat = CATEGORY_META[space.category];
  const st = STATUS_META[space.status];
  // Color principal según vista: comercial/vacancia → estado; resto → categoría
  const useStatus = view === "comercial" || view === "vacancia";
  const main = useStatus ? st.color : cat.color;
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg p-2.5 border-2 transition-all hover:shadow-md focus:outline-none"
      style={{ borderColor: useStatus ? st.color : cat.color, background: `${main}0d` }}
      title={`${space.name} · ${cat.label} · ${st.label}${space.m2 != null ? ` · ${space.m2} m²` : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-bold uppercase tracking-wide" style={{ color: cat.color }}>
          {cat.label.split(" ")[0]}
        </span>
        <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
      </div>
      <div className="font-mono text-sm font-bold text-fg-primary mt-0.5 leading-tight">{space.name}</div>
      <div className="text-[11px] text-fg-muted tabular mt-0.5">
        {space.m2 != null ? `${fmt(space.m2)} m²` : "—"}
        {space.rackPositions != null ? ` · ${space.rackPositions} pos` : ""}
      </div>
      <div
        className="inline-block text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded mt-1"
        style={{ background: `${st.color}1a`, color: st.color }}
      >
        {st.label}
      </div>
    </button>
  );
}

function CoworkingPremiumPanel() {
  const cwp = MAGALDI_1765.coworkingPremium;
  return (
    <div className="nx-surface card p-4 mb-5" style={{ borderLeft: `4px solid ${CATEGORY_META.coworking.color}` }}>
      <div className="flex items-center gap-2 mb-3">
        <Icon name="sparkle" size={16} style={{ color: CATEGORY_META.coworking.color }} />
        <span className="font-bold text-fg-primary">Coworking Premium — 100% disponible</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Kpi label="Islas comercializables" value={`${cwp.islasTotal}`} icon="users" tone="#0d9488" />
        <Kpi label="Puestos de trabajo" value={`${cwp.puestosTotal}`} icon="user" tone="#0d9488" />
        <Kpi label="Disponible" value={`${cwp.disponiblePct}%`} icon="check-circle" tone="#16a34a" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        {cwp.composicion.map((c) => (
          <div key={c.tipo} className="rounded-lg border border-stroke-soft p-2.5 text-center bg-bg-surface-alt">
            <div className="text-xl font-bold" style={{ color: CATEGORY_META.coworking.color }}>
              {c.islas}
            </div>
            <div className="text-[11px] text-fg-secondary">
              {c.tipo} · {c.puestosPorIsla * c.islas} puestos
            </div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-fg-secondary">
        <span className="font-semibold">Incluye:</span> {cwp.incluye.join(" · ")}
      </div>
    </div>
  );
}

function VacancyPanel({ summary }: { summary: ReturnType<typeof getMagaldiCommercialSummary> }) {
  const rows = [
    { label: "ANMAT disponible", value: `${fmt(summary.anmatDisponibleM2)} m²`, sub: "Sector PB30", color: "#2563eb" },
    { label: "Cargas Generales disponible", value: `${fmt(summary.generalDisponibleM2)} m²`, sub: "Sin disponibilidad hoy", color: "#dc2626" },
    { label: "Oficinas vendibles", value: `${fmt(summary.oficinaVendibleDisponibleM2)} m²`, sub: "OF PA1–PA4", color: "#16a34a" },
    { label: "Coworking Premium", value: `${summary.coworking.islas} islas`, sub: `${summary.coworking.puestos} puestos · ${summary.coworking.disponiblePct}%`, color: "#0d9488" },
    { label: "Racks selectivos libres", value: `${fmt(summary.rackPositionsDisponibles)} / ${fmt(summary.rackPositionsTotal)}`, sub: "PB1/PB4 ocupados", color: "#1e293b" },
    { label: "Total vendible disponible", value: `${fmt(summary.vendibleDisponibleM2)} m²`, sub: "ANMAT + CG + oficinas", color: "#0f172a" },
  ];
  return (
    <div className="nx-surface card p-4 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="trend-up" size={16} className="text-fg-muted" />
        <span className="font-bold text-fg-primary">Vacancia y capacidad disponible — Magaldi 1765</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className="rounded-lg border-2 p-3" style={{ borderColor: r.color }}>
            <div className="text-[11px] uppercase tracking-wide text-fg-muted">{r.label}</div>
            <div className="text-xl font-bold tabular" style={{ color: r.color }}>
              {r.value}
            </div>
            <div className="text-[11px] text-fg-muted">{r.sub}</div>
          </div>
        ))}
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

function SidePanel({ space, onClose }: { space: MagaldiSpace; onClose: () => void }) {
  const cat = CATEGORY_META[space.category];
  const st = STATUS_META[space.status];
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 no-print" onClick={onClose} aria-hidden />
      <aside className="fixed right-0 top-0 h-full w-full max-w-sm bg-bg-surface z-50 shadow-2xl border-l border-stroke-soft overflow-y-auto no-print">
        <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between sticky top-0 bg-bg-surface">
          <span className="font-bold text-fg-primary">Detalle del espacio</span>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Cerrar">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="p-4">
          <div className="font-mono text-2xl font-bold text-fg-primary">{space.name}</div>
          <div className="flex items-center gap-2 mt-1 mb-3 flex-wrap">
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: `${cat.color}1a`, color: cat.color }}>
              {cat.label}
            </span>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: `${st.color}1a`, color: st.color }}>
              {st.label}
            </span>
          </div>
          <Row label="Superficie" value={space.m2 != null ? `${fmt(space.m2)} m²` : "sin dato en croquis"} />
          <Row label="Piso" value={FLOOR_LABEL[space.floor]} />
          <Row label="Código" value={space.id} />
          {space.rackPositions != null && <Row label="Racks selectivos" value={`${space.rackPositions} posiciones`} />}
          {space.note && (
            <p className="text-xs text-fg-secondary bg-bg-surface-alt rounded-lg p-2.5 mt-3 leading-relaxed">{space.note}</p>
          )}
          <div className="text-[10px] text-fg-muted mt-3">Fuente: {MAGALDI_1765.meta.sources.join(" · ")}</div>
        </div>
      </aside>
    </>
  );
}

function PrintStyles() {
  return (
    <style>{`
      @media print {
        .no-print { display: none !important; }
        #magaldi-map-root { padding: 0 !important; }
        .nx-surface { box-shadow: none !important; border: 1px solid #ccc !important; }
        @page { size: A4 landscape; margin: 10mm; }
      }
    `}</style>
  );
}

// ── Exportación CSV ─────────────────────────────────────────────────────────

function exportCsv() {
  const headers = ["id", "nombre", "categoria", "estado", "piso", "m2", "racks_posiciones", "nota"];
  const rows = MAGALDI_1765.spaces.map((s) => [
    s.id,
    s.name,
    s.category,
    s.status,
    s.floor,
    s.m2 != null ? String(s.m2) : "",
    s.rackPositions != null ? String(s.rackPositions) : "",
    s.note ?? "",
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(";"))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "magaldi_1765_disponibilidad.csv";
  a.click();
  URL.revokeObjectURL(url);
}
