import Link from "next/link";
import { Icon } from "@/components/Icon";
import {
  getCustodyPhysicalTimeline,
  getCustodyTimeline,
  getPhysicalUnitToken,
  getShipmentToken,
  resolveActorNames,
} from "@/lib/custody/custody";
import {
  deriveCaseProgress,
  deriveDecisionChecklist,
  deriveNowAction,
} from "@/lib/custody/case-progress";
import { custodyQrDataUrl } from "@/lib/custody/qr";
import { fmtDateTime } from "@/lib/utils";
import type { CustodyEvidenceRef, CustodyTimeline as Timeline } from "@/lib/custody/types";
import { loadCustodyCaseAction, loadCustodyDocumentAction } from "../actions";
import { CaseAiPanel } from "../_components/CaseAiPanel";
import { CaseDecisionPanel } from "../_components/CaseDecisionPanel";
import { CaseInspectionPanel } from "../_components/CaseInspectionPanel";
import { PhysicalCapturePanel } from "../_components/PhysicalCapturePanel";
import { CaseReevaluatePanel } from "../_components/CaseReevaluatePanel";
import { CasePodGate } from "../_components/CasePodGate";
import { CaseDocumentCard } from "../_components/CaseDocumentCard";
import { CustodyTimeline } from "../_components/CustodyTimeline";
import { CaseProgressBar } from "../_components/CaseProgressBar";
import { CaseNowBlock } from "../_components/CaseNowBlock";
import { CaseEvidencePanel, type EvidenceSlot } from "../_components/CaseEvidencePanel";
import { CaseChecklist } from "../_components/CaseChecklist";
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
): { evidence: CustodyEvidenceRef; occurredAt: string; actorId: string | null } | null {
  for (const node of timeline.nodes) {
    if (node.type !== "event") continue;
    const ev = node as EventNode;
    if (!match(ev)) continue;
    const first = ev.evidences?.[0];
    if (first) return { evidence: first, occurredAt: ev.occurred_at, actorId: ev.actor_id };
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
  // 2-C-2 · el documento probatorio. Best-effort: si no se puede resolver, la
  // pantalla no muestra la tarjeta y todo lo demás sigue igual — el documento
  // no puede tumbar el caso.
  const docRes = await loadCustodyDocumentAction(params.id);
  const documento = docRes.ok ? docRes.data : null;
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
  /**
   * S1-4 · EGRESO E INSPECCIÓN SON DOS EVENTOS DISTINTOS.
   *
   * Antes `inspeccion_humana` ganaba sobre `foto_egreso`, así que la tarjeta de
   * egreso mostraba la foto de la inspección y `tieneEgreso` declaraba egreso
   * registrado cuando no lo había: el checklist del operario mentía y el panel
   * de captura se apagaba con un slot vacío. Se separan.
   */
  const egreso =
    firstEvidence(timeline, (e) => e.event_type === "foto_egreso") ??
    (isPhysical ? null : firstEvidence(timeline, (e) => e.stage === "entrega"));
  const inspeccion = firstEvidence(timeline, (e) => e.event_type === "inspeccion_humana");

  // §7 · QUIÉN. El nombre se resuelve en la aplicación desde `profiles_public`
  // (vista sin PII, `grant select to authenticated`), no por migración: el
  // timeline viene de una RPC. Ver el docblock de `resolveActorNames`.
  const nombres = await resolveActorNames([
    ingreso?.actorId ?? null,
    egreso?.actorId ?? null,
    inspeccion?.actorId ?? null,
  ]);
  const slot = (
    e: { evidence: CustodyEvidenceRef; occurredAt: string; actorId: string | null } | null,
  ): EvidenceSlot | null =>
    e ? { evidence: e.evidence, occurredAt: e.occurredAt, actorName: e.actorId ? nombres[e.actorId] ?? null : null } : null;

  // §7 · las tres derivaciones puras: dónde está parado, qué hacer ahora y qué
  // falta para decidir. Viven en `case-progress.ts` para poder probarse sin DOM.
  const progresoInput = { view, tieneIngreso: ingreso !== null, tieneEgreso: egreso !== null };
  const progreso = deriveCaseProgress(progresoInput);
  const ahora = deriveNowAction(progresoInput);
  const checklist = deriveDecisionChecklist(progresoInput);

  // Las clases condicionales se calculan en variables, no con template
  // literals dentro de `className`: es el patrón que ya usa `StateBadge` en
  // este mismo archivo, y el que el guard de clases sabe leer (I6).
  const bannerCard = view.podBlocked ? "card mt-3 p-3" : "card mt-3 p-3 border-status-success";
  const bannerText = view.podBlocked
    ? "flex items-center gap-2 text-sm text-status-danger"
    : "flex items-center gap-2 text-sm text-status-success";

  return (
    <main className="p-4 lg:p-8 nx-page-fade">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/wms/custody" className="btn btn-ghost btn-sm" aria-label="Volver a Custodia">
          <Icon name="arrow-left" size={12} /> Volver
        </Link>
        <h1 className="page-title">Custodia Digital</h1>
        <StateBadge label={view.stateLabel} tone={view.tone} />
      </header>

      {/* ── IDENTIDAD ─────────────────────────────────────────────────────
          §7.2 · La pantalla arranca diciendo DE QUIÉN ES el bien y CUÁL es.
          Antes el encabezado decía «Custodia Digital» y nada más: el
          inspector estaba por liberar mercadería sin saber de qué cliente.  */}
      <section className="card mt-4 p-4" aria-labelledby="identidad-title" data-identidad="true">
        <p id="identidad-title" className="eyebrow-tiny">Caso de custodia</p>
        <h2 className="mt-1 text-xl font-bold" data-cliente="true">
          {view.identity.clientLabel ?? "Depositante no disponible"}
        </h2>
        {view.identity.clientFromReception && (
          <p className="mt-0.5 text-xs text-fg-muted">
            Depositante asentado en la recepción
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          {view.identity.unitPublicId && (
            <span className="badge font-mono" data-cpu="true">{view.identity.unitPublicId}</span>
          )}
          {view.identity.casePublicId && (
            <span className="badge font-mono" data-cint="true">{view.identity.casePublicId}</span>
          )}
        </div>

        <p className="mt-2 text-sm text-fg-secondary">
          {[
            view.identity.sku ? `SKU ${view.identity.sku}` : null,
            view.identity.quantity !== null ? `${view.identity.quantity} un.` : null,
            view.identity.lotNumber ? `lote ${view.identity.lotNumber}` : "sin lote",
          ]
            .filter((x): x is string => x !== null)
            .join(" · ")}
          {view.identity.receptionPublicId && view.identity.receptionId && (
            <>
              {" · recepción "}
              <Link
                href={`/wms/recepciones?id=${view.identity.receptionId}`}
                className="underline"
                data-recepcion="true"
              >
                {view.identity.receptionPublicId}
              </Link>
            </>
          )}
        </p>

        <CaseProgressBar progress={progreso} />
      </section>

      {/* ── BANNER DE CONSECUENCIA ────────────────────────────────────────
          §7.2 · Arriba, nunca al pie. El operario tiene que saber qué está
          bloqueado ANTES de mirar la evidencia.                            */}
      <div className={bannerCard} role="status" data-banner="true">
        <p className={bannerText}>
          <Icon name={view.podBlocked ? "lock" : "check-circle"} size={14} aria-hidden="true" />
          <span>
            {view.podBlocked
              ? (view.podBlockedReason ?? "Despacho y POD bloqueados")
              : "Despacho habilitado · decisión humana registrada"}
          </span>
        </p>
      </div>

      {/* ── ▸ AHORA · UNA SOLA ACCIÓN VIVA ───────────────────────────────
          §7 · lo primero después del bloqueo. El resto de la pantalla sigue
          existiendo, atenuado: el operario ve UNA cosa para hacer.          */}
      <CaseNowBlock action={ahora} />

      {/* ── MOBILE-FIRST ──────────────────────────────────────────────────
          Una sola columna en el teléfono, en el orden en que el operario del
          depósito la necesita: análisis y decisión ARRIBA, porque decide desde
          el piso. Desde `lg` se abre en dos columnas para escritorio.        */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <CaseAiPanel view={view} />
          <CaseEvidencePanel
            ingreso={slot(ingreso)}
            egreso={slot(egreso)}
            inspeccion={slot(inspeccion)}
          />
          <PhysicalCapturePanel
            view={view}
            tieneIngreso={ingreso !== null}
            tieneEgreso={egreso !== null}
          />
        </div>

        <div className="flex flex-col gap-4">
          <CaseChecklist items={checklist} />
          <CaseInspectionPanel view={view} />
          <CaseReevaluatePanel view={view} />
          <CaseDecisionPanel view={view} />
          <CasePodGate view={view} shipmentId={shipmentId} hasPdf={view.podPdfReady} />
          {documento && <CaseDocumentCard doc={documento} />}

          <section className="card p-4" aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="eyebrow-tiny">Cadena de custodia</h2>
            <div className="mt-2">
              <CustodyTimeline timeline={timeline} revalidate={`/wms/custody/${view.caseId}`} />
            </div>
          </section>

          {qr && token && (
            <section className="card p-4" aria-labelledby="identificacion-title">
              <h2 id="identificacion-title" className="eyebrow-tiny">Identificación física</h2>
              <div className="mt-2">
                <QrCard dataUrl={qr} url={`/c/${token}`} publicId={view.identity.unitPublicId ?? view.caseId.slice(0, 8)} label="QR de la unidad" />
                <div className="mt-2"><PrintButton label="Imprimir etiqueta" /></div>
              </div>
            </section>
          )}
        </div>
      </div>

      <footer className="mt-4 text-xs text-fg-muted">
        Creado {fmtDateTime(view.createdAt)} · última actualización {fmtDateTime(view.updatedAt)}
      </footer>
    </main>
  );
}
