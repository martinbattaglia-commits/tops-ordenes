/**
 * @vitest-environment jsdom
 *
 * M-3 · LINK-WA WA-8R9 — `ThreadView` probado por RENDER REAL.
 *
 * ─── POR QUÉ ───────────────────────────────────────────────────────────────
 *
 * Hasta acá la UI del hilo sólo estaba cubierta por aserciones sobre su TEXTO
 * FUENTE: expresiones regulares que verificaban, por ejemplo, que el componente
 * no comparara `kind`. Eso protege una regla de arquitectura, pero no dice nada
 * sobre lo que el operador ve. Un cambio que dejara de pintar la hora, o que
 * mostrara una fila histórica como entregada, pasaba entero.
 *
 * Acá se monta el componente REAL en un DOM y se lee lo que queda en pantalla.
 *
 * ─── INFRAESTRUCTURA MÍNIMA ────────────────────────────────────────────────
 *
 * Única dependencia dev incorporada: `jsdom`. NO se agregó Testing Library:
 * React 18.3 ya expone `act`, y `react-dom/client` alcanza para montar y leer.
 * Agregar una librería de consultas encima habría sido redundante.
 *
 * Las fronteras de red y de servidor —server actions, realtime, Supabase— se
 * sustituyen por dobles; el componente bajo prueba es el productivo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";

// ── Entorno de render ──────────────────────────────────────────────────────
/**
 * React exige esta bandera para reconocer `act(...)`. Sin ella emite un warning
 * por cada render y —peor— las actualizaciones de estado quedan fuera del lote,
 * así que lo que se lee del DOM puede no ser el resultado final.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * `scrollIntoView` no existe en jsdom y el componente lo llama dentro de un
 * `requestAnimationFrame`, donde el error se perdía sin que ningún test lo
 * viera. Se instala un doble OBSERVABLE en vez de silenciarlo: si el
 * componente deja de llamarlo, o lo llama mal, se nota.
 */
const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;
import { createRoot, type Root } from "react-dom/client";
import type { Message } from "@/lib/connect/types";

// ── Fronteras ──────────────────────────────────────────────────────────────
vi.mock("@/lib/supabase/client", () => ({ createClient: () => null }));
vi.mock("@/lib/supabase/realtime", () => ({ useRealtimeTable: () => {} }));
// `VoiceField` es un ENVOLTORIO: el textarea real es su hijo. El doble debe
// renderizar los children, o el composer productivo no llega al DOM.
vi.mock("@/components/voice/VoiceField", () => ({
  VoiceField: (p: { children?: unknown }) => <div>{p.children as never}</div>,
}));
vi.mock("@/components/Icon", () => ({ Icon: () => <span /> }));
// El composer de adjuntos es un componente aparte, con su propia suite de DOM
// (`AttachmentComposer.dom.test.tsx`). Acá se sustituye por un doble: sin esto,
// `ThreadView` arrastraría sus server actions —y con ellas `server-only`, que
// no es un paquete resoluble fuera del bundler de Next— al grafo de esta prueba.
vi.mock("./AttachmentComposer", () => ({
  AttachmentComposer: () => <button type="button" aria-label="Adjuntar archivo" />,
}));

