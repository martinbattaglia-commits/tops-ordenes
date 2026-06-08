"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import {
  LUJAN_3159,
  getCommercialAvailabilitySummary,
  type Sector,
  type CubicleBlock,
  type Cubicle,
  type CommercialStatus,
  type HabilitationCategory,
  type FloorCode,
} from "@/lib/wms/lujan3159-map";
import {
  UNIT_STATE_LABEL, UNIT_STATE_COLOR, UNIT_STATE_ORDER, type CrmUnitState,
} from "@/lib/comercial/crm-types";

// ── Estado efectivo: crm_units (verdad) con fallback al modelo estático ──────
function legacyLujanSector(status: CommercialStatus): CrmUnitState {
  return status === "ocupado" ? "ocupada" : "disponible"; // 'parcial' → disponible (tiene capacidad)
}
function legacyLujanCubicle(status: "ocupado" | "disponible"): CrmUnitState {
  return status === "ocupado" ? "ocupada" : "disponible";
}

// ── Metadatos de color (categoría) ───────────────────────────────────────────

const CATEGORY_META: Record<HabilitationCategory, { label: string; color: string }> = {
  general: { label: "Cargas Generales", color: "#e11d48" }, // coral
  anmat: { label: "ANMAT", color: "#2563eb" }, // azul
};

const RACK_COLOR = "#1e293b"; // navy industrial

const FLOOR_LABEL: Record<FloorCode, string> = {
  PB: "Planta Baja",
  P1: "1º Piso",
  P2: "2º Piso",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  exact: "Exacto",
  approximate: "Estimado",
  pending: "A confirmar",
};

type ViewKey = "comercial" | "infraestructura" | "anmat" | "racks";
const VIEWS: Array<{ key: ViewKey; label: string; icon: IconName }> = [
  { key: "comercial", label: "Comercial", icon: "tag" },
  { key: "infraestructura", label: "Infraestructura", icon: "building" },
  { key: "anmat", label: "ANMAT", icon: "shield" },
  { key: "racks", label: "Racks", icon: "package" },
];

type FilterKey =
  | "todos"
  | "disponible"
  | "ocupado"
  | "parcial"
  | "anmat"
  | "general"
  | "con-racks"
  | "cubiculos";
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "disponible", label: "Disponible" },
  { key: "ocupado", label: "Ocupado" },
  { key: "parcial", label: "Parcial" },
  { key: "anmat", label: "ANMAT" },
  { key: "general", label: "Cargas Generales" },
  { key: "con-racks", label: "Con racks" },
  { key: "cubiculos", label: "Cubículos" },
];

const FLOORS: FloorCode[] = ["PB", "P1", "P2"];

// ── Tipo de selección para el panel lateral ─────────────────────────────────

type Selection =
  | { kind: "sector"; sector: Sector }
  | { kind: "cubicle"; block: CubicleBlock; cubicle: Cubicle }
  | null;

const fmt = (n: number) => n.toLocaleString("es-AR");

