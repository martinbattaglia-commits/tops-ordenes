import { Icon } from "@/components/Icon";
import { fmtDateTime } from "@/lib/utils";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

/**
 * ANÁLISIS DE LA COMPARACIÓN — panel INFORMATIVO.
 *
 * No tiene un solo control. Es deliberado: la IA alerta, la persona decide, y
 * la forma más barata de garantizarlo es que este componente no pueda disparar
 * nada (I1).
 *
 * ─── LO QUE SE MUESTRA Y LO QUE NO (I3 · regla de borrado) ────────────────
 *
 * SE MUESTRA el porcentaje de CONCORDANCIA, el veredicto cualitativo de tres
 * categorías, los cuatro componentes del score, las tres banderas de daño, las
 * observaciones y zonas del análisis, y la procedencia (modelo, versión de
 * política, fecha).
 *
 * NO SE MUESTRA el umbral, en ninguna forma: ni rotulado, ni como marca sobre
 * la barra, ni en una expresión de la forma «X % ≥ Y %». No existe norma que
 * fije un umbral porcentual de similitud de imágenes, y la única que regula
 * esta comparación (OSAC 2022-S-0001 / NIST) prohíbe expresar el resultado
 * como valor numérico de certeza. Un número que TOPS no puede defender ante un
 * perito no va impreso en un documento probatorio.
 *
 * La garantía no depende de este archivo: `thresholdPercent` NO EXISTE en el
 * view-model, así que no hay nada que renderizar aunque alguien lo intente.
 *
 * ─── LO QUE ESTABA BIEN Y NO SE TOCA ─────────────────────────────────────
 *
 * El rótulo «confianza informada» sobre `modelConfidence` es correcto:
 * autoconfianza del modelo NO es similitud, y llamarla así sería exactamente
 * la confusión que I3 prohíbe. Se conserva tal cual.
 */
export function CaseAiPanel({ view }: { view: CustodyCaseView }) {
  const ai = view.ai;
  const concordancia = ai.concordance ?? null;
  const componentes = ai.scoreComponents ?? null;
  const flags = ai.damageFlags ?? null;
  const score = typeof ai.similarityScore === "number" ? ai.similarityScore : null;

  const tono =
    concordancia?.tone === "ok"
      ? "text-status-success"
      : concordancia?.tone === "danger"
        ? "text-status-danger"
        : "text-status-warning";

  return (
    <section className="card p-4" aria-labelledby="ia-title">
      <h2 id="ia-title" className="eyebrow-tiny">Análisis de la comparación</h2>

      {ai.executed ? (
        <div className="mt-3">
          {/* ── CONCORDANCIA + VEREDICTO CUALITATIVO ───────────────────── */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {score !== null && (
              <p className="text-4xl font-bold leading-none tabular-nums" data-concordancia={score}>
                {score.toLocaleString("es-AR", { maximumFractionDigits: 1 })}
                <span className="ml-1 text-lg">%</span>
                <span className="ml-2 align-middle text-xs font-normal text-fg-muted">
                  concordancia
                </span>
              </p>
            )}
            {concordancia && (
              <p className={`text-sm font-semibold ${tono}`} data-veredicto={concordancia.verdict}>
                {concordancia.label}
              </p>
            )}
          </div>

          {/* Barra SIN marca de umbral. La barra muestra la concordancia y
              nada más: dibujar el umbral encima es exactamente lo prohibido. */}
          {score !== null && (
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded bg-bg-surface-alt"
              role="img"
              aria-label={`Concordancia ${score} por ciento`}
            >
              <div
                className={
                  concordancia?.tone === "ok"
                    ? "h-full bg-status-success"
                    : concordancia?.tone === "danger"
                      ? "h-full bg-status-danger"
                      : "h-full bg-status-warning"
                }
                style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
              />
            </div>
          )}

          {concordancia && (
            <p className="mt-2 text-xs text-fg-muted">{concordancia.requirement}</p>
          )}

          {ai.confidencePercent !== null && (
            <p className="mt-2 text-xs text-fg-muted">
              {ai.confidencePercent}% confianza informada
              {ai.verdictLabel ? ` · ${ai.verdictLabel}` : ""}
            </p>
          )}

          {/* ── COMPONENTES DEL SCORE ──────────────────────────────────── */}
          {componentes && (
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-componentes="true">
              {(
                [
                  ["Estructura", componentes.identity],
                  ["Color", componentes.packaging],
                  ["Textura", componentes.quantity],
                  ["Contorno", componentes.condition],
                ] as ReadonlyArray<readonly [string, number]>
              ).map(([label, valor]) => (
                <div key={label} className="rounded border border-stroke-soft p-2">
                  <dt className="eyebrow-tiny">{label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{valor}%</dd>
                </div>
              ))}
            </dl>
          )}

          {/* ── BANDERAS DE DAÑO ───────────────────────────────────────── */}
          {flags && (
            <ul className="mt-3 flex flex-wrap gap-2" data-banderas="true">
              {(
                [
                  ["Embalaje alterado", flags.packagingChanged],
                  ["Faltante posible", flags.missingItemsSuspected],
                  ["Daño visible", flags.damageSuspected],
                ] as ReadonlyArray<readonly [string, boolean]>
              ).map(([label, activa]) => (
                <li
                  key={label}
                  data-activa={activa}
                  className={
                    activa
                      ? "flex items-center gap-1 rounded border border-status-danger px-2 py-1 text-xs font-medium text-status-danger"
                      : "rounded border border-stroke-soft px-2 py-1 text-xs text-fg-muted"
                  }
                >
                  {activa && <Icon name="bolt" size={11} aria-hidden="true" />}
                  {label}
                  {!activa && " · no"}
                </li>
              ))}
            </ul>
          )}

          {/* ── OBSERVACIONES Y ZONAS ────────────────────────────────────
              Sin modificador de opacidad sobre los tokens: en este sistema los
              colores son variables CSS y `token/60` se degrada en silencio a
              un gris fijo que además rompe el modo oscuro.                  */}
          {(ai.observations?.length ?? 0) > 0 && (
            <div className="mt-3 rounded border border-stroke-soft bg-bg-surface-alt p-2">
              <p className="text-xs">
                <span className="font-medium">Observaciones del análisis:</span>{" "}
                {ai.observations!.join(" · ")}
              </p>
              {(ai.zones?.length ?? 0) > 0 && (
                <p className="mt-1 text-xs text-fg-muted">
                  Zonas señaladas: {ai.zones!.join(" · ")}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">
          {ai.failureLabel ?? "El análisis todavía no se ejecutó"}
        </p>
      )}

      <p className="mt-3 flex items-center gap-2 text-xs text-status-warning">
        <Icon name="bolt" size={12} aria-hidden="true" />
        <span>{ai.note}</span>
      </p>

      {/* Procedencia. Un score coseno cambia de significado si cambia el
          modelo: sin versionar, el documento probatorio no es reproducible
          (I3). El NÚMERO de la política va; su VALOR no. */}
      {ai.executed && (ai.model || ai.thresholdPolicyVersion || ai.evaluatedAt) && (
        <p className="mt-1 font-mono text-[11px] text-fg-muted" data-procedencia="true">
          {ai.model ? `modelo ${ai.model}` : null}
          {ai.thresholdPolicyVersion ? ` · política ${ai.thresholdPolicyVersion}` : null}
          {ai.evaluatedAt ? ` · evaluado ${fmtDateTime(ai.evaluatedAt)}` : null}
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