// Los dobles devuelven el resultado COMPLETO de la acción real. Un doble
// incompleto —sin `messageId`— dejaba el id del mensaje en `undefined` y con él
// la `key` de React: lo detectó la guarda de consola, no una aserción.
let idServidor = 0;
const postMessageAction = vi.fn(async () => ({
  ok: true, status: "sent", route: "connect", messageId: `srv-connect-${++idServidor}`, seq: idServidor,
}));
vi.mock("@/lib/connect/adapters/driving/message-actions", () => ({
  postMessageAction: (...a: unknown[]) => postMessageAction(...(a as [])),
}));
const sendWhatsappTextAction = vi.fn(async () => ({
  // Id ÚNICO por llamada: el servidor real nunca devuelve dos veces el mismo, y
  // un doble que lo hiciera generaría claves duplicadas en la lista.
  ok: true, status: "sent", route: "whatsapp", messageId: `srv-wa-${++idServidor}`,
}));
vi.mock("@/lib/whatsapp/reply-action", () => ({
  sendWhatsappTextAction: (...a: unknown[]) => sendWhatsappTextAction(...(a as [])),
}));
const setHandoverStateAction = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/whatsapp/handover-action", () => ({
  setHandoverStateAction: (...a: unknown[]) => setHandoverStateAction(...(a as [])),
}));
vi.mock("@/lib/connect/client-mark-read", () => ({
  markReadInBrowser: vi.fn(async () => ({ ok: true })),
}));
// H2 (FASE B): audio-actions.ts ahora importa canChannel (nexus-link.ts, que
// trae `server-only`) para exigir la capacidad del canal, igual que ya hacían
// los adjuntos. Sin este mock, la cadena transitiva rompe el bundle de esta
// prueba jsdom — mismo defecto de fondo que ya se corrigió una vez con
// AttachmentComposer: NO se toca vitest.config.ts, se mockea el módulo que
// arrastra `server-only` a un entorno que no lo necesita.
vi.mock("@/lib/rbac/nexus-link", () => ({ canChannel: async () => true }));
// H-1 · el portón que resuelve la URL firmada del adjunto.
vi.mock("@/lib/connect/adapters/driving/attachment-actions", () => ({
  getAttachmentUrlAction: async () => ({ ok: true, url: "https://signed.example/f.png" }),
  prepareAttachmentUploadAction: async () => ({ ok: false, message: "no usado" }),
  finalizeAttachmentAction: async () => ({ ok: false, message: "no usado" }),
}));
// Mismo motivo: audio-actions.ts también importa el adaptador productivo de
// envío de media (server-only). No se ejercita el egress real acá — eso vive
// en media-send-core.test.ts, contra el core puro.
vi.mock("@/lib/whatsapp/media-send", () => ({
  sendWhatsappMediaForAttachment: async () => ({ ok: true, state: "sent", wamid: "wamid.TEST" }),
}));

import { ThreadView } from "./ThreadView";

// ── Montaje ────────────────────────────────────────────────────────────────
let container: HTMLDivElement;
let root: Root;

/**
 * Ningún error de consola pasa inadvertido.
 *
 * El punto del arreglo de `scrollIntoView` no es callar el ruido: es que un
 * error REAL de React —una key duplicada, un update fuera de `act`, una prop
 * inválida— rompa la prueba en vez de esconderse entre warnings esperados.
 */
let erroresConsola: string[] = [];
let restoreError: () => void;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  idServidor = 0;

  erroresConsola = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    erroresConsola.push(args.map(String).join(" | "));
  };
  restoreError = () => { console.error = original; };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  restoreError();
  // Cero errores tolerados: no hay allowlist que pueda tapar uno nuevo.
  expect(erroresConsola).toEqual([]);
});

const AT = "2026-08-09T15:42:00.000Z";

function mensaje(over: Partial<Message> & { wa?: unknown } = {}): Message {
  return {
    id: "m-1",
    body: "hola mundo",
    createdAt: AT,
    authorProfileId: "op-1",
    authorName: "Operador",
    seq: 1,
    ...over,
  } as Message;
}

function montar(props: {
  kind: string;
  initialMessages: Message[];
  currentUserId?: string | null;
  handoverState?: "BOT_ACTIVE" | "PAUSED_HUMAN";
  lastCustomerMessageAt?: string;
}) {
  act(() => {
    root.render(
      <ThreadView
        conversationId="11111111-1111-4111-8111-111111111111"
        kind={props.kind as never}
        initialMessages={props.initialMessages}
        currentUserId={props.currentUserId ?? "op-1"}
        handoverState={props.handoverState}
        lastCustomerMessageAt={props.lastCustomerMessageAt}
      />,
    );
  });
  return container.textContent ?? "";
}

