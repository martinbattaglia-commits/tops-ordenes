import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getSumasYSaldos } from "@/lib/contabilidad/data";
import type { SumasSaldosRow } from "@/lib/contabilidad/types";
import { ACCOUNT_TYPE_LABEL } from "@/lib/erp/types";
import { fmtMoney } from "@/lib/utils";
import { SimulationBanner } from "../_components/SimulationBanner";

export const metadata = { title: "Sumas y Saldos" };
export const dynamic = "force-dynamic";

export default async function SumasYSaldosPage() {
  if (!(await canAccess("contabilidad.view"))) {
    return <AccesoRestringido modulo="Contabilidad · Sumas y Saldos" />;
  }

  let rows: SumasSaldosRow[];
  try {
    rows = await getSumasYSaldos();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Sumas y Saldos no disponible"
        migration="0084_accounting_views"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const tot = rows.reduce(
    (a, r) => ({
      debe: a.debe + (r.total_debe ?? 0),
      haber: a.haber + (r.total_haber ?? 0),
      deudor: a.deudor + (r.saldo_deudor ?? 0),
      acreedor: a.acreedor + (r.saldo_acreedor ?? 0),
    }),
    { debe: 0, haber: 0, deudor: 0, acreedor: 0 },
  );

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Contabilidad · F6</div>
          <h1 className="page-title">Balance de Sumas y Saldos</h1>
          <p className="page-subtitle">
            Comprobación por cuenta imputable, acumulado histórico sobre asientos posteados.
          </p>
        </div>
      </div>

      <SimulationBanner />

      {rows.length === 0 ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="text-sm text-fg-muted">
            Sin datos: el motor contable nunca posteó un asiento (modo SIMULACIÓN,
            comportamiento esperado). Este balance se poblará cuando el posteo real
            sea habilitado por Dirección.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)", textAlign: "left" }}>
                  <th style={{ padding: "10px 12px", width: 100 }}>Código</th>
                  <th style={{ padding: "10px 12px" }}>Cuenta</th>
                  <th style={{ padding: "10px 12px", width: 120 }}>Tipo</th>
                  <th style={{ padding: "10px 12px", width: 120, textAlign: "right" }}>Debe</th>
                  <th style={{ padding: "10px 12px", width: 120, textAlign: "right" }}>Haber</th>
                  <th style={{ padding: "10px 12px", width: 130, textAlign: "right" }}>Saldo deudor</th>
                  <th style={{ padding: "10px 12px", width: 130, textAlign: "right" }}>Saldo acreedor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.account_id} style={{ borderBottom: "1px solid var(--border-soft, #f1f3f5)" }}>
                    <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }} className="text-fg-muted">{r.cuenta_codigo}</td>
                    <td style={{ padding: "8px 12px" }}>{r.cuenta_nombre}</td>
                    <td style={{ padding: "8px 12px" }} className="text-xs text-fg-muted">
                      {ACCOUNT_TYPE_LABEL[r.cuenta_tipo] ?? r.cuenta_tipo}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.total_debe)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.total_haber)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {(r.saldo_deudor ?? 0) > 0 ? fmtMoney(r.saldo_deudor) : ""}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {(r.saldo_acreedor ?? 0) > 0 ? fmtMoney(r.saldo_acreedor) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border, #e5e7eb)", fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: "10px 12px" }}>Totales</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(tot.debe)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(tot.haber)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(tot.deudor)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(tot.acreedor)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
