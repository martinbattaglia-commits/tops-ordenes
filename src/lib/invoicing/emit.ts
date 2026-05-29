/**
 * Orquestación de emisión de comprobantes (flujo de 10 pasos del spec):
 *
 *  1. El usuario arma el comprobante (input).
 *  2. Se valida (identidad de importes, datos del receptor, fechas).
 *  3. Se materializa el comprobante electrónico (BORRADOR → PENDIENTE_ARCA).
 *  4. Se solicita autorización a ARCA (FECompUltimoAutorizado + FECAESolicitar).
 *  5. ARCA devuelve CAE + vencimiento + número autorizado.
 *  6. (PDF se genera aparte, on-demand, desde el comprobante autorizado).
 *  7. Se incorpora el QR fiscal (qr_data / qr_url / qr_hash).
 *  8. (PDF se almacena en bucket `invoices` al materializarse).
 *  9. (El envío al cliente queda para la capa de acciones/email).
 * 10. Se registra auditoría completa en cada paso (invoice_audit).
 *
 * NO toca AFIP real salvo que el ambiente sea PRODUCCION/HOMOLOGACION (hoy
 * stub). En SANDBOX usa el Mock ARCA Service.
 */

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getArcaService } from "@/lib/arca/service";
import { buildFiscalQr } from "@/lib/arca/qr";
import { DocTipo, type FECAESolicitarRequest } from "@/lib/arca/types";
import {
  comprobanteToCbteTipo,
  comprobanteParaReceptor,
  computeItem,
  computeInvoiceTotals,
  validateInvoice,
  toArcaDate,
  fromArcaDate,
} from "./calc";
import { getFiscalConfig, mockStore } from "./data";
import type {
  ComprobanteTipo,
  CondicionIva,
  CustomerInvoice,
  InvoiceItem,
} from "./types";

export interface EmitItemInput {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  alicuota_iva?: number; // default 21
  order_id?: string | null;
}

export interface EmitInvoiceInput {
  client_id?: string | null;
  cuit_cliente?: string | null;
  razon_social: string;
  condicion_iva: CondicionIva;
  domicilio_cliente?: string | null;
  doc_tipo?: number;
  /** Si se omite, se deriva de la condición IVA del receptor. */
  tipo_comprobante?: ComprobanteTipo;
  concepto?: number; // default 2 (servicios)
  punto_venta?: number; // default config.default_punto_venta
  items: EmitItemInput[];
  fch_serv_desde?: string | null;
  fch_serv_hasta?: string | null;
  fch_vto_pago?: string | null;
  periodo?: string | null;
  percepciones?: number;
  tributos?: number;
  moneda?: string;
  cotizacion?: number;
  comprobante_asociado_id?: string | null;
  observ?: string | null;
}

export interface EmitContext {
  userId: string | null;
  ip?: string | null;
}

export interface EmitResult {
  ok: boolean;
  invoice?: CustomerInvoice;
  errors?: string[];
}