describe("HOTFIX · control reversible de Max", () => {
  const customerAt = "2026-08-20T18:00:00.000Z";

  it("Max activo muestra el botón para tomar la conversación", () => {
    montar({
      kind: "whatsapp",
      initialMessages: [],
      handoverState: "BOT_ACTIVE",
      lastCustomerMessageAt: customerAt,
    });
    expect(container.textContent).toContain("Max está activo como filtro inicial");
    expect(container.textContent).toContain("Tomar conversación / Pausar Max");
  });

  it("persiste PAUSED_HUMAN antes de cambiar la interfaz", async () => {
    montar({
      kind: "whatsapp",
      initialMessages: [],
      handoverState: "BOT_ACTIVE",
      lastCustomerMessageAt: customerAt,
    });
    const button = [...container.querySelectorAll("button")]
      .find((item) => item.textContent?.includes("Tomar conversación"))!;
    await act(async () => { button.click(); });
    expect(setHandoverStateAction).toHaveBeenCalledWith({
      conversationId: "11111111-1111-4111-8111-111111111111",
      state: "PAUSED_HUMAN",
    });
    expect(container.textContent).toContain("Conversación tomada — Max está pausado");
    expect(container.textContent).toContain("Reactivar Max");
  });

  it("si Supabase rechaza la orden, conserva el estado anterior y muestra el error", async () => {
    setHandoverStateAction.mockResolvedValueOnce({ ok: false, message: "rechazo controlado" } as never);
    montar({
      kind: "whatsapp",
      initialMessages: [],
      handoverState: "BOT_ACTIVE",
      lastCustomerMessageAt: customerAt,
    });
    const button = [...container.querySelectorAll("button")]
      .find((item) => item.textContent?.includes("Tomar conversación"))!;
    await act(async () => { button.click(); });
    expect(container.textContent).toContain("Max está activo como filtro inicial");
    expect(container.textContent).toContain("rechazo controlado");
  });
});

/** Proyección sanitizada, tal como la entrega la hidratación server-side. */
const proj = (over: Record<string, unknown> = {}) => ({
  direction: "outbound",
  providerState: null,
  audited: false,
  stateAt: null,
  candidates: [],
  stateSource: "server",
  ...over,
});

// ══ 1 · LA HORA SIEMPRE SE VE ══════════════════════════════════════════════
/**
 * El defecto H-3: la hora colgaba de `status === undefined`, así que cualquier
 * mensaje en vuelo, pendiente, fallido o histórico se quedaba SIN hora.
 */
describe("M-3 · la hora es visible en todos los estados", () => {
  const casos: Array<[string, unknown]> = [
    ["confirmado", proj({ providerState: "read", audited: true, stateSource: "meta" })],
    ["en vuelo", proj({ providerState: "sending" })],
    ["pendiente", proj({ providerState: "reconciliation_required" })],
    ["fallido", proj({ providerState: "failed" })],
    ["histórico sin procedencia", proj({ providerState: "sent", stateSource: "historical_unknown" })],
    ["dirección desconocida", proj({ direction: "unknown", providerState: "sent" })],
    ["entrante", proj({ direction: "inbound" })],
  ];

  it.each(casos)("%s muestra la hora", (_l, wa) => {
    const texto = montar({ kind: "whatsapp", initialMessages: [mensaje({ wa } as never)] });
    // 15:42 en la zona local del entorno de test; se compara el patrón.
    expect(texto).toMatch(/\d{2}:\d{2}/);
  });

  it("un mensaje sin proyección alguna también muestra su hora", () => {
    const texto = montar({ kind: "whatsapp", initialMessages: [mensaje()] });
    expect(texto).toMatch(/\d{2}:\d{2}/);
  });

  it("Connect no-WhatsApp muestra la hora igual que siempre", () => {
    const texto = montar({ kind: "dm", initialMessages: [mensaje()] });
    expect(texto).toMatch(/\d{2}:\d{2}/);
    expect(texto).toContain("hola mundo");
  });
});

