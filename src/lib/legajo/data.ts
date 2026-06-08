/**
 * Legajo digital de Clientes y Proveedores — capa de AGREGACIÓN (read-only).
 *
 * No modifica lógica financiera ni CRM: sólo LEE y agrupa por id las fuentes
 * existentes (clients/vendors, customer/supplier_invoices, current_account, POs).
 * RLS por sesión aplica (igual que el resto de los módulos).
 */
import { createClient } from "@/lib/supabase/server";
import { getVendor, listPurchaseOrders } from "@/lib/compras/data";
import type { Vendor, PurchaseOrder } from "@/lib/types-po";

export interface ClienteRow {
  id: string; razon: string | null; cuit: string | null; domicilio: string | null;
  telefono: string | null; email: string | null; contacto: string | null;
  tags: string[] | null; deposito_asignado: string | null; condicion_iva: string | null;
  localidad: string | null; activo: boolean | null; created_at: string | null;
}
export interface FacturaClienteRow {
  id: string; numero_comprobante: number | null; tipo_comprobante: string | null;
  created_at: string | null; fch_vto_pago: string | null; total: number | null; estado_arca: string | null;
}
export interface CuentaSaldo {
  facturas_abiertas: number | null; total_facturado: number | null;
  cobrado_pagado: number | null; saldo_cuenta: number | null; proxima_vencimiento: string | null;
}

export interface ClienteFicha {
  cliente: ClienteRow;
  facturas: FacturaClienteRow[];
  saldo: CuentaSaldo | null;
}

export async function getClienteFicha(id: string): Promise<ClienteFicha | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const { data: cliente } = await supabase
    .from("clients")
    .select("id, razon, cuit, domicilio, telefono, email, contacto, tags, deposito_asignado, condicion_iva, localidad, activo, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!cliente) return null;

  const [{ data: fact }, { data: cc }] = await Promise.all([
    supabase
      .from("customer_invoices")
      .select("id, numero_comprobante, tipo_comprobante, created_at, fch_vto_pago, total, estado_arca")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("customer_current_account")
      .select("facturas_abiertas, total_facturado, total_cobrado, saldo_cuenta, proxima_vencimiento")
      .eq("client_id", id)
      .maybeSingle(),
  ]);

  return {
    cliente: cliente as ClienteRow,
    facturas: (fact ?? []) as FacturaClienteRow[],
    saldo: cc
      ? {
          facturas_abiertas: cc.facturas_abiertas ?? null,
          total_facturado: cc.total_facturado ?? null,
          cobrado_pagado: cc.total_cobrado ?? null,
          saldo_cuenta: cc.saldo_cuenta ?? null,
          proxima_vencimiento: cc.proxima_vencimiento ?? null,
        }
      : null,
  };
}

export interface FacturaProveedorRow {
  id: string; public_id: string | null; numero: string | null; tipo_comprobante: string | null;
  fecha_emision: string | null; fecha_vencimiento: string | null; total: number | null; status: string | null;
}
export interface ProveedorFicha {
  proveedor: Vendor;
  ocs: PurchaseOrder[];
  facturas: FacturaProveedorRow[];
  saldo: CuentaSaldo | null;
}

export async function getProveedorFicha(id: string): Promise<ProveedorFicha | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const proveedor = await getVendor(id);
  if (!proveedor) return null;

  const [poRes, { data: fact }, { data: cc }] = await Promise.all([
    listPurchaseOrders({ vendor_id: id }).catch(() => ({ rows: [] as PurchaseOrder[] })),
    supabase
      .from("supplier_invoices")
      .select("id, public_id, numero, tipo_comprobante, fecha_emision, fecha_vencimiento, total, status")
      .eq("vendor_id", id)
      .order("fecha_emision", { ascending: false })
      .limit(100),
    supabase
      .from("supplier_current_account")
      .select("facturas_abiertas, total_facturado, total_pagado, saldo_cuenta, proxima_vencimiento")
      .eq("vendor_id", id)
      .maybeSingle(),
  ]);

  return {
    proveedor,
    ocs: (poRes as { rows: PurchaseOrder[] }).rows ?? [],
    facturas: (fact ?? []) as FacturaProveedorRow[],
    saldo: cc
      ? {
          facturas_abiertas: cc.facturas_abiertas ?? null,
          total_facturado: cc.total_facturado ?? null,
          cobrado_pagado: cc.total_pagado ?? null,
          saldo_cuenta: cc.saldo_cuenta ?? null,
          proxima_vencimiento: cc.proxima_vencimiento ?? null,
        }
      : null,
  };
}
