/**
 * capture-bridge.ts — UX-1 · contrato del Capture Bridge (CB-2).
 *
 * El host llama a `window.__nexusCapture()` del artefacto (same-origin) y obtiene
 * un payload crudo. Acá se valida (Zod) y normaliza a QuoteCapture / ProposalCapture,
 * que se persisten en crm_quotes(+items) / crm_proposals.
 *
 * Transport-agnostic: la misma forma sirve venga de lectura directa (hoy) o de
 * postMessage (si los tools pasan a otro origen). PURO (sin Supabase).
 */

import { z } from "zod";

export const QuoteItemSchema = z.object({
  concepto: z.string().min(1),
  categoria: z.string().nullish(),
  cantidad: z.coerce.number(),
  unidad: z.string().default("u"),
  precioUnit: z.coerce.number(),
  importe: z.coerce.number(),
});

export const QuoteCaptureSchema = z.object({
  kind: z.literal("quote"),
  serviceType: z.enum(["anmat", "general", "oficinas"]).nullish(),
  tarifarioRef: z.string().nullish(),
  currency: z.string().default("ARS"),
  subtotal: z.coerce.number(),
  descuentoTotal: z.coerce.number().default(0),
  iva: z.coerce.number().default(0),
  total: z.coerce.number(),
  items: z.array(QuoteItemSchema).default([]),
  raw: z.unknown().optional(),
});

export const ProposalCaptureSchema = z.object({
  kind: z.literal("proposal"),
  tipo: z.enum(["anmat", "general"]),
  fields: z.unknown().optional(),
  raw: z.unknown().optional(),
});

export const CapturePayloadSchema = z.discriminatedUnion("kind", [QuoteCaptureSchema, ProposalCaptureSchema]);

export type QuoteCapture = z.infer<typeof QuoteCaptureSchema>;
export type ProposalCapture = z.infer<typeof ProposalCaptureSchema>;
export type CapturePayload = z.infer<typeof CapturePayloadSchema>;

export type ParseResult =
  | { ok: true; payload: CapturePayload }
  | { ok: false; reason: string };

/**
 * Valida el objeto devuelto por `__nexusCapture()`. Los payloads "best-effort" de
 * artefactos bundleados (sin estado expuesto) NO validan → ok:false con la nota,
 * para que el host muestre el motivo en vez de persistir datos incompletos.
 */
export function parseCapture(raw: unknown): ParseResult {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, reason: "El artefacto no devolvió datos (completá el formulario y reintentá)." };
  }
  const o = raw as Record<string, unknown>;
  if (o.unavailable === true) {
    return { ok: false, reason: typeof o.note === "string" ? o.note : "Artefacto bundleado sin estado expuesto." };
  }
  const parsed = CapturePayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: `Payload inválido: ${first?.path.join(".")} ${first?.message}` };
  }
  return { ok: true, payload: parsed.data };
}
