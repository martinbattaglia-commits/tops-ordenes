/** Render REAL en jsdom con `react-dom/client`. Sin testing-library. */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface Rendered {
  container: HTMLElement;
  unmount(): Promise<void>;
}

export async function render(ui: ReactElement): Promise<Rendered> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    async unmount() {
      await act(async () => { root?.unmount(); });
      container.remove();
    },
  };
}

/** Dispara un click real y deja que React procese el update. */
export async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error("click sobre un elemento inexistente");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Escribe en un input/textarea disparando el evento que React escucha. */
export async function type(el: Element | null, value: string): Promise<void> {
  if (!el) throw new Error("type sobre un elemento inexistente");
  const node = el as HTMLTextAreaElement | HTMLInputElement;
  const proto = node instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export const byText = (c: HTMLElement, re: RegExp): HTMLElement | null =>
  ([...c.querySelectorAll("*")] as HTMLElement[]).find(
    (e) => e.children.length === 0 && re.test(e.textContent ?? ""),
  ) ?? null;

export const buttonByName = (c: HTMLElement, re: RegExp): HTMLButtonElement | null =>
  ([...c.querySelectorAll("button")] as HTMLButtonElement[]).find((b) =>
    re.test(b.textContent ?? ""),
  ) ?? null;
