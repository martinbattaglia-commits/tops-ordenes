import Link from "next/link";
import { fmtCurrency, fmtDate, fmtDateTime } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { StatusPill } from "@/components/tesoreria/ui";
import { canAccess } from "@/lib/rbac/guard";

// ── Módulo NATIVO (fuente de verdad) ──────────────────────────────────────
import { listCajaMovimientos, getCajaSaldoErp, listResponsables } from "@/lib/tesoreria/caja-chica/native-data";
import {
  filterCajaMovimientos,
  monthlyIngresoEgreso,
  ingresoEgresoSplit,
  resumenCaja,
} from "@/lib/tesoreria/caja-chica/native-logic";
import { EvolucionMensualChart } from "@/components/tesoreria/caja-chica/EvolucionMensualChart";
import { IngresoEgresoDonut } from "@/components/tesoreria/caja-chica/IngresoEgresoDonut";
import { RegistrarCajaModal } from "@/components/tesoreria/caja-chica/RegistrarCajaModal";
import { AnularCajaButton } from "@/components/tesoreria/caja-chica/AnularCajaButton";

// ── Histórico de la planilla (legado, sólo lectura) ───────────────────────
import { listPeriodos, getResumen, listMovimientos } from "@/lib/tesoreria/caja-chica/data";
import { monthlyGasto, categoriaDistribution } from "@/lib/tesoreria/caja-chica/dashboard-logic";
import { GastoMensualChart } from "@/components/tesoreria/caja-chica/GastoMensualChart";
import { CategoriaDonut } from "@/components/tesoreria/caja-chica/CategoriaDonut";

export const metadata = { title: "Caja Chica" };
export const dynamic = "force-dynamic";

/**
 * Caja Chica — MÓDULO INDEPENDIENTE de Nexus ERP (CCN-001B).
 * Reutiliza la infraestructura transaccional y de auditoría del motor de
 * Tesorería; no es un motor paralelo. El saldo lo deriva la base
 * (`treasury_bank_balances`) y el libro es `treasury_movements` type='caja_chica'.
 *
 * La solapa «Histórico (planilla)» conserva, sólo para consulta, el período
 * espejado desde Drive: Nexus dejó de escribir en Google Sheets.
 */
type SP = { [k: string]: string | string[] | undefined };
const one = (sp: SP, k: string): string | undefined => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

