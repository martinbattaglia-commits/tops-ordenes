import { notFound } from "next/navigation";
import Link from "next/link";
import { getPurchaseOrder } from "@/lib/compras/data";
import { Icon } from "@/components/Icon";
import { PoStatusBadge } from "@/components/compras/PoStatusBadge";
import { PdfPreview } from "@/components/compras/PdfPreview";
import {
  fmtCurrency,
  fmtCurrencyShort,
  fmtDate,
  fmtDateTime,
  fmtRel,
  fmtCuit,
} from "@/lib/compras/format";
import { ORG } from "@/lib/org";
import { PO_EVENT_LABEL } from "@/lib/types-po";
import { OrderDetailTabs } from "./OrderDetailTabs";

interface PageProps {
  params: { publicId: string };
  searchParams?: { just_created?: string };
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps) {
  return { title: `OC ${params.publicId}` };
}

export default async function OrderDetailPage({ params, searchParams }: PageProps) {
  const po = await getPurchaseOrder(params.publicId);
  if (!po) notFound();
  const justCreated = searchParams?.just_created === "1";

  return (
    <div className="p-4 md:p-7 lg:p-8">
      {justCreated && (
        <div className="card p-4 mb-4 border-status-success/40 bg-status-success/5 flex items-center gap-3">
          <Icon name="check-circle" size={22} className="text-status-success" stroke={2} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-status-success">OC creada y enviada</div>
            <div className="text-xs text-fg-secondary">
              Email enviado a {po.vendor?.email}, {ORG.admin.email} y {ORG.emitter.email}. Sincronizada en Drive.
            </div>
          </div>
          <Link href="/compras/nueva" className="btn btn-ghost btn-sm">
            Nueva OC
          </Link>
        </div>
      )}

      <div className="page-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-fg-secondary mb-1">
            <Link href="/compras/ordenes" className="hover:text-fg-primary">
              Órdenes de compra
            </Link>
            <Icon name="chevron-right" size={12} />
            <span className="font-mono text-fg-primary">{po.public_id}</span>
          </div>
          <h1 className="page-title truncate">{po.vendor?.razon ?? "OC sin proveedor"}</h1>
          <p className="page-subtitle">
            {fmtCuit(po.vendor?.cuit ?? "")} · {po.vendor?.categoria ?? "—"}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/compras/${po.public_id}/pdf`}
            target="_blank"
            rel="noopener"
            className="btn btn-ghost btn-sm"
          >
            <Icon name="download" size={14} />
            <span>PDF</span>
          </a>
          <button className="btn btn-ghost btn-sm" type="button">
            <Icon name="send" size={14} />
            <span className="hidden sm:inline">Reenviar email</span>
          </button>
        </div>
      </div>

      <div
        className="grid gap-4 md:gap-6 items-start"
        style={{ gridTemplateColumns: "minmax(0,360px) minmax(0,1fr)" }}
      >
        {/* COLUMNA IZQUIERDA — Metadatos sticky */}
        <aside className="md:sticky md:top-4 space-y-3">
          <div className="card p-5">
            <div className="font-mono text-[11px] text-fg-muted font-bold mb-1">
              {po.public_id}
            </div>
            <div className="text-lg font-bold text-fg-brand mb-1 leading-tight">
              {po.vendor?.razon}
            </div>
            <div className="text-xs text-fg-muted font-mono mb-3">
              {fmtCuit(po.vendor?.cuit ?? "")}
            </div>
            <PoStatusBadge status={po.status} />

            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-stroke-soft">
              <KV label="Fecha" value={fmtDate(po.date)} />
              <KV label="Cond. pago" value={po.cond_pago} />
              <KV label="Destino" value={po.destino ?? "—"} />
              <KV label="Entrega" value={po.entrega ?? "—"} />
            </div>

            <div className="flex items-end justify-between mt-4 pt-4 border-t border-stroke-soft">
              <div>
                <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-fg-muted">
                  Total
                </div>
                <div className="text-2xl font-bold text-fg-brand tabular">{fmtCurrency(po.total)}</div>
              </div>
              <div className="text-right text-xs text-fg-secondary leading-tight">
                <div>Neto {fmtCurrencyShort(po.neto)}</div>
                <div className="text-fg-muted">+ IVA {fmtCurrencyShort(po.iva)}</div>
              </div>
            </div>
          </div>

          {/* Emisor */}
          <div className="card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-tops-red text-white grid place-items-center font-bold flex-shrink-0">
              {ORG.emitter.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-muted mb-0.5">
                Emisor autorizado
              </div>
              <div className="text-sm font-bold text-fg-brand">{po.emisor_name}</div>
              <div className="text-[11px] text-fg-secondary">{po.emisor_role}</div>
            </div>
            {po.signed_at && (
              <Icon name="check-circle" size={20} className="text-status-success" stroke={2} />
            )}
          </div>

          {/* Trazabilidad timeline */}
          <div className="card p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-muted mb-4">
              Trazabilidad
            </div>
            <ol className="relative">
              <span className="absolute left-[10px] top-2 bottom-2 w-px bg-stroke-soft" />
              {(po.events ?? []).map((ev, i) => (
                <li key={i} className="flex gap-3 mb-3 last:mb-0 relative">
                  <span className="w-5 h-5 rounded-full bg-status-success text-white grid place-items-center flex-shrink-0 z-10">
                    <Icon name="check" size={10} stroke={2.4} />
                  </span>
                  <div className="flex-1 min-w-0 pt-0">
                    <div className="text-[13px] font-bold text-fg-primary">
                      {PO_EVENT_LABEL[ev.kind]}
                    </div>
                    <div className="text-[11px] text-fg-muted">
                      {ev.actor ?? "—"} · {fmtRel(ev.ts)}
                    </div>
                  </div>
                </li>
              ))}
              {(po.events ?? []).length === 0 && (
                <li className="text-xs text-fg-muted">Sin eventos registrados.</li>
              )}
            </ol>
          </div>

          {/* Envíos automáticos */}
          <div className="card p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-muted mb-3">
              Envíos automáticos
            </div>
            <div className="space-y-2">
              {(po.emails ?? []).map((e, i) => (
                <EmailChip key={i} tag={e.tag ?? "Destinatario"} email={e.to_email} status={e.status} />
              ))}
              {(po.emails ?? []).length === 0 && (
                <div className="text-xs text-fg-muted">Sin envíos aún.</div>
              )}
            </div>
          </div>

          {/* Drive */}
          {po.drive_folder && (
            <div className="card p-5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-status-success/10 text-status-success grid place-items-center">
                <Icon name="cloud-check" size={16} stroke={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-muted mb-0.5">
                  Sincronizado en Drive
                </div>
                <div className="text-[11px] font-mono text-fg-secondary break-all">
                  /{po.drive_folder}/
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* COLUMNA DERECHA — Tabs PDF / Email / WhatsApp */}
        <div className="card overflow-hidden">
          <OrderDetailTabs po={po} />
        </div>
      </div>

      {/* PDF preview render — siempre visible debajo del tab selector */}
      <div className="md:hidden mt-4">
        <PdfPreview po={po} />
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-fg-muted mb-0.5">
        {label}
      </div>
      <div className="text-sm font-semibold text-fg-primary truncate">{value}</div>
    </div>
  );
}

function EmailChip({
  tag,
  email,
  status,
}: {
  tag: string;
  email: string;
  status: string;
}) {
  const ok = status === "opened" || status === "sent";
  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-neutral-50 border border-stroke-soft">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-[0.1em] font-bold text-fg-muted">{tag}</div>
        <div className="text-xs font-mono text-fg-primary truncate">{email}</div>
      </div>
      <span
        className={`text-[10px] font-bold inline-flex items-center gap-1 ${
          ok ? "text-status-success" : "text-fg-muted"
        }`}
      >
        <Icon name="check" size={11} stroke={2.4} />
        <Icon name="check" size={11} stroke={2.4} className="-ml-2.5" />
      </span>
    </div>
  );
}

void fmtDateTime;
