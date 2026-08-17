"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { isUrgentOrder } from "@/lib/utils";
import { sendOneOrderEmail } from "@/lib/email";
import { orderEmailPlan, renderRoleHtml, renderRoleText } from "@/lib/order-email";
import { emailFailureNotification } from "@/lib/email-failure";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { CreateOrderSchema, formatZodIssues, type CreateOrderInput } from "@/lib/validation/order";
import {
  OrderClientError,
  resolveOrderClientIdentity,
  soloDigitos,
  type CanonicalOrderClient,
} from "@/lib/order-client-identity";
import {
  ORDER_EMAIL_FAILURE_CODE,
  ORDER_RECIPIENT_SAFE_ERROR,
  resolveCanonicalOrderRecipient,
} from "@/lib/order-recipient-boundary";
import type { Order, ServiceUnit } from "@/lib/types";
import { MOCK_ORDERS, MOCK_CLIENTS, MOCK_OPERATORS } from "@/lib/mock-data";

export type CreateOrderResult =
  | { ok: true; id: string; public_id: string }
  | { ok: false; error: string };

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  // Top-level try: cualquier excepción no controlada → respuesta tipada.
  // Nunca el browser ve un stack-trace crudo.
  try {
    return await createOrderInner(input);
  } catch {
    console.error("[createOrder] unhandled exception", { code: "CREATE_ORDER_UNHANDLED" });
    return { ok: false, error: "No pudimos emitir la orden. Reintentá en unos minutos." };
  }
}

