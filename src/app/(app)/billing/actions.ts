"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { listOrders } from "@/lib/data/orders";
import { emitInvoice, type EmitInvoiceInput } from "@/lib/invoicing/emit";
import {
  getFiscalConfig,
  getInvoice,
  findBilledOrderConflicts,
  mockStore,
} from "@/lib/invoicing/data";
import { esRectificativo, notaCreditoPara } from "@/lib/invoicing/calc";
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

/**
 * H1 (FISCAL-HARDENING) — gate de las puertas de emisión: espejo del RLS de
 * escritura de customer_invoices (0011: write admin/operaciones). Antes,
 * emitInvoiceAction era una server action exportada sin ningún control.
 */
async function assertBillingRole(): Promise<string | null> {
  if (env.app.demoMode || env.app.needsSupabase) return null; // demo: sin RBAC
  const supabase = createClient();
  if (!supabase) return "Sesión no disponible.";
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "No autenticado.";
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = profile?.role ?? null;
  if (role !== "admin" && role !== "operaciones") {
    return "Permiso insuficiente para emitir comprobantes (requiere admin u operaciones).";
  }
  return null;
}

export type EmitResult =
  | { ok: true; invoice: CustomerInvoice; warning?: string }
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

const TIPOS_COMPROBANTE = [
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
] as const;

const EmitSchema = z
  .object({
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
    tipo_comprobante: z.enum(TIPOS_COMPROBANTE).optional(),
    concepto: z.number().int().min(1).max(3).optional(),
    punto_venta: z.number().int().positive().optional(),
    items: z.array(ItemSchema).min(1),
    fch_serv_desde: z.string().optional().nullable(),
    fch_serv_hasta: z.string().optional().nullable(),
    fch_vto_pago: z.string().optional().nullable(),
    periodo: z.string().max(7).optional().nullable(),
    // H1: las NC/ND deben referenciar su comprobante original (RG 4540).
    comprobante_asociado_id: z.string().uuid().optional().nullable(),
    observ: z.string().max(2000).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    const rectificativo = v.tipo_comprobante
      ? esRectificativo(v.tipo_comprobante)
      : false;
    if (rectificativo && !v.comprobante_asociado_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comprobante_asociado_id"],
        message: "NC/ND requieren el comprobante asociado (RG 4540).",
      });
    }
    if (!rectificativo && v.comprobante_asociado_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comprobante_asociado_id"],
        message: "Solo NC/ND pueden referenciar un comprobante asociado.",
      });
    }
  });

