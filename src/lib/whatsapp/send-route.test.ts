/**
 * NEXUS LINK · FASE B — `/api/whatsapp/send` como frontera M2M.
 *
 * ─── QUÉ ES ESTE ENDPOINT Y QUÉ NO ES ──────────────────────────────────────
 *
 * NO es el camino del composer. El operador que responde un hilo pasa por
 * `sendWhatsappTextAction`, una Server Action con sesión, frontera de canal
 * (0236) y estado de outbound con CAS. Este endpoint es la vía MÁQUINA A
 * MÁQUINA —crons, integraciones internas—, y su única credencial es un secreto
 * compartido. Por eso lo que hay que demostrar acá es distinto: que el secreto
 * mande, que un cuerpo mal formado no llegue a Meta, y que ni la respuesta ni
 * los logs devuelvan el secreto que se les envió.
 *
 * Meta, Supabase y el reloj son dobles: esta suite NUNCA hace egress.
 *
 * ─── POR QUÉ VIVE ACÁ Y NO JUNTO AL ROUTE ─────────────────────────────────
 *
 * El `include` de vitest cubre `src/lib/whatsapp/**`, no `src/app/api/whatsapp/**`.
 * Colocar el archivo al lado del handler habría exigido tocar el config del
 * arnés — y el config es exactamente lo que el invariante de Custodia protege.
 * La ubicación cambia el DESCUBRIMIENTO del test, no lo que puede importar: el
 * handler bajo prueba sigue siendo el productivo, alcanzado por su ruta real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendText = vi.fn();
const sendTemplate = vi.fn();
const helloWorld = vi.fn();
const ocFirmada = vi.fn();
const configurado = vi.fn(() => true);
const auditInsert = vi.fn(async (_fila: Record<string, unknown>) => ({ error: null }));

vi.mock("@/lib/whatsapp/meta", () => ({
  sendText: (a: unknown) => sendText(a),
  sendTemplate: (a: unknown) => sendTemplate(a),
  templates: {
    helloWorld: (a: unknown) => helloWorld(a),
    ocFirmada: (a: unknown) => ocFirmada(a),
  },
  isWhatsappConfigured: () => configurado(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: () => ({ insert: auditInsert }) }),
}));

import { POST } from "@/app/api/whatsapp/send/route";
import * as ruta from "@/app/api/whatsapp/send/route";

const SECRETO = "s3cr3t0-de-pruebas-nunca-real";
const INTERNO = "5491131079124";

function pedido(body: unknown, auth?: string): Request {
  return new Request("https://nexus.test/api/whatsapp/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth === undefined ? {} : { authorization: auth }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Todo lo que el proceso escribió por consola durante el caso. */