async function createOrderInner(input: CreateOrderInput): Promise<CreateOrderResult> {
  // 1. Validar inputs
  const parsed = CreateOrderSchema.safeParse(input);
  if (!parsed.success) {
    console.error(
      "[createOrder] validation failed",
      JSON.stringify(
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        })),
        null,
        2
      )
    );
    return { ok: false, error: formatZodIssues(parsed.error) };
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
  if (!supabase) {
    return {
      ok: false,
      error:
        "Supabase no está configurado en el servidor. Avisá al administrador para revisar las variables de entorno.",
    };
  }

  // Una Server Action es un endpoint. Autenticamos y autorizamos ANTES de
  // construir el cliente service_role o leer identidad/contacto de terceros.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, error: "Sesión requerida para emitir la orden." };
  }
  const { data: canCreate, error: permissionError } = await supabase.rpc("has_permission", {
    p_slug: "servicios.create",
  });
  const { data: canSign, error: signPermissionError } = await supabase.rpc("has_permission", {
    p_slug: "servicios.sign",
  });
  if (permissionError || signPermissionError || canCreate !== true || canSign !== true) {
    return { ok: false, error: "No tenés permisos para crear y firmar órdenes de servicio." };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Backend no disponible para emitir la orden." };
  }
  const { data: managerScopeRaw, error: managerScopeError } = await supabase
    .rpc("nexus_depot_manager_scope")
    .maybeSingle();
  const managerScope = managerScopeRaw as {
    is_principal?: boolean;
    is_authorized?: boolean;
    depot?: "MAGALDI" | "LUJAN" | null;
  } | null;
  if (managerScopeError) {
    return { ok: false, error: "No se pudo verificar el alcance operativo." };
  }
  // El alcance se verifica por IDENTIDAD, no por nave: la sede de la orden ya
  // no tiene que coincidir con la de la cuenta. Magaldi y Luján se cubren
  // entre sí y emitir una OS de la otra nave es operatoria normal.
  const isDepotManager = managerScope?.is_principal === true;
  if (isDepotManager && managerScope?.is_authorized !== true) {
    return { ok: false, error: "Tu cuenta operativa no está habilitada para emitir órdenes." };
  }
  if (!data.pricing_version_id && !isDepotManager) {
    return {
      ok: false,
      error: "No hay una versión tarifaria firmable. Recargá la orden antes de continuar.",
    };
  }

  // 4a. RESOLVER el cliente. Acá no se crea ni se modifica ninguna fila.
  //
  // La versión anterior hacía `upsert(onConflict: "cuit")` con service_role:
  // crear una orden de servicio pisaba en silencio razón social, domicilio,
  // teléfono, contacto y email del cliente con lo que mandara el navegador, y
  // daba de alta clientes como efecto colateral. Un alta de cliente es un acto
  // deliberado, con permiso y auditoría —`createClient` en
  // `(app)/clients/actions.ts`—, no la consecuencia de completar un wizard.
  //
  // La congruencia entre `client_id`, CUIT y razón social se decide en
  // `resolveOrderClientIdentity`, que es lógica pura con lookup inyectado y
  // está probada contra los ocho casos de D-6. Acá sólo se le da el puerto.
  let clientRow: CanonicalOrderClient;
  try {
    clientRow = await resolveOrderClientIdentity(
      { id: data.client.id, razon: data.client.razon, cuit: data.client.cuit },
      async (by) => {
        const q = admin.from("clients").select("id, razon, cuit, activo");
        const { data: row, error } = await ("id" in by
          ? q.eq("id", by.id)
          : q.eq("cuit", by.cuitDigits)
        ).maybeSingle();
        if (error) throw new Error(error.message);
        return row as CanonicalOrderClient | null;
      },
    );
  } catch (e) {
    if (e instanceof OrderClientError) return { ok: false, error: e.message };
    console.error("[createOrder] client lookup failed", { code: "CLIENT_LOOKUP_FAILED" });
    return { ok: false, error: ORDER_RECIPIENT_SAFE_ERROR };
  }

  const cuitDigits = soloDigitos(data.client.cuit);
  const client_id = clientRow.id;

  // La resolución de identidad devuelve sólo lo necesario para decidir. El
  // PDF y los correos necesitan la ficha completa —domicilio, contacto,
  // email—, así que se relee la fila canónica. Se lee del MAESTRO, no del
  // payload: el navegador no es autoridad sobre ninguno de esos campos.
  let canonicalRecipient: ReturnType<typeof resolveCanonicalOrderRecipient>;
  try {
    const { data: clientFicha, error: clientFichaError } = await admin
      .from("clients")
      .select("id, razon, cuit, domicilio, telefono, contacto, email, tags")
      .eq("id", client_id)
      .single();
    canonicalRecipient = resolveCanonicalOrderRecipient(clientFicha, clientFichaError);
  } catch {
    console.error("[createOrder] canonical client contact lookup failed", {
      code: "CLIENT_CONTACT_LOOKUP_FAILED",
    });
    return { ok: false, error: ORDER_RECIPIENT_SAFE_ERROR };
  }
  if (!canonicalRecipient.ok) {
    console.error("[createOrder] canonical client contact rejected", {
      code: canonicalRecipient.code,
    });
    return { ok: false, error: canonicalRecipient.error };
  }
  const clientParaDocumentos = canonicalRecipient.client;
  const canonicalClientEmail = canonicalRecipient.email;

  // Hours: calculado defensivamente. Si las horas son inválidas o invertidas,
  // mínimo 1h (la orden NO se bloquea por esto — es un dato operativo).
  const hours = computeHours(data.h_start, data.h_end);

  // 4b/4c. Emision ATOMICA y autoritativa.
  // La RPC vuelve a resolver tarifario, precio particular, minimos y total.
  // Si una linea, el snapshot o la auditoria fallan, no queda ninguna OS parcial.
  const issuedAt = new Date().toISOString();
  const { data: issuedRaw, error: issueError } = await supabase.rpc("service_order_issue", {
    p_order: {
      expected_tariff_version_id: data.pricing_version_id,
      client_total: data.total,
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
      signed_by: data.signature.signed_by,
      signed_doc: data.signature.signed_doc,
      signature_data_url: data.signature.data_url,
      geo_lat: data.signature.geo_lat,
      geo_lng: data.signature.geo_lng,
      ip,
    },
    p_lines: data.services.map((service) => ({
      service_slug: service.service_slug,
      label: service.label,
      unit: service.unit,
      qty_requested: service.qty_requested ?? service.qty,
      pricing_status: service.pricing_status,
      pricing_kind: service.pricing_kind,
      pricing_reason: service.pricing_reason,
      second_trip_discount: service.second_trip_discount,
      surcharge: service.surcharge,
      expected_tariff_rate_id: service.expected_tariff_rate_id,
      expected_client_rate_id: service.expected_client_rate_id,
      manual_rate: service.manual_rate,
      manual_subtotal: service.manual_subtotal,
    })),
  });
  const issued = issuedRaw as
    | {
        id?: string;
        public_id?: string;
        short_id?: number;
        date?: string;
        total?: number;
        tariff_version_id?: string;
        currency?: "ARS" | "USD";
        signature_hash?: string;
        pricing_complete?: boolean;
      }
    | null;
  if (
    issueError || !issued?.id || !issued.public_id
    || !issued.signature_hash?.match(/^[a-f0-9]{64}$/)
  ) {
    console.error("[createOrder] service_order_issue failed", {
      code: "SERVICE_ORDER_ISSUE_FAILED",
    });
    return {
      ok: false,
      error: safeServiceIssueError(issueError?.message),
    };
  }
  if (issued.pricing_complete === false) {
    revalidatePath("/orders");
    revalidatePath("/dashboard");
    revalidatePath(`/orders/${issued.public_id}`);
    return { ok: true, id: issued.id, public_id: issued.public_id };
  }
  const { data: issuedServices, error: issuedServicesError } = await admin
    .from("order_services")
    .select("*")
    .eq("order_id", issued.id)
    .order("line_sequence");
  if (issuedServicesError || !issuedServices?.length) {
    console.error("[createOrder] issued snapshot reload failed", {
      code: "ORDER_SNAPSHOT_RELOAD_FAILED",
    });
    // La mutacion ya confirmo. Devolver exito evita que un reintento del usuario
    // duplique una OS valida solo porque fallo una lectura posterior no mutante.
    revalidatePath("/orders");
    revalidatePath(`/orders/${issued.public_id}`);
    return { ok: true, id: issued.id, public_id: issued.public_id };
  }
  const pricingCurrency =
    issued.currency === "ARS" || issued.currency === "USD"
      ? issued.currency
      : issuedServices.find(
          (service) => service.currency_snapshot === "ARS" || service.currency_snapshot === "USD",
        )?.currency_snapshot;
  if (pricingCurrency !== "ARS" && pricingCurrency !== "USD") {
    console.error("[createOrder] issued pricing snapshot has no explicit currency");
    // La mutación ya confirmó. No se genera ni comunica un comprobante con una
    // moneda inventada; devolver éxito evita duplicar la OS en un reintento.
    revalidatePath("/orders");
    revalidatePath(`/orders/${issued.public_id}`);
    return { ok: true, id: issued.id, public_id: issued.public_id };
  }
  const ord = {
    id: issued.id,
    public_id: issued.public_id,
    depot: data.depot,
    short_id: Number(issued.short_id ?? 0),
    date: issued.date ?? issuedAt,
    total: issued.total == null ? null : Number(issued.total),
    issued_total: issued.total == null ? null : Number(issued.total),
    pricing_currency: pricingCurrency,
    tariff_version_id: issued.tariff_version_id ?? data.pricing_version_id,
    pricing_snapshot_at: issuedAt,
    hours,
    observ: data.observ || null,
    h_start: data.h_start,
    h_end: data.h_end,
    pallets: data.pallets,
    units: data.units,
    km: data.km,
    signature_hash: issued.signature_hash,
    signed_by: data.signature.signed_by,
    signed_at: issuedAt,
    signed_doc: data.signature.signed_doc,
    geo_lat: data.signature.geo_lat,
    geo_lng: data.signature.geo_lng,
    ip,
    status: "FIRMADA" as const,
    created_at: issuedAt,
  };

  // 4d. La firma vive únicamente en el ledger binario inmutable de PostgreSQL.
  // No se crea una segunda proyección pública/mutable en Storage. Los documentos
  // se generan on-demand, después de autorizar al lector.

  // 4e. Operadores: traer datos para documentos y notificaciones
  const { data: opRow } = await admin
    .from("operators")
    .select("id, full_name, role, avatar, depot")
    .eq("id", data.operator_id)
    .maybeSingle();

  // 4f. La auditoría de emisión ya quedó en la MISMA transacción de la RPC.

  // 4i. Notificaciones automáticas por rol (best-effort, no bloquea — el email
  //     JAMÁS rompe la orden). 4 correos diferenciados:
  //       depósito (según sede) · director · facturación · cliente.
  //     Auditoría + anti-duplicados vía `email_sends`. DORMIDO en dev/staging
  //     sin RESEND_API_KEY (sendOneOrderEmail devuelve { skipped:true }).
  try {
    const publicUrl = `${env.app.url}/orders/${ord.public_id}`;
    const orderForEmail: Order = {
      ...(ord as Order),
      signature_url: null,
      pdf_url: null,
      client: clientParaDocumentos as unknown as Order["client"],
      operator: opRow ? (opRow as unknown as Order["operator"]) : undefined,
      services: issuedServices.map((s) => ({ ...s, unit: s.unit as ServiceUnit })),
    };
    const plan = orderEmailPlan(orderForEmail, canonicalClientEmail, {
      depotMagaldi: env.email.depot.magaldi,
      depotLujan: env.email.depot.lujan,
      director: env.email.admin.joseluis,
      facturacion: env.email.admin.ruth,
    });

    for (const item of plan) {
      // PostgreSQL resuelve otra vez el destinatario cliente, fija una clave
      // durable y rechaza cualquier intento de usar la RPC como relay desde
      // una sesión normal. Sin prepare exitoso no existe egress.
      const { data: preparedRaw, error: prepareError } = await admin.rpc(
        "service_order_prepare_email_delivery",
        {
          p_order_id: ord.id,
          p_tag: item.tag,
          p_internal_to: item.role === "cliente" ? null : item.to,
          p_retry_unknown: false,
        },
      );
      const prepared = preparedRaw as {
        attempt_key?: string;
        status?: "queued" | "sent" | "failed" | "unknown";
        to_email?: string;
        provider_id?: string | null;
      } | null;
      if (
        prepareError || !prepared?.attempt_key || !prepared.to_email
        || prepared.status !== "queued"
      ) continue;

      const urgent = isUrgentOrder(orderForEmail);
      const html = renderRoleHtml(
        orderForEmail,
        item.role,
        publicUrl,
        undefined,
        urgent,
      );
      const text = renderRoleText(
        orderForEmail,
        item.role,
        publicUrl,
        undefined,
        urgent,
      );
      let res: Awaited<ReturnType<typeof sendOneOrderEmail>>;
      try {
        res = await sendOneOrderEmail({
          to: prepared.to_email,
          subject: item.subject,
          html,
          text,
          idempotencyKey: prepared.attempt_key,
        });
      } catch {
        res = { ok: false, ambiguous: true, error: "ORDER_EMAIL_NETWORK_AMBIGUOUS" };
      }
      if (res.skipped) {
        // Dormido sin credenciales: la intención queda queued, sin afirmar
        // que el proveedor recibió nada.
        continue;
      }
      const finalStatus = res.ok && res.id
        ? "sent"
        : res.ambiguous
          ? "unknown"
          : "failed";
      const { error: finalizeError } = await admin.rpc(
        "service_order_finalize_email_delivery",
        {
          p_order_id: ord.id,
          p_tag: item.tag,
          p_attempt_key: prepared.attempt_key,
          p_status: finalStatus,
          p_provider_id: res.id ?? null,
          p_error_code: finalStatus === "sent"
            ? null
            : finalStatus === "unknown"
              ? "ORDER_EMAIL_DELIVERY_UNKNOWN"
              : ORDER_EMAIL_FAILURE_CODE,
        },
      );
      if (finalizeError) {
        console.error("[createOrder] email evidence finalize failed", {
          code: "ORDER_EMAIL_FINALIZE_FAILED",
        });
      }
      if (finalStatus !== "sent") {
        // F4.4-E3: fin del silent failure — aviso interno a admin (best-effort,
        // sin PII: ni dirección ni cuerpo; solo orden + rol + error recortado).
        const { error: notifErr } = await admin.from("notifications").insert(
          emailFailureNotification({
            orderId: ord.id,
            publicId: ord.public_id,
            tag: item.tag,
            providerError: ORDER_EMAIL_FAILURE_CODE,
          }),
        );
        if (notifErr) {
          console.error("[createOrder] email failure notice insert failed", {
            code: "EMAIL_FAILURE_NOTICE_INSERT_FAILED",
          });
        }
      }
    }
  } catch {
    console.error("[createOrder] order notifications failed (non-blocking)", {
      code: "ORDER_NOTIFICATION_FLOW_FAILED",
    });
  }

  // 4j. Revalidate caches
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath(`/orders/${ord.public_id}`);

  return { ok: true, id: ord.id, public_id: ord.public_id };
}

