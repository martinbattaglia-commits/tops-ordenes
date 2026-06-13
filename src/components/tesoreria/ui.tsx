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

/**
 * Variante "cuenta corriente" (Cobranzas / Pagos): un saldo PENDIENTE es deuda
 * impaga, no un estado informativo → se muestra como ALERTA roja corporativa
 * para que Tesorería identifique al instante qué sigue sin saldarse. Sólo
 * cambia `pendiente`; el resto del semáforo se conserva. Las pantallas de
 * movimientos/bancos (donde "pendiente" = movimiento por confirmar) mantienen
 * el azul informativo usando la variante por defecto.
 */
const STATUS_PILL_CUENTA: Record<string, string> = {
  ...STATUS_PILL,
  pendiente: "bg-tops-red text-white",
};

/** Estados que exigen atención inmediata → badge más prominente (sólo cuenta). */
const CUENTA_ALERTA = new Set(["pendiente", "vencida", "parcial"]);

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

export function StatusPill({
  status,
  dueDate,
  variant = "default",
}: {
  status: string;
  dueDate?: string | null;
  /** "cuenta" → semántica cobranzas/pagos: PENDIENTE = alerta roja + badge prominente. */
  variant?: "default" | "cuenta";
}) {
  const s = (status || "").toLowerCase();
  const map = variant === "cuenta" ? STATUS_PILL_CUENTA : STATUS_PILL;
  const cls = map[s] ?? "bg-neutral-400 text-white";
  const emphatic = variant === "cuenta" && CUENTA_ALERTA.has(s);
  const overdue = s === "vencida";
  const dias = diasTexto(s, dueDate);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 rounded-pill uppercase tracking-wide ${cls} ${
          emphatic
            ? "px-2.5 py-1 text-[11px] font-extrabold ring-1 ring-white/20 shadow-sm"
            : "px-2 py-0.5 text-[10px] font-bold"
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
        {status}
      </span>
      {dias && (
        <span
          className={`text-[10px] whitespace-nowrap ${
            emphatic && overdue ? "font-bold text-tops-red" : "text-fg-muted"
          }`}
        >
          {dias}
        </span>
      )}
    </span>
  );
}
