import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Kpi, StatusPill } from "@/components/tesoreria/ui";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getBankBalances, listBankAccounts, listMovements } from "@/lib/tesoreria/data";
import type { BankBalance, TreasuryMovement } from "@/lib/tesoreria/types";
import { fmtCurrency, fmtDate } from "@/lib/utils";

export const metadata = { title: "Ficha de banco · Tesorería" };
export const dynamic = "force-dynamic";

/** Slugs navegables (deep links de la página Bancos). Color corporativo por entidad. */
const BANKS: Record<
  string,
  { label: string; tone: string; match: (b: { bank_name: string; is_system: boolean }) => boolean;
    text: string; border: string; ring: string; bgSoft: string }
> = {
  galicia: {
    label: "Banco Galicia", tone: "Azul corporativo",
    match: (b) => b.bank_name.toLowerCase().includes("galicia"),
    text: "text-tops-blue-700", border: "border-tops-blue-700", ring: "ring-tops-blue-700", bgSoft: "bg-tops-blue-700/10",
  },
  santander: {
    label: "Banco Santander", tone: "Rojo corporativo",
    match: (b) => b.bank_name.toLowerCase().includes("santander"),
    text: "text-tops-red", border: "border-tops-red", ring: "ring-tops-red", bgSoft: "bg-tops-red/10",
  },
  caja: {
    label: "Caja Efectivo", tone: "Verde",
    match: (b) => b.is_system || b.bank_name.toLowerCase().includes("caja"),
    text: "text-status-success", border: "border-status-success", ring: "ring-status-success", bgSoft: "bg-status-success/10",
  },
};

