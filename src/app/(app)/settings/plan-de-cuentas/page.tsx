import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listChartOfAccounts } from "@/lib/erp/accounting-data";
import { ACCOUNT_TYPE_LABEL, type AccountType, type ChartAccount } from "@/lib/erp/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { canAccess } from "@/lib/rbac/guard";

export const metadata = { title: "Plan de cuentas" };
export const dynamic = "force-dynamic";

const TYPE_ORDER: AccountType[] = [
  "activo",
  "pasivo",
  "patrimonio_neto",
  "ingreso",
  "gasto",
  "orden",
];

/** Profundidad jerárquica derivada del código ('6.1.10' → 2). */
function depth(code: string): number {
  return Math.max(0, code.split(".").length - 1);
}

export default async function PlanDeCuentasPage() {
  if (!(await canAccess("contabilidad.view")) && !(await canAccess("sistema.view"))) {
    return <AccesoRestringido modulo="Contabilidad · Plan de cuentas" />;
  }

  let accounts: ChartAccount[];
  try {
    accounts = await listChartOfAccounts({ activeOnly: false });
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Plan de cuentas no disponible"
        migration="0120_chart_of_accounts_baseline"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const byType = TYPE_ORDER.map((t) => ({
    type: t,
    rows: accounts.filter((a) => a.type === t),
  })).filter((g) => g.rows.length > 0);

  const totalImputables = accounts.filter((a) => a.is_postable).length;

  return (
    <div className="p-4 lg:p-8 max-w-4xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Contabilidad · ERP</div>
          <h1 className="page-title">Plan de cuentas</h1>
          <p className="page-subtitle">
            Catálogo contable único de TOPS Nexus. Base para la clasificación de
            gastos, la imputación de legajos (clientes y proveedores), facturas,
            reportes y balance. {accounts.length} cuentas · {totalImputables} imputables.
          </p>
        </div>
        <Link href="/settings/centros-costo" className="btn btn-ghost btn-sm mt-1">
          <Icon name="tag-alt" size={12} /> Centros de costo
        </Link>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)", textAlign: "left" }}>
              <th style={{ padding: "10px 12px", width: 110 }}>Código</th>
              <th style={{ padding: "10px 12px" }}>Cuenta</th>
              <th style={{ padding: "10px 12px", width: 120 }}>Imputable</th>
              <th style={{ padding: "10px 12px", width: 130 }}>Origen</th>
            </tr>
          </thead>
          <tbody>
            {byType.map((g) => (
              <Group key={g.type} type={g.type} rows={g.rows} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs mt-3" style={{ color: "var(--muted, #6b7280)" }}>
        Las cuentas marcadas como <strong>Sistema</strong> son estructurales y no se
        eliminan. Las cuentas de gasto gestionables (ej. Telefonía, Combustible,
        Viáticos) fueron definidas con la Contadora y pueden ampliarse en migraciones futuras.
      </p>
    </div>
  );
}

function Group({ type, rows }: { type: AccountType; rows: ChartAccount[] }) {
  return (
    <>
      <tr style={{ background: "var(--surface-2, #f9fafb)" }}>
        <td colSpan={4} style={{ padding: "8px 12px", fontWeight: 600, fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: "#214576" }}>
          {ACCOUNT_TYPE_LABEL[type]}
        </td>
      </tr>
      {rows.map((a) => (
        <tr
          key={a.id}
          style={{
            borderBottom: "1px solid var(--border-soft, #f1f3f5)",
            opacity: a.is_active ? 1 : 0.5,
          }}
        >
          <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>
            {a.code}
          </td>
          <td style={{ padding: "8px 12px", paddingLeft: 12 + depth(a.code) * 16, fontWeight: a.is_postable ? 400 : 600 }}>
            {a.name}
            {!a.is_active && <span className="text-xs ml-2" style={{ color: "#b91c1c" }}>(inactiva)</span>}
          </td>
          <td style={{ padding: "8px 12px" }}>
            {a.is_postable ? (
              <span style={{ color: "#15803D", fontSize: 12 }}>Sí</span>
            ) : (
              <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>
            )}
          </td>
          <td style={{ padding: "8px 12px", fontSize: 12, color: a.is_system ? "#8A94A6" : "#3a6db0" }}>
            {a.is_system ? "Sistema" : "Gestionable"}
          </td>
        </tr>
      ))}
    </>
  );
}
