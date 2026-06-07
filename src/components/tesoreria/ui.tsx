/**
 * Presentacionales compartidos de Tesorería (ERP-A4). Componen primitivos del
 * Design System Nexus (CountUp, badge/dot, clases page-*). No inventan estilo.
 * Server-safe (sin "use client").
 */
import { CountUp } from "@/components/CountUp";

export function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-5">
      <div className="text-eyebrow-sm uppercase text-fg-muted">{label}</div>
      <div className="text-3xl font-bold text-fg-brand tabular -tracking-[0.01em]">
        <CountUp to={value} format="currency" />
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className="badge">
      <span className="dot" />
      {status}
    </span>
  );
}
