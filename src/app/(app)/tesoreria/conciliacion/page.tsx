/**
 * Conciliación Bancaria — página viva (S4 → E2 · TREAS-RECON-001).
 *
 * RBAC: requiere `tesoreria.conciliacion.view`. Sube extracto → ingesta →
 * dashboard en vivo → aprobación humana (sólo con `…approve`) → cierre
 * (sistémicos por lote / ajustes por diferencia). Ship-dark: sin permiso, el
 * módulo no se ve.
 *
 * E2: la cuenta ya NO se fija con `accounts[0]` (causa del piloto fallido:
 * extractos Santander asociados a «Caja Efectivo»). El usuario la elige y se
 * valida la coherencia banco↔cuenta en cliente, route y RPC.
 */
import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listBankAccounts } from "@/lib/tesoreria/data";
import { getStatementResult, listPendingMatches, getClosureTargets } from "@/lib/tesoreria/conciliacion/data";
import { ConciliacionUploader } from "@/components/tesoreria/conciliacion/ConciliacionUploader";
import { ConciliacionDashboard } from "@/components/tesoreria/conciliacion/ConciliacionDashboard";
import { AprobacionIsland } from "@/components/tesoreria/conciliacion/AprobacionIsland";
import { CierreIsland } from "@/components/tesoreria/conciliacion/CierreIsland";
import type { CuentaParaIngesta } from "@/lib/tesoreria/conciliacion/account-guard";

export const metadata = { title: "Conciliación bancaria · Tesorería" };
export const dynamic = "force-dynamic";

export default async function ConciliacionPage({ searchParams }: { searchParams: { s?: string } }) {
  if (!(await canAccess("tesoreria.conciliacion.view"))) {
    return <AccesoRestringido modulo="Tesorería · Conciliación bancaria" />;
  }
  try {
    const [accounts, canApprove] = await Promise.all([
      listBankAccounts(),
      canAccess("tesoreria.conciliacion.approve"),
    ]);
    // Sólo cuentas bancarias activas: Caja no admite conciliación de extractos.
    const cuentas: CuentaParaIngesta[] = accounts
      .filter((a) => a.active && a.account_type !== "caja")
      .map((a) => ({
        id: a.id,
        bank_name: a.bank_name,
        account_name: a.account_name,
        account_type: a.account_type,
        currency: a.currency,
        active: a.active,
      }));
    const statementId = searchParams.s;
    const [result, pendientes, closure] = await Promise.all([
      statementId ? getStatementResult(statementId) : Promise.resolve(null),
      statementId && canApprove ? listPendingMatches(statementId) : Promise.resolve([]),
      statementId && canApprove ? getClosureTargets(statementId) : Promise.resolve(null),
    ]);

    return (
      <div className="p-4 lg:p-8 nx-page-fade space-y-6">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Conciliación bancaria</h1>
            <p className="page-subtitle">Subí el extracto, conciliá contra Nexus y aprobá las sugerencias. Cruce duro de saldo (Δ 0,00).</p>
          </div>
        </div>

        {cuentas.length === 0 ? (
          <p className="text-sm text-tops-red">No hay cuentas bancarias activas disponibles para conciliar.</p>
        ) : (
          <ConciliacionUploader cuentas={cuentas} bankAccountId={cuentas.length === 1 ? cuentas[0].id : undefined} />
        )}

        {result && (
          <>
            {canApprove && <AprobacionIsland pendientes={pendientes} />}
            {canApprove && closure && statementId && <CierreIsland statementId={statementId} targets={closure} />}
            <ConciliacionDashboard banco="santander" metrics={result.metrics} matches={result.matches} movimientos={result.movimientos} />
          </>
        )}
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="Conciliación no disponible" migration="0211_bank_recon_baseline_asbuilt" detail={e instanceof Error ? e.message : String(e)} />;
  }
}
