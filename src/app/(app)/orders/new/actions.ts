"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { dataUrlToBytes } from "@/lib/utils";
import { sendOrderEmail, recipientsFor } from "@/lib/email";
import type { Depot, Order, ServiceUnit } from "@/lib/types";
import { MOCK_ORDERS, MOCK_CLIENTS, MOCK_OPERATORS } from "@/lib/mock-data";

interface CreateOrderInput {
  client: {
    id: string | null;
    razon: string;
    cuit: string;
    domicilio: string;
    telefono: string;
    contacto: string;
    email: string;
  };
  depot: Depot;
  operator_id: string;
  services: Array<{
    service_slug: string;
    label: string;
    qty: number;
    unit: string;
    rate: number;
    subtotal: number;
  }>;
  h_start: string;
  h_end: string;
  pallets: number;
  units: number;
  km: number;
  observ: string;
  total: number;
  signature: {
    signed_by: string;
    signed_doc: string | null;
    data_url: string;
    hash: string;
    geo_lat: number | null;
    geo_lng: number | null;
  };
}

export async function createOrder(
  input: CreateOrderInput
): Promise<{ ok: true; id: string; public_id: string } | { ok: false; error: string }> {
  const h = headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? null;

  if (env.app.demoMode) {
    // Mock: empujamos al array en memoria. Esto NO persiste entre requests
    // (cada request crea una instancia limpia), pero deja la UI funcional.
    const shortId = 201600 + MOCK_ORDERS.length + 1;
    const public_id = `OS-${String(shortId).padStart(6, "0")}`;
    const op = MOCK_OPERATORS.find((o) => o.id === input.operator_id) ?? MOCK_OPERATORS[0];
    const cl = MOCK_CLIENTS.find((c) => c.id === input.client.id) ?? {
      id: input.client.id ?? `c-mock-${shortId}`,
      razon: input.client.razon,
      cuit: input.client.cuit,
      domicilio: input.client.domicilio,
      telefono: input.client.telefono,
      contacto: input.client.contacto,
      email: input.client.email,
      tags: [],
      created_at: new Date().toISOString(),
    };
    const hours =
      input.h_end && input.h_start
        ? Math.max(
            1,
            parseInt(input.h_end.split(":")[0], 10) - parseInt(input.h_start.split(":")[0], 10)
          )
        : 1;
    const order: Order = {
      id: `mock-${shortId}`,
      public_id,
      short_id: shortId,
      date: new Date().toISOString(),
      depot: input.depot,
      status: "FIRMADA",
      client_id: cl.id,
      operator_id: op.id,
      h_start: input.h_start,
      h_end: input.h_end,
      hours,
      pallets: input.pallets,
      units: input.units,
      km: input.km,
      observ: input.observ,
      total: input.total,
      signed_by: input.signature.signed_by,
      signed_doc: input.signature.signed_doc,
      signed_at: new Date().toISOString(),
      signature_url: input.signature.data_url, // en demo guardamos el dataURL crudo
      signature_hash: input.signature.hash,
      pdf_url: null,
      geo_lat: input.signature.geo_lat,
      geo_lng: input.signature.geo_lng,
      ip,
      created_at: new Date().toISOString(),
      created_by: null,
      client: cl,
      operator: op,
      services: input.services.map((s) => ({ ...s, unit: s.unit as ServiceUnit })),
    };
    MOCK_ORDERS.unshift(order);
    revalidatePath("/orders");
    revalidatePath("/dashboard");
    return { ok: true, id: order.id, public_id };
  }

  const supabase = createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) {
    return { ok: false, error: "Supabase no configurado en el servidor." };
  }

  // 1. Upsert cliente si no existe ID, o crear nuevo
  let client_id = input.client.id;
  if (!client_id) {
    const { data: cdata, error: cerr } = await admin
      .from("clients")
      .upsert(
        {
          razon: input.client.razon,
          cuit: input.client.cuit,
          domicilio: input.client.domicilio,
          telefono: input.client.telefono,
          contacto: input.client.contacto,
          email: input.client.email,
        },
        { onConflict: "cuit" }
      )
      .select("id")
      .single();
    if (cerr || !cdata) return { ok: false, error: cerr?.message ?? "No pudimos crear el cliente." };
    client_id = cdata.id;
  }

  // 2. Insertar orden (RLS-safe vía supabase user client)
  const hours =
    input.h_end && input.h_start
      ? Math.max(
          1,
          parseInt(input.h_end.split(":")[0], 10) - parseInt(input.h_start.split(":")[0], 10)
        )
      : 1;

  const { data: ord, error: oerr } = await supabase
    .from("orders")
    .insert({
      depot: input.depot,
      client_id,
      operator_id: input.operator_id,
      h_start: input.h_start,
      h_end: input.h_end,
      hours,
      pallets: input.pallets,
      units: input.units,
      km: input.km,
      observ: input.observ,
      total: input.total,
      status: "FIRMADA",
      signed_by: input.signature.signed_by,
      signed_doc: input.signature.signed_doc,
      signed_at: new Date().toISOString(),
      signature_hash: input.signature.hash,
      geo_lat: input.signature.geo_lat,
      geo_lng: input.signature.geo_lng,
      ip,
    })
    .select("id, public_id, depot")
    .single();
  if (oerr || !ord) return { ok: false, error: oerr?.message ?? "No pudimos crear la orden." };

  // 3. Insertar servicios
  const { error: serr } = await admin.from("order_services").insert(
    input.services.map((s) => ({
      order_id: ord.id,
      ...s,
    }))
  );
  if (serr) return { ok: false, error: serr.message };

  // 4. Subir firma a storage
  const { bytes, contentType } = dataUrlToBytes(input.signature.data_url);
  const sigPath = `signatures/${ord.id}.png`;
  const { error: uerr } = await admin.storage.from("signatures").upload(sigPath, bytes, {
    contentType,
    upsert: true,
  });
  if (!uerr) {
    const { data: pub } = admin.storage.from("signatures").getPublicUrl(sigPath);
    await admin.from("orders").update({ signature_url: pub.publicUrl }).eq("id", ord.id);
  }

  // 5. Audit log
  await admin.from("audit_log").insert({
    entity: "orders",
    entity_id: ord.id,
    action: "create",
    payload: { signed_by: input.signature.signed_by, total: input.total },
    ip,
  });

  // 6. Email (best-effort, no falla la orden)
  const publicUrl = `${env.app.url}/orders/${ord.public_id}`;
  const fakeOrder = {
    public_id: ord.public_id,
    depot: ord.depot,
    date: new Date().toISOString(),
    total: input.total,
    client: { razon: input.client.razon },
  } as unknown as Order;
  sendOrderEmail({
    order: fakeOrder,
    to: recipientsFor(fakeOrder, input.client.email),
    publicUrl,
  }).catch(() => {});

  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { ok: true, id: ord.id, public_id: ord.public_id };
}
