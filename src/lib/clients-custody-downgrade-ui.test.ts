/**
 * @vitest-environment jsdom
 *
 * BAJA DE LA CUSTODIA DIGITAL REFORZADA · el control en la ficha, por RENDER REAL.
 *
 * ─── QUÉ SE MIDE, Y POR QUÉ POR RENDER ─────────────────────────────────────
 *
 * Que el operador que contrató para el cliente equivocado tiene una salida en
 * pantalla, y que esa salida:
 *
 *   · sólo aparece si tiene el permiso REAL, medido server-side y pasado como
 *     prop. Un espejo per-user de `canAccess` mostraría el control a quien el
 *     servidor va a rechazar;
 *   · no se envía sin motivo;
 *   · pide una CONFIRMACIÓN REFORZADA: es dar de baja un servicio contratado;
 *   · le dice al usuario, con todas las letras, que la mercadería ya ingresada
 *     conserva su custodia digital. Es el dato que evita el miedo, y es cierto:
 *     0252 estampa el nivel en la unidad al ingresar y no lo re-deriva;
 *   · le avisa que la baja queda auditada con su motivo.
 *
 * Se mide por render porque el defecto que se corrige era una AUSENCIA en la
 * pantalla, no en la lógica: la lógica de la base ya lo permitía.
 *
 * ─── FRONTERAS ─────────────────────────────────────────────────────────────
 *
 * Se sustituyen las server actions y el enrutador. La composición, los textos,
 * los botones y las condiciones son el código que se despliega.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot, type Root } from "react-dom/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/clientes/1",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/(app)/clients/actions", () => ({
  updateClientMaster: vi.fn(),
  setClientActivo: vi.fn(),
  contractClientCustody: vi.fn(),
  downgradeClientCustody: vi.fn(async () => ({ ok: true, updated_at: "2026-08-19T12:00:00.000Z" })),
}));

const CLIENTE = {
  id: "11111111-1111-4111-8111-111111111111",
  cuit: "30712345678",
  updated_at: "2026-08-15T00:00:00.000Z",
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function montarFicha(opciones: { custodyLevel: 1 | 2; canContractCustody: boolean }) {
  const { ClientMasterEditor } = await import("@/app/(app)/clientes/[id]/ClientMasterEditor");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const elemento = createElement(ClientMasterEditor, {
    clientId: CLIENTE.id,
    cuit: CLIENTE.cuit,
    activo: true,
    updatedAt: CLIENTE.updated_at,
    custodyLevel: opciones.custodyLevel,
    canContractCustody: opciones.canContractCustody,
    initial: {
      razon: "Distribuidora Ávila S.A.",
      nombre_comercial: "Ávila Logística",
      codigo: "AVL",
      domicilio: "Av. Siempreviva 742",
      localidad: "CABA",
      telefono: "11 5555-0001",
      contacto: "Ruth Ávila",
      email: "compras@avila.test",
      tags: "ANMAT",
      deposito_asignado: "MAGALDI",
      observaciones: "Entrega con turno",
      motivo: "edición de ficha nativa",
    },
  } as never);
  await act(async () => {
    root!.render(elemento);
  });
  return host;
}

function botonPorTexto(el: HTMLElement, fragmento: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(fragmento),
  );
}

function escribir(campo: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto =
    campo instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * El texto de LA SECCIÓN «Custodia digital», no el de toda la ficha.
 *
 * Medir sobre `el.textContent` entero es lo que vuelve tautológica una
 * aserción: el editor ya habla de auditoría en su encabezado. Se acota al
 * bloque que arranca en el título de la sección.
 */
function textoDeCustodia(el: HTMLElement): string {
  const plano = (el.textContent ?? "").replace(/\s+/g, " ");
  const desde = plano.indexOf("Custodia digital");
  expect(desde, "no se encontró la sección «Custodia digital»").toBeGreaterThanOrEqual(0);
  const hasta = plano.indexOf("Estado del cliente", desde);
  return plano.slice(desde, hasta === -1 ? undefined : hasta);
}