let consola: string[] = [];

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", SECRETO);
  vi.stubEnv("WHATSAPP_SANDBOX", "1");
  vi.stubEnv("WHATSAPP_SANDBOX_ALLOWLIST", INTERNO);
  sendText.mockReset().mockResolvedValue({ ok: true, messageId: "wamid.X", provider: "meta" });
  sendTemplate.mockReset().mockResolvedValue({ ok: true, messageId: "wamid.T", provider: "meta" });
  helloWorld.mockReset().mockResolvedValue({ ok: true, messageId: "wamid.H", provider: "meta" });
  ocFirmada.mockReset().mockResolvedValue({ ok: true, messageId: "wamid.O", provider: "meta" });
  configurado.mockReturnValue(true);
  auditInsert.mockClear();
  consola = [];
  for (const nivel of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => {
      consola.push(a.map((x) => String(x)).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ═════════════════════════ credencial ═════════════════════════

describe("credencial · fail-closed en los tres estados", () => {
  it("SIN secreto en la request ⇒ 401 y nada sale a Meta", async () => {
    const r = await POST(pedido({ kind: "text", to: INTERNO, text: "hola" }));
    expect(r.status).toBe(401);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("con secreto EQUIVOCADO ⇒ 401 y nada sale a Meta", async () => {
    const r = await POST(pedido({ kind: "text", to: INTERNO, text: "hola" }, "Bearer otro-secreto"));
    expect(r.status).toBe(401);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("con el secreto CORRECTO ⇒ pasa y despacha", async () => {
    const r = await POST(pedido({ kind: "text", to: INTERNO, text: "hola" }, `Bearer ${SECRETO}`));
    expect(r.status).toBe(200);
    expect(sendText).toHaveBeenCalledWith({ to: INTERNO, text: "hola" });
  });

  it("el prefijo Bearer es parte del secreto: mandarlo pelado NO alcanza", async () => {
    const r = await POST(pedido({ kind: "text", to: INTERNO, text: "hola" }, SECRETO));
    expect(r.status).toBe(401);
  });

  it("sin CRON_SECRET configurado ⇒ 503, no 200: la ausencia NO abre el endpoint", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const r = await POST(pedido({ kind: "text", to: INTERNO, text: "hola" }, `Bearer ${SECRETO}`));
    expect(r.status).toBe(503);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("WHATSAPP_SEND_SECRET, si existe, DESPLAZA a CRON_SECRET", async () => {
    vi.stubEnv("WHATSAPP_SEND_SECRET", "propio-del-endpoint");
    // El secreto de cron deja de servir…
    expect((await POST(pedido({ kind: "text", to: INTERNO, text: "h" }, `Bearer ${SECRETO}`))).status)
      .toBe(401);
    // …y sirve el propio.
    expect((await POST(pedido({ kind: "text", to: INTERNO, text: "h" }, "Bearer propio-del-endpoint"))).status)
      .toBe(200);
  });

  it("la credencial se evalúa ANTES que la configuración de WhatsApp", async () => {
    // Si el orden se invirtiera, un anónimo podría distinguir un despliegue
    // configurado de uno que no lo está — un oráculo gratis.
    configurado.mockReturnValue(false);
    expect((await POST(pedido({ kind: "text", to: INTERNO, text: "h" }))).status).toBe(401);
  });
});

// ═════════════════════════ método ═════════════════════════

describe("método", () => {
  it("el módulo expone SÓLO POST: cualquier otro verbo lo rechaza el router", () => {
    // En Next un verbo sin handler exportado devuelve 405 sin ejecutar código
    // nuestro. Lo que sí podemos —y debemos— fijar es que no exista ningún otro
    // handler: agregar un GET a este endpoint tiene que costar romper una prueba.
    const verbos = ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    for (const v of verbos) {
      expect(v in ruta).toBe(false);
    }
    expect(typeof ruta.POST).toBe("function");
  });

  it("declara runtime nodejs y dinámico: el secreto nunca se hornea en una respuesta cacheada", () => {
    expect(ruta.runtime).toBe("nodejs");
    expect(ruta.dynamic).toBe("force-dynamic");
  });
});

// ═════════════════════════ payload ═════════════════════════

describe("payload inválido · nada llega a Meta", () => {
  const auth = `Bearer ${SECRETO}`;

  it.each([
    ["cuerpo no JSON", "esto no es json"],
    ["cuerpo vacío", ""],
    ["sin kind", { to: INTERNO, text: "h" }],
    ["sin to", { kind: "text", text: "h" }],
    ["null", null],
  ])("%s ⇒ 400", async (_l, body) => {
    const r = await POST(pedido(body as unknown, auth));
    expect(r.status).toBe(400);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("`to` que no es E.164 ⇒ 400", async () => {
    const r = await POST(pedido({ kind: "text", to: "no-es-un-numero", text: "h" }, auth));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ ok: false });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("kind desconocido ⇒ 400, sin caer en un default permisivo", async () => {
    const r = await POST(pedido({ kind: "sms", to: INTERNO, text: "h" }, auth));
    expect(r.status).toBe(400);
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("un destino FUERA de la allowlist del sandbox ⇒ 403 y queda auditado", async () => {
    const r = await POST(pedido({ kind: "text", to: "5491199999999", text: "h" }, auth));
    expect(r.status).toBe(403);
    expect(sendText).not.toHaveBeenCalled();
    expect(auditInsert).toHaveBeenCalledTimes(1);
    // La auditoría guarda el `kind`, NO el número ni el texto.
    const fila = JSON.stringify(auditInsert.mock.calls[0]?.[0] ?? {});
    expect(fila).not.toContain("5491199999999");
    expect(fila).not.toContain("\"h\"");
  });

  it("un fallo de Meta se propaga como 502, no como 200", async () => {
    sendText.mockResolvedValue({ ok: false, error: "ventana de 24 h cerrada", provider: "meta" });
    const r = await POST(pedido({ kind: "text", to: INTERNO, text: "h" }, auth));
    expect(r.status).toBe(502);
  });
});

// ═════════════════════════ no filtrar secretos ═════════════════════════

describe("el endpoint no devuelve ni registra secretos", () => {
  const contieneSecreto = (s: string) =>
    s.includes(SECRETO) || s.includes("token-de-meta") || s.includes("service_role");

  it("ninguna respuesta —200, 400, 401, 403, 503— contiene el secreto", async () => {
    vi.stubEnv("META_WA_TOKEN", "token-de-meta");
    const casos: Array<[unknown, string | undefined]> = [
      [{ kind: "text", to: INTERNO, text: "h" }, `Bearer ${SECRETO}`],
      [{ kind: "text", to: INTERNO, text: "h" }, `Bearer ${SECRETO}-mal`],
      [{ kind: "text", to: INTERNO, text: "h" }, undefined],
      [{ kind: "nope", to: INTERNO }, `Bearer ${SECRETO}`],
      [{ kind: "text", to: "5491199999999", text: "h" }, `Bearer ${SECRETO}`],
      ["no json", `Bearer ${SECRETO}`],
    ];
    for (const [body, auth] of casos) {
      const r = await POST(pedido(body, auth));
      expect(contieneSecreto(await r.text())).toBe(false);
    }
  });

  it("tampoco los deja en la consola, ni siquiera al auditar un rechazo", async () => {
    auditInsert.mockRejectedValue(new Error("supabase caído"));
    await POST(pedido({ kind: "text", to: "5491199999999", text: "h" }, `Bearer ${SECRETO}`));
    // El fallo de auditoría SÍ se registra —silenciarlo sería peor—, pero sin
    // arrastrar la credencial de la request.
    expect(consola.length).toBeGreaterThan(0);
    expect(consola.some(contieneSecreto)).toBe(false);
  });

  it("una excepción del proveedor no devuelve el cuerpo de la request", async () => {
    sendText.mockRejectedValue(new Error("boom"));
    const r = await POST(pedido({ kind: "text", to: INTERNO, text: "dato sensible del cliente" }, `Bearer ${SECRETO}`));
    expect(r.status).toBe(500);
    const cuerpo = await r.text();
    expect(cuerpo).not.toContain("dato sensible del cliente");
    expect(contieneSecreto(cuerpo)).toBe(false);
  });
});
