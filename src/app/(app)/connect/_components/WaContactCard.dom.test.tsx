/**
 * @vitest-environment jsdom
 *
 * NEXUS LINK · FASE B — ficha «Información del contacto» por RENDER REAL.
 *
 * El componente recibe el contacto YA AUTORIZADO: no hay decisión de seguridad
 * que probar acá — ésa vive en `src/lib/connect/read/wa-contact.test.ts`. Lo
 * que se demuestra es lo que el usuario efectivamente puede hacer: encontrar la
 * acción, ver el número en las dos formas, copiarlo, cerrar con el teclado, y
 * que la pantalla no se rompa cuando el número no existe.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/Icon", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

import { WaContactCard } from "./WaContactCard";

const CON_NUMERO = {
  nombre: "Royal Packs",
  e164: "+5491131079124",
  legible: "+54 9 11 3107-9124",
};
const SIN_NUMERO = { nombre: "Contacto viejo", e164: null, legible: null };

let host: HTMLDivElement;
let root: Root;
let escrito: string[];

function montar(contacto: typeof CON_NUMERO | typeof SIN_NUMERO) {
  act(() => { root.render(<WaContactCard contacto={contacto} />); });
}

// El overlay se monta por PORTAL en document.body, no dentro del host: por eso
// todo se consulta contra el documento. Es exactamente lo que se quiere probar.
const porTexto = (t: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(t));
const dialogo = () => document.body.querySelector('[role="dialog"]');
const texto = () => document.body.textContent ?? "";

const abrir = () => act(() => { porTexto("Información del contacto")?.click(); });

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  escrito = [];
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async (t: string) => { escrito.push(t); }) },
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("la acción es visible y accesible", () => {
  it("hay un botón real, no un tooltip ni un texto muerto", () => {
    montar(CON_NUMERO);
    const b = porTexto("Información del contacto");
    expect(b).toBeTruthy();
    expect(b?.tagName).toBe("BUTTON");
    expect(b?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(b?.getAttribute("aria-expanded")).toBe("false");
  });

  it("la ficha NO está montada hasta que se la abre", () => {
    montar(CON_NUMERO);
    expect(dialogo()).toBeNull();
    // Y el número tampoco está en el DOM antes de abrir.
    expect(texto()).not.toContain("3107");
  });

  it("al abrir aparece un diálogo modal etiquetado", () => {
    montar(CON_NUMERO);
    abrir();
    const dlg = dialogo();
    expect(dlg).toBeTruthy();
    expect(dlg?.getAttribute("aria-modal")).toBe("true");
    expect(dlg?.getAttribute("aria-labelledby")).toBe("wa-contacto-titulo");
    expect(document.body.querySelector("#wa-contacto-titulo")?.textContent).toBe("Royal Packs");
    expect(porTexto("Información del contacto")?.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("f · formato E.164 y botón de copia", () => {
  it("muestra el legible y el canónico, los dos", () => {
    montar(CON_NUMERO);
    abrir();
    expect(texto()).toContain("+54 9 11 3107-9124");
    expect(document.body.querySelector('[data-testid="wa-contacto-e164"]')?.textContent)
      .toBe("+5491131079124");
  });

  it("identifica el canal como WhatsApp", () => {
    montar(CON_NUMERO);
    abrir();
    expect(texto()).toContain("Canal WhatsApp");
    expect(document.body.querySelector('[data-icon="whatsapp"]')).toBeTruthy();
  });

  it("«Copiar número» copia el E.164, no el agrupado legible", async () => {
    montar(CON_NUMERO);
    abrir();
    await act(async () => { porTexto("Copiar número")?.click(); });
    // Copiar el legible pondría espacios y guiones en el portapapeles: no sirve
    // para pegar en un discador ni en otro sistema.
    expect(escrito).toEqual(["+5491131079124"]);
    expect(porTexto("Número copiado")).toBeTruthy();
  });

  it("si el portapapeles falla lo dice, y el número sigue visible", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => { throw new Error("denegado"); }) },
    });
    montar(CON_NUMERO);
    abrir();
    await act(async () => { porTexto("Copiar número")?.click(); });
    expect(texto()).toContain("No se pudo copiar");
    expect(texto()).toContain("+5491131079124");
  });
});

describe("e · número ausente: se declara, no se rompe", () => {
  it("dice «Número no disponible» y no ofrece copiar", () => {
    montar(SIN_NUMERO);
    abrir();
    expect(dialogo()).toBeTruthy();
    expect(texto()).toContain("Número no disponible");
    expect(porTexto("Copiar número")).toBeUndefined();
  });

  it("el nombre se sigue mostrando aunque no haya número", () => {
    montar(SIN_NUMERO);
    abrir();
    expect(document.body.querySelector("#wa-contacto-titulo")?.textContent).toBe("Contacto viejo");
  });
});

/** Teclea sobre el elemento con foco, como lo haría una persona. */
const teclear = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    (document.activeElement ?? document.body)
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });

