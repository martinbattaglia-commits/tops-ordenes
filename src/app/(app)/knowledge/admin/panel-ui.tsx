import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type {
  HealthAssessment,
  HealthStatus,
  QueueKpis,
  WorkerKpis,
  SourceKpi,
  DeadLetterEntry,
} from "@/lib/knowledge/admin-types";

/* ───────────────────────── formatters ───────────────────────── */

export function fmtAgeSeconds(sec: number | null): string {
  if (sec == null) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function fmtRelative(iso: string | null, nowMs: number): string {
  if (!iso) return "nunca";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  return `hace ${fmtAgeSeconds((nowMs - t) / 1000)}`;
}

/* ───────────────────────── health (D-7 secciones 1+2) ───────────────────────── */

const HEALTH_UI: Record<HealthStatus, { ring: string; chip: string; icon: IconName; label: string }> = {
  healthy: {
    ring: "border-emerald-500/30 bg-emerald-500/10",
    chip: "text-emerald-700 dark:text-emerald-400",
    icon: "check-circle",
    label: "SANO",
  },
  degraded: {
    ring: "border-amber-500/30 bg-amber-500/10",
    chip: "text-amber-700 dark:text-amber-400",
    icon: "bell",
    label: "DEGRADADO",
  },
  critical: {
    ring: "border-red-500/30 bg-red-500/10",
    chip: "text-red-700 dark:text-red-400",
    icon: "bolt",
    label: "CRÍTICO",
  },
  unknown: {
    ring: "border-stroke-soft bg-bg-surface-alt",
    chip: "text-fg-muted",
    icon: "eye",
    label: "SIN DATOS",
  },
};

export function SystemHealthBanner({ assessment }: { assessment: HealthAssessment }) {
  const ui = HEALTH_UI[assessment.status];
  return (
    <section className={cn("rounded-xl border p-5 sm:p-6", ui.ring)} aria-label="Estado general del sistema">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className={cn("grid h-12 w-12 place-items-center rounded-full bg-bg-surface", ui.chip)}>
            <Icon name={ui.icon} size={26} />
          </span>
          <div>
            <div className="eyebrow-tiny">Knowledge Engine · Estado general</div>
            <h2 className={cn("text-2xl font-bold leading-tight", ui.chip)}>{assessment.headline}</h2>
          </div>
        </div>
        <div className="text-right">
          <div className={cn("text-4xl font-extrabold tabular-nums", ui.chip)}>{assessment.score}</div>
          <div className="text-xs text-fg-muted">Health Score · {ui.label}</div>
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-2">
        {assessment.reasons.map((r, i) => (
          <li key={i} className="rounded-full bg-bg-surface px-3 py-1 text-xs text-fg-secondary border border-stroke-soft">
            {r}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HealthUnavailable() {
  return (
    <section className="rounded-xl border border-stroke-soft bg-bg-surface-alt p-6 text-center">
      <Icon name="eye" size={22} className="text-fg-muted" />
      <p className="mt-2 text-sm text-fg-secondary">
        No se pudo calcular el estado del sistema (sin datos de KPIs).
      </p>
    </section>
  );
}

/* ───────────────────────── KPI cards (sección 3) ───────────────────────── */

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: IconName;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "good"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-fg-primary";
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow-tiny">{label}</span>
        <Icon name={icon} size={14} className="text-fg-muted" />
      </div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", toneCls)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}

/* ───────────────────────── worker (sección 4) ───────────────────────── */

export function WorkerPanel({ worker, nowMs }: { worker: WorkerKpis | null; nowMs: number }) {
  if (!worker) return <EmptyPanel title="Worker" msg="Sin datos del worker." />;
  const neverRan = worker.lastRunAt == null;
  return (
    <PanelShell title="Worker (drenado de la cola)" icon="bolt">
      {neverRan ? (
        <p className="text-sm text-fg-secondary">
          Sin corridas registradas. El endpoint/cron del worker quedan vivos sólo tras el deploy del
          worktree (las fuentes actuales emiten <code>processed</code> de forma sincrónica, así que la
          cola no requiere drenado hoy).
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Última corrida" value={fmtRelative(worker.lastRunAt, nowMs)} sub={fmtDateTime(worker.lastRunAt)} />
          <Stat label="Corridas (24h)" value={worker.runs} />
          <Stat label="Procesados (24h)" value={worker.processed} />
          <Stat label="Reintentos / Dead" value={`${worker.failedRetried} / ${worker.failedDead}`} tone={worker.failedDead > 0 ? "bad" : "default"} />
          <Stat label="Duración media" value={worker.avgDurationMs != null ? `${Math.round(worker.avgDurationMs)} ms` : "—"} />
          <Stat label="Última en modo dry" value={worker.lastDry == null ? "—" : worker.lastDry ? "sí" : "no"} />
        </div>
      )}
    </PanelShell>
  );
}

/* ───────────────────────── cola (sección 5) ───────────────────────── */

export function QueuePanel({ queue }: { queue: QueueKpis | null }) {
  if (!queue) return <EmptyPanel title="Cola" msg="Sin datos de la cola." />;
  return (
    <PanelShell title="Cola de eventos" icon="package">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Pending" value={queue.pending} tone={queue.pending > 0 ? "warn" : "default"} />
        <Stat label="Processing" value={queue.processing} />
        <Stat label="Failed" value={queue.failed} tone={queue.failed > 0 ? "warn" : "default"} />
        <Stat label="Dead" value={queue.dead} tone={queue.dead > 0 ? "bad" : "default"} />
        <Stat label="Processed" value={queue.processed} tone="good" />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
        <span>Total: <b className="text-fg-secondary tabular-nums">{queue.total}</b></span>
        <span>Due now: <b className="text-fg-secondary tabular-nums">{queue.dueNow}</b></span>
        <span>Atascados (lease vencido): <b className="text-fg-secondary tabular-nums">{queue.stuck}</b></span>
        <span>Pending más viejo: <b className="text-fg-secondary tabular-nums">{fmtAgeSeconds(queue.oldestPendingAgeSeconds)}</b></span>
      </div>
    </PanelShell>
  );
}

/* ───────────────────────── fuentes (sección 6) ───────────────────────── */

export function SourcesTable({ sources }: { sources: SourceKpi[] }) {
  return (
    <PanelShell title="Fuentes del timeline" icon="vendors">
      {sources.length === 0 ? (
        <p className="text-sm text-fg-muted">Sin fuentes registradas.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-fg-muted">
                <th className="py-2 pr-4 font-medium">Fuente</th>
                <th className="py-2 pr-4 font-medium">Estado</th>
                <th className="py-2 pr-4 font-medium text-right">Eventos</th>
                <th className="py-2 pr-4 font-medium">Último backfill</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.sourceTable} className="border-t border-stroke-soft">
                  <td className="py-2 pr-4 font-mono text-xs text-fg-primary">{s.sourceTable}</td>
                  <td className="py-2 pr-4">
                    {s.enabled ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs">
                        <Icon name="check-circle" size={12} /> activa
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-fg-muted text-xs">
                        <Icon name="lock" size={12} /> dormida
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{s.events}</td>
                  <td className="py-2 pr-4 text-xs text-fg-secondary">{fmtDateTime(s.lastBackfillAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

/* ───────────────────────── dead letter (sección 7) ───────────────────────── */

export function DeadLetterTable({ rows }: { rows: DeadLetterEntry[] }) {
  return (
    <PanelShell title="Dead-letter / fallidos" icon="bolt">
      {rows.length === 0 ? (
        <p className="inline-flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <Icon name="check-circle" size={14} /> Sin eventos muertos ni fallidos.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-fg-muted">
                <th className="py-2 pr-4 font-medium">seq</th>
                <th className="py-2 pr-4 font-medium">Tipo</th>
                <th className="py-2 pr-4 font-medium">Fuente</th>
                <th className="py-2 pr-4 font-medium">Estado</th>
                <th className="py-2 pr-4 font-medium text-right">retry</th>
                <th className="py-2 pr-4 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-stroke-soft align-top">
                  <td className="py-2 pr-4 tabular-nums text-fg-muted">{r.seq}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.eventType}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-fg-secondary">{r.sourceTable ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className={cn("text-xs font-medium", r.status === "dead" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")}>
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{r.retryCount}</td>
                  <td className="py-2 pr-4 text-xs text-fg-secondary max-w-md truncate" title={r.error ?? ""}>{r.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

/* ───────────────────────── primitivos ───────────────────────── */

function PanelShell({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg-primary">
        <Icon name={icon} size={15} className="text-fg-muted" /> {title}
      </h3>
      {children}
    </section>
  );
}

function EmptyPanel({ title, msg }: { title: string; msg: string }) {
  return (
    <section className="card p-5">
      <h3 className="mb-2 text-sm font-semibold text-fg-primary">{title}</h3>
      <p className="text-sm text-fg-muted">{msg}</p>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "good"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-fg-primary";
  return (
    <div>
      <div className="eyebrow-tiny">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", toneCls)}>{value}</div>
      {sub && <div className="text-[11px] text-fg-muted">{sub}</div>}
    </div>
  );
}
