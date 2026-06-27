"use server";

import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_CONFIG,
  DEFAULT_ESCALA,
  type Concepto,
  type EscalaTramo,
  type RetenciónConfig,
  type RetenciónResult,
} from "@/lib/compras/retencion-ganancias";

// ─── Tipos ────────────────────────────────────────────────────

export interface VendorFiscalInfo {
  id:                   string;
  razon:                string;
  cuit:                 string;
  concepto_ganancias:   Concepto | null;
  exento_ganancias:     boolean;
  cert_exclusion_hasta: string | null;
  cond_iva:             string | null;
}

export interface RetenciónContext {
  vendor:              VendorFiscalInfo;
  config:              RetenciónConfig;
  escala:              EscalaTramo[];
  acumuladoPrevio:     number;
  normativaVersion:    string;
  retenciónExistente:  boolean;
}

// ─── Contexto consolidado (una sola llamada a la DB) ─────────

export async function fetchRetenciónContextAction(
  vendorId: string,
  fecha: string,
): Promise<RetenciónContext | null> {
  const supabase = createClient();
  if (!supabase) return buildDemoContext();

  const { data, error } = await supabase.rpc("ap_get_retencion_context", {
    p_vendor_id: vendorId,
    p_fecha:     fecha || new Date().toISOString().slice(0, 10),
  });

  if (error || !data || data.error) return null;

  const params  = (data.params  ?? {}) as Record<string, number>;
  const escalaBd = (data.escala ?? []) as Array<{
    desde: number; hasta: number | null; fijo: number; pct: number;
  }>;

  const config: RetenciónConfig = {
    minHonorarios:   params["honorarios_min_no_sujeto"]  ?? DEFAULT_CONFIG.minHonorarios,
    minMercaderias:  params["mercaderias_min_no_sujeto"] ?? DEFAULT_CONFIG.minMercaderias,
    minServicios:    params["servicios_min_no_sujeto"]   ?? DEFAULT_CONFIG.minServicios,
    minAlquileres:   params["alquileres_min_no_sujeto"]  ?? DEFAULT_CONFIG.minAlquileres,
    rateMercaderias: params["mercaderias_alicuota"]      ?? DEFAULT_CONFIG.rateMercaderias,
    rateServicios:   params["servicios_alicuota"]        ?? DEFAULT_CONFIG.rateServicios,
    rateAlquileres:  params["alquileres_alicuota"]       ?? DEFAULT_CONFIG.rateAlquileres,
  };

  const escala: EscalaTramo[] = escalaBd.length > 0 ? escalaBd : DEFAULT_ESCALA;

  const vendor  = data.vendor as VendorFiscalInfo;
  return {
    vendor,
    config,
    escala,
    acumuladoPrevio:    Number(data.acumulado_previo)   || 0,
    normativaVersion:   String(data.normativa_version   ?? ""),
    retenciónExistente: Boolean(data.retencion_existente),
  };
}

// ─── Guardar concepto de retención en el proveedor ───────────

export async function saveVendorConceptoGananciasAction(
  vendorId: string,
  concepto: Concepto,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Sin conexión" };

  const { error } = await supabase.rpc("ap_set_vendor_concepto_ganancias", {
    p_vendor_id: vendorId,
    p_concepto:  concepto,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ─── Guardar retención (completa con auditoría) ───────────────

export async function saveRetenciónAction(
  supplierInvoiceId: string,
  result: RetenciónResult,
  fechaPago: string,
  observaciones?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Sin conexión" };

  const { data, error } = await supabase.rpc("ap_upsert_retencion_ganancias", {
    p_supplier_invoice_id: supplierInvoiceId,
    p_concepto:            result.concepto,
    p_tipo_comprobante:    result.tipoComprobante,
    p_fecha_pago:          fechaPago,
    p_neto_gravado:        result.netoGravado,
    p_total_factura:       result.totalFactura || null,
    p_acumulado_previo:    result.acumuladoPrevio,
    p_acumulado_total:     result.acumuladoTotal,
    p_minimo_no_sujeto:    result.minimo,
    p_base_imponible:      result.baseImponible,
    p_excedente:           result.excedente,
    p_alicuota:            result.alicuota,
    p_fijo_escala:         result.fijo,
    p_pct_monto:           result.pctMonto,
    p_retencion:           result.retencion,
    p_neto_a_pagar:        result.netoPagar,
    p_corresponde:         result.corresponde,
    p_motivo:              result.motivo,
    p_tramo_txt:           result.tramoTxt || null,
    p_metodo:              result.metodo,
    p_observaciones:       observaciones || null,
    p_normativa_version:   result.normativaVersion,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data as string };
}

// ─── Demo / fallback ──────────────────────────────────────────

function buildDemoContext(): RetenciónContext {
  return {
    vendor: {
      id: "",
      razon: "",
      cuit: "",
      concepto_ganancias:   null,
      exento_ganancias:     false,
      cert_exclusion_hasta: null,
      cond_iva:             null,
    },
    config:             DEFAULT_CONFIG,
    escala:             DEFAULT_ESCALA,
    acumuladoPrevio:    0,
    normativaVersion:   "demo",
    retenciónExistente: false,
  };
}
