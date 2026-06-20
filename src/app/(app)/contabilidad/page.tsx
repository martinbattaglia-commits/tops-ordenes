import Link from "next/link";
import { Icon } from "@/components/Icon";
import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import {
  getPosicionIva,
  getBalanceSumasSaldos,
  getComprobantesSinAsiento,
} from "@/lib/contabilidad/data";

export const metadata = { title: "Contabilidad" };
export const dynamic = "force-dynamic";

const LINKS: { href: string; label: string; icon: "report" | "database" | "calculator" | "refresh"; desc: string }[] = [
  { href: "/contabilidad/posicion-iva", label: "Posición de IVA", icon: "report", desc: "Débito − crédito − percepciones − retenciones por mes" },
  { href: "/contabilidad/plan-cuentas", label: "Plan de cuentas", icon: "database", desc: "Estructura contable (activo/pasivo/PN/resultado)" },
  { href: "/contabilidad/libro-diario", label: "Libro diario", icon: "report", desc: "Asientos posteados, línea por línea" },
  { href: "/contabilidad/mayor", label: "Mayor por cuenta", icon: "report", desc: "Movimientos y saldo acumulado por cuenta" },
  { href: "/contabilidad/balance", label: "Sumas y saldos", icon: "calculator", desc: "Balance de comprobación + estado de resultados" },
  { href: "/contabilidad/comprobantes", label: "Pendientes de contabilizar", icon: "refresh", desc: "Comprobantes sin asiento + backfill" },
];

export default async function ContabilidadPage() {
  let posicion, balance, pendientes;
  try {
    [posicion, balance, pendientes] = await Promise.all([
      getPosicionIva(),
      getBalanceSumasSaldos(),
      getComprobantesSinAsiento(),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Contabilidad no disponible"
        migration="0083_accounting_core"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const ultimo = posicion[0];
  const sumaDebe = balance.reduce((a, r) => a + r.totalDebe, 0);
  const sumaHaber = balance.reduce((a, r) => a + r.totalHaber, 0);
  const cuadra = Math.round((sumaDebe - sumaHaber) * 100) === 0;

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Contabilidad</h1>
        <p className="text-sm text-fg-secondary">
          Capa contable: plan de cuentas, asientos por partida doble, libros y posición de IVA.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-fg-muted">Último período</div>
          <div className="text-lg font-bold text-fg-brand">{ultimo?.periodo ?? "—"}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-fg-muted">Posición IVA (último mes)</div>
          <div className="text-lg font-bold text-fg-brand">
            {ultimo ? fmtCurrency(Math.abs(ultimo.saldoPosicion)) : "—"}
          </div>
          <div className="text-xs text-fg-secondary">
            {ultimo ? (ultimo.resultado === "a_pagar" ? "A pagar" : ultimo.resultado === "a_favor" ? "Saldo a favor" : "Neutro") : ""}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-fg-muted">Balance de comprobación</div>
          <div className={`text-lg font-bold ${cuadra ? "text-status-success" : "text-status-error"}`}>
            {cuadra ? "Cuadra" : "Descuadrado"}
          </div>
          <div className="text-xs text-fg-secondary">{fmtCurrency(sumaDebe)} debe</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-fg-muted">Pendientes de contabilizar</div>
          <div className={`text-lg font-bold ${pendientes.length ? "text-status-warning" : "text-status-success"}`}>
            {pendientes.length}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="card p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3 mb-2">
              <span className="w-9 h-9 rounded-lg bg-bg-brand/10 text-fg-brand grid place-items-center">
                <Icon name={l.icon} size={18} />
              </span>
              <span className="font-semibold text-fg-brand">{l.label}</span>
            </div>
            <p className="text-sm text-fg-secondary">{l.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
