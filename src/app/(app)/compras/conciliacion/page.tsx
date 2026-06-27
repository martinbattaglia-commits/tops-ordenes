// src/app/(app)/compras/conciliacion/page.tsx
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CountUp } from "@/components/CountUp";
import { listRecons } from "@/lib/recon/data";
import { ReconStatusBadge } from "@/components/compras/ReconStatusBadge";
import { fmtDate } from "@/lib/utils";
import type { ReconStatus } from "@/lib/recon/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";

export const metadata = { title: "Conciliación de Órdenes de Compra" };
export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<{ status?: string }> };

const TABS: Array<{ key: ReconStatus | "todas"; label: string }> = [
  { key: "todas",          label: "Todas" },
  { key: "pendiente",      label: "Pendientes" },
  { key: "en_revision",    label: "En revisión" },
  { key: "con_diferencias",label: "Con diferencias" },
  { key: "conciliada",     label: "Conciliadas" },
  { key: "rechazada",      label: "Rechazadas" },
];

export default async function ConciliacionPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const status = (sp?.status as ReconStatus | "todas") ?? "todas";

  let result: Awaited<ReturnType<typeof listRecons>>;
  try {
    result = await listRecons({ status, pageSize: 100 });
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Conciliación no disponible"
        migration="0097_recon_schema"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const { rows, counts, total } = result;

  const kpis: Array<{
    label: string;
    value: number;
    sub: string;
    icon: import("@/components/Icon").IconName;
    cls?: string;
  }> = [
    {
      label: "Total",
      value: total,
      sub: "conciliaciones",
      icon: "report",
    },
    {
      label: "Pendientes",
      value: counts["pendiente"] ?? 0,
      sub: "sin iniciar",
      icon: "clock",
      cls: "text-[var(--status-warning)]",
    },
    {
      label: "En Revisión",
      value: counts["en_revision"] ?? 0,
      sub: "requieren acción",
      icon: "eye",
      cls: "text-[var(--status-warning)]",
    },
    {
      label: "Conciliadas",
      value: counts["conciliada"] ?? 0,
      sub: "listas para pago",
      icon: "check-circle",
      cls: "text-[var(--status-success)]",
    },
    {
      label: "Con Diferencias",
      value: counts["con_diferencias"] ?? 0,
      sub: "diferencias aceptadas",
      icon: "bolt",
      cls: "text-[var(--status-warning)]",
    },
    {
      label: "Rechazadas",
      value: counts["rechazada"] ?? 0,
      sub: "requieren nueva factura",
      icon: "x",
      cls: "text-[var(--status-danger)]",
    },
  ];

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Compras · ERP</div>
          <h1 className="page-title">Conciliación de OC</h1>
          <p className="page-subtitle">
            Control documental OC↔Factura. Una factura sólo puede pagarse cuando está conciliada y aprobada.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        {kpis.map((k, i) => (
          <div key={i} className="kpi nx-surface rounded-xl p-4">
            <div className="kpi-label flex items-center gap-1.5">
              <Icon name={k.icon} size={13} />
              {k.label}
            </div>
            <div className={`kpi-value ${k.cls ?? ""}`}>
              <CountUp to={k.value} format="int" />
            </div>
            <div className="kpi-delta">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs / status filter */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {TABS.map(tab => (
          <Link
            key={tab.key}
            href={
              tab.key === "todas"
                ? "/compras/conciliacion"
                : `/compras/conciliacion?status=${tab.key}`
            }
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              status === tab.key
                ? "bg-[var(--fg-brand)]/10 text-[var(--fg-brand)]"
                : "text-fg-muted hover:text-fg-primary hover:bg-[var(--bg-surface-alt)]"
            }`}
          >
            {tab.label}
            {tab.key !== "todas" && (counts[tab.key as ReconStatus] ?? 0) > 0 && (
              <span className="ml-1.5 badge badge-muted text-xs">
                {counts[tab.key as ReconStatus]}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Tabla */}
      {rows.length === 0 ? (
        <div className="nx-surface rounded-xl p-12 text-center text-fg-muted">
          <div className="text-4xl mb-3">🔗</div>
          <p className="font-medium">No hay conciliaciones en esta vista.</p>
          <p className="text-sm mt-1">
            Iniciá una desde el detalle de una OC o Factura de proveedor.
          </p>
        </div>
      ) : (
        <div className="nx-surface rounded-xl overflow-hidden">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>OC</th>
                <th>Factura</th>
                <th>Score</th>
                <th>Estado</th>
                <th>N° Diffs</th>
                <th>Pendientes</th>
                <th>Pago</th>
                <th>Iniciada</th>
                <th>Resuelta</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="font-mono text-sm">{r.po_public_id}</td>
                  <td className="font-mono text-sm">{r.invoice_public_id}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 rounded-full bg-[var(--stroke-soft)] w-12 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${r.score}%`,
                            background:
                              r.score === 100
                                ? "var(--status-success)"
                                : r.score >= 90
                                ? "var(--status-warning)"
                                : "var(--status-danger)",
                          }}
                        />
                      </div>
                      <span className="text-xs font-semibold tabular-nums">{r.score}%</span>
                    </div>
                  </td>
                  <td>
                    <ReconStatusBadge status={r.status} />
                  </td>
                  <td className="text-xs tabular-nums">{r.n_diffs}</td>
                  <td>
                    {r.n_pending_diffs > 0 ? (
                      <span className="text-xs font-medium text-[var(--status-danger)]">
                        {r.n_pending_diffs}
                      </span>
                    ) : (
                      <span className="text-xs text-fg-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`text-xs font-semibold ${
                        r.listo_para_pago
                          ? "text-[var(--status-success)]"
                          : "text-[var(--status-danger)]"
                      }`}
                    >
                      {r.listo_para_pago ? "Habilitado" : "Bloqueado"}
                    </span>
                  </td>
                  <td className="text-fg-muted text-xs">{fmtDate(r.initiated_at)}</td>
                  <td className="text-fg-muted text-xs">
                    {"resolved_at" in r && (r as { resolved_at?: string }).resolved_at
                      ? fmtDate((r as { resolved_at: string }).resolved_at)
                      : "—"}
                  </td>
                  <td>
                    <Link
                      href={`/compras/conciliacion/${r.po_public_id}`}
                      className="btn btn-ghost btn-sm text-xs"
                    >
                      Ver <Icon name="arrow-right" size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