// ══ 2 · ESTADOS DEL OUTBOUND ═══════════════════════════════════════════════
describe("M-3 · cada estado se anuncia como lo que es", () => {
  const render1 = (wa: unknown) =>
    montar({ kind: "whatsapp", initialMessages: [mensaje({ wa } as never)] });

  it("sending muestra «enviando…»", () => {
    expect(render1(proj({ providerState: "sending" }))).toContain("enviando");
  });

  it("queued también es un intento en curso", () => {
    expect(render1(proj({ providerState: "queued" }))).toContain("enviando");
  });

  it("failed muestra el fallo, no un pendiente", () => {
    const t = render1(proj({ providerState: "failed" }));
    expect(t).toContain("no se pudo enviar");
    expect(t).not.toContain("pendiente de confirmación");
  });

  it("reconciliation_required muestra pendiente de confirmación", () => {
    expect(render1(proj({ providerState: "reconciliation_required" })))
      .toContain("pendiente de confirmación");
  });

  it.each(["sent", "delivered", "read"])(
    "%s SIN auditoría queda pendiente, nunca confirmado",
    (estado) => {
      const t = render1(proj({ providerState: estado, stateSource: "meta", audited: false }));
      expect(t).toContain("pendiente de confirmación");
    },
  );

  it.each(["sent", "delivered", "read"])(
    "%s CON auditoría se muestra confirmado: sólo hora, sin leyenda",
    (estado) => {
      const t = render1(proj({ providerState: estado, stateSource: "meta", audited: true }));
      expect(t).toMatch(/\d{2}:\d{2}/);
      expect(t).not.toContain("pendiente de confirmación");
      expect(t).not.toContain("enviando");
      expect(t).not.toContain("no se pudo enviar");
      expect(t).not.toContain("sin registro de envío");
    },
  );
});

// ══ 3 · H-3 · HISTÓRICO Y DIRECCIÓN DESCONOCIDA ════════════════════════════
describe("M-3 · H-3 · lo no acreditable se muestra neutro", () => {
  it("una fila histórica NO se anuncia como pendiente ni como entregada", () => {
    const t = montar({
      kind: "whatsapp",
      initialMessages: [mensaje({ wa: proj({ providerState: "sent", stateSource: "historical_unknown" }) } as never)],
    });
    expect(t).toContain("sin registro de envío");
    expect(t).not.toContain("pendiente de confirmación");
    expect(t).not.toContain("enviando");
    // Y conserva su hora: el mensaje existió y tiene un cuándo.
    expect(t).toMatch(/\d{2}:\d{2}/);
  });

  it("una fila de dirección desconocida tampoco anuncia envío", () => {
    const t = montar({
      kind: "whatsapp",
      initialMessages: [mensaje({ wa: proj({ direction: "unknown", providerState: "delivered" }) } as never)],
    });
    expect(t).toContain("sin registro de envío");
    expect(t).not.toContain("pendiente de confirmación");
  });

  it("un mensaje ENTRANTE no muestra ningún indicador de envío", () => {
    const t = montar({
      kind: "whatsapp",
      initialMessages: [mensaje({ wa: proj({ direction: "inbound" }) } as never)],
    });
    for (const leyenda of ["enviando", "pendiente de confirmación", "no se pudo enviar", "sin registro de envío"]) {
      expect(t).not.toContain(leyenda);
    }
    expect(t).toMatch(/\d{2}:\d{2}/);
  });
});

