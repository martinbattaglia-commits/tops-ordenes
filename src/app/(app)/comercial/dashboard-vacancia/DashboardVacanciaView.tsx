"use client";

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import {
  getCorporateCapacity,
  getCorporateVacancySummary,
  getCapacityBySite,
  findAvailability,
  CATEGORY_LABEL,
  type CapacityCategory,
  type SiteCapacity,
  type CommittedSnapshot,
} from "@/lib/wms/corporate-capacity";

const fmt = (n: number) => n.toLocaleString("es-AR");

const CAT_COLOR: Record<CapacityCategory, string> = {
  anmat: "#2563eb",
  general: "#dc2626",
  oficina: "#16a34a",
};

type MatchMode = CapacityCategory | "coworking";

interface Preset {
  label: string;
  mode: MatchMode;
  amount: number;
}
const PRESETS: Preset[] = [
  { label: "300 m² ANMAT", mode: "anmat", amount: 300 },
  { label: "800 m² CG", mode: "general", amount: 800 },
  { label: "20 puestos coworking", mode: "coworking", amount: 20 },
];

export function DashboardVacanciaView({ committed = {} }: { committed?: CommittedSnapshot }) {
  const corp = useMemo(() => getCorporateCapacity(committed), [committed]);
  const summary = useMemo(() => getCorporateVacancySummary(committed), [committed]);
  const sites = useMemo(() => getCapacityBySite(committed), [committed]);

  const [mode, setMode] = useState<MatchMode>("anmat");
  const [amount, setAmount] = useState<number>(300);

  return (
    <div className="p-4 lg:p-8 nx-page-fade" id="vac-root">
      <PrintStyles />

      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Comercial · Capacidad Corporativa</div>
          <h1 className="page-title">Dashboard Corporativo de Vacancia TOPS</h1>
          <p className="page-subtitle">
            Consolidado Pedro Luján 3159 + Agustín Magaldi 1765 · base superficie comercializable ·
            vacancia física / comercial / proyectada (hook CRM activo · F2.1-4)
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

      {/* 1 · Resumen Ejecutivo */}
      <SectionTitle icon="dashboard" title="1 · Resumen ejecutivo" />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <BigKpi label="Capacidad comercializable" value={`${fmt(summary.comercializableM2)} m²`} icon="building" />
        <BigKpi label="Disponible" value={`${fmt(summary.disponibleM2)} m²`} icon="check-circle" tone="#16a34a" />
        <BigKpi label="Ocupado" value={`${fmt(summary.ocupadoM2)} m²`} icon="lock" tone="#dc2626" />
        <BigKpi label="Vacancia corporativa" value={`${summary.vacanciaPct}%`} icon="trend-up" tone="#16a34a" bar={summary.vacanciaPct} />
      </div>

      {/* 1b · Vacancia física / comercial / proyectada (hook CRM) */}
      <SectionTitle icon="trend-up" title="1b · Vacancia: física · comercial · proyectada" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
        <VacancyBand label="Física" sub="capacidad − ocupado" disp={summary.disponibleM2} pct={summary.vacanciaPct} color="#16a34a" />
        <VacancyBand label="Comercial" sub="− comprometido (ganado)" disp={summary.disponibleComercialM2} pct={summary.vacanciaComercialPct} color="#0d9488" />
        <VacancyBand label="Proyectada" sub="− reservado (propuesta/neg.)" disp={summary.disponibleProyectadoM2} pct={summary.vacanciaProyectadaPct} color="#2563eb" />
      </div>
      <p className="text-[11px] text-fg-muted mb-6">
        {summary.hasCommitments
          ? `CRM: reservado ${fmt(summary.reservadoM2)} m² · comprometido ${fmt(summary.committedM2)} m² (los onboardeados ya están en "ocupado" — no se doble-cuentan).`
          : "Sin compromisos CRM cargados: comercial y proyectada = física (activación segura del hook, sin impacto)."}
      </p>

      {/* 2-4 · Categorías */}
      <SectionTitle icon="tag" title="2–4 · Por categoría" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <CategoryCard category="anmat" cap={summary.byCategory.anmat.capacityM2} disp={summary.byCategory.anmat.availableM2} vac={summary.byCategory.anmat.vacanciaPct} />
        <CategoryCard category="general" cap={summary.byCategory.general.capacityM2} disp={summary.byCategory.general.availableM2} vac={summary.byCategory.general.vacanciaPct} />
        <CategoryCard category="oficina" cap={summary.byCategory.oficina.capacityM2} disp={summary.byCategory.oficina.availableM2} vac={summary.byCategory.oficina.vacanciaPct} showVacancy={false} />
      </div>

      {/* 5-6 · Racks + Coworking */}
      <SectionTitle icon="package" title="5–6 · Racks y Coworking" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <BigKpi label="Racks · totales" value={fmt(summary.rackPositionsTotal)} icon="package" tone="#1e293b" />
        <BigKpi label="Racks · disponibles" value={fmt(summary.rackPositionsDisponibles)} icon="package" tone="#16a34a" />
        <BigKpi label="Coworking · islas" value={`${corp.coworking.islas}`} icon="users" tone="#0d9488" />
        <BigKpi label="Coworking · puestos" value={`${corp.coworking.puestos}`} icon="user" tone="#0d9488" />
      </div>

      {/* 7 · Comparativa por sede */}
      <SectionTitle icon="building" title="7 · Comparativa por sede" />
      <div className="nx-surface card overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-fg-muted text-[11px] uppercase tracking-wide border-b border-stroke-soft">
              <th className="px-3 py-2">Sede</th>
              <th className="px-3 py-2 text-right">Comercializable</th>
              <th className="px-3 py-2 text-right">Disponible</th>
              <th className="px-3 py-2 text-right">Ocupado</th>
              <th className="px-3 py-2 text-right">Vacancia</th>
              <th className="px-3 py-2 text-right">ANMAT disp</th>
              <th className="px-3 py-2 text-right">CG disp</th>
              <th className="px-3 py-2 text-right">Extras</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <SiteRow key={s.siteCode} site={s} />
            ))}
            <tr className="border-t-2 border-stroke-soft font-bold bg-bg-surface-alt">
              <td className="px-3 py-2">TOTAL corporativo</td>
              <td className="px-3 py-2 text-right tabular">{fmt(summary.comercializableM2)} m²</td>
              <td className="px-3 py-2 text-right tabular" style={{ color: "#16a34a" }}>{fmt(summary.disponibleM2)} m²</td>
              <td className="px-3 py-2 text-right tabular" style={{ color: "#dc2626" }}>{fmt(summary.ocupadoM2)} m²</td>
              <td className="px-3 py-2 text-right tabular">{summary.vacanciaPct}%</td>
              <td className="px-3 py-2 text-right tabular">{fmt(summary.byCategory.anmat.availableM2)}</td>
              <td className="px-3 py-2 text-right tabular">{fmt(summary.byCategory.general.availableM2)}</td>
              <td className="px-3 py-2 text-right tabular">{corp.coworking.islas}i · {summary.cubiculosDisponibles}cub</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 8 · Motor de matching */}
      <SectionTitle icon="search" title="8 · Motor de matching comercial · findAvailability()" />
      <div className="nx-surface card p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3 mb-4 no-print">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-fg-muted">Categoría</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as MatchMode)}
              className="rounded-lg border border-stroke-soft bg-bg-surface-alt px-3 py-1.5 text-sm outline-none focus:border-fg-brand"
            >
              <option value="anmat">ANMAT (m²)</option>
              <option value="general">Cargas Generales (m²)</option>
              <option value="oficina">Oficinas (m²)</option>
              <option value="coworking">Coworking (puestos)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-fg-muted">{mode === "coworking" ? "Puestos" : "m²"}</span>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
              className="w-32 rounded-lg border border-stroke-soft bg-bg-surface-alt px-3 py-1.5 text-sm tabular outline-none focus:border-fg-brand"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setMode(p.mode);
                  setAmount(p.amount);
                }}
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold border border-stroke-soft transition-all hover:border-fg-brand"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <MatchResult mode={mode} amount={amount} />
      </div>

      <p className="text-[11px] text-fg-muted leading-relaxed">
        Fuente: motor <code>corporate-capacity.ts</code> (Luján + Magaldi). Base = superficie comercializable
        (ANMAT + CG + Oficinas). Disponible = físico; <code>committed = 0</code> hasta el CRM (F2.1).
        Racks con disponibilidad pendiente: {corp.racks.pendingSectors.join(", ") || "ninguno"}.
      </p>
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────────────

