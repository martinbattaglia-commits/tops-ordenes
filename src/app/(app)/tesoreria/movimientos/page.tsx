import Link from "next/link";
import { StatusPill } from "@/components/tesoreria/ui";
import { AnularButton } from "@/components/tesoreria/AnularButton";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listMovements } from "@/lib/tesoreria/data";
import { MOVEMENT_TYPE_LABELS, OPERATIONAL_CATEGORY_LABELS } from "@/lib/tesoreria/types";

export const metadata = { title: "Movimientos · Tesorería" };
export const dynamic = "force-dynamic";

export default async function MovimientosPage() {
  try {
    const movements = await listMovements({ limit: 200 });

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Historial de movimientos</h1>
            <p className="page-subtitle">
              Libro único de movimientos (fuente de verdad). Solo confirmados impactan saldos. La
              anulación es lógica y auditada; los asientos de apertura (baseline) no se anulan desde acá.
            </p>
          </div>
          <Link href="/tesoreria/operativo" className="btn btn-primary btn-sm">Registrar movimiento operativo</Link>
        </div>

        <div className="card p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-1">Fecha</th>
                <th className="py-1">Comprobante</th>
                <th className="py-1">Tipo</th>
                <th className="py-1">Dirección</th>
                <th className="py-1 text-right">Importe</th>
                <th className="py-1">Estado</th>
                <th className="py-1 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 && (
                <tr><td colSpan={7} className="py-4 text-fg-muted">Sin movimientos.</td></tr>
              )}
              {movements.map((m) => {
                // Anulación operativa: solo movimientos operativos confirmados. La
                // baseline (type='ajuste') queda deliberadamente sin afordancia (D3).
                const anulable = m.type === "movimiento_operativo" && m.status === "confirmado";
                const tipo = m.operational_category
                  ? OPERATIONAL_CATEGORY_LABELS[m.operational_category]
                  : (MOVEMENT_TYPE_LABELS[m.type] ?? m.type);
                return (
                  <tr key={m.id} className="border-t">
                    <td className="py-2">{fmtDate(m.date)}</td>
                    <td className="py-2 tabular">{m.public_id}</td>
                    <td className="py-2">{tipo}</td>
                    <td className="py-2">{m.direction}</td>
                    <td className="py-2 text-right tabular">{fmtCurrency(m.amount)}</td>
                    <td className="py-2"><StatusPill status={m.status} /></td>
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
      <ModuleUnavailable title="Movimientos no disponibles" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />
    );
  }
}
