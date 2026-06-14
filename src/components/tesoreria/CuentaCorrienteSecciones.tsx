/**
 * Cuenta Corriente Seccionada — Tesorería V3 · Fase 1 (presentacional, server-safe).
 *
 * Render compartido por Cobranzas y Pagos. Recibe la clasificación YA hecha por
 * el motor puro `clasificarCuentaCorriente` y muestra:
 *   1. KPI maestro · Saldo Neto
 *   2. Sección Pendientes (siempre)
 *   3. Sección Notas de Crédito (si hay)
 *   4. Sección Sobrepagos (si hay)
 *   5. Resumen de reconciliación: Pendiente Bruto − NC − Sobrepagos = Saldo Neto
 *
 * No calcula saldos: sólo formatea lo que el motor ya reconcilió en centavos.
 */
import { Fragment } from "react";
import Link from "next/link";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { StatusPill } from "@/components/tesoreria/ui";
import { toPesos, type CuentaCorriente, type CuentaSeccion } from "@/lib/tesoreria/cuentaCorriente";

type CuentaKind = "cobranza" | "pago";

const CFG: Record<
  CuentaKind,
  {
    entidad: string;
    netoLabel: string;
    netoColor: string;
    accentBorder: string;
    hrefBase: string;
    sinParty: string;
    empty: string;
    detalleTitulo: string;
  }
> = {
  cobranza: {
    entidad: "cliente",
    netoLabel: "Saldo neto a cobrar",
    netoColor: "text-status-success",
    accentBorder: "border-status-success",
    hrefBase: "/clientes",
    sinParty: "Sin cliente",
    empty: "No hay cuenta corriente de clientes.",
    detalleTitulo: "Cuenta corriente de clientes",
  },
  pago: {
    entidad: "proveedor",
    netoLabel: "Saldo neto a pagar",
    netoColor: "text-fg-brand",
    accentBorder: "border-tops-blue-700",
    hrefBase: "/compras/proveedores",
    sinParty: "Sin proveedor",
    empty: "No hay cuenta corriente de proveedores.",
    detalleTitulo: "Cuenta corriente de proveedores",
  },
};

export function CuentaCorrienteSecciones({ cc, kind }: { cc: CuentaCorriente; kind: CuentaKind }) {
  const cfg = CFG[kind];
  const { pendientes, notasCredito, sobrepagos, resumen } = cc;
  const sinMovimientos =
    pendientes.count === 0 && notasCredito.count === 0 && sobrepagos.count === 0;

  return (
    <div className="space-y-6">
      {/* KPI maestro — Saldo Neto */}
      <div className={`card p-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-l-4 ${cfg.accentBorder}`}>
        <div className="sm:order-1 self-start sm:self-end">
          <p className="text-sm text-fg-secondary max-w-xs">
            Cuenta corriente neta (Pendientes − Notas de crédito − Sobrepagos). El detalle por
            comprobante figura debajo.
          </p>
        </div>
        <div className="sm:text-right sm:order-2 sm:ml-auto">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{cfg.netoLabel}</div>
          <div className={`text-4xl md:text-5xl font-black tabular leading-none mt-1 ${cfg.netoColor}`}>
            {fmtCurrency(toPesos(resumen.saldoNetoCents))}
          </div>
          <div className="text-xs text-fg-secondary mt-2">
            {pendientes.grupos.length} {pendientes.grupos.length === 1 ? `${cfg.entidad} con saldo` : `${cfg.entidad}s con saldo`} ·{" "}
            {pendientes.count} {pendientes.count === 1 ? "factura pendiente" : "facturas pendientes"}
          </div>
        </div>
      </div>

      {sinMovimientos ? (
        <div className="card p-8 text-center text-fg-muted">{cfg.empty}</div>
      ) : (
        <>
          {/* SECCIÓN 1 — Pendientes */}
          <SeccionTabla
            titulo="Pendientes"
            seccion={pendientes}
            cfg={cfg}
            totalLabel="Pendiente bruto"
            tone="pendiente"
          />

          {/* SECCIÓN 2 — Notas de Crédito */}
          {notasCredito.count > 0 && (
            <SeccionTabla
              titulo="Notas de crédito"
              subtitulo="Reducen el saldo de la cuenta corriente."
              seccion={notasCredito}
              cfg={cfg}
              totalLabel="Total notas de crédito"
              tone="nc"
            />
          )}

          {/* SECCIÓN 3 — Sobrepagos */}
          {sobrepagos.count > 0 && (
            <SeccionTabla
              titulo="Sobrepagos"
              subtitulo="Saldo a favor por imputación en exceso."
              seccion={sobrepagos}
              cfg={cfg}
              totalLabel="Total sobrepagos"
              tone="sobrepago"
            />
          )}

          {/* SECCIÓN 4 — Resumen de reconciliación */}
          <ResumenReconciliacion cc={cc} cfg={cfg} />
        </>
      )}
    </div>
  );
}

type Cfg = (typeof CFG)[CuentaKind];

function GrupoHeader({ partyId, partyName, cfg }: { partyId: string | null; partyName: string | null; cfg: Cfg }) {
  const cls = "text-[13px] font-bold uppercase tracking-[0.08em]";
  if (partyId) {
    return (
      <Link href={`${cfg.hrefBase}/${partyId}`} className={`${cls} text-fg-link hover:underline`}>
        {partyName ?? "—"}
      </Link>
    );
  }
  return <span className={`${cls} text-fg-secondary`}>{partyName ?? cfg.sinParty}</span>;
}

