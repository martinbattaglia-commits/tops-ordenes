/**
 * @vitest-environment jsdom
 *
 * SUPERFICIES DEL REGISTRO MAESTRO · por RENDER REAL.
 *
 * ─── QUÉ PRUEBA, Y POR QUÉ ACÁ ─────────────────────────────────────────────
 *
 * Que en lo que el operador VE no aparece Clientify: ni el nombre, ni un
 * enlace, ni un botón para conectar un CRM externo, ni estado o cartel de
 * sincronización, ni una acción de refrescar el CRM, ni la promesa de que los
 * clientes se importan o exportan a ningún lado.
 *
 * Es distinto de la guarda mecánica de `clients-native-only.test.ts`, y a
 * propósito. Allá se demuestran propiedades del CÓDIGO —aislamiento del grafo,
 * ausencia de egreso, ausencia de identificadores, contrato de esquema— sobre
 * todo el árbol. Acá se monta el componente productivo en un DOM y se lee la
 * salida: la lista de textos prohibidos es corta y CONCRETA, y se afirma su
 * ausencia sobre superficies que son nuestras y cuyo contenido controlamos.
 *
 * Esa diferencia es la que vuelve legítima una comprobación por texto que en la
 * guarda mecánica sería una heurística: acá no se intenta decidir si una frase
 * cualquiera «promete» algo, se comprueba que unas cadenas concretas no estén
 * en la salida de ocho pantallas conocidas.
 *
 * Cada caso hace además una aserción POSITIVA sobre algo que sí debe verse. Sin
 * eso, un render vacío —un componente que explota y devuelve nada— pasaría
 * todas las comprobaciones de ausencia.
 *
 * ─── FRONTERAS ─────────────────────────────────────────────────────────────
 *
 * Se sustituyen las server actions, el enrutador y los lectores de datos. Todo
 * lo demás —composición, textos, enlaces, botones— es el código que se
 * despliega.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot, type Root } from "react-dom/client";

// ── Fronteras ──────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/clients",
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {},
}));

vi.mock("@/app/(app)/clients/actions", () => ({
  createClient: vi.fn(),
  fetchClients: vi.fn(async () => ({ ok: true, rows: [], total: 0, source: "supabase" })),
  updateClientFiscal: vi.fn(),
  updateClientMaster: vi.fn(),
  setClientActivo: vi.fn(),
  contractClientCustody: vi.fn(),
  checkDuplicates: vi.fn(),
  canCreateClientFromOrder: vi.fn(async () => true),
}));

vi.mock("@/app/(app)/orders/new/actions", () => ({
  crearOrden: vi.fn(),
  buscarClientes: vi.fn(async () => []),
  createClient: vi.fn(),
}));

const CLIENTE = {
  id: "11111111-1111-4111-8111-111111111111",
  razon: "Distribuidora Ávila S.A.",
  cuit: "30712345678",
  activo: true,
  tags: ["ANMAT"],
  domicilio: "Av. Siempreviva 742",
  email: "compras@avila.test",
  contacto: "Ruth Ávila",
  telefono: "11 5555-0001",
  nombre_comercial: "Ávila Logística",
  codigo: "AVL",
  observaciones: "Entrega con turno",
  updated_at: "2026-08-15T00:00:00.000Z",
};

vi.mock("@/lib/legajo/data", () => ({
  getClienteFicha: vi.fn(async () => ({
    cliente: { ...CLIENTE, condicion_iva: "RESPONSABLE_INSCRIPTO", cuenta_contable: null },
    facturas: [],
    saldo: null,
  })),
}));

vi.mock("@/lib/erp/accounting-data", () => ({
  listChartOfAccounts: vi.fn(async () => []),
  getAccountByCode: vi.fn(async () => null),
}));

// ── Montaje ────────────────────────────────────────────────────────────────

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function montar(elemento: React.ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(elemento);
  });
  return host;
}

// ── El contrato de pantalla ────────────────────────────────────────────────

/**
 * Cadenas CONCRETAS que no pueden aparecer en ninguna superficie del maestro.
 *
 * No es un intento de interpretar el idioma: es una lista cerrada de lo que el
 * expediente retiró, para que reaparecer sea imposible en silencio. Cada una
 * estuvo realmente en pantalla en alguna versión anterior del flujo.
 */
