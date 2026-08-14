/**
 * WMS UI/E2E · Entorno DOM.
 *
 * Sólo se define lo que jsdom NO implementa y el navegador SÍ. Nada de esto
 * silencia errores: si un componente rompiera, el error sigue propagándose.
 */
import { afterEach } from "vitest";

// React exige declarar el entorno de `act` explícitamente.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom no implementa scroll; el navegador sí. Se define sólo si falta, para no
// pisar una implementación real si algún día la hubiera.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* no-op: jsdom no hace layout. */
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});
