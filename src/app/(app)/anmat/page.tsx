import type { CSSProperties } from "react";
import { Icon } from "@/components/Icon";
import {
  AUDIT_META, RISK_HEX, executiveKpis, deriveItems, todayAr,
  complianceScore, complianceColor, riskScore, riskBand, riskBandColor, criticalCount,
  riskDistribution, byCategory, timelineBuckets, alertCenter, recurringObligations, calendar,
  type Riesgo,
} from "@/lib/compliance/data";
import {
  ScoreGauge, RiskDonut, CategoryBars, TimelineView, AlertCenter, RecurringGrid, CalendarView,
} from "@/components/compliance/ui";
import { ComplianceMatrix } from "@/components/compliance/ComplianceMatrix";
import { SedeTabs } from "@/components/compliance/SedeTabs";

export const metadata = { title: "Compliance Cockpit" };
export const dynamic = "force-dynamic";

function SectionH({ id, title, hint }: { id?: string; title: string; hint?: string }) {
  return (
    <div id={id} className="flex items-center gap-3 mt-8 mb-3 scroll-mt-20">
      <h2 className="text-[15px] font-bold text-fg-primary">{title}</h2>
      <div className="flex-1 h-px bg-stroke-soft" />
      {hint && <span className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">{hint}</span>}
    </div>
  );
}

export default function AnmatCockpitPage() {
  // FIX 2026-06-11: el inventario se DERIVA a la fecha actual en cada render
  // (force-dynamic) — dias/estado/riesgo vivos; los hardcodeados del snapshot
  // dejan de ser fuente de verdad. Un vencimiento posterior a la auditoría
  // impacta KPIs/score/alertas sin editar el archivo.
  const hoy = todayAr();
  const items = deriveItems(undefined, hoy);
  const cs = complianceScore(items);
  const rs = riskScore(items);
  const band = riskBand(rs);
  const criticos = criticalCount(items);
  const warnings = items.filter((i) => i.riesgo === "Naranja" || i.riesgo === "Amarillo").length;
  const csHex = RISK_HEX[complianceColor(cs)];
  const rsHex = RISK_HEX[riskBandColor(band)];
  const kpis = executiveKpis(items);
  const dist = riskDistribution(items);
  const cats = byCategory(items);
  const buckets = timelineBuckets(items);
  const alerts = alertCenter(items);
  const recur = recurringObligations(items);
  const cal = calendar(items, Number(hoy.slice(0, 4)));
  const toneHex = (t: "neutral" | Riesgo) => (t === "neutral" ? "var(--fg-brand)" : RISK_HEX[t]);

  return (
    <div className="p-4 md:p-7 lg:p-8 nx-page-fade max-w-[1320px] mx-auto">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny flex items-center gap-2">
            <Icon name="shield" size={13} /> COMPLIANCE COCKPIT · Centro de Control Regulatorio Corporativo
          </div>
          <h1 className="page-title">Compliance Cockpit</h1>
          <p className="page-subtitle">
            Centro de Control Regulatorio · {AUDIT_META.empresa.split(" (")[0]} · CUIT {AUDIT_META.cuit} · {AUDIT_META.sedeCentral} / {AUDIT_META.sedeAnexa}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-secondary border border-stroke-soft rounded-pill px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-status-success" /> Drive auditado · {AUDIT_META.docsTotal} documentos
          </span>
          <span className="text-[11px] text-fg-muted">Auditoría {AUDIT_META.fecha.split("-").reverse().join("/")} · vencimientos recalculados al {hoy.split("-").reverse().join("/")}</span>
        </div>
      </div>

      {/* Banner crítico */}
      <div className="card p-4 mb-5 flex items-start gap-3 border-l-4" style={{ borderColor: RISK_HEX.Rojo, background: `${RISK_HEX.Rojo}0e` } as CSSProperties}>
        <Icon name="bolt" size={18} className="mt-0.5 flex-shrink-0" style={{ color: RISK_HEX.Rojo } as CSSProperties} />
        <div>
          <div className="text-sm font-bold" style={{ color: RISK_HEX.Rojo } as CSSProperties}>
            {criticos} hallazgos críticos · {alerts.inmediatos.length} vencimiento{alerts.inmediatos.length === 1 ? "" : "s"} inminente{alerts.inmediatos.length === 1 ? "" : "s"}
          </div>
          <div className="text-[12.5px] text-fg-secondary mt-0.5 leading-relaxed">
            {/* Derivado a hoy: los críticos reales, no narrativa congelada del snapshot. */}
            {alerts.criticos.slice(0, 3).map((i, idx) => (
              <span key={i.id}>{idx > 0 && " · "}<b>{i.documento.split(" – ")[0].split(" (")[0]}</b> ({i.dias !== null && i.dias < 0 ? `vencido ${i.venc_fmt}` : i.estado.toLowerCase()})</span>
            ))}
            {alerts.criticos.length > 3 && <span> · +{alerts.criticos.length - 3} más en el centro de alertas</span>}
          </div>
        </div>
      </div>

      {/* Sección 1 — Compliance Score · Risk Score · Críticos (tres indicadores separados) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Compliance Score */}
        <div className="card p-6 flex flex-col items-center text-center">
          <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted mb-3">Compliance Score</div>
          <ScoreGauge score={cs} hex={csHex} caption="cumplimiento" />
          <div className="text-xs text-fg-secondary mt-3">Nivel general de cumplimiento de VEROTIN S.A.</div>
        </div>
        {/* Risk Score */}
        <div className="card p-6 flex flex-col items-center text-center">
          <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted mb-3">Risk Score</div>
          <ScoreGauge score={rs} hex={rsHex} caption={band} />
          <div className="mt-3">
            <span className="text-xs font-bold px-2.5 py-1 rounded-pill" style={{ color: rsHex, background: `${rsHex}22` } as CSSProperties}>Exposición {band}</span>
          </div>
        </div>
        {/* Hallazgos críticos + flag independiente */}
        <div className="card p-6 flex flex-col items-center justify-center text-center border-l-4"
          style={{ borderColor: criticos > 0 ? RISK_HEX.Rojo : RISK_HEX.Verde } as CSSProperties}>
          <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted mb-2">Hallazgos críticos</div>
          <div className="text-6xl font-black tabular leading-none" style={{ color: criticos > 0 ? RISK_HEX.Rojo : RISK_HEX.Verde } as CSSProperties}>{criticos}</div>
          {criticos > 0 ? (
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-pill text-white" style={{ background: RISK_HEX.Rojo } as CSSProperties}>
              <Icon name="bolt" size={12} /> ESTADO CRÍTICO
            </span>
          ) : (
            <span className="mt-3 text-xs font-bold px-3 py-1 rounded-pill" style={{ color: RISK_HEX.Verde, background: `${RISK_HEX.Verde}22` } as CSSProperties}>Sin críticos</span>
          )}
          <div className="text-[11px] text-fg-muted mt-2">{warnings} ítems a resolver · {items.filter((i) => i.riesgo === "Verde").length} vigentes</div>
        </div>
      </div>
      <div className="text-[11px] text-fg-muted mt-2 font-mono">
        Compliance = Σ(peso·estado)/N×100 (V1·N0.8·A0.5·R0) · Risk = 100·R/(R+{100}) · flag crítico independiente
      </div>

      {/* Sección 2 — KPIs Ejecutivos (deep links) */}
      <SectionH title="KPIs ejecutivos" hint="Deep links · hover .nx-interactive" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <a key={k.key} href={k.href} title={`Ir a ${k.label}`}
            className="nx-interactive block rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700">
            <div className="card p-4 border-l-4 h-full" style={{ borderColor: toneHex(k.tone) } as CSSProperties}>
              <div className="text-[10px] uppercase tracking-wide text-fg-muted">{k.label}</div>
              <div className="text-3xl font-black tabular leading-none mt-1.5" style={{ color: toneHex(k.tone) } as CSSProperties}>
                {k.value}{k.suffix && <span className="text-base font-bold text-fg-muted">{k.suffix}</span>}
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* Sección 3 + 4 — Distribución de riesgo + Estado por categoría */}
      <SectionH title="Distribución de riesgo y estado por categoría" />
      <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-4">
        <div className="card p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-fg-muted mb-1">Distribución de riesgo</div>
          <div className="text-[11px] text-fg-muted mb-3">{items.length} ítems · 12 categorías · 2 sedes</div>
          <RiskDonut dist={dist} />
        </div>
        <div className="card p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-fg-muted mb-1">Estado por categoría</div>
          <div className="text-[11px] text-fg-muted mb-3">Apilado por nivel de riesgo</div>
          <CategoryBars cats={cats} />
        </div>
      </div>

      {/* Sección 5 — Timeline */}
      <SectionH id="timeline" title="Timeline de vencimientos" hint="Alertas 30 · 60 · 90 días" />
      <TimelineView buckets={buckets} />

      {/* Sección 6 — Centro de Alertas */}
      <SectionH id="alertas" title="Centro de alertas" hint="SOC regulatorio" />
      <AlertCenter criticos={alerts.criticos} inmediatos={alerts.inmediatos} proximos={alerts.proximos} />

      {/* Sección 7 — Vista por Sede */}
      <SectionH id="sede" title="Vista por sede" hint="Magaldi · Luján" />
      <span id="sede-MAGALDI" className="block scroll-mt-20" /><span id="sede-LUJAN" className="block scroll-mt-20" />
      <div className="card p-5"><SedeTabs items={items} /></div>

      {/* Sección 8 — Calendario Regulatorio */}
      <SectionH title="Calendario regulatorio 2026" hint="Vencimientos por mes" />
      <CalendarView months={cal} year={2026} />

      {/* Sección 9 — Obligaciones Recurrentes */}
      <SectionH title="Dashboard de obligaciones recurrentes" hint="Último · próximo por sede" />
      <RecurringGrid rows={recur} />

      {/* Sección 10 — Matriz Regulatoria */}
      <SectionH id="matriz" title="Matriz regulatoria" hint="Búsqueda · filtros · orden" />
      <div className="card p-5">
        <ComplianceMatrix items={items} />
      </div>

      {/* Futuro / metodología */}
      <div className="card p-5 mt-6">
        <div className="text-xs font-bold uppercase tracking-wide text-fg-muted mb-2 flex items-center gap-2"><Icon name="wand" size={13} /> Roadmap de automatización (arquitectura preparada)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[12px] text-fg-secondary">
          <div>• Ingesta automática desde Drive TOPS</div>
          <div>• Lectura automática de PDFs (extracción de fechas)</div>
          <div>• Detección automática de vencimientos</div>
          <div>• Alertas automáticas 30 / 60 / 90 días</div>
          <div>• Envío de mails + notificaciones Nexus</div>
          <div>• Persistencia DB (migración 0065_compliance_core)</div>
        </div>
        <div className="text-[11px] text-fg-muted mt-3 leading-relaxed">
          <b>Metodología.</b> Auditoría documental sobre {AUDIT_META.docsTotal} archivos del Drive «AGENCIA GUBERNAMENTAL DE CONTROL» (Magaldi {AUDIT_META.docsMagaldi} / Luján {AUDIT_META.docsLujan}). Inventario manual del snapshot {AUDIT_META.fecha}; <b>vencimientos recalculados en runtime contra la fecha actual</b>: Rojo vencido o faltante · Naranja ≤30 días (inminente) · Amarillo 31–60 días (alerta preventiva) · Verde &gt;60 días. Ítems sin fecha conservan su estado documental auditado. Fuente: COMPLIANCE-AUDIT-MASTER-REPORT.
        </div>
      </div>
    </div>
  );
}
