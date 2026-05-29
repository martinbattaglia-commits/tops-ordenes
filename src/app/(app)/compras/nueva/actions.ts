"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { ORG } from "@/lib/org";
import { computeTotals, integrityHash } from "@/lib/compras/totals";
import {
  CreatePurchaseOrderSchema,
  formatZodIssues,
  type CreatePurchaseOrderInput,
} from "@/lib/compras/validation";
import { sendPurchaseOrderEmails } from "@/lib/compras/email";
import { buildPoPdf } from "@/lib/compras/pdf/build";
import { uploadPoPdf, uploadSignature } from "@/lib/compras/storage";
import {
  isDriveConfigured,
  ensureVendorFolderPath,
  uploadPdf,
} from "@/lib/drive/client";
import { sendText, isWhatsappConfigured } from "@/lib/whatsapp/meta";
import { fmtCurrency } from "@/lib/compras/format";

interface CreateOk {
  ok: true;
  id: string;
  public_id: string;
}
interface CreateErr {
  ok: false;
  error: string;
}
export type CreateResult = CreateOk | CreateErr;

export async function createPurchaseOrderAction(input: CreatePurchaseOrderInput): Promise<CreateResult> {
  const parsed = CreatePurchaseOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: formatZodIssues(parsed.error) };
  }
  const data = parsed.data;
  const totals = computeTotals(data.items);
  const now = new Date().toISOString();

  // Demo mode → no persistimos en DB, devolvemos un public_id sintético
  if (env.app.demoMode || env.app.needsSupabase) {
    const short = Math.floor(Math.random() * 9000) + 1000;
    const public_id = `OC-2026-${String(short).padStart(4, "0")}`;
    // En demo, intentamos igual enviar email si Resend está configurado.
    if (env.email.resendKey) {
      try {
        await sendPurchaseOrderEmails({
          public_id,
          vendor: {
            razon: data.vendor.razon,
            cuit: data.vendor.cuit,
            email: data.vendor.email,
            contacto: data.vendor.contacto,
          },
          items: data.items,
          totals,
          categoria: data.categoria,
          cond_pago: data.cond_pago,
          entrega: data.entrega,
          destino: data.destino,
          observ: data.observ,
        });
      } catch (e) {
        console.warn("[compras] demo email send failed", e);
      }
    }
    return { ok: true, id: `demo-${short}`, public_id };
  }

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };

  const { data: { user } } = await supabase.auth.getUser();

  // 1. Asegurar vendor (upsert por CUIT)
  let vendor_id = data.vendor.id;
  if (!vendor_id) {
    const upsert = await supabase
      .from("vendors")
      .upsert(
        {
          razon: data.vendor.razon,
          cuit: data.vendor.cuit,
          domicilio: data.vendor.domicilio || null,
          telefono: data.vendor.telefono || null,
          contacto: data.vendor.contacto || null,
          email: data.vendor.email || null,
          categoria: data.categoria,
          cond_pago: data.cond_pago,
        },
        { onConflict: "cuit" }
      )
      .select("id")
      .single();
    if (upsert.error || !upsert.data) {
      return { ok: false, error: `Vendor upsert: ${upsert.error?.message ?? "sin id"}` };
    }
    vendor_id = upsert.data.id;
  }

  // 2. Insert purchase_order
  const integHash = await integrityHash({
    vendor_id: vendor_id ?? "",
    items: data.items,
    total: totals.total,
    emisor_email: ORG.emitter.email,
    signed_at: now,
  });

  const orderInsert = await supabase
    .from("purchase_orders")
    .insert({
      date: now,
      depot: data.depot,
      destino: data.destino,
      entrega: data.entrega,
      categoria: data.categoria,
      cond_pago: data.cond_pago,
      status: "firmada",
      vendor_id,
      emisor_name: ORG.emitter.name,
      emisor_email: ORG.emitter.email,
      emisor_role: ORG.emitter.role,
      observ: data.observ || null,
      neto: totals.neto,
      iva: totals.iva,
      total: totals.total,
      signed_by: data.signature.signed_by,
      signed_at: now,
      signature_hash: data.signature.hash,
      integrity_hash: integHash,
      drive_folder: `${ORG.driveRoot}/${monthDir(now)}/${data.vendor.razon}`,
      created_by: user?.id ?? null,
    })
    .select("id, public_id")
    .single();

  if (orderInsert.error || !orderInsert.data) {
    return { ok: false, error: `Insert OC: ${orderInsert.error?.message ?? "sin id"}` };
  }
  const orderId = orderInsert.data.id;
  const public_id = orderInsert.data.public_id;

  // 3. Insert items
  const itemsInsert = await supabase
    .from("po_items")
    .insert(
      data.items.map((it, i) => ({
        order_id: orderId,
        sku: it.sku,
        label: it.label,
        unit: it.unit,
        qty: it.qty,
        price: it.price,
        subtotal: it.subtotal,
        pos: i,
      }))
    );
  if (itemsInsert.error) {
    return { ok: false, error: `Items: ${itemsInsert.error.message}` };
  }

  // 4. Upload signature PNG al bucket privado po-signatures
  try {
    if (data.signature.data_url.startsWith("data:image/png;base64,")) {
      const b64 = data.signature.data_url.replace(/^data:image\/png;base64,/, "");
      const sigBytes = Buffer.from(b64, "base64");
      await uploadSignature({ orderId, pngBuffer: sigBytes });
    }
  } catch (e) {
    console.warn("[compras] signature upload failed", e);
  }

  // 4.5. Generar PDF firmado + subir a Supabase Storage (PRIMARY)
  //      Drive sync (si está configurado) corre después como secundario.
  let pdfUrl: string | null = null;
  let pdfBuffer: Buffer | null = null;
  try {
    const fullPo = {
      id: orderId,
      public_id,
      short_id: 0,
      date: now,
      depot: data.depot,
      destino: data.destino,
      entrega: data.entrega,
      categoria: data.categoria,
      cond_pago: data.cond_pago,
      status: "firmada" as const,
      vendor_id: vendor_id ?? "",
      emisor_name: ORG.emitter.name,
      emisor_email: ORG.emitter.email,
      emisor_role: ORG.emitter.role,
      observ: data.observ,
      neto: totals.neto,
      iva: totals.iva,
      total: totals.total,
      signed_by: data.signature.signed_by,
      signed_at: now,
      signature_url: null,
      signature_hash: data.signature.hash,
      integrity_hash: integHash,
      pdf_url: null,
      drive_folder: null,
      drive_file_id: null,
      factura_id: null,
      recibido_por: null,
      recibido_at: null,
      created_at: now,
      created_by: user?.id ?? null,
      vendor: {
        id: vendor_id ?? "",
        razon: data.vendor.razon,
        cuit: data.vendor.cuit,
        domicilio: data.vendor.domicilio,
        telefono: data.vendor.telefono,
        contacto: data.vendor.contacto,
        email: data.vendor.email,
        categoria: data.categoria,
        cond_pago: data.cond_pago,
        tags: [],
        active: true,
        created_at: now,
      },
      items: data.items.map((it, i) => ({ ...it, pos: i, order_id: orderId })),
    };
    pdfBuffer = await buildPoPdf(fullPo, data.signature.data_url);
    const stored = await uploadPoPdf({
      publicId: public_id,
      date: new Date(now),
      pdfBuffer,
    });
    pdfUrl = stored.publicUrl;
    await supabase
      .from("purchase_orders")
      .update({ pdf_url: pdfUrl })
      .eq("id", orderId);
  } catch (e) {
    console.warn("[compras] storage upload failed:", (e as Error).message);
    // No bloqueamos: la OC sigue firmada y los eventos quedan.
  }

  // 5. Eventos
  await supabase.from("po_events").insert([
    {
      order_id: orderId,
      kind: "created",
      actor: ORG.emitter.name,
      actor_email: ORG.emitter.email,
      meta: { source: "wizard" },
    },
    {
      order_id: orderId,
      kind: "signed",
      actor: data.signature.signed_by,
      actor_email: ORG.emitter.email,
      meta: { hash: data.signature.hash },
    },
  ]);

  // 5.5. Drive sync SECUNDARIO (best-effort). El PDF ya está en Supabase
  //      Storage; Drive queda como backup adicional cuando esté configurado.
  if (isDriveConfigured() && pdfBuffer) {
    try {
      const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
      const year = new Date(now).getFullYear();
      const folderId = await ensureVendorFolderPath({
        rootFolderId: rootId,
        year,
        monthName: monthDir(now),
        vendorName: data.vendor.razon,
      });
      const upload = await uploadPdf({
        name: `${public_id}.pdf`,
        folderId,
        buffer: pdfBuffer,
        description: `OC ${public_id} · ${data.vendor.razon} · firmada por ${ORG.emitter.name}`,
      });
      await supabase
        .from("purchase_orders")
        .update({
          drive_file_id: upload.id,
          drive_folder: `${ORG.driveRoot}/${year}/${monthDir(now)}/${data.vendor.razon}`,
        })
        .eq("id", orderId);
      await supabase.from("po_events").insert({
        order_id: orderId,
        kind: "drive_synced",
        actor: "system",
        meta: { file_id: upload.id, link: upload.webViewLink },
      });
    } catch (e) {
      console.warn("[compras] drive sync failed:", (e as Error).message);
      // No bloqueamos — el PDF ya está en Supabase Storage.
    }
  }

  // 6. Emails
  try {
    await sendPurchaseOrderEmails({
      public_id,
      vendor: {
        razon: data.vendor.razon,
        cuit: data.vendor.cuit,
        email: data.vendor.email,
        contacto: data.vendor.contacto,
      },
      items: data.items,
      totals,
      categoria: data.categoria,
      cond_pago: data.cond_pago,
      entrega: data.entrega,
      destino: data.destino,
      observ: data.observ,
    });
    await supabase.from("po_events").insert({
      order_id: orderId,
      kind: "sent_email",
      actor: "system",
      meta: { to: [data.vendor.email, ORG.admin.email, ORG.emitter.email] },
    });
  } catch (e) {
    console.error("[compras] email send failed", e);
    // No bloqueamos la OC; queda registrada y se puede reenviar manualmente.
  }

  // 7. WhatsApp — notificación al admin TOPS (Ruth/JL)
  //    Solo si está configurado. Falla silenciosa.
  if (isWhatsappConfigured() && process.env.WHATSAPP_NOTIFY_DEFAULT) {
    try {
      const msg =
        `🧾 *OC firmada* · ${public_id}\n` +
        `Proveedor: ${data.vendor.razon}\n` +
        `Total: ${fmtCurrency(totals.total)}\n` +
        `Categoría: ${data.categoria} · Depósito ${data.depot}\n` +
        (pdfUrl ? `📄 PDF: ${pdfUrl}\n` : "") +
        `Firmada por ${ORG.emitter.name} · ${new Date(now).toLocaleString("es-AR")}`;
      const waRes = await sendText({
        to: process.env.WHATSAPP_NOTIFY_DEFAULT,
        text: msg,
      });
      if (waRes.ok) {
        await supabase.from("po_events").insert({
          order_id: orderId,
          kind: "sent_email", // reusa kind existente; F3 agrega kind 'sent_whatsapp'
          actor: "whatsapp",
          meta: { message_id: waRes.messageId, to: waRes.to },
        });
      }
    } catch (e) {
      console.warn("[compras] whatsapp notification failed:", (e as Error).message);
    }
  }

  revalidatePath("/compras/ordenes");
  revalidatePath("/compras");
  return { ok: true, id: orderId, public_id };
}

function monthDir(iso: string): string {
  const months = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  return months[new Date(iso).getMonth()];
}
