"use client";

import { useCallback, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { decideCustodyCaseAction } from "../actions";
import { createSingleFlightGuard } from "@/lib/custody/single-flight";
import { MIN_REASON_LENGTH } from "@/lib/custody/integrity";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

/**
 * Panel de DECISIÓN DEL INSPECTOR.
 *
 * Lo que este componente NO hace, a propósito:
 *   · no calcula si se puede liberar —eso llega resuelto desde el servidor—;
 *   · no muestra bucket, path, digest, token ni sesión: el view-model no los
 *     tiene;
 *   · no reintenta: si la versión del caso cambió, se pide recargar.
 */
export function CaseDecisionPanel({
  view,
  onDecided,
}: {
  view: CustodyCaseView;
  onDecided?: (next: CustodyCaseView) => void;
}) {
  const [reason, setReason] = useState("");
  const [observations, setObservations] = useState("");
  const [error, setError] = useState<string | null>(null);
  /**
   * Estado de envío EXPLÍCITO.
   *
   * No se usa `isPending` de `useTransition`: en React 18 no cubre el trabajo
   * asíncrono de dentro del callback, así que el botón quedaba habilitado
   * mientras la decisión viajaba. Lo detectó la prueba DOM real, y esconderlo
   * con un `disabled` cosmético habría sido peor que no tenerlo.
   */
  const [submitting, setSubmitting] = useState(false);
  const guard = useMemo(() => createSingleFlightGuard(), []);

  // El override de un caso retenido exige el motivo reforzado que pide la RPC;
  // el resto conserva el mínimo de siempre. Se toma del view-model para no
  // duplicar acá la regla del dominio.
  const minReason = view.release.minReasonLength ?? MIN_REASON_LENGTH;
  const overrides = view.release.overrideReasons ?? [];
  const reasonOk = reason.trim().length >= minReason;
  const decided = view.decision !== null;

  const decide = useCallback(
    async (decision: "release" | "quarantine") => {
      setError(null);
      setSubmitting(true);
      try {
        // Doble clic: la segunda invocación se descarta acá y, si igual saliera,
        // el CAS de versión la rechaza en la base.
        const res = await guard.run(`${view.caseId}:${decision}`, () =>
          decideCustodyCaseAction({
            caseId: view.caseId,
            expectedVersion: view.version,
            decision,
            reason,
            observations: observations || null,
          }),
        );
        if (!res) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (res.data) onDecided?.(res.data);
      } finally {
        setSubmitting(false);
      }
    },
    [guard, observations, onDecided, reason, view.caseId, view.version],
  );

  if (decided) {
    return (
      <section className="card p-4" aria-labelledby="decision-title">
        <h2 id="decision-title" className="eyebrow-tiny">Decisión del inspector</h2>
        <p className="mt-2 text-sm font-semibold">{view.decision!.label}</p>
        <dl className="mt-2 text-xs text-fg-muted">
          <div className="flex gap-2"><dt>Rol:</dt><dd>{view.decision!.actorRole}</dd></div>
          <div className="flex gap-2"><dt>Fecha:</dt><dd>{view.decision!.decidedAt}</dd></div>
          <div className="flex gap-2"><dt>Motivo:</dt><dd>{view.decision!.reason}</dd></div>
        </dl>
      </section>
    );
  }

  return (
    <section className="card p-4" aria-labelledby="decision-title">
      <h2 id="decision-title" className="eyebrow-tiny">Decisión del inspector</h2>

      <div className="mt-3">
        <label htmlFor="decision-reason" className="text-xs font-medium">
          Motivo <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="decision-reason"
          className="input mt-1 w-full"
          rows={2}
          value={reason}
          required
          aria-required="true"
          aria-describedby="decision-reason-help"
          onChange={(e) => setReason(e.target.value)}
        />
        <p id="decision-reason-help" className="mt-1 text-xs text-fg-muted">
          Obligatorio · mínimo {minReason} caracteres.
        </p>
      </div>

      <div className="mt-3">
        <label htmlFor="decision-observations" className="text-xs font-medium">
          Observaciones
        </label>
        <textarea
          id="decision-observations"
          className="input mt-1 w-full"
          rows={2}
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
        />
      </div>

      {submitting && (
        <p role="status" aria-live="polite" className="mt-3 text-xs text-fg-muted">
          Registrando la decisión…
        </p>
      )}

      {error !== null && (
        <p role="alert" className="mt-3 text-xs text-status-danger">{error}</p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!view.release.enabled || !reasonOk || submitting}
          aria-disabled={!view.release.enabled || !reasonOk || submitting}
          onClick={() => { void decide("release"); }}
        >
          <Icon name="shield" size={14} /> Liberar para despacho
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={!view.quarantine.enabled || !reasonOk || submitting}
          aria-disabled={!view.quarantine.enabled || !reasonOk || submitting}
          onClick={() => { void decide("quarantine"); }}
        >
          <Icon name="bolt" size={14} /> Enviar a cuarentena
        </button>
      </div>

      {overrides.length > 0 && (
        <div className="mt-3 rounded border border-status-warning/40 p-2" data-override="true">
          <p className="text-xs font-medium text-status-warning">
            Liberar acá es un override humano
          </p>
          <ul className="mt-1 list-disc pl-4 text-xs text-fg-muted">
            {overrides.map((o) => <li key={o}>{o}</li>)}
          </ul>
          <p className="mt-1 text-xs text-fg-muted">
            Queda registrado como tal en el certificado, con tu rol y tu motivo.
          </p>
        </div>
      )}

      {view.release.blockers.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow-tiny">Por qué no se puede liberar</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-fg-muted">
            {view.release.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
