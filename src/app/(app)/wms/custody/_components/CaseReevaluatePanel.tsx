"use client";

import { useCallback, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { reevaluateCustodyCaseAction } from "../actions";
import { createSingleFlightGuard } from "@/lib/custody/single-flight";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

export type ReevaluationUiState = "pendiente" | "evaluando" | "evaluado" | "fallo";

/**
 * Panel de RE-EVALUACIÓN.
 *
 * Existe porque registrar la foto de inspección humana agrega un eslabón a la
 * cadena y deja vieja la atestación del análisis: sin este camino, el inspector
 * veía «volvé a evaluar» y no tenía cómo hacerlo.
 *
 * Igual que el panel de decisión, no calcula nada: el servidor dice si se puede
 * y por qué no. Y no libera ni cuarentena: sólo vuelve a pedir el análisis.
 */
export function CaseReevaluatePanel({
  view,
  onEvaluated,
}: {
  view: CustodyCaseView;
  onEvaluated?: (next: CustodyCaseView) => void;
}) {
  const [estado, setEstado] = useState<ReevaluationUiState>("pendiente");
  const [error, setError] = useState<string | null>(null);
  const guard = useMemo(() => createSingleFlightGuard(), []);

  const reevaluar = useCallback(async () => {
    setError(null);
    setEstado("evaluando");
    try {
      // Doble clic: la segunda invocación se descarta acá, y del lado de la
      // base el lease del intento serializa lo que llegue igual.
      const res = await guard.run(`${view.caseId}:reevaluar`, () =>
        reevaluateCustodyCaseAction(view.caseId, view.version),
      );
      if (!res) return;
      if (!res.ok) {
        setError(res.error);
        setEstado("fallo");
        return;
      }
      setEstado("evaluado");
      if (res.data) onEvaluated?.(res.data);
    } catch {
      setError("No se pudo completar el análisis");
      setEstado("fallo");
    }
  }, [guard, onEvaluated, view.caseId, view.version]);

  if (view.decision !== null) return null;

  const enVuelo = estado === "evaluando";
  const deshabilitado = !view.reevaluation.enabled || enVuelo;

  return (
    <section className="card p-4" aria-labelledby="reeval-title">
      <h2 id="reeval-title" className="eyebrow-tiny">Análisis</h2>

      {view.reevaluation.required && (
        <p className="mt-2 flex items-start gap-2 text-xs text-status-warning" role="status">
          <Icon name="bolt" size={12} aria-hidden="true" />
          <span>{view.reevaluation.reason}</span>
        </p>
      )}

      <p
        className="mt-2 text-xs text-fg-muted"
        data-estado={estado}
        data-analisis={view.reevaluation.analysis}
      >
        {/* «Nunca se ejecutó» y «al día» NO son lo mismo: un caso sin ningún
            análisis anunciaba estar al día, que es justo lo contrario. */}
        {estado === "pendiente" && view.reevaluation.analysis === "stale" &&
          "Requiere volver a evaluar"}
        {estado === "pendiente" && view.reevaluation.analysis === "never" &&
          "El análisis todavía no se ejecutó"}
        {estado === "pendiente" && view.reevaluation.analysis === "current" &&
          "Análisis al día"}
        {estado === "evaluando" && "Evaluando…"}
        {estado === "evaluado" && "Evaluado: revisá el resultado antes de decidir"}
        {estado === "fallo" && "El análisis falló"}
      </p>

      {error !== null && (
        <p role="alert" className="mt-2 text-xs text-status-danger">{error}</p>
      )}

      <button
        type="button"
        className="btn btn-ghost mt-3"
        disabled={deshabilitado}
        aria-disabled={deshabilitado}
        aria-busy={enVuelo}
        onClick={() => { void reevaluar(); }}
      >
        <Icon name="refresh" size={14} /> Volver a evaluar
      </button>

      {view.reevaluation.blockers.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-xs text-fg-muted">
          {view.reevaluation.blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
      )}
    </section>
  );
}
