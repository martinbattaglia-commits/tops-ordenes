/**
 * Data accessors para el dominio Finanzas.
 *
 * Principio: Lee hechos consolidados de Tesorería y supuestos de Finanzas.
 * Jamás muta ni reescribe movimientos de Tesorería.
 */

import { createClient } from "@/lib/supabase/server";
import type {
  FinanceVersion,
  FinanceAssumption,
  FinanceCategory,
  FinanceCostCenter,
  FinanceUnifiedTransaction,
  AccountGroupPosition,
  FinanceDocumentInboxItem,
  FinanceCurrency,
} from "./types";
import { listBankAccounts, getBankBalances, listCustomerOpenItems, listSupplierOpenItems, listMovements } from "@/lib/tesoreria/data";

/**
 * Obtiene la versión activa de presupuesto.
 */
export async function getActiveFinanceVersion(): Promise<FinanceVersion | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("finance_versions")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Fallback gracioso si aún no se aplicó migración
    return {
      id: "v-default-2026",
      code: "BUDGET-2026-V1",
      name: "Presupuesto Operativo 2026 v1.0",
      description: "Presupuesto anual base 2026",
      status: "approved",
      valid_from: "2026-01-01",
      valid_to: "2026-12-31",
      parent_version_id: null,
      is_active: true,
      approved_at: "2026-01-01T00:00:00Z",
      approved_by: null,
      created_by: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }
  return data as FinanceVersion | null;
}

/**
 * Lista todas las versiones de presupuesto disponibles.
 */
export async function listFinanceVersions(): Promise<FinanceVersion[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("finance_versions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    const active = await getActiveFinanceVersion();
    return active ? [active] : [];
  }
  return (data ?? []) as FinanceVersion[];
}

/**
 * Obtiene las categorías financieras activas.
 */
export async function listFinanceCategories(): Promise<FinanceCategory[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("finance_categories")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) {
    return [
      { id: "1", parent_id: null, code: "ING_FLETES", name: "Ingresos por Fletes y Distribución", category_type: "ingreso", display_order: 10, is_active: true, created_at: "2026-01-01" },
      { id: "2", parent_id: null, code: "ING_ALMACEN", name: "Ingresos por Almacenamiento y M2", category_type: "ingreso", display_order: 20, is_active: true, created_at: "2026-01-01" },
      { id: "3", parent_id: null, code: "ING_LOG_FARMACIA", name: "Ingresos Logística Farmacéutica ANMAT", category_type: "ingreso", display_order: 30, is_active: true, created_at: "2026-01-01" },
      { id: "4", parent_id: null, code: "EGR_SUELDOS", name: "Sueldos y Cargas Sociales", category_type: "egreso", display_order: 100, is_active: true, created_at: "2026-01-01" },
      { id: "5", parent_id: null, code: "EGR_COMBUSTIBLE", name: "Combustible y Peajes", category_type: "egreso", display_order: 110, is_active: true, created_at: "2026-01-01" },
      { id: "6", parent_id: null, code: "EGR_MANTENIMIENTO", name: "Mantenimiento de Flota y Edilicio", category_type: "egreso", display_order: 120, is_active: true, created_at: "2026-01-01" },
      { id: "7", parent_id: null, code: "EGR_SEGUROS", name: "Seguros y Pólizas de Carga", category_type: "egreso", display_order: 130, is_active: true, created_at: "2026-01-01" },
      { id: "8", parent_id: null, code: "EGR_ALQUILERES", name: "Alquileres de Depósitos", category_type: "egreso", display_order: 140, is_active: true, created_at: "2026-01-01" },
    ];
  }
  return (data ?? []) as FinanceCategory[];
}

/**
 * Obtiene los centros de costo.
 */
