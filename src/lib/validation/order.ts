import { z } from "zod";

/**
 * Schema de validación para createOrder.
 *
 * Defensa en profundidad:
 *  1. Custom messages en cada `.min/.max/.nonnegative/...` (siempre en español).
 *  2. `errorMap` global como red de seguridad — si algún día se agrega un campo
 *     numérico sin custom message, igual sale traducido al usuario.
 *  3. `preprocess` numérico tolerante a `""`, `null`, `undefined` y `NaN`,
 *     para que un input vacío en el wizard no escale a "Expected number,
 *     received nan" o "Number must be greater than or equal to 0".
 */

const esErrorMap: z.ZodErrorMap = (issue, ctx) => {
  // Mensajes default → español + amigables
  if (issue.code === z.ZodIssueCode.invalid_type) {
    if (issue.expected === "number") return { message: "Número inválido" };
    if (issue.expected === "string") return { message: "Texto inválido" };
    if (issue.expected === "boolean") return { message: "Valor inválido" };
  }
  if (issue.code === z.ZodIssueCode.too_small) {
    if (issue.type === "number") return { message: `Debe ser ≥ ${issue.minimum}` };
    if (issue.type === "string") return { message: `Mínimo ${issue.minimum} caracteres` };
    if (issue.type === "array") return { message: `Al menos ${issue.minimum} elementos` };
  }
  if (issue.code === z.ZodIssueCode.too_big) {
    if (issue.type === "number") return { message: `Debe ser ≤ ${issue.maximum}` };
    if (issue.type === "string") return { message: `Máximo ${issue.maximum} caracteres` };
  }
  if (issue.code === z.ZodIssueCode.invalid_string) {
    if (issue.validation === "email") return { message: "Email inválido" };
    if (issue.validation === "regex") return { message: "Formato inválido" };
  }
  if (issue.code === z.ZodIssueCode.not_finite) {
    return { message: "Número inválido" };
  }
  return { message: ctx.defaultError };
};

z.setErrorMap(esErrorMap);

/** Convierte cualquier input "numérico" (string vacío, null, undefined, NaN) en 0. */
const numOr0 = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}, z.number().nonnegative("Debe ser ≥ 0"));

/** Igual que `numOr0` pero entero (Math.trunc). */
const intOr0 = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}, z.number().int("Debe ser entero").nonnegative("Debe ser ≥ 0"));

/** Cantidad: ≥ 1, default 1 si llega vacío. */
const qtyPositive = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return 1;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}, z.number().positive("Cantidad debe ser mayor a 0"));

export const CreateOrderSchema = z.object({
  client: z.object({
    id: z.string().nullable(),
    razon: z.string().min(2, "Razón social muy corta").max(200),
    cuit: z
      .string()
      .min(11, "CUIT incompleto")
      .max(15)
      .regex(/^[\d-]+$/, "CUIT con formato inválido"),
    domicilio: z.string().max(300),
    telefono: z.string().max(40),
    contacto: z.string().max(120),
    email: z.string().email("Email inválido").or(z.literal("")),
  }),
  depot: z.enum(["MAGALDI", "LUJAN"], {
    errorMap: () => ({ message: "Depósito inválido" }),
  }),
  operator_id: z.string().min(1, "Seleccioná un responsable operativo"),
  services: z
    .array(
      z.object({
        service_slug: z.string(),
        label: z.string(),
        qty: qtyPositive,
        unit: z.string(),
        rate: numOr0,
        subtotal: numOr0,
      })
    )
    .min(1, "Seleccioná al menos un servicio"),
  h_start: z.string().regex(/^\d{2}:\d{2}$/, "Hora inicio inválida"),
  h_end: z.string().regex(/^\d{2}:\d{2}$/, "Hora fin inválida"),
  pallets: intOr0,
  units: intOr0,
  km: intOr0,
  observ: z.string().max(2000),
  total: numOr0,
  signature: z.object({
    signed_by: z.string().min(2, "Nombre del firmante muy corto").max(120),
    signed_doc: z
      .preprocess((v) => (v === "" || v === undefined ? null : v), z.string().max(40).nullable()),
    data_url: z
      .string()
      .startsWith("data:image/png;base64,", "Firma no capturada correctamente"),
    hash: z.string().length(64, "Hash de firma inválido"),
    geo_lat: z
      .preprocess((v) => (v === "" || v === undefined ? null : v), z.number().nullable()),
    geo_lng: z
      .preprocess((v) => (v === "" || v === undefined ? null : v), z.number().nullable()),
  }),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

/** Labels en español de los paths del schema, para mostrar al usuario. */
const FIELD_LABELS: Record<string, string> = {
  "client.razon": "Razón social",
  "client.cuit": "CUIT",
  "client.email": "Email",
  "client.domicilio": "Domicilio",
  "client.telefono": "Teléfono",
  "client.contacto": "Contacto",
  depot: "Depósito",
  operator_id: "Responsable",
  services: "Servicios",
  h_start: "Hora inicio",
  h_end: "Hora fin",
  pallets: "Pallets",
  units: "Unidades",
  km: "Km",
  observ: "Observaciones",
  total: "Total",
  "signature.signed_by": "Firmante",
  "signature.signed_doc": "DNI",
  "signature.data_url": "Firma",
  "signature.hash": "Firma",
};

function labelFor(path: (string | number)[]): string {
  const dotted = path.join(".");
  if (FIELD_LABELS[dotted]) return FIELD_LABELS[dotted];
  // Servicios -> "Servicio #2 · Cantidad"
  if (path[0] === "services" && typeof path[1] === "number") {
    const idx = path[1] + 1;
    const last = path[path.length - 1];
    const lastLabel =
      last === "qty"
        ? "Cantidad"
        : last === "rate"
          ? "Tarifa"
          : last === "subtotal"
            ? "Subtotal"
            : String(last);
    return `Servicio #${idx} · ${lastLabel}`;
  }
  return dotted || "Datos";
}

/**
 * Formatea los issues de un ZodError en un mensaje legible y en español
 * que el usuario final puede entender. Devuelve hasta 3 problemas (para no
 * abrumar) + un contador si hay más.
 */
export function formatZodIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 3).map((i) => `${labelFor(i.path)}: ${i.message}`);
  const extra = error.issues.length - issues.length;
  return issues.join(" · ") + (extra > 0 ? ` (+${extra} más)` : "");
}
