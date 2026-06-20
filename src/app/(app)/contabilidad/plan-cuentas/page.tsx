import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getPlanCuentas } from "@/lib/contabilidad/data";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/contabilidad/types";

export const metadata = { title: "Plan de cuentas" };
export const dynamic = "force-dynamic";

const TYPE_BADGE: Record<AccountType, string> = {
  activo: "bg-blue-100 text-blue-800",
  pasivo: "bg-amber-100 text-amber-800",
  patrimonio_neto: "bg-purple-100 text-purple-800",
  ingreso: "bg-green-100 text-green-800",
  gasto: "bg-red-100 text-red-800",
  orden: "bg-neutral-100 text-neutral-700",
};

export default async function PlanCuentasPage() {
  let rows;
  try {
    rows = await getPlanCuentas();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Plan de cuentas no disponible"
        migration="0084_accounting_seed"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Plan de cuentas</h1>
        <p className="text-sm text-fg-secondary">
          {rows.length} cuentas · {rows.filter((r) => r.isPostable).length} imputables. Estructura
          jerárquica gestionable desde la base (las cuentas de sistema están protegidas).
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="card p-8 text-sm text-fg-secondary">Sin cuentas cargadas.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Código</th>
                <th className="p-3">Cuenta</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Subtipo</th>
                <th className="p-3 text-center">Imputable</th>
                <th className="p-3 text-center">Activa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const depth = (r.code.match(/\./g) ?? []).length;
                return (
                  <tr key={r.id} className="border-b border-border-subtle/50">
                    <td className="p-3 font-mono text-xs text-fg-secondary">{r.code}</td>
                    <td className="p-3">
                      <span
                        style={{ paddingLeft: `${depth * 14}px` }}
                        className={depth === 0 ? "font-bold text-fg-brand" : "text-fg-primary"}
                      >
                        {r.name}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${TYPE_BADGE[r.type]}`}>
                        {ACCOUNT_TYPE_LABEL[r.type]}
                      </span>
                    </td>
                    <td className="p-3 text-fg-muted">{r.subtype ?? "—"}</td>
                    <td className="p-3 text-center">{r.isPostable ? "✓" : ""}</td>
                    <td className="p-3 text-center">{r.isActive ? "✓" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