function KpiCard({ label, value, tone, sub }: { label: string; value: string; tone?: "ok" | "bad" | "warn" | "neutral"; sub?: string }) {
  const color =
    tone === "ok" ? "text-status-success" : tone === "bad" ? "text-tops-red" : tone === "warn" ? "text-status-warning" : "text-fg-brand";
  return (
    <div className="card p-5">
      <div className="text-eyebrow-sm uppercase text-fg-muted">{label}</div>
      <div className={`text-2xl lg:text-3xl font-bold tabular -tracking-[0.01em] ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-fg-muted mt-1">{sub}</div>}
    </div>
  );
}

function Tabs({ tab }: { tab: "nativo" | "historico" }) {
  const base = "px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px";
  return (
    <div className="flex gap-1 border-b border-stroke-soft mb-6">
      <Link
        href="/tesoreria/caja-chica"
        className={`${base} ${tab === "nativo" ? "border-fg-brand text-fg-brand" : "border-transparent text-fg-secondary"}`}
      >
        Movimientos
      </Link>
      <Link
        href="/tesoreria/caja-chica?tab=historico"
        className={`${base} ${tab === "historico" ? "border-fg-brand text-fg-brand" : "border-transparent text-fg-secondary"}`}
      >
        Histórico (planilla)
      </Link>
    </div>
  );
}

export default async function CajaChicaPage({ searchParams }: { searchParams: SP }) {
  const tab = one(searchParams, "tab") === "historico" ? "historico" : "nativo";
  const ctrl = "border border-stroke-soft rounded-md px-2 py-1 text-sm bg-transparent";

  const canView = await canAccess("tesoreria.caja.view");
  if (!canView) {
    return (
      <div className="p-8">
        <div className="card p-8 max-w-2xl mx-auto">
          <h1 className="text-xl font-bold text-fg-brand mb-2">Caja Chica</h1>
          <p className="text-sm text-fg-secondary">
            No tenés permiso para ver este módulo. Requiere{" "}
            <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">tesoreria.caja.view</code>.
          </p>
        </div>
      </div>
    );
  }

  try {
    // ════════════════ Solapa: Histórico de la planilla (legado) ════════════
    if (tab === "historico") {
      const periodos = await listPeriodos();
      const periodo = Number(one(searchParams, "periodo")) || periodos[0] || new Date().getFullYear();
      const [resumen, movs] = await Promise.all([getResumen(periodo), listMovimientos(periodo)]);
      const barras = monthlyGasto(movs);
      const dist = categoriaDistribution(movs);

      return (
        <div className="p-4 lg:p-8 nx-page-fade">
          <div className="page-header">
            <div>
              <div className="eyebrow-tiny">Finanzas · Tesorería</div>
              <h1 className="page-title">Caja Chica</h1>
              <p className="page-subtitle">
                Histórico de la planilla de Drive, sólo lectura. Se conserva como respaldo y consulta
                del período anterior al módulo nativo. Nexus ya no escribe en Google Sheets.
              </p>
            </div>
          </div>

          <Tabs tab="historico" />

          <form method="get" className="card p-4 mb-6 flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="historico" />
            <label className="text-xs text-fg-muted flex flex-col gap-1">
              Período
              <select name="periodo" defaultValue={String(periodo)} className={ctrl}>
                {(periodos.length ? periodos : [periodo]).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary btn-sm">Aplicar</button>
          </form>

          <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)" }}>
            <GastoMensualChart data={barras} />
            <CategoriaDonut slices={dist} />
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Movimientos de la planilla</h2>
              <span className="text-xs text-fg-muted tabular">
                {movs.length} · saldo planilla {resumen?.saldo_excel == null ? "—" : fmtCurrency(resumen.saldo_excel)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted border-b">
                    <th className="py-1 pr-2">Fecha</th>
                    <th className="py-1 pr-2">Concepto</th>
                    <th className="py-1 pr-2">Categoría</th>
                    <th className="py-1 pr-2 text-right">Importe</th>
                    <th className="py-1">Dirección</th>
                  </tr>
                </thead>
                <tbody>
                  {movs.map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="py-2 pr-2 whitespace-nowrap text-fg-secondary">
                        {m.tx_date ? fmtDate(m.tx_date) : m.tx_date_raw || "—"}
                      </td>
                      <td className="py-2 pr-2">{m.concepto}</td>
                      <td className="py-2 pr-2">
                        <span className="inline-block rounded-pill bg-neutral-100 text-fg-secondary px-2 py-0.5 text-[11px]">
                          {m.categoria}
                        </span>
                      </td>
                      <td className={`py-2 pr-2 text-right tabular whitespace-nowrap ${m.direction === "acreditado" ? "text-status-success" : "text-tops-red"}`}>
                        {m.direction === "acreditado" ? "+" : "−"}
                        {fmtCurrency(m.importe)}
                      </td>
                      <td className="py-2">
                        <span className={`rounded-pill px-2 py-0.5 text-[10px] uppercase font-bold ${m.direction === "acreditado" ? "bg-status-success text-white" : "bg-tops-red text-white"}`}>
                          {m.direction}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {movs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-fg-muted text-sm">
                        No hay datos de planilla para este ejercicio.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    // ════════════════ Solapa: Movimientos (nativo) ═════════════════════════
    const [canCreate, canEdit] = await Promise.all([
      canAccess("tesoreria.caja.create"),
      canAccess("tesoreria.caja.edit"),
    ]);

    const [movs, saldoErp, responsables] = await Promise.all([
      listCajaMovimientos(),
      getCajaSaldoErp(),
      canCreate ? listResponsables() : Promise.resolve([]),
    ]);

    const tipo = one(searchParams, "tipo");
    const desde = one(searchParams, "desde");
    const hasta = one(searchParams, "hasta");
    const filtrados = filterCajaMovimientos(movs, { tipo, desde, hasta });

    const kpi = resumenCaja(movs, saldoErp);
    const barras = monthlyIngresoEgreso(filtrados);
    const split = ingresoEgresoSplit(filtrados);

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Caja Chica</h1>
            <p className="page-subtitle">
              Registro de ingresos y egresos de caja. El saldo se deriva del motor de Tesorería;
              la anulación es lógica y auditada.
            </p>
          </div>
          {canCreate && <RegistrarCajaModal responsables={responsables} />}
        </div>

        <Tabs tab="nativo" />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <KpiCard
            label="Saldo Actual"
            value={kpi.saldoActual == null ? "—" : fmtCurrency(kpi.saldoActual)}
            tone={kpi.saldoActual != null && kpi.saldoActual <= 0 ? "bad" : "ok"}
            sub="incluye lo registrado"
          />
          <KpiCard
            label="Saldo ERP"
            value={kpi.saldoErp == null ? "—" : fmtCurrency(kpi.saldoErp)}
            tone="neutral"
            sub="Σ confirmados"
          />
          <KpiCard
            label="Diferencia"
            value={kpi.diferencia == null ? "—" : fmtCurrency(kpi.diferencia)}
            tone={kpi.diferencia != null && kpi.diferencia !== 0 ? "warn" : "neutral"}
            sub="Actual − ERP"
          />
          <KpiCard label="Cantidad de Movimientos" value={String(kpi.cantidad)} tone="neutral" sub="del período" />
          <KpiCard
            label="Última Operación"
            value={kpi.ultimaOperacion ? fmtDateTime(kpi.ultimaOperacion) : "—"}
            tone="neutral"
            sub="último registro"
          />
        </div>

        <form method="get" className="card p-4 mb-6 flex flex-wrap items-end gap-3">
          <label className="text-xs text-fg-muted flex flex-col gap-1">
            Tipo
            <select name="tipo" defaultValue={tipo ?? ""} className={ctrl}>
              <option value="">Todos</option>
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
          </label>
          <label className="text-xs text-fg-muted flex flex-col gap-1">
            Desde
            <input type="date" name="desde" defaultValue={desde ?? ""} className={ctrl} />
          </label>
          <label className="text-xs text-fg-muted flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={hasta ?? ""} className={ctrl} />
          </label>
          <button type="submit" className="btn btn-primary btn-sm">Aplicar</button>
          <a href="/tesoreria/caja-chica" className="btn btn-sm">Limpiar</a>
        </form>

        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)" }}>
          <EvolucionMensualChart data={barras} />
          <IngresoEgresoDonut split={split} />
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Movimientos</h2>
            <span className="text-xs text-fg-muted tabular">{filtrados.length} de {movs.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted border-b">
                  <th className="py-1 pr-2">Fecha</th>
                  <th className="py-1 pr-2">Concepto</th>
                  <th className="py-1 pr-2">Responsable</th>
                  <th className="py-1 pr-2 text-right">Importe</th>
                  <th className="py-1 pr-2">Tipo</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {filtrados.map((m) => {
                  const anulado = m.status === "anulado";
                  return (
                    <tr key={m.movement_id} className={`border-t ${anulado ? "text-fg-muted" : ""}`}>
                      <td className="py-2 pr-2 whitespace-nowrap text-fg-secondary">{m.date ? fmtDate(m.date) : "—"}</td>
                      <td className="py-2 pr-2">
                        <span className={anulado ? "line-through" : ""}>{m.concepto}</span>
                        {m.observaciones && <div className="text-[11px] text-fg-muted">{m.observaciones}</div>}
                        {anulado && m.void_reason && (
                          <div className="text-[11px] text-fg-muted">motivo: {m.void_reason}</div>
                        )}
                      </td>
                      <td className="py-2 pr-2">{m.responsable ?? "—"}</td>
                      <td className={`py-2 pr-2 text-right tabular whitespace-nowrap ${anulado ? "" : m.direction === "ingreso" ? "text-status-success" : "text-tops-red"}`}>
                        {m.direction === "ingreso" ? "+" : "−"}
                        {fmtCurrency(m.amount)}
                      </td>
                      <td className="py-2 pr-2">
                        {anulado ? (
                          <StatusPill status="anulado" />
                        ) : (
                          <span className={`rounded-pill px-2 py-0.5 text-[10px] uppercase font-bold ${m.direction === "ingreso" ? "bg-status-success text-white" : "bg-tops-red text-white"}`}>
                            {m.direction}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {canEdit && !anulado && <AnularCajaButton movementId={m.movement_id} />}
                      </td>
                    </tr>
                  );
                })}
                {filtrados.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-fg-muted text-sm">
                      {movs.length === 0
                        ? "Aún no hay movimientos registrados en Caja Chica."
                        : "Sin movimientos para los filtros aplicados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Caja Chica no disponible"
        migration="0195–0198 (Caja Chica nativa: enums · fundación · constraint · RPCs)"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }
}
