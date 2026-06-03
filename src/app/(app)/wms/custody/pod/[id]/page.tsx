import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getDeliveryPodByShipment, getCustodyTimeline } from "@/lib/custody/custody";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDateTime } from "@/lib/utils";
import type { CustodyEvidenceRef, CustodyTimelineEvent } from "@/lib/custody/types";
import { EvidenceViewer } from "../../_components/EvidenceViewer";
import { PrintButton } from "../../_components/PrintButton";

export const metadata = { title: "POD · Custodia" };
export const dynamic = "force-dynamic";

/**
 * POD Surface (GATE 5 · FASE 8). Muestra receptor, fecha, firma, evidencias y
 * shipment. Genera PDF vía print-to-PDF del navegador (sin nueva arquitectura
 * server-side). El binario de la firma se accede por signed URL auditado.
 */
export default async function PodSurfacePage({ params }: { params: { id: string } }) {
  // params.id = shipment_id
  let pod, timeline;
  try {
    [pod, timeline] = await Promise.all([
      getDeliveryPodByShipment(params.id),
      getCustodyTimeline(null, params.id),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable title="POD no disponible" migration="0036…0039 custody" detail={e instanceof Error ? e.message : String(e)} />
    );
  }

  if (!pod) {
    return (
      <div className="p-4 lg:p-8 nx-page-fade max-w-md mx-auto">
        <div className="nx-surface card card-pad text-center">
          <Icon name="file-pdf" size={26} />
          <h1 className="text-lg font-bold mt-2">Sin POD</h1>
          <p className="text-sm text-fg-muted mt-1">Este despacho aún no tiene un Proof Of Delivery generado.</p>
          <Link href="/wms/custody" className="btn btn-ghost btn-sm mt-3"><Icon name="arrow-left" size={12} /> Volver a Custodia</Link>
        </div>
      </div>
    );
  }

  // Evidencias del timeline (fotos/firma) para adjuntar al POD.
  const evidences: CustodyEvidenceRef[] = timeline.nodes
    .filter((n): n is CustodyTimelineEvent => n.type === "event")
    .flatMap((n) => n.evidences);
  const signatureRef = pod.signature_evidence_id
    ? evidences.find((e) => e.evidence_id === pod.signature_evidence_id) ??
      ({ evidence_id: pod.signature_evidence_id, kind: "firma", bucket: "custody-pii", sha256: "", redacted: false } as CustodyEvidenceRef)
    : null;

  return (
    <div className="p-4 lg:p-8 nx-page-fade max-w-2xl mx-auto">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Custodia</div>
          <h1 className="page-title flex items-center gap-3 font-mono">
            {pod.public_id}
            <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded" style={{ background: "#16a34a1a", color: "#16a34a" }}>POD</span>
          </h1>
          <p className="page-subtitle">Despacho {pod.shipment_public_id ?? pod.shipment_id}</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <PrintButton />
          <Link href="/wms/custody" className="btn btn-ghost btn-sm"><Icon name="arrow-left" size={12} /> Volver</Link>
        </div>
      </div>

      <div className="nx-surface card card-pad mb-4 grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div><span className="kpi-label">Receptor</span> {pod.receiver_name}</div>
        <div><span className="kpi-label">Documento</span> {pod.receiver_document ?? "—"}</div>
        <div><span className="kpi-label">Firmado</span> {pod.signed_at ? fmtDateTime(pod.signed_at) : "—"}</div>
        <div><span className="kpi-label">Despacho</span> {pod.shipment_public_id ?? "—"}</div>
        {pod.observations && <div className="sm:col-span-2"><span className="kpi-label">Observaciones</span> {pod.observations}</div>}
      </div>

      {/* Firma */}
      <div className="nx-surface card card-pad mb-4">
        <div className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Icon name="pen" size={13} /> Firma del receptor</div>
        {signatureRef ? <EvidenceViewer evidence={signatureRef} /> : <span className="text-sm text-fg-muted">Sin firma registrada.</span>}
      </div>

      {/* Evidencias */}
      <div className="nx-surface card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft text-sm font-semibold">Evidencias del despacho</div>
        <div className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {evidences.length === 0 && <span className="text-sm text-fg-muted">Sin evidencias.</span>}
          {evidences.map((e) => <EvidenceViewer key={e.evidence_id} evidence={e} />)}
        </div>
      </div>
    </div>
  );
}
