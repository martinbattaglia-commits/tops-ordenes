"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { ORG } from "@/lib/org";
import { computePurchasePricing } from "@/lib/compras/pricing";
import type { Totals } from "@/lib/compras/totals";
import {
  CreatePurchaseOrderSchema,
  formatZodIssues,
  type CreatePurchaseOrderInput,
} from "@/lib/compras/validation";
import { sendPurchaseOrderEmails } from "@/lib/compras/email";
import { buildPoPdf } from "@/lib/compras/pdf/build";
import { uploadPoPdf } from "@/lib/compras/storage";
import {
  isDriveConfigured,
  ensureVendorFolderPath,
  uploadPdf,
} from "@/lib/drive/client";
import { sendText, isWhatsappConfigured } from "@/lib/whatsapp/meta";
import { fmtCurrency } from "@/lib/compras/format";
import {
  assertCanonicalVendor,
  VendorIdentityError,
  type CanonicalVendor,
} from "@/lib/compras/vendor-identity";

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
  const pricing = computePurchasePricing(data.items);
  const pricedItems = data.items.map((item, index) => ({
    ...item,
    price: pricing.lines[index].price,
    subtotal: pricing.lines[index].subtotal,
    price_reason: pricing.lines[index].price_reason ?? null,
  }));

  // Demo/setup incompleto → no persistimos ni hacemos egress. En particular,
  // un payload anónimo nunca puede usar esta rama como relay de correo.
  if (env.app.demoMode) {
    const short = Math.floor(Math.random() * 9000) + 1000;
    const public_id = `OC-2026-${String(short).padStart(4, "0")}`;
    return { ok: true, id: `demo-${short}`, public_id };
  }
  if (env.app.needsSupabase) {
    return { ok: false, error: "El backend de Compras todavía no está configurado." };
  }

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión requerida para registrar responsable de precio" };

  // Una Server Action es un endpoint: la autorización se verifica antes de
  // cualquier efecto (incluido el upsert de proveedor). La RPC vuelve a
  // verificarla dentro de PostgreSQL; esta barrera evita efectos parciales.
  const { data: canCreate, error: permissionError } = await supabase.rpc("has_permission", {
    p_slug: "compras.create",
  });
  const { data: canSign, error: signPermissionError } = await supabase.rpc("has_permission", {
    p_slug: "compras.sign",
  });
  if (permissionError || signPermissionError || canCreate !== true || canSign !== true) {
    return { ok: false, error: "No tenés permisos para crear y firmar órdenes de compra." };
  }

  // 1. Resolver proveedor canónico DESPUÉS de autorizar. Si el uuid ya
  // existe, razón/CUIT/contacto/email salen exclusivamente del maestro. Si es
  // un alta, se inserta (no upsert) para no pisar una ficha concurrente.
  const vendorColumns =
    "id, razon, cuit, domicilio, telefono, contacto, email, categoria, cond_pago, active";
  let canonicalVendor: CanonicalVendor;
  try {
    if (data.vendor.id) {
      const { data: row, error } = await supabase
        .from("vendors")
        .select(vendorColumns)
        .eq("id", data.vendor.id)
        .single();
      if (error) throw new Error("VENDOR_LOOKUP_FAILED");
      canonicalVendor = assertCanonicalVendor(data.vendor, row as CanonicalVendor | null);
    } else {
      throw new VendorIdentityError("VENDOR_NOT_FOUND");
    }
  } catch (error) {
    console.error("[compras] canonical vendor resolution failed", {
      code: error instanceof VendorIdentityError ? error.code : "VENDOR_RESOLUTION_FAILED",
    });
    return {
      ok: false,
      error: "El proveedor cambió o no pudo validarse. Volvé a seleccionarlo antes de emitir.",
    };
  }
  const vendor_id = canonicalVendor.id;
  const canonicalDestination =
    ORG.depots.find((depot) => depot.id === data.depot)?.address ?? ORG.address;

  // Header + líneas + eventos de precio se emiten en una única transacción.
  const { data: issuedRaw, error: issueError } = await supabase.rpc("purchase_order_issue", {
    p_order: {
      depot: data.depot,
      destino: canonicalDestination,
      entrega: data.entrega,
      categoria: data.categoria,
      cond_pago: data.cond_pago,
      vendor_id,
      observ: data.observ || null,
      signature_data_url: data.signature.data_url,
    },
    p_items: pricedItems.map((it, i) => ({
        sku: it.sku,
        label: it.label,
        unit: it.unit,
        qty: it.qty,
        price: it.price,
        subtotal: it.subtotal,
        price_state: it.price_state,
        price_reason: it.price_reason,
        pos: i,
      })),
  });
  const issued = issuedRaw as {
    id?: string;
    public_id?: string;
    price_state?: Totals["state"];
    neto?: number | null;
    iva?: number | null;
    total?: number | null;
    planning_neto?: number | null;
    planning_iva?: number | null;
    planning_total?: number | null;
    known_partial_neto?: number;
    pending_price_lines?: number;
    signed_by?: string;
    issued_at?: string;
    signature_hash?: string;
    integrity_hash?: string;
    emisor_name?: string;
    emisor_email?: string;
    emisor_role?: string;
    vendor_snapshot?: CanonicalVendor;
  } | null;
  if (
    issueError || !issued?.id || !issued.public_id || !issued.signed_by || !issued.issued_at
    || !issued.signature_hash?.match(/^[a-f0-9]{64}$/)
    || !issued.integrity_hash?.match(/^[a-f0-9]{64}$/)
    || !issued.price_state || !issued.emisor_name || !issued.emisor_email || !issued.emisor_role
    || !issued.vendor_snapshot?.id || !issued.vendor_snapshot.razon || !issued.vendor_snapshot.cuit
  ) {
    console.error("[compras] purchase_order_issue failed", { code: "PO_ISSUE_FAILED" });
    return {
      ok: false,
      error: "No pudimos emitir la orden de compra de forma atómica. Reintentá en unos minutos.",
    };
  }
  const orderId = issued.id;
  const public_id = issued.public_id;
  const now = issued.issued_at;
  const documentVendor = issued.vendor_snapshot;
  const canonicalTotals: Totals = {
    neto: issued.neto ?? null,
    iva: issued.iva ?? null,
    total: issued.total ?? null,
    planningNeto: issued.planning_neto ?? null,
    planningIva: issued.planning_iva ?? null,
    planningTotal: issued.planning_total ?? null,
    state: issued.price_state,
    knownPartialNeto: issued.known_partial_neto ?? 0,
    pendingLines: issued.pending_price_lines ?? 0,
  };
  const deliveryLedger = createAdminClient();
  const finalizeEmailEvidence = async (args: {
    attemptKey: string;
    status: "sent" | "failed" | "unknown";
    providerId?: string | null;
    errorCode?: string | null;
  }): Promise<boolean> => {
    if (!deliveryLedger) return false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { error } = await deliveryLedger.rpc("purchase_order_finalize_email_delivery", {
        p_order_id: orderId,
        p_attempt_key: args.attemptKey,
        p_status: args.status,
        p_provider_id: args.providerId ?? null,
        p_error_code: args.errorCode ?? null,
      });
      if (!error) return true;
    }
    return false;
  };

  // 4. Generar PDF firmado + subir a Supabase Storage (PRIMARY)
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
      destino: canonicalDestination,
      entrega: data.entrega,
      categoria: data.categoria,
      cond_pago: data.cond_pago,
      status: "firmada" as const,
      vendor_id,
      emisor_name: issued.emisor_name,
      emisor_email: issued.emisor_email,
      emisor_role: issued.emisor_role,
      observ: data.observ,
      neto: canonicalTotals.neto,
      iva: canonicalTotals.iva,
      total: canonicalTotals.total,
      price_state: canonicalTotals.state,
      planning_neto: canonicalTotals.planningNeto,
      planning_iva: canonicalTotals.planningIva,
      planning_total: canonicalTotals.planningTotal,
      known_partial_neto: canonicalTotals.knownPartialNeto,
      pending_price_lines: canonicalTotals.pendingLines,
      price_reconciled_at: null,
      price_reconciled_by: null,
      price_reconciled_invoice_id: null,
      price_reconciliation_reason: null,
      issued_neto: canonicalTotals.planningNeto,
      issued_iva: canonicalTotals.planningIva,
      issued_total: canonicalTotals.planningTotal,
      signed_by: issued.signed_by,
      signed_at: now,
      signature_url: null,
      signature_hash: issued.signature_hash,
      integrity_hash: issued.integrity_hash,
      pdf_url: null,
      pdf_sha256: null,
      pdf_size_bytes: null,
      vendor_snapshot: documentVendor,
      drive_folder: null,
      drive_file_id: null,
      factura_id: null,
      supplier_invoice_id: null,
      recibido_por: null,
      recibido_at: null,
      created_at: now,
      created_by: user.id,
      vendor: {
        id: documentVendor.id,
        razon: documentVendor.razon,
        cuit: documentVendor.cuit,
        domicilio: documentVendor.domicilio,
        telefono: documentVendor.telefono,
        contacto: documentVendor.contacto,
        email: documentVendor.email,
        categoria: documentVendor.categoria,
        cond_pago: documentVendor.cond_pago,
        tags: [],
        active: true,
        created_at: now,
      },
      items: pricedItems.map((it, i) => ({ ...it, pos: i, order_id: orderId })),
    };
    pdfBuffer = await buildPoPdf(fullPo, data.signature.data_url);
    const pdfHash = createHash("sha256").update(pdfBuffer).digest("hex");
    const stored = await uploadPoPdf({ orderId, pdfSha256: pdfHash, pdfBuffer });
    const { data: finalized, error: finalizeError } = deliveryLedger
      ? await deliveryLedger.rpc("purchase_order_finalize_document", {
          p_order_id: orderId,
          p_pdf_path: stored.path,
          p_pdf_sha256: pdfHash,
          p_pdf_size: pdfBuffer.byteLength,
        })
      : { data: null, error: new Error("PO_DOCUMENT_LEDGER_UNAVAILABLE") };
    if (finalizeError || (finalized as { status?: string } | null)?.status !== "firmada") {
      throw new Error("PO_DOCUMENT_FINALIZE_FAILED");
    }
    pdfUrl = stored.path;
  } catch {
    console.warn("[compras] storage upload failed", { code: "PO_STORAGE_UPLOAD_FAILED" });
    return {
      ok: false,
      error: "La OC quedó pendiente porque no pudo materializarse el PDF firmado.",
    };
  }

  // 5. `signed` quedó dentro de purchase_order_finalize_document junto con la
  // evidencia del PDF. Recién desde acá la OC puede comunicarse.

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
        vendorName: documentVendor.razon,
      });
      const upload = await uploadPdf({
        name: `${public_id}.pdf`,
        folderId,
        buffer: pdfBuffer,
        description: `OC ${public_id} · ${documentVendor.razon} · firmada por ${issued.signed_by}`,
      });
      const driveFolder = `${ORG.driveRoot}/${year}/${monthDir(now)}/${documentVendor.razon}`;
      const { error: ledgerError } = deliveryLedger
        ? await deliveryLedger.rpc("purchase_order_record_delivery_event", {
            p_order_id: orderId,
            p_kind: "drive_synced",
            p_meta: { file_id: upload.id, folder: driveFolder, link: upload.webViewLink },
          })
        : { error: new Error("DELIVERY_LEDGER_UNAVAILABLE") };
      if (ledgerError) {
        console.warn("[compras] drive evidence failed", { code: "PO_DRIVE_EVIDENCE_FAILED" });
      }
    } catch {
      console.warn("[compras] drive sync failed", { code: "PO_DRIVE_SYNC_FAILED" });
      // No bloqueamos — el PDF ya está en Supabase Storage.
    }
  }

  // 6. Email: primero se prepara el ledger canónico; sin esa evidencia no hay
  // egress. Resend recibe la misma idempotency key que persiste PostgreSQL.
  if (!deliveryLedger) {
    console.error("[compras] email ledger unavailable", { code: "PO_EMAIL_LEDGER_UNAVAILABLE" });
  } else {
    const { data: preparedRaw, error: prepareError } = await deliveryLedger.rpc(
      "purchase_order_prepare_email_delivery",
      { p_order_id: orderId },
    );
    const prepared = preparedRaw as {
      attempt_key?: string;
      status?: "queued" | "sent" | "failed" | "unknown";
      provider_id?: string | null;
      to_email?: string;
    } | null;
    if (prepareError || !prepared?.attempt_key || !prepared.status || !prepared.to_email) {
      console.error("[compras] email ledger prepare failed", { code: "PO_EMAIL_PREPARE_FAILED" });
    } else if (!pdfUrl) {
      console.error("[compras] email blocked without immutable PDF", { code: "PO_EMAIL_PDF_MISSING" });
    } else if (prepared.status === "queued") {
      const { error: beginError } = await deliveryLedger.rpc(
        "purchase_order_begin_email_delivery",
        { p_order_id: orderId, p_attempt_key: prepared.attempt_key },
      );
      if (beginError) {
        console.error("[compras] email begin failed", { code: "PO_EMAIL_BEGIN_FAILED" });
      } else {
        try {
          const emailResult = await sendPurchaseOrderEmails({
          public_id,
          issuedAt: now,
          emitter: {
            name: issued.emisor_name,
            email: issued.emisor_email,
            role: issued.emisor_role,
          },
          vendor: {
            razon: documentVendor.razon,
            cuit: documentVendor.cuit,
            email: prepared.to_email,
            contacto: documentVendor.contacto ?? "",
          },
          items: pricedItems,
          totals: canonicalTotals,
          categoria: data.categoria,
          cond_pago: data.cond_pago,
          entrega: data.entrega,
          destino: canonicalDestination,
          observ: data.observ,
        }, prepared.attempt_key);
          const recorded = emailResult.sent && emailResult.providerId
            ? await finalizeEmailEvidence({
              attemptKey: prepared.attempt_key,
              status: "sent",
              providerId: emailResult.providerId,
            })
            : await finalizeEmailEvidence({
              attemptKey: prepared.attempt_key,
              status: "failed",
              errorCode: emailResult.skippedReason === "no_resend_key"
                ? "PO_EMAIL_NOT_CONFIGURED"
                : "PO_VENDOR_EMAIL_MISSING",
            });
          if (!recorded) {
            console.error("[compras] email evidence failed", { code: "PO_EMAIL_EVIDENCE_FAILED" });
          }
        } catch (error) {
          const stableCode = error instanceof Error && [
          "PO_EMAIL_PROVIDER_REJECTED",
          "PO_EMAIL_PROVIDER_RESPONSE_INVALID",
          "PO_EMAIL_SEND_FAILED",
        ].includes(error.message)
          ? error.message
          : "PO_EMAIL_SEND_FAILED";
          const ambiguous = stableCode === "PO_EMAIL_PROVIDER_RESPONSE_INVALID"
            || stableCode === "PO_EMAIL_SEND_FAILED";
          await finalizeEmailEvidence({
          attemptKey: prepared.attempt_key,
          status: ambiguous ? "unknown" : "failed",
          errorCode: stableCode,
        });
          console.error("[compras] email send unresolved", {
            code: ambiguous ? "PO_EMAIL_RESULT_UNKNOWN" : "PO_EMAIL_SEND_FAILED",
          });
        }
      }
    }
  }

  // 7. WhatsApp — notificación al admin TOPS (Ruth/JL)
  //    Solo si está configurado. Falla silenciosa.
  if (isWhatsappConfigured() && process.env.WHATSAPP_NOTIFY_DEFAULT) {
    try {
      const msg =
        `🧾 *OC firmada* · ${public_id}\n` +
        `Proveedor: ${documentVendor.razon}\n` +
        `${canonicalTotals.state === "known" ? "Total" : canonicalTotals.state === "estimated" ? "Total estimado" : "Importe"}: ${
          canonicalTotals.state === "pending" ? "pendiente de precio" : fmtCurrency(canonicalTotals.planningTotal)
        }\n` +
        `Categoría: ${data.categoria} · Depósito ${data.depot}\n` +
        `📄 PDF disponible en Nexus Compras\n` +
        `Firmada por ${issued.signed_by} · ${new Date(now).toLocaleString("es-AR")}`;
      const waRes = await sendText({
        to: process.env.WHATSAPP_NOTIFY_DEFAULT,
        text: msg,
      });
      // No se registra como `sent_email`: ese kind es exclusivo del correo.
      // El transporte ya devuelve su propio identificador para observabilidad.
      void waRes;
    } catch {
      console.warn("[compras] whatsapp notification failed", { code: "PO_WHATSAPP_NOTIFY_FAILED" });
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
