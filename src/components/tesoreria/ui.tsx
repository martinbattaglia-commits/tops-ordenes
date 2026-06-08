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

/**
 * Estado con semántica visual (cobranzas/pagos/movimientos).
 * Pills SÓLIDOS con texto blanco → contraste AA/AAA idéntico en dark y light
 * (el fondo no depende del tema). vencida=rojo · parcial=amarillo ·
 * pendiente=azul corporativo · cobrada/pagada/confirmado=verde · otros=neutro.
 * `dueDate` (opcional) agrega "Hace N días" / "Vence en N días" / "Saldo pendiente".
 */
const STATUS_PILL: Record<string, string> = {
  vencida: "bg-tops-red text-white",
  parcial: "bg-status-warning text-white",
  pendiente: "bg-tops-blue-700 text-white",
  cobrada: "bg-status-success text-white",
  pagada: "bg-status-success text-white",
  confirmado: "bg-status-success text-white",
  anulado: "bg-neutral-400 text-white",
};

function diasTexto(estado: string, dueDate?: string | null): string | null {
  if (estado === "parcial") return "Saldo pendiente";
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (estado === "vencida" || diff < 0) {
    const n = Math.abs(diff);
    return `Hace ${n} día${n === 1 ? "" : "s"}`;
  }
  if (diff === 0) return "Vence hoy";
  return `Vence en ${diff} día${diff === 1 ? "" : "s"}`;
}

export function StatusPill({ status, dueDate }: { status: string; dueDate?: string | null }) {
  const s = (status || "").toLowerCase();
  const cls = STATUS_PILL[s] ?? "bg-neutral-400 text-white";
  const dias = diasTexto(s, dueDate);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-bold uppercase tracking-wide ${cls}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
        {status}
      </span>
      {dias && <span className="text-[10px] text-fg-muted whitespace-nowrap">{dias}</span>}
    </span>
  );
}
