import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getComprobantesSinAsiento } from "@/lib/contabilidad/data";
import { SOURCE_TYPE_LABEL, type ComprobanteSinAsiento } from "@/lib/contabilidad/types";
import { fmtMoney } from "@/lib/utils";
import { SimulationBanner } from "../_components/SimulationBanner";
import { ComprobantesTable } from "./ComprobantesTable";

export const metadata = { title: "Comprobantes sin asiento" };
export const dynamic = "force-dynamic";

export default async function ComprobantesSinAsientoPage() {
  if (!(await canAccess("contabilidad.view"))) {
    return <AccesoRestringido modulo="Contabilidad · Comprobantes sin asiento" />;
  }

  // Simular exige contabilidad.create (el motor lo re-valida vía acc_require_post_permission).
  const canSimulate = await canAccess("contabilidad.create");

  let rows: ComprobanteSinAsiento[];
  try {
    rows = await getComprobantesSinAsiento();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Comprobantes sin asiento no disponible"
        migration="0084_accounting_views"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const totalImporte = rows.reduce((s, r) => s + (r.importe ?? 0), 0);
  const porTipo = new Map<string, number>();
  for (const r of rows) porTipo.set(r.source_type, (porTipo.get(r.source_type) ?? 0) + 1);

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Contabilidad · F6</div>
          <h1 className="page-title">Comprobantes sin asiento</h1>
          <p className="page-subtitle">
            Backlog contabilizable: comprobantes firmes que el motor asentaría al
            habilitarse el posteo real. {rows.length} comprobantes
            {rows.length > 0 && <> · {fmtMoney(totalImporte)} en total</>}.
          </p>
        </div>
      </div>

      <SimulationBanner />

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {[...porTipo.entries()].map(([t, n]) => (
            <span key={t} className="card text-xs" style={{ padding: "6px 10px" }}>
              {SOURCE_TYPE_LABEL[t] ?? t}: <strong>{n}</strong>
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="text-sm text-fg-muted">No hay comprobantes pendientes de contabilizar.</p>
        </div>
      ) : (
        <>
          {canSimulate && (
            <p className="text-xs text-fg-muted mb-2">
              <strong>Simular</strong> muestra el asiento que el motor generaría para cada
              comprobante, en dry-run: nada se registra en el libro.
            </p>
          )}
          <ComprobantesTable rows={rows} canSimulate={canSimulate} />
        </>
      )}
    </div>
  );
}
