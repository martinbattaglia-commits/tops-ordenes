import { notFound } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { Icon } from "@/components/Icon";
import { StatusBadge } from "@/components/StatusBadge";
import { EntityConversationButton } from "@/components/connect/EntityConversationButton";
import { getOrder } from "@/lib/data/orders";
import { canAdjustServicePricing } from "@/lib/data/service-pricing";
import { env } from "@/lib/env";
import { fmtCurrency, fmtDate, fmtDateTime, isUrgentOrder } from "@/lib/utils";
import { OrderActions } from "./OrderActions";
import { PdfPreview } from "./PdfPreview";
import { adjustBillingAction, recordFulfillmentAction } from "./pricing-actions";

interface Props {
  params: { publicId: string };
  searchParams?: { created?: string; pricing?: string; message?: string };
}

export async function generateMetadata({ params }: Props) {
  const o = await getOrder(params.publicId);
  return { title: o ? `${o.public_id} · ${o.client?.razon ?? ""}` : "Orden no encontrada" };
}

export default async function OrderDetailPage({ params, searchParams }: Props) {
  const [order, canAdjustPricing] = await Promise.all([
    getOrder(params.publicId),
    canAdjustServicePricing(),
  ]);
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
      {searchParams?.message && (
        <div className={`border-y px-4 lg:px-8 py-3 text-sm ${
          searchParams.pricing === "updated"
            ? "border-status-success/20 bg-status-success/10 text-status-success"
            : "border-tops-red/20 bg-tops-red/5 text-tops-red"
        }`}>
          {searchParams.message}
        </div>
      )}

      <div className="px-4 lg:px-8 pt-4 lg:pt-6 flex flex-wrap items-center gap-2">
        <Link href="/orders" className="btn btn-ghost btn-sm">
          <Icon name="arrow-left" size={13} /> Órdenes
        </Link>
        <span className="text-fg-muted text-xs">/</span>
        <span className="text-xs text-fg-secondary font-mono">{order.public_id}</span>
        <div className="ml-auto flex items-center gap-2">
          {!order.prices_hidden && <EntityConversationButton entityType="orders" entityId={order.id} />}
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
        <div className="space-y-5">
          {order.prices_hidden
            ? <OperationalLifecycle order={order} />
            : <PricingLifecycle order={order} canAdjust={canAdjustPricing} />}
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
          {!order.prices_hidden && <PdfPreview order={order} qrSvg={qrSvg} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function OperationalLifecycle({ order }: { order: NonNullable<Awaited<ReturnType<typeof getOrder>>> }) {
  return <div className="card overflow-hidden">
    <div className="card-pad border-b border-stroke-soft">
      <div className="eyebrow-tiny">Registro operativo</div>
      <div className="text-base font-bold text-fg-brand">Servicios y cantidades</div>
      <div className="text-xs text-fg-muted mt-1">Los importes comerciales se resuelven fuera de esta cuenta.</div>
    </div>
    <div className="divide-y divide-stroke-soft">
      {(order.services ?? []).map((line, index) => <div key={line.id ?? index} className="p-4">
        <div className="font-bold text-sm">{line.label}</div>
        <div className="text-xs text-fg-muted mt-1">
          Solicitado: {line.qty_requested ?? line.qty} {line.unit} · {line.qty_provided == null ? "Prestación pendiente" : `Prestado: ${line.qty_provided} ${line.unit}`}
        </div>
        {line.id && <form action={recordFulfillmentAction} className="grid sm:grid-cols-[140px_1fr_auto] gap-2 mt-3">
          <input type="hidden" name="public_id" value={order.public_id} />
          <input type="hidden" name="line_id" value={line.id} />
          <input name="qty_provided" type="number" min="0" step="0.01" required defaultValue={line.qty_provided ?? line.qty_requested ?? line.qty} className="input" aria-label="Cantidad prestada" />
          <input name="reason" required minLength={3} className="input" placeholder="Motivo / evidencia operativa" />
          <button className="btn btn-primary btn-sm" type="submit">Guardar prestación</button>
        </form>}
      </div>)}
    </div>
  </div>;
}

function PricingLifecycle({
  order,
  canAdjust,
}: {
  order: NonNullable<Awaited<ReturnType<typeof getOrder>>>;
  canAdjust: boolean;
}) {
  const currency = order.pricing_currency;
  return (
    <div className="card overflow-hidden">
      <div className="card-pad border-b border-stroke-soft flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <div className="eyebrow-tiny">Ciclo económico inmutable</div>
          <div className="text-base font-bold text-fg-brand">Solicitado · prestado · facturado</div>
          <div className="text-xs text-fg-muted mt-1">
            Moneda del snapshot: {currency ?? "legado sin moneda demostrable"}
          </div>
        </div>
        <Link href="/orders/tarifas" className="btn btn-ghost btn-sm">Ver tarifario</Link>
      </div>

      <div className="grid grid-cols-3 gap-px bg-stroke-soft border-b border-stroke-soft">
        <AmountCard label="Emitido" value={order.issued_total ?? order.total} currency={currency} />
        <AmountCard label="Prestado" value={order.provided_total} currency={currency} pending="Sin registrar" />
        <AmountCard label="Facturado" value={order.billed_total} currency={currency} pending="Sin registrar" />
      </div>

      <div className="divide-y divide-stroke-soft">
        {(order.services ?? []).map((line, index) => (
          <div key={line.id ?? `${line.service_slug}-${index}`} className="p-4">
            <div className="flex flex-wrap justify-between gap-2 mb-3">
              <div>
                <div className="text-sm font-bold text-fg-primary">{line.label}</div>
                <div className="text-[11px] text-fg-muted">
                  Solicitado {line.qty_requested ?? line.qty} {line.unit} · {line.price_source ?? "legacy"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-fg-brand">
                  {formatSnapshotMoney(line.subtotal_requested ?? line.subtotal, line.currency_snapshot ?? currency)}
                </div>
                <div className="text-[11px] text-fg-muted">snapshot emitido</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs mb-3">
              <div className="rounded-lg bg-neutral-50 border border-stroke-soft p-3">
                <div className="font-semibold text-fg-secondary">Prestación registrada</div>
                <div className="mt-1 tabular">
                  {line.qty_provided == null ? "Pendiente" : `${line.qty_provided} ${line.unit}`} · {formatSnapshotMoney(line.subtotal_provided, line.currency_snapshot ?? currency)}
                </div>
              </div>
              <div className="rounded-lg bg-neutral-50 border border-stroke-soft p-3">
                <div className="font-semibold text-fg-secondary">Facturación final</div>
                <div className="mt-1 tabular">
                  {line.qty_billed == null ? "Pendiente" : `${line.qty_billed} ${line.unit}`} · {formatSnapshotMoney(line.subtotal_billed, line.currency_snapshot ?? currency)}
                </div>
              </div>
            </div>

            {canAdjust && line.id && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <form action={recordFulfillmentAction} className="rounded-lg border border-stroke-soft p-3 space-y-2">
                  <div className="text-xs font-bold text-fg-brand">Registrar prestación</div>
                  <input type="hidden" name="public_id" value={order.public_id} />
                  <input type="hidden" name="line_id" value={line.id} />
                  <input name="qty_provided" type="number" min="0" step="0.01" required defaultValue={line.qty_provided ?? line.qty_requested ?? line.qty} className="input w-full" aria-label="Cantidad prestada" />
                  <input name="reason" required minLength={3} className="input w-full" placeholder="Motivo / evidencia operativa" />
                  <button className="btn btn-ghost btn-sm w-full" type="submit">Guardar prestación</button>
                </form>
                <form action={adjustBillingAction} className="rounded-lg border border-stroke-soft p-3 space-y-2">
                  <div className="text-xs font-bold text-fg-brand">
                    {line.price_source === "bonification" ? "Autorizar magnitud de bonificación" : "Autorizar facturación"}
                  </div>
                  <input type="hidden" name="public_id" value={order.public_id} />
                  <input type="hidden" name="line_id" value={line.id} />
                  <div className="grid grid-cols-2 gap-2">
                    <input name="qty_billed" type="number" min="0" step="0.01" required defaultValue={line.qty_billed ?? line.qty_provided ?? line.qty_requested ?? line.qty} className="input w-full" aria-label="Cantidad facturada" />
                    <input
                      name="billed_amount"
                      type="number"
                      min="0"
                      max={line.price_source === "bonification" ? Math.abs(line.subtotal_requested ?? line.subtotal ?? 0) : undefined}
                      step="0.01"
                      required
                      defaultValue={line.price_source === "bonification"
                        ? Math.abs(line.subtotal_billed ?? line.subtotal_requested ?? line.subtotal ?? 0)
                        : (line.subtotal_billed ?? line.subtotal_provided ?? line.subtotal_requested ?? line.subtotal ?? undefined)}
                      className="input w-full"
                      aria-label={line.price_source === "bonification" ? "Magnitud de bonificación facturada" : "Importe facturado"}
                    />
                  </div>
                  <input name="reason" required minLength={3} className="input w-full" placeholder="Motivo y autorización" />
                  <button className="btn btn-primary btn-sm w-full" type="submit">Guardar facturación</button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>

      {!canAdjust && (
        <div className="px-4 py-3 border-t border-stroke-soft text-xs text-fg-muted">
          La actualización de prestación y facturación requiere autorización de Servicios.
        </div>
      )}
      {(order.service_order_events?.length ?? 0) > 0 && (
        <details className="border-t border-stroke-soft px-4 py-3">
          <summary className="text-xs font-bold text-fg-brand cursor-pointer">Ledger de eventos ({order.service_order_events?.length})</summary>
          <div className="mt-3 space-y-2">
            {[...(order.service_order_events ?? [])].sort((a,b) => a.id-b.id).map((event) => (
              <div key={event.id} className="text-[11px] text-fg-secondary">
                <span className="font-mono">#{event.id}</span> · {event.event_kind} · {fmtDateTime(event.created_at)}{event.reason ? ` · ${event.reason}` : ""}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function AmountCard({ label, value, currency, pending = "Pendiente" }: { label: string; value?: number | null; currency?: "ARS" | "USD"; pending?: string }) {
  return (
    <div className="bg-white p-3 text-center">
      <div className="text-[10px] uppercase tracking-wider font-bold text-fg-muted">{label}</div>
      <div className="text-sm font-bold text-fg-brand mt-1">{value == null ? pending : formatSnapshotMoney(value, currency)}</div>
    </div>
  );
}

function formatSnapshotMoney(value: number | null | undefined, currency?: "ARS" | "USD"): string {
  if (value == null) return "Pendiente";
  if (!currency) return `${Number(value).toLocaleString("es-AR")} · moneda no verificada`;
  return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(Number(value));
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
