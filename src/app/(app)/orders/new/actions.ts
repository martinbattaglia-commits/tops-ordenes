"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { dataUrlToBytes } from "@/lib/utils";
import { sendOrderEmail, recipientsFor } from "@/lib/email";
import { buildOrderPdf } from "@/lib/pdf/build";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { CreateOrderSchema, type CreateOrderInput } from "@/lib/validation/order";
import type { Order, ServiceUnit } from "@/lib/types";
import { MOCK_ORDERS, MOCK_CLIENTS, MOCK_OPERATORS } from "@/lib/mock-data";

export type CreateOrderResult =
  | { ok: true; id: string; public_id: string }
  | { ok: false; error: string };

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  // 1. Validar inputs
  const parsed = CreateOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(". ") };
  }
  const data = parsed.data;

  const h = headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? null;

  // 2. Rate limit: 10 órdenes por minuto por IP/usuario
  const rl = rateLimit(clientKey(ip), { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return {
      ok: false,
      error: `Demasiadas órdenes en poco tiempo. Reintentá en ${Math.ceil(
        rl.retryAfterMs / 1000
      )}s.`,
    };
  }

  // 3. Demo mode (explícito)
  if (env.app.demoMode) {
    return createOrderMock(data, ip);
  }

  // 4. Prod path
  const supabase = createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) {
    return { ok: false, error: "Supabase no configurado." };
  }

  // 4a. Upsert cliente (siempre, así si cambian datos quedan al día)
  const { data: clientRow, error: cErr } = await admin
    .from("clients")
    .upsert(
      {
        id: data.client.id ?? undefined,
        razon: data.client.razon,
        cuit: data.client.cuit,
        domicilio: data.client.domicilio || null,
        telefono: data.client.telefono || null,
        contacto: data.client.contacto || null,
        email: data.client.email || null,
      },
      { onConflict: "cuit" }
    )
    .select("id, razon, cuit, domicilio, contacto, email, tags")
    .single();
  if (cErr || !clientRow) {
    return { ok: false, error: cErr?.message ?? "No pudimos guardar el cliente." };
  }
  const client_id = clientRow.id;

  const hours =
    data.h_end && data.h_start
      ? Math.max(
          1,
          parseInt(data.h_end.split(":")[0], 10) - parseInt(data.h_start.split(":")[0], 10)
        )
      : 1;

  // 4b. Insertar la orden
  const { data: ord, error: oErr } = await supabase
    .from("orders")
    .insert({
      depot: data.depot,
      client_id,
      operator_id: data.operator_id,
      h_start: data.h_start,
      h_end: data.h_end,
      hours,
      pallets: data.pallets,
      units: data.units,
      km: data.km,
      observ: data.observ || null,
      total: data.total,
      status: "FIRMADA",
      signed_by: data.signature.signed_by,
      signed_doc: data.signature.signed_doc,
      signed_at: new Date().toISOString(),
      signature_hash: data.signature.hash,
      geo_lat: data.signature.geo_lat,
      geo_lng: data.signature.geo_lng,
      ip,
    })
    .select("id, public_id, depot, short_id, date, total, hours, observ, h_start, h_end, pallets, units, km, signature_hash, signed_by, signed_at, signed_doc, geo_lat, geo_lng, ip, status, created_at")
    .single();
  if (oErr || !ord) {
    return { ok: false, error: oErr?.message ?? "No pudimos crear la orden." };
  }

  // 4c. Insertar servicios
  const { error: sErr } = await admin.from("order_services").insert(
    data.services.map((s) => ({
      order_id: ord.id,
      service_slug: s.service_slug,
      label: s.label,
      qty: s.qty,
      unit: s.unit,
      rate: s.rate,
      subtotal: s.subtotal,
    }))
  );
  if (sErr) {
    // rollback best-effort
    await admin.from("orders").delete().eq("id", ord.id);
    return { ok: false, error: sErr.message };
  }

  // 4d. Subir firma a storage
  let signature_url: string | null = null;
  try {
    const { bytes, contentType } = dataUrlToBytes(data.signature.data_url);
    const sigPath = `${ord.id}.png`;
    const { error: upErr } = await admin.storage.from("signatures").upload(sigPath, bytes, {
      contentType,
      upsert: true,
    });
    if (!upErr) {
      const { data: pub } = admin.storage.from("signatures").getPublicUrl(sigPath);
      signature_url = pub.publicUrl;
    }
  } catch {
    /* la firma sigue accesible vía hash, no bloquea la orden */
  }

  // 4e. Operadores: traer datos para el PDF
  const { data: opRow } = await admin
    .from("operators")
    .select("id, full_name, role, avatar, depot")
    .eq("id", data.operator_id)
    .maybeSingle();

  // 4f. Generar PDF server-side + subir a storage
  let pdf_url: string | null = null;
  try {
    const orderForPdf: Order = {
      ...(ord as Order),
      signature_url,
      client: clientRow as unknown as Order["client"],
      operator: opRow ? (opRow as unknown as Order["operator"]) : undefined,
      services: data.services.map((s) => ({ ...s, unit: s.unit as ServiceUnit })),
    };
    const pdfBuf = await buildOrderPdf(orderForPdf);
    const pdfPath = `${ord.id}.pdf`;
    const { error: pdfErr } = await admin.storage.from("pdfs").upload(pdfPath, pdfBuf, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (!pdfErr) {
      const { data: pub } = admin.storage.from("pdfs").getPublicUrl(pdfPath);
      pdf_url = pub.publicUrl;
    }
  } catch (e) {
    console.error("PDF generation failed", e);
  }

  // 4g. Actualizar la orden con las URLs definitivas
  await admin
    .from("orders")
    .update({ signature_url, pdf_url })
    .eq("id", ord.id);

  // 4h. Audit log
  await admin.from("audit_log").insert({
    user_id: (await supabase.auth.getUser()).data.user?.id ?? null,
    entity: "orders",
    entity_id: ord.id,
    action: "create_signed",
    payload: { signed_by: data.signature.signed_by, total: data.total, depot: data.depot },
    ip,
  });

  // 4i. Enviar email (best-effort, no bloquea)
  const publicUrl = `${env.app.url}/orders/${ord.public_id}`;
  const fakeOrder = {
    public_id: ord.public_id,
    depot: ord.depot,
    date: ord.date,
    total: data.total,
    client: { razon: data.client.razon },
  } as unknown as Order;
  sendOrderEmail({
    order: fakeOrder,
    to: recipientsFor(fakeOrder, data.client.email),
    pdfUrl: pdf_url ?? undefined,
    publicUrl,
  }).catch((err) => console.error("Email send failed", err));

  // 4j. Revalidate caches
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath(`/orders/${ord.public_id}`);

  return { ok: true, id: ord.id, public_id: ord.public_id };
}

