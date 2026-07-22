import Link from "next/link";
import { StatusPill } from "@/components/tesoreria/ui";
import { AnularButton } from "@/components/tesoreria/AnularButton";
import { MovimientoOperativoForm } from "@/components/tesoreria/MovimientoOperativoForm";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listBankAccounts, listBeneficiaries, listOperationalMovements } from "@/lib/tesoreria/data";
import { OPERATIONAL_CATEGORY_LABELS } from "@/lib/tesoreria/types";

export const metadata = { title: "Movimiento operativo · Tesorería" };
export const dynamic = "force-dynamic";

export default async function MovimientoOperativoPage() {
  try {
    const [accounts, beneficiaries, operativos] = await Promise.all([
      listBankAccounts(),
      listBeneficiaries(),
      listOperationalMovements(20),
    ]);
    const activeAccounts = accounts.filter((a) => a.active);

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Movimiento operativo</h1>
            <p className="page-subtitle">
              Registrá movimientos de Tesorería que no provienen de un pago a proveedor: honorarios,
              adelantos de sueldo y de directorio, reintegros, regularizaciones y gastos operativos.
              Las transferencias entre cuentas usan el flujo de Transferencias.
            </p>
          </div>
          <Link href="/tesoreria/movimientos" className="btn btn-sm">Ver historial completo</Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <MovimientoOperativoForm accounts={activeAccounts} beneficiaries={beneficiaries} />

          <div className="card p-5">
            <h3 className="font-semibold mb-3">Últimos movimientos operativos</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="py-1">Fecha</th>
                  <th className="py-1">Comprobante</th>
                  <th className="py-1">Categoría</th>
                  <th className="py-1">Beneficiario</th>
                  <th className="py-1 text-right">Importe</th>
                  <th className="py-1">Estado</th>
                  <th className="py-1 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {operativos.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-fg-muted">Sin movimientos operativos aún.</td></tr>
                )}
                {operativos.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="py-2">{fmtDate(m.date)}</td>
                    <td className="py-2 tabular">{m.public_id}</td>
                    <td className="py-2">{m.operational_category ? OPERATIONAL_CATEGORY_LABELS[m.operational_category] : "—"}</td>
                    <td className="py-2">{m.beneficiary_name ?? <span className="text-fg-muted">—</span>}</td>
                    <td className="py-2 text-right tabular">{fmtCurrency(m.amount)}</td>
                    <td className="py-2"><StatusPill status={m.status} /></td>
                    <td className="py-2 text-right">
                      {m.status === "confirmado" ? <AnularButton targetType="movement" targetId={m.id} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Movimiento operativo no disponible"
        migration="0193 + 0194_treasury_beneficiaries"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }
}
