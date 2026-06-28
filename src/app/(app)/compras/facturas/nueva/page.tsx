import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listVendors, listPurchaseOrders } from "@/lib/compras/data";
import { listCostCenters } from "@/lib/erp/data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { NuevaFacturaForm } from "./NuevaFacturaForm";

export const metadata = { title: "Nueva factura de proveedor" };
export const dynamic = "force-dynamic";

export default async function NuevaFacturaPage() {
  let vendors: Awaited<ReturnType<typeof listVendors>>;
  let costCenters: Awaited<ReturnType<typeof listCostCenters>>;
  let poResult: Awaited<ReturnType<typeof listPurchaseOrders>>;
  try {
    [vendors, costCenters, poResult] = await Promise.all([
      listVendors(),
      listCostCenters(),
      listPurchaseOrders({ pageSize: 500 }),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Carga de factura no disponible"
        migration="0014_supplier_invoices"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const vendorOptions = vendors.map((v) => ({ id: v.id, razon: v.razon, cuit: v.cuit }));
  const ccOptions = costCenters.map((c) => ({ id: c.id, code: c.code, name: c.name }));
  // Sólo OCs aún no conciliadas (sin factura asociada) — son las cotejables.
  const poOptions = poResult.rows
    .filter((po) => !po.supplier_invoice_id)
    .map((po) => ({
      id: po.id,
      public_id: po.public_id,
      status: po.status,
      total: po.total,
      vendor_id: po.vendor_id,
    }));

  return (
    <div className="p-4 lg:p-8 max-w-3xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Cuentas por pagar · ERP</div>
          <h1 className="page-title">Nueva factura de proveedor</h1>
          <p className="page-subtitle">
            Registrá el comprobante recibido del proveedor e imputalo a un centro de costo.
          </p>
        </div>
        <Link href="/compras/facturas" className="btn btn-ghost btn-sm mt-1">
          <Icon name="arrow-left" size={12} /> Volver
        </Link>
      </div>

      <NuevaFacturaForm vendors={vendorOptions} costCenters={ccOptions} purchaseOrders={poOptions} />
    </div>
  );
}
