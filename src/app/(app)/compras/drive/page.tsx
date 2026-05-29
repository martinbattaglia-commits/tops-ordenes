import { Icon } from "@/components/Icon";
import { listPurchaseOrders } from "@/lib/compras/data";
import { fmtRel } from "@/lib/compras/format";
import { ORG } from "@/lib/org";

export const metadata = { title: "Compras · Drive sync" };
export const dynamic = "force-dynamic";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio"];

export default async function DrivePage() {
  const { rows } = await listPurchaseOrders({ pageSize: 1000 });

  const byMonth = new Map<string, { count: number; vendors: Set<string> }>();
  for (const o of rows) {
    const m = MONTHS[new Date(o.date).getMonth()] ?? "Otros";
    const cur = byMonth.get(m) ?? { count: 0, vendors: new Set<string>() };
    cur.count += 1;
    if (o.vendor) cur.vendors.add(o.vendor.razon);
    byMonth.set(m, cur);
  }

  const totalSize = (rows.length * 0.31).toFixed(1); // estimación 312KB/PDF
  const last = rows[0]?.date ?? null;

  return (
    <div className="p-4 md:p-7 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Backup automático · Google Drive</div>
          <h1 className="page-title">Drive sync</h1>
          <p className="page-subtitle">
            Cada OC firmada se sube automáticamente a Drive estructurada por mes y proveedor.
          </p>
        </div>
      </div>

      <div className="card p-5 flex flex-wrap items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-md bg-status-success/10 text-status-success grid place-items-center">
          <Icon name="cloud-check" size={22} stroke={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-fg-brand">{ORG.emitter.email}</div>
          <div className="text-xs text-fg-secondary">
            {rows.length} órdenes sincronizadas · ~{totalSize} MB · última sync {fmtRel(last)}
          </div>
        </div>
        <span className="badge badge-success">
          <span className="dot" />
          Conectado
        </span>
      </div>

      <div className="text-xs text-fg-muted font-mono mb-3 break-all">
        /{ORG.driveRoot}/
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {Array.from(byMonth.entries()).map(([m, info]) => (
          <div key={m} className="card p-4 hover:shadow-sm transition-shadow cursor-pointer">
            <div className="flex items-start justify-between mb-2">
              <Icon name="folder" size={28} className="text-tops-blue-900" />
              <span className="text-[11px] font-bold text-fg-muted tabular">{info.count} OC</span>
            </div>
            <div className="text-sm font-bold text-fg-primary">{m} 2026</div>
            <div className="text-[11px] text-fg-muted mt-0.5">
              {info.vendors.size} proveedores
            </div>
            <div className="flex -space-x-1 mt-3">
              {Array.from(info.vendors).slice(0, 5).map((v) => (
                <span
                  key={v}
                  title={v}
                  className="w-6 h-6 rounded-full border-2 border-white bg-tops-blue-700 text-white text-[9px] font-bold grid place-items-center"
                >
                  {v.charAt(0)}
                </span>
              ))}
              {info.vendors.size > 5 && (
                <span className="w-6 h-6 rounded-full border-2 border-white bg-neutral-200 text-fg-secondary text-[9px] font-bold grid place-items-center">
                  +{info.vendors.size - 5}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
