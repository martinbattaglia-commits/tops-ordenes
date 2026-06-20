import type { NextRequest } from "next/server";
import { checkPermission } from "@/lib/rbac/check";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import {
  getOrdenesFacturables,
  getOrdenesFacturadas,
  getCustomerInvoicesParaPercepciones,
} from "@/lib/contabilidad/data";
import { OrdenesFacturarView } from "./OrdenesFacturarView";

export const metadata = { title: "Órdenes a facturar" };
export const dynamic = "force-dynamic";

export default async function OrdenesFacturarPage() {
  let facturables, facturadas, invoices;
  try {
    [facturables, facturadas, invoices] = await Promise.all([
      getOrdenesFacturables(),
      getOrdenesFacturadas(),
      getCustomerInvoicesParaPercepciones(),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Órdenes a facturar no disponibles"
        migration="0093_logistics_billing"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const perm = await checkPermission(undefined as unknown as NextRequest, "pedidos.edit");

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Órdenes logísticas a facturar</h1>
        <p className="text-sm text-fg-secondary">
          Trazabilidad orden → factura. Marcá órdenes como no facturables o vinculalas a una factura
          de venta ya emitida (sin duplicar). La emisión y contabilización usan el flujo de ventas existente.
        </p>
      </header>

      <OrdenesFacturarView
        facturables={facturables}
        facturadas={facturadas}
        invoices={invoices}
        canWrite={perm.ok}
      />
    </div>
  );
}
