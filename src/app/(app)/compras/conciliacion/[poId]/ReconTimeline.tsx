// src/app/(app)/compras/conciliacion/[poId]/ReconTimeline.tsx
import type { ReconEvent } from "@/lib/recon/types";
import { fmtDateTime } from "@/lib/utils";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/components/Icon";

const ACTION_LABEL: Record<string, string> = {
  iniciar:          "Conciliación iniciada",
  enviar_revision:  "Enviada a revisión",
  aprobar:          "Aprobada",
  rechazar:         "Rechazada",
  aceptar_dif:      "Diferencia aceptada",
  nota:             "Nota registrada",
};

const ACTION_ICON: Record<string, string> = {
  iniciar:         "play-circle",
  enviar_revision: "send",
  aprobar:         "check-circle",
  rechazar:        "x-circle",
  aceptar_dif:     "check",
  nota:            "message-square",
};

export function ReconTimeline({ events }: { events: ReconEvent[] }) {
  if (!events.length) return (
    <p className="text-fg-muted text-sm">Sin eventos registrados.</p>
  );
  return (
    <ol className="relative border-l border-[var(--stroke-soft)] ml-3 space-y-4">
      {events.map(ev => (
        <li key={ev.id} className="ml-4">
          <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-[var(--bg-surface)] border border-[var(--stroke-soft)]">
            <Icon name={(ACTION_ICON[ev.action] ?? "circle") as IconName} size={8} />
          </span>
          <div className="text-xs text-fg-muted">{fmtDateTime(ev.ts)}</div>
          <div className="text-sm font-medium text-fg-primary">
            {ACTION_LABEL[ev.action] ?? ev.action}
          </div>
          {ev.note && <p className="text-xs text-fg-secondary mt-0.5 italic">&ldquo;{ev.note}&rdquo;</p>}
        </li>
      ))}
    </ol>
  );
}
