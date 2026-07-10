import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getConciliacionIva } from "@/lib/contabilidad/data";
import type { ConciliacionIvaRow } from "@/lib/contabilidad/types";
import { fmtMoney } from "@/lib/utils";
import { SimulationBanner } from "../_components/SimulationBanner";

export const metadata = { title: "Conciliación IVA" };
export const dynamic = "force-dynamic";

export default async function ConciliacionIvaPage() {
  if (!(await canAccess("contabilidad.view"))) {
    return <AccesoRestringido modulo="Contabilidad · Conciliación IVA" />;
  }

  let rows: ConciliacionIvaRow[];
  try {
    rows = await getConciliacionIva();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Conciliación IVA no disponible"
        migration="0084_accounting_views"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Contabilidad · F6</div>
          <h1 className="page-title">Conciliación IVA fiscal ↔ contable</h1>
          <p className="page-subtitle">
            Libros fiscales de IVA (ventas y compras) contra las cuentas contables
            de IVA Débito (2.1.02) y Crédito (1.1.05), período por período.
          </p>
        </div>
      </div>

      <SimulationBanner />

      <div className="card mb-4" style={{ padding: "12px 16px" }}>
        <p className="text-xs text-fg-muted">
          Mientras el motor no postee (SIMULACIÓN), el lado contable es $ 0,00 y la
          diferencia refleja el libro fiscal completo — es el comportamiento esperado,
          no un error. La conciliación cobra sentido operativo al habilitarse el posteo real.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="text-sm text-fg-muted">Sin períodos con datos fiscales o contables de IVA.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 820 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)", textAlign: "left" }}>
                  <th style={{ padding: "10px 12px", width: 100 }}>Período</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Débito fiscal</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Débito contable</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Dif. débito</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Crédito fiscal</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Crédito contable</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Dif. crédito</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.periodo} style={{ borderBottom: "1px solid var(--border-soft, #f1f3f5)" }}>
                    <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{r.periodo}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.iva_debito_fiscal)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.iva_debito_contable)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <Dif value={r.dif_debito} />
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.iva_credito_fiscal)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.iva_credito_contable)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <Dif value={r.dif_credito} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Dif({ value }: { value: number }) {
  const cuadra = Math.abs(value ?? 0) < 0.005;
  return (
    <span style={{ color: cuadra ? "var(--status-success-400, #15803d)" : "var(--status-warning-400, #b45309)", fontWeight: 600 }}>
      {fmtMoney(value)}
    </span>
  );
}
