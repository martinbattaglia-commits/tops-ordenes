/**
 * Conciliación Bancaria — página viva (S4, server component).
 *
 * RBAC: requiere `tesoreria.conciliacion.view`. Sube extracto → ingesta →
 * dashboard en vivo → aprobación humana (sólo con `…approve`). Ship-dark:
 * sin permiso, el módulo no se ve.
 *
 * NOTA: depende de las tablas/RPC 0078-0080 (DISEÑO, aún NO aplicadas).
 */
import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listBankAccounts } from "@/lib/tesoreria/data";
import { getStatementResult, listPendingMatches } from "@/lib/tesoreria/conciliacion/data";
import { ConciliacionUploader } from "@/components/tesoreria/conciliacion/ConciliacionUploader";
import { ConciliacionDashboard } from "@/components/tesoreria/conciliacion/ConciliacionDashboard";
import { AprobacionIsland } from "@/components/tesoreria/conciliacion/AprobacionIsland";

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
    const cuenta = accounts[0]?.id ?? "";
    const statementId = searchParams.s;
    const result = statementId ? await getStatementResult(statementId) : null;
    const pendientes = statementId && canApprove ? await listPendingMatches(statementId) : [];

    return (
      <div className="p-4 lg:p-8 nx-page-fade space-y-6">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Conciliación bancaria</h1>
            <p className="page-subtitle">Subí el extracto, conciliá contra Nexus y aprobá las sugerencias. Cruce duro de saldo (Δ 0,00).</p>
          </div>
        </div>

        <ConciliacionUploader bankAccountId={cuenta} />

        {result && (
          <>
            {canApprove && <AprobacionIsland pendientes={pendientes} />}
            {/* Piloto = Santander; el banco real se persiste en bank_statements.banco (post-migración). */}
            <ConciliacionDashboard banco="santander" metrics={result.metrics} matches={result.matches} movimientos={result.movimientos} />
          </>
        )}
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="Conciliación no disponible" migration="0078_bank_reconciliation_core" detail={e instanceof Error ? e.message : String(e)} />;
  }
}
