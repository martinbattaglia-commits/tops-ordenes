import { Icon } from "@/components/Icon";
import { Sparkline } from "@/components/compras/charts/Sparkline";
import { ComplianceAlertEngine } from "@/components/anmat/ComplianceAlertEngine";
import { CREDENTIALS, TEMPERATURES, DOCS, AUDITS } from "@/lib/anmat/data";
import { fmtDate } from "@/lib/compras/format";

export const metadata = { title: "ANMAT · Compliance" };
export const dynamic = "force-dynamic";

export default function AnmatPage() {
  const vigentes = CREDENTIALS.filter((c) => c.status === "vigente").length;
  const porVencer = CREDENTIALS.filter((c) => c.status === "por_vencer").length;
  const tempAlarms = TEMPERATURES.filter((t) => t.status !== "ok").length;
  const lastAudit = AUDITS[0];

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      {/* Hero */}
      <section className="card overflow-hidden relative featured-stroke">
        <div className="p-6 md:p-7">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-lg bg-status-success/10 text-status-success grid place-items-center flex-shrink-0">
                <Icon name="shield" size={28} stroke={2} />
              </div>
              <div>
                <div className="eyebrow-tiny">ANMAT Compliance · Verotin S.A.</div>
                <h1 className="page-title">RNE 2-051-00427 · Vigente</h1>
                <p className="page-subtitle">
                  Habilitación nacional renovada el 14/08/2023 · próxima renovación 14/08/2028 ·{" "}
                  <span className="font-bold text-status-success">0 observaciones abiertas</span>
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" type="button">
                <Icon name="download" size={14} />
                <span>Exportar compliance</span>
              </button>
              <button className="btn btn-primary btn-sm" type="button">
                <Icon name="plus" size={14} />
                <span>Nuevo documento</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Compliance Alert Engine — semáforo + score + timeline 90d */}
      <ComplianceAlertEngine />

      {/* KPI Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBox label="Habilitaciones vigentes" value={String(vigentes)} sub={`de ${CREDENTIALS.length}`} icon="check-circle" color="text-status-success" bg="bg-status-success/10" />
        <StatBox label="Por vencer (<90d)" value={String(porVencer)} sub="atención" icon="clock" color="text-status-warning" bg="bg-status-warning/10" />
        <StatBox label="Sondas con alerta" value={String(tempAlarms)} sub={`de ${TEMPERATURES.length}`} icon="wand" color={tempAlarms ? "text-status-warning" : "text-fg-muted"} bg={tempAlarms ? "bg-status-warning/10" : "bg-neutral-100"} />
        <StatBox label="Última auditoría" value={lastAudit.observations === 0 ? "✓ Limpia" : `${lastAudit.observations} obs.`} sub={fmtDate(lastAudit.date)} icon="shield" color={lastAudit.observations === 0 ? "text-status-success" : "text-status-warning"} bg={lastAudit.observations === 0 ? "bg-status-success/10" : "bg-status-warning/10"} />
      </section>

      <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
        {/* Credenciales + Temperatura */}
        <div className="space-y-6">
          {/* Credenciales */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-fg-primary">Habilitaciones & certificados</div>
                <div className="text-[11px] text-fg-secondary mt-0.5">RNE · disposiciones · DT · calibraciones</div>
              </div>
            </div>
            <div className="divide-y divide-stroke-soft">
              {CREDENTIALS.map((c) => {
                const stat =
                  c.status === "vigente"
                    ? { cls: "badge-success", label: "Vigente" }
                    : c.status === "por_vencer"
                      ? { cls: "badge-warning", label: "Por vencer" }
                      : { cls: "badge-danger", label: "Vencido" };
                return (
                  <div key={c.id} className="px-5 py-3 flex items-center gap-3 hover:bg-neutral-50 transition-colors">
                    <div className="w-10 h-10 rounded-md bg-tops-blue-900 text-white grid place-items-center font-bold text-[10px] flex-shrink-0">
                      {c.type === "RNE" ? "RNE" : c.type === "Habilitación" ? "HAB" : c.type === "Certificado" ? "CERT" : "AUD"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-fg-primary truncate">{c.number}</div>
                      <div className="text-[11px] text-fg-muted truncate">{c.holder}</div>
                    </div>
                    <div className="text-right hidden sm:block">
                      <div className="text-[11px] text-fg-secondary">vence {fmtDate(c.expiresAt)}</div>
                      <div
                        className={`text-[10px] font-bold tabular ${
                          c.daysToExpiry < 90 ? "text-status-warning" : "text-fg-muted"
                        }`}
                      >
                        {c.daysToExpiry} días
                      </div>
                    </div>
                    <span className={`badge ${stat.cls}`}>
                      <span className="dot" />
                      {stat.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cadena de frío */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-fg-primary">Cadena de frío · sondas IoT</div>
                <div className="text-[11px] text-fg-secondary mt-0.5">Lectura cada 60 seg · alarmas automáticas vía WhatsApp</div>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] text-status-success font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
                LIVE
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
              {TEMPERATURES.map((t) => {
                const inRange = t.currentC >= t.setpointMin && t.currentC <= t.setpointMax;
                const color =
                  t.status === "ok" ? "text-status-success" : t.status === "warn" ? "text-status-warning" : "text-tops-red";
                return (
                  <div key={t.zoneId} className="card-pad bg-neutral-50 rounded-lg p-4 border border-stroke-soft">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-fg-muted">
                          {t.location}
                        </div>
                        <div className="text-sm font-bold text-fg-primary">{t.zone}</div>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase ${color}`}
                      >
                        {t.status === "ok" ? "OK" : t.status === "warn" ? "WARN" : "ALARM"}
                      </span>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className={`text-3xl font-bold tabular leading-none ${color}`}>
                          {t.currentC.toFixed(1)}°C
                        </div>
                        <div className="text-[10px] text-fg-muted mt-1">
                          Set: {t.setpointMin}°—{t.setpointMax}°C
                          {!inRange && <span className="text-status-warning"> · fuera de rango</span>}
                        </div>
                      </div>
                      <Sparkline data={t.trend} color={t.status === "ok" ? "#0E7C3A" : "#B45309"} />
                    </div>
                    <div className="text-[10px] text-fg-muted mt-2">{t.lastUpdate}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Auditorías + Documentos */}
        <div className="space-y-6">
          {/* Auditorías */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-stroke-soft">
              <div className="text-sm font-bold text-fg-primary">Auditorías</div>
              <div className="text-[11px] text-fg-secondary mt-0.5">Histórico interno + ANMAT + clientes</div>
            </div>
            <ol className="relative px-5 py-4 space-y-4">
              <span className="absolute left-[28px] top-6 bottom-6 w-px bg-stroke-soft" />
              {AUDITS.map((a) => (
                <li key={a.id} className="flex gap-3 relative">
                  <span
                    className={`w-5 h-5 rounded-full grid place-items-center flex-shrink-0 z-10 ${
                      a.observations === 0
                        ? "bg-status-success text-white"
                        : "bg-status-warning text-white"
                    }`}
                  >
                    <Icon name={a.observations === 0 ? "check" : "bolt"} size={10} stroke={2.4} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-fg-primary">{a.scope}</div>
                    <div className="text-[11px] text-fg-secondary">{a.auditor}</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      {fmtDate(a.date)} · {a.result}
                      {a.observations > 0 && <span className="text-status-warning"> · {a.observations} obs.</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Documentos */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-fg-primary">Documentos ANMAT</div>
                <div className="text-[11px] text-fg-secondary mt-0.5">Trazabilidad SHA-256</div>
              </div>
              <a href="/documental" className="text-xs font-bold text-fg-link hover:underline">
                Ver todos →
              </a>
            </div>
            <div className="divide-y divide-stroke-soft">
              {DOCS.map((d) => (
                <div key={d.id} className="px-5 py-3 flex items-start gap-3 hover:bg-neutral-50 transition-colors">
                  <Icon name="file-pdf" size={16} className="text-tops-red mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-fg-primary truncate">{d.title}</div>
                    <div className="text-[11px] text-fg-muted">
                      {d.type}
                      {d.client && ` · ${d.client}`}
                    </div>
                    <div className="text-[10px] font-mono text-fg-muted mt-0.5">
                      {fmtDate(d.uploadedAt)} · {d.size} · {d.hash}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  sub,
  icon,
  color,
  bg,
}: {
  label: string;
  value: string;
  sub: string;
  icon: import("@/components/Icon").IconName;
  color: string;
  bg: string;
}) {
  return (
    <div className="card card-lift p-5 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-md grid place-items-center flex-shrink-0 ${bg} ${color}`}>
        <Icon name={icon} size={18} stroke={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="kpi-label">{label}</div>
        <div className={`text-2xl font-bold tabular leading-none mt-1 ${color}`}>{value}</div>
        <div className="text-[11px] text-fg-muted mt-1">{sub}</div>
      </div>
    </div>
  );
}
