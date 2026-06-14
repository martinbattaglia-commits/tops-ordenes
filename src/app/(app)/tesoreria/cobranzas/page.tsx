import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { CobranzaForm } from "@/components/tesoreria/CobranzaForm";
import { CuentaCorrienteSecciones } from "@/components/tesoreria/CuentaCorrienteSecciones";
import { clasificarCuentaCorriente, type CuentaRow } from "@/lib/tesoreria/cuentaCorriente";
import { listCustomerOpenItems, listCobranzasDetail, listBankAccounts } from "@/lib/tesoreria/data";

export const metadata = { title: "Cobranzas · Tesorería" };
export const dynamic = "force-dynamic";

export default async function CobranzasPage() {
  try {
    // Tesorería V3 · Fase 1: el Total General sale del MISMO dataset (`detail`)
    // vía el motor de cuenta corriente (centavos enteros), NO de `current_account`.
    const [openItems, detail, accounts] = await Promise.all([
      listCustomerOpenItems(),
      listCobranzasDetail(),
      listBankAccounts(),
    ]);

    const rows: CuentaRow[] = detail.map((d) => ({
      invoiceId: d.invoiceId,
      partyId: d.clientId,
      partyName: d.cliente,
      factura: d.factura,
      emision: d.emision,
      vencimiento: d.vencimiento,
      estado: d.estado,
      saldo: d.saldo,
      tipoComprobante: d.tipoComprobante,
    }));
    const cc = clasificarCuentaCorriente(rows);

    // client_id → nombre comercial para el selector de "Registrar cobranza"
    // (mismo origen que los open items; el <select> envía client_id).
    const clientNames: Record<string, string> = {};
    for (const d of detail) {
      if (d.clientId && d.cliente) clientNames[d.clientId] = d.cliente;
    }

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Cobranzas</h1>
            <p className="page-subtitle">Cuenta corriente de clientes (derivada) y registro de cobros.</p>
          </div>
        </div>

        <div className="mb-6">
          <CuentaCorrienteSecciones cc={cc} kind="cobranza" />
        </div>

        {/* Registro de cobro */}
        <CobranzaForm accounts={accounts} openItems={openItems} clientNames={clientNames} />
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable title="Cobranzas no disponibles" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />
    );
  }
}
