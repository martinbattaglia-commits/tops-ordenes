import { Icon } from "@/components/Icon";
import { Sparkline } from "@/components/compras/charts/Sparkline";
import { ComplianceAlertEngine } from "@/components/anmat/ComplianceAlertEngine";
import {
  CREDENTIALS,
  TEMPERATURES,
  DOCS,
  AUDITS,
  ANMAT_INTEGRATION_PENDING,
} from "@/lib/anmat/data";
import { fmtDate } from "@/lib/compras/format";

export const metadata = { title: "ANMAT · Compliance" };
export const dynamic = "force-dynamic";

/**
 * QW Fase 1 (2026-05-29):
 *  - Se eliminaron los indicadores regulatorios ficticios (RNE específico,
 *    "0 observaciones", semáforos pre-calculados).
 *  - El módulo muestra un banner "Pendiente de integración" mientras
 *    `ANMAT_INTEGRATION_PENDING === true`.
 *  - Si los arrays están vacíos, cada sección muestra un empty-state claro.
 */

export default function AnmatPage() {
  const vigentes = CREDENTIALS.filter((c) => c.status === "vigente").length;
  const porVencer = CREDENTIALS.filter((c) => c.status === "por_vencer").length;
  const tempAlarms = TEMPERATURES.filter((t) => t.status !== "ok").length;
  const lastAudit = AUDITS[0] ?? null;

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      {/* Hero */}
      <section className="card overflow-hidden relative">
        <div className="p-6 md:p-7">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-lg bg-fg-muted/10 text-fg-muted grid place-items-center flex-shrink-0">
                <Icon name="shield" size={28} stroke={2} />
              </div>
              <div>
                <div className="eyebrow-tiny">ANMAT Compliance · Verotin S.A.</div>
                <h1 className="page-title">Centro ANMAT</h1>
                <p className="page-subtitle">
                  Compliance regulatorio, habilitaciones, cadena de frío, auditorías y documentos asociados.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" type="button" disabled>
                <Icon name="download" size={14} />
                <span>Exportar compliance</span>
              </button>
              <button className="btn btn-primary btn-sm" type="button" disabled>
                <Icon name="plus" size={14} />
                <span>Nuevo documento</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Banner pendiente de integración */}
      {ANMAT_INTEGRATION_PENDING && (
        <section className="card p-5 border-status-warning/30 bg-status-warning/5 flex items-start gap-3">
          <Icon name="wand" size={20} className="text-status-warning mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-fg-primary">Módulo ANMAT — pendiente de integración</div>
            <div className="text-[12px] text-fg-secondary mt-1 leading-relaxed">
              Los datos regulatorios (RNE, habilitaciones, vencimientos, sondas de temperatura,
              auditorías y documentos) requieren conectarse con las fuentes reales de Verotin S.A.
              <br />
              <span className="text-fg-muted">
                Próximo paso (Fase 2): crear tablas <code className="font-mono">anmat_credentials</code>,{" "}
                <code className="font-mono">anmat_temperatures</code>,{" "}
                <code className="font-mono">anmat_audits</code> en Supabase + integración con sondas IoT.
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Compliance Alert Engine — semáforo + score + timeline 90d */}
      <ComplianceAlertEngine />

      {/* KPI Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBox
          label="Habilitaciones vigentes"
          value={CREDENTIALS.length === 0 ? "—" : String(vigentes)}
          sub={CREDENTIALS.length === 0 ? "Pendiente de integración" : `de ${CREDENTIALS.length}`}
          icon="check-circle"
          color={CREDENTIALS.length === 0 ? "text-fg-muted" : "text-status-success"}
          bg={CREDENTIALS.length === 0 ? "bg-neutral-100" : "bg-status-success/10"}
        />
        <StatBox
          label="Por vencer (<90d)"
          value={CREDENTIALS.length === 0 ? "—" : String(porVencer)}
          sub={CREDENTIALS.length === 0 ? "Pendiente de integración" : "atención"}
          icon="clock"
          color={CREDENTIALS.length === 0 ? "text-fg-muted" : "text-status-warning"}
          bg={CREDENTIALS.length === 0 ? "bg-neutral-100" : "bg-status-warning/10"}
        />
        <StatBox
          label="Sondas con alerta"
          value={TEMPERATURES.length === 0 ? "—" : String(tempAlarms)}
          sub={TEMPERATURES.length === 0 ? "Pendiente de integración" : `de ${TEMPERATURES.length}`}
          icon="wand"
          color="text-fg-muted"
          bg="bg-neutral-100"
        />
        <StatBox
          label="Última auditoría"
          value={lastAudit === null ? "—" : lastAudit.observations === 0 ? "✓ Limpia" : `${lastAudit.observations} obs.`}
          sub={lastAudit === null ? "Pendiente de integración" : fmtDate(lastAudit.date)}
          icon="shield"
          color="text-fg-muted"
          bg="bg-neutral-100"
        />
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
            {CREDENTIALS.length === 0 ? (
              <EmptyState
                title="Sin credenciales cargadas"
                detail="Cuando se integre el módulo ANMAT real, las habilitaciones vigentes y por vencer aparecerán acá."
              />
            ) : (
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
            )}
          </div>

          {/* Cadena de frío */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-fg-primary">Cadena de frío · sondas IoT</div>
                <div className="text-[11px] text-fg-secondary mt-0.5">
                  Lectura cada 60 seg · alarmas automáticas vía WhatsApp (cuando se integre)
                </div>
              </div>
            </div>
            {TEMPERATURES.length === 0 ? (
              <EmptyState
                title="Sin sondas IoT conectadas"
                detail="Las cámaras frías y zonas controladas se conectarán al módulo cuando estén instaladas las sondas de temperatura."
              />
            ) : (
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
                        <span className={`text-[10px] font-bold uppercase ${color}`}>
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
            )}
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
            {AUDITS.length === 0 ? (
              <EmptyState title="Sin auditorías registradas" detail="Se cargarán al integrar el módulo." compact />
            ) : (
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
            )}
          </div>

          {/* Documentos */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-fg-primary">Documentos ANMAT</div>
                <div className="text-[11px] text-fg-secondary mt-0.5">Trazabilidad SHA-256</div>
              </div>
              <a href="/drive" className="text-xs font-bold text-fg-link hover:underline">
                Ver todos →
              </a>
            </div>
            {DOCS.length === 0 ? (
              <EmptyState
                title="Sin documentos ANMAT cargados"
                detail="Subí contratos, procedimientos o auditorías desde el Centro Documental."
                compact
              />
            ) : (
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
            )}
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

function EmptyState({
  title,
  detail,
  compact,
}: {
  title: string;
  detail: string;
  compact?: boolean;
}) {
  return (
    <div className={`text-center ${compact ? "p-5" : "p-8"}`}>
      <Icon name="wand" size={compact ? 18 : 24} className="text-fg-muted mb-2 mx-auto" />
      <div className="text-sm font-bold text-fg-primary">{title}</div>
      <div className="text-[11px] text-fg-secondary mt-1 max-w-md mx-auto">{detail}</div>
    </div>
  );
}
