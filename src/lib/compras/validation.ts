import { z } from "zod";

/**
 * Schema de validación para createPurchaseOrder.
 * El módulo OC reusa el patrón de defensa-en-profundidad del módulo OS:
 * preprocesos numéricos tolerantes, errorMap en español, labels amigables.
 */

const esErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.invalid_type) {
    if (issue.expected === "number") return { message: "Número inválido" };
    if (issue.expected === "string") return { message: "Texto inválido" };
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
  return { message: ctx.defaultError };
};

z.setErrorMap(esErrorMap);

const numOr0 = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}, z.number().nonnegative());

const qtyPositive = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return 1;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}, z.number().positive("Cantidad debe ser mayor a 0"));

export const CreatePurchaseOrderSchema = z.object({
  vendor: z.object({
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
  depot: z.enum(["MAGALDI", "LUJAN"]),
  destino: z.string().max(200),
  entrega: z.string().max(80),
  categoria: z.string().min(2).max(80),
  cond_pago: z.string().min(2).max(40),
  items: z
    .array(
      z.object({
        sku: z.string().nullable(),
        label: z.string().min(2, "Producto sin descripción").max(200),
        unit: z.string().min(1).max(20),
        qty: qtyPositive,
        price: numOr0,
        subtotal: numOr0,
        pos: z.number().int().nonnegative(),
      })
    )
    .min(1, "Cargá al menos un producto"),
  observ: z.string().max(2000),
  signature: z.object({
    signed_by: z.string().min(2).max(120),
    data_url: z
      .string()
      .startsWith("data:image/png;base64,", "Firma no capturada correctamente"),
    hash: z.string().length(64, "Hash de firma inválido"),
  }),
});

export type CreatePurchaseOrderInput = z.infer<typeof CreatePurchaseOrderSchema>;

const FIELD_LABELS: Record<string, string> = {
  "vendor.razon": "Razón social",
  "vendor.cuit": "CUIT",
  "vendor.email": "Email del proveedor",
  "vendor.domicilio": "Domicilio",
  "vendor.telefono": "Teléfono",
  "vendor.contacto": "Contacto",
  depot: "Depósito",
  destino: "Destino",
  entrega: "Fecha entrega",
  categoria: "Categoría",
  cond_pago: "Cond. pago",
  items: "Productos",
  observ: "Observaciones",
  "signature.signed_by": "Firmante",
  "signature.data_url": "Firma",
  "signature.hash": "Firma",
};

function labelFor(path: (string | number)[]): string {
  const dotted = path.join(".");
  if (FIELD_LABELS[dotted]) return FIELD_LABELS[dotted];
  if (path[0] === "items" && typeof path[1] === "number") {
    const idx = path[1] + 1;
    const last = path[path.length - 1];
    const lastLabel =
      last === "qty"
        ? "Cantidad"
        : last === "price"
          ? "Precio"
          : last === "subtotal"
            ? "Subtotal"
            : last === "label"
              ? "Producto"
              : String(last);
    return `Item #${idx} · ${lastLabel}`;
  }
  return dotted || "Datos";
}

export function formatZodIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 3).map((i) => `${labelFor(i.path)}: ${i.message}`);
  const extra = error.issues.length - issues.length;
  return issues.join(" · ") + (extra > 0 ? ` (+${extra} más)` : "");
}