function ToneBadge({ tone, estado, vencimiento }: { tone: "pendiente" | "nc" | "sobrepago"; estado: string; vencimiento: string | null }) {
  if (tone === "pendiente") return <StatusPill status={estado} dueDate={vencimiento} variant="cuenta" />;
  const cls =
    tone === "nc"
      ? "bg-tops-blue-700 text-white"
      : "bg-status-warning text-white";
  const label = tone === "nc" ? "Nota de crédito" : "Sobrepago";
  return (
    <span className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
      {label}
    </span>
  );
}

function SeccionTabla({
  titulo,
  subtitulo,
  seccion,
  cfg,
  totalLabel,
  tone,
}: {
  titulo: string;
  subtitulo?: string;
  seccion: CuentaSeccion;
  cfg: Cfg;
  totalLabel: string;
  tone: "pendiente" | "nc" | "sobrepago";
}) {
  return (
    <div className="card p-5 overflow-x-auto">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">{titulo}</h2>
          {subtitulo && <p className="text-xs text-fg-muted mt-0.5">{subtitulo}</p>}
        </div>
        <span className="text-sm text-fg-muted">
          {totalLabel}:{" "}
          <strong className="text-fg-brand tabular">{fmtCurrency(toPesos(seccion.totalCents))}</strong>
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-fg-muted">
            <th className="py-1">Comprobante</th>
            <th className="py-1">Emisión</th>
            <th className="py-1">Vencimiento</th>
            <th className="py-1">Estado</th>
            <th className="py-1 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {seccion.grupos.map((grupo) => {
            const key = grupo.partyId ?? `sin-${grupo.partyName ?? "x"}-${tone}`;
            return (
              <Fragment key={key}>
                <tr className="border-t-2 border-stroke-strong">
                  <td colSpan={5} className="pt-4 pb-1.5 px-1">
                    <GrupoHeader partyId={grupo.partyId} partyName={grupo.partyName} cfg={cfg} />
                  </td>
                </tr>
                {grupo.items.map((it) => (
                  <tr key={it.invoiceId} className="border-t border-stroke-soft">
                    <td className="py-2 pl-4 tabular text-fg-secondary">#{it.factura}</td>
                    <td className="py-2 text-fg-secondary">{fmtDate(it.emision)}</td>
                    <td className="py-2 text-fg-secondary">{fmtDate(it.vencimiento)}</td>
                    <td className="py-2">
                      <ToneBadge tone={tone} estado={it.estado} vencimiento={it.vencimiento} />
                    </td>
                    <td className="py-2 text-right tabular text-fg-primary">{fmtCurrency(it.saldo)}</td>
                  </tr>
                ))}
                <tr className="border-t border-stroke-soft bg-tops-blue-900/[0.06]">
                  <td colSpan={4} className="py-2.5 pl-4 text-[13px] font-bold uppercase tracking-wide text-fg-secondary">
                    Subtotal · {grupo.partyName ?? cfg.sinParty}
                  </td>
                  <td className="py-2.5 pr-1 text-right tabular text-base md:text-lg font-extrabold text-fg-brand">
                    {fmtCurrency(toPesos(grupo.subtotalCents))}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-tops-blue-700 bg-tops-blue-900/[0.10]">
            <td className="py-3 pl-1 text-sm md:text-base font-black uppercase tracking-wide text-fg-primary" colSpan={4}>
              {totalLabel}
            </td>
            <td className="py-3 pr-1 text-right tabular text-xl md:text-2xl font-black text-fg-brand">
              {fmtCurrency(toPesos(seccion.totalCents))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ResumenReconciliacion({ cc, cfg }: { cc: CuentaCorriente; cfg: Cfg }) {
  const r = cc.resumen;
  const Row = ({ label, cents, sign, strong }: { label: string; cents: number; sign?: string; strong?: boolean }) => (
    <div className={`flex items-center justify-between py-2 ${strong ? "" : "text-fg-secondary"}`}>
      <span className={strong ? "text-sm md:text-base font-black uppercase tracking-wide text-fg-primary" : "text-sm"}>
        {sign && <span className="text-fg-muted mr-1">{sign}</span>}
        {label}
      </span>
      <span className={`tabular ${strong ? `text-xl md:text-2xl font-black ${cfg.netoColor}` : "font-semibold text-fg-primary"}`}>
        {fmtCurrency(toPesos(cents))}
      </span>
    </div>
  );
  return (
    <div className="nx-surface card relative overflow-hidden">
      <div className="p-5 md:p-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted mb-2">Resumen de reconciliación</div>
        <Row label="Pendiente bruto" cents={r.pendienteBrutoCents} />
        <Row label="Notas de crédito" cents={r.totalNcCents} sign="(−)" />
        <Row label="Sobrepagos" cents={r.totalSobrepagoCents} sign="(−)" />
        <div className="border-t-2 border-tops-blue-700 mt-1 pt-1">
          <Row label={cfg.netoLabel} cents={r.saldoNetoCents} strong />
        </div>
      </div>
    </div>
  );
}
