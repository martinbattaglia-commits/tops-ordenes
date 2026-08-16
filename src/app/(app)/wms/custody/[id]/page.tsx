import Link from "next/link";
import { Icon } from "@/components/Icon";
import {
  getCustodyPhysicalTimeline,
  getCustodyTimeline,
  getPhysicalUnitToken,
  getShipmentToken,
} from "@/lib/custody/custody";
import { custodyQrDataUrl } from "@/lib/custody/qr";
import { fmtDateTime } from "@/lib/utils";
import type { CustodyEvidenceRef, CustodyTimeline as Timeline } from "@/lib/custody/types";
import { loadCustodyCaseAction } from "../actions";
import { CaseAiPanel } from "../_components/CaseAiPanel";
import { CaseDecisionPanel } from "../_components/CaseDecisionPanel";
import { CaseInspectionPanel } from "../_components/CaseInspectionPanel";
import { PhysicalCapturePanel } from "../_components/PhysicalCapturePanel";
import { CaseReevaluatePanel } from "../_components/CaseReevaluatePanel";
import { CasePodGate } from "../_components/CasePodGate";
import { CustodyTimeline } from "../_components/CustodyTimeline";
import { EvidenceViewer } from "../_components/EvidenceViewer";
import { PrintButton } from "../_components/PrintButton";
import { QrCard } from "../_components/QrCard";

export const metadata = { title: "Custodia Digital · Caso" };

/**
 * WMS UI-1 · Detalle del caso de Custodia Digital.
 *
 * Todo lo que se muestra viene del servidor ya resuelto: el estado, el motivo
 * por el que se puede o no decidir, y el bloqueo del POD. La pantalla no
 * calcula elegibilidad ni conoce umbrales; si algo no está disponible, lo dice
 * con una etiqueta y no con el error crudo de la base.
 */

type EventNode = Extract<Timeline["nodes"][number], { type: "event" }>;

function firstEvidence(
  timeline: Timeline,
  match: (n: EventNode) => boolean,
): { evidence: CustodyEvidenceRef; occurredAt: string } | null {
  for (const node of timeline.nodes) {
    if (node.type !== "event") continue;
    const ev = node as EventNode;
    if (!match(ev)) continue;
    const first = ev.evidences?.[0];
    if (first) return { evidence: first, occurredAt: ev.occurred_at };
  }
  return null;
}

function StateBadge({ label, tone }: { label: string; tone: string }) {
  const cls =
    tone === "released"
      ? "badge badge-success"
      : tone === "quarantined"
        ? "badge badge-danger"
        : tone === "review"
          ? "badge badge-warning"
          : "badge";
  return (
    <span className={cls} role="status" aria-label={`Estado del caso: ${label}`}>
      {label}
    </span>
  );
}

export default async function CustodyCasePage({ params }: { params: { id: string } }) {
  const res = await loadCustodyCaseAction(params.id);

  if (!res.ok || !res.data) {
    return (
      <main className="p-4 lg:p-8 nx-page-fade">
        <Link href="/wms/custody" className="btn btn-ghost btn-sm">
          <Icon name="arrow-left" size={12} /> Volver a Custodia
        </Link>
        <div className="card mt-4 p-4" role="alert">
          <p className="text-sm">{res.ok ? "Caso no disponible" : res.error}</p>
        </div>
      </main>
    );
  }

  const view = res.data;
  const isShipment = view.scope === "shipment";
  const isPhysical = view.scope === "physical_unit";
  const shipmentId = isShipment ? view.entityId : null;

  const timeline = isPhysical
    ? await getCustodyPhysicalTimeline(view.entityId)
    : await getCustodyTimeline(isShipment ? null : view.entityId, shipmentId);

  const token = isPhysical
    ? await getPhysicalUnitToken(view.entityId)
    : shipmentId ? await getShipmentToken(shipmentId) : null;
  const qr = token ? await custodyQrDataUrl(token) : null;


  const ingreso = firstEvidence(timeline, (e) =>
    isPhysical ? e.event_type === "foto_ingreso" : e.stage === "packing",
  );
  const egreso =
    firstEvidence(timeline, (e) => e.event_type === "inspeccion_humana") ??
    firstEvidence(timeline, (e) => e.event_type === "foto_egreso") ??
    firstEvidence(timeline, (e) => e.stage === "entrega");

  return (
    <main className="p-4 lg:p-8 nx-page-fade">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/wms/custody" className="btn btn-ghost btn-sm" aria-label="Volver a Custodia">
          <Icon name="arrow-left" size={12} /> Volver
        </Link>
        <h1 className="page-title">Custodia Digital</h1>
        <StateBadge label={view.stateLabel} tone={view.tone} />
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* ── INGRESO ────────────────────────────────────────────────── */}
        <section className="card p-4" aria-labelledby="ingreso-title">
          <h2 id="ingreso-title" className="eyebrow-tiny">Ingreso · recepción</h2>
          {ingreso ? (
            <>
              <div className="mt-2">
                <EvidenceViewer evidence={ingreso.evidence} />
              </div>
              <p className="mt-2 flex items-center gap-2 text-xs text-status-success">
                <Icon name="check-circle" size={12} aria-hidden="true" />
                <span>Foto vinculada · hash verificado por el servidor</span>
              </p>
              <p className="text-xs text-fg-muted">{fmtDateTime(ingreso.occurredAt)}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">Sin fotografía de ingreso registrada.</p>
          )}

          {qr && token && (
            <div className="mt-3">
              <QrCard dataUrl={qr} url={`/c/${token}`} publicId={view.caseId.slice(0, 8)} label="QR de la unidad" />
              <div className="mt-2"><PrintButton label="Imprimir etiqueta" /></div>
            </div>
          )}
        </section>

        {/* ── CUSTODIA · timeline ────────────────────────────────────── */}
        <section className="card p-4" aria-labelledby="timeline-title">
          <h2 id="timeline-title" className="eyebrow-tiny">Custodia · movimientos</h2>
          <div className="mt-2">
            <CustodyTimeline timeline={timeline} revalidate={`/wms/custody/${view.caseId}`} />
          </div>
        </section>

        {/* ── EGRESO ─────────────────────────────────────────────────── */}
        <section className="card p-4" aria-labelledby="egreso-title">
          <h2 id="egreso-title" className="eyebrow-tiny">Preparación de egreso</h2>
          {egreso ? (
            <>
              <div className="mt-2">
                <EvidenceViewer evidence={egreso.evidence} />
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                Fotografía nueva obligatoria · {fmtDateTime(egreso.occurredAt)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">
              {isPhysical
                ? "Falta la fotografía de egreso: registrala en «Fotografías de la unidad»."
                : "Falta la fotografía de egreso."}
            </p>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <CaseAiPanel view={view} />
        <div className="flex flex-col gap-3">
          {/* Las dos fotos del contrato (§4.2) se capturan acá, en la vista
              autenticada de la unidad. El QR es de sólo lectura y no puede
              serlo: no hay sesión que atribuir a la captura. */}
          <PhysicalCapturePanel
            view={view}
            tieneIngreso={ingreso !== null}
            tieneEgreso={egreso !== null}
          />
          <CaseInspectionPanel view={view} />
          <CaseReevaluatePanel view={view} />
          <CaseDecisionPanel view={view} />
          <CasePodGate view={view} shipmentId={shipmentId} hasPdf={view.podPdfReady} />
        </div>
      </div>

      <footer className="mt-4 text-xs text-fg-muted">
        Creado {fmtDateTime(view.createdAt)} · última actualización {fmtDateTime(view.updatedAt)}
      </footer>
    </main>
  );
}
