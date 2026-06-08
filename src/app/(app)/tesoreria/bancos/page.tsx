import Link from "next/link";
import { CountUp } from "@/components/CountUp";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { TransferenciaForm } from "@/components/tesoreria/TransferenciaForm";
import { getBankBalances, listBankAccounts } from "@/lib/tesoreria/data";
import type { BankBalance } from "@/lib/tesoreria/types";

export const metadata = { title: "Bancos · Tesorería" };
export const dynamic = "force-dynamic";

/** Agrupación de cuentas → entidad navegable (mismo criterio que la ficha [slug]). */
const ENTIDADES = [
  { slug: "galicia", label: "Banco Galicia", text: "text-tops-blue-700", border: "border-tops-blue-700", match: (b: BankBalance) => b.bank_name.toLowerCase().includes("galicia") },
  { slug: "santander", label: "Banco Santander", text: "text-tops-red", border: "border-tops-red", match: (b: BankBalance) => b.bank_name.toLowerCase().includes("santander") },
  { slug: "caja", label: "Caja Efectivo", text: "text-status-success", border: "border-status-success", match: (b: BankBalance) => b.is_system || b.bank_name.toLowerCase().includes("caja") },
] as const;

function BankKpi({ href, label, value, text, border }: { href: string; label: string; value: number; text: string; border: string }) {
  return (
    <Link href={href} title={`Abrir ficha · ${label}`}
      className="nx-interactive block rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700">
      <div className={`card p-5 border-l-4 ${border}`}>
        <div className="text-eyebrow-sm uppercase text-fg-muted">{label}</div>
        <div className={`text-3xl font-bold tabular -tracking-[0.01em] ${text}`}>
          <CountUp to={value} format="currency" />
        </div>
        <div className="text-[11px] text-fg-link mt-1">Ver cuenta corriente →</div>
      </div>
    </Link>
  );
}

export default async function BancosPage() {
  try {
    const [balances, accounts] = await Promise.all([getBankBalances(), listBankAccounts()]);
    const total = balances.reduce((s, b) => s + Number(b.balance), 0); // roll-up server-side (D1)
    const sum = (m: (b: BankBalance) => boolean) => balances.filter(m).reduce((s, b) => s + Number(b.balance), 0);

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Bancos</h1>
            <p className="page-subtitle">Cada entidad es navegable: cuenta corriente, transferencias y conciliación.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {ENTIDADES.map((e) => (
            <BankKpi key={e.slug} href={`/tesoreria/bancos/${e.slug}`} label={e.label} value={sum(e.match)} text={e.text} border={e.border} />
          ))}
          {/* Consolidado: roll-up sin detalle único → no navegable */}
          <div className="card p-5 border-l-4 border-tops-blue-900">
            <div className="text-eyebrow-sm uppercase text-fg-muted">Saldo consolidado</div>
            <div className="text-3xl font-bold tabular -tracking-[0.01em] text-fg-brand">
              <CountUp to={total} format="currency" />
            </div>
            <div className="text-[11px] text-fg-muted mt-1">Total de todas las cuentas</div>
          </div>
        </div>

        <TransferenciaForm accounts={accounts} />
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable title="Bancos no disponibles" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />
    );
  }
}
