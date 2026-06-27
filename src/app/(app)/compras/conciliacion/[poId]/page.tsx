import { notFound } from "next/navigation";
import Link from "next/link";
import { getRecon, startRecon } from "@/lib/recon/data";
import { getPurchaseOrder } from "@/lib/compras/data";
import { getSupplierInvoice } from "@/lib/erp/data";
import { ReconDetail } from "./ReconDetail";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { poId: string } }) {
  return { title: `Conciliación · ${params.poId}` };
}

export default async function ReconDetailPage({
  params,
  searchParams,
}: {
  params: { poId: string };
  searchParams?: { invoice?: string };
}) {
  const po = await getPurchaseOrder(params.poId);
  if (!po) notFound();

  let recon = await getRecon(po.id);

  // Si se pasó ?invoice=<id> y no hay conciliación, iniciarla server-side
  if (!recon && searchParams?.invoice) {
    await startRecon(po.id, searchParams.invoice);
    recon = await getRecon(po.id);
  }

  if (!recon) {
    // No hay conciliación: mostrar selector de factura
    return (
      <div className="p-8 nx-page-fade max-w-xl mx-auto">
        <Link href="/compras/conciliacion" className="btn btn-ghost btn-sm mb-6">
          <Icon name="arrow-left" size={14} /> Volver
        </Link>
        <div className="nx-surface rounded-xl p-8 text-center space-y-4">
          <div className="text-4xl">🔗</div>
          <h2 className="text-lg font-semibold">Iniciar conciliación</h2>
          <p className="text-sm text-fg-muted">
            OC <strong>{po.public_id}</strong> — seleccioná la factura del proveedor para cotejar.
          </p>
          <p className="text-xs text-fg-muted">
            Usá el parámetro <code>?invoice=&lt;supplier_invoice_id&gt;</code> para iniciar automáticamente, o seleccioná desde la lista de Facturas.
          </p>
          <Link href="/compras/facturas" className="btn btn-primary btn-sm">
            <Icon name="file-pdf" size={14} /> Ver facturas
          </Link>
        </div>
      </div>
    );
  }

  // Obtener la factura
  const invoice = await getSupplierInvoice(recon.supplier_invoice_id);
  if (!invoice) notFound();

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/compras/conciliacion" className="btn btn-ghost btn-sm">
          <Icon name="arrow-left" size={14} /> Volver
        </Link>
        <div>
          <div className="eyebrow-tiny">Compras · Conciliación</div>
          <h1 className="page-title">
            {po.public_id} ↔ {invoice.public_id}
          </h1>
        </div>
      </div>

      <ReconDetail po={po} invoice={invoice} recon={recon} poId={po.id} />
    </div>
  );
}
