import { getPurchaseOrder } from "@/lib/compras/data";
import { fmtCurrency, fmtDate, fmtDateTime, fmtCuit } from "@/lib/compras/format";
import { ORG } from "@/lib/org";
import { PO_STATUS_META } from "@/lib/types-po";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Validar OC" };
export const dynamic = "force-dynamic";

export default async function ValidarPage({ params }: { params: { publicId: string } }) {
  const po = await getPurchaseOrder(params.publicId);
  if (!po) {
    return (
      <main className="min-h-screen grid place-items-center p-6 bg-bg-page">
        <div className="card p-8 text-center max-w-md">
          <Icon name="x" size={42} className="text-tops-red mx-auto mb-3" stroke={2} />
          <h1 className="text-xl font-bold text-fg-brand mb-2">OC no encontrada</h1>
          <p className="text-sm text-fg-secondary">
            La orden de compra <b>{params.publicId}</b> no existe o fue anulada.
          </p>
        </div>
      </main>
    );
  }
  const meta = PO_STATUS_META[po.status];
  return (
    <main className="min-h-screen grid place-items-center p-6 bg-bg-page">
      <div className="card p-6 md:p-8 max-w-lg w-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-status-success/10 text-status-success grid place-items-center">
            <Icon name="check-circle" size={24} stroke={2} />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-tops-red">
              Validación oficial
            </div>
            <h1 className="text-xl font-bold text-fg-brand">{ORG.brand}</h1>
          </div>
        </div>
        <div className="mb-4 pb-4 border-b border-stroke-soft">
          <div className="font-mono text-2xl font-bold text-fg-brand">{po.public_id}</div>
          <div className="text-sm text-fg-secondary mt-1">{fmtDateTime(po.date)}</div>
          <span className={`badge ${meta.cls} mt-2`}>
            <span className="dot" />
            {meta.label}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <KV label="Proveedor" value={po.vendor?.razon ?? "—"} />
          <KV label="CUIT" value={fmtCuit(po.vendor?.cuit ?? "")} mono />
          <KV label="Categoría" value={po.vendor?.categoria ?? po.categoria ?? "—"} />
          <KV label="Cond. pago" value={po.cond_pago} />
          <KV label="Items" value={String(po.items?.length ?? 0)} />
          <KV label="Total" value={fmtCurrency(po.total)} accent />
        </div>
        <div className="rounded-md p-3 bg-neutral-50 text-[11px] text-fg-muted font-mono break-all">
          <div className="font-bold uppercase tracking-wide text-fg-secondary mb-1">Integridad</div>
          SHA-256 {po.integrity_hash ?? "—"}
        </div>
        {po.signed_by && (
          <div className="mt-4 pt-4 border-t border-stroke-soft text-xs text-fg-secondary">
            Firmada digitalmente por{" "}
            <span className="font-bold text-fg-brand">{po.signed_by}</span> el{" "}
            {fmtDate(po.signed_at)}
          </div>
        )}
        <a
          href={`/api/compras/${po.public_id}/pdf`}
          className="btn btn-primary w-full mt-5"
          target="_blank"
          rel="noopener"
        >
          <Icon name="download" size={14} />
          Descargar PDF firmado
        </a>
      </div>
    </main>
  );
}

function KV({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-fg-muted mb-0.5">
        {label}
      </div>
      <div
        className={[
          "text-sm font-bold",
          mono ? "font-mono" : "",
          accent ? "text-tops-red" : "text-fg-primary",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}