export async function listFinanceCostCenters(): Promise<FinanceCostCenter[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("finance_cost_centers")
    .select("*")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error) {
    return [
      { id: "1", code: "CC_CARGAS_GEN", name: "Operaciones Cargas Generales", business_line: "cargas_generales", is_active: true, created_at: "2026-01-01" },
      { id: "2", code: "CC_ANMAT", name: "Operaciones Reguladas ANMAT", business_line: "anmat", is_active: true, created_at: "2026-01-01" },
      { id: "3", code: "CC_DEPOSITO", name: "Depósito y Almacenamiento", business_line: "almacenamiento", is_active: true, created_at: "2026-01-01" },
      { id: "4", code: "CC_DISTRIB", name: "Distribución Urbana y Flota", business_line: "distribucion", is_active: true, created_at: "2026-01-01" },
      { id: "5", code: "CC_ADMIN_CORP", name: "Administración y Corporativo", business_line: "corporativo", is_active: true, created_at: "2026-01-01" },
    ];
  }
  return (data ?? []) as FinanceCostCenter[];
}

/**
 * Agrupa las cuentas en los 4 agrupadores obligatorios (Bancos, Caja, Ahorros, Tarjetas).
 */
export async function getConsolidatedAccountPositions(): Promise<AccountGroupPosition[]> {
  const [bankAccounts, bankBalances] = await Promise.all([
    listBankAccounts().catch(() => []),
    getBankBalances().catch(() => []),
  ]);

  const balanceMap = new Map(bankBalances.map(b => [b.bank_account_id, Number(b.balance || 0)]));

  const groups: Record<'bancos' | 'caja' | 'ahorros' | 'tarjetas', AccountGroupPosition> = {
    bancos: { group: 'bancos', label: 'Bancos', arsBalance: 0, usdBalance: 0, accounts: [] },
    caja: { group: 'caja', label: 'Caja', arsBalance: 0, usdBalance: 0, accounts: [] },
    ahorros: { group: 'ahorros', label: 'Ahorros / Inversiones', arsBalance: 0, usdBalance: 0, accounts: [] },
    tarjetas: { group: 'tarjetas', label: 'Tarjetas Corporativas', arsBalance: 0, usdBalance: 0, accounts: [] },
  };

  for (const acc of bankAccounts) {
    const balance = balanceMap.get(acc.id) ?? Number(acc.opening_balance || 0);
    const curr = (acc.currency === 'USD' ? 'USD' : 'ARS') as FinanceCurrency;

    let targetGroup: 'bancos' | 'caja' | 'ahorros' | 'tarjetas' = 'bancos';
    if (acc.account_type === 'caja') {
      targetGroup = 'caja';
    } else if (acc.account_type === 'ahorros' || acc.account_name.toLowerCase().includes('inversion')) {
      targetGroup = 'ahorros';
    } else if (acc.account_type === 'tarjeta' || acc.account_name.toLowerCase().includes('tarjeta')) {
      targetGroup = 'tarjetas';
    }

    if (curr === 'ARS') {
      groups[targetGroup].arsBalance += balance;
    } else {
      groups[targetGroup].usdBalance += balance;
    }

    groups[targetGroup].accounts.push({
      id: acc.id,
      name: acc.account_name,
      bankName: acc.bank_name,
      currency: curr,
      balance,
      type: acc.account_type,
    });
  }

  // Si no hay cuentas registradas en base, asegurar que se muestren los 4 grupos
  if (bankAccounts.length === 0) {
    groups.bancos.accounts.push(
      { id: "demo-galicia", name: "Banco Galicia CC", bankName: "Galicia", currency: "ARS", balance: 14250000, type: "cuenta_corriente" },
      { id: "demo-santander", name: "Banco Santander CC", bankName: "Santander", currency: "ARS", balance: 8750000, type: "cuenta_corriente" }
    );
    groups.bancos.arsBalance = 23000000;

    groups.caja.accounts.push(
      { id: "demo-caja", name: "Caja Chica Central", bankName: "Caja Central", currency: "ARS", balance: 450000, type: "caja" }
    );
    groups.caja.arsBalance = 450000;

    groups.ahorros.accounts.push(
      { id: "demo-fci", name: "FCI Liquidez Inmediata", bankName: "Galicia Asset", currency: "ARS", balance: 5200000, type: "ahorros" }
    );
    groups.ahorros.arsBalance = 5200000;

    groups.tarjetas.accounts.push(
      { id: "demo-visa", name: "Visa Corporativa Operaciones", bankName: "Santander", currency: "ARS", balance: -820000, type: "tarjeta" }
    );
    groups.tarjetas.arsBalance = -820000;
  }

  return Object.values(groups);
}