function SectionTitle({ icon, title }: { icon: IconName; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon name={icon} size={15} className="text-fg-muted" />
      <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-fg-secondary">{title}</h2>
    </div>
  );
}

function BigKpi({ label, value, icon, tone, bar }: { label: string; value: string; icon: IconName; tone?: string; bar?: number }) {
  return (
    <div className="nx-surface card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
        <span style={tone ? { color: tone } : undefined}>
          <Icon name={icon} size={12} />
        </span>
        {label}
      </div>
      <div className="text-2xl font-bold tabular mt-1" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {bar != null && (
        <div className="mt-2 h-1.5 rounded-full bg-bg-surface-alt overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, bar)}%`, background: tone ?? "#16a34a" }} />
        </div>
      )}
    </div>
  );
}

function VacancyBand({ label, sub, disp, pct, color }: { label: string; sub: string; disp: number; pct: number; color: string }) {
  return (
    <div className="nx-surface card p-3" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color }}>
          Vacancia {label}
        </span>
        <span className="text-lg font-bold tabular" style={{ color }}>{pct}%</span>
      </div>
      <div className="text-sm font-semibold text-fg-primary tabular mt-0.5">{disp.toLocaleString("es-AR")} m² disponibles</div>
      <div className="text-[11px] text-fg-muted">{sub}</div>
      <div className="mt-2 h-1.5 rounded-full bg-bg-surface-alt overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

