import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listReceptions } from "@/lib/wms/receptions";
import { RECEPTION_STATUS_META, type ReceptionRow } from "@/lib/wms/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate } from "@/lib/utils";
import { RowActions } from "./_components/RowActions";

export const metadata = { title: "Recepciones · WMS" };
export const dynamic = "force-dynamic";

function isParcial(r: ReceptionRow): boolean {
  return r.status === "en_recepcion" && r.received_count > 0 && r.received_count < r.item_count;
}

export default async function RecepcionesPage() {
  let rows: ReceptionRow[];
  try {
    rows = await listReceptions();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Recepciones no disponibles"
        migration="0025_wms_receptions · 0027_wms_functions"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Depósito</div>
          <h1 className="page-title">Recepciones</h1>
          <p className="page-subtitle">
            Ingreso de mercadería de terceros. Al confirmar, el stock se carga al
            inventario y la posición se ocupa automáticamente en el Digital Twin.
          </p>
        </div>
        <Link href="/wms/recepciones/nueva" className="btn btn-primary btn-sm mt-1">
          <Icon name="plus" size={14} stroke={2.2} /> Nueva recepción
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Pendientes" value={count("pendiente") + count("en_recepcion")} sub="por confirmar" index={0} />
        <Stat label="En cuarentena" value={count("cuarentena")} sub="retenidas" index={1} />
        <Stat label="Recibidas" value={count("recibida")} sub="cerradas" index={2} />
        <Stat label="Total" value={rows.length} sub="todas" index={3} />
      </div>

      <div className="nx-surface card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>N°</th>
                <th>Cliente</th>
                <th>BU</th>
                <th>Estado</th>
                <th>OC / Remito</th>
                <th>Transportista</th>
                <th className="text-right">Recibidos</th>
                <th>Fecha</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = RECEPTION_STATUS_META[r.status];
                return (
                  <tr key={r.id}>
                    <td className="font-mono text-xs font-semibold">{r.public_id}</td>
                    <td className="text-sm">{r.client_name}</td>
                    <td>
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-surface-alt text-fg-secondary">
                        {r.business_unit}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                          style={{ background: `${meta.color}1a`, color: meta.color }}
                        >
                          {meta.label}
                        </span>
                        {isParcial(r) && (
                          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border border-status-warning/40 text-status-warning">
                            Parcial
                          </span>
                        )}
                        {r.requires_quarantine && r.status !== "cuarentena" && (
                          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border border-stroke-soft text-fg-muted" title="Requiere cuarentena">
                            <Icon name="lock" size={9} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-xs text-fg-secondary">
                      {r.numero_oc ? <div>OC {r.numero_oc}</div> : null}
                      {r.numero_remito ? <div className="font-mono text-[10px]">{r.numero_remito}</div> : "—"}
                    </td>
                    <td className="text-xs">
                      {r.transportista ?? "—"}
                      {r.patente && <div className="font-mono text-[10px] text-fg-muted">{r.patente}</div>}
                    </td>
                    <td className="text-right tabular text-sm">
                      {r.received_count}<span className="text-fg-muted"> / {r.item_count}</span>
                    </td>
                    <td className="text-xs">{fmtDate(r.received_at ?? r.created_at)}</td>
                    <td>
                      <RowActions id={r.id} status={r.status} />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-fg-muted py-8 text-sm">
                    No hay recepciones cargadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, index }: { label: string; value: number; sub: string; index: number }) {
  return (
    <div style={{ animationDelay: `${index * 45}ms` }} className="nx-surface nx-stagger card p-5">
      <div className="kpi-label">{label}</div>
      <div className="text-2xl font-bold tabular leading-none mt-1 text-fg-brand">{value}</div>
      <div className="text-[11px] text-fg-muted mt-1">{sub}</div>
    </div>
  );
}