describe("se cierra por teclado y por clic", () => {
  it("Escape cierra la ficha", () => {
    montar(CON_NUMERO);
    abrir();
    teclear("Escape");
    expect(dialogo()).toBeNull();
    expect(texto()).not.toContain("3107");
  });

  it("el botón Cerrar también la cierra", () => {
    montar(CON_NUMERO);
    abrir();
    act(() => { porTexto("Cerrar")?.click(); });
    expect(dialogo()).toBeNull();
  });

  it("el Escape NO se escucha en document: no puede pisar a otros componentes", () => {
    // La campanita de notificaciones tiene su propio listener de Escape sobre
    // `document`. Si esta ficha también lo tuviera, un Escape cerraría las dos
    // y las dos devolverían el foco, compitiendo entre sí.
    montar(CON_NUMERO);
    abrir();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialogo()).toBeTruthy();
  });
});

describe("el overlay se ancla a la VENTANA, no al contenedor de la página", () => {
  it("se monta por portal en document.body, fuera del árbol de la página", () => {
    // `position: fixed` se ancla al ancestro con `transform` si lo hay, y el
    // <main> del Shell lleva una animación de entrada que aplica translate3d.
    // Montado ahí adentro, el fondo no cubría la barra superior ni el sidebar.
    montar(CON_NUMERO);
    abrir();
    const dlg = dialogo();
    expect(dlg).toBeTruthy();
    expect(host.contains(dlg!)).toBe(false);
    expect(dlg!.closest(".fixed")?.parentElement).toBe(document.body);
  });

  it("al cerrar no deja el overlay colgado en el body", () => {
    montar(CON_NUMERO);
    abrir();
    act(() => { porTexto("Cerrar")?.click(); });
    expect(document.body.querySelector(".fixed")).toBeNull();
  });
});

describe("el foco queda atrapado: `aria-modal` no es una promesa vacía", () => {
  it("Tab desde el último control vuelve al primero", () => {
    montar(CON_NUMERO);
    abrir();
    const focos = [...dialogo()!.querySelectorAll<HTMLElement>("button")];
    expect(focos.length).toBeGreaterThanOrEqual(2);
    const ultimo = focos[focos.length - 1]!;
    act(() => ultimo.focus());
    teclear("Tab");
    expect(document.activeElement).toBe(focos[0]);
  });

  it("Shift+Tab desde el primero va al último", () => {
    montar(CON_NUMERO);
    abrir();
    const focos = [...dialogo()!.querySelectorAll<HTMLElement>("button")];
    act(() => focos[0]!.focus());
    teclear("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(focos[focos.length - 1]);
  });

  it("al abrir, el foco entra al panel; al cerrar, vuelve al disparador", () => {
    montar(CON_NUMERO);
    const disparador = porTexto("Información del contacto")!;
    abrir();
    expect(dialogo()!.contains(document.activeElement)).toBe(true);
    teclear("Escape");
    expect(document.activeElement).toBe(disparador);
  });
});
