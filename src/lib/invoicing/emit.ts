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
import {
  DocTipo,
  alicuotaFromId,
  type CbteAsoc,
  type FECAESolicitarRequest,
} from "@/lib/arca/types";
import {
  comprobanteToCbteTipo,
  comprobanteParaReceptor,
  computeItem,
  computeInvoiceTotals,
  validateInvoice,
  esNotaCredito,
  round2,
  toArcaDate,
  fromArcaDate,
} from "./calc";
import { getFiscalConfig, getInvoice, sumNotasCreditoDe, mockStore } from "./data";
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
  /** G7: obligatoria y explícita — sin default silencioso. */
  alicuota_iva: number;
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

  // Paso 1-2: armar renglones y validar. G7: la alícuota es explícita y debe
  // ser válida — computeItem/alicuotaToId rechazan cualquier otra.
  let items: InvoiceItem[];
  try {
    items = input.items.map((it, i) => {
      const c = computeItem({
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        alicuota_iva: it.alicuota_iva,
      });
      return {
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        alicuota_iva: it.alicuota_iva,
        order_id: it.order_id ?? null,
        orden: i,
        ...c,
      };
    });
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }

  const totals = computeInvoiceTotals(items, {
    percepciones: input.percepciones,
    tributos: input.tributos,
  });

  // H1 — resolver el comprobante asociado (obligatorio en NC/ND, RG 4540).
  const asociado = input.comprobante_asociado_id
    ? await getInvoice(input.comprobante_asociado_id)
    : null;
  if (input.comprobante_asociado_id && !asociado) {
    return { ok: false, errors: ["El comprobante asociado no existe."] };
  }

  const validation = validateInvoice({
    tipo_comprobante: tipo,
    cuit_cliente: input.cuit_cliente ?? null,
    items,
    totals,
    concepto,
    fch_serv_desde: input.fch_serv_desde ?? null,
    fch_serv_hasta: input.fch_serv_hasta ?? null,
    comprobante_asociado: asociado,
    ambiente,
  });
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  // H1 — tope de acreditación: ΣNC (autorizadas, no anuladas) ≤ total original.
  if (asociado && esNotaCredito(tipo)) {
    const acreditado = await sumNotasCreditoDe(asociado.id);
    const restante = round2(Number(asociado.total) - acreditado);
    if (totals.total > restante + 0.02) {
      return {
        ok: false,
        errors: [
          `La NC excede el saldo acreditable del comprobante asociado: restante $${restante.toFixed(2)}, NC $${totals.total.toFixed(2)}.`,
        ],
      };
    }
  }

  // H1 — CbtesAsoc para el request ARCA (la identidad del original).
  const cbtesAsoc: CbteAsoc[] | undefined = asociado
    ? [
        {
          Tipo: asociado.cbte_tipo_arca,
          PtoVta: asociado.punto_venta,
          Nro: asociado.numero_comprobante!,
          Cuit: config.cuit.replace(/\D/g, ""),
          CbteFch: toArcaDate(
            asociado.fecha_autorizacion_arca ?? asociado.created_at
          ),
        },
      ]
    : undefined;

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
          CbtesAsoc: cbtesAsoc,
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

  // IVA VENTAS V1 — detalle canónico del débito fiscal por alícuota.
  // El importe canónico es LO DECLARADO A ARCA (totals.alicuotas = Σ de
  // renglones redondeados): Σ líneas ≡ cabecera por construcción.
  const vatLines = args.totals.alicuotas.map((a) => ({
    alic_iva_id: a.Id,
    alicuota_iva: alicuotaFromId(a.Id),
    neto_gravado: a.BaseImp,
    iva_importe: a.Importe,
  }));

  if (env.app.demoMode || env.app.needsSupabase) {
    const invoice: CustomerInvoice = { id: cryptoRandomId(), ...base, vat_lines: vatLines };
    mockStore().invoices.unshift(invoice);
    return invoice;
  }

  const supabase = createClient();
  if (!supabase) return null;

  // V1 — persistencia TRANSACCIONAL: cabecera + items + vat_lines + auditoría
  // en una sola transacción (RPC security definer; el trigger diferido
  // trg_ci_vat_identity garantiza que no existan comprobantes sin líneas IVA).
  const { items: _items, vat_lines: _vl, ...row } = base;
  const auditEntries = [
    {
      user_id: args.ctx.userId,
      action: "emitir",
      estado: "PENDIENTE_ARCA",
      cae: null,
      request: args.request ?? null,
      response: null,
      ip: args.ctx.ip ?? null,
    },
    {
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
  ];

  const { data, error } = await supabase.rpc("ventas_persist_invoice", {
    p_invoice: row,
    p_items: args.items,
    p_vat_lines: vatLines,
    p_audit: auditEntries,
  });
  if (error) throw new Error(`persistInvoice(ventas_persist_invoice): ${error.message}`);

  const invoice = data as CustomerInvoice;
  invoice.items = args.items;
  invoice.vat_lines = vatLines;
  return invoice;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `inv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