export async function emitInvoice(
  input: EmitInvoiceInput,
  ctx: EmitContext
): Promise<EmitResult> {
  const config = await getFiscalConfig();
  const ambiente = config.ambiente;
  const tipo: ComprobanteTipo =
    input.tipo_comprobante ?? comprobanteParaReceptor(input.condicion_iva);
  const cbteTipo = comprobanteToCbteTipo(tipo);
  const concepto = (input.concepto ?? 2) as 1 | 2 | 3;
  const puntoVenta = input.punto_venta ?? config.default_punto_venta ?? 1;
  const docTipo = (input.doc_tipo ?? DocTipo.CUIT) as InvoiceItemDocTipo;

  // Paso 1-2: armar renglones y validar.
  const items: InvoiceItem[] = input.items.map((it, i) => {
    const alic = it.alicuota_iva ?? 21;
    const c = computeItem({
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      alicuota_iva: alic,
    });
    return {
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      alicuota_iva: alic,
      order_id: it.order_id ?? null,
      orden: i,
      ...c,
    };
  });

  const totals = computeInvoiceTotals(items, {
    percepciones: input.percepciones,
    tributos: input.tributos,
  });

  const validation = validateInvoice({
    tipo_comprobante: tipo,
    cuit_cliente: input.cuit_cliente ?? null,
    items,
    totals,
    concepto,
    fch_serv_desde: input.fch_serv_desde ?? null,
    fch_serv_hasta: input.fch_serv_hasta ?? null,
  });
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  // Paso 4: pedir número + CAE a ARCA.
  const arca = getArcaService(ambiente);
  let numeroComprobante: number;
  let cae: string;
  let caeVtoIso: string;
  let arcaRequest: FECAESolicitarRequest;
  let arcaResponse: unknown;

  try {
    const ultimo = await arca.ultimoComprobanteAutorizado(puntoVenta, cbteTipo);
    numeroComprobante = ultimo + 1;

    const hoy = new Date();
    arcaRequest = {
      FeCabReq: { CantReg: 1, PtoVta: puntoVenta, CbteTipo: cbteTipo },
      FeDetReq: [
        {
          Concepto: concepto,
          DocTipo: docTipo,
          DocNro: Number((input.cuit_cliente ?? "0").replace(/\D/g, "")),
          CbteDesde: numeroComprobante,
          CbteHasta: numeroComprobante,
          CbteFch: toArcaDate(hoy),
          ImpTotal: totals.total,
          ImpTotConc: totals.importe_no_gravado,
          ImpNeto: totals.subtotal,
          ImpOpEx: totals.importe_exento,
          ImpIVA: totals.iva,
          ImpTrib: totals.tributos,
          MonId: input.moneda ?? "PES",
          MonCotiz: input.cotizacion ?? 1,
          ...(concepto !== 1
            ? {
                FchServDesde: input.fch_serv_desde
                  ? toArcaDate(input.fch_serv_desde)
                  : toArcaDate(hoy),
                FchServHasta: input.fch_serv_hasta
                  ? toArcaDate(input.fch_serv_hasta)
                  : toArcaDate(hoy),
                FchVtoPago: input.fch_vto_pago
                  ? toArcaDate(input.fch_vto_pago)
                  : toArcaDate(hoy),
              }
            : {}),
          Iva: totals.alicuotas.length ? totals.alicuotas : undefined,
        },
      ],
    };

    const resp = await arca.solicitarCAE(arcaRequest, {
      cuit: config.cuit,
      ambiente,
    });
    arcaResponse = resp;

    const det = resp.FeDetResp[0];
    if (resp.FeCabResp.Resultado !== "A" || !det || det.Resultado !== "A") {
      // Paso 5 (rechazo): persistir RECHAZADO + auditoría.
      const obs =
        det?.Observaciones?.map((o) => `${o.Code}: ${o.Msg}`).join("; ") ??
        resp.Errors?.map((e) => `${e.Code}: ${e.Msg}`).join("; ") ??
        "ARCA rechazó el comprobante.";
      const rejected = await persistInvoice({
        input,
        tipo,
        cbteTipo,
        concepto,
        puntoVenta,
        docTipo,
        items,
        totals,
        ambiente,
        numeroComprobante: null,
        cae: null,
        caeVtoIso: null,
        qr: null,
        estado: "RECHAZADO_ARCA",
        errorMsg: obs,
        request: arcaRequest,
        response: arcaResponse,
        ctx,
      });
      return { ok: false, invoice: rejected ?? undefined, errors: [obs] };
    }

    cae = det.CAE;
    caeVtoIso = fromArcaDate(det.CAEFchVto);
    numeroComprobante = det.CbteDesde;
  } catch (e) {
    // Paso 5 (error técnico): persistir ERROR_ARCA + auditoría.
    const msg = e instanceof Error ? e.message : String(e);
    const errored = await persistInvoice({
      input,
      tipo,
      cbteTipo,
      concepto,
      puntoVenta,
      docTipo,
      items,
      totals,
      ambiente,
      numeroComprobante: null,
      cae: null,
      caeVtoIso: null,
      qr: null,
      estado: "ERROR_ARCA",
      errorMsg: msg,
      request: arcaRequest! ?? null,
      response: null,
      ctx,
    });
    return { ok: false, invoice: errored ?? undefined, errors: [msg] };
  }

  // Paso 7: QR fiscal sobre el comprobante autorizado.
  const qr = buildFiscalQr({
    fecha: new Date().toISOString().slice(0, 10),
    cuitEmisor: config.cuit,
    ptoVta: puntoVenta,
    cbteTipo,
    nroCmp: numeroComprobante,
    importeTotal: totals.total,
    moneda: input.moneda ?? "PES",
    cotizacion: input.cotizacion ?? 1,
    docTipoReceptor: docTipo,
    docNroReceptor: input.cuit_cliente ?? "0",
    cae,
  });

  // Paso 3/5/8: persistir AUTORIZADO con CAE + QR + auditoría completa.
  const invoice = await persistInvoice({
    input,
    tipo,
    cbteTipo,
    concepto,
    puntoVenta,
    docTipo,
    items,
    totals,
    ambiente,
    numeroComprobante,
    cae,
    caeVtoIso,
    qr,
    estado: "AUTORIZADO_ARCA",
    errorMsg: null,
    request: arcaRequest,
    response: arcaResponse,
    ctx,
  });

  return { ok: true, invoice: invoice ?? undefined };
}

type InvoiceItemDocTipo = 80 | 86 | 96 | 99;

