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

interface EvidenceHit {
  evidence: CustodyEvidenceRef;
  occurredAt: string;
  actorId: string | null;
  /** Posición del evento en el timeline. La RPC ordena por `chain_seq`
   *  ascendente (`0250a:2229`), así que el índice ES el orden de cadena. */
  index: number;
}

/**
 * Busca un evento con evidencia. `pick: "last"` devuelve el MÁS RECIENTE en
 * orden de cadena — imprescindible para egreso e inspección, que pueden
 * repetirse: tras «repetí la foto de egreso», el primero ya no es el vigente.
 */
function scanEvidence(
  timeline: Timeline,
  match: (n: EventNode) => boolean,
  pick: "first" | "last",
  evidenceOk: (e: CustodyEvidenceRef) => boolean = () => true,
): EvidenceHit | null {
  let found: EvidenceHit | null = null;
  timeline.nodes.forEach((node, index) => {
    if (node.type !== "event") return;
    const ev = node as EventNode;
    if (!match(ev)) return;
    const evidence = (ev.evidences ?? []).find(evidenceOk);
    if (!evidence) return;
    if (pick === "first" && found !== null) return;
    found = { evidence, occurredAt: ev.occurred_at, actorId: ev.actor_id, index };
  });
  return found;
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


  const ingreso = scanEvidence(
    timeline,
    (e) => (isPhysical ? e.event_type === "foto_ingreso" : e.stage === "packing"),
    "first",
  );
  /**
   * S1-4 · EGRESO E INSPECCIÓN SON DOS EVENTOS DISTINTOS.
   *
   * Antes `inspeccion_humana` ganaba sobre `foto_egreso`, así que la tarjeta de
   * egreso mostraba la foto de la inspección y `tieneEgreso` declaraba egreso
   * registrado cuando no lo había: el checklist del operario mentía y el panel
   * de captura se apagaba con un slot vacío. Se separan.
   *
   * R-3 · Y de cada uno vale el ÚLTIMO: egreso e inspección se pueden repetir
   * («repetí la foto de egreso»), y mostrar o computar sobre el primero sería
   * razonar sobre un ciclo ya superado.
   */
  const egreso =
    scanEvidence(timeline, (e) => e.event_type === "foto_egreso", "last") ??
    (isPhysical ? null : scanEvidence(timeline, (e) => e.stage === "entrega", "last"));
  const inspeccion = scanEvidence(timeline, (e) => e.event_type === "inspeccion_humana", "last");

  /**
   * R-3 · LA INSPECCIÓN VÁLIDA NO ES «HUBO UNA ALGUNA VEZ».
   *
   * El predicado canónico (`is_custody_inspection_evidence`, 0224) exige una
   * foto NO redactada, posterior estricta al egreso vigente. Contar cualquier
   * evento del timeline hacía que, tras repetir el egreso, la pantalla
   * declarara la inspección registrada mientras el servidor la rechazaba. El
   * índice del nodo es orden de cadena, así que «posterior al último egreso»
   * se decide sin parsear timestamps. Divergencia residual asumida: el consumo
   * de la evidencia por una decisión previa no es visible desde el timeline.
   */
  const inspeccionValida = scanEvidence(
    timeline,
    (e) => e.event_type === "inspeccion_humana",
    "last",
    (ev) => ev.kind === "foto" && !ev.redacted,
  );
  const tieneInspeccion =
    inspeccionValida !== null && egreso !== null && inspeccionValida.index > egreso.index;

  // §7 · QUIÉN. El nombre se resuelve en la aplicación desde `profiles_public`
  // (vista sin PII, `grant select to authenticated`), no por migración: el
  // timeline viene de una RPC. Ver el docblock de `resolveActorNames`.
  const nombres = await resolveActorNames([
    ingreso?.actorId ?? null,
    egreso?.actorId ?? null,
    inspeccion?.actorId ?? null,
  ]);
  const slot = (
    e: EvidenceHit | null,
  ): EvidenceSlot | null =>
    e ? { evidence: e.evidence, occurredAt: e.occurredAt, actorName: e.actorId ? nombres[e.actorId] ?? null : null } : null;

  // §7 · las tres derivaciones puras: dónde está parado, qué hacer ahora y qué
  // falta para decidir. Viven en `case-progress.ts` para poder probarse sin DOM.
  // `tieneInspeccion` sale del TIMELINE, no de `inspection.eligible`: ese campo
  // se calcula detrás de un guard de `wms.custody.decide`, permiso que el
  // operario que saca las fotos no tiene, y leerlo como «hay foto» lo dejaba
  // pidiendo una inspección ya registrada para siempre (remediación C4 · A-2).
  const progresoInput = {
    view,
    tieneIngreso: ingreso !== null,
    tieneEgreso: egreso !== null,
    tieneInspeccion,
  };
  const progreso = deriveCaseProgress(progresoInput);
  const ahora = deriveNowAction(progresoInput);
  const checklist = deriveDecisionChecklist(progresoInput);

  // Las clases condicionales se calculan en variables, no con template literals
  // dentro de `className`.
  //
  // ⚠ R-25 · ESTE COMENTARIO AFIRMABA DOS COSAS FALSAS, y las dos las volvió
  // falsas el propio commit que lo escribió: citaba un `StateBadge` «en este
  // mismo archivo» que no existe en ninguna parte del módulo, y sostenía que
  // era «el patrón que el guard de clases sabe leer» cuando el extractor de
  // `custody-ui-classes.test.ts` NO leía `className={variable}` — es decir,
  // justo esta forma. El guard corría en verde sin mirar ninguna de estas
  // clases. El extractor se corrigió (M-4) y ahora la afirmación es cierta:
  // hay un mutante que lo prueba en los dos sentidos.
  const bannerCls = view.podBlocked ? "cd-banner cd-banner--block" : "cd-banner cd-banner--ok";

  // §7 VISUAL · el chip de estado del mockup, por tono del caso.
  const estadoCls =
    view.tone === "released"
      ? "cd-state cd-state--released"
      : view.tone === "quarantined"
        ? "cd-state cd-state--quarantined"
        : view.tone === "review"
          ? "cd-state cd-state--review"
          : view.tone === "hold"
            ? "cd-state cd-state--hold"
            : "cd-state cd-state--pending";

  return (
    <main className="p-4 lg:p-8 nx-page-fade">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/wms/custody" className="btn btn-ghost btn-sm" aria-label="Volver a Custodia">
          <Icon name="arrow-left" size={12} /> Volver
        </Link>
        <h1 className="page-title">Custodia Digital</h1>
      </header>

      {/* ═══ LA TARJETA DEL CASO ══════════════════════════════════════════
          Un solo objeto continuo, como en el mockup corporativo: barra navy,
          identidad, aviso, y de ahí para abajo una sección por bloque. No es
          una grilla de tarjetas sueltas — el circuito se lee de arriba abajo
          en el orden en que ocurre.                                        */}
      <div className="cd-shell mt-4" data-caso="true">
        <div className="cd-topbar">
          <div className="cd-topbar__left">
            <span className="cd-topbar__brand">TOPS NEXUS</span>
            <span className="cd-topbar__crumb">
              WMS · Custodia Digital
              {view.identity.unitPublicId && (
                <> · <span className="cd-topbar__id">{view.identity.unitPublicId}</span></>
              )}
            </span>
          </div>
          <span className="cd-topbar__who">
            <span className="cd-dot" aria-hidden="true" />
            {view.stateLabel}
          </span>
        </div>

        {/* ── IDENTIDAD ───────────────────────────────────────────────────
            §7.2 · La pantalla arranca diciendo DE QUIÉN ES el bien y CUÁL es.
            Antes el encabezado decía «Custodia Digital» y nada más: el
            inspector estaba por liberar mercadería sin saber de qué cliente. */}
        <section className="cd-ident" aria-labelledby="identidad-title" data-identidad="true">
          <div className="cd-ident__row">
            <div className="cd-ident__main">
              <p id="identidad-title" className="cd-eyebrow">
                Caso de custodia{view.identity.clientFromReception ? " · asentado en la recepción" : ""}
              </p>
              <h2 className="cd-title" data-cliente="true">
                {view.identity.clientLabel ?? "Depositante no disponible"}
              </h2>

              <div className="cd-chips">
                {view.identity.unitPublicId && (
                  <span className="cd-chip" data-cpu="true">{view.identity.unitPublicId}</span>
                )}
                {view.identity.casePublicId && (
                  <span className="cd-chip" data-cint="true">{view.identity.casePublicId}</span>
                )}
              </div>

              <p className="cd-meta">
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
                      data-recepcion="true"
                    >
                      {view.identity.receptionPublicId}
                    </Link>
                  </>
                )}
              </p>
            </div>

            <span className={estadoCls} role="status" aria-label={`Estado del caso: ${view.stateLabel}`}>
              {view.stateLabel}
            </span>
          </div>

          <CaseProgressBar progress={progreso} />
        </section>

        {/* ── BANNER DE CONSECUENCIA ──────────────────────────────────────
            §7.2 · Arriba, nunca al pie. El operario tiene que saber qué está
            bloqueado ANTES de mirar la evidencia.                          */}
        <div className={bannerCls} role="status" data-banner="true">
          <Icon name={view.podBlocked ? "lock" : "check-circle"} size={16} aria-hidden="true" />
          <span>
            {view.podBlocked
              ? (view.podBlockedReason ?? "Despacho y POD bloqueados")
              : "Despacho habilitado · decisión humana registrada"}
          </span>
        </div>

        {/* ── ▸ AHORA · UNA SOLA ACCIÓN VIVA ─────────────────────────────
            §7 · lo primero después del bloqueo. El resto de la pantalla sigue
            existiendo, atenuado: el operario ve UNA cosa para hacer.        */}
        <CaseNowBlock action={ahora} />

        {/* ── EL CIRCUITO, EN ORDEN ──────────────────────────────────────
            Evidencia → análisis → qué falta → decisión → cierre. Es el orden
            en que el caso ocurre y en que el operario lo piensa.            */}
        <CaseEvidencePanel
          ingreso={slot(ingreso)}
          egreso={slot(egreso)}
          inspeccion={slot(inspeccion)}
        />

        <CaseAiPanel view={view} />

        <CaseChecklist items={checklist} />

        {/* F2-2 · cada panel lleva el id al que ancla el CTA de ▸ AHORA:
            un botón que parece botón tiene que llevar a alguna parte. */}
        <div className="cd-sec">
          <div id="panel-captura">
            <PhysicalCapturePanel
              view={view}
              tieneIngreso={ingreso !== null}
              tieneEgreso={egreso !== null}
            />
          </div>
          <div id="panel-inspeccion">
            <CaseInspectionPanel view={view} />
          </div>
          <div id="panel-reevaluacion">
            <CaseReevaluatePanel view={view} />
          </div>
          <div id="panel-decision">
            <CaseDecisionPanel view={view} />
          </div>
          <div id="panel-pod">
            <CasePodGate view={view} shipmentId={shipmentId} hasPdf={view.podPdfReady} />
          </div>
        </div>

        {documento && (
          <div className="cd-sec">
            <CaseDocumentCard doc={documento} />
          </div>
        )}

        <section className="cd-sec" aria-labelledby="timeline-title">
          <h2 id="timeline-title" className="cd-label">Cadena de custodia</h2>
          <CustodyTimeline timeline={timeline} revalidate={`/wms/custody/${view.caseId}`} />
        </section>

        {qr && token && (
          <section className="cd-sec" aria-labelledby="identificacion-title">
            <h2 id="identificacion-title" className="cd-label">Identificación física</h2>
            <div className="cd-idrow">
              <QrCard
                dataUrl={qr}
                url={`/c/${token}`}
                publicId={view.identity.unitPublicId ?? view.caseId.slice(0, 8)}
                label="QR de la unidad"
              />
              <PrintButton label="Imprimir etiqueta" />
            </div>
          </section>
        )}
      </div>

      <footer className="mt-4 text-xs text-fg-muted">
        Creado {fmtDateTime(view.createdAt)} · última actualización {fmtDateTime(view.updatedAt)}
      </footer>
    </main>
  );
}
