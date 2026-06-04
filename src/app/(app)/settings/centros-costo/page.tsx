import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listCostCenters } from "@/lib/erp/data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { RestrictedAccess } from "@/components/shell/RestrictedAccess";
import { isCurrentUserAdmin } from "@/lib/auth/roles";
import { CentrosCostoManager } from "./CentrosCostoManager";

export const metadata = { title: "Centros de costo" };
export const dynamic = "force-dynamic";

export default async function CentrosCostoPage() {
  // Gate 5.5: administración de centros de costo solo para admin (F-05).
  if (!(await isCurrentUserAdmin())) {
    return <RestrictedAccess message="Solo los administradores pueden gestionar centros de costo." />;
  }

  let costCenters: Awaited<ReturnType<typeof listCostCenters>>;
  try {
    costCenters = await listCostCenters({ includeInactive: true });
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Centros de costo no disponibles"
        migration="0014_supplier_invoices"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-4xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Cuentas por pagar · ERP</div>
          <h1 className="page-title">Centros de costo</h1>
          <p className="page-subtitle">
            Imputá las facturas de proveedores a centros de costo para analizar el
            gasto por área. Base del módulo de cuentas por pagar.
          </p>
        </div>
        <Link href="/compras/facturas" className="btn btn-ghost btn-sm mt-1">
          <Icon name="arrow-left" size={12} /> Facturas
        </Link>
      </div>

      <CentrosCostoManager costCenters={costCenters} />
    </div>
  );
}
