import Link from "next/link";
import { listVendors } from "@/lib/compras/data";
import { fmtCurrency, fmtCuit, fmtDate, truncate } from "@/lib/compras/format";
import { NuevoProveedorButton } from "@/components/compras/NuevoProveedorButton";

export const metadata = { title: "Compras · Proveedores" };
export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const vendors = await listVendors();
  const totalYtd = vendors.reduce((a, v) => a + (v.ytd_spend ?? 0), 0);

  return (
    <div className="p-4 md:p-7 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Maestro · {vendors.length} proveedores</div>
          <h1 className="page-title">Proveedores</h1>
          <p className="page-subtitle">
            Compras YTD: <span className="font-bold tabular text-fg-brand">{fmtCurrency(totalYtd)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <NuevoProveedorButton />
        </div>
      </div>

      <div className="nx-surface card overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Categoría</th>
                <th>Contacto</th>
                <th>Cond. pago</th>
                <th className="text-right">OC histórico</th>
                <th className="text-right">Comprado YTD</th>
                <th>Última OC</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-tops-blue-700 text-white grid place-items-center font-bold flex-shrink-0">
                        {v.avatar ?? v.razon.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/compras/proveedores/${v.id}`} className="font-bold text-fg-link hover:underline cursor-pointer text-sm truncate block" title="Abrir ficha del proveedor">{v.razon}</Link>
                        <div className="text-[11px] text-fg-muted font-mono">{fmtCuit(v.cuit)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-xs text-fg-secondary">{v.categoria ?? "—"}</td>
                  <td className="text-xs">
                    <div className="font-semibold text-fg-primary">{v.contacto ?? "—"}</div>
                    <div className="text-fg-muted text-[11px]">{v.telefono ?? ""}</div>
                  </td>
                  <td className="text-xs text-fg-secondary">{v.cond_pago}</td>
                  <td className="text-right tabular text-sm">{v.oc_count ?? 0}</td>
                  <td className="text-right tabular font-bold text-fg-brand">
                    {fmtCurrency(v.ytd_spend ?? 0)}
                  </td>
                  <td className="text-xs text-fg-secondary">{fmtDate(v.last_oc_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-stroke-soft">
          {vendors.map((v) => (
            <div key={v.id} className="p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-tops-blue-700 text-white grid place-items-center font-bold flex-shrink-0">
                {v.avatar ?? v.razon.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <Link href={`/compras/proveedores/${v.id}`} className="font-bold text-fg-link hover:underline cursor-pointer truncate block">{truncate(v.razon, 30)}</Link>
                <div className="text-[11px] text-fg-muted font-mono mb-1">{fmtCuit(v.cuit)}</div>
                <div className="text-xs text-fg-secondary">{v.contacto}</div>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="text-fg-muted">{v.oc_count ?? 0} OC · {v.cond_pago}</span>
                  <span className="font-bold tabular text-fg-brand">
                    {fmtCurrency(v.ytd_spend ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
