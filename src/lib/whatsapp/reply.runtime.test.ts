/**
 * M-2 · LINK-WA WA-8R9 — prueba de RUNTIME del `reply.ts` productivo.
 *
 * ─── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * `reply.ts` es la costura: obtiene dependencias, construye los ports y llama
 * al core. Hasta acá sólo estaba cubierto por aserciones sobre su TEXTO —una
 * expresión regular que buscaba `executeReply(`—. Eso no prueba nada sobre lo
 * que ocurre al ejecutarlo: no detecta que se construyan los ports dos veces,
 * que se llame al core dos veces, que se intercambien el cliente de sesión y el
 * admin, o que una denegación igual dispare un egress.
 *
 * El incidente histórico que este archivo debe volver imposible: una versión
 * previa de `reply.ts` cableaba los ports EN LÍNEA, duplicando la lógica de
 * consulta, y arrastraba el selector PostgREST roto `meta->wa>>status`. La
 * prueba estructural no lo vio porque el texto seguía conteniendo lo que
 * buscaba.
 *
 * Acá se IMPORTA el módulo real y se observan sus llamadas. Las dependencias de
 * frontera —Supabase, transporte HTTP— se sustituyen por dobles tipados; el
 * módulo bajo prueba es el productivo, sin modificar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── Dobles de frontera ─────────────────────────────────────────────────────
/** Marcas de identidad: permiten probar que NO se intercambian los clientes. */
const CLIENTE_SESION = { __marca: "sesion" } as const;
const CLIENTE_ADMIN = { __marca: "admin" } as const;

const createClient = vi.fn(() => CLIENTE_SESION as unknown);
const createAdminClient = vi.fn(() => CLIENTE_ADMIN as unknown);
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...a: unknown[]) => createClient(...(a as [])),
  createAdminClient: (...a: unknown[]) => createAdminClient(...(a as [])),
}));

const checkOutboundAllowed = vi.fn((_phone: string) => ({ allowed: true }));
vi.mock("./sandbox", () => ({
  checkOutboundAllowed: (p: string) => checkOutboundAllowed(p),
}));

const parseOperatorProfileIds = vi.fn(() => ({ ids: ["op-1"] }));
const isOperatorAuthorized = vi.fn((_id: string, _ids: string[]) => true);
vi.mock("./operators", () => ({
  parseOperatorProfileIds: () => parseOperatorProfileIds(),
  isOperatorAuthorized: (id: string, ids: string[]) => isOperatorAuthorized(id, ids),
}));

const TRANSPORTE_HTTP = { __marca: "transporte-http" } as const;
const createMetaHttpTransport = vi.fn((_cfg?: unknown) => TRANSPORTE_HTTP as unknown);
vi.mock("./transport", () => ({
  createMetaHttpTransport: (c: unknown) => createMetaHttpTransport(c as never),
}));

/** Ports fabricados: se guarda el objeto EXACTO de dependencias recibido. */
type DepsRecibidas = {
  supabase: unknown; admin: unknown;
  isOperator: (id: string) => boolean;
  isSandboxAllowed: (phone: string) => boolean;
  clock: { now: () => string };
  transport: unknown;
};
const PORTS = { __marca: "ports" } as const;
const createSupabaseReplyPorts = vi.fn((_deps: DepsRecibidas) => PORTS as unknown);
vi.mock("./reply.supabase", () => ({
  createSupabaseReplyPorts: (d: DepsRecibidas) => createSupabaseReplyPorts(d),
}));

const RESULTADO = { ok: true, code: "sent", messageId: "m-1" } as const;
const executeReply = vi.fn(async (_input: unknown, _ports: unknown) => RESULTADO as unknown);
vi.mock("./reply-core", () => ({
  executeReply: (i: unknown, p: unknown) => executeReply(i, p),
  isValidWhatsappText: (t: string) => t.length > 0,
  isValidClientMsgId: (t: string) => t.length > 0,
  normalizeWhatsappText: (t: string) => t,
  counterpartPhoneFromContext: (c: string) => c,
}));

import { replyToWhatsappThread } from "./reply";

const INPUT = {
  conversationId: "11111111-1111-4111-8111-111111111111",
  body: "hola",
  clientMsgId: "22222222-2222-4222-8222-222222222222",
};

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockReturnValue(CLIENTE_SESION as unknown);
  createAdminClient.mockReturnValue(CLIENTE_ADMIN as unknown);
  executeReply.mockResolvedValue(RESULTADO as unknown);
});