/** El campo de motivo DE LA BAJA, distinto del de desactivación del cliente. */
function campoMotivoBaja(el: HTMLElement): HTMLInputElement | HTMLTextAreaElement | undefined {
  return Array.from(el.querySelectorAll("input, textarea")).find((campo) =>
    /motivo de la baja/i.test(campo.getAttribute("placeholder") ?? ""),
  ) as HTMLInputElement | HTMLTextAreaElement | undefined;
}

// ── El control existe, y dice lo que tiene que decir ───────────────────────

describe("ficha · el camino inverso existe cuando corresponde", () => {
  it("nivel 2 con permiso ofrece dar de baja la custodia reforzada", async () => {
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    // Positiva: la sección sigue mostrando el estado contratado.
    expect(el.textContent).toContain("Reforzada contratada · nivel 2");
    expect(botonPorTexto(el, "Dar de baja la custodia reforzada"), "falta el control de baja").toBeTruthy();
  });

  it("le dice al usuario que lo ya ingresado conserva su custodia, en UNA frase", async () => {
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    // CONTIGUA a propósito: verificar las dos mitades por separado dejaría
    // pasar que alguien las reparta en dos párrafos alejados y el literal que
    // Dirección exigió «con todas las letras» ya no exista en ningún lado.
    expect(textoDeCustodia(el)).toMatch(
      /la mercadería ya ingresada conserva su custodia digital; esto aplica a lo que ingrese desde ahora/,
    );
  });

  it("avisa que la baja queda auditada con su motivo", async () => {
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    // Acotado A LA SECCIÓN DE CUSTODIA: el encabezado del editor ya dice
    // «se guardan junto con su evento de auditoría», así que medir sobre todo
    // el `textContent` daría verde aunque la promesa de la baja no existiera.
    const texto = textoDeCustodia(el).toLowerCase();
    expect(texto).toMatch(/la baja queda auditada con su motivo/);
    // Y la confirmación también lo repite, que es donde el operador decide.
    await act(async () => escribir(campoMotivoBaja(el)!, "corrección de alta"));
    await act(async () => botonPorTexto(el, "Dar de baja la custodia reforzada")!.click());
    expect(textoDeCustodia(el).toLowerCase()).toMatch(/auditoría del cliente con el motivo/);
  });

  it("nivel 2 SIN el permiso no ofrece el control", async () => {
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: false });
    expect(el.textContent).toContain("Reforzada contratada · nivel 2");
    expect(
      botonPorTexto(el, "Dar de baja la custodia reforzada"),
      "se ofreció la baja a quien el servidor va a rechazar",
    ).toBeFalsy();
  });

  it("nivel 1 no ofrece dar de baja lo que no está contratado", async () => {
    const el = await montarFicha({ custodyLevel: 1, canContractCustody: true });
    expect(botonPorTexto(el, "Dar de baja la custodia reforzada")).toBeFalsy();
    // Positiva: en nivel 1 lo que se ofrece es contratar.
    expect(botonPorTexto(el, "Contratar custodia reforzada")).toBeTruthy();
  });
});

// ── El gesto: motivo obligatorio y confirmación reforzada ──────────────────

