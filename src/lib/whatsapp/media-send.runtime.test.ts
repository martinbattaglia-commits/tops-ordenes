/**
 * H2 · NEXUS LINK FASE B — prueba de RUNTIME del `media-send.ts` productivo.
 *
 * Mismo método que `reply.runtime.test.ts` (M-2): se IMPORTA el módulo real y
 * se observan sus llamadas con dobles de frontera tipados, no se relee su
 * texto. Lo que se prueba es la COSTURA — que reutiliza `createSupabaseReplyPorts`
 * (el mismo CAS que ya usa el texto, no uno nuevo), que el cliente de sesión y
 * el admin no se intercambian, que el transporte de media se arma con las
 * variables de entorno reales, y que un transporte inyectado por el llamador
 * reemplaza al real sin que se construya ninguno de más.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const CLIENTE_SESION = { __marca: "sesion" } as const;
const CLIENTE_ADMIN = { __marca: "admin", storage: { from: vi.fn() } } as const;

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

const TRANSPORTE_MEDIA = { __marca: "transporte-media" } as const;
const createMetaMediaTransport = vi.fn((_cfg?: unknown) => TRANSPORTE_MEDIA as unknown);
vi.mock("./media-transport", () => ({
  createMetaMediaTransport: (c: unknown) => createMetaMediaTransport(c as never),
}));

const STATE_PORT = { __marca: "state" } as const;
const ACTOR_AUTORIZADO = { id: "22222222-2222-4222-8222-222222222222" } as const;
const SESSION_PORT = { getActor: vi.fn(async () => ACTOR_AUTORIZADO as { id: string } | null) };
const OPERATORS_PORT = { isAuthorized: vi.fn((_id: string) => true) };
const AUDIT_PORT = { record: vi.fn(async (_action: string, _payload: Record<string, unknown>) => true) };
const PORTS_COMPLETOS = {
  state: STATE_PORT,
  session: SESSION_PORT,
  operators: OPERATORS_PORT,
  audit: AUDIT_PORT,
} as const;
const createSupabaseReplyPorts = vi.fn((_deps: unknown) => PORTS_COMPLETOS as unknown);
vi.mock("./reply.supabase", () => ({
  createSupabaseReplyPorts: (d: unknown) => createSupabaseReplyPorts(d),
}));

const RESULTADO = { ok: true, state: "sent", wamid: "wamid.TEST" } as const;
const sendWhatsappMedia = vi.fn(async (_input: unknown, _ports: unknown) => RESULTADO as unknown);
vi.mock("./media-send-core", () => ({
  sendWhatsappMedia: (i: unknown, p: unknown) => sendWhatsappMedia(i, p),
}));

import { sendWhatsappMediaForAttachment } from "./media-send";

const INPUT = {
  messageId: "11111111-1111-4111-8111-111111111111",
  to: "+5491131079124",
  bucket: "connect-files",
  path: "conv/files/archivo.jpg",
  mimeType: "image/jpeg",
  fileName: "remito.jpg",
};

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockReturnValue(CLIENTE_SESION as unknown);
  createAdminClient.mockReturnValue(CLIENTE_ADMIN as unknown);
  createSupabaseReplyPorts.mockReturnValue(PORTS_COMPLETOS as unknown);
  sendWhatsappMedia.mockResolvedValue(RESULTADO as unknown);
  SESSION_PORT.getActor.mockResolvedValue(ACTOR_AUTORIZADO as { id: string } | null);
  OPERATORS_PORT.isAuthorized.mockReturnValue(true);
  AUDIT_PORT.record.mockResolvedValue(true);
});

describe("H2 · media-send.ts reutiliza el CAS del texto, no uno nuevo", () => {
  it("construye los ports completos UNA vez y usa sólo `.state`", async () => {
    await sendWhatsappMediaForAttachment(INPUT);
    expect(createSupabaseReplyPorts).toHaveBeenCalledTimes(1);
    const [, ports] = sendWhatsappMedia.mock.calls[0] as [unknown, { state: unknown }];
    // El MISMO objeto `.state` que devolvió la factory: no se reconstruye.
    expect(ports.state).toBe(STATE_PORT);
  });

  it("el core de media se invoca EXACTAMENTE una vez, con el input recibido", async () => {
    await sendWhatsappMediaForAttachment(INPUT);
    expect(sendWhatsappMedia).toHaveBeenCalledTimes(1);
    const [input] = sendWhatsappMedia.mock.calls[0] as [typeof INPUT, unknown];
    expect(input).toMatchObject(INPUT);
  });

  it("devuelve TAL CUAL lo que resolvió el core", async () => {
    const salida = await sendWhatsappMediaForAttachment(INPUT);
    expect(salida).toBe(RESULTADO);
  });

  it("sin cliente de sesión, no construye ports ni llama al core", async () => {
    createClient.mockReturnValue(null as unknown);
    const r = await sendWhatsappMediaForAttachment(INPUT);
    expect(r).toEqual({ ok: false, state: "failed", message: "Sin sesión." });
    expect(createSupabaseReplyPorts).not.toHaveBeenCalled();
    expect(sendWhatsappMedia).not.toHaveBeenCalled();
    expect(createMetaMediaTransport).not.toHaveBeenCalled();
  });

  it("sin cliente admin, no construye ports ni llama al core", async () => {
    createAdminClient.mockReturnValue(null as unknown);
    const r = await sendWhatsappMediaForAttachment(INPUT);
    expect(r).toEqual({ ok: false, state: "failed", message: "Sin cliente de servicio." });
    expect(sendWhatsappMedia).not.toHaveBeenCalled();
  });
});

describe("H2 · cliente de sesión y admin conservan su rol", () => {
  it("`supabase` es el de SESIÓN y `admin` el de service_role, y no se intercambian", async () => {
    await sendWhatsappMediaForAttachment(INPUT);
    const deps = createSupabaseReplyPorts.mock.calls[0][0] as { supabase: unknown; admin: unknown };
    expect(deps.supabase).toBe(CLIENTE_SESION);
    expect(deps.admin).toBe(CLIENTE_ADMIN);
    expect(deps.supabase).not.toBe(deps.admin);
  });
});

describe("H2 · el transporte de media se arma igual que el de texto", () => {
  it("createMetaMediaTransport se llama con las variables de entorno reales", async () => {
    const antes = { token: process.env.META_WA_TOKEN, phone: process.env.META_WA_PHONE_NUMBER_ID };
    process.env.META_WA_TOKEN = "token-de-prueba";
    process.env.META_WA_PHONE_NUMBER_ID = "phone-de-prueba";
    try {
      await sendWhatsappMediaForAttachment(INPUT);
      expect(createMetaMediaTransport).toHaveBeenCalledWith({
        token: "token-de-prueba", phoneNumberId: "phone-de-prueba",
      });
    } finally {
      process.env.META_WA_TOKEN = antes.token;
      process.env.META_WA_PHONE_NUMBER_ID = antes.phone;
    }
  });

  it("un transporte inyectado por el llamador REEMPLAZA al real, sin construir el real", async () => {
    const doble = { uploadMedia: vi.fn(), sendMedia: vi.fn() };
    await sendWhatsappMediaForAttachment(INPUT, { transport: doble as never });
    const [, ports] = sendWhatsappMedia.mock.calls[0] as [unknown, { transport: unknown }];
    expect(ports.transport).toBe(doble);
    expect(createMetaMediaTransport).not.toHaveBeenCalled();
  });

  it("el sandbox se consulta con el teléfono `to` recibido", async () => {
    await sendWhatsappMediaForAttachment(INPUT);
    const [, ports] = sendWhatsappMedia.mock.calls[0] as [unknown, { sandbox: { isAllowed: (p: string) => boolean } }];
    ports.sandbox.isAllowed(INPUT.to);
    expect(checkOutboundAllowed).toHaveBeenCalledWith(INPUT.to);
  });
});

describe("H2 · objects.read baja del bucket/path exactos y nunca inventa bytes", () => {
  it("pide EXACTAMENTE el bucket y el path recibidos", async () => {
    const download = vi.fn(async () => ({
      data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
      error: null,
    }));
    const from = vi.fn(() => ({ download }));
    createAdminClient.mockReturnValue({ storage: { from } } as unknown);

    await sendWhatsappMediaForAttachment(INPUT);
    const [, ports] = sendWhatsappMedia.mock.calls[0] as [
      unknown, { objects: { read(b: string, p: string): Promise<Uint8Array | null> } },
    ];
    const bytes = await ports.objects.read(INPUT.bucket, INPUT.path);
    expect(from).toHaveBeenCalledWith(INPUT.bucket);
    expect(download).toHaveBeenCalledWith(INPUT.path);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("un error de Storage devuelve null, nunca bytes parciales ni inventados", async () => {
    const download = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    createAdminClient.mockReturnValue({ storage: { from: () => ({ download }) } } as unknown);

    await sendWhatsappMediaForAttachment(INPUT);
    const [, ports] = sendWhatsappMedia.mock.calls[0] as [
      unknown, { objects: { read(b: string, p: string): Promise<Uint8Array | null> } },
    ];
    expect(await ports.objects.read(INPUT.bucket, INPUT.path)).toBeNull();
  });
});

describe("H2 · cero segundo egress y cero acceso alternativo", () => {
  it("si el core rechaza, la costura no reintenta ni construye un segundo transporte", async () => {
    sendWhatsappMedia.mockResolvedValue({ ok: false, state: "failed", message: "denied" } as unknown);
    const r = await sendWhatsappMediaForAttachment(INPUT);
    expect(r).toMatchObject({ ok: false, state: "failed" });
    expect(sendWhatsappMedia).toHaveBeenCalledTimes(1);
    expect(createMetaMediaTransport).toHaveBeenCalledTimes(1);
  });

  it("si el core lanza, la costura no lo traduce en un segundo intento", async () => {
    sendWhatsappMedia.mockRejectedValue(new Error("boom"));
    await expect(sendWhatsappMediaForAttachment(INPUT)).rejects.toThrow("boom");
    expect(sendWhatsappMedia).toHaveBeenCalledTimes(1);
  });

  it("la costura no consulta connect_messages por su cuenta: eso es del core y sus ports", async () => {
    const sesionEspiada = { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } };
    createClient.mockReturnValue(sesionEspiada as unknown);
    await sendWhatsappMediaForAttachment(INPUT);
    expect(sesionEspiada.from).not.toHaveBeenCalled();
    expect(sesionEspiada.rpc).not.toHaveBeenCalled();
  });
});

describe("H2 (hallazgo C4) · la allowlist de operadores se CONSULTA, no sólo se construye", () => {
  it("sin actor (getActor→null), falla antes de mirar la allowlist y no toca Meta", async () => {
    SESSION_PORT.getActor.mockResolvedValue(null);
    const r = await sendWhatsappMediaForAttachment(INPUT);
    expect(r).toEqual({ ok: false, state: "failed", message: "Sin sesión." });
    expect(OPERATORS_PORT.isAuthorized).not.toHaveBeenCalled();
    expect(sendWhatsappMedia).not.toHaveBeenCalled();
    expect(createMetaMediaTransport).not.toHaveBeenCalled();
  });

  it("actor autenticado pero fuera de la allowlist: falla, no construye transporte ni llama al core", async () => {
    OPERATORS_PORT.isAuthorized.mockReturnValue(false);
    const r = await sendWhatsappMediaForAttachment(INPUT);
    expect(r).toEqual({ ok: false, state: "failed", message: "No autorizado (operador)." });
    expect(OPERATORS_PORT.isAuthorized).toHaveBeenCalledWith(ACTOR_AUTORIZADO.id);
    expect(sendWhatsappMedia).not.toHaveBeenCalled();
    expect(createMetaMediaTransport).not.toHaveBeenCalled();
  });

  it("la denegación por operador queda auditada con el mismo vocabulario que usa el texto", async () => {
    OPERATORS_PORT.isAuthorized.mockReturnValue(false);
    await sendWhatsappMediaForAttachment(INPUT);
    expect(AUDIT_PORT.record).toHaveBeenCalledTimes(1);
    expect(AUDIT_PORT.record).toHaveBeenCalledWith("reply_denied", {
      reason: "not_operator",
      actor: ACTOR_AUTORIZADO.id,
    });
  });

  it("operador autorizado: la frontera se ejerce y el camino feliz sigue intacto", async () => {
    await sendWhatsappMediaForAttachment(INPUT);
    expect(SESSION_PORT.getActor).toHaveBeenCalledTimes(1);
    expect(OPERATORS_PORT.isAuthorized).toHaveBeenCalledWith(ACTOR_AUTORIZADO.id);
    expect(AUDIT_PORT.record).not.toHaveBeenCalled();
    expect(sendWhatsappMedia).toHaveBeenCalledTimes(1);
  });
});
