import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * LINK-WA 1B-1B · Prueba ESTRUCTURAL de pureza de los cores.
 *
 * Verifica sobre el texto fuente que los núcleos testeables no arrastren
 * dependencias globales ocultas, y que los adaptadores productivos sigan siendo
 * delgados. Es la garantía de que las pruebas con fakes prueban de verdad: un
 * core que leyera `process.env` o instanciara Supabase se testearía a medias.
 */

const root = process.cwd();

/**
 * Lee el fuente SIN comentarios: la prohibición es sobre el código, no sobre la
 * prosa. El encabezado de cada core dice literalmente «no lee `process.env`», y
 * escanear el texto crudo lo tomaría como violación.
 */
const read = (p: string) =>
  readFileSync(resolve(root, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const CORES = [
  "src/lib/whatsapp/reply-core.ts",
  "src/lib/whatsapp/inbound-core.ts",
  "src/lib/whatsapp/inbound.ts",
  "src/lib/whatsapp/outbound-state.ts",
  "src/lib/whatsapp/link-projection.ts",
  "src/lib/connect/realtime-merge.ts",
];

const ADAPTERS = [
  "src/lib/whatsapp/reply.ts",
  "src/app/api/whatsapp/webhook/route.ts",
];

describe("los cores no importan clientes Supabase", () => {
  it.each(CORES)("%s", (path) => {
    const src = read(path);
    expect(src).not.toMatch(/from\s+["']@\/lib\/supabase/);
    expect(src).not.toMatch(/@supabase\/supabase-js/);
    expect(src).not.toMatch(/\bcreateAdminClient\s*\(/);
    expect(src).not.toMatch(/\bcreateClient\s*\(/);
  });
});

describe("los cores no leen variables de entorno", () => {
  it.each(CORES)("%s", (path) => {
    expect(read(path)).not.toMatch(/process\.env/);
  });
});

describe("los cores no usan transporte real ni reloj global", () => {
  it.each(CORES)("%s", (path) => {
    const src = read(path);
    // `fetch(` directo. El tipo `typeof fetch` en la config del transporte no
    // es una llamada y vive fuera de los cores.
    expect(src).not.toMatch(/[^.\w]fetch\s*\(/);
    expect(src).not.toMatch(/\bnew Date\s*\(\s*\)/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
  });
});

describe("los adaptadores productivos son delgados", () => {
  it("reply.ts delega en executeReply y no reimplementa la decisión", () => {
    const src = read("src/lib/whatsapp/reply.ts");
    expect(src).toMatch(/executeReply\(/);
    // Sin lógica de decisión duplicada: el orden de guardas vive en el core.
    expect(src).not.toMatch(/blocksAutomaticResend\(/);
    expect(src).not.toMatch(/kind !== "whatsapp"/);
  });

  it("la route delega en handleInboundEvent", () => {
    const src = read("src/app/api/whatsapp/webhook/route.ts");
    expect(src).toMatch(/handleInboundEvent\(/);
    expect(src).not.toMatch(/isProjectionComplete\(/);
    // La decisión de retryable/processed ya no vive en la route.
    expect(src).not.toMatch(/retryable:\s*true/);
  });
});

describe("no existe un endpoint outbound público nuevo", () => {
  it("el inventario de endpoints está CERRADO y es explícito", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const dirs = readdirSync(resolve(root, "src/app/api/whatsapp"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    // WA-8R9 · M-4 agrega `inbound-queue`, que DRENA la cola de eventos
    // entrantes; no es una superficie de envío. El inventario sigue cerrado:
    // cualquier otro endpoint nuevo rompe esta prueba y exige una decisión.
    expect(dirs).toEqual(["inbound-queue", "ping", "send", "webhook"]);
  });

  it("el drenaje de la cola es AUTENTICADO y no puede enviar", () => {
    const src = read("src/app/api/whatsapp/inbound-queue/route.ts");
    // Fail-closed por la misma guarda que el resto de los crons.
    expect(src).toMatch(/requireCronAuth\(/);
    // Y cero egress: no arma transporte, no llama a Meta, no responde nada
    // que dependa del contenido del evento.
    expect(src).not.toMatch(/createMetaHttpTransport|sendText|graph\.facebook/);
    expect(src).not.toMatch(/[^.\w]fetch\s*\(/);
  });

  it("reply.ts no expone un route handler", () => {
    const src = read("src/lib/whatsapp/reply.ts");
    expect(src).not.toMatch(/export\s+async\s+function\s+(GET|POST|PUT|DELETE)\b/);
  });
});
