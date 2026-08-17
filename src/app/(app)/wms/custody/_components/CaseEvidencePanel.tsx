import { fmtDateTime } from "@/lib/utils";
import type { CustodyEvidenceRef } from "@/lib/custody/types";
import { EvidenceViewer } from "./EvidenceViewer";

/**
 * §7 · COMPARACIÓN VISUAL LADO A LADO · INGRESO / EGRESO.
 *
 * La especificación pone los dos paneles enfrentados, en grande, con hora,
 * operario y sha256 al pie de cada uno. Antes la evidencia era un botón «Ver»
 * inline dentro de tres columnas distintas: el inspector no podía comparar sin
 * abrir dos pestañas, que es exactamente lo que la Adenda pide que haga de un
 * vistazo.
 *
 * ─── EL BINARIO SIGUE SIN SALIR A LA PANTALLA ────────────────────────────
 *
 * El recuadro grande NO renderiza la imagen: la evidencia se abre por
 * `EvidenceViewer`, que pide un signed URL de TTL corto por server action
 * auditada. Poner un `<img>` con la ruta de Storage sería el único cambio de
 * este bloque capaz de romper la garantía probatoria del módulo, y no se hace.
 *
 * ─── EL NOMBRE DEL OPERARIO ──────────────────────────────────────────────
 *
 * Llega resuelto desde el servidor (`actor_name`). La cadena responde QUÉ y
 * CUÁNDO desde 0222; QUIÉN faltaba, y una cadena de custodia sin quién prueba
 * dos tercios de lo que promete.
 */

export interface EvidenceSlot {
  evidence: CustodyEvidenceRef;
  occurredAt: string;
  actorName: string | null;
}

function Slot({
  titulo,
  estado,
  slot,
  placeholder,
}: {
  titulo: string;
  estado: string;
  slot: EvidenceSlot | null;
  placeholder: string;
}) {
  const marco = slot
    ? "rounded-lg border border-stroke-soft"
    : "rounded-lg border border-dashed border-stroke-soft";
  const estadoCls = slot
    ? "text-[11px] font-bold uppercase tracking-wide text-status-success"
    : "text-[11px] font-bold uppercase tracking-wide text-fg-muted";

  return (
    <div className={marco} data-slot={titulo.toLowerCase()}>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wide">{titulo}</span>
        <span className={estadoCls}>{estado}</span>
      </div>

      <div className="flex min-h-24 items-center justify-center bg-bg-surface-alt px-3 py-6">
        {slot ? (
          <EvidenceViewer evidence={slot.evidence} />
        ) : (
          <p className="text-xs text-fg-muted">{placeholder}</p>
        )}
      </div>

      {slot && (
        <p className="px-3 py-2 font-mono text-[11px] text-fg-muted" data-slot-pie="true">
          {[
            fmtDateTime(slot.occurredAt),
            slot.actorName ?? null,
            `sha256 ${slot.evidence.sha256.slice(0, 4)}…${slot.evidence.sha256.slice(-4)}`,
          ]
            .filter((x): x is string => x !== null)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

export function CaseEvidencePanel({
  ingreso,
  egreso,
  inspeccion,
}: {
  ingreso: EvidenceSlot | null;
  egreso: EvidenceSlot | null;
  inspeccion: EvidenceSlot | null;
}) {
  return (
    <section className="card p-4" aria-labelledby="evidencia-title" data-evidencia="true">
      <h2 id="evidencia-title" className="eyebrow-tiny">Evidencia · comparación visual</h2>

      {/* Mobile-first: apilado en el teléfono, enfrentado desde `sm`. El
          operario de depósito trabaja con el teléfono en la mano. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Slot
          titulo="Ingreso"
          estado={ingreso ? "Registrada" : "Pendiente"}
          slot={ingreso}
          placeholder="Esperando la foto de ingreso"
        />
        <Slot
          titulo="Egreso"
          estado={egreso ? "Registrada" : ingreso ? "Pendiente" : "Más adelante"}
          slot={egreso}
          placeholder={ingreso ? "Esperando la foto de egreso" : "Se habilita al preparar el despacho"}
        />
      </div>

      {inspeccion && (
        <div className="mt-3 border-t border-stroke-soft pt-3">
          <p className="eyebrow-tiny">Inspección física</p>
          <div className="mt-2">
            <Slot titulo="Inspección" estado="Registrada" slot={inspeccion} placeholder="" />
          </div>
        </div>
      )}
    </section>
  );
}