const MES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default async function BancoFichaPage({ params }: { params: { slug: string } }) {
  const cfg = BANKS[params.slug];
  if (!cfg) notFound();

  try {
    const [balances, accounts, allMovements] = await Promise.all([
      getBankBalances(),
      listBankAccounts(),
      listMovements({ limit: 2000 }), // todos: para saldo corriente + pareo de transferencias
    ]);

    const cuentas = accounts.filter((a) => cfg.match(a));
    const cuentaIds = new Set(cuentas.map((a) => a.id));
    const saldos: BankBalance[] = balances.filter((b) => cfg.match(b));
    const saldoActual = saldos.reduce((s, b) => s + Number(b.balance), 0); // roll-up de saldos de la vista (D1)
    const openingTotal = cuentas.reduce((s, a) => s + Number(a.opening_balance), 0);

    // Movimientos de las cuentas de este banco
    const movs = allMovements.filter((m) => cuentaIds.has(m.bank_account_id));

    // Saldo corriente (display): opening + Σ confirmados en orden ascendente.
    // Reconcilia con treasury_bank_balances (balance = opening + confirmados). No recalcula la vista.
    const asc = [...movs].sort((a, b) =>
      a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    );
    const saldoPorMov = new Map<string, number>();
    let acc = openingTotal;
    for (const m of asc) {
      if (m.status === "confirmado") acc += m.direction === "ingreso" ? Number(m.amount) : -Number(m.amount);
      saldoPorMov.set(m.id, acc);
    }
    const ccDesc = [...asc].reverse();

    // Ingresos / egresos del mes corriente (roll-up sobre confirmados del período)
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const periodoLabel = `${MES_LARGO[now.getMonth()]} ${now.getFullYear()}`;
    let ingresosMes = 0, egresosMes = 0;
    for (const m of movs) {
      if (m.status !== "confirmado" || !m.date.startsWith(ym)) continue;
      if (m.direction === "ingreso") ingresosMes += Number(m.amount);
      else egresosMes += Number(m.amount);
    }

    // Transferencias: pareo por transfer_group_id (origen = egreso, destino = ingreso)
    const accName = new Map(accounts.map((a) => [a.id, a.is_system ? "Caja Efectivo" : a.bank_name]));
    const grupos = new Map<string, TreasuryMovement[]>();
    for (const m of allMovements) {
      if (m.type !== "transferencia" || !m.transfer_group_id) continue;
      const g = grupos.get(m.transfer_group_id) ?? [];
      g.push(m); grupos.set(m.transfer_group_id, g);
    }
    const transferencias = Array.from(grupos.values())
      .filter((g) => g.some((m) => cuentaIds.has(m.bank_account_id)))
      .map((g) => {
        const origen = g.find((m) => m.direction === "egreso");
        const destino = g.find((m) => m.direction === "ingreso");
        const ref = g[0];
        return {
          id: ref.transfer_group_id as string,
          date: ref.date,
          origen: origen ? accName.get(origen.bank_account_id) ?? "—" : "—",
          destino: destino ? accName.get(destino.bank_account_id) ?? "—" : "—",
          importe: Number((origen ?? destino ?? ref).amount),
          status: ref.status,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    // Conciliación
    const conciliados = movs.filter((m) => m.status === "confirmado").length;
    const pendientes = movs.filter((m) => m.status === "pendiente");

    return (
      <div className="p-4 md:p-7 lg:p-8 space-y-6 nx-page-fade max-w-[1200px] mx-auto">
        <div>
          <Link href="/tesoreria/bancos" className="text-[11px] text-fg-link hover:underline">← Bancos</Link>
          <h1 className={`page-title mt-1 ${cfg.text}`}>{cfg.label}</h1>
          <p className="page-subtitle">
            Entidad financiera · {cfg.tone}
            {cuentas.length === 0 && " · sin cuentas registradas"}
          </p>
        </div>

        {/* Resumen */}
        <section className="card p-5">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><Icon name="wallet" size={15} /> Resumen</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={`card p-5 border-l-4 ${cfg.border}`}>
              <div className="text-eyebrow-sm uppercase text-fg-muted">Saldo actual</div>
              <div className={`text-3xl font-bold tabular -tracking-[0.01em] ${cfg.text}`}>{fmtCurrency(saldoActual)}</div>
            </div>
            <Kpi label={`Ingresos · ${periodoLabel}`} value={ingresosMes} />
            <Kpi label={`Egresos · ${periodoLabel}`} value={egresosMes} />
          </div>
        </section>

        {/* Cuenta corriente */}
        <section className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="bill" size={15} /> Cuenta corriente</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted text-[11px] uppercase">
                  <th className="py-1">Fecha</th><th className="py-1">Concepto</th>
                  <th className="py-1 text-right">Débito</th><th className="py-1 text-right">Crédito</th>
                  <th className="py-1 text-right">Saldo</th><th className="py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {ccDesc.length === 0 && <tr><td colSpan={6} className="py-4 text-fg-muted">Sin movimientos.</td></tr>}
                {ccDesc.map((m) => (
                  <tr key={m.id} className="border-t border-stroke-soft/60">
                    <td className="py-2 whitespace-nowrap">{fmtDate(m.date)}</td>
                    <td className="py-2">{m.description ?? m.type}</td>
                    <td className="py-2 text-right tabular text-tops-red">{m.direction === "egreso" ? fmtCurrency(m.amount) : ""}</td>
                    <td className="py-2 text-right tabular text-status-success">{m.direction === "ingreso" ? fmtCurrency(m.amount) : ""}</td>
                    <td className="py-2 text-right tabular font-semibold">{m.status === "confirmado" ? fmtCurrency(saldoPorMov.get(m.id) ?? 0) : <span className="text-fg-muted">—</span>}</td>
                    <td className="py-2"><StatusPill status={m.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-fg-muted mt-2">Saldo corriente = saldo inicial + Σ movimientos confirmados (reconcilia con la vista de saldos; pendientes/anulados no impactan).</p>
        </section>

        {/* Transferencias */}
        <section className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="arrow-up-right" size={15} /> Transferencias</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted text-[11px] uppercase">
                  <th className="py-1">Fecha</th><th className="py-1">Origen</th><th className="py-1">Destino</th>
                  <th className="py-1 text-right">Importe</th><th className="py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {transferencias.length === 0 && <tr><td colSpan={5} className="py-4 text-fg-muted">Sin transferencias.</td></tr>}
                {transferencias.map((t) => (
                  <tr key={t.id} className="border-t border-stroke-soft/60">
                    <td className="py-2 whitespace-nowrap">{fmtDate(t.date)}</td>
                    <td className="py-2">{t.origen}</td>
                    <td className="py-2">{t.destino}</td>
                    <td className="py-2 text-right tabular">{fmtCurrency(t.importe)}</td>
                    <td className="py-2"><StatusPill status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Conciliación */}
        <section className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="check-circle" size={15} /> Conciliación</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="card p-4">
              <div className="text-eyebrow-sm uppercase text-fg-muted">Conciliados</div>
              <div className="text-2xl font-bold text-status-success tabular">{conciliados}</div>
            </div>
            <div className="card p-4">
              <div className="text-eyebrow-sm uppercase text-fg-muted">Pendientes</div>
              <div className="text-2xl font-bold text-status-warning tabular">{pendientes.length}</div>
            </div>
          </div>
          {pendientes.length > 0 && (
            <ul className="divide-y divide-stroke-soft/60 text-sm">
              {pendientes.slice(0, 20).map((m) => (
                <li key={m.id} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-fg-secondary truncate">{fmtDate(m.date)} · {m.description ?? m.type}</span>
                  <span className="tabular font-semibold whitespace-nowrap">{m.direction === "egreso" ? "−" : "+"}{fmtCurrency(m.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  } catch (e) {
    return <ModuleUnavailable title="Ficha de banco no disponible" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />;
  }
}
