// Banner de conciliación de Caja Chica. Server-safe (sin "use client").
import { fmtCurrency, fmtDateTime } from "@/lib/utils";
import type { ResumenRow } from "@/lib/tesoreria/caja-chica/data";
import type { ConciliacionTone } from "@/lib/tesoreria/caja-chica/dashboard-logic";

const TONE: Record<ConciliacionTone, { pill: string; label: string; border: string }> = {
  ok: { pill: "bg-status-success text-white", label: "Conciliado", border: "border-status-success" },
  warn: { pill: "bg-status-warning text-white", label: "Revisar", border: "border-status-warning" },
  error: { pill: "bg-tops-red text-white", label: "Error", border: "border-tops-red" },
};

export function ConciliacionBanner({ resumen, tone }: { resumen: ResumenRow | null; tone: ConciliacionTone }) {
  const cfg = TONE[tone];
  const excel = resumen?.saldo_excel ?? null;
  const calc = resumen?.saldo_calculado ?? 0;
  const delta = resumen?.saldo_delta ?? null;
  return (
    <div className={`card p-4 mb-6 border-l-4 ${cfg.border}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${cfg.pill}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
          {cfg.label}
        </span>
        <span className="text-sm text-fg-secondary">
          Saldo planilla <b className="text-fg-primary tabular">{excel == null ? "—" : fmtCurrency(excel)}</b>
          {"  ·  "}Σ Nexus <b className="text-fg-primary tabular">{fmtCurrency(calc)}</b>
          {"  ·  Δ "}<b className="tabular">{delta == null ? "—" : fmtCurrency(delta)}</b>
          {resumen?.saldo_source === "calc_fallback" && (
            <span className="ml-1 text-status-warning">(saldo calculado: etiqueta «SALDO» no hallada)</span>
          )}
        </span>
        <span className="ml-auto text-xs text-fg-muted">
          {resumen?.last_run_id && (
            <>
              run <code className="tabular">{resumen.last_run_id.slice(0, 8)}</code>
              {"  ·  "}
            </>
          )}
          warnings {resumen?.last_warnings ?? 0}
          {"  ·  "}
          {resumen?.last_status ?? "sin sync"}
          {"  ·  "}
          {resumen?.ultima_sync ? fmtDateTime(resumen.ultima_sync) : "—"}
        </span>
      </div>
    </div>
  );
}