export function LujanMapView({ unitStates }: { unitStates?: Record<string, CrmUnitState> }) {
  const [view, setView] = useState<ViewKey>("comercial");
  const [filter, setFilter] = useState<FilterKey>("todos");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<Selection>(null);

  const summary = useMemo(() => getCommercialAvailabilitySummary(), []);
  const totals = LUJAN_3159.meta.totals;

  const q = query.trim().toLowerCase();

  // Estado efectivo desde crm_units (fuente única); fallback al modelo estático.
  const sectorState = (s: Sector): CrmUnitState => unitStates?.[s.code] ?? legacyLujanSector(s.occupancy.status);
  const cubicleState = (b: CubicleBlock, c: Cubicle): CrmUnitState =>
    unitStates?.[`${b.code}-${c.code}`] ?? legacyLujanCubicle(c.status);

  const sectorMatches = (s: Sector): boolean => {
    if (view === "anmat" && s.category !== "anmat") return false;
    if (view === "racks" && !s.rack) return false;
    if (filter === "cubiculos") return false;
    if (filter === "disponible" && sectorState(s) !== "disponible") return false;
    if (filter === "ocupado" && sectorState(s) !== "ocupada") return false;
    if (filter === "parcial" && s.occupancy.status !== "parcial") return false;
    if (filter === "anmat" && s.category !== "anmat") return false;
    if (filter === "general" && s.category !== "general") return false;
    if (filter === "con-racks" && !s.rack) return false;
    if (q) {
      const hay = `${s.code} ${s.name} ${s.occupancy.client ?? ""} ${s.category} ${sectorState(s)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const blockVisible = (b: CubicleBlock): boolean => {
    if (view === "racks") return false;
    if (filter === "ocupado" || filter === "general" || filter === "con-racks") return false;
    if (filter === "disponible" && !b.cubicles.some((c) => cubicleState(b, c) === "disponible")) return false;
    if (q) {
      const hay = `${b.code} ${b.name} ${b.cubicles.map((c) => c.client ?? "").join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const sectorsByFloor = (f: FloorCode) => LUJAN_3159.sectors.filter((s) => s.floor === f && sectorMatches(s));
  const blocksByFloor = (f: FloorCode) => LUJAN_3159.cubicleBlocks.filter((b) => b.floor === f && blockVisible(b));

  const visibleCount =
    LUJAN_3159.sectors.filter(sectorMatches).length + LUJAN_3159.cubicleBlocks.filter(blockVisible).length;

  return (
    <div className="p-4 lg:p-8 nx-page-fade" id="lujan-map-root">
      <PrintStyles />

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Comercial · Digital Twin Premium</div>
          <h1 className="page-title">Mapa Comercial — Pedro Luján 3159</h1>
          <p className="page-subtitle">
            Espacios ocupados por cliente vs. disponibles para comercializar · Barracas, CABA ·
            Relevamiento {LUJAN_3159.meta.relevamiento}
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

      {/* Resumen comercial */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <Kpi label="Superficie total" value={`${fmt(totals.storageM2)} m²`} icon="building" />
        <Kpi label="Ocupada (aprox.)" value={`${fmt(summary.occupiedM2)} m²`} icon="lock" tone="#dc2626" />
        <Kpi label="Disponible (aprox.)" value={`${fmt(summary.availableM2)} m²`} icon="check-circle" tone="#16a34a" />
        <Kpi label="% libre" value={`${summary.availablePct}%`} icon="trend-up" tone="#16a34a" />
        <Kpi
          label="Posiciones libres"
          value={`${fmt(summary.availableRackPositions)} / ${fmt(totals.rackPositionsTotal)}`}
          icon="package"
          tone={RACK_COLOR}
        />
        <Kpi label="Cubículos libres" value={`${summary.availableAnmatCubicles}`} icon="shield" tone="#2563eb" />
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
                ? { background: "var(--tops-blue-900, #050555)", color: "#fff", borderColor: "transparent" }
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
              style={
                filter === f.key
                  ? { background: "var(--tops-blue-900, #050555)", color: "#fff", borderColor: "transparent" }
                  : { borderColor: "var(--stroke-soft, #e2e8f0)" }
              }
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
            placeholder="Buscar depósito, cliente…"
            className="w-full rounded-lg border border-stroke-soft bg-bg-surface-alt pl-8 pr-3 py-1.5 text-xs outline-none focus:border-fg-brand"
          />
        </div>
      </div>

      {/* Leyenda */}
      <Legend />

      {visibleCount === 0 && (
        <div className="text-sm text-fg-muted italic py-10 text-center">
          Sin resultados para el filtro / búsqueda actual.
        </div>
      )}

      {/* Plantas */}
      <div className="flex flex-col gap-6">
        {FLOORS.map((f) => {
          const secs = sectorsByFloor(f);
          const blocks = blocksByFloor(f);
          if (secs.length === 0 && blocks.length === 0) return null;
          return (
            <section key={f} className="nx-surface card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-stroke-soft flex items-center gap-2">
                <Icon name="building" size={14} className="text-fg-muted" />
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-secondary">
                  {FLOOR_LABEL[f]}
                </span>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {secs.map((s) => (
                  <SectorCard key={s.code} sector={s} view={view} state={sectorState(s)} onClick={() => setSel({ kind: "sector", sector: s })} />
                ))}
                {blocks.map((b) => (
                  <CubicleBlockCard key={b.code} block={b} cubState={(c) => cubicleState(b, c)} onPick={(c) => setSel({ kind: "cubicle", block: b, cubicle: c })} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-[11px] text-fg-muted mt-6 leading-relaxed">
        Fuente: {LUJAN_3159.meta.sources.map((s) => s.doc).join(" · ")}. Datos marcados como
        «Estimado»/«A confirmar» según relevamiento de Dirección. Capa local · no Supabase ·
        ver inconsistencias documentadas (PA4/PA5, PB3, PB6).
      </p>

      {/* Panel lateral */}
      {sel && <SidePanel selection={sel} unitStates={unitStates} onClose={() => setSel(null)} />}
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

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5 text-[11px] text-fg-secondary">
      {UNIT_STATE_ORDER.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded" style={{ background: UNIT_STATE_COLOR[s] }} />
          {UNIT_STATE_LABEL[s]}
        </span>
      ))}
      <span className="w-px h-3 bg-stroke-soft hidden sm:block" />
      {(Object.keys(CATEGORY_META) as HabilitationCategory[]).map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-2" style={{ borderColor: CATEGORY_META[c].color }} />
          {CATEGORY_META[c].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded" style={{ background: RACK_COLOR }} />
        Racks Mecalux
      </span>
    </div>
  );
}

function ConfidencePill({ level }: { level: string }) {
  if (level === "exact") return null;
  const color = level === "pending" ? "#7c3aed" : "#ea580c";
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{ background: `${color}1a`, color }}
    >
      {CONFIDENCE_LABEL[level] ?? level}
    </span>
  );
}

function SectorCard({ sector, view, state, onClick }: { sector: Sector; view: ViewKey; state: CrmUnitState; onClick: () => void }) {
  const st = { color: UNIT_STATE_COLOR[state], label: UNIT_STATE_LABEL[state] };
  const cat = CATEGORY_META[sector.category];
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl p-3 border-2 nx-interactive cursor-pointer focus-visible:outline-none focus-visible:ring-2"
      style={{
        borderColor: cat.color,
        background: `${st.color}0d`,
        // Glow semántico por estado (verde/rojo/naranja) reutilizando nx-interactive.
        "--nx-accent": `${st.color}55`,
        "--nx-glow": `${st.color}66`,
        "--nx-border": st.color,
        "--tw-ring-color": st.color,
      } as CSSProperties}
      title={`${sector.code} · ${st.label}${sector.occupancy.client ? ` · ${sector.occupancy.client}` : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: cat.color }}>
          {cat.label}
        </span>
        <span className="inline-flex items-center gap-1">
          <ConfidencePill level={sector.occupancy.confidence} />
          <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
        </span>
      </div>
      <div className="font-mono text-base font-bold text-fg-primary mt-0.5">{sector.code}</div>
      <div
        className="inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded mt-1"
        style={{ background: `${st.color}1a`, color: st.color }}
      >
        {st.label}
      </div>
      <div className="text-sm font-semibold text-fg-secondary mt-1.5">
        {sector.occupancy.client ?? "Libre"}
      </div>

      {view === "racks" && sector.rack ? (
        <div className="text-[11px] text-fg-muted mt-1 tabular">
          {fmt(sector.rack.positions)} pos · {sector.rack.system} · {sector.rack.unidadCargaKg} kg
          <div className="text-[10px]">Plano {sector.rack.plano}</div>
        </div>
      ) : view === "infraestructura" ? (
        <div className="text-[11px] text-fg-muted mt-1 tabular">
          {fmt(sector.surfaceM2)} m²{sector.rack ? ` · ${fmt(sector.rack.positions)} pos` : ""}
        </div>
      ) : (
        <div className="text-[11px] text-fg-muted mt-1 tabular">
          {fmt(sector.surfaceM2)} m²
          {sector.occupancy.availableM2 != null && sector.occupancy.availableM2 > 0 && state !== "disponible"
            ? ` · disp. ${fmt(sector.occupancy.availableM2)} m²`
            : ""}
          {sector.rack ? ` · ${fmt(sector.rack.positions)} pos` : ""}
        </div>
      )}
    </button>
  );
}

function CubicleBlockCard({ block, cubState, onPick }: { block: CubicleBlock; cubState: (c: Cubicle) => CrmUnitState; onPick: (c: Cubicle) => void }) {
  const cat = CATEGORY_META.anmat;
  const occ = block.cubicles.filter((c) => cubState(c) === "ocupada").length;
  const free = block.cubicles.length - occ;
  return (
    <div
      className="rounded-xl p-3 border-2 sm:col-span-2"
      style={{ borderColor: cat.color, background: `${cat.color}08` }}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: cat.color }}>
            {cat.label} · Cubículos
          </span>
          <div className="font-mono text-base font-bold text-fg-primary flex items-center gap-1.5">
            {block.code} <ConfidencePill level={block.confidence} />
          </div>
        </div>
        <div className="text-right text-[11px] text-fg-muted tabular">
          {fmt(block.totalM2)} m²
          <div>
            <span style={{ color: "#16a34a" }}>{free} libres</span> · {occ} ocup.
          </div>
        </div>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {block.cubicles.map((c) => {
          const st = { color: UNIT_STATE_COLOR[cubState(c)], label: UNIT_STATE_LABEL[cubState(c)] };
          return (
            <button
              key={c.code}
              onClick={() => onPick(c)}
              className="rounded px-1 py-1.5 text-center transition-all duration-200 ease-out hover:scale-105 cursor-pointer focus-visible:outline-none focus-visible:ring-2"
              style={{ background: `${st.color}1a`, border: `1px solid ${st.color}`, color: st.color, "--tw-ring-color": st.color } as CSSProperties}
              title={`${c.code} · ${st.label}${c.client ? ` · ${c.client}` : ""} · ${c.surfaceM2} m²`}
            >
              <div className="text-[11px] font-bold tabular">{c.code.replace("C0", "").replace("C", "")}</div>
              <div className="text-[8px] opacity-80">{c.surfaceM2}m²</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SidePanel({ selection, unitStates, onClose }: { selection: NonNullable<Selection>; unitStates?: Record<string, CrmUnitState>; onClose: () => void }) {
  // Portal a document.body: el drawer `fixed` debe ser relativo al VIEWPORT, no al
  // contenedor con transform (.nx-page-fade / main.scroll-area). Sin portal, el
  // transform crea un containing block y el drawer se va con el scroll.
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/30 z-40 no-print" onClick={onClose} aria-hidden />
      <aside className="fixed right-0 top-0 h-full w-full max-w-sm bg-bg-surface z-50 shadow-2xl border-l border-stroke-soft overflow-y-auto no-print">
        <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between sticky top-0 bg-bg-surface">
          <span className="font-bold text-fg-primary">Detalle</span>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Cerrar">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="p-4">
          {selection.kind === "sector" ? <SectorDetail sector={selection.sector} unitStates={unitStates} /> : <CubicleDetail block={selection.block} cubicle={selection.cubicle} unitStates={unitStates} />}
        </div>
      </aside>
    </>,
    document.body
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

function SectorDetail({ sector, unitStates }: { sector: Sector; unitStates?: Record<string, CrmUnitState> }) {
  const state = unitStates?.[sector.code] ?? legacyLujanSector(sector.occupancy.status);
  const st = { color: UNIT_STATE_COLOR[state], label: UNIT_STATE_LABEL[state] };
  const cat = CATEGORY_META[sector.category];
  return (
    <div>
      <div className="font-mono text-2xl font-bold text-fg-primary">{sector.code}</div>
      <div className="flex items-center gap-2 mt-1 mb-3">
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: `${cat.color}1a`, color: cat.color }}>
          {cat.label}
        </span>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: `${st.color}1a`, color: st.color }}>
          {st.label}
        </span>
        <ConfidencePill level={sector.occupancy.confidence} />
      </div>
      <Row label="Cliente" value={sector.occupancy.client ?? "Libre"} />
      <Row label="Superficie" value={`${fmt(sector.surfaceM2)} m²`} />
      {sector.occupancy.occupiedM2 != null && <Row label="Ocupado" value={`${fmt(sector.occupancy.occupiedM2)} m²`} />}
      {sector.occupancy.availableM2 != null && <Row label="Disponible" value={`${fmt(sector.occupancy.availableM2)} m²`} />}
      <Row label="Piso" value={FLOOR_LABEL[sector.floor]} />
      {sector.rack && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wide text-fg-secondary mt-4 mb-1">Racks Mecalux</div>
          <Row label="Posiciones" value={sector.rack.positionsDetail ?? fmt(sector.rack.positions)} />
          <Row label="Sistema" value={sector.rack.system} />
          <Row label="Unidad de carga" value={`${sector.rack.unidadCargaKg} kg`} />
          <Row label="Plano" value={`${sector.rack.plano}${sector.rack.rev ? ` rev.${sector.rack.rev}` : ""}`} />
          {sector.rack.fecha && <Row label="Fecha plano" value={sector.rack.fecha} />}
        </>
      )}
      {sector.occupancy.note && (
        <p className="text-xs text-fg-secondary bg-bg-surface-alt rounded-lg p-2.5 mt-3 leading-relaxed">
          {sector.occupancy.note}
        </p>
      )}

      {/* P2 · Reserva directa desde el mapa */}
      {state === "disponible" ? (
        <Link
          href={`/comercial/oportunidades?resSite=PEDRO_LUJAN_3159&resUnit=${encodeURIComponent(sector.code)}&resCat=${sector.category}&resM2=${sector.surfaceM2}`}
          className="nx-interactive mt-4 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-bold text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700"
          style={{ background: "#16a34a" } as CSSProperties}
        >
          <Icon name="plus" size={14} stroke={2.2} /> Reservar unidad
        </Link>
      ) : (
        <div className="mt-4 rounded-lg px-3 py-2.5 text-sm font-semibold text-center" style={{ background: `${st.color}1a`, color: st.color } as CSSProperties}>
          {st.label} · sin acción
        </div>
      )}

      <div className="text-[10px] text-fg-muted mt-3">
        Fuente: {sector.sources.map((s) => s.doc).join(" · ")}
      </div>
    </div>
  );
}

function CubicleDetail({ block, cubicle, unitStates }: { block: CubicleBlock; cubicle: Cubicle; unitStates?: Record<string, CrmUnitState> }) {
  const state = unitStates?.[`${block.code}-${cubicle.code}`] ?? legacyLujanCubicle(cubicle.status);
  const st = { color: UNIT_STATE_COLOR[state], label: UNIT_STATE_LABEL[state] };
  return (
    <div>
      <div className="font-mono text-2xl font-bold text-fg-primary">
        {block.code} · {cubicle.code}
      </div>
      <div className="flex items-center gap-2 mt-1 mb-3">
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: `${CATEGORY_META.anmat.color}1a`, color: CATEGORY_META.anmat.color }}>
          ANMAT
        </span>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: `${st.color}1a`, color: st.color }}>
          {st.label}
        </span>
        <ConfidencePill level={block.confidence} />
      </div>
      <Row label="Cliente" value={cubicle.client ?? "Libre"} />
      <Row label="Superficie" value={`${cubicle.surfaceM2} m²`} />
      <Row label="Piso" value={FLOOR_LABEL[block.floor]} />

      {/* P2 · Reserva directa desde el mapa */}
      {state === "disponible" ? (
        <Link
          href={`/comercial/oportunidades?resSite=PEDRO_LUJAN_3159&resUnit=${encodeURIComponent(`${block.code}-${cubicle.code}`)}&resCat=anmat&resM2=${cubicle.surfaceM2}`}
          className="nx-interactive mt-4 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-bold text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700"
          style={{ background: "#16a34a" } as CSSProperties}
        >
          <Icon name="plus" size={14} stroke={2.2} /> Reservar unidad
        </Link>
      ) : (
        <div className="mt-4 rounded-lg px-3 py-2.5 text-sm font-semibold text-center" style={{ background: `${st.color}1a`, color: st.color } as CSSProperties}>
          {st.label} · sin acción
        </div>
      )}
      {block.note && (
        <p className="text-xs text-fg-secondary bg-bg-surface-alt rounded-lg p-2.5 mt-3 leading-relaxed">{block.note}</p>
      )}
      <div className="text-[10px] text-fg-muted mt-3">Fuente: {block.sources.map((s) => s.doc).join(" · ")}</div>
    </div>
  );
}

function PrintStyles() {
  return (
    <style>{`
      @media print {
        .no-print { display: none !important; }
        #lujan-map-root { padding: 0 !important; }
        .nx-surface { box-shadow: none !important; border: 1px solid #ccc !important; }
        @page { size: A4 landscape; margin: 10mm; }
      }
    `}</style>
  );
}

// ── Exportación CSV ─────────────────────────────────────────────────────────

function exportCsv() {
  const headers = ["codigo", "categoria", "piso", "estado", "cliente", "superficie_m2", "ocupado_m2", "disponible_m2", "racks_posiciones", "rack_plano", "confianza"];
  const rows: string[][] = [];
  for (const s of LUJAN_3159.sectors) {
    rows.push([
      s.code,
      s.category,
      s.floor,
      s.occupancy.status,
      s.occupancy.client ?? "",
      String(s.surfaceM2),
      s.occupancy.occupiedM2 != null ? String(s.occupancy.occupiedM2) : "",
      s.occupancy.availableM2 != null ? String(s.occupancy.availableM2) : "",
      s.rack ? String(s.rack.positions) : "",
      s.rack ? s.rack.plano : "",
      s.occupancy.confidence,
    ]);
  }
  for (const b of LUJAN_3159.cubicleBlocks) {
    for (const c of b.cubicles) {
      rows.push([`${b.code}·${c.code}`, "anmat", b.floor, c.status, c.client ?? "", String(c.surfaceM2), c.status === "ocupado" ? String(c.surfaceM2) : "0", c.status === "disponible" ? String(c.surfaceM2) : "0", "", "", b.confidence]);
    }
  }
  const csv = [headers, ...rows].map((r) => r.map((v) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lujan_3159_disponibilidad.csv";
  a.click();
  URL.revokeObjectURL(url);
}
