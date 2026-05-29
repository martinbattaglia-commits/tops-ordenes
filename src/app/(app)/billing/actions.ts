"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { listOrders } from "@/lib/data/orders";
import { emitInvoice, type EmitInvoiceInput } from "@/lib/invoicing/emit";
import type { CustomerInvoice } from "@/lib/invoicing/types";

/** Contexto de auditoría: usuario autenticado + IP. */
async function auditContext(): Promise<{ userId: string | null; ip: string | null }> {
  let userId: string | null = null;
  const supabase = createClient();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }
  const h = headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  return { userId, ip };
}

export type EmitResult =
  | { ok: true; invoice: CustomerInvoice }
  | { ok: false; error: string };

// ============================================================================
// Action: emitir comprobante (genérico)
// ============================================================================

const ItemSchema = z.object({
  descripcion: z.string().min(1).max(300),
  cantidad: z.number().positive(),
  precio_unitario: z.number(),
  alicuota_iva: z.number().optional(),
  order_id: z.string().uuid().optional().nullable(),
});

const EmitSchema = z.object({
  client_id: z.string().uuid().optional().nullable(),
  cuit_cliente: z.string().max(15).optional().nullable(),
  razon_social: z.string().min(1).max(200),
  condicion_iva: z.enum([
    "RESPONSABLE_INSCRIPTO",
    "MONOTRIBUTO",
    "EXENTO",
    "CONSUMIDOR_FINAL",
    "NO_RESPONSABLE",
    "NO_CATEGORIZADO",
  ]),
  domicilio_cliente: z.string().max(300).optional().nullable(),
  tipo_comprobante: z
    .enum([
      "FACTURA_A",
      "NOTA_DEBITO_A",
      "NOTA_CREDITO_A",
      "FACTURA_B",
      "NOTA_DEBITO_B",
      "NOTA_CREDITO_B",
      "FACTURA_C",
      "NOTA_DEBITO_C",
      "NOTA_CREDITO_C",
      "FACTURA_E",
    ])
    .optional(),
  concepto: z.number().int().min(1).max(3).optional(),
  punto_venta: z.number().int().positive().optional(),
  items: z.array(ItemSchema).min(1),
  fch_serv_desde: z.string().optional().nullable(),
  fch_serv_hasta: z.string().optional().nullable(),
  fch_vto_pago: z.string().optional().nullable(),
  periodo: z.string().max(7).optional().nullable(),
  observ: z.string().max(2000).optional().nullable(),
});

export async function emitInvoiceAction(
  input: EmitInvoiceInput
): Promise<EmitResult> {
  const parsed = EmitSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 3).map((i) => i.message).join(" · ");
    return { ok: false, error: msg };
  }
  try {
    const ctx = await auditContext();
    const result = await emitInvoice(parsed.data as EmitInvoiceInput, ctx);
    if (!result.ok || !result.invoice) {
      return { ok: false, error: result.errors?.join(" · ") ?? "Emisión rechazada." };
    }
    revalidatePath("/billing");
    return { ok: true, invoice: result.invoice };
  } catch (e) {
    console.error("[billing/emitInvoiceAction] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

// ============================================================================
// Action: consolidar órdenes FIRMADAS de un cliente en una Factura A
// ============================================================================

export async function emitFromClientOrdersAction(
  clientId: string
): Promise<EmitResult> {
  try {
    const { rows } = await listOrders({ pageSize: 1000, status: "FIRMADA" });
    const orders = rows.filter((o) => o.client?.id === clientId);
    if (orders.length === 0) {
      return { ok: false, error: "El cliente no tiene órdenes firmadas para facturar." };
    }

    const client = orders[0].client!;
    const periodo = new Date().toISOString().slice(0, 7);
    const items = orders.map((o) => ({
      descripcion: `OS ${o.public_id} — ${new Date(o.date).toLocaleDateString("es-AR")}`,
      cantidad: 1,
      precio_unitario: Number(o.total ?? 0),
      alicuota_iva: 21,
      order_id: o.id,
    }));

    const input: EmitInvoiceInput = {
      client_id: client.id,
      cuit_cliente: client.cuit ?? null,
      razon_social: client.razon,
      condicion_iva: "RESPONSABLE_INSCRIPTO",
      domicilio_cliente: client.domicilio ?? null,
      tipo_comprobante: "FACTURA_A",
      concepto: 2,
      items,
      periodo,
      fch_serv_desde: orders[orders.length - 1].date,
      fch_serv_hasta: orders[0].date,
    };

    const ctx = await auditContext();
    const result = await emitInvoice(input, ctx);
    if (!result.ok || !result.invoice) {
      return { ok: false, error: result.errors?.join(" · ") ?? "Emisión rechazada." };
    }

    // Vincular las OS facturadas (best-effort, no bloquea la emisión).
    if (!env.app.demoMode && !env.app.needsSupabase) {
      const supabase = createClient();
      if (supabase) {
        const ids = orders.map((o) => o.id);
        const { error } = await supabase
          .from("orders")
          .update({ invoice_id: result.invoice.id, status: "FACTURADA" })
          .in("id", ids);
        if (error) console.warn("[billing] no se pudieron vincular OS:", error.message);
      }
    }

    revalidatePath("/billing");
    revalidatePath("/orders");
    return { ok: true, invoice: result.invoice };
  } catch (e) {
    console.error("[billing/emitFromClientOrdersAction] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}
