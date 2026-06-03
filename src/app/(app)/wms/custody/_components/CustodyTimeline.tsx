import { Icon } from "@/components/Icon";
import { fmtDateTime } from "@/lib/utils";
import { STAGE_META, EVENT_TYPE_META, type CustodyTimeline as Timeline } from "@/lib/custody/types";
import { EvidenceViewer } from "./EvidenceViewer";

/**
 * Timeline visual de la Cadena de Custodia (GATE 5 · FASE 4). Orden cronológico
 * (lo provee get_custody_timeline). Muestra Packing → Despacho → Transporte →
 * Entrega → POD con sus evidencias (cada una vía visor seguro). Presentacional.
 */
export function CustodyTimeline({
  timeline,
  allowRedact = false,
  revalidate,
}: {
  timeline: Timeline;
  allowRedact?: boolean;
  revalidate?: string;
}) {
  if (timeline.nodes.length === 0) {
    return (
      <div className="nx-surface card card-pad text-center text-fg-muted text-sm">
        Sin eventos de custodia para esta entidad todavía.
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {timeline.nodes.map((n, i) => {
        if (n.type === "pod") {
          return (
            <li key={`pod-${n.pod_id}`} className="nx-surface card overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3">
                <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "#16a34a1a", color: "#16a34a" }}>
                  <Icon name="check-circle" size={14} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold">{n.public_id}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded"
                      style={{ background: "#16a34a1a", color: "#16a34a" }}>POD</span>
                  </div>
                  <div className="text-[11px] text-fg-muted mt-0.5">
                    {n.signed_at ? fmtDateTime(n.signed_at) : "—"} · Receptor: {n.receiver_name ?? "—"}
                    {n.has_document && " · con documento"}
                  </div>
                </div>
              </div>
            </li>
          );
        }
        const sm = STAGE_META[n.stage];
        const et = EVENT_TYPE_META[n.event_type];
        return (
          <li key={`ev-${n.event_id}`} className="nx-surface card overflow-hidden">
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: `${sm.color}1a`, color: sm.color }}>
                <span className="text-[11px] font-bold">{i + 1}</span>
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded"
                    style={{ background: `${sm.color}1a`, color: sm.color }}>{sm.label}</span>
                  <span className="text-sm font-medium">{et.label}</span>
                  <span className="font-mono text-[10px] text-fg-muted">{n.public_id}</span>
                </div>
                <div className="text-[11px] text-fg-muted mt-0.5 flex items-center gap-3 flex-wrap">
                  <span><Icon name="clock" size={10} /> {fmtDateTime(n.occurred_at)}</span>
                  {n.geo && (
                    <span title={`${n.geo.lat}, ${n.geo.lng}`}><Icon name="pin" size={10} /> geo{n.geo.source ? ` (${n.geo.source})` : ""}</span>
                  )}
                </div>
                {n.notes && <div className="text-xs text-fg-secondary mt-1">{n.notes}</div>}
                {n.evidences.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                    {n.evidences.map((ev) => (
                      <EvidenceViewer key={ev.evidence_id} evidence={ev} allowRedact={allowRedact} revalidate={revalidate} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
