/**
 * Dashboard de Conciliación Bancaria — Sprint 3 (presentacional, server-safe).
 *
 * Render compartido por Galicia/Santander. Recibe las métricas y los matches ya
 * computados (motor puro) y muestra:
 *   1. KPIs (conciliados/posibles/no conciliados/sistémicos · montos · Δ saldo · %)
 *   2. Movimientos Sistémicos por subtipo (info de alto valor para Finanzas)
 *   3. Panel de Diferencias (línea banco ↔ Nexus sugerido · score · motivo)
 *   4. Tabla de Conciliación (detalle completo)
 *
 * No calcula nada: sólo formatea. Montos en centavos → pesos vía fmtCurrency.
 */
import { fmtCurrency, fmtDate } from "@/lib/utils";
import type { DashboardConciliacion } from "@/lib/tesoreria/conciliacion/dashboard";
import type { EstadoLinea, MatchLinea, MovimientoNexus } from "@/lib/tesoreria/conciliacion/matching";

const pesos = (cents: number) => fmtCurrency(cents / 100);

const ESTADO_PILL: Record<EstadoLinea, { cls: string; label: string }> = {
  conciliado: { cls: "bg-status-success text-white", label: "Conciliado" },
  posible: { cls: "bg-status-warning text-white", label: "Posible" },
  no_conciliado: { cls: "bg-tops-red text-white", label: "No conciliado" },
  sistemico: { cls: "bg-tops-blue-700 text-white", label: "Sistémico" },
};

