import { Icon } from "@/components/Icon";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

/**
 * ANÁLISIS VISUAL IA — panel INFORMATIVO.
 *
 * No tiene un solo control. Es deliberado: la IA alerta, la persona decide, y
 * la forma más barata de garantizarlo es que este componente no pueda disparar
 * nada. Tampoco muestra un umbral inventado: si el servidor no informa una
 * configuración aprobada, no se dibuja ningún porcentaje de referencia.
 */
export function CaseAiPanel({ view }: { view: CustodyCaseView }) {
  return (
    <section className="card p-4" aria-labelledby="ia-title">
      <h2 id="ia-title" className="eyebrow-tiny">Análisis visual IA</h2>

      {view.ai.executed ? (
        <div className="mt-2">
          {view.ai.confidencePercent !== null && (
            <p className="text-3xl font-bold leading-none">
              {view.ai.confidencePercent}%
              <span className="ml-2 align-middle text-xs font-normal text-fg-muted">
                confianza informada
              </span>
            </p>
          )}
          {view.ai.verdictLabel && (
            <p className="mt-1 text-sm font-medium">{view.ai.verdictLabel}</p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">
          {view.ai.failureLabel ?? "El análisis todavía no se ejecutó"}
        </p>
      )}

      <p className="mt-3 flex items-center gap-2 text-xs text-status-warning">
        <Icon name="bolt" size={12} aria-hidden="true" />
        <span>Revisión humana obligatoria. {view.ai.note}</span>
      </p>

      {view.referenceThreshold !== null && (
        <p className="mt-2 text-xs text-fg-muted">
          Referencia operativa {view.referenceThreshold.percent}%
          {view.referenceThreshold.approved ? " · aprobada" : " · por aprobar"}
          {" · no es criterio de liberación automática"}
        </p>
      )}

      {view.holdLabels.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow-tiny">Retenciones registradas</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-fg-muted">
            {view.holdLabels.map((h) => <li key={h}>{h}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
