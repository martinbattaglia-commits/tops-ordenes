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
      "id,public_id,date,type,direction,bank_account_id,amount,description,reference_type,reference_id,transfer_group_id,status,created_at"
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