/**
 * Obtiene la lista unificada de transacciones (hechos reales de Tesorería + proyecciones de Finanzas).
 */
export async function getUnifiedFinanceTransactions(opts?: {
  currency?: FinanceCurrency;
  limit?: number;
}): Promise<FinanceUnifiedTransaction[]> {
  const [bankAccounts, realMovements, customerItems, supplierItems] = await Promise.all([
    listBankAccounts().catch(() => []),
    listMovements({ limit: opts?.limit ?? 100 }).catch(() => []),
    listCustomerOpenItems().catch(() => []),
    listSupplierOpenItems().catch(() => []),
  ]);

  const accountMap = new Map(bankAccounts.map(a => [a.id, a]));
  const transactions: FinanceUnifiedTransaction[] = [];

  // 1. Hechos reales de Tesorería
  for (const m of realMovements) {
    const acc = accountMap.get(m.bank_account_id);
    const curr: FinanceCurrency = acc?.currency === "USD" ? "USD" : "ARS";
    let dir: 'ingreso' | 'egreso' | 'transferencia' = 'egreso';
    if (m.type === 'cobranza') dir = 'ingreso';
    else if (m.type === 'transferencia') dir = 'transferencia';

    transactions.push({
      id: m.id,
      date: m.date,
      direction: dir,
      concept: m.description || m.type,
      counterpart: null,
      amount: Number(m.amount),
      currency: curr,
      accountGroup: 'bancos',
      accountName: acc?.account_name || 'Cuenta Bancaria',
      categoryName: m.operational_category || 'Operativo General',
      isReal: true,
      status: 'ejecutado',
    });
  }

  // 2. Cuentas por Cobrar Proyectadas (Facturas de Clientes abiertas)
  for (const c of customerItems) {
    if (c.fch_vto_pago && Number(c.saldo) > 0) {
      transactions.push({
        id: `c-proj-${c.invoice_id}`,
        date: c.fch_vto_pago,
        direction: 'ingreso',
        concept: `Cobranza Factura ${c.numero_comprobante || c.invoice_id.slice(0, 8)}`,
        counterpart: 'Cliente',
        amount: Number(c.saldo),
        currency: 'ARS',
        accountGroup: 'bancos',
        accountName: 'Banco Galicia / Santander',
        categoryName: 'Ingresos por Fletes y Servicios',
        isReal: false,
        status: 'proyectado',
        certainty: 'alta',
      });
    }
  }

  // 3. Cuentas por Pagar Proyectadas (Facturas de Proveedores abiertas)
  for (const s of supplierItems) {
    if (s.fecha_vencimiento && Number(s.saldo) > 0) {
      transactions.push({
        id: `s-proj-${s.invoice_id}`,
        date: s.fecha_vencimiento,
        direction: 'egreso',
        concept: `Pago Factura Proveedor ${s.public_id || s.invoice_id.slice(0, 8)}`,
        counterpart: 'Proveedor',
        amount: Number(s.saldo),
        currency: 'ARS',
        accountGroup: 'bancos',
        accountName: 'Banco Galicia / Santander',
        categoryName: 'Costo Directo / Proveedores',
        isReal: false,
        status: 'proyectado',
        certainty: 'alta',
      });
    }
  }

  // Si no hay transacciones en la base de prueba, proveer transacciones representativas
  if (transactions.length === 0) {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const d1 = new Date(today); d1.setDate(d1.getDate() - 3);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 1);
    const d3 = new Date(today); d3.setDate(d3.getDate() + 2);
    const d4 = new Date(today); d4.setDate(d4.getDate() + 5);
    const d5 = new Date(today); d5.setDate(d5.getDate() + 10);

    transactions.push(
      { id: "tx-1", date: fmt(d1), direction: "ingreso", concept: "Cobranza Cliente Laboratorios Roemmers", counterpart: "Roemmers S.A.", amount: 5820000, currency: "ARS", accountGroup: "bancos", accountName: "Banco Galicia CC", categoryName: "Ingresos Logística Farmacéutica ANMAT", isReal: true, status: "ejecutado" },
      { id: "tx-2", date: fmt(d2), direction: "egreso", concept: "Pago Combustible Flota YPF en Ruta", counterpart: "YPF S.A.", amount: 1450000, currency: "ARS", accountGroup: "bancos", accountName: "Banco Santander CC", categoryName: "Combustible y Peajes", isReal: true, status: "ejecutado" },
      { id: "tx-3", date: fmt(d3), direction: "ingreso", concept: "Cobranza Factura A-0001-00048212 Meli", counterpart: "MercadoLibre S.R.L.", amount: 13297400, currency: "ARS", accountGroup: "bancos", accountName: "Banco Galicia CC", categoryName: "Ingresos por Fletes y Distribución", isReal: false, status: "proyectado", certainty: "alta" },
      { id: "tx-4", date: fmt(d4), direction: "egreso", concept: "Liquidación Quincenal Sueldos Choferes", counterpart: "Nómina Operativa", amount: 4850000, currency: "ARS", accountGroup: "bancos", accountName: "Banco Galicia CC", categoryName: "Sueldos y Cargas Sociales", isReal: false, status: "comprometido", certainty: "alta" },
      { id: "tx-5", date: fmt(d5), direction: "transferencia", concept: "Cobertura de Caja Chica Barracas", counterpart: "Transferencia Interna", amount: 350000, currency: "ARS", accountGroup: "caja", accountName: "Caja Central", categoryName: "Transferencia Interna", isReal: false, status: "proyectado", certainty: "media" }
    );
  }

  // Filtrar por moneda si se solicita
  const filtered = opts?.currency ? transactions.filter(t => t.currency === opts.currency) : transactions;
  return filtered.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Obtiene la bandeja de ingesta documental.
 */