// ══ 4 · RELOAD / HIDRATACIÓN ═══════════════════════════════════════════════
describe("M-3 · recargar no fabrica confirmaciones", () => {
  it("un outbound sin evidencia NO aparece confirmado tras recargar", () => {
    // Simula el reload: se monta de cero con lo que entrega el servidor.
    const t = montar({
      kind: "whatsapp",
      initialMessages: [mensaje({ wa: proj({ providerState: "sent", stateSource: "historical_unknown" }) } as never)],
    });
    expect(t).toContain("sin registro de envío");
  });

  it("el mismo mensaje montado dos veces produce el MISMO texto", () => {
    const msg = mensaje({ wa: proj({ providerState: "delivered", stateSource: "meta", audited: false }) } as never);
    const a = montar({ kind: "whatsapp", initialMessages: [msg] });
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const b = montar({ kind: "whatsapp", initialMessages: [msg] });
    expect(b).toBe(a);
  });

  it("una lista mixta pinta exactamente una burbuja por mensaje", () => {
    const t = montar({
      kind: "whatsapp",
      initialMessages: [
        mensaje({ id: "a", body: "uno", wa: proj({ direction: "inbound" }) } as never),
        mensaje({ id: "b", body: "dos", seq: 2, wa: proj({ providerState: "failed" }) } as never),
        mensaje({ id: "c", body: "tres", seq: 3, wa: proj({ providerState: "sent", stateSource: "historical_unknown" }) } as never),
      ],
    });
    for (const cuerpo of ["uno", "dos", "tres"]) {
      expect(t.split(cuerpo).length - 1).toBe(1);
    }
    expect(t).toContain("no se pudo enviar");
    expect(t).toContain("sin registro de envío");
  });
});

// ══ 5 · ERROR POR MENSAJE ══════════════════════════════════════════════════
describe("M-3 · el error vive en SU mensaje", () => {
  it("un sendError se muestra sólo en el mensaje que lo tiene", () => {
    const t = montar({
      kind: "whatsapp",
      initialMessages: [
        mensaje({ id: "a", body: "sano" } as never),
        mensaje({ id: "b", body: "roto", seq: 2, sendError: "no se pudo enviar" } as never),
      ],
    });
    expect(t).toContain("roto");
    expect(t).toContain("sano");
    // Una sola aparición del error: no se derrama al hilo entero.
    expect(t.split("no se pudo enviar").length - 1).toBe(1);
  });
});

// ══ 6 · REGRESIÓN CONNECT NO-WHATSAPP ══════════════════════════════════════
describe("M-3 · Connect no-WhatsApp conserva su comportamiento", () => {
  it.each(["dm", "group"])("`%s` no muestra leyendas de WhatsApp", (kind) => {
    const t = montar({ kind, initialMessages: [mensaje()] });
    for (const leyenda of ["pendiente de confirmación", "sin registro de envío"]) {
      expect(t).not.toContain(leyenda);
    }
    expect(t).toContain("hola mundo");
  });

  it("una proyección WhatsApp adherida a un `dm` NO cambia su pintado", () => {
    // La hidratación descarta la proyección cuando el kind no es whatsapp.
    const t = montar({
      kind: "dm",
      initialMessages: [mensaje({ wa: proj({ providerState: "failed" }) } as never)],
    });
    expect(t).not.toContain("no se pudo enviar");
    expect(t).toMatch(/\d{2}:\d{2}/);
  });
});

// ══ CLOSEOUT · §4.F · DOBLE ENVÍO ══════════════════════════════════════════
/**
 * El riesgo material: un operador impaciente hace doble clic en Enviar y salen
 * DOS mensajes de WhatsApp al cliente. Es la clase de defecto que ninguna
 * prueba de lógica pura detecta, porque vive en el ciclo de render — la guarda
 * es el estado `sending` y sólo se puede medir sobre el componente montado.
 */
