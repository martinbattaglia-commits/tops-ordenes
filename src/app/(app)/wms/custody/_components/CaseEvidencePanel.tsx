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
  slot,
  esperando,
  placeholder,
  destacado,
}: {
  titulo: string;
  slot: EvidenceSlot | null;
  /** El slot que el operario tiene que llenar AHORA: ámbar, no gris. */
  esperando: boolean;
  placeholder: string;
  destacado: boolean;
}) {
  const marco = slot
    ? "cd-slot cd-slot--live"
    : destacado
      ? "cd-slot cd-slot--focus"
      : "cd-slot";

  return (
    <div className={marco} data-slot={titulo.toLowerCase()}>
      <div className="cd-slot__hd">
        <span>{titulo}</span>
        {slot ? (
          <span className="cd-slot__when">{fmtDateTime(slot.occurredAt)}</span>
        ) : (
          <span className={esperando ? "cd-slot__wait" : "cd-slot__later"}>
            {esperando ? "PENDIENTE" : "MÁS ADELANTE"}
          </span>
        )}
      </div>

      <div className={slot ? "cd-slot__body cd-slot__body--live" : "cd-slot__body"}>
        {slot ? <EvidenceViewer evidence={slot.evidence} /> : placeholder}
      </div>

      {slot && (
        <p className="cd-slot__ft" data-slot-pie="true">
          {[
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
    <section className="cd-sec" aria-labelledby="evidencia-title" data-evidencia="true">
      <h2 id="evidencia-title" className="cd-label">Evidencia · comparación visual</h2>

      <div className="cd-ev">
        <Slot
          titulo="Ingreso"
          slot={ingreso}
          esperando={!ingreso}
          destacado={!ingreso}
          placeholder="Esperando la foto de ingreso"
        />
        <Slot
          titulo="Egreso"
          slot={egreso}
          esperando={Boolean(ingreso)}
          destacado={Boolean(ingreso) && !egreso}
          placeholder={ingreso ? "Esperando la foto de egreso" : "Se habilita al preparar el despacho"}
        />
      </div>

      {inspeccion && (
        <div className="cd-ev cd-mt-inspeccion">
          <Slot
            titulo="Inspección física"
            slot={inspeccion}
            esperando={false}
            destacado={false}
            placeholder=""
          />
        </div>
      )}
    </section>
  );
}
