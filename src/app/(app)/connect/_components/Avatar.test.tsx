/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Avatar } from "./Avatar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe("Avatar component (P2)", () => {
  it("renderiza la imagen cuando src es una URL válida", () => {
    act(() => {
      root.render(<Avatar src="https://ejemplo.com/foto.jpg" name="Martín Battaglia" />);
    });
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://ejemplo.com/foto.jpg");
    expect(img?.getAttribute("alt")).toBe("Martín Battaglia");
  });

  it("renderiza iniciales derivadas cuando no hay src", () => {
    act(() => {
      root.render(<Avatar name="Martín Battaglia" />);
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("MB");
  });

  it("renderiza iniciales explícitas provistas", () => {
    act(() => {
      root.render(<Avatar initials="OP" />);
    });
    expect(container.textContent).toBe("OP");
  });

  it("hace fallback a iniciales si la imagen dispara error de carga onError", () => {
    act(() => {
      root.render(<Avatar src="https://ejemplo.com/invalido.jpg" name="Lucía Gómez" />);
    });
    const img = container.querySelector("img")!;
    expect(img).not.toBeNull();

    act(() => {
      img.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("LG");
  });
});