describe("M-3 · §4.F · un doble clic no produce dos envíos", () => {
  /** El botón real del composer, buscado por su etiqueta accesible. */
  const botonEnviar = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Enviar mensaje"]')!;

  /** Escribe en el composer disparando el evento que React escucha. */
  function escribir(texto: string) {
    const ta = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Escribir mensaje"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value",
    )!.set!;
    act(() => {
      setter.call(ta, texto);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("el botón existe y arranca deshabilitado sin texto", () => {
    montar({ kind: "whatsapp", initialMessages: [] });
    expect(botonEnviar()).toBeTruthy();
    expect(botonEnviar().disabled).toBe(true);
  });

  it("dos clics seguidos ⇒ UNA sola llamada de envío", async () => {
    montar({ kind: "whatsapp", initialMessages: [] });
    escribir("hola");
    expect(botonEnviar().disabled).toBe(false);

    // Dos clics dentro del mismo ciclo, como un doble clic real.
    await act(async () => {
      botonEnviar().click();
      botonEnviar().click();
    });

    expect(sendWhatsappTextAction).toHaveBeenCalledTimes(1);
    expect(postMessageAction).not.toHaveBeenCalled();
  });

  it("tres clics tampoco acumulan envíos", async () => {
    montar({ kind: "whatsapp", initialMessages: [] });
    escribir("hola");
    await act(async () => {
      botonEnviar().click();
      botonEnviar().click();
      botonEnviar().click();
    });
    expect(sendWhatsappTextAction).toHaveBeenCalledTimes(1);
  });

  it("Connect no-WhatsApp tiene la MISMA protección", async () => {
    montar({ kind: "dm", initialMessages: [] });
    escribir("nota");
    await act(async () => {
      botonEnviar().click();
      botonEnviar().click();
    });
    expect(postMessageAction).toHaveBeenCalledTimes(1);
    expect(sendWhatsappTextAction).not.toHaveBeenCalled();
  });

  it("tras enviar, el borrador queda vacío y el botón vuelve a deshabilitarse", async () => {
    montar({ kind: "whatsapp", initialMessages: [] });
    escribir("hola");
    await act(async () => { botonEnviar().click(); });
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Escribir mensaje"]')!.value,
    ).toBe("");
    expect(botonEnviar().disabled).toBe(true);
  });

  it("un segundo envío DELIBERADO, después del primero, sí procede", async () => {
    montar({ kind: "whatsapp", initialMessages: [] });
    escribir("uno");
    await act(async () => { botonEnviar().click(); });
    escribir("dos");
    await act(async () => { botonEnviar().click(); });
    // La guarda protege del doble clic, no del uso normal.
    expect(sendWhatsappTextAction).toHaveBeenCalledTimes(2);
  });

  it("`scrollIntoView` se invoca de verdad: el doble no oculta un error real", async () => {
    montar({ kind: "whatsapp", initialMessages: [mensaje()] });
    // El componente lo llama dentro de requestAnimationFrame.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ behavior: "smooth" });
  });
});

// ══ VISUAL · el composer de WhatsApp tiene AMBOS controles ═════════════════
/**
 * En Connect el composer ofrece dos acciones: dictar (voz → TEXTO) y enviar.
 * WhatsApp debe tener las mismas: el dictado produce texto, así que no roza el
 * contrato text-only del canal —lo que viaja a Meta sigue siendo texto—.
 *
 * `VoiceField` NO está gateado por `canSendAudio`: ese gate es para el mensaje
 * de AUDIO, que es otra cosa. Esta prueba fija que el envoltorio de dictado
 * envuelve al composer también en WhatsApp.
 */
describe("M-3 · el composer de WhatsApp conserva dictado y envío", () => {
  it("el campo de texto y el botón de enviar están presentes", () => {
    montar({ kind: "whatsapp", initialMessages: [] });
    expect(container.querySelector('textarea[aria-label="Escribir mensaje"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Enviar mensaje"]')).toBeTruthy();
  });

  it("el dictado NO depende de la capacidad de audio del canal", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/app/(app)/connect/_components/ThreadView.tsx"), "utf8",
    );
    // El envoltorio de dictado se monta siempre; el gate `canSendAudio` cubre
    // únicamente el botón de mensaje de audio.
    const voice = src.slice(src.indexOf("<VoiceField"), src.indexOf("</VoiceField>"));
    expect(voice).not.toContain("canSendAudio");
    expect(src).toMatch(/caps\.canSendAudio && recorder\.state/);
  });

  it("el botón de enviar identifica el canal por color", () => {
    montar({ kind: "whatsapp", initialMessages: [] });
    const b = container.querySelector('button[aria-label="Enviar mensaje"]')!;
    expect(b.className).toContain("btn-wa");
    expect(b.className).not.toContain("btn-nexus");
  });

  it("en Connect no-WhatsApp el botón conserva el color de Nexus", () => {
    montar({ kind: "dm", initialMessages: [] });
    const b = container.querySelector('button[aria-label="Enviar mensaje"]')!;
    expect(b.className).toContain("btn-nexus");
    expect(b.className).not.toContain("btn-wa");
  });

  it("el nombre del remitente aparece en TODOS los mensajes, propios incluidos", () => {
    const t = montar({ kind: "whatsapp", initialMessages: [
      mensaje({ id: "a", body: "mío", authorProfileId: "op-1", authorName: "Operador Uno" } as never),
      mensaje({ id: "b", body: "ajeno", seq: 2, authorProfileId: "otro", authorName: "Cliente Demo" } as never),
    ] });
    expect(t).toContain("Operador Uno");
    expect(t).toContain("Cliente Demo");
  });
});

