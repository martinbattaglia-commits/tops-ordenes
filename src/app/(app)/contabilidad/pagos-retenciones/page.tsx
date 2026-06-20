import type { NextRequest } from "next/server";
import { checkPermission } from "@/lib/rbac/check";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getVendores, getBankAccountsSimple, getSupplierOpenItems } from "@/lib/contabilidad/data";
import { PagoRetencionForm } from "./PagoRetencionForm";

export const metadata = { title: "Pago con retención" };
export const dynamic = "force-dynamic";

export default async function PagosRetencionesPage() {
  let vendors, banks, openItems;
  try {
    [vendors, banks, openItems] = await Promise.all([
      getVendores(),
      getBankAccountsSimple(),
      getSupplierOpenItems(),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Pago con retención no disponible"
        migration="0090_treasury_withholdings_native"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const perm = await checkPermission(undefined as unknown as NextRequest, "tesoreria.create");

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Pago a proveedor con retención</h1>
        <p className="text-sm text-fg-secondary">
          Imputa el <strong>bruto</strong> contra las facturas (cancela la cuenta corriente por el
          bruto), egresa el <strong>neto</strong> por banco/caja y registra las retenciones como
          deuda fiscal. El asiento se genera luego desde “Pendientes de contabilizar”.
        </p>
      </header>

      <PagoRetencionForm vendors={vendors} banks={banks} openItems={openItems} canWrite={perm.ok} />
    </div>
  );
}
