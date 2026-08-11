"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { registerHumanInspectionAction } from "../actions";
import { createSingleFlightGuard } from "@/lib/custody/single-flight";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

export type InspectionUiState = "pendiente" | "subiendo" | "registrada" | "fallo";

/**
 * Panel de INSPECCIÓN HUMANA (D1).
 *
 * Faltaba, y su ausencia rompía todo el final del flujo: la evidencia de
 * inspección es condición necesaria para liberar, así que sin una pantalla que
 * la registre ningún caso podía cerrarse. El botón de liberar mostraba «falta
 * la foto de inspección humana» sin ofrecer forma de sacarla.
 *
 * Lo que este componente NO decide:
 *   · la etapa, el tipo de evento y el soporte los fija el SERVIDOR
 *     (`registerHumanInspectionAction`): acá sólo viaja el archivo;
 *   · el actor, la sesión, el tenant, el digest y el instante los deriva el
 *     servidor; el formulario no tiene campos para ellos;
 *   · si la evidencia es admisible lo dice `custody_inspection_candidates`,
 *     no esta pantalla.
 */
export function CaseInspectionPanel({
  view,
  onRegistered,
}: {
  view: CustodyCaseView;
  onRegistered?: () => void;
}) {
  const [estado, setEstado] = useState<InspectionUiState>("pendiente");
  const [error, setError] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const guard = useMemo(() => createSingleFlightGuard(), []);

  /**
   * Los estados de compensación del pipeline de captura llegan como etiquetas
   * cortas. Se traducen a lo que el operario tiene que HACER; no se muestra el
   * bucket, la ruta ni el digest, que es de donde vienen esos estados.
   */
  const traducir = (raw: string): string => {
    if (raw === "reconciliation_required") {
      return "La foto se guardó pero no quedó registrada. No la vuelvas a sacar: avisá a soporte para que la reconcilien.";
    }
    if (raw === "cleanup_required") {
      return "La carga quedó incompleta y se está limpiando. Volvé a intentar en un momento.";
    }
    return raw;
  };

  const registrar = useCallback(async () => {
    const file = archivo;
    if (!file) {
      setError("Elegí la fotografía de la inspección");
      setEstado("fallo");
      return;
    }
    setError(null);
    setEstado("subiendo");
    try {
      const form = new FormData();
      // Sólo el archivo y a qué entidad pertenece. La etapa, el tipo de evento
      // y el soporte NO se envían: los impone el servidor.
      form.set("file", file);
      form.set("scope", view.scope);
      form.set("entity_id", view.entityId);
      form.set("revalidate", `/wms/custody/${view.caseId}`);

      const res = await guard.run(`${view.caseId}:inspeccion`, () =>
        registerHumanInspectionAction(form),
      );
      if (!res) return;
      if (!res.ok) {
        setError(traducir(res.error));
        setEstado("fallo");
        return;
      }
      setEstado("registrada");
      setArchivo(null);
      if (inputRef.current) inputRef.current.value = "";
      onRegistered?.();
    } catch {
      setError("No se pudo registrar la fotografía");
      setEstado("fallo");
    }
  }, [archivo, guard, onRegistered, view.caseId, view.entityId, view.scope]);

  if (view.decision !== null) return null;

  const enVuelo = estado === "subiendo";
  const deshabilitado = !view.inspection.enabled || enVuelo;

  return (
    <section className="card p-4" aria-labelledby="inspeccion-title">
      <h2 id="inspeccion-title" className="eyebrow-tiny">Inspección humana</h2>

      <p className="mt-2 text-xs text-fg-muted" data-estado={estado}>
        {/* Tres situaciones distintas, no dos. Registrar la foto adelanta la
            cadena y deja el análisis viejo, así que la evidencia existe pero
            todavía no es admisible. Decir «sacá la fotografía» ahí sería
            mandar al inspector a sacar una segunda foto que tampoco serviría. */}
        {estado === "pendiente" && view.inspection.eligible > 0 &&
          "Inspección registrada y admitida para decidir"}
        {estado === "pendiente" && view.inspection.eligible === 0 && view.reevaluation.required &&
          "Inspección registrada: volvé a evaluar el caso para que quede admitida"}
        {estado === "pendiente" && view.inspection.eligible === 0 && !view.reevaluation.required &&
          "Sacá la fotografía de la inspección física antes de decidir"}
        {estado === "subiendo" && "Registrando la fotografía…"}
        {estado === "registrada" &&
          "Fotografía registrada: la cadena avanzó, volvé a evaluar el caso"}
        {estado === "fallo" && "No se registró la fotografía"}
      </p>

      {view.inspection.eligible > 0 && (
        <p className="mt-1 flex items-center gap-2 text-xs text-status-success" data-eligible={view.inspection.eligible}>
          <Icon name="check-circle" size={12} aria-hidden="true" />
          <span>
            {view.inspection.eligible === 1
              ? "1 inspección admisible"
              : `${view.inspection.eligible} inspecciones admisibles`}
          </span>
        </p>
      )}

      {error !== null && (
        <p role="alert" className="mt-2 text-xs text-status-danger">{error}</p>
      )}

      {enVuelo && (
        <p role="status" aria-live="polite" className="mt-2 text-xs text-fg-muted">
          Subiendo y verificando la fotografía…
        </p>
      )}

      <div className="mt-3">
        <label htmlFor="inspeccion-foto" className="text-xs font-medium">
          Fotografía de la inspección <span aria-hidden="true">*</span>
        </label>
        <input
          id="inspeccion-foto"
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="input mt-1 w-full"
          required
          aria-required="true"
          aria-describedby="inspeccion-foto-help"
          disabled={deshabilitado}
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null);
            if (estado !== "subiendo") setEstado("pendiente");
            setError(null);
          }}
        />
        <p id="inspeccion-foto-help" className="mt-1 text-xs text-fg-muted">
          Una fotografía nueva de la unidad. Queda ligada a la cadena de custodia.
        </p>
      </div>

      <button
        type="button"
        className="btn btn-primary mt-3"
        disabled={deshabilitado || archivo === null}
        aria-disabled={deshabilitado || archivo === null}
        aria-busy={enVuelo}
        onClick={() => { void registrar(); }}
      >
        <Icon name="eye" size={14} /> Registrar inspección
      </button>

      {view.inspection.blockers.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-xs text-fg-muted">
          {view.inspection.blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
      )}
    </section>
  );
}
