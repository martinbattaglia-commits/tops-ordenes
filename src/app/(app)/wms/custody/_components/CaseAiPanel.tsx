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
 * NOTA (C4 · R-6) · La frase de cara al operario «según los estándares
 * internacionales de medición del mercado» es redacción de Dirección aprobada
 * bajo D-4, y NO contradice lo anterior: refiere a esos mismos estándares de
 * EXPRESIÓN de la medición —veredicto cualitativo, sin corte numérico—, no a
 * una norma que fije un umbral. El fundamento del corte sigue siendo la
 * política interna, y el corte sigue sin salir a pantalla.
 *
 * La garantía no depende de este archivo: `thresholdPercent` NO EXISTE en el
 * view-model, así que no hay nada que renderizar aunque alguien lo intente.
 *
 * ─── LOS CUATRO COMPONENTES SE LLAMAN COMO LO QUE SE MIDIÓ ────────────────
 *
 * El contrato del proveedor dice, textual: «Score identity, packaging,
 * quantity, and condition independently from 0 to 100». Las cuatro tarjetas
 * llevan ESOS nombres. Rotular `quantity` como «Textura» —como estaba— hace
 * que la pantalla declare medida una dimensión que nadie midió, y en un
 * expediente probatorio eso no es un detalle de diseño: es afirmar un hecho
 * falso sobre la evidencia.
 *
 * ─── LO QUE ESTABA BIEN Y NO SE TOCA ─────────────────────────────────────
 *
 * El rótulo «confianza informada» sobre `modelConfidence` es correcto:
 * autoconfianza del modelo NO es similitud, y llamarla así sería exactamente
 * la confusión que I3 prohíbe. Se conserva tal cual.
 */

const COMPONENTES = [
  ["Identidad", "identity"],
  ["Embalaje", "packaging"],
  ["Cantidad", "quantity"],
  ["Condición", "condition"],
] as const;

export function CaseAiPanel({ view }: { view: CustodyCaseView }) {
  const ai = view.ai;
  const concordancia = ai.concordance ?? null;
  const componentes = ai.scoreComponents ?? null;
  const flags = ai.damageFlags ?? null;
  const score = typeof ai.similarityScore === "number" ? ai.similarityScore : null;

  const tono = concordancia?.tone ?? "warn";
  const numeroCls =
    tono === "ok" ? "cd-scorenum cd-scorenum--ok"
      : tono === "danger" ? "cd-scorenum cd-scorenum--bad"
        : "cd-scorenum cd-scorenum--warn";
  const rellenoCls = tono === "ok" ? "cd-track__fill cd-track__fill--ok" : "cd-track__fill cd-track__fill--bad";
  const veredictoCls =
    tono === "ok" ? "cd-verdict cd-verdict--ok"
      : tono === "danger" ? "cd-verdict cd-verdict--bad"
        : "cd-verdict cd-verdict--warn";

  return (
    <section className="cd-sec" aria-labelledby="ia-title">
      <h2 id="ia-title" className="cd-label">Análisis visual · concordancia</h2>

      {ai.executed ? (
        <>
          {/* ── CONCORDANCIA + VEREDICTO CUALITATIVO ───────────────────── */}
          <div className="cd-score">
            {score !== null && (
              <div>
                <p className={numeroCls} data-concordancia={score}>
                  {score.toLocaleString("es-AR", { maximumFractionDigits: 1 })}
                  <small>%</small>
                </p>
                <p className="cd-scorecap">concordancia</p>
              </div>
            )}

            {/* Barra SIN marca de umbral. Muestra la concordancia y nada más:
                dibujar el corte encima es exactamente lo prohibido. */}
            {score !== null && (
              <div className="cd-trackwrap">
                <div
                  className="cd-track"
                  role="img"
                  aria-label={`Concordancia ${score} por ciento`}
                >
                  <i
                    className={rellenoCls}
                    style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                  />
                </div>
                <div className="cd-scale"><span>0%</span><span>100%</span></div>
              </div>
            )}

            {concordancia && (
              <span className={veredictoCls} data-veredicto={concordancia.verdict}>
                {concordancia.label}
              </span>
            )}
          </div>

          {concordancia && <p className="cd-help">{concordancia.requirement}</p>}

          {/* ── COMPONENTES DEL SCORE ──────────────────────────────────── */}
          {/* F2-4 · sin corte de color inventado: la versión anterior pintaba
              en rojo los componentes bajo 80, un número que NINGUNA política
              define — un cuasi-umbral de UI que le enseñaba al ojo un corte
              inexistente. Los cuatro valores se muestran parejos; el juicio
              sobre ellos es del veredicto, no de un color. */}
          {componentes && (
            <dl className="cd-metrics" data-componentes="true">
              {COMPONENTES.map(([label, clave]) => (
                <div key={label} className="cd-metric">
                  <dt><span>{label}</span></dt>
                  <dd><b>{componentes[clave]}%</b></dd>
                </div>
              ))}
            </dl>
          )}

          {/* ── BANDERAS DE DAÑO ───────────────────────────────────────── */}
          {flags && (
            <ul className="cd-flags" data-banderas="true">
              {(
                [
                  ["Embalaje alterado", flags.packagingChanged],
                  ["Faltante posible", flags.missingItemsSuspected],
                  ["Daño visible", flags.damageSuspected],
                ] as ReadonlyArray<readonly [string, boolean]>
              ).map(([label, activa]) => (
                <li key={label} data-activa={activa} className={activa ? "cd-flag cd-flag--on" : "cd-flag"}>
                  {activa ? `⚠ ${label}` : `${label} · no`}
                </li>
              ))}
            </ul>
          )}

          {/* ── OBSERVACIONES Y ZONAS ──────────────────────────────────── */}
          {(ai.observations?.length ?? 0) > 0 && (
            <p className="cd-obs">
              <b>Observaciones del análisis:</b> {ai.observations!.join(" · ")}.
              {(ai.zones?.length ?? 0) > 0 ? ` Zonas señaladas: ${ai.zones!.join(" · ")}.` : null}
            </p>
          )}
        </>
      ) : (
        <p className="cd-help">{ai.failureLabel ?? "El análisis todavía no se ejecutó"}</p>
      )}

      <p className="cd-note">
        <Icon name="bolt" size={13} aria-hidden="true" />
        <span>{ai.note}</span>
      </p>

      {/* Procedencia. Un score coseno cambia de significado si cambia el
          modelo: sin versionar, el documento probatorio no es reproducible
          (I3). El NÚMERO de la política va; su VALOR no. */}
      {ai.executed && (ai.model || ai.thresholdPolicyVersion || ai.evaluatedAt) && (
        <p className="cd-prov" data-procedencia="true">
          {ai.model ? `modelo ${ai.model}` : null}
          {ai.thresholdPolicyVersion ? ` · política ${ai.thresholdPolicyVersion}` : null}
          {ai.evaluatedAt ? ` · evaluado ${fmtDateTime(ai.evaluatedAt)}` : null}
          {ai.confidencePercent !== null ? ` · ${ai.confidencePercent}% confianza informada` : null}
        </p>
      )}

      {view.holdLabels.length > 0 && (
        <ul className="cd-flags">
          {view.holdLabels.map((h) => <li key={h} className="cd-flag cd-flag--on">{h}</li>)}
        </ul>
      )}
    </section>
  );
}
