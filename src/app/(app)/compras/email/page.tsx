import { Icon } from "@/components/Icon";
import { ORG } from "@/lib/org";
import { listRecentPurchaseOrders } from "@/lib/compras/data";
import { fmtCurrency, fmtDate } from "@/lib/compras/format";

export const metadata = { title: "Compras · Plantilla email" };
export const dynamic = "force-dynamic";

export default async function EmailPreviewPage() {
  const [latest] = await listRecentPurchaseOrders(1);
  if (!latest) {
    return (
      <div className="p-8 text-center text-fg-muted">
        Sin OC para previsualizar email.
      </div>
    );
  }
  const items = latest.items ?? [];
  return (
    <div className="p-4 md:p-7 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Plantilla automática</div>
          <h1 className="page-title">Email al proveedor</h1>
          <p className="page-subtitle">
            Se envía automáticamente al firmar la OC: proveedor en To, administración y dirección en
            CC.
          </p>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)" }}>
        <div className="bg-white rounded-md shadow-md overflow-hidden border border-stroke-soft">
          <div className="px-3 py-2 bg-neutral-100 border-b border-stroke-soft flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="ml-3 text-[11px] text-fg-muted font-mono">{latest.vendor?.email ?? "—"}</span>
          </div>
          <div className="px-5 py-4 border-b border-stroke-soft flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-tops-blue-900 text-white grid place-items-center font-bold">
              T
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-fg-primary">TOPS Compras</div>
              <div className="text-[11px] text-fg-muted">
                {ORG.emitter.email} → {latest.vendor?.email}
              </div>
            </div>
            <div className="text-[11px] text-fg-muted">{fmtDate(latest.date)}</div>
          </div>
          <div className="px-5 py-4">
            <h3 className="text-base font-bold text-fg-brand mb-2">
              Orden de Compra {latest.public_id} · {ORG.brand}
            </h3>
            <p className="text-sm text-fg-primary leading-relaxed mb-3">
              Estimado/a <b>{latest.vendor?.contacto ?? latest.vendor?.razon}</b>,<br />
              Emitimos la orden de compra firmada por nuestro Director de Operaciones. El documento
              firmado se entrega exclusivamente por un canal autorizado de TOPS.
            </p>
            <div className="grid grid-cols-2 gap-3 my-4 p-3 bg-neutral-50 rounded-md">
              <KV label="Orden" value={latest.public_id} mono />
              <KV label="Fecha" value={fmtDate(latest.date)} />
              <KV label="Cond. pago" value={latest.cond_pago} />
              <KV label="Entrega" value={latest.entrega ?? "—"} />
              <KV label="Items" value={String(items.length)} />
              <KV
                label={latest.price_state === "estimated" ? "Total estimado" : latest.price_state === "pending" ? "Importe" : "Total"}
                value={latest.price_state === "pending" ? "Pendiente de precio" : fmtCurrency(latest.total ?? latest.planning_total)}
                accent
              />
            </div>
            <div className="mt-5 text-[11px] text-fg-muted">
              {ORG.emitter.name} · {ORG.emitter.role}
              <br />
              {ORG.legalName} · CUIT {ORG.cuit}
            </div>
          </div>
        </div>

        {/* Reglas */}
        <div className="space-y-3">
          <RuleRow tag="Siempre · To" label="Proveedor" value={latest.vendor?.email ?? "—"} kind="info" />
          <RuleRow tag="Siempre · CC" label="Administración" value={ORG.admin.email} kind="success" />
          <RuleRow tag="Siempre · CC" label="Dirección" value={ORG.emitter.email} kind="success" />

          <div className="card p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-muted mb-2">
              Entrega documental
            </div>
            <div className="text-xs text-fg-primary">
              El email no adjunta ni publica el comprobante. La copia firmada se entrega por un canal
              interno autorizado y queda preservada en Nexus.
            </div>
          </div>

          <div className="card p-4 bg-tops-blue-700/5 border-tops-blue-700/20">
            <div className="flex items-start gap-2.5">
              <Icon name="cloud-check" size={16} className="text-tops-blue-700" stroke={2} />
              <div className="text-xs text-fg-primary">
                Sincronización automática con Google Drive en{" "}
                <code className="font-mono text-[11px] text-fg-secondary">/{ORG.driveRoot}/Mes/Proveedor/</code>
                . Esta previsualización no afirma que el archivo haya sido sincronizado.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleRow({
  tag,
  label,
  value,
  kind,
}: {
  tag: string;
  label: string;
  value: string;
  kind: "info" | "success";
}) {
  const cls = kind === "info" ? "bg-tops-blue-700/10 text-tops-blue-700" : "bg-status-success/10 text-status-success";
  return (
    <div className="card p-3 flex items-center gap-3">
      <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide ${cls}`}>
        {tag}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-[0.1em] font-bold text-fg-muted">{label}</div>
        <div className="text-xs font-mono text-fg-primary truncate">{value}</div>
      </div>
    </div>
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
      <div className="text-[10px] uppercase tracking-[0.1em] font-bold text-fg-muted">{label}</div>
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
