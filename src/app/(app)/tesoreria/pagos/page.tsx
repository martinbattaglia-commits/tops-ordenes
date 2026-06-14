import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { PagoForm } from "@/components/tesoreria/PagoForm";
import { CuentaCorrienteSecciones } from "@/components/tesoreria/CuentaCorrienteSecciones";
import { clasificarCuentaCorriente, type CuentaRow } from "@/lib/tesoreria/cuentaCorriente";
import { listSupplierOpenItems, listPagosDetail, listBankAccounts } from "@/lib/tesoreria/data";

export const metadata = { title: "Pagos · Tesorería" };
export const dynamic = "force-dynamic";

export default async function PagosPage() {
  try {
    // Tesorería V3 · Fase 1: mismo motor que Cobranzas (paridad total). El Saldo
    // Neto sale de `detail` (centavos enteros), no de `supplier_current_account`.
    const [openItems, detail, accounts] = await Promise.all([
      listSupplierOpenItems(),
      listPagosDetail(),
      listBankAccounts(),
    ]);

    const rows: CuentaRow[] = detail.map((d) => ({
      invoiceId: d.invoiceId,
      partyId: d.vendorId,
      partyName: d.proveedor,
      factura: d.factura,
      emision: d.emision,
      vencimiento: d.vencimiento,
      estado: d.estado,
      saldo: d.saldo,
      tipoComprobante: d.tipoComprobante,
    }));
    const cc = clasificarCuentaCorriente(rows);

    // vendor_id → nombre comercial para el selector de "Registrar pago"
    // (FIX bug UUID: el <select> muestra el nombre y envía vendor_id).
    const vendorNames: Record<string, string> = {};
    for (const d of detail) {
      if (d.vendorId && d.proveedor) vendorNames[d.vendorId] = d.proveedor;
    }

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Pagos</h1>
            <p className="page-subtitle">Cuenta corriente de proveedores (derivada) y registro de pagos.</p>
          </div>
        </div>

        <div className="mb-6">
          <CuentaCorrienteSecciones cc={cc} kind="pago" />
        </div>

        {/* Registro de pago */}
        <PagoForm accounts={accounts} openItems={openItems} vendorNames={vendorNames} />
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable title="Pagos no disponibles" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />
    );
  }
}