export async function emitInvoiceAction(
  input: EmitInvoiceInput
): Promise<EmitResult> {
  const denied = await assertBillingRole();
  if (denied) return { ok: false, error: denied };

  const parsed = EmitSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 3).map((i) => i.message).join(" · ");
    return { ok: false, error: msg };
  }
  try {
    const ctx = await auditContext();
    // Sin cast: el schema ya no descarta campos del dominio que acepta.
    const result = await emitInvoice(parsed.data, ctx);
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
  const denied = await assertBillingRole();
  if (denied) return { ok: false, error: denied };

  try {
    const { rows } = await listOrders({ pageSize: 1000, status: "FIRMADA" });
    const orders = rows.filter((o) => o.client?.id === clientId);
    if (orders.length === 0) {
      return { ok: false, error: "El cliente no tiene órdenes firmadas para facturar." };
    }

    // H4 — guard de idempotencia pre-emisión.
    const orderIds = orders.map((o) => o.id);
    const conflicts = await findBilledOrderConflicts(orderIds);
    if (conflicts.length > 0) {
      const byOrder = new Map(conflicts.map((c) => [c.orderId, c.comprobante]));
      const detail = orders
        .filter((o) => byOrder.has(o.id))
        .map((o) => `${o.public_id} → ${byOrder.get(o.id)}`)
        .join(" · ");
      return {
        ok: false,
        error: `Doble facturación bloqueada: hay OS ya facturadas en un comprobante vigente (${detail}). Si la marca FACTURADA falló, corregí el estado de la OS antes de reintentar.`,
      };
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

    // H4 — vincular las OS facturadas con reintentos; si agota, alerta
    // auditable (nunca un warn silencioso: la falla habilitaba re-facturar).
    let warning: string | undefined;
    if (!env.app.demoMode && !env.app.needsSupabase) {
      const supabase = createClient();
      if (supabase) {
        const ids = orders.map((o) => o.id);
        let linked = false;
        let lastError = "";
        for (let attempt = 1; attempt <= 3 && !linked; attempt++) {
          const { error } = await supabase
            .from("orders")
            .update({ invoice_id: result.invoice.id, status: "FACTURADA" })
            .in("id", ids)
            .eq("status", "FIRMADA");
          if (!error) {
            linked = true;
          } else {
            lastError = error.message;
            if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 400));
          }
        }
        if (!linked) {
          warning = `Factura ${result.invoice.punto_venta}-${result.invoice.numero_comprobante} emitida, pero las OS no pudieron marcarse FACTURADA (${lastError}). El guard de idempotencia bloquea re-emisiones; corregir el estado de las OS.`;
          await supabase.from("invoice_audit").insert({
            invoice_id: result.invoice.id,
            user_id: ctx.userId,
            action: "error",
            estado: result.invoice.estado_arca,
            response: { fiscal_hardening_h4: warning },
            ip: ctx.ip ?? null,
          });
        }
      }
    }

    revalidatePath("/billing");
    revalidatePath("/orders");
    return { ok: true, invoice: result.invoice, warning };
  } catch (e) {
    console.error("[billing/emitFromClientOrdersAction] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

// ============================================================================
// Action: anular un comprobante autorizado emitiendo NC total (H1 — patrón
// append-only: nunca se editan importes; el documento rectificativo revierte).
// ============================================================================

export async function anularInvoiceAction(invoiceId: string): Promise<EmitResult> {
  const denied = await assertBillingRole();
  if (denied) return { ok: false, error: denied };

  try {
    const original = await getInvoice(invoiceId);
    if (!original) return { ok: false, error: "Comprobante inexistente." };
    if (original.estado_arca !== "AUTORIZADO_ARCA" || !original.numero_comprobante) {
      return { ok: false, error: "Solo se anulan comprobantes autorizados por ARCA." };
    }
    if (original.anulada) {
      return { ok: false, error: "El comprobante ya está anulado." };
    }
    const config = await getFiscalConfig();
    if (original.ambiente !== config.ambiente) {
      return {
        ok: false,
        error: `El comprobante pertenece a otro ambiente (${original.ambiente}).`,
      };
    }
    const ncTipo = notaCreditoPara(original.tipo_comprobante);
    if (!ncTipo) {
      return {
        ok: false,
        error: `No hay Nota de Crédito modelada para ${original.tipo_comprobante}.`,
      };
    }
    const items = (original.items ?? []).map((it) => ({
      descripcion: `Anulación ${original.punto_venta}-${original.numero_comprobante} · ${it.descripcion}`.slice(0, 300),
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio_unitario),
      alicuota_iva: Number(it.alicuota_iva),
      // Sin order_id: la NC no debe re-vincular OS (el guard H4 ignora NC,
      // pero el vínculo operativo pertenece al comprobante original).
      order_id: null,
    }));
    if (items.length === 0) {
      return { ok: false, error: "El comprobante no tiene renglones para revertir." };
    }

    const ctx = await auditContext();
    const result = await emitInvoice(
      {
        client_id: original.client_id,
        cuit_cliente: original.cuit_cliente,
        razon_social: original.razon_social,
        condicion_iva: original.condicion_iva,
        domicilio_cliente: original.domicilio_cliente,
        doc_tipo: original.doc_tipo,
        tipo_comprobante: ncTipo,
        concepto: original.concepto,
        punto_venta: original.punto_venta,
        items,
        fch_serv_desde: original.fch_serv_desde,
        fch_serv_hasta: original.fch_serv_hasta,
        fch_vto_pago: original.fch_vto_pago,
        periodo: original.periodo,
        comprobante_asociado_id: original.id,
        observ: `Anulación total de ${original.tipo_comprobante} ${original.punto_venta}-${original.numero_comprobante}.`,
      },
      ctx
    );
    if (!result.ok || !result.invoice) {
      return { ok: false, error: result.errors?.join(" · ") ?? "ARCA rechazó la NC de anulación." };
    }

    // Marcar el original como anulado (flag no protegido por el trigger de
    // inmutabilidad — los importes fiscales siguen intactos) + auditoría.
    let warning: string | undefined;
    if (env.app.demoMode || env.app.needsSupabase) {
      const mock = mockStore().invoices.find((i) => i.id === original.id);
      if (mock) mock.anulada = true;
    } else {
      const supabase = createClient();
      if (supabase) {
        const { error } = await supabase
          .from("customer_invoices")
          .update({ anulada: true })
          .eq("id", original.id);
        if (error) {
          warning = `NC ${result.invoice.punto_venta}-${result.invoice.numero_comprobante} emitida, pero no se pudo marcar el original como anulado: ${error.message}`;
        }
        await supabase.from("invoice_audit").insert({
          invoice_id: original.id,
          user_id: ctx.userId,
          action: "anular",
          estado: original.estado_arca,
          response: {
            nota_credito_id: result.invoice.id,
            nota_credito: `${result.invoice.tipo_comprobante} ${result.invoice.punto_venta}-${result.invoice.numero_comprobante}`,
          },
          ip: ctx.ip ?? null,
        });
      }
    }

    revalidatePath("/billing");
    return { ok: true, invoice: result.invoice, warning };
  } catch (e) {
    console.error("[billing/anularInvoiceAction] failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}
