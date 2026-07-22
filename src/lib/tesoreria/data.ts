/**
 * Data accessors del dominio Tesorería (ERP-A3). READ-ONLY.
 *
 * Mismo patrón que `src/lib/erp/data.ts`: cliente de sesión (RLS aplica → solo
 * roles internos ven datos). Si las migraciones `0053/0054` no estuvieran
 * aplicadas, los accessors lanzan y la página degrada con <ModuleUnavailable/>.
 *
 * D1/D5: ningún saldo se calcula acá. Los saldos bancarios vienen de la vista
 * `treasury_bank_balances` y las cuentas corrientes de `customer/supplier_
 * current_account`. Prohibido sumar movimientos o derivar saldos en TS.
 */
import { createClient } from "@/lib/supabase/server";
import type {
  BankAccount,
  BankBalance,
  Beneficiary,
  OperationalMovement,
  TreasuryMovement,
  CustomerOpenItem,
  SupplierOpenItem,
  CustomerCurrentAccount,
  SupplierCurrentAccount,
  CashflowRow,
} from "./types";

export async function listBankAccounts(): Promise<BankAccount[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("id,bank_name,account_name,account_type,currency,alias,cbu,opening_balance,active,is_system")
    .order("is_system", { ascending: false })
    .order("bank_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BankAccount[];
}

/** D1: saldo bancario DERIVADO — leído de la vista, nunca calculado en TS. */
export async function getBankBalances(): Promise<BankBalance[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("treasury_bank_balances")
    .select("*")
    .order("bank_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BankBalance[];
}

export async function listMovements(opts?: {
  bankAccountId?: string;
  status?: string;
  limit?: number;
}): Promise<TreasuryMovement[]> {
  const supabase = createClient();
  if (!supabase) return [];
  let qb = supabase
    .from("treasury_movements")
    .select(
      "id,public_id,date,type,direction,bank_account_id,amount,description,reference_type,reference_id,transfer_group_id,status,operational_category,beneficiary_id,created_at"
    );
  if (opts?.bankAccountId) qb = qb.eq("bank_account_id", opts.bankAccountId);
  if (opts?.status) qb = qb.eq("status", opts.status);
  const { data, error } = await qb
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (error) throw error;
  return (data ?? []) as TreasuryMovement[];
}

/**
 * Movimientos operativos con el beneficiario ya resuelto (vista 0194).
 * La vista es `security_invoker` ⇒ la RLS de treasury_movements sigue aplicando.
 */
export async function listOperationalMovements(limit = 20): Promise<OperationalMovement[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("treasury_operational_movements")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as OperationalMovement[];
}

/** Catálogo de beneficiarios activos (selector formal de T-004). */
export async function listBeneficiaries(): Promise<Beneficiary[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("treasury_beneficiaries")
    .select("id,full_name,kind,document_id,active")
    .eq("active", true)
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Beneficiary[];
}

export async function listCustomerOpenItems(clientId?: string): Promise<CustomerOpenItem[]> {
  const supabase = createClient();
  if (!supabase) return [];
  let qb = supabase.from("customer_open_items").select("*");
  if (clientId) qb = qb.eq("client_id", clientId);
  const { data, error } = await qb.order("fch_vto_pago", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CustomerOpenItem[];
}

export async function listSupplierOpenItems(vendorId?: string): Promise<SupplierOpenItem[]> {
  const supabase = createClient();
  if (!supabase) return [];
  let qb = supabase.from("supplier_open_items").select("*");
  if (vendorId) qb = qb.eq("vendor_id", vendorId);
  const { data, error } = await qb.order("fecha_vencimiento", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SupplierOpenItem[];
}

/** D5: cuenta corriente cliente DERIVADA — leída de la vista. */
export async function getCustomerCurrentAccount(): Promise<CustomerCurrentAccount[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("customer_current_account")
    .select("*")
    .order("saldo_cuenta", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CustomerCurrentAccount[];
}

/** D5: cuenta corriente proveedor DERIVADA — leída de la vista. */
export async function getSupplierCurrentAccount(): Promise<SupplierCurrentAccount[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("supplier_current_account")
    .select("*")
    .order("saldo_cuenta", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SupplierCurrentAccount[];
}

export async function getCashflowProjection(): Promise<CashflowRow[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("treasury_cashflow_projection")
    .select("*");
  if (error) throw error;
  return (data ?? []) as CashflowRow[];
}

// ───────────────────────────────────────────────────────────────────────────
// DRILL-DOWN de KPIs (trazabilidad). Enriquece los open items con NOMBRE
// (cliente/proveedor) y FECHA DE EMISIÓN. NO recalcula saldos/totales: el
// `saldo`/`total` provienen tal cual de las vistas open_items (D1/D5 intacto).
// Orden: por vencimiento ascendente (heredado de list*OpenItems).
// ───────────────────────────────────────────────────────────────────────────

export interface CobranzaDetailRow {
  invoiceId: string;
  clientId: string | null;
  cliente: string | null;
  factura: string;
  emision: string | null;
  vencimiento: string | null;
  estado: string;
  saldo: number;
  total: number;
  /** tipo de comprobante (FACTURA_* | NOTA_CREDITO_*). Discrimina NC en la cuenta corriente V3. */
  tipoComprobante: string | null;
}

export interface PagoDetailRow {
  invoiceId: string;
  vendorId: string | null;
  proveedor: string | null;
  factura: string;
  emision: string | null;
  vencimiento: string | null;
  estado: string;
  saldo: number;
  total: number;
  /** tipo de comprobante (FACTURA_* | NOTA_CREDITO_*). Discrimina NC en la cuenta corriente V3. */
  tipoComprobante: string | null;
}

export async function listCobranzasDetail(): Promise<CobranzaDetailRow[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const items = await listCustomerOpenItems(); // ya ordenado por fch_vto_pago asc
  if (items.length === 0) return [];
  const ids = Array.from(new Set(items.map((i) => i.invoice_id)));
  const { data: invs } = await supabase
    .from("customer_invoices")
    .select("id, client_id, razon_social, created_at, tipo_comprobante")
    .in("id", ids);
  const meta = new Map((invs ?? []).map((r: { id: string; client_id: string | null; razon_social: string | null; created_at: string | null; tipo_comprobante: string | null }) => [r.id, r]));
  return items.map((it) => {
    const m = meta.get(it.invoice_id);
    return {
      invoiceId: it.invoice_id,
      clientId: m?.client_id ?? null,
      cliente: m?.razon_social ?? null,
      factura: it.numero_comprobante != null ? String(it.numero_comprobante) : it.invoice_id.slice(0, 8),
      emision: m?.created_at ?? null,
      vencimiento: it.fch_vto_pago,
      estado: it.estado_cobro,
      saldo: Number(it.saldo),
      total: Number(it.total),
      tipoComprobante: m?.tipo_comprobante ?? null,
    };
  });
}

export async function listPagosDetail(): Promise<PagoDetailRow[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const items = await listSupplierOpenItems(); // ya ordenado por fecha_vencimiento asc
  if (items.length === 0) return [];
  const ids = Array.from(new Set(items.map((i) => i.invoice_id)));
  const { data: invs } = await supabase
    .from("supplier_invoices")
    .select("id, vendor_id, fecha_emision, tipo_comprobante")
    .in("id", ids);
  const invMeta = new Map((invs ?? []).map((r: { id: string; vendor_id: string | null; fecha_emision: string | null; tipo_comprobante: string | null }) => [r.id, r]));
  const vendorIds = Array.from(new Set((invs ?? []).map((r: { vendor_id: string | null }) => r.vendor_id).filter(Boolean))) as string[];
  let vMeta = new Map<string, string | null>();
  if (vendorIds.length > 0) {
    const { data: vends } = await supabase.from("vendors").select("id, razon").in("id", vendorIds);
    vMeta = new Map((vends ?? []).map((r: { id: string; razon: string | null }) => [r.id, r.razon]));
  }
  return items.map((it) => {
    const m = invMeta.get(it.invoice_id);
    const vid = m?.vendor_id ?? null;
    return {
      invoiceId: it.invoice_id,
      vendorId: vid,
      proveedor: vid ? (vMeta.get(vid) ?? null) : null,
      factura: it.public_id,
      emision: m?.fecha_emision ?? null,
      vencimiento: it.fecha_vencimiento,
      estado: it.estado_pago,
      saldo: Number(it.saldo),
      total: Number(it.total),
      tipoComprobante: m?.tipo_comprobante ?? null,
    };
  });
}
