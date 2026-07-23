import { notFound } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { Icon } from "@/components/Icon";
import { StatusBadge } from "@/components/StatusBadge";
import { EntityConversationButton } from "@/components/connect/EntityConversationButton";
import { getOrder } from "@/lib/data/orders";
import { env } from "@/lib/env";
import { fmtCurrency, fmtDate, fmtDateTime, isUrgentOrder } from "@/lib/utils";
import { OrderActions } from "./OrderActions";
import { PdfPreview } from "./PdfPreview";

interface Props {
  params: { publicId: string };
  searchParams?: { created?: string };
}

export async function generateMetadata({ params }: Props) {
  const o = await getOrder(params.publicId);
  return { title: o ? `${o.public_id} · ${o.client?.razon ?? ""}` : "Orden no encontrada" };
}

export default async function OrderDetailPage({ params, searchParams }: Props) {
  const order = await getOrder(params.publicId);
  if (!order) notFound();

  const publicUrl = `${env.app.url}/orders/${order.public_id}`;
  const qrSvg = await QRCode.toString(publicUrl, {
    type: "svg",
    margin: 1,
    color: { dark: "#050555", light: "#ffffff00" },
    width: 160,
  });

  return (
    <div className="pb-10">
      {searchParams?.created === "1" && <SuccessBanner publicId={order.public_id} />}

      <div className="px-4 lg:px-8 pt-4 lg:pt-6 flex flex-wrap items-center gap-2">
        <Link href="/orders" className="btn btn-ghost btn-sm">
          <Icon name="arrow-left" size={13} /> Órdenes
        </Link>
        <span className="text-fg-muted text-xs">/</span>
        <span className="text-xs text-fg-secondary font-mono">{order.public_id}</span>
        <div className="ml-auto flex items-center gap-2">
          <EntityConversationButton entityType="orders" entityId={order.id} />
          <OrderActions order={order} publicUrl={publicUrl} />
        </div>
      </div>

      <div className="px-4 lg:px-8 pt-4 lg:pt-5 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
        <div className="flex flex-col gap-4">
          <div className="card card-pad">
            <div className="eyebrow-tiny">{order.public_id}</div>
            <h2 className="text-xl font-bold text-fg-brand mb-1 -tracking-[0.005em]">
              {order.client?.razon ?? "—"}
            </h2>
            <div className="text-xs text-fg-secondary font-mono mb-3">{order.client?.cuit}</div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={order.status} />
              {isUrgentOrder(order) && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-tops-red text-white">
                  🚨 Urgente
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <Meta label="Fecha" value={fmtDate(order.date)} />
              <Meta label="Depósito" value={order.depot === "MAGALDI" ? "Magaldi · CABA" : "Luján · BsAs"} />
              <Meta label="Hora inicio" value={order.h_start ?? "—"} />
              <Meta label="Hora fin" value={order.h_end ?? "—"} />
              <Meta label="Pallets" value={String(order.pallets)} />
              <Meta label="Unidades" value={String(order.units)} />
            </div>
          </div>

          <div className="card card-pad">
            <SectionLabel>Responsable operativo</SectionLabel>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-tops-blue-700 text-white grid place-items-center font-bold text-xs">
                {order.operator?.avatar ?? "—"}
              </div>
              <div>
                <div className="font-semibold text-sm">{order.operator?.full_name ?? "—"}</div>
                <div className="text-[11px] text-fg-muted">{order.operator?.role ?? "—"}</div>
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <SectionLabel>Línea de tiempo</SectionLabel>
            <Timeline order={order} />
          </div>

          <div className="card card-pad">
            <SectionLabel>Envíos automáticos</SectionLabel>
            <EmailChip email={env.email.depot.magaldi} tag="Despacho" delivered />
            <EmailChip email={env.email.admin.ruth} tag="Admin." delivered />
            <EmailChip email={env.email.admin.joseluis} tag="Admin." delivered />
            {order.client?.email && (
              <EmailChip email={order.client.email} tag="Cliente" delivered opened />
            )}
          </div>

          <div className="card card-pad">
            <SectionLabel>Trazabilidad</SectionLabel>
            <div className="text-xs text-fg-secondary leading-relaxed">
              <div>
                <Icon name="pin" size={11} className="inline-block text-tops-red mr-1 -mt-0.5" />
                {order.geo_lat && order.geo_lng
                  ? `${order.geo_lat.toFixed(4)}, ${order.geo_lng.toFixed(4)}`
                  : "Sin geolocalización"}
              </div>
              <div className="mt-1">
                IP: <span className="font-mono">{order.ip ?? "—"}</span>
              </div>
              {order.signature_hash && (
                <div className="mt-1">
                  Hash: <span className="font-mono break-all">{order.signature_hash.slice(0, 32)}…</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column — PDF Preview */}
        <div>
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <div>
              <div className="eyebrow-tiny">Vista previa · A4</div>
              <div className="text-base font-bold text-fg-brand">Comprobante de servicio</div>
            </div>
            <Link
              href={`/api/orders/${order.public_id}/pdf`}
              target="_blank"
              className="btn btn-primary btn-sm"
            >
              <Icon name="download" size={13} /> Descargar PDF
            </Link>
          </div>
          <PdfPreview order={order} qrSvg={qrSvg} />
        </div>
      </div>
    </div>
  );
}

function SuccessBanner({ publicId }: { publicId: string }) {
  return (
    <div className="bg-status-success/10 border-y border-status-success/20 px-4 lg:px-8 py-3 flex items-center gap-3 text-status-success text-sm">
      <Icon name="check-circle" size={18} />
      <div className="font-semibold">¡Listo!</div>
      <div className="text-fg-primary">
        Comprobante <span className="font-mono font-bold">{publicId}</span> generado y enviado a los
        destinatarios.
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted mb-1">
        {label}
      </div>
      <div className="text-sm font-semibold text-fg-primary">{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted mb-3">
      {children}
    </div>
  );
}

function Timeline({ order }: { order: Awaited<ReturnType<typeof getOrder>> }) {
  if (!order) return null;
  const events = [
    {
      t: order.signed_at ? fmtDateTime(order.signed_at).split("·")[1].trim() : "—",
      label: "Cliente firma digital",
      by: order.signed_by ?? "Pendiente",
      done: Boolean(order.signed_by),
      icon: "pen" as const,
    },
    {
      t: order.h_end ?? "—",
      label: "Servicio finalizado",
      by: order.operator?.full_name ?? "—",
      done: true,
      icon: "check-circle" as const,
    },
    {
      t: order.h_start ?? "—",
      label: "Servicio iniciado",
      by: order.operator?.full_name ?? "—",
      done: true,
      icon: "bolt" as const,
    },
    {
      t: fmtDateTime(order.created_at).split("·")[1]?.trim() ?? "—",
      label: "Orden generada",
      by: "Sistema",
      done: true,
      icon: "plus" as const,
    },
  ];
  return (
    <div className="relative pl-1">
      <div className="absolute left-3 top-1 bottom-1 w-px bg-neutral-200" />
      {events.map((e, i) => (
        <div key={i} className="flex gap-3 mb-3 relative">
          <div
            className={`w-6 h-6 rounded-full grid place-items-center shrink-0 border-[3px] border-white relative z-10 ${
              e.done ? "bg-status-success text-white" : "bg-neutral-100 text-fg-muted"
            }`}
          >
            <Icon name={e.icon} size={11} stroke={2.4} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-fg-primary">{e.label}</div>
            <div className="text-[11px] text-fg-muted">
              {e.t} · {e.by}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmailChip({
  email,
  tag,
  delivered,
  opened,
}: {
  email: string;
  tag: string;
  delivered?: boolean;
  opened?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-md mb-1.5 bg-neutral-50">
      <Icon name="mail" size={13} className="text-fg-muted shrink-0" />
      <span className="text-[11px] font-medium flex-1 truncate">{email}</span>
      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white border border-stroke-soft text-fg-muted">
        {tag}
      </span>
      {delivered && (
        <span
          className={`inline-flex items-center text-[10px] font-bold ${
            opened ? "text-status-success" : "text-fg-muted"
          }`}
        >
          <Icon name="check" size={11} stroke={2.4} />
          {opened && <Icon name="check" size={11} stroke={2.4} style={{ marginLeft: -7 }} />}
        </span>
      )}
    </div>
  );
}
