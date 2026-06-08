import Link from "next/link";
import { Icon } from "@/components/Icon";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { getProveedorFicha } from "@/lib/legajo/data";

export const metadata = { title: "Ficha de proveedor" };
export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-sm text-fg-primary">{value || <span className="text-fg-muted">—</span>}</div>
    </div>
  );
}

export default async function ProveedorFichaPage({ params }: { params: { id: string } }) {
  const ficha = await getProveedorFicha(params.id);
  if (!ficha) {
    return (
      <div className="p-8">
        <div className="card p-6 max-w-xl">
          <h1 className="text-lg font-bold text-fg-primary mb-2">Proveedor no encontrado</h1>
          <Link href="/compras/proveedores" className="text-fg-link hover:underline">← Volver a Proveedores</Link>
        </div>
      </div>
    );
  }
  const { proveedor: p, ocs, facturas, saldo } = ficha;

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6 nx-page-fade max-w-[1200px] mx-auto">
      <div>
        <Link href="/compras/proveedores" className="text-[11px] text-fg-link hover:underline">← Proveedores</Link>
        <h1 className="page-title mt-1">{p.razon}</h1>
        <p className="page-subtitle">Legajo digital de proveedor · CUIT {p.cuit ?? "—"}{p.categoria ? ` · ${p.categoria}` : ""}</p>
      </div>

      {/* General */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="vendors" size={15} /> General</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Razón social" value={p.razon} />
          <Field label="CUIT" value={p.cuit} />
          <Field label="Categoría" value={p.categoria} />
          <Field label="Domicilio" value={p.domicilio} />
          <Field label="Teléfono" value={p.telefono} />
          <Field label="Email" value={p.email ? <a href={`mailto:${p.email}`} className="text-fg-link hover:underline">{p.email}</a> : null} />
          <Field label="Contacto" value={p.contacto} />
          <Field label="Cond. de pago" value={p.cond_pago} />
          <Field label="Tags" value={(p.tags ?? []).join(" · ")} />
        </div>
      </section>

      {/* Compras (OCs por vendor_id) */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="cart" size={15} /> Compras · Órdenes de compra</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-fg-muted text-[11px] uppercase"><th className="py-1">OC</th><th className="py-1">Fecha</th><th className="py-1">Estado</th><th className="py-1 text-right">Total</th></tr></thead>
            <tbody>
              {ocs.length === 0 && <tr><td colSpan={4} className="py-4 text-fg-muted">Sin órdenes de compra.</td></tr>}
              {ocs.map((o) => (
                <tr key={o.id} className="border-t border-stroke-soft/60">
                  <td className="py-2"><Link href={`/compras/ordenes/${o.public_id}`} className="order-num">{o.public_id}</Link></td>
                  <td className="py-2">{fmtDate(o.created_at)}</td>
                  <td className="py-2">{o.status}</td>
                  <td className="py-2 text-right tabular">{fmtCurrency(o.total ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Finanzas (supplier_invoices + cuenta corriente por vendor_id) */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="wallet" size={15} /> Finanzas</h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Field label="Facturas abiertas" value={saldo?.facturas_abiertas ?? "—"} />
          <Field label="Total facturado" value={saldo ? fmtCurrency(saldo.total_facturado ?? 0) : "—"} />
          <Field label="Próximo vencimiento" value={fmtDate(saldo?.proxima_vencimiento ?? null)} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-fg-muted text-[11px] uppercase"><th className="py-1">Factura</th><th className="py-1">Tipo</th><th className="py-1">Emisión</th><th className="py-1">Vto</th><th className="py-1">Estado</th><th className="py-1 text-right">Total</th></tr></thead>
            <tbody>
              {facturas.length === 0 && <tr><td colSpan={6} className="py-4 text-fg-muted">Sin facturas de proveedor.</td></tr>}
              {facturas.map((f) => (
                <tr key={f.id} className="border-t border-stroke-soft/60">
                  <td className="py-2 tabular">{f.public_id ?? f.numero ?? f.id.slice(0, 8)}</td>
                  <td className="py-2">{f.tipo_comprobante ?? "—"}</td>
                  <td className="py-2">{fmtDate(f.fecha_emision)}</td>
                  <td className="py-2">{fmtDate(f.fecha_vencimiento)}</td>
                  <td className="py-2">{f.status ?? "—"}</td>
                  <td className="py-2 text-right tabular">{fmtCurrency(f.total ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Saldo adeudado — KPI destacado (rojo corporativo, escala Tesorería) */}
        <div className="mt-5 pt-4 border-t border-stroke-soft flex justify-end">
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Saldo adeudado</div>
            <div className="text-3xl md:text-4xl font-black tabular text-tops-red leading-none mt-1">
              {saldo ? fmtCurrency(saldo.saldo_cuenta ?? 0) : "—"}
            </div>
            <div className="text-[11px] text-fg-muted mt-1">Total pendiente de pago al proveedor</div>
          </div>
        </div>
      </section>

      {/* Historial */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="clock" size={15} /> Historial</h2>
        <p className="text-sm text-fg-secondary">Movimientos, compras e interacciones del proveedor se derivan de las OCs y facturas listadas arriba.</p>
        <Link href={`/compras/ordenes?search=${encodeURIComponent(p.razon)}`} className="inline-flex items-center gap-1 text-fg-link hover:underline mt-2 text-sm"><Icon name="arrow-up-right" size={13} /> Ver todas las OC del proveedor</Link>
      </section>
    </div>
  );
}
