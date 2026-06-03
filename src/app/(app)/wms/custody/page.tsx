import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listRecentCustodyEvents, listRecentPods } from "@/lib/custody/custody";
import { STAGE_META, EVENT_TYPE_META, type CustodyEventRow, type DeliveryPodRow } from "@/lib/custody/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDateTime } from "@/lib/utils";
import { TokenSearch } from "./_components/TokenSearch";

export const metadata = { title: "Cadena de Custodia · WMS" };
export const dynamic = "force-dynamic";

function s(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export default async function CustodyDashboard({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  let events: CustodyEventRow[];
  let pods: DeliveryPodRow[];
  try {
    [events, pods] = await Promise.all([listRecentCustodyEvents(80), listRecentPods(40)]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Cadena de Custodia no disponible"
        migration="0036_custody_core … 0039_custody_pod_reads"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const fStage = s(searchParams.stage);
  const rows = events.filter((e) => !fStage || e.stage === fStage);

  const totalEvents = events.length;
  const withEvidence = events.filter((e) => e.has_evidence).length;
  const totalPods = pods.length;
  const signedPods = pods.filter((p) => p.has_signature).length;

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Depósito</div>
          <h1 className="page-title">Cadena de Custodia</h1>
          <p className="page-subtitle">
            Evidencia, timeline, POD y QR por unidad/despacho. Trazabilidad probatoria con hash-chain inmutable.
          </p>
        </div>
        <div className="mt-1"><TokenSearch /></div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Eventos recientes" value={totalEvents} sub="cadena de custodia" index={0} />
        <Stat label="Con evidencia" value={withEvidence} sub="fotos/firmas/docs" index={1} />
        <Stat label="PODs" value={totalPods} sub="comprobantes de entrega" index={2} />
        <Stat label="PODs firmados" value={signedPods} sub="con firma del receptor" index={3} />
      </div>

      {/* Filtro por etapa */}
      <form method="get" className="flex flex-wrap items-end gap-2 mb-4">
        <label className="flex flex-col gap-1">
          <span className="kpi-label">Etapa</span>
          <select name="stage" defaultValue={fStage} className="input">
            <option value="">Todas</option>
            {Object.entries(STAGE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary btn-sm"><Icon name="filter" size={12} /> Filtrar</button>
        {fStage && <Link href="/wms/custody" className="btn btn-ghost btn-sm"><Icon name="x" size={12} /> Limpiar</Link>}
      </form>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Eventos recientes */}
        <div className="nx-surface card overflow-hidden">
          <div className="px-4 py-3 border-b border-stroke-soft text-sm font-semibold">Eventos recientes</div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>N°</th><th>Etapa</th><th>Evento</th><th>Ámbito</th><th>Fecha</th></tr></thead>
              <tbody>
                {rows.map((e) => {
                  const sm = STAGE_META[e.stage];
                  return (
                    <tr key={e.id}>
                      <td className="font-mono text-[11px]">{e.public_id}{e.has_evidence && <Icon name="paperclip" size={10} />}</td>
                      <td><span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: `${sm.color}1a`, color: sm.color }}>{sm.label}</span></td>
                      <td className="text-xs">{EVENT_TYPE_META[e.event_type].label}</td>
                      <td className="text-[11px] text-fg-muted">{e.scope === "shipment" ? "Despacho" : "Bulto"}</td>
                      <td className="text-[11px]">{fmtDateTime(e.occurred_at)}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={5} className="text-center text-fg-muted py-8 text-sm">Sin eventos.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* PODs recientes */}
        <div className="nx-surface card overflow-hidden">
          <div className="px-4 py-3 border-b border-stroke-soft text-sm font-semibold">PODs recientes</div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>POD</th><th>Despacho</th><th>Receptor</th><th>Fecha</th><th></th></tr></thead>
              <tbody>
                {pods.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-[11px] font-semibold">{p.public_id}</td>
                    <td className="font-mono text-[11px]">{p.shipment_public_id ?? "—"}</td>
                    <td className="text-xs">{p.receiver_name}{p.has_signature && <Icon name="pen" size={10} />}</td>
                    <td className="text-[11px]">{p.signed_at ? fmtDateTime(p.signed_at) : "—"}</td>
                    <td className="text-right"><Link href={`/wms/custody/pod/${p.shipment_id}`} className="btn btn-ghost btn-sm"><Icon name="eye" size={11} /> POD</Link></td>
                  </tr>
                ))}
                {pods.length === 0 && <tr><td colSpan={5} className="text-center text-fg-muted py-8 text-sm">Sin PODs.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, index }: { label: string; value: number; sub: string; index: number }) {
  return (
    <div style={{ animationDelay: `${index * 45}ms` }} className="nx-surface nx-stagger card p-5">
      <div className="kpi-label">{label}</div>
      <div className="text-2xl font-bold tabular leading-none mt-1 text-fg-brand">{value}</div>
      <div className="text-[11px] text-fg-muted mt-1">{sub}</div>
    </div>
  );
}
