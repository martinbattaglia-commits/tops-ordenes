import { planInsertion } from "./insert";

type EditableElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * Escribe `value` usando el setter NATIVO del prototipo y despacha un evento
 * `input` real. React escucha `input` en la raíz del árbol, así que ejecuta el
 * onChange del componente sin poder distinguirlo de una pulsación de tecla.
 *
 * Esta es la garantía TÉCNICA de que Copilot no sabe si el texto vino de voz o
 * de teclado: no hay rama de código que auditar. Ver spec §9.
 *
 * El prototipo se elige según el tipo de elemento: un setter tomado de
 * HTMLTextAreaElement no funciona sobre un <input>, y viceversa.
 */
function setNativeValue(el: EditableElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) {
    el.value = value; // degradación: React podría no enterarse
    return;
  }
  setter.call(el, value);
}

export function insertAtCursor(el: EditableElement, text: string): void {
  const selStart = el.selectionStart ?? el.value.length;
  const selEnd = el.selectionEnd ?? el.value.length;

  const { value, caretStart, caretEnd } = planInsertion(el.value, selStart, selEnd, text);
  // No-op real: sin cambio de valor no se despacha evento ni se toca la
  // selección — el usuario conserva exactamente lo que tenía.
  if (value === el.value) return;

  setNativeValue(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));

  // React re-renderiza tras el evento y puede reposicionar el caret al final.
  // El microtask lo coloca después de ese re-render.
  queueMicrotask(() => {
    if (el.isConnected) el.setSelectionRange(caretStart, caretEnd);
  });
}