describe("ficha · el gesto de la baja", () => {
  it("sin motivo el control está deshabilitado Y la guarda del handler lo cierra", async () => {
    const acciones = await import("@/app/(app)/clients/actions");
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    const boton = botonPorTexto(el, "Dar de baja la custodia reforzada")!;
    // 1 · La defensa visible: el control no se puede accionar.
    expect(boton.disabled, "el control de baja se ofrece sin motivo").toBe(true);
    await act(async () => boton.click());
    expect(acciones.downgradeClientCustody).not.toHaveBeenCalled();

    // 2 · Un motivo de puro espacio en blanco tampoco habilita el control.
    await act(async () => escribir(campoMotivoBaja(el)!, "   "));
    expect(
      botonPorTexto(el, "Dar de baja la custodia reforzada")!.disabled,
      "un motivo en blanco habilitó el control",
    ).toBe(true);
    expect(acciones.downgradeClientCustody).not.toHaveBeenCalled();

    // LÍMITE DECLARADO, no cobertura: el componente tiene además dos guardas
    // en profundidad —`if (!downgradeReason.trim()) return` en el disparador y
    // `if (!motivo) return` en el handler— para el caso de forzar el atributo
    // desde la consola. Esta suite NO las mide: jsdom no entrega el click a un
    // control que React renderiza deshabilitado, así que reponer el atributo a
    // mano no alcanza el manejador. Se midió por mutación que borrar cualquiera
    // de las dos deja esta suite en verde. Quedan como defensa deliberada y sin
    // medir; medirlas exige un navegador real, fuera del alcance de este
    // expediente.
  });

  it("con motivo pide CONFIRMACIÓN REFORZADA antes de ejecutar", async () => {
    const acciones = await import("@/app/(app)/clients/actions");
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    const motivo = campoMotivoBaja(el);
    expect(motivo, "falta el campo de motivo de la baja").toBeTruthy();
    await act(async () => escribir(motivo!, "contratada sobre el cliente equivocado"));
    await act(async () => botonPorTexto(el, "Dar de baja la custodia reforzada")!.click());
    // Todavía NO se ejecutó: primero hay que confirmar.
    expect(acciones.downgradeClientCustody, "se ejecutó sin confirmar").not.toHaveBeenCalled();
    // Y la confirmación repite el dato que calma al usuario.
    const texto = (el.textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain("la mercadería ya ingresada conserva su custodia digital");
  });

  it("confirmada, ejecuta con el identificador, el CAS y el motivo", async () => {
    const acciones = await import("@/app/(app)/clients/actions");
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    await act(async () =>
      escribir(campoMotivoBaja(el)!, "  contratada sobre el cliente equivocado  "),
    );
    await act(async () => botonPorTexto(el, "Dar de baja la custodia reforzada")!.click());
    const confirmar = botonPorTexto(el, "Confirmar la baja");
    expect(confirmar, "falta el control de confirmación").toBeTruthy();
    await act(async () => confirmar!.click());
    expect(acciones.downgradeClientCustody).toHaveBeenCalledWith(
      CLIENTE.id,
      CLIENTE.updated_at,
      "contratada sobre el cliente equivocado",
    );
  });

  it("ejecutada, la ficha queda en nivel 1 y ofrece volver a contratar", async () => {
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    await act(async () => escribir(campoMotivoBaja(el)!, "corrección de alta"));
    await act(async () => botonPorTexto(el, "Dar de baja la custodia reforzada")!.click());
    await act(async () => botonPorTexto(el, "Confirmar la baja")!.click());
    expect(el.textContent).toContain("Estándar · nivel 1");
    expect(botonPorTexto(el, "Contratar custodia reforzada")).toBeTruthy();
  });

  it("el error del servidor se muestra tal cual, sin taparlo", async () => {
    const acciones = await import("@/app/(app)/clients/actions");
    vi.mocked(acciones.downgradeClientCustody).mockResolvedValueOnce({
      ok: false,
      error: "La ficha cambió mientras la estabas editando. Recargá la página.",
    } as never);
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    await act(async () => escribir(campoMotivoBaja(el)!, "corrección de alta"));
    await act(async () => botonPorTexto(el, "Dar de baja la custodia reforzada")!.click());
    await act(async () => botonPorTexto(el, "Confirmar la baja")!.click());
    expect(el.textContent).toContain("La ficha cambió mientras la estabas editando.");
    // Y sigue en nivel 2: un error no puede pintar un éxito.
    expect(el.textContent).toContain("Reforzada contratada · nivel 2");
  });

  it("se puede desistir de la confirmación sin ejecutar nada", async () => {
    const acciones = await import("@/app/(app)/clients/actions");
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    await act(async () => escribir(campoMotivoBaja(el)!, "corrección de alta"));
    await act(async () => botonPorTexto(el, "Dar de baja la custodia reforzada")!.click());
    const cancelar = botonPorTexto(el, "No dar de baja");
    expect(cancelar, "falta la salida de la confirmación").toBeTruthy();
    await act(async () => cancelar!.click());
    expect(acciones.downgradeClientCustody).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Reforzada contratada · nivel 2");
  });
});

// ── El foco de la confirmación ─────────────────────────────────────────────

describe("ficha · la confirmación no secuestra el foco", () => {
  /**
   * Éstas nacen de una regresión propia: el primer arreglo de accesibilidad
   * puso `ref={(nodo) => nodo?.focus()}` en línea, y como esa función es nueva
   * en cada render, el panel se re-enfocaba en CADA commit del componente. Con
   * la confirmación abierta, el resto de la ficha quedaba inusable: un carácter
   * por clic. Se mide el efecto, no la intención.
   */
  it("toma el foco al ABRIRSE", async () => {
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    await act(async () => escribir(campoMotivoBaja(el)!, "corrección de alta"));
    await act(async () => botonPorTexto(el, "Dar de baja la custodia reforzada")!.click());
    const panel = el.querySelector('[role="alertdialog"]');
    expect(panel, "no se montó la confirmación").toBeTruthy();
    expect(document.activeElement, "la confirmación no tomó el foco al abrirse").toBe(panel);
  });

  it("NO vuelve a robar el foco en un re-render posterior del padre", async () => {
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    await act(async () => escribir(campoMotivoBaja(el)!, "corrección de alta"));
    await act(async () => botonPorTexto(el, "Dar de baja la custodia reforzada")!.click());
    const panel = el.querySelector('[role="alertdialog"]')!;

    // El operador baja a «Estado del cliente» a escribir, con la confirmación
    // todavía abierta. Cada tecla re-renderiza el padre.
    const motivoEstado = Array.from(el.querySelectorAll("input")).find((campo) =>
      /Motivo obligatorio/i.test(campo.getAttribute("placeholder") ?? ""),
    );
    expect(motivoEstado, "no se encontró el motivo de desactivación").toBeTruthy();
    motivoEstado!.focus();
    expect(document.activeElement).toBe(motivoEstado);

    await act(async () => escribir(motivoEstado!, "c"));
    expect(
      document.activeElement,
      "el panel se robó el foco en el re-render: el campo es inusable",
    ).toBe(motivoEstado);

    await act(async () => escribir(motivoEstado!, "ce"));
    expect(document.activeElement).toBe(motivoEstado);
    // Y la confirmación sigue abierta: no se cerró, simplemente no interfiere.
    expect(el.querySelector('[role="alertdialog"]')).toBe(panel);
  });

  it("no se declara modal: no hay trampa de foco que lo sostenga", async () => {
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    await act(async () => escribir(campoMotivoBaja(el)!, "corrección de alta"));
    await act(async () => botonPorTexto(el, "Dar de baja la custodia reforzada")!.click());
    const panel = el.querySelector('[role="alertdialog"]')!;
    // `aria-modal` le diría al lector que lo de afuera no existe, mientras el
    // foco sale sin obstáculo. Se afirma la ausencia, no la presencia.
    expect(panel.getAttribute("aria-modal")).toBeNull();
    // Positiva: el rol y la etiqueta sí están.
    expect(panel.getAttribute("aria-label")).toContain("Confirmar la baja");
  });
});

// ── N-4 · la rama sin permiso, medida por su texto ─────────────────────────

describe("ficha · lo que ve quien no puede dar de baja", () => {
  it("le dice el estado y a quién pedirle la baja, sin instructivo que no puede usar", async () => {
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: false });
    const texto = textoDeCustodia(el);
    expect(texto).toMatch(/requiere el permiso de contratación de custodia/);
    // Y NO se le muestra el instructivo de cómo dar de baja: no puede.
    expect(texto).not.toMatch(/Dar de baja corrige una contratación/);
  });
});

// ── La frase vieja ya no puede quedar en pantalla ──────────────────────────

describe("ficha · la frase que este expediente retira", () => {
  it("ya no afirma que la baja no se ofrece desde la ficha", async () => {
    const el = await montarFicha({ custodyLevel: 2, canContractCustody: true });
    const texto = (el.textContent ?? "").replace(/\s+/g, " ");
    expect(texto).not.toMatch(/la baja del servicio no se ofrece desde esta ficha/i);
  });
});
