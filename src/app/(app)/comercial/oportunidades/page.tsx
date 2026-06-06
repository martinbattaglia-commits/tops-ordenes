import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listOpportunities } from "@/lib/comercial/opportunities-data";
import { STAGE_LABEL, STAGE_COLOR, SERVICE_LABEL } from "@/lib/comercial/crm-types";

export const metadata = { title: "Oportunidades · Comercial" };
export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("es-AR");

/**
 * Lista de oportunidades — punto de entrada a la Ficha 360°.
 * F2.1-7: fuente Supabase real (crm_opportunities) con fallback a muestra local.
 */
export default async function OportunidadesPage() {
  const { items: opps, source } = await listOpportunities();

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Comercial · CRM</div>
          <h1 className="page-title">Oportunidades</h1>
          <p className="page-subtitle">
            Pipeline comercial · {opps.length} oportunidades · fuente:{" "}
            <span className="font-semibold">{source === "supabase" ? "Supabase (crm_opportunities)" : "muestra local (sin tabla)"}</span>
          </p>
        </div>
      </div>

      <div className="nx-surface card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-fg-muted text-[11px] uppercase tracking-wide border-b border-stroke-soft">
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Servicio</th>
              <th className="px-3 py-2 text-right">m²</th>
              <th className="px-3 py-2">Etapa</th>
              <th className="px-3 py-2 text-right">Prob.</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2">Capacidad</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {opps.map((o) => (
              <tr key={o.id} className="border-b border-stroke-soft/60 hover:bg-bg-surface-alt transition-colors">
                <td className="px-3 py-2 font-mono text-xs font-bold text-fg-brand">{o.publicId}</td>
                <td className="px-3 py-2 font-semibold text-fg-primary">{o.empresa}</td>
                <td className="px-3 py-2">{SERVICE_LABEL[o.serviceType]}</td>
                <td className="px-3 py-2 text-right tabular">{o.m2 != null ? fmt(o.m2) : "—"}</td>
                <td className="px-3 py-2">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: `${STAGE_COLOR[o.estado]}1a`, color: STAGE_COLOR[o.estado] }}>
                    {STAGE_LABEL[o.estado]}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular">{o.probabilidad}%</td>
                <td className="px-3 py-2 text-right tabular">{o.monto != null ? `$${fmt(o.monto)}` : "—"}</td>
                <td className="px-3 py-2">
                  {o.capacityFeasible == null ? (
                    <span className="text-fg-muted text-xs">—</span>
                  ) : o.capacityFeasible ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#16a34a" }}>
                      <Icon name="check-circle" size={12} /> Entra
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#dc2626" }}>
                      <Icon name="x" size={12} /> No entra
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/comercial/oportunidades/${o.id}`} className="btn btn-ghost btn-sm">
                    Ficha 360° <Icon name="chevron-right" size={12} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