interface PersistArgs {
  input: EmitInvoiceInput;
  tipo: ComprobanteTipo;
  cbteTipo: number;
  concepto: number;
  puntoVenta: number;
  docTipo: number;
  items: InvoiceItem[];
  totals: ReturnType<typeof computeInvoiceTotals>;
  ambiente: CustomerInvoice["ambiente"];
  numeroComprobante: number | null;
  cae: string | null;
  caeVtoIso: string | null;
  qr: ReturnType<typeof buildFiscalQr> | null;
  estado: CustomerInvoice["estado_arca"];
  errorMsg: string | null;
  request: unknown;
  response: unknown;
  ctx: EmitContext;
}

/** Inserta el comprobante + items y registra auditoría. Mock o Supabase. */
async function persistInvoice(args: PersistArgs): Promise<CustomerInvoice | null> {
  const nowIso = new Date().toISOString();
  const base: Omit<CustomerInvoice, "id"> = {
    client_id: args.input.client_id ?? null,
    cuit_cliente: args.input.cuit_cliente ?? null,
    razon_social: args.input.razon_social,
    condicion_iva: args.input.condicion_iva,
    domicilio_cliente: args.input.domicilio_cliente ?? null,
    doc_tipo: args.docTipo as 80 | 86 | 96 | 99,
    tipo_comprobante: args.tipo,
    cbte_tipo_arca: args.cbteTipo as CustomerInvoice["cbte_tipo_arca"],
    concepto: args.concepto as CustomerInvoice["concepto"],
    punto_venta: args.puntoVenta,
    numero_comprobante: args.numeroComprobante,
    fch_serv_desde: args.input.fch_serv_desde ?? null,
    fch_serv_hasta: args.input.fch_serv_hasta ?? null,
    fch_vto_pago: args.input.fch_vto_pago ?? null,
    periodo: args.input.periodo ?? null,
    cae: args.cae,
    fecha_vencimiento_cae: args.caeVtoIso,
    fecha_autorizacion_arca: args.estado === "AUTORIZADO_ARCA" ? nowIso : null,
    qr_data: args.qr?.json ?? null,
    qr_url: args.qr?.url ?? null,
    qr_hash: args.qr?.hash ?? null,
    subtotal: args.totals.subtotal,
    importe_no_gravado: args.totals.importe_no_gravado,
    importe_exento: args.totals.importe_exento,
    iva: args.totals.iva,
    percepciones: args.totals.percepciones,
    tributos: args.totals.tributos,
    total: args.totals.total,
    moneda: args.input.moneda ?? "PES",
    cotizacion: args.input.cotizacion ?? 1,
    estado_arca: args.estado,
    request_arca: args.request ?? null,
    response_arca: args.response ?? null,
    ambiente: args.ambiente,
    error_msg: args.errorMsg,
    comprobante_asociado_id: args.input.comprobante_asociado_id ?? null,
    anulada: false,
    pdf_bucket: null,
    pdf_path: null,
    pdf_url: null,
    observ: args.input.observ ?? null,
    emitido_por: args.ctx.userId,
    created_at: nowIso,
    updated_at: nowIso,
    items: args.items,
  };

  if (env.app.demoMode || env.app.needsSupabase) {
    const invoice: CustomerInvoice = { id: cryptoRandomId(), ...base };
    mockStore().invoices.unshift(invoice);
    return invoice;
  }

  const supabase = createClient();
  if (!supabase) return null;

  const { items: _items, ...row } = base;
  const { data, error } = await supabase
    .from("customer_invoices")
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(`persistInvoice: ${error.message}`);
  const invoice = data as CustomerInvoice;

  if (args.items.length) {
    const itemRows = args.items.map((it) => ({ ...it, invoice_id: invoice.id }));
    const { error: itErr } = await supabase.from("invoice_items").insert(itemRows);
    if (itErr) throw new Error(`persistInvoice.items: ${itErr.message}`);
  }

  // Auditoría: emitir + resultado fiscal.
  await supabase.from("invoice_audit").insert([
    {
      invoice_id: invoice.id,
      user_id: args.ctx.userId,
      action: "emitir",
      estado: "PENDIENTE_ARCA",
      request: args.request ?? null,
      ip: args.ctx.ip ?? null,
    },
    {
      invoice_id: invoice.id,
      user_id: args.ctx.userId,
      action:
        args.estado === "AUTORIZADO_ARCA"
          ? "autorizado"
          : args.estado === "RECHAZADO_ARCA"
          ? "rechazado"
          : "error",
      estado: args.estado,
      cae: args.cae,
      request: args.request ?? null,
      response: args.response ?? null,
      ip: args.ctx.ip ?? null,
    },
  ]);

  invoice.items = args.items;
  return invoice;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `inv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
