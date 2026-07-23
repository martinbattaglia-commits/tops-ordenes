import Link from "next/link";
import { StatusPill } from "@/components/tesoreria/ui";
import { AnularButton } from "@/components/tesoreria/AnularButton";
import { MovimientoOperativoForm } from "@/components/tesoreria/MovimientoOperativoForm";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listBankAccounts, listBeneficiaries, listMovements } from "@/lib/tesoreria/data";
import {
  MOVEMENT_TYPE_LABELS,
  MOVEMENT_TYPE_VALUES,
  OPERATIONAL_CATEGORY_LABELS,
} from "@/lib/tesoreria/types";

export const metadata = { title: "Movimientos · Tesorería" };
export const dynamic = "force-dynamic";

/**
 * Punto ÚNICO de Movimientos de Tesorería (Resolución de Dirección 2026-07-22):
 * consulta, registro de movimientos operativos, historial, anulación y filtro por
 * tipo conviven acá. No existe una entrada de menú separada: `/tesoreria/operativo`
 * redirige a esta pantalla.
 */
export default async function MovimientosPage({
  searchParams,
}: {
  searchParams?: { tipo?: string; q?: string };
}) {
  // Filtro y búsqueda viajan por querystring (form GET nativo, sin cliente) y se
  // aplican en la query, no en TS. `todos` = sin filtro.
  const tipoParam = searchParams?.tipo;
  const tipo =
    tipoParam && (MOVEMENT_TYPE_VALUES as readonly string[]).includes(tipoParam)
      ? tipoParam
      : undefined;
  const q = searchParams?.q?.trim() || undefined;

  try {
    const [movements, accounts, beneficiaries] = await Promise.all([
      listMovements({ limit: 200, type: tipo, search: q }),
      listBankAccounts(),
      listBeneficiaries(),
    ]);
    const activeAccounts = accounts.filter((a) => a.active);
    const beneficiaryById = new Map(beneficiaries.map((b) => [b.id, b.full_name]));

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Movimientos</h1>
            <p className="page-subtitle">
              Libro único de movimientos (fuente de verdad) y registro de movimientos operativos.
              Solo los confirmados impactan saldos. La anulación es lógica y auditada; los asientos
              de apertura (baseline) no se anulan desde acá.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] mb-6">
          <MovimientoOperativoForm accounts={activeAccounts} beneficiaries={beneficiaries} />

          <div className="card p-5">
            <h3 className="font-semibold mb-2">Cómo se registra</h3>
            <p className="text-sm text-fg-muted">
              Este formulario cubre los movimientos que no provienen de un pago a proveedor:
              honorarios, adelantos de sueldo y de directorio, reintegros, regularizaciones y gastos
              operativos. Las transferencias entre cuentas usan el flujo de Transferencias, y las
              cobranzas y pagos se registran en sus propios circuitos. Todos desembocan en el
              historial de abajo.
            </p>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold">Historial de movimientos</h3>
            {/* Filtro y búsqueda — form GET nativo, sin JS de cliente. */}
            <form method="GET" className="flex flex-wrap items-center gap-2">
              <label htmlFor="q" className="sr-only">
                Buscar por comprobante o concepto
              </label>
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={q ?? ""}
                placeholder="Buscar comprobante o concepto…"
                className="input"
              />
              <label htmlFor="tipo" className="text-sm text-fg-muted">
                Tipo
              </label>
              <select id="tipo" name="tipo" defaultValue={tipo ?? ""} className="input">
                <option value="">Todos</option>
                {MOVEMENT_TYPE_VALUES.map((t) => (
                  <option key={t} value={t}>
                    {MOVEMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-sm">
                Aplicar
              </button>
              {(tipo || q) && (
                <Link href="/tesoreria/movimientos" className="btn btn-sm">
                  Limpiar
                </Link>
              )}
            </form>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-1">Fecha</th>
                <th className="py-1">Comprobante</th>
                <th className="py-1">Tipo</th>
                <th className="py-1">Beneficiario</th>
                <th className="py-1">Dirección</th>
                <th className="py-1 text-right">Importe</th>
                <th className="py-1">Estado</th>
                <th className="py-1 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-fg-muted">
                    {tipo || q ? "Sin movimientos para ese criterio." : "Sin movimientos."}
                  </td>
                </tr>
              )}
              {movements.map((m) => {
                // Anulación operativa: solo movimientos operativos confirmados. La
                // baseline (type='ajuste') queda deliberadamente sin afordancia (D3).
                const anulable = m.type === "movimiento_operativo" && m.status === "confirmado";
                const label = m.operational_category
                  ? OPERATIONAL_CATEGORY_LABELS[m.operational_category]
                  : (MOVEMENT_TYPE_LABELS[m.type] ?? m.type);
                const beneficiario = m.beneficiary_id
                  ? beneficiaryById.get(m.beneficiary_id)
                  : undefined;
                return (
                  <tr key={m.id} className="border-t">
                    <td className="py-2">{fmtDate(m.date)}</td>
                    <td className="py-2 tabular">{m.public_id}</td>
                    <td className="py-2">{label}</td>
                    <td className="py-2">
                      {beneficiario ?? <span className="text-fg-muted">—</span>}
                    </td>
                    <td className="py-2">{m.direction}</td>
                    <td className="py-2 text-right tabular">{fmtCurrency(m.amount)}</td>
                    <td className="py-2">
                      <StatusPill status={m.status} />
                    </td>
                    <td className="py-2 text-right">
                      {anulable ? <AnularButton targetType="movement" targetId={m.id} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Movimientos no disponibles"
        migration="0053_treasury_core · 0193 · 0194_treasury_beneficiaries"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }
}