// ══ WA-VIS-01 · la ayuda del composer se leía a medias ═════════════════════
/**
 * DEFECTO MEDIDO en la preaceptación visual: la ayuda de teclado viajaba dentro
 * del `placeholder`, en un textarea de UNA línea con `overflow-y:auto`. Alto
 * visible 36 px contra 75 px de contenido en WhatsApp —y 1050 px en Connect—:
 * el operador leía «Escribí un mensaje…  (Ente» y NUNCA se enteraba de que
 * Enter envía y Shift+Enter hace salto de línea.
 *
 * La ayuda sale del textarea y pasa a ser un elemento propio, asociado por
 * `aria-describedby` para que un lector de pantalla la anuncie al enfocar.
 *
 * No se toca la lógica de teclado: `onKeyDown` sigue igual.
 */
describe("WA-VIS-01 · la ayuda de teclado es legible y accesible", () => {
  const textarea = () =>
    container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Escribir mensaje"]')!;

  it.each(["whatsapp", "dm"])("`%s` · el placeholder es CORTO, sin la ayuda adentro", (kind) => {
    montar({ kind, initialMessages: [] });
    const ph = textarea().placeholder;
    expect(ph).toBe("Escribí un mensaje…");
    // Lo que causaba el corte: la ayuda embebida en el placeholder.
    expect(ph).not.toMatch(/Enter/);
    expect(ph).not.toMatch(/Shift/);
    expect(ph).not.toMatch(/menciona/);
    expect(ph.length).toBeLessThanOrEqual(24);
  });

  it.each(["whatsapp", "dm"])("`%s` · la ayuda existe FUERA del textarea", (kind) => {
    const t = montar({ kind, initialMessages: [] });
    expect(t).toContain("Enter para enviar");
    expect(t).toContain("Shift+Enter para salto de línea");
    // Y no está dentro del campo: el textarea no tiene texto propio.
    expect(textarea().textContent ?? "").not.toContain("Enter para enviar");
  });

  it.each(["whatsapp", "dm"])("`%s` · el textarea la referencia con aria-describedby", (kind) => {
    montar({ kind, initialMessages: [] });
    const id = textarea().getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    const ayuda = container.querySelector(`#${id}`);
    expect(ayuda).toBeTruthy();
    expect(ayuda!.textContent).toContain("Enter para enviar");
    expect(ayuda!.textContent).toContain("Shift+Enter para salto de línea");
  });

  it("la ayuda NO está oculta por CSS: es texto realmente visible", () => {
    montar({ kind: "whatsapp", initialMessages: [] });
    const id = textarea().getAttribute("aria-describedby")!;
    const ayuda = container.querySelector<HTMLElement>(`#${id}`)!;
    // Nada de `hidden`, `display:none`, `sr-only` ni altura cero: la corrección
    // tiene que verse, no esconderse para que pasen las capturas.
    expect(ayuda.hidden).toBe(false);
    expect(ayuda.className).not.toMatch(/\bhidden\b|\bsr-only\b/);
    expect(ayuda.getAttribute("aria-hidden")).toBeNull();
  });

  it("el textarea ya no necesita desbordar para mostrar su placeholder", () => {
    montar({ kind: "whatsapp", initialMessages: [] });
    // El placeholder corto entra en una línea; el largo era el que forzaba el
    // recorte. Se afirma sobre su longitud, que es lo que jsdom sí modela.
    expect(textarea().placeholder.length).toBeLessThan(30);
    expect(textarea().rows).toBe(1);
  });

  it("la lógica de teclado NO cambió: Enter envía, Shift+Enter no", async () => {
    montar({ kind: "whatsapp", initialMessages: [] });
    const ta = textarea();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value",
    )!.set!;
    act(() => {
      setter.call(ta, "hola");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Shift+Enter no envía.
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });
    expect(sendWhatsappTextAction).not.toHaveBeenCalled();

    // Enter solo, sí.
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(sendWhatsappTextAction).toHaveBeenCalledTimes(1);
  });
});

