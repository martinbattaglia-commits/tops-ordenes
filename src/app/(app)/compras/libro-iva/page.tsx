import type { NextRequest } from "next/server";
import { listVendors } from "@/lib/compras/data";
import { listCostCenters } from "@/lib/erp/data";
import { getLibroIvaCompras, type LibroIvaFilters } from "@/lib/erp/libro-iva-data";
import { checkPermission } from "@/lib/rbac/check";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { LibroIvaView } from "./LibroIvaView";

export const metadata = { title: "Libro IVA Compras" };
export const dynamic = "force-dynamic";

function firstOfMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function LibroIvaPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const sp = searchParams ?? {};
  const pick = (k: string): string | null => {
    const v = sp[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };

  const filters: LibroIvaFilters = {
    desde: pick("desde") ?? firstOfMonth(),
    hasta: pick("hasta") ?? todayStr(),
    vendorId: pick("vendorId"),
    cuit: pick("cuit"),
    alicuota: pick("alicuota") ? Number(pick("alicuota")) : null,
    costCenterId: pick("costCenterId"),
  };

  // Permiso de exportación (para mostrar/ocultar botones). checkPermission ignora
  // el request (parámetro _req sin uso), por eso es seguro reusarlo en la página.
  const canExportCheck = await checkPermission(undefined as unknown as NextRequest, "cuentas_pagar.export");
  const canExport = canExportCheck.ok;

  let data, vendors, costCenters;
  try {
    [data, vendors, costCenters] = await Promise.all([
      getLibroIvaCompras(filters),
      listVendors(),
      listCostCenters(),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Libro IVA Compras no disponible"
        migration="0059_iva_compras_views"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8">
      <LibroIvaView
        data={data}
        filters={filters}
        canExport={canExport}
        vendors={vendors.map((v) => ({ id: v.id, razon: v.razon, cuit: v.cuit }))}
        costCenters={costCenters.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
      />
    </div>
  );
}