const PROHIBIDO: ReadonlyArray<[RegExp, string]> = [
  [/clientify/i, "el nombre del proveedor"],
  [/clientify\.(com|net)/i, "un enlace al proveedor"],
  [/conectar\s+(el\s+)?(crm|clientify)/i, "un botón para conectar el CRM externo"],
  [/refrescar\s+(el\s+)?crm/i, "una acción de refrescar el CRM"],
  [/sincroniz/i, "estado, cartel o acción de sincronización"],
  [/pendiente\s+de\s+env[ií]o/i, "un estado de envío pendiente"],
  [/importar\s+(desde|de)\s+(el\s+)?crm/i, "una promesa de importación desde el CRM"],
  [/exportar\s+(al?\s+)?(crm|clientify)/i, "una promesa de exportación al CRM"],
  [/buscando\s+en\s+crm/i, "una búsqueda contra el CRM externo"],
];

/** Revisa el HTML y el texto visible contra el contrato. */
function revisarPantalla(nombre: string, el: HTMLElement): void {
  const html = el.innerHTML;
  const texto = el.textContent ?? "";
  for (const [re, queEs] of PROHIBIDO) {
    expect(html, `${nombre}: aparece ${queEs}`).not.toMatch(re);
    expect(texto, `${nombre}: aparece ${queEs} en el texto visible`).not.toMatch(re);
  }
  // Ningún enlace puede salir hacia el proveedor.
  for (const a of Array.from(el.querySelectorAll("a[href]"))) {
    expect(a.getAttribute("href"), `${nombre}: enlace externo`).not.toMatch(/clientify/i);
  }
}

// ── Superficies ────────────────────────────────────────────────────────────

