"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { createSingleFlightGuard } from "@/lib/custody/single-flight";
import { registerDispatchEgressAction } from "../actions";
import type { DispatchEgressUnit } from "@/lib/custody/dispatch-egress";

/**
 * FOTO DE EGRESO EN LA PANTALLA DE DESPACHO · 2-C-1.
 *
 * ─── DÓNDE ESTÁ Y POR QUÉ ────────────────────────────────────────────────
 *
 * Inmediatamente ARRIBA de las acciones de despacho, porque la Adenda pide la
 * foto entre el packing y el despacho —bulto cerrado, bien todavía en el
 * depósito— y `confirmDispatchAction` es la salida real. El operario ve qué le
 * falta ANTES de apretar Despachar; el rechazo del trigger de 0253 es la red,
 * no la interfaz.
 *
 * ─── ESTE COMPONENTE NO SE RENDERIZA PARA EL NIVEL 1 ─────────────────────
 *
 * Y no por una condición interna: el servidor decide. `getDispatchEgressGate`
 * devuelve `applies: false` cuando el pedido no tiene ninguna unidad de nivel 2,
 * y la página entonces no monta nada. No hay panel, ni aviso, ni botón apagado:
 * la pantalla de un despacho de nivel 1 queda idéntica a como estaba. Poner acá
 * un `if (level < 2) return null` habría dejado el componente en el árbol y es
 * justamente lo que el bloque prohíbe.
 *
 * Se reusa el patrón de `PhysicalCapturePanel` de 2-A —un input por slot,
 * `capture="environment"`, guard de un solo vuelo, el motivo del bloqueo en su
 * propio contexto— sin reusar el componente: aquél se construye sobre
 * `CustodyCaseView`, que es la vista del caso, y acá no hay caso a mano sino
 * una unidad por despachar.
 */
export function DispatchEgressPanel({
  orderId,
  units,
  allAllowed,
}: {
  orderId: string;
  units: DispatchEgressUnit[];
  allAllowed: boolean;
}) {
  const [archivos, setArchivos] = useState<Record<string, File | null>>({});
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const guard = useMemo(() => createSingleFlightGuard(), []);

  const registrar = useCallback(
    async (unitId: string) => {
      const file = archivos[unitId];
      if (!file) {
        setErrores((e) => ({ ...e, [unitId]: "Elegí la fotografía de egreso" }));
        return;
      }
      setErrores((e) => {
        const n = { ...e };
        delete n[unitId];
        return n;
      });
      setEnCurso(unitId);
      try {
        const form = new FormData();
        form.set("file", file);
        form.set("entity_id", unitId);
        const res = await guard.run(`egreso:${unitId}`, () =>
          registerDispatchEgressAction(orderId, form),
        );
        if (!res) return;
        if (!res.ok) {
          setErrores((e) => ({ ...e, [unitId]: res.error }));
          return;
        }
        setArchivos((a) => ({ ...a, [unitId]: null }));
        const el = inputs.current[unitId];
        if (el) el.value = "";
      } catch {
        setErrores((e) => ({ ...e, [unitId]: "No se pudo registrar la fotografía" }));
      } finally {
        setEnCurso(null);
      }
    },
    [archivos, guard, orderId],
  );

  return (
    <section
      className="nx-surface card card-pad mb-4"
      aria-labelledby="egreso-title"
      data-egress-panel="true"
    >
      <h2 id="egreso-title" className="eyebrow-tiny flex items-center gap-1.5">
        <Icon name="shield" size={12} /> Custodia digital · fotografía de egreso
      </h2>

      <p className="mt-2 text-xs text-fg-muted">
        {allAllowed
          ? "Las unidades bajo custodia están en condiciones de salir."
          : "Sacá la fotografía de cada unidad antes de subirla al transporte."}
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {units.map((u) => {
          const enVuelo = enCurso === u.physicalUnitId;
          const error = errores[u.physicalUnitId];
          return (
            <div
              key={u.physicalUnitId}
              className="border-t border-stroke-soft pt-3 first:border-t-0 first:pt-0"
              data-unit={u.unitPublicId}
              data-dispatch-allowed={u.dispatchAllowed}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono text-xs font-semibold">{u.unitPublicId}</span>
                <span className="text-[11px] text-fg-secondary font-mono">{u.sku}</span>
              </div>

              <ul className="mt-2 space-y-1 text-xs">
                <li className="flex items-center gap-2" data-slot="ingreso" data-presente={u.hasIngressPhoto}>
                  <Icon name={u.hasIngressPhoto ? "check-circle" : "clock"} size={12} aria-hidden="true" />
                  <span className={u.hasIngressPhoto ? "text-status-success" : "text-fg-muted"}>
                    {u.hasIngressPhoto ? "Foto de ingreso registrada" : "Foto de ingreso pendiente"}
                  </span>
                </li>
                <li className="flex items-center gap-2" data-slot="egreso" data-presente={u.hasEgressPhoto}>
                  <Icon name={u.hasEgressPhoto ? "check-circle" : "clock"} size={12} aria-hidden="true" />
                  <span className={u.hasEgressPhoto ? "text-status-success" : "text-fg-muted"}>
                    {u.hasEgressPhoto ? "Foto de egreso registrada" : "Foto de egreso pendiente (obligatoria)"}
                  </span>
                </li>
              </ul>

              {/* Lo que falta, ya traducido a qué hacer por `blocker-guidance`. */}
              {u.blockers.length > 0 && (
                <ul className="mt-2 space-y-1" data-blockers="true">
                  {u.blockers.map((b) => (
                    <li key={b} className="text-xs text-status-warning flex items-start gap-1.5">
                      <Icon name="lock" size={11} aria-hidden="true" /> <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}

              {!u.hasEgressPhoto && (
                <div className="mt-3" data-slot-form="egreso">
                  <label htmlFor={`egreso-${u.physicalUnitId}`} className="text-xs font-medium">
                    Fotografía de egreso <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id={`egreso-${u.physicalUnitId}`}
                    ref={(el) => {
                      inputs.current[u.physicalUnitId] = el;
                    }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="input mt-1 w-full"
                    aria-describedby={`egreso-help-${u.physicalUnitId}`}
                    disabled={enVuelo}
                    onChange={(e) => {
                      setArchivos((a) => ({ ...a, [u.physicalUnitId]: e.target.files?.[0] ?? null }));
                      setErrores((x) => {
                        const n = { ...x };
                        delete n[u.physicalUnitId];
                        return n;
                      });
                    }}
                  />
                  <p id={`egreso-help-${u.physicalUnitId}`} className="mt-1 text-xs text-fg-muted">
                    Repetí los <strong>mismos ángulos</strong> de la foto de ingreso. Buena luz y foco.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm mt-2"
                    disabled={enVuelo || !archivos[u.physicalUnitId]}
                    aria-disabled={enVuelo || !archivos[u.physicalUnitId]}
                    aria-busy={enVuelo}
                    onClick={() => {
                      void registrar(u.physicalUnitId);
                    }}
                  >
                    <Icon name="paperclip" size={12} /> Registrar egreso
                  </button>
                </div>
              )}

              {enVuelo && (
                <p role="status" aria-live="polite" className="mt-2 text-xs text-fg-muted">
                  Subiendo y verificando la fotografía…
                </p>
              )}
              {error && (
                <p role="alert" className="mt-2 text-xs text-status-danger">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
