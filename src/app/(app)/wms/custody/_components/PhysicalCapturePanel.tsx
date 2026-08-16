"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { registerPhysicalIngressAction, registerPhysicalEgressAction } from "../actions";
import { createSingleFlightGuard } from "@/lib/custody/single-flight";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

export type CapturaUiState = "pendiente" | "subiendo" | "registrada" | "fallo";

/**
 * Panel de CAPTURA FÍSICA — foto de ingreso y foto de egreso (Adenda N.º 2 §4.2).
 *
 * Faltaba, y su ausencia era un bloqueo total: 0250a materializa un caso
 * obligatorio por cada ítem recibido, en `PENDING_EVIDENCE` con
 * `EVIDENCE_MISSING`. Sin una pantalla que registre las dos fotos, ese caso no
 * podía cerrarse nunca y los gates de despacho y POD quedaban disparados de
 * forma permanente. La página de detalle mandaba al operario a escanear el QR,
 * que es una vista de sólo lectura.
 *
 * Lo que este componente NO decide:
 *   · la etapa, el tipo de evento, el soporte y el scope los fija el SERVIDOR
 *     (`registerPhysicalIngressAction` / `registerPhysicalEgressAction`);
 *   · el actor, la sesión, el tenant, el digest y el instante los deriva el
 *     servidor a partir de la sesión, no del formulario;
 *   · si la foto es admisible lo dicen la atestación y la evaluación, no esta
 *     pantalla.
 */