describe("H-1 · el adjunto llega al HILO, no sólo al componente", () => {
  it("un mensaje con archivo deja de ser texto suelto y ofrece cómo abrirlo", async () => {
    // Éste es el caso que fallaba en producción: la burbuja mostraba
    // `📎 remito.pdf` y NADA más. Sin rama para el adjunto no hay control
    // alguno en el DOM, y esta prueba no puede pasar.
    await act(async () => {
      montar({
        kind: "dm",
        initialMessages: [
          mensaje({
            kind: "file" as never,
            body: "📎 remito.pdf",
            attachments: [{
              id: "att-9", fileName: "remito.pdf", mimeType: "application/pdf",
              fileSize: 2048, scanStatus: "clean",
            }],
          }),
        ],
      });
    });

    // El pie sigue estando…
    expect(container.textContent).toContain("remito.pdf");
    // …y ahora hay una forma REAL de abrirlo, con su tamaño a la vista.
    expect(container.textContent).toContain("2 KB");
    const botones = [...container.querySelectorAll("button")]
      .map((b) => b.textContent ?? "");
    expect(botones.some((t) => /Descargar/i.test(t))).toBe(true);
  });
});

// ── INC-04-R2 · UN COMPOSER BLOQUEADO TIENE QUE DECIR POR QUÉ ──────────────
//
// Ésta es la prueba del silencio, y es la que importa más allá de `task`.
//
// Cuando el kind quedó fuera del universo cerrado, `composerCapabilities`
// devolvió NONE y `send()` retornó sin efecto y SIN SEÑAL: el botón `disabled`
// y ningún cartel. El usuario escribía, apretaba, y no pasaba nada. Por eso el
// defecto duró ocho días con 22 conversaciones rotas: no había qué reportar
// más allá de «no anda».
//
// El arreglo de fondo no es agregar `task` —eso lo arregla UNA vez—: es que el
// PRÓXIMO kind que alguien agregue por migración se anuncie solo en pantalla.
describe("INC-04-R2 · el composer bloqueado se explica en pantalla", () => {
  it("un kind que el código no conoce muestra el motivo, no un composer mudo", () => {
    const texto = montar({ kind: "kind-que-no-existe-todavia", initialMessages: [] });
    expect(texto).toMatch(/no se pudo determinar el tipo de conversación/i);
  });

  it("y no deja un campo de texto que promete un envío que no va a ocurrir", () => {
    montar({ kind: "kind-que-no-existe-todavia", initialMessages: [] });
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("un kind conocido SÍ muestra el composer: el aviso no aparece de más", () => {
    const texto = montar({ kind: "task", initialMessages: [] });
    expect(texto).not.toMatch(/no se pudo determinar el tipo de conversación/i);
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});