// ----- helpers -----

function createOrderMock(data: CreateOrderInput, ip: string | null): CreateOrderResult {
  const shortId = 201600 + MOCK_ORDERS.length + 1;
  const public_id = `OS-${String(shortId).padStart(6, "0")}`;
  const op = MOCK_OPERATORS.find((o) => o.id === data.operator_id) ?? MOCK_OPERATORS[0];
  const cl =
    MOCK_CLIENTS.find((c) => c.id === data.client.id) ?? {
      id: data.client.id ?? `c-mock-${shortId}`,
      razon: data.client.razon,
      cuit: data.client.cuit,
      domicilio: data.client.domicilio,
      telefono: data.client.telefono,
      contacto: data.client.contacto,
      email: data.client.email,
      tags: [] as string[],
      created_at: new Date().toISOString(),
    };
  const hours =
    data.h_end && data.h_start
      ? Math.max(
          1,
          parseInt(data.h_end.split(":")[0], 10) - parseInt(data.h_start.split(":")[0], 10)
        )
      : 1;

  const order: Order = {
    id: `mock-${shortId}`,
    public_id,
    short_id: shortId,
    date: new Date().toISOString(),
    depot: data.depot,
    status: "FIRMADA",
    client_id: cl.id,
    operator_id: op.id,
    h_start: data.h_start,
    h_end: data.h_end,
    hours,
    pallets: data.pallets,
    units: data.units,
    km: data.km,
    observ: data.observ,
    total: data.total,
    signed_by: data.signature.signed_by,
    signed_doc: data.signature.signed_doc,
    signed_at: new Date().toISOString(),
    signature_url: data.signature.data_url,
    signature_hash: data.signature.hash,
    pdf_url: null,
    geo_lat: data.signature.geo_lat,
    geo_lng: data.signature.geo_lng,
    ip,
    created_at: new Date().toISOString(),
    created_by: null,
    client: cl,
    operator: op,
    services: data.services.map((s) => ({ ...s, unit: s.unit as ServiceUnit })),
  };
  MOCK_ORDERS.unshift(order);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { ok: true, id: order.id, public_id };
}