export function PhysicalCapturePanel({
  view,
  tieneIngreso,
  tieneEgreso,
  onRegistrada,
}: {
  view: CustodyCaseView;
  tieneIngreso: boolean;
  tieneEgreso: boolean;
  onRegistrada?: () => void;
}) {
  const [estado, setEstado] = useState<CapturaUiState>("pendiente");
  const [error, setError] = useState<string | null>(null);
  /**
   * §7.5 · UN INPUT POR SLOT DE EVIDENCIA.
   *
   * Antes había UN solo `<input type="file">` compartido por los dos botones:
   * el operario elegía una foto y podía registrarla como ingreso o como egreso
   * indistintamente. En una cadena inmutable, registrar el ingreso como egreso
   * es irreversible. Dos estados y dos inputs separados eliminan la
   * posibilidad, no la advierten.
   */
  const [archivoIngreso, setArchivoIngreso] = useState<File | null>(null);
  const [archivoEgreso, setArchivoEgreso] = useState<File | null>(null);
  const [enCurso, setEnCurso] = useState<"ingreso" | "egreso" | null>(null);
  const inputIngresoRef = useRef<HTMLInputElement | null>(null);
  const inputEgresoRef = useRef<HTMLInputElement | null>(null);
  const guard = useMemo(() => createSingleFlightGuard(), []);

  /**
   * Los estados de compensación llegan como etiquetas cortas. Se traducen a lo
   * que el operario tiene que HACER; no se muestra bucket, ruta ni digest.
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

  const registrar = useCallback(
    async (tipo: "ingreso" | "egreso") => {
      const file = tipo === "ingreso" ? archivoIngreso : archivoEgreso;
      if (!file) {
        setError(`Elegí la fotografía de ${tipo}`);
        setEstado("fallo");
        return;
      }
      setError(null);
      setEstado("subiendo");
      setEnCurso(tipo);
      try {
        const form = new FormData();
        // Sólo el archivo y a qué unidad pertenece.
        form.set("file", file);
        form.set("entity_id", view.entityId);
        form.set("revalidate", `/wms/custody/${view.caseId}`);

        const accion =
          tipo === "ingreso" ? registerPhysicalIngressAction : registerPhysicalEgressAction;
        const res = await guard.run(`${view.caseId}:${tipo}`, () => accion(form));
        if (!res) return;
        if (!res.ok) {
          setError(traducir(res.error));
          setEstado("fallo");
          return;
        }
        setEstado("registrada");
        if (tipo === "ingreso") {
          setArchivoIngreso(null);
          if (inputIngresoRef.current) inputIngresoRef.current.value = "";
        } else {
          setArchivoEgreso(null);
          if (inputEgresoRef.current) inputEgresoRef.current.value = "";
        }
        onRegistrada?.();
      } catch {
        setError("No se pudo registrar la fotografía");
        setEstado("fallo");
      } finally {
        setEnCurso(null);
        // S1-3 · El `finally` limpiaba `enCurso` pero NO `estado`, así que el
        // `return` temprano del guard de un solo vuelo dejaba `estado` en
        // «subiendo» y los dos botones muertos. Patrón de `CaseDecisionPanel`.
        setEstado((s) => (s === "subiendo" ? "pendiente" : s));
      }
    },
    [archivoIngreso, archivoEgreso, guard, onRegistrada, view.caseId, view.entityId],
  );

  // Sólo la unidad física tiene par ingreso/egreso; el resto de los scopes
  // conserva su propio camino de evidencia.
  if (view.scope !== "physical_unit") return null;
  if (view.decision !== null) return null;

  const enVuelo = estado === "subiendo";
  /**
   * S1-3 · HABILITACIÓN INVERTIDA.
   *
   * Antes esto era `view.inspection.enabled || !tieneIngreso || !tieneEgreso`:
   * una DISYUNCIÓN con la AUSENCIA de foto. Mientras faltara una, el permiso
   * nunca llegaba a evaluarse y cualquiera podía capturar; con las dos
   * cargadas el panel se apagaba solo y nadie podía repetir ninguna. Las dos
   * mitades estaban al revés.
   *
   * Ahora es una CONJUNCIÓN con el permiso, y además por SLOT: cada botón
   * exige poder capturar Y que ese slot concreto siga vacío.
   * `view.inspection.enabled` transporta el permiso de captura resuelto
   * server-side, que es la misma frontera que exige la RPC.
   */
  const puedeCapturar = view.inspection.enabled;

  return (
    <section className="card p-4" aria-labelledby="captura-fisica-title">
      <h2 id="captura-fisica-title" className="eyebrow-tiny">Fotografías de la unidad</h2>

      <p className="mt-2 text-xs text-fg-muted" data-estado={estado}>
        {estado === "pendiente" && !tieneIngreso &&
          "Sacá la fotografía de ingreso: queda ligada al QR de esta unidad"}
        {estado === "pendiente" && tieneIngreso && !tieneEgreso &&
          "Ingreso registrado. Falta la fotografía de egreso, que es obligatoria"}
        {estado === "pendiente" && tieneIngreso && tieneEgreso &&
          "Ingreso y egreso registrados: el caso ya puede evaluarse"}
        {estado === "subiendo" && "Registrando la fotografía…"}
        {estado === "registrada" && "Fotografía registrada y verificada por el servidor"}
        {estado === "fallo" && "No se registró la fotografía"}
      </p>

      <ul className="mt-2 space-y-1 text-xs">
        <li className="flex items-center gap-2" data-slot="ingreso" data-presente={tieneIngreso}>
          <Icon
            name={tieneIngreso ? "check-circle" : "clock"}
            size={12}
            aria-hidden="true"
          />
          <span className={tieneIngreso ? "text-status-success" : "text-fg-muted"}>
            {tieneIngreso ? "Foto de ingreso registrada" : "Foto de ingreso pendiente"}
          </span>
        </li>
        <li className="flex items-center gap-2" data-slot="egreso" data-presente={tieneEgreso}>
          <Icon
            name={tieneEgreso ? "check-circle" : "clock"}
            size={12}
            aria-hidden="true"
          />
          <span className={tieneEgreso ? "text-status-success" : "text-fg-muted"}>
            {tieneEgreso ? "Foto de egreso registrada" : "Foto de egreso pendiente (obligatoria)"}
          </span>
        </li>
      </ul>

      {error !== null && (
        <p role="alert" className="mt-2 text-xs text-status-danger">{error}</p>
      )}

      {enVuelo && (
        <p role="status" aria-live="polite" className="mt-2 text-xs text-fg-muted">
          Subiendo y verificando la fotografía…
        </p>
      )}

      {/* ── SLOT DE INGRESO ─────────────────────────────────────────────── */}
      <div className="mt-4" data-slot-form="ingreso">
        <label htmlFor="captura-foto-ingreso" className="text-xs font-medium">
          Fotografía de ingreso <span aria-hidden="true">*</span>
        </label>
        <input
          id="captura-foto-ingreso"
          ref={inputIngresoRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="input mt-1 w-full"
          aria-describedby="captura-ingreso-help"
          disabled={!puedeCapturar || tieneIngreso || enVuelo}
          onChange={(e) => {
            setArchivoIngreso(e.target.files?.[0] ?? null);
            if (estado !== "subiendo") setEstado("pendiente");
            setError(null);
          }}
        />
        <p id="captura-ingreso-help" className="mt-1 text-xs text-fg-muted">
          Fotografiá el embalaje <strong>antes</strong> de abrirlo. Buscá golpes, humedad o
          aperturas.
        </p>
        <button
          type="button"
          className="btn btn-primary mt-2"
          disabled={!puedeCapturar || tieneIngreso || enVuelo || archivoIngreso === null}
          aria-disabled={!puedeCapturar || tieneIngreso || enVuelo || archivoIngreso === null}
          aria-busy={enCurso === "ingreso"}
          onClick={() => { void registrar("ingreso"); }}
        >
          <Icon name="paperclip" size={14} /> Registrar ingreso
        </button>
        {/* Todo botón deshabilitado dice por qué EN SU PROPIO CONTEXTO (§7.5). */}
        {!puedeCapturar && (
          <p className="mt-1 text-xs text-fg-muted">No tenés permiso para registrar evidencia.</p>
        )}
        {puedeCapturar && tieneIngreso && (
          <p className="mt-1 text-xs text-fg-muted">Ya está registrada: no se puede repetir.</p>
        )}
      </div>

      {/* ── SLOT DE EGRESO ──────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-stroke-soft pt-4" data-slot-form="egreso">
        <label htmlFor="captura-foto-egreso" className="text-xs font-medium">
          Fotografía de egreso <span aria-hidden="true">*</span>
        </label>
        <input
          id="captura-foto-egreso"
          ref={inputEgresoRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="input mt-1 w-full"
          aria-describedby="captura-egreso-help"
          disabled={!puedeCapturar || tieneEgreso || enVuelo}
          onChange={(e) => {
            setArchivoEgreso(e.target.files?.[0] ?? null);
            if (estado !== "subiendo") setEstado("pendiente");
            setError(null);
          }}
        />
        <p id="captura-egreso-help" className="mt-1 text-xs text-fg-muted">
          Repetí los <strong>mismos ángulos</strong> de la foto de ingreso, que tenés al lado para
          comparar. Buena luz y foco. El análisis corre solo cuando la registres.
        </p>
        <button
          type="button"
          className="btn btn-primary mt-2"
          disabled={!puedeCapturar || tieneEgreso || enVuelo || archivoEgreso === null}
          aria-disabled={!puedeCapturar || tieneEgreso || enVuelo || archivoEgreso === null}
          aria-busy={enCurso === "egreso"}
          onClick={() => { void registrar("egreso"); }}
        >
          <Icon name="paperclip" size={14} /> Registrar egreso
        </button>
        {puedeCapturar && tieneEgreso && (
          <p className="mt-1 text-xs text-fg-muted">Ya está registrada: no se puede repetir.</p>
        )}
      </div>

      <p className="mt-3 text-xs text-fg-muted">
        JPEG, PNG o WebP. El servidor la relee, verifica su tipo real y recalcula el hash antes de
        aceptarla.
      </p>
    </section>
  );
}