// ----- helpers -----

/** Calcula horas operativas a partir de strings "HH:MM". Nunca devuelve <1. */
function computeHours(h_start: string, h_end: string): number {
  const toMin = (t: string): number | null => {
    if (!/^\d{2}:\d{2}$/.test(t)) return null;
    const [hh, mm] = t.split(":").map((p) => parseInt(p, 10));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  };
  const a = toMin(h_start);
  const b = toMin(h_end);
  if (a == null || b == null) return 1;
  const diffMin = b - a;
  if (diffMin <= 0) return 1;
  return Math.max(1, Math.round(diffMin / 60));
}

function safeServiceIssueError(message?: string): string {
  const value = message ?? "";
  if (/tarifario cambi[oó]|precio particular cambi[oó]/i.test(value)) {
    return "Los precios cambiaron mientras firmabas. Recargá y revisá la orden.";
  }
  if (/requiere cotizaci[oó]n|requiere cotizacion/i.test(value)) {
    return "Uno de los servicios requiere una tarifa aprobada antes de emitir.";
  }
  if (/total firmado no coincide/i.test(value)) {
    return "El total firmado no coincide con el tarifario vigente. Recargá y revisá la orden.";
  }
  return "No pudimos emitir la orden de forma atómica. Reintentá en unos minutos.";
}

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
  const hours = computeHours(data.h_start, data.h_end);

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