function EstadoBadge({ estado }: { estado: EstadoLinea }) {
  const e = ESTADO_PILL[estado];
  return (
    <span className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${e.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
      {e.label}
    </span>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-fg-muted">{label}</div>
      <div className={`text-2xl font-black tabular mt-1 ${accent ?? "text-fg-primary"}`}>{value}</div>
      {sub && <div className="text-[11px] text-fg-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function ConciliacionDashboard({
  banco,
  metrics,
  matches,
  movimientos,
}: {
  banco: "santander" | "galicia";
  metrics: DashboardConciliacion;
  matches: MatchLinea[];
  movimientos: MovimientoNexus[];
}) {
  const movById = new Map(movimientos.map((m) => [m.id, m]));
  const diferencias = matches.filter((m) => m.estado === "posible" || m.estado === "no_conciliado");
  const deltaOk = metrics.deltaSaldoCents === 0;

  return (
    <div className="space-y-6">
      {/* 1 · KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Conciliados" value={String(metrics.conciliados)} accent="text-status-success" />
        <Kpi label="Posibles" value={String(metrics.posibles)} accent="text-status-warning" />
        <Kpi label="No conciliados" value={String(metrics.noConciliados)} accent="text-tops-red" />
        <Kpi label="Sistémicos" value={String(metrics.sistemicos)} accent="text-fg-link" sub={pesos(metrics.montoSistemicoCents)} />
        <Kpi label="Monto resuelto" value={pesos(metrics.montoConciliadoCents)} sub="conciliado + sistémico" />
        <Kpi label="Monto pendiente" value={pesos(metrics.montoPendienteCents)} accent="text-status-warning" />
        <Kpi
          label="Diferencia de saldo"
          value={deltaOk ? "$ 0,00" : pesos(metrics.deltaSaldoCents)}
          accent={deltaOk ? "text-status-success" : "text-tops-red"}
          sub={deltaOk ? "Cuadra ✔" : "Revisar"}
        />
        <Kpi label="% Conciliado" value={`${metrics.pctConciliado}%`} accent="text-fg-brand" sub={`IA usada: ${metrics.usoIa}`} />
      </div>

      {/* 2 · Movimientos Sistémicos */}
      <div className="card p-5 overflow-x-auto">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">Movimientos sistémicos</h2>
            <p className="text-xs text-fg-muted mt-0.5">Impuestos, percepciones, intereses y comisiones del banco — clasificación determinística (sin IA).</p>
          </div>
          <span className="text-sm text-fg-muted">
            Total: <strong className="text-fg-brand tabular">{pesos(metrics.montoSistemicoCents)}</strong>
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="py-1">Concepto</th>
              <th className="py-1 text-right">Movimientos</th>
              <th className="py-1 text-right">Monto</th>
              <th className="py-1 text-right">% del total</th>
            </tr>
          </thead>
          <tbody>
            {metrics.sistemicosPorSubtipo.length === 0 && (
              <tr><td colSpan={4} className="py-3 text-fg-muted">Sin movimientos sistémicos.</td></tr>
            )}
            {metrics.sistemicosPorSubtipo.map((s) => (
              <tr key={s.subtipo} className="border-t border-stroke-soft">
                <td className="py-2 font-semibold text-fg-secondary">{s.label}</td>
                <td className="py-2 text-right tabular text-fg-secondary">{s.count}</td>
                <td className="py-2 text-right tabular font-bold text-fg-brand">{pesos(s.montoCents)}</td>
                <td className="py-2 text-right tabular text-fg-muted">{s.pctMonto}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-tops-blue-700 bg-tops-blue-900/[0.10]">
              <td className="py-2.5 text-sm font-black uppercase tracking-wide text-fg-primary">Total sistémico</td>
              <td className="py-2.5 text-right tabular font-black text-fg-primary">{metrics.sistemicos}</td>
              <td className="py-2.5 text-right tabular text-lg font-black text-fg-brand">{pesos(metrics.montoSistemicoCents)}</td>
              <td className="py-2.5 text-right tabular text-fg-muted">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 3 · Panel de diferencias */}
      <div className="card p-5 overflow-x-auto">
        <h2 className="font-semibold mb-1">Panel de diferencias</h2>
        <p className="text-xs text-fg-muted mb-3">Líneas que requieren revisión humana — aceptar/rechazar la sugerencia (nunca se registra solo).</p>
        {diferencias.length === 0 ? (
          <p className="text-sm text-fg-muted py-2">Sin diferencias: todo conciliado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-1">Movimiento banco</th>
                <th className="py-1">Nexus sugerido</th>
                <th className="py-1 text-center">Score</th>
                <th className="py-1">Motivo</th>
                <th className="py-1 text-center">Acción</th>
              </tr>
            </thead>
            <tbody>
              {diferencias.map((d, i) => {
                const sugeridos = d.movimientoIds.map((id) => movById.get(id)).filter(Boolean) as MovimientoNexus[];
                return (
                  <tr key={`${d.linea.fecha}-${i}`} className="border-t border-stroke-soft align-top">
                    <td className="py-2 pr-3">
                      <div className="tabular text-fg-primary">{pesos(d.linea.importe)} <span className="text-[10px] text-fg-muted uppercase">{d.linea.tipo}</span></div>
                      <div className="text-[11px] text-fg-secondary">{fmtDate(d.linea.fecha)} · {d.linea.descripcion.slice(0, 48)}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {sugeridos.length === 0 ? (
                        <span className="text-[11px] text-fg-muted">— sin sugerencia</span>
                      ) : (
                        sugeridos.map((m) => (
                          <div key={m.id} className="text-[11px] text-fg-secondary">
                            <span className="tabular">{pesos(m.importe)}</span> · {m.contraparte ?? m.descripcion.slice(0, 28)}{m.cuit ? ` · ${m.cuit}` : ""}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="py-2 text-center">
                      <span className="tabular font-bold">{d.score > 0 ? `${d.score}%` : "—"}</span>
                      <div className="text-[9px] uppercase text-fg-muted">{d.metodo}</div>
                    </td>
                    <td className="py-2 pr-3 text-[11px] text-fg-muted">{d.motivo}</td>
                    <td className="py-2 text-center whitespace-nowrap">
                      {d.estado === "no_conciliado" ? (
                        <span className="text-[10px] text-fg-muted">Crear ajuste</span>
                      ) : (
                        <span className="inline-flex gap-1">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-status-success/15 text-status-success">Aceptar</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-tops-red/10 text-tops-red">Rechazar</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 4 · Tabla de conciliación (detalle completo) */}
      <div className="card p-5 overflow-x-auto">
        <h2 className="font-semibold mb-3">Tabla de conciliación · {banco === "santander" ? "Santander" : "Galicia"}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="py-1">Fecha</th>
              <th className="py-1">Concepto</th>
              <th className="py-1 text-right">Importe</th>
              <th className="py-1">Estado</th>
              <th className="py-1">Método</th>
              <th className="py-1 text-center">Score</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m, i) => (
              <tr key={`${m.linea.fecha}-${i}`} className="border-t border-stroke-soft">
                <td className="py-1.5 text-fg-secondary whitespace-nowrap">{fmtDate(m.linea.fecha)}</td>
                <td className="py-1.5 text-fg-secondary">{m.linea.descripcion.slice(0, 52)}</td>
                <td className="py-1.5 text-right tabular text-fg-primary">{pesos(m.linea.importe)} <span className="text-[9px] text-fg-muted uppercase">{m.linea.tipo === "credito" ? "C" : "D"}</span></td>
                <td className="py-1.5"><EstadoBadge estado={m.estado} /></td>
                <td className="py-1.5 text-[11px] text-fg-muted uppercase">{m.metodo}</td>
                <td className="py-1.5 text-center tabular text-fg-secondary">{m.score > 0 ? m.score : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