// ══ 1 · CARDINALIDAD DE LA COSTURA ═════════════════════════════════════════
describe("M-2 · reply.ts construye una vez y delega una vez", () => {
  it("la factory de ports se construye EXACTAMENTE una vez", async () => {
    await replyToWhatsappThread(INPUT as never);
    expect(createSupabaseReplyPorts).toHaveBeenCalledTimes(1);
  });

  it("el core se invoca EXACTAMENTE una vez, con esos ports", async () => {
    await replyToWhatsappThread(INPUT as never);
    expect(executeReply).toHaveBeenCalledTimes(1);
    const [input, ports] = executeReply.mock.calls[0];
    expect(input).toBe(INPUT);
    // El MISMO objeto que devolvió la factory: no se reconstruye ni se copia.
    expect(ports).toBe(PORTS);
  });

  it("el transporte HTTP se construye a lo sumo una vez", async () => {
    await replyToWhatsappThread(INPUT as never);
    expect(createMetaHttpTransport.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("una segunda llamada NO acumula ports ni cores en la misma corrida", async () => {
    await replyToWhatsappThread(INPUT as never);
    await replyToWhatsappThread(INPUT as never);
    // Dos invocaciones ⇒ exactamente dos de cada, nunca cuatro.
    expect(createSupabaseReplyPorts).toHaveBeenCalledTimes(2);
    expect(executeReply).toHaveBeenCalledTimes(2);
  });

  it("devuelve TAL CUAL lo que resolvió el core, sin reinterpretarlo", async () => {
    const salida = await replyToWhatsappThread(INPUT as never);
    expect(salida).toBe(RESULTADO);
  });
});

// ══ 2 · LOS CLIENTES NO SE INTERCAMBIAN ════════════════════════════════════
describe("M-2 · cliente de sesión y cliente admin conservan su rol", () => {
  it("`supabase` es el de SESIÓN y `admin` el de service_role", async () => {
    await replyToWhatsappThread(INPUT as never);
    const deps = createSupabaseReplyPorts.mock.calls[0][0];
    // Si se intercambiaran, el egress correría con permisos del operador o las
    // lecturas de estado perderían el bypass: ambos son fallos de seguridad.
    expect(deps.supabase).toBe(CLIENTE_SESION);
    expect(deps.admin).toBe(CLIENTE_ADMIN);
    expect(deps.supabase).not.toBe(deps.admin);
  });

  it("sin cliente de sesión NO se construyen ports ni se llama al core", async () => {
    createClient.mockReturnValue(null as unknown);
    const r = await replyToWhatsappThread(INPUT as never);

    expect(r).toMatchObject({ ok: false, code: "no_session" });
    expect(createSupabaseReplyPorts).not.toHaveBeenCalled();
    expect(executeReply).not.toHaveBeenCalled();
    // Y sin egress: ni siquiera se arma el transporte.
    expect(createMetaHttpTransport).not.toHaveBeenCalled();
  });
});

// ══ 3 · SESIÓN, RBAC, ALLOWLIST Y SANDBOX SE CONSERVAN ═════════════════════
describe("M-2 · las guardas llegan al core, no se evalúan en la costura", () => {
  it("la allowlist de operadores se resuelve UNA vez y se inyecta", async () => {
    await replyToWhatsappThread(INPUT as never);
    expect(parseOperatorProfileIds).toHaveBeenCalledTimes(1);

    const deps = createSupabaseReplyPorts.mock.calls[0][0];
    deps.isOperator("perfil-x");
    // El puerto delega en la allowlist REAL, con los ids parseados.
    expect(isOperatorAuthorized).toHaveBeenCalledWith("perfil-x", ["op-1"]);
  });

  it("el sandbox se consulta a través del puerto, con el teléfono recibido", async () => {
    await replyToWhatsappThread(INPUT as never);
    const deps = createSupabaseReplyPorts.mock.calls[0][0];
    deps.isSandboxAllowed("+000000000");
    expect(checkOutboundAllowed).toHaveBeenCalledWith("+000000000");
  });

  it("un operador NO autorizado se refleja en el puerto, no en la costura", async () => {
    isOperatorAuthorized.mockReturnValue(false);
    await replyToWhatsappThread(INPUT as never);
    const deps = createSupabaseReplyPorts.mock.calls[0][0];
    // La costura no decide: entrega la función y el core la consulta.
    expect(deps.isOperator("quien-sea")).toBe(false);
  });

  it("un destino fuera del sandbox se refleja igual", async () => {
    checkOutboundAllowed.mockReturnValue({ allowed: false });
    await replyToWhatsappThread(INPUT as never);
    const deps = createSupabaseReplyPorts.mock.calls[0][0];
    expect(deps.isSandboxAllowed("+000000000")).toBe(false);
  });

  it("el reloj se inyecta y produce un instante ISO-UTC canónico", async () => {
    await replyToWhatsappThread(INPUT as never);
    const deps = createSupabaseReplyPorts.mock.calls[0][0];
    expect(deps.clock.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("el transporte inyectado por el llamador REEMPLAZA al HTTP real", async () => {
    const doble = { sendText: vi.fn() };
    await replyToWhatsappThread(INPUT as never, { transport: doble as never });
    const deps = createSupabaseReplyPorts.mock.calls[0][0];
    expect(deps.transport).toBe(doble);
    // Y no se construye el transporte real: cero riesgo de egress accidental.
    expect(createMetaHttpTransport).not.toHaveBeenCalled();
  });
});

// ══ 4 · CERO SEGUNDO EGRESS Y CERO ACCESO ALTERNATIVO ══════════════════════
describe("M-2 · ningún camino alternativo al core", () => {
  it("la costura no envía por su cuenta: el transporte sólo se ENTREGA", async () => {
    await replyToWhatsappThread(INPUT as never);
    // El transporte construido nunca se usa acá; su único consumidor es el core
    // a través de los ports. Si la costura enviara, `sendText` existiría y se
    // habría llamado.
    expect(createMetaHttpTransport).toHaveBeenCalledTimes(1);
    const deps = createSupabaseReplyPorts.mock.calls[0][0];
    expect(deps.transport).toBe(TRANSPORTE_HTTP);
  });

  it("si el core rechaza, la costura NO reintenta ni envía", async () => {
    executeReply.mockResolvedValue({ ok: false, code: "denied" } as unknown);
    const r = await replyToWhatsappThread(INPUT as never);
    expect(r).toMatchObject({ ok: false, code: "denied" });
    expect(executeReply).toHaveBeenCalledTimes(1);
    expect(createSupabaseReplyPorts).toHaveBeenCalledTimes(1);
  });

  it("si el core lanza, la costura no lo traduce en un segundo intento", async () => {
    executeReply.mockRejectedValue(new Error("boom"));
    await expect(replyToWhatsappThread(INPUT as never)).rejects.toThrow("boom");
    expect(executeReply).toHaveBeenCalledTimes(1);
  });

  it("no crea clientes Supabase de más: uno de sesión y uno admin", async () => {
    await replyToWhatsappThread(INPUT as never);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createAdminClient).toHaveBeenCalledTimes(1);
  });
});

// ══ 5 · EL INCIDENTE HISTÓRICO NO PUEDE REAPARECER ═════════════════════════
describe("M-2 · el cableado inline duplicado queda cerrado", () => {
  it("la costura NO consulta Supabase por su cuenta", async () => {
    // Los clientes se entregan a la factory sin haber sido usados. Si `reply.ts`
    // volviera a cablear consultas inline —el defecto que arrastraba el selector
    // roto `meta->wa>>status`— tendría que invocarlos acá.
    const sesionEspiada = { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } };
    const adminEspiado = { from: vi.fn(), rpc: vi.fn() };
    createClient.mockReturnValue(sesionEspiada as unknown);
    createAdminClient.mockReturnValue(adminEspiado as unknown);

    await replyToWhatsappThread(INPUT as never);

    expect(sesionEspiada.from).not.toHaveBeenCalled();
    expect(sesionEspiada.rpc).not.toHaveBeenCalled();
    expect(sesionEspiada.auth.getUser).not.toHaveBeenCalled();
    expect(adminEspiado.from).not.toHaveBeenCalled();
    expect(adminEspiado.rpc).not.toHaveBeenCalled();
  });

  it("el módulo no contiene el selector PostgREST roto", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/lib/whatsapp/reply.ts"), "utf8");
    // Complemento estructural del comportamiento de arriba, no su sustituto.
    expect(src).not.toContain("wa>>");
    expect(src).not.toMatch(/\.from\(\s*["']connect_messages["']\s*\)/);
  });
});
