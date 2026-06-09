import { env } from "@/lib/env";
import { Icon } from "@/components/Icon";
import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";

export const metadata = { title: "Plantillas de email" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  if (!(await canAccess("sistema.view"))) return <AccesoRestringido modulo="Sistema · Plantillas OS" />;
  return (
    <div className="p-4 lg:p-8 max-w-4xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Sistema · Email</div>
          <h1 className="page-title">Plantillas de email</h1>
          <p className="page-subtitle">
            Vista previa del comprobante que recibe el cliente al firmar una orden.
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        {/* Chrome del cliente de mail */}
        <div className="bg-neutral-100 border-b border-stroke-soft px-4 py-3 flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-400" />
            <span className="w-3 h-3 rounded-full bg-yellow-400" />
            <span className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="ml-4 text-xs text-fg-muted">
            De: {env.email.from} · Para: cliente@ejemplo.com
          </div>
        </div>
        {/* Body */}
        <div className="p-4 bg-neutral-50">
          <div className="max-w-xl mx-auto">
            <div className="bg-tops-blue-900 text-white p-5 rounded-t-lg">
              <div className="text-[11px] uppercase tracking-[0.14em] font-bold text-white/70">
                Comprobante de servicio
              </div>
              <div className="text-2xl font-bold mt-1">OS-201567</div>
              <div className="text-sm text-white/85 mt-0.5">Magaldi · CABA</div>
            </div>
            <div className="bg-white border border-t-0 border-stroke-soft p-5 rounded-b-lg">
              <p className="text-sm leading-relaxed mb-4">
                Estimado/a, le adjuntamos el comprobante de la orden de servicio
                <strong> OS-201567</strong> realizada para <strong>Bidcom S.A.</strong>
              </p>
              <table className="w-full text-sm mb-4">
                <tbody>
                  <tr>
                    <td className="py-2 text-fg-secondary">Fecha</td>
                    <td className="py-2 text-right font-semibold">25/05/2026</td>
                  </tr>
                  <tr className="border-t border-stroke-soft">
                    <td className="py-2 text-fg-secondary">Depósito</td>
                    <td className="py-2 text-right font-semibold">Magaldi · CABA</td>
                  </tr>
                  <tr className="border-t border-stroke-soft">
                    <td className="py-2 text-fg-secondary">Total estimado</td>
                    <td className="py-2 text-right font-bold text-fg-brand">$ 50.000 + IVA</td>
                  </tr>
                </tbody>
              </table>
              <div className="text-center mb-4">
                <button className="btn btn-danger">
                  <Icon name="arrow-right" size={14} /> Ver comprobante online
                </button>
              </div>
              <div className="pt-4 border-t border-stroke-soft text-xs text-fg-muted leading-relaxed">
                Logística TOPS — Verotin S.A. · IVA Responsable Inscripto
                <br />
                Agustín Magaldi 1765 — CABA · Tel/Fax: 4302-3944
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
