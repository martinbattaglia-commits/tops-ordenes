import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getCustodyByToken } from "@/lib/custody/custody";
import { STAGE_META, EVENT_TYPE_META } from "@/lib/custody/types";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Custodia · QR" };
export const dynamic = "force-dynamic";

/**
 * Resolución pública de QR de custodia (GATE 5 · FASE 3). El QR codifica /c/{token}
 * (token opaco). get_custody_by_token resuelve la entidad SIN exponer IDs internos
 * ni PII — solo public_id, estado y un timeline resumido (etapa/evento/fecha).
 */
export default async function CustodyTokenPage({ params }: { params: { token: string } }) {
  let result;
  try {
    result = await getCustodyByToken(params.token);
  } catch {
    result = null;
  }

  if (!result) {
    return (
      <div className="p-4 lg:p-8 nx-page-fade max-w-md mx-auto">
        <div className="nx-surface card card-pad text-center">
          <Icon name="qr" size={28} />
          <h1 className="text-lg font-bold mt-2">QR no resuelto</h1>
          <p className="text-sm text-fg-muted mt-1">El token no corresponde a ninguna unidad ni despacho, o no tenés acceso.</p>
        </div>
      </div>
    );
  }

  const scopeLabel = result.scope === "packing_unit" ? "Bulto" : "Despacho";

  return (
    <div className="p-4 lg:p-8 nx-page-fade max-w-lg mx-auto">
      <div className="nx-surface card card-pad text-center mb-4">
        <div className="eyebrow-tiny">Cadena de Custodia</div>
        <div className="text-[11px] uppercase tracking-wide text-fg-muted mt-1">{scopeLabel}</div>
        <h1 className="page-title font-mono">{result.public_id}</h1>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-bg-surface-alt text-fg-secondary">{result.status}</span>
          {result.pod_present && (
            <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded" style={{ background: "#16a34a1a", color: "#16a34a" }}>
              <Icon name="check-circle" size={11} /> POD
            </span>
          )}
        </div>
      </div>

      <div className="nx-surface card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft text-sm font-semibold">Timeline</div>
        <ol className="divide-y divide-stroke-soft">
          {result.events.map((e, i) => {
            const sm = STAGE_META[e.stage];
            return (
              <li key={i} className="px-4 py-2.5 flex items-center gap-3">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: `${sm.color}1a`, color: sm.color }}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{EVENT_TYPE_META[e.event_type].label}</div>
                  <div className="text-[11px] text-fg-muted">{sm.label} · {fmtDateTime(e.occurred_at)}</div>
                </div>
              </li>
            );
          })}
          {result.events.length === 0 && <li className="px-4 py-6 text-center text-fg-muted text-sm">Sin eventos registrados.</li>}
        </ol>
      </div>

      <div className="text-center mt-4">
        <Link href="/wms/custody" className="btn btn-ghost btn-sm"><Icon name="arrow-left" size={12} /> Ir a Custodia</Link>
      </div>
    </div>
  );
}