function CategoryCard({
  category,
  cap,
  disp,
  vac,
  showVacancy = true,
}: {
  category: CapacityCategory;
  cap: number;
  disp: number;
  vac: number;
  showVacancy?: boolean;
}) {
  const color = CAT_COLOR[category];
  return (
    <div className="nx-surface card p-4" style={{ borderTop: `3px solid ${color}` }}>
      <div className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color }}>
        {CATEGORY_LABEL[category]}
      </div>
      <div className="flex items-baseline justify-between py-1 border-b border-stroke-soft/60">
        <span className="text-[11px] uppercase tracking-wide text-fg-muted">Capacidad</span>
        <span className="text-lg font-bold tabular text-fg-primary">{fmt(cap)} m²</span>
      </div>
      <div className="flex items-baseline justify-between py-1 border-b border-stroke-soft/60">
        <span className="text-[11px] uppercase tracking-wide text-fg-muted">Disponible</span>
        <span className="text-lg font-bold tabular" style={{ color: "#16a34a" }}>{fmt(disp)} m²</span>
      </div>
      {showVacancy && (
        <>
          <div className="flex items-baseline justify-between py-1">
            <span className="text-[11px] uppercase tracking-wide text-fg-muted">Vacancia</span>
            <span className="text-lg font-bold tabular" style={{ color }}>{vac}%</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-bg-surface-alt overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, vac)}%`, background: color }} />
          </div>
        </>
      )}
    </div>
  );
}

function SiteRow({ site }: { site: SiteCapacity }) {
  const extras = [
    site.coworking ? `${site.coworking.islas} islas` : null,
    site.cubiculos ? `${site.cubiculos.available} cub` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <tr className="border-b border-stroke-soft/60">
      <td className="px-3 py-2 font-semibold text-fg-primary">{site.siteName}</td>
      <td className="px-3 py-2 text-right tabular">{fmt(site.totals.comercializableM2)} m²</td>
      <td className="px-3 py-2 text-right tabular" style={{ color: "#16a34a" }}>{fmt(site.totals.disponibleM2)} m²</td>
      <td className="px-3 py-2 text-right tabular" style={{ color: "#dc2626" }}>{fmt(site.totals.ocupadoM2)} m²</td>
      <td className="px-3 py-2 text-right tabular">{site.totals.vacanciaPct}%</td>
      <td className="px-3 py-2 text-right tabular">{fmt(site.categories.anmat.availableM2)}</td>
      <td className="px-3 py-2 text-right tabular">{fmt(site.categories.general.availableM2)}</td>
      <td className="px-3 py-2 text-right tabular text-fg-muted">{extras || "—"}</td>
    </tr>
  );
}

function MatchResult({ mode, amount }: { mode: MatchMode; amount: number }) {
  // Coworking: no es m², se evalúa contra puestos disponibles.
  if (mode === "coworking") {
    const corp = getCorporateCapacity();
    const puestosDisp = Math.round((corp.coworking.puestos * corp.coworking.disponiblePct) / 100);
    const fits = amount <= puestosDisp;
    const site = getCapacityBySite().find((s) => s.coworking);
    return (
      <ResultBox
        feasible={fits}
        note={
          fits
            ? `${amount} puestos de coworking disponibles en ${site?.siteName ?? "Magaldi"} (${puestosDisp} puestos · ${corp.coworking.islas} islas · ${corp.coworking.disponiblePct}%).`
            : `Sin disponibilidad para ${amount} puestos (solo ${puestosDisp} disponibles).`
        }
        options={site ? [{ siteName: site.siteName, detail: `${puestosDisp} puestos · ${corp.coworking.islas} islas`, fits }] : []}
      />
    );
  }

  const res = findAvailability({ category: mode, m2: amount });
  return (
    <ResultBox
      feasible={res.feasible}
      note={res.note}
      options={res.options.map((o) => ({ siteName: o.siteName, detail: `${fmt(o.availableM2)} m² disponibles`, fits: o.fitsSingleSite }))}
    />
  );
}

function ResultBox({
  feasible,
  note,
  options,
}: {
  feasible: boolean;
  note: string;
  options: Array<{ siteName: string; detail: string; fits: boolean }>;
}) {
  const color = feasible ? "#16a34a" : "#dc2626";
  return (
    <div className="rounded-lg border-2 p-3" style={{ borderColor: color, background: `${color}0d` }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon name={feasible ? "check-circle" : "x"} size={16} style={{ color }} />
        <span className="font-semibold text-fg-primary text-sm">{note}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((o) => (
          <div key={o.siteName} className="flex items-center justify-between rounded-md border border-stroke-soft px-2.5 py-1.5 bg-bg-surface">
            <span className="text-sm font-medium text-fg-primary">{o.siteName}</span>
            <span className="inline-flex items-center gap-1.5 text-[12px] tabular text-fg-secondary">
              {o.detail}
              <span className="w-2 h-2 rounded-full" style={{ background: o.fits ? "#16a34a" : "#94a3b8" }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PrintStyles() {
  return (
    <style>{`
      @media print {
        .no-print { display: none !important; }
        #vac-root { padding: 0 !important; }
        .nx-surface { box-shadow: none !important; border: 1px solid #ccc !important; }
        @page { size: A4 portrait; margin: 10mm; }
      }
    `}</style>
  );
}

// ── Exportación CSV ─────────────────────────────────────────────────────────

function exportCsv() {
  const corp = getCorporateCapacity();
  const headers = ["nivel", "categoria", "capacidad_m2", "ocupado_m2", "disponible_m2", "vacancia_pct"];
  const rows: string[][] = [];
  for (const cat of ["anmat", "general", "oficina"] as CapacityCategory[]) {
    const c = corp.byCategory[cat];
    const vac = c.capacityM2 > 0 ? Math.round((c.availableM2 / c.capacityM2) * 1000) / 10 : 0;
    rows.push(["corporativo", cat, String(c.capacityM2), String(c.occupiedM2), String(c.availableM2), String(vac)]);
  }
  for (const s of corp.sites) {
    for (const cat of ["anmat", "general", "oficina"] as CapacityCategory[]) {
      const c = s.categories[cat];
      const vac = c.capacityM2 > 0 ? Math.round((c.availableM2 / c.capacityM2) * 1000) / 10 : 0;
      rows.push([s.siteCode, cat, String(c.capacityM2), String(c.occupiedM2), String(c.availableM2), String(vac)]);
    }
  }
  const csv = [headers, ...rows].map((r) => r.join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tops_vacancia_corporativa.csv";
  a.click();
  URL.revokeObjectURL(url);
}
