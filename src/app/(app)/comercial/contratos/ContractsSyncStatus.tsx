"use client";

/**
 * ContractsSyncStatus.tsx — «Estado de sincronización» (Entregable adicional).
 * Muestra conexión con Drive, última/próxima corrida, métricas de calidad
 * documental, alertas de sincronización y permite forzar una corrida manual.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { fmtDateTime, fmtRel } from "@/lib/compras/format";
import type { ContractsSyncSummary } from "@/lib/comercial/contracts-sync/types";
import { Kpi } from "@/components/contratos/ui";
import { triggerContractsSyncAction } from "./sync-actions";

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  const color = ok === undefined ? "#8A94A6" : ok ? "#1F9D55" : "#D14343";
  return (
    <div className="flex items-center justify-between border-b border-stroke-soft py-2 last:border-0">
      <span className="flex items-center gap-2 text-sm text-fg-secondary">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="text-sm font-semibold text-fg-primary">{value}</span>
    </div>
  );
}

const ALERT_META: Record<string, { label: string; color: string; icon: IconName }> = {
  documento_eliminado: { label: "Documento eliminado", color: "#D14343", icon: "trash" },
  rescision_detectada: { label: "Rescisión detectada", color: "#D14343", icon: "x" },
  adenda_modificada: { label: "Adenda/renovación modificada", color: "#E0B400", icon: "pen" },
  extract_error: { label: "Error de extracción", color: "#E07A1F", icon: "bolt" },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  completed: { label: "Completada", color: "#1F9D55" },
  partial: { label: "Parcial", color: "#E0B400" },
  error: { label: "Con errores", color: "#D14343" },
  running: { label: "En curso", color: "#2E6FB0" },
  skipped: { label: "Omitida", color: "#8A94A6" },
};

export function ContractsSyncStatus({ sync }: { sync: ContractsSyncSummary }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const last = sync.lastRun;
  const connected = sync.driveConfigured && sync.dbConfigured;

  const onSync = () => {
    setMsg(null);
    start(async () => {
      const r = await triggerContractsSyncAction();
      setMsg(r.message);
      router.refresh();
    });
  };

  const q = sync.quality;
  const qTotal = q.ok + q.parcial + q.sin_texto + q.error + q.pendiente || 1;
  const qSeg = [
    { k: "ok", label: "OK", color: "#1F9D55", v: q.ok },
    { k: "parcial", label: "Parcial", color: "#E0B400", v: q.parcial },
    { k: "sin_texto", label: "Sin texto", color: "#8A94A6", v: q.sin_texto },
    { k: "error", label: "Error", color: "#D14343", v: q.error },
    { k: "pendiente", label: "Pendiente", color: "#2E6FB0", v: q.pendiente },
  ];

  return (
    <div className="space-y-4">
      {/* Encabezado de conexión + acción manual */}
      <div className="card p-5 flex flex-wrap items-center gap-4">
        <div
          className="grid place-items-center w-11 h-11 rounded-lg shrink-0"
          style={{ background: connected ? "#1F9D5515" : "#E0B40015" }}
        >
          <Icon
            name={connected ? "cloud-check" : "cloud"}
            size={22}
            stroke={2}
            className={connected ? "text-status-success" : "text-status-warning"}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-fg-brand">Google Drive · Comercial → Cynthia → Clientes</div>
          <div className="text-xs text-fg-secondary">
            {sync.totalDocs} documento(s) en repositorio · última sincronización{" "}
            {last ? fmtRel(last.startedAt) : "—"}
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-bold text-white"
          style={{ background: connected ? "#1F9D55" : "#E0B400" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white/90" />
          {connected ? "Conectado" : "Sin conexión"}
        </span>
        <button onClick={onSync} disabled={pending} className="btn btn-primary btn-sm">
          <Icon name="refresh" size={14} className={pending ? "animate-spin" : ""} />
          {pending ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
      </div>

      {msg && (
        <div className="rounded-lg border-l-4 border-[#2E6FB0] bg-[#EAF3FB] px-4 py-2.5 text-[13px] text-[#1C2733]">
          {msg}
        </div>
      )}

      {/* KPIs de la última corrida */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Kpi value={sync.totalDocs} label="Documentos sincronizados" accent="navy" />
        <Kpi value={last?.docsNew ?? 0} label="Nuevos (última corrida)" accent="green" />
        <Kpi value={last?.docsRemoved ?? 0} label="Eliminados (última corrida)" accent="red" />
        <Kpi value={last?.errors ?? 0} label="Errores (última corrida)" accent="orange" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {/* Estado de sincronización */}
        <div className="card p-4">
          <h3 className="text-[13px] font-bold text-fg-brand mb-2">Estado de sincronización</h3>
          <StatusRow label="Integración Drive (Service Account)" ok={sync.driveConfigured} value={sync.driveConfigured ? "Configurada" : "No configurada"} />
          <StatusRow label="Persistencia (Supabase service-role)" ok={sync.dbConfigured} value={sync.dbConfigured ? "Configurada" : "No configurada"} />
          <StatusRow
            label="Última corrida"
            ok={last ? last.status === "completed" : undefined}
            value={last ? `${STATUS_META[last.status]?.label ?? last.status} · ${fmtDateTime(last.startedAt)}` : "Nunca"}
          />
          <StatusRow label="Frecuencia" value="Diaria · 21:00 ART" ok />
          <StatusRow label="Próxima sincronización" value={fmtDateTime(sync.nextRunAt)} ok />
          {last && (
            <StatusRow
              label="Resultado última corrida"
              value={`${last.docsNew} nuevos · ${last.docsUpdated} mod. · ${last.docsRemoved} baja · ${last.contractsUpserted} contratos`}
            />
          )}
        </div>

        {/* Calidad documental */}
        <div className="card p-4">
          <h3 className="text-[13px] font-bold text-fg-brand mb-3">Calidad documental</h3>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-bg-surface-alt">
            {qSeg.filter((s) => s.v > 0).map((s) => (
              <div key={s.k} style={{ width: `${(s.v / qTotal) * 100}%`, background: s.color }} title={`${s.label}: ${s.v}`} />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {qSeg.map((s) => (
              <li key={s.k} className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                <span className="text-fg-secondary">{s.label}</span>
                <span className="ml-auto font-bold text-fg-primary tabular">{s.v}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-fg-muted">
            Prioridad de extracción: texto nativo → Google Docs → Google Sheets → PDF texto → OCR (sólo si
            es necesario).
          </p>
        </div>
      </div>

      {/* Alertas de sincronización */}
      <div className="card p-4">
        <h3 className="text-[13px] font-bold text-fg-brand mb-3">Alertas de sincronización</h3>
        {sync.alerts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stroke-soft p-6 text-center">
            <div className="mx-auto mb-2 grid place-items-center w-10 h-10 rounded-lg bg-bg-surface-alt text-fg-muted">
              <Icon name="check-circle" size={18} />
            </div>
            <div className="text-sm font-semibold text-fg-secondary">Sin alertas de sincronización</div>
            <p className="mt-1 text-xs text-fg-muted">
              Se generan ante documentos eliminados, adendas modificadas o rescisiones detectadas en Drive.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {sync.alerts.map((a, i) => {
              const meta = ALERT_META[a.action] ?? { label: a.action, color: "#8A94A6", icon: "bell" as IconName };
              return (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-stroke-soft px-3 py-2.5"
                  style={{ borderLeft: `4px solid ${meta.color}` }}
                >
                  <span className="grid place-items-center w-7 h-7 rounded-md text-white shrink-0" style={{ background: meta.color }}>
                    <Icon name={meta.icon} size={14} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-fg-primary">{meta.label}</span>
                    <span className="block truncate text-xs text-fg-muted">{a.titulo ?? a.detail ?? "—"}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-fg-muted">{fmtRel(a.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
