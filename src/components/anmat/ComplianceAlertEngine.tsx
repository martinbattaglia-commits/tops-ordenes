import { Icon } from "@/components/Icon";
import {
  buildComplianceSummary,
  type ComplianceAlert,
  type AlertSeverity,
} from "@/lib/anmat/alert-engine";
import { CREDENTIALS, AUDITS } from "@/lib/anmat/data";
import { isDriveConfigured, getServiceAccountEmail } from "@/lib/drive/client";
import { fmtDate } from "@/lib/compras/format";

/**
 * Compliance Alert Engine — vista ejecutiva de riesgo regulatorio.
 *
 * Se renderiza como sección al inicio de /anmat. Combina:
 *   · semáforo por severidad (crítico / warning / ok)
 *   · score regulatorio (0-100) con ring premium
 *   · timeline de los próximos 90 días
 *   · estado del scan automático de Google Drive (CTA si no configurado)
 */
export function ComplianceAlertEngine() {
  const summary = buildComplianceSummary(CREDENTIALS, AUDITS);
  const driveOn = isDriveConfigured();
  const sa = getServiceAccountEmail();

  return (
    <section className="card overflow-hidden ce-engine">
      <div className="ce-engine-glow" aria-hidden />

      <div className="px-5 md:px-6 py-4 border-b border-stroke-soft flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-tops-blue-900 text-white grid place-items-center">
            <Icon name="shield" size={16} stroke={2} />
          </div>
          <div>
            <div className="text-sm font-bold text-fg-primary">
              Compliance Alert Engine
            </div>
            <div className="text-[11px] text-fg-secondary mt-0.5">
              Clasificación automática · ANMAT · AGC · trazabilidad regulatoria
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DriveStatusPill on={driveOn} email={sa} />
          <span className="text-[11px] text-fg-muted hidden md:inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
            Escaneo en vivo
          </span>
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] divide-y md:divide-y-0 md:divide-x divide-stroke-soft">
        {/* Izquierda: score + buckets */}
        <div className="p-5 md:p-6 flex flex-col gap-5">
          <ScoreRing score={summary.scoreRegulatorio} />
          <div className="grid grid-cols-3 gap-2">
            <SeverityChip
              level="critical"
              count={summary.byLevel.critical}
              label="Críticos"
            />
            <SeverityChip
              level="warning"
              count={summary.byLevel.warning}
              label="Por vencer"
            />
            <SeverityChip
              level="ok"
              count={summary.alerts.length === 0 ? 1 : 0}
              label="Limpios"
            />
          </div>
        </div>

        {/* Derecha: timeline 90 días */}
        <div className="p-5 md:p-6 ce-engine-feed">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-muted">
              Timeline próximos 90 días
            </div>
            <div className="text-[11px] text-fg-secondary tabular">
              {summary.next90d.length} eventos
            </div>
          </div>
          {summary.alerts.length === 0 ? (
            <EmptyOk />
          ) : (
            <ol className="space-y-2.5">
              {summary.alerts.slice(0, 6).map((a) => (
                <AlertRow key={a.id} alert={a} />
              ))}
              {summary.alerts.length > 6 && (
                <li className="text-[11px] text-fg-muted text-center pt-2">
                  + {summary.alerts.length - 6} alertas más
                </li>
              )}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

function ScoreRing({ score }: { score: number }) {
  const C = 2 * Math.PI * 42;
  const dash = (score / 100) * C;
  const color =
    score >= 90 ? "#0E7C3A" : score >= 70 ? "#B45309" : "#C90812";
  const label =
    score >= 90 ? "Excelente" : score >= 70 ? "Atención" : "Crítico";
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-[104px] h-[104px] flex-shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(5,5,85,0.08)" strokeWidth="6" />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${C}`}
            className="ce-ring-stroke"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div
              className="text-2xl font-bold tabular leading-none"
              style={{ color }}
            >
              {score}
            </div>
            <div className="text-[9px] uppercase tracking-[0.14em] font-bold text-fg-muted mt-0.5">
              {label}
            </div>
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <div className="eyebrow-tiny">Score regulatorio</div>
        <div className="text-sm font-bold text-fg-primary">
          Riesgo agregado consolidado
        </div>
        <div className="text-[11px] text-fg-secondary mt-1">
          100 − (críticos × 20) − (warnings × 5)
        </div>
      </div>
    </div>
  );
}

function SeverityChip({
  level,
  count,
  label,
}: {
  level: AlertSeverity;
  count: number;
  label: string;
}) {
  const cfg: Record<AlertSeverity, { bg: string; ring: string; fg: string; icon: "x" | "clock" | "check" }> = {
    critical: {
      bg: "bg-tops-red/8",
      ring: "ring-tops-red/30",
      fg: "text-tops-red",
      icon: "x",
    },
    warning: {
      bg: "bg-status-warning/10",
      ring: "ring-status-warning/30",
      fg: "text-status-warning",
      icon: "clock",
    },
    ok: {
      bg: "bg-status-success/10",
      ring: "ring-status-success/30",
      fg: "text-status-success",
      icon: "check",
    },
  };
  const c = cfg[level];
  return (
    <div
      className={`rounded-lg p-3 ring-1 ${c.bg} ${c.ring} text-center`}
    >
      <div className={`flex items-center justify-center gap-1 ${c.fg}`}>
        <Icon name={c.icon} size={12} stroke={2.4} />
        <span className="text-xl font-bold tabular leading-none">{count}</span>
      </div>
      <div className="text-[10px] uppercase tracking-[0.1em] font-bold text-fg-muted mt-1.5">
        {label}
      </div>
    </div>
  );
}

function AlertRow({ alert }: { alert: ComplianceAlert }) {
  const sev: Record<AlertSeverity, { fg: string; bg: string; dot: string }> = {
    critical: { fg: "text-tops-red", bg: "bg-tops-red/8", dot: "bg-tops-red" },
    warning: {
      fg: "text-status-warning",
      bg: "bg-status-warning/10",
      dot: "bg-status-warning",
    },
    ok: { fg: "text-status-success", bg: "bg-status-success/10", dot: "bg-status-success" },
  };
  const s = sev[alert.severity];
  return (
    <li
      className={`flex items-center gap-3 px-3 py-2 rounded-md ${s.bg} ce-alert-row`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-fg-primary truncate">
          {alert.title}
        </div>
        <div className="text-[11px] text-fg-secondary truncate">
          {alert.detail}
        </div>
      </div>
      {alert.dueAt && (
        <div className="text-right hidden sm:block flex-shrink-0">
          <div className="text-[10px] text-fg-muted">
            {fmtDate(alert.dueAt)}
          </div>
          {alert.daysLeft !== undefined && (
            <div className={`text-[10px] font-bold tabular ${s.fg}`}>
              {alert.daysLeft}d
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function DriveStatusPill({ on, email }: { on: boolean; email: string | null }) {
  if (on) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-status-success/10 text-status-success text-[11px] font-bold"
        title={email ?? undefined}
      >
        <Icon name="drive" size={12} />
        Drive conectado
      </span>
    );
  }
  return (
    <a
      href="/drive"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-status-warning/10 text-status-warning text-[11px] font-bold hover:bg-status-warning/15 transition-colors"
    >
      <Icon name="drive" size={12} />
      Conectar Drive
    </a>
  );
}

function EmptyOk() {
  return (
    <div className="text-center py-8">
      <div className="w-12 h-12 rounded-full bg-status-success/10 text-status-success grid place-items-center mx-auto mb-3">
        <Icon name="check-circle" size={22} stroke={2} />
      </div>
      <div className="text-sm font-bold text-fg-primary">
        Sin alertas regulatorias activas
      </div>
      <div className="text-[11px] text-fg-secondary mt-1">
        Todas las habilitaciones vigentes y auditorías limpias.
      </div>
    </div>
  );
}
