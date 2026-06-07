import { Kpi } from "@/components/tesoreria/ui";
import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { TransferenciaForm } from "@/components/tesoreria/TransferenciaForm";
import { getBankBalances, listBankAccounts } from "@/lib/tesoreria/data";

export const metadata = { title: "Bancos · Tesorería" };
export const dynamic = "force-dynamic";

export default async function BancosPage() {
  try {
    const [balances, accounts] = await Promise.all([getBankBalances(), listBankAccounts()]);
    const total = balances.reduce((s, b) => s + Number(b.balance), 0); // roll-up server-side (D1)

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Bancos</h1>
            <p className="page-subtitle">Cuentas (Santander, Galicia y Caja) con saldo derivado de la base.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Kpi label="Saldo total" value={total} />
        </div>

        <div className="card p-5 mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-1">Banco</th>
                <th className="py-1">Cuenta</th>
                <th className="py-1">Tipo</th>
                <th className="py-1 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.bank_account_id} className="border-t">
                  <td className="py-2">{b.bank_name}{b.is_system ? " · CAJA" : ""}</td>
                  <td className="py-2">{b.account_name}</td>
                  <td className="py-2">{b.account_type}</td>
                  <td className="py-2 text-right tabular">{fmtCurrency(b.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <TransferenciaForm accounts={accounts} />
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable title="Bancos no disponibles" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />
    );
  }
}
