import { renderToBuffer } from "@react-pdf/renderer";
import type React from "react";
import { createClient } from "@/lib/supabase/server";
import { getFiscalConfig } from "@/lib/invoicing/data";
import { fmtCuit, fmtDate } from "@/lib/utils";
import { COMPROBANTE_LABEL, type ComprobanteTipo } from "@/lib/invoicing/types";
import {
  ReciboPdfDocument,
  type ReciboComprobante,
  type ReciboData,
  type ReciboMedioPago,
} from "./ReciboPdfDocument";

/**
 * Carga de datos + render on-demand del Recibo de cobranza. SOLO LECTURA:
 * cliente Supabase de sesión (la RLS de 0053 limita a roles internos), sin
 * escritura a DB ni storage. Sin QR (no existe URL pública de validación).
 *
 * ⚠️ Colisión conocida de prefijo `REC-`: customer_receipts usa
 * `REC-YYYY-NNNNNN` (0053) y las recepciones WMS `REC-YYYY-NNNN` (0025).
 * No se resuelve acá: este loader consulta exclusivamente customer_receipts.
 */

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

/** «Factura A 00003-00001234» a partir del snapshot fiscal del comprobante. */
function comprobanteLabel(inv: RawInvoice | null): string {
  if (!inv) return "";
  const tipo =
    (COMPROBANTE_LABEL as Record<string, string>)[inv.tipo_comprobante ?? ""] ??
    inv.tipo_comprobante ??
    "Comprobante";
  const pv = inv.punto_venta != null ? String(inv.punto_venta).padStart(5, "0") : null;
  const nro =
    inv.numero_comprobante != null ? String(inv.numero_comprobante).padStart(8, "0") : null;
  return pv && nro ? `${tipo} ${pv}-${nro}` : tipo;
}

interface RawInvoice {
  tipo_comprobante: ComprobanteTipo | string | null;
  punto_venta: number | null;
  numero_comprobante: number | string | null;
  created_at: string | null;
}

interface RawAllocation {
  amount: number | string | null;
  customer_invoices?: RawInvoice | RawInvoice[] | null;
}

interface RawClient {
  razon: string | null;
  cuit: string | null;
  domicilio: string | null;
}

interface RawBankAccount {
  bank_name: string | null;
  account_name: string | null;
  alias: string | null;
  cbu: string | null;
}

interface RawReceipt {
  id: string;
  public_id: string;
  payment_date: string | null;
  payment_method: ReciboMedioPago;
  gross_amount: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
  observations: string | null;
  status: string;
  clients?: RawClient | RawClient[] | null;
  bank_accounts?: RawBankAccount | RawBankAccount[] | null;
  receipt_allocations?: RawAllocation[] | null;
}

export async function getReciboData(idOrPublicId: string): Promise<ReciboData | null> {
  const supabase = createClient();
  if (!supabase) return null;

  let qb = supabase
    .from("customer_receipts")
    .select(
      `id, public_id, payment_date, payment_method, gross_amount, retention_amount,
       net_amount, observations, status,
       clients(razon, cuit, domicilio),
       bank_accounts(bank_name, account_name, alias, cbu),
       receipt_allocations(amount,
         customer_invoices(tipo_comprobante, punto_venta, numero_comprobante, created_at))`
    );
  qb = isUuid(idOrPublicId) ? qb.eq("id", idOrPublicId) : qb.eq("public_id", idOrPublicId);
  const { data, error } = await qb.maybeSingle();
  if (error) throw new Error(`getReciboData: ${error.message}`);
  if (!data) return null;

  const r = data as unknown as RawReceipt;
  const client = one(r.clients);
  const bank = one(r.bank_accounts);

  const comprobantes: ReciboComprobante[] = (r.receipt_allocations ?? []).map((a) => {
    const inv = one(a.customer_invoices);
    return {
      comprobante: comprobanteLabel(inv),
      fecha: inv?.created_at ? fmtDate(inv.created_at) || null : null,
      importeImputado: Number(a.amount ?? 0),
    };
  });

  const gross = Number(r.gross_amount ?? 0);
  const retention = Number(r.retention_amount ?? 0);
  const net = Number(r.net_amount ?? gross - retention);

  // Línea de banco: sólo si el medio efectivamente pasa por una cuenta
  // (transferencia / cheque / e-cheq). El efectivo imputa a CAJA (C4) y en el
  // formulario esa línea queda en blanco, como en la referencia.
  const bancoLinea =
    r.payment_method !== "efectivo" && bank
      ? [bank.bank_name, bank.account_name, bank.alias ?? bank.cbu]
          .filter(Boolean)
          .join(" · ")
      : null;

  // Misma fuente fiscal que la Factura: evita que dos documentos declaren
  // Ingresos Brutos distintos si se edita /settings/fiscal.
  const fiscal = await getFiscalConfig();

  return {
    ingresosBrutos: fiscal.ingresos_brutos ?? null,
    numero: r.public_id,
    fecha: fmtDate(r.payment_date) || null,
    lugar: "CABA",
    moneda: "ARS",
    clienteRazon: client?.razon ?? null,
    clienteCuit: client?.cuit ? fmtCuit(client.cuit) : null,
    clienteDomicilio: client?.domicilio ?? null,
    comprobantes,
    medioPago: r.payment_method,
    bancoLinea,
    importeMedio: r.payment_method === "transferencia" ? net : null,
    retencion: retention,
    sumaImputada: comprobantes.reduce((acc, c) => acc + c.importeImputado, 0),
    total: gross,
    observaciones: r.observations ?? null,
    anulado: r.status === "anulado",
  };
}

export async function buildReciboPdf(data: ReciboData): Promise<Buffer> {
  return renderToBuffer(ReciboPdfDocument({ data }) as unknown as React.ReactElement);
}
