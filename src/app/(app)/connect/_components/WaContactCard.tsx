"use client";

/**
 * Nexus Link · FASE B — Ficha «Información del contacto» de un hilo de WhatsApp.
 *
 * El componente NO resuelve el dato ni lo pide: lo recibe ya autorizado desde el
 * servidor (`read/wa-contact.ts`). Si el llamador no tenía la capacidad de canal,
 * la ruta no llegó a renderizarlo, así que acá no hay ninguna decisión de
 * seguridad que tomar — ni ninguna que se pueda equivocar.
 *
 * La ficha se abre en un panel lateral anclado al borde derecho de la VENTANA
 * —montado en `document.body` por portal, ver abajo— y ocupa el ancho completo
 * en pantallas angostas. Accesible por teclado: el disparador es un `button`
 * real, el panel es `role="dialog" aria-modal`, `Escape` lo cierra, `Tab` queda
 * atrapado adentro, y el foco entra al panel al abrirse y vuelve al disparador
 * al cerrarse.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";
import type { WaContactIdentity } from "@/lib/whatsapp/contact-identity";

const SIN_NUMERO = "Número no disponible";

/** Foco tabulable dentro del panel, en orden de documento. */
const FOCUSABLES = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function WaContactCard({ contacto }: { contacto: WaContactIdentity }) {
  const [abierto, setAbierto] = useState(false);
  const [copiado, setCopiado] = useState<"ok" | "error" | null>(null);
  const disparadorRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const cerrar = useCallback(() => {
    setAbierto(false);
    setCopiado(null);
    disparadorRef.current?.focus();
  }, []);

  useEffect(() => {
    if (abierto) panelRef.current?.focus();
  }, [abierto]);

  /**
   * El teclado se maneja EN el overlay, no en `document`.
   *
   * Un listener global de Escape colisiona con los que ya existen en la app
   * —la campanita de notificaciones tiene el suyo, también sobre `document`— y
   * `stopPropagation()` no lo evita: no detiene a los demás listeners del MISMO
   * nodo (haría falta `stopImmediatePropagation`) y en cambio sí corta los de
   * `window`, que es justo lo que no se quiere. Con el foco atrapado adentro,
   * el evento llega acá por burbujeo y nadie más lo ve.
   */
  const alTeclado = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.stopPropagation(); cerrar(); return; }
    if (e.key !== "Tab") return;
    // `aria-modal` promete que no se puede tabular fuera; sin trampa de foco
    // esa promesa es falsa y el Tab siguiente cae en la página de atrás.
    const focos = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLES) ?? [])];
    if (focos.length === 0) return;
    const primero = focos[0]!;
    const ultimo = focos[focos.length - 1]!;
    const activo = document.activeElement;
    if (e.shiftKey && (activo === primero || activo === panelRef.current)) {
      e.preventDefault(); ultimo.focus();
    } else if (!e.shiftKey && activo === ultimo) {
      e.preventDefault(); primero.focus();
    }
  }, [cerrar]);

  const copiar = useCallback(async () => {
    if (!contacto.e164) return;
    try {
      // El botón copia el E.164, no el agrupado legible: es la forma canónica,
      // la única que sirve para pegar en un discador o en otro sistema.
      await navigator.clipboard.writeText(contacto.e164);
      setCopiado("ok");
    } catch {
      // Sin permiso de portapapeles el número sigue visible y seleccionable.
      setCopiado("error");
    }
  }, [contacto.e164]);

  return (
    <>
      <button
        ref={disparadorRef}
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        className="btn btn-ghost btn-sm shrink-0"
        title="Información del contacto"
      >
        <Icon name="user" size={12} aria-hidden />
        <span className="hidden sm:inline">Información del contacto</span>
        <span className="sr-only sm:hidden">Información del contacto</span>
      </button>

      {abierto && portal(
        // `position: fixed` NO se ancla al viewport si algún ancestro tiene
        // `transform`, `filter` o `perspective`: ese ancestro pasa a ser el
        // bloque contenedor. El <main> del Shell lleva la animación de entrada
        // `nx-page-fade`, que aplica translate3d, y además scrollea con
        // overflow. Montado ahí adentro, el overlay quedaba recortado dentro
        // del área de contenido: el fondo no cubría la barra superior ni el
        // sidebar, y ambos seguían siendo clicables mientras el diálogo decía
        // ser modal. Se monta en <body> para que "fixed" signifique lo que dice.
        <div className="fixed inset-0 z-50 flex justify-end" onKeyDown={alTeclado}>
          <button
            type="button"
            aria-label="Cerrar"
            tabIndex={-1}
            onClick={cerrar}
            className="absolute inset-0 h-full w-full cursor-default bg-black/40"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wa-contacto-titulo"
            tabIndex={-1}
            className="relative flex h-full w-full max-w-sm flex-col border-l border-stroke-soft bg-bg-surface shadow-xl outline-none"
          >
            <div className="flex items-start justify-between gap-2 border-b border-stroke-soft px-4 py-3">
              <div className="min-w-0">
                <div className="eyebrow-tiny">Información del contacto</div>
                <h3 id="wa-contacto-titulo" className="mt-0.5 truncate text-sm font-bold text-fg-primary">
                  {contacto.nombre}
                </h3>
              </div>
              <button type="button" onClick={cerrar} className="btn btn-ghost btn-sm shrink-0" title="Cerrar">
                <Icon name="x" size={13} aria-hidden />
                <span className="sr-only">Cerrar</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-4 flex items-center gap-2">
                <Icon name="whatsapp" size={14} className="text-emerald-500" aria-hidden />
                <span className="text-xs font-medium text-fg-primary">Canal WhatsApp</span>
              </div>

              <div className="eyebrow-tiny mb-1">Teléfono</div>
              {contacto.e164 ? (
                <>
                  <p className="text-base font-semibold tabular-nums text-fg-primary">{contacto.legible}</p>
                  {/* La forma canónica va al lado de la legible: una se lee, la
                      otra se pega. Nunca se muestra una sola de las dos. */}
                  <p className="mt-0.5 font-mono text-[11px] text-fg-muted">
                    E.164 <span data-testid="wa-contacto-e164">{contacto.e164}</span>
                  </p>
                  <button type="button" onClick={copiar} className="btn btn-secondary btn-sm mt-3">
                    <Icon name={copiado === "ok" ? "check" : "copy"} size={12} aria-hidden />
                    {copiado === "ok" ? "Número copiado" : "Copiar número"}
                  </button>
                  {copiado === "error" && (
                    <p className="mt-1.5 text-[11px] text-fg-muted" role="status">
                      No se pudo copiar automáticamente. El número de arriba se puede seleccionar.
                    </p>
                  )}
                  <p aria-live="polite" className="sr-only">
                    {copiado === "ok" ? "Número copiado al portapapeles" : ""}
                  </p>
                </>
              ) : (
                <p className="text-sm text-fg-muted">{SIN_NUMERO}</p>
              )}
            </div>
          </div>
        </div>,
      )}
    </>
  );
}

/**
 * Monta el overlay en `document.body`. Sólo se llama cuando el panel está
 * abierto —o sea, después de un clic—, así que `document` siempre existe y no
 * hace falta el baile habitual de «montado en cliente» para el SSR.
 */
function portal(nodo: React.ReactNode) {
  return createPortal(nodo, document.body);
}