export async function listDocumentInbox(): Promise<FinanceDocumentInboxItem[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("finance_document_inbox")
    .select("*")
    .order("received_at", { ascending: false });

  if (error) {
    return [
      {
        id: "inbox-1",
        sender: "facturacion@ypf.com.ar",
        subject: "Factura A YPF Combustibles 0001-00392819",
        received_at: "2026-08-19T14:20:00Z",
        status: "borrador",
        extracted_data: {
          monto: 1845200,
          moneda: "ARS",
          cuit: "30-54668997-9",
          proveedor: "YPF S.A.",
          comprobante: "0001-00392819",
          fecha_emision: "2026-08-18",
          fecha_vencimiento: "2026-08-28",
          concepto: "Combustible Diesel Grado 3 para unidades Scania Luján",
          categoria_sugerida: "Combustible y Peajes",
        },
        raw_email_url: null,
        attachment_url: "/docs/factura-ypf-sample.pdf",
        reviewed_by: null,
        reviewed_at: null,
        notes: "Ingestado automáticamente vía email inbox",
        created_at: "2026-08-19T14:20:00Z",
        updated_at: "2026-08-19T14:20:00Z",
      },
      {
        id: "inbox-2",
        sender: "cobranzas@neumaticos.com.ar",
        subject: "Comprobante Servicio Alineación & Cubiertas",
        received_at: "2026-08-18T10:15:00Z",
        status: "en_revision",
        extracted_data: {
          monto: 720000,
          moneda: "ARS",
          cuit: "30-71234567-8",
          proveedor: "Neumáticos del Sur S.A.",
          comprobante: "0004-00018241",
          fecha_emision: "2026-08-17",
          fecha_vencimiento: "2026-08-27",
          concepto: "Recambio de 4 cubiertas tractor Iveco",
          categoria_sugerida: "Mantenimiento de Flota y Edilicio",
        },
        raw_email_url: null,
        attachment_url: "/docs/neumaticos-sample.pdf",
        reviewed_by: null,
        reviewed_at: null,
        notes: "Pendiente de validación por jefe de taller",
        created_at: "2026-08-18T10:15:00Z",
        updated_at: "2026-08-18T10:15:00Z",
      }
    ];
  }
  return (data ?? []) as FinanceDocumentInboxItem[];
}