describe("E · superficies del maestro, por render real", () => {
  it("listado de clientes", async () => {
    const { default: ClientsView } = await import("@/app/(app)/clients/ClientsView");
    const el = await montar(
      createElement(ClientsView, {
        initialRows: [CLIENTE],
        initialSource: "supabase",
        accounts: [],
      } as never),
    );
    // Positiva: el listado muestra de verdad al cliente.
    expect(el.textContent).toContain("Clientes");
    expect(el.textContent).toContain("Distribuidora Ávila S.A.");
    revisarPantalla("listado", el);
  });

  it("listado · con advertencia del backend", async () => {
    // El cartel de `warning` es una región que sólo se monta cuando el lector
    // de datos devuelve un aviso. Un C4 la midió sin montar.
    const { default: ClientsView } = await import("@/app/(app)/clients/ClientsView");
    const el = await montar(
      createElement(ClientsView, {
        initialRows: [CLIENTE],
        initialSource: "supabase",
        initialWarning: "La consulta tardó más de lo normal.",
        accounts: [],
      } as never),
    );
    expect(el.textContent).toContain("La consulta tardó más de lo normal.");
    revisarPantalla("listado con advertencia", el);
  });

  it("listado · vacío de búsqueda", async () => {
    const { default: ClientsView } = await import("@/app/(app)/clients/ClientsView");
    const el = await montar(
      createElement(ClientsView, {
        initialRows: [CLIENTE],
        initialSource: "supabase",
        accounts: [],
      } as never),
    );
    const buscador = Array.from(el.querySelectorAll("input")).find((i) =>
      (i.getAttribute("placeholder") ?? "").includes("Buscar por"),
    );
    expect(buscador, "no se encontró el buscador del listado").toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(buscador!, "zzzz-no-existe");
      buscador!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(el.textContent).toMatch(/Sin coincidencias/i);
    revisarPantalla("listado vacío", el);
  });

  it("detalle · cliente DESACTIVADO", async () => {
    // La insignia «Inactivo» es otra región condicionada por estado.
    const legajo = await import("@/lib/legajo/data");
    vi.mocked(legajo.getClienteFicha).mockResolvedValueOnce({
      cliente: {
        ...CLIENTE,
        activo: false,
        condicion_iva: "RESPONSABLE_INSCRIPTO",
        cuenta_contable: null,
      },
      facturas: [],
      saldo: null,
    } as never);
    const modulo = await import("@/app/(app)/clientes/[id]/page");
    const elemento = await (modulo.default as (p: unknown) => Promise<React.ReactElement>)({
      params: { id: CLIENTE.id },
    });
    const el = await montar(elemento);
    expect(el.textContent).toContain("Inactivo");
    revisarPantalla("ficha desactivada", el);
  });

  it("alta de cliente · el modal completo", async () => {
    const { default: ClientsView } = await import("@/app/(app)/clients/ClientsView");
    const el = await montar(
      createElement(ClientsView, {
        initialRows: [],
        initialSource: "supabase",
        accounts: [],
      } as never),
    );
    const abrir = Array.from(el.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Nuevo cliente"),
    );
    expect(abrir, "no se encontró el botón de alta").toBeTruthy();
    await act(async () => {
      abrir!.click();
    });
    // Positiva: el modal se abrió y pide lo que tiene que pedir.
    expect(el.textContent).toContain("Razón social");
    expect(el.textContent).toContain("CUIT");
    expect(el.textContent).toContain("Crear cliente");
    revisarPantalla("alta", el);
  });

  it("modal de duplicados · candidatos y «Crear de todos modos»", async () => {
    // El servidor advierte y devuelve el acuse; la pantalla debe ofrecer la
    // salida. Es el defecto funcional que este expediente cerró: antes el modal
    // sólo pintaba el error y el alta quedaba sin salida.
    const acciones = await import("@/app/(app)/clients/actions");
    vi.mocked(acciones.createClient).mockResolvedValueOnce({
      ok: false,
      error: "Hay clientes parecidos. Revisalos y confirmá si aun así querés crear uno nuevo.",
      duplicados: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          razon: "Distribuidora Avila SA",
          cuit: "30712345679",
          match_reason: "razon_similar",
          score: 0.9,
        },
      ],
      confirmacion_duplicados: "a".repeat(32),
    } as never);

    const { default: ClientsView } = await import("@/app/(app)/clients/ClientsView");
    const el = await montar(
      createElement(ClientsView, {
        initialRows: [],
        initialSource: "supabase",
        accounts: [],
      } as never),
    );
    await act(async () => {
      Array.from(el.querySelectorAll("button"))
        .find((b) => (b.textContent ?? "").includes("Nuevo cliente"))!
        .click();
    });

    // Se dispara el envío con el formulario tal como está; lo que importa es
    // la RESPUESTA con duplicados y lo que la pantalla hace con ella.
    const form = el.querySelector("form");
    expect(form, "el modal no tiene formulario").toBeTruthy();
    // Acotado AL FORMULARIO: el primer input de la pantalla es el buscador
    // del listado, no la razón social del modal.
    const inputs = Array.from(form!.querySelectorAll("input"));
    const razonInput = inputs.find((input) =>
      (input.getAttribute("placeholder") ?? "").includes("Laboratorios"),
    );
    const cuitInput = inputs.find((input) =>
      (input.getAttribute("placeholder") ?? "").includes("30-12345678-9"),
    );
    expect(razonInput).toBeTruthy();
    expect(cuitInput).toBeTruthy();
    await act(async () => {
      // Razón social y CUIT válidos, para habilitar el envío.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(razonInput!, "Distribuidora Avila del Sur SA");
      razonInput!.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(cuitInput!, "30-70000090-3");
      cuitInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // Positiva: se ven los candidatos Y la salida explícita.
    expect(el.textContent).toContain("Clientes parecidos ya registrados");
    expect(el.textContent).toContain("Distribuidora Avila SA");
    expect(el.textContent).toContain("Crear de todos modos");
    revisarPantalla("modal de duplicados", el);
  });

  it("detalle · ficha del cliente", async () => {
    const modulo = await import("@/app/(app)/clientes/[id]/page");
    const elemento = await (modulo.default as (p: unknown) => Promise<React.ReactElement>)({
      params: { id: CLIENTE.id },
    });
    const el = await montar(elemento);
    // Positiva: la ficha muestra los datos nativos.
    expect(el.textContent).toContain("Distribuidora Ávila S.A.");
    expect(el.textContent).toContain("Legajo digital de cliente");
    expect(el.textContent).toContain("Operaciones");
    // Y ya NO tiene la sección comercial que enlazaba al CRM externo.
    expect(el.textContent).not.toContain("Comercial / CRM");
    revisarPantalla("ficha", el);
  });

  it("edición fiscal · el formulario de edición, no sólo la tarjeta de lectura", async () => {
    // El editor arranca en SÓLO LECTURA. Un C4 midió que quedarse ahí dejaba la
    // rama de edición sin renderizar: se le podía inyectar «Conectar Clientify»
    // y la suite seguía verde. Acá se acciona «Editar» y se mide el formulario.
    const { ClienteFiscalEditor } = await import("@/components/comercial/ClienteFiscalEditor");
    const el = await montar(
      createElement(ClienteFiscalEditor, {
        clientId: CLIENTE.id,
        updatedAt: CLIENTE.updated_at,
        accounts: [],
        initial: { condicion_iva: "RESPONSABLE_INSCRIPTO", cuenta_contable: "" },
      } as never),
    );
    const editar = Array.from(el.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Editar"),
    );
    expect(editar, "no se encontró el botón de editar").toBeTruthy();
    const antes = el.innerHTML.length;
    await act(async () => {
      editar!.click();
    });
    // Positiva: el formulario de edición está montado de verdad.
    expect(el.innerHTML.length, "la edición no montó nada nuevo").toBeGreaterThan(antes);
    expect(el.querySelectorAll("select, input").length).toBeGreaterThan(0);
    revisarPantalla("edición fiscal", el);
  });

  it("wizard de Órdenes · la lista de resultados de la búsqueda", async () => {
    // La lista sólo se monta con el buscador enfocado. Sin accionarlo, el C4
    // midió que se le podía inyectar «Buscando en CRM» sin que nadie lo viera.
    const { default: NewOrderWizard } = await import("@/app/(app)/orders/new/NewOrderWizard");
    const el = await montar(
      createElement(NewOrderWizard, { clients: [CLIENTE], operators: [], catalog: [] } as never),
    );
    const buscador = Array.from(el.querySelectorAll("input")).find((i) =>
      (i.getAttribute("placeholder") ?? "").includes("Razón social"),
    );
    expect(buscador, "no se encontró el buscador del wizard").toBeTruthy();
    await act(async () => {
      // React delega el foco por `focusin`; un `focus` nativo no lo alcanza.
      buscador!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    // Positiva: la lista de coincidencias está montada con el cliente adentro.
    expect(el.textContent).toContain("Distribuidora Ávila S.A.");
    expect(el.textContent).toMatch(/Clientes recientes|Coincidencias/);
    revisarPantalla("wizard · resultados de búsqueda", el);
  });

  it("wizard de Órdenes · alta inline con la lista de duplicados desplegada", async () => {
    const acciones = await import("@/app/(app)/clients/actions");
    vi.mocked(acciones.createClient).mockResolvedValueOnce({
      ok: false,
      error: "Hay clientes parecidos.",
      duplicados: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          razon: "Distribuidora Avila SRL",
          cuit: "30712345670",
          match_reason: "razon_similar",
          score: 0.8,
        },
      ],
      confirmacion_duplicados: "b".repeat(32),
    } as never);

    const { default: NewOrderWizard } = await import("@/app/(app)/orders/new/NewOrderWizard");
    const el = await montar(
      createElement(NewOrderWizard, { clients: [CLIENTE], operators: [], catalog: [] } as never),
    );
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;

    // 1 · Se edita la razón social a mano: eso invalida el vínculo canónico y
    //     habilita la oferta de alta sin salir de la orden.
    const razonManual = Array.from(el.querySelectorAll("input")).find(
      (i) => (i.getAttribute("placeholder") ?? "").length === 0,
    );
    await act(async () => {
      const campo = razonManual ?? el.querySelectorAll("input")[1];
      setter.call(campo, "Distribuidora Avila del Norte SA");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const abrir = Array.from(el.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("creá uno nuevo"),
    );
    expect(abrir, "no se ofreció el alta inline tras invalidar el vínculo").toBeTruthy();
    await act(async () => {
      abrir!.click();
    });
    expect(el.textContent).toContain("Nuevo cliente");

    // 2 · Se completa y se envía: el servidor responde con parecidos.
    const campos = Array.from(el.querySelectorAll("input"));
    const razon = campos.find((i) => (i.value ?? "").includes("Avila del Norte")) ?? campos[1];
    const cuit = campos.find((i) => i.getAttribute("inputmode") === "numeric");
    await act(async () => {
      setter.call(razon, "Distribuidora Avila del Norte SA");
      razon.dispatchEvent(new Event("input", { bubbles: true }));
      if (cuit) {
        setter.call(cuit, "30-70000090-3");
        cuit.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const crear = Array.from(el.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Crear y seleccionar"),
    );
    expect(crear, "no se encontró el botón de crear del alta inline").toBeTruthy();
    await act(async () => {
      crear!.click();
    });

    // Positiva: la lista de parecidos se desplegó de verdad.
    expect(el.textContent).toContain("Clientes parecidos");
    expect(el.textContent).toContain("Distribuidora Avila SRL");
    revisarPantalla("wizard · alta inline con duplicados", el);
  });

  it("selector de clientes usado por WMS y Órdenes", async () => {
    const modulo = (await import("@/components/ClientSelector")) as Record<string, unknown>;
    const Selector = (modulo.ClientSelector ?? modulo.default) as never;
    const el = await montar(
      createElement(Selector, {
        options: [{ id: CLIENTE.id, razon: CLIENTE.razon }],
        value: CLIENTE.id,
        onChange: () => {},
      } as never),
    );
    expect(el.querySelectorAll("option, li, button, input").length).toBeGreaterThan(0);
    revisarPantalla("selector", el);
  });

  it("edición general y desactivación tienen controles operables en la ficha", async () => {
    const actions = await import("@/app/(app)/clients/actions");
    vi.mocked(actions.setClientActivo).mockResolvedValueOnce({ ok: true });
    const { ClientMasterEditor } = await import("@/app/(app)/clientes/[id]/ClientMasterEditor");
    const el = await montar(createElement(ClientMasterEditor, {
      clientId: CLIENTE.id,
      cuit: CLIENTE.cuit,
      activo: true,
      updatedAt: CLIENTE.updated_at,
      custodyLevel: 1,
      initial: {
        razon: CLIENTE.razon,
        nombre_comercial: CLIENTE.nombre_comercial,
        codigo: CLIENTE.codigo,
        domicilio: CLIENTE.domicilio,
        localidad: "CABA",
        telefono: CLIENTE.telefono,
        contacto: CLIENTE.contacto,
        email: CLIENTE.email,
        tags: CLIENTE.tags.join(", "),
        deposito_asignado: "MAGALDI",
        observaciones: CLIENTE.observaciones,
        motivo: "edición de ficha nativa",
      },
    }));

    const edit = Array.from(el.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("Editar ficha"),
    );
    expect(edit, "falta el control de edición general").toBeTruthy();
    await act(async () => edit!.click());
    expect(el.textContent).toContain("Guardar cambios");
    expect(el.textContent).toContain("Observaciones internas");

    const reason = Array.from(el.querySelectorAll("input")).find((input) =>
      (input.getAttribute("placeholder") ?? "").includes("Motivo obligatorio"),
    );
    expect(reason, "falta el motivo de desactivación").toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(reason!, "cese operativo documentado");
      reason!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const deactivate = Array.from(el.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("Desactivar cliente"),
    );
    expect(deactivate).toBeTruthy();
    await act(async () => deactivate!.click());
    expect(actions.setClientActivo).toHaveBeenCalledWith(
      CLIENTE.id,
      false,
      "cese operativo documentado",
    );
    revisarPantalla("edición y desactivación nativas", el);
  });
});

describe("calibración · la revisión de pantalla discrimina", () => {
  /**
   * Sin esto, las siete pruebas de arriba podrían estar en verde porque
   * `revisarPantalla` no mira nada. Cada señuelo contiene algo prohibido y se
   * exige que la revisión lo rechace; el último comprueba lo contrario, que una
   * pantalla legítima del maestro no se rompa.
   */
  const SENUELOS: ReadonlyArray<[string, string]> = [
    ["nombre del proveedor", "<p>Sincronizado con Clientify</p>"],
    ["enlace al proveedor", '<a href="https://new.clientify.com/contacts">Buscar</a>'],
    ["boton de conectar CRM", "<button>Conectar el CRM</button>"],
    ["accion de refrescar", "<button>Refrescar CRM</button>"],
    ["cartel de sincronizacion", "<div>Sincronizacion pendiente</div>"],
    ["estado de envio", "<span>Pendiente de envio</span>"],
    ["promesa de importacion", "<button>Importar desde el CRM</button>"],
    ["promesa de exportacion", "<button>Exportar al CRM</button>"],
    ["busqueda contra el CRM", "<span>Buscando en CRM</span>"],
  ];

  it.each(SENUELOS)("rechaza el senuelo: %s", (_nombre, html) => {
    const senuelo = document.createElement("div");
    senuelo.innerHTML = html;
    expect(() => revisarPantalla("senuelo", senuelo)).toThrow();
  });

  it("no rechaza una pantalla legitima del maestro", () => {
    const limpia = document.createElement("div");
    limpia.innerHTML =
      "<h1>Clientes</h1><a href=\"/clientes/1\">Distribuidora Avila S.A.</a>" +
      "<button>Nuevo cliente</button><button>Crear de todos modos</button>" +
      "<span>Buscando...</span>";
    expect(() => revisarPantalla("limpia", limpia)).not.toThrow();
  });
});
