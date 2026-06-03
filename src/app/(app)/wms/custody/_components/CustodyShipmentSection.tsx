import Link from "next/link";
import { Icon } from "@/components/Icon";
import {
  getCustodyTimeline,
  getShipmentCustodySummary,
  getShipmentToken,
} from "@/lib/custody/custody";
import { custodyQrDataUrl } from "@/lib/custody/qr";
import { fmtDateTime } from "@/lib/utils";
import { CustodyTimeline } from "./CustodyTimeline";
import { QrCard } from "./QrCard";
import { CustodyShipmentActions } from "./CustodyShipmentActions";

/**
 * Sección de Cadena de Custodia integrada en el detalle de Despacho (GATE 5 · FASE 6).
 * RESILIENTE: si las migraciones de custody (0036–0039) no están aplicadas, falla en
 * silencio y NO rompe la pantalla de Dispatch (Gate 4C).
 */
export async function CustodyShipmentSection({
  shipmentId,
  shipmentPublicId,
  orderId,
}: {
  shipmentId: string;
  shipmentPublicId: string;
  orderId: string;
}) {
  let token: string | null = null;
  let qr: string | null = null;
  let timeline = null;
  let summary = null;
  try {
    [token, timeline, summary] = await Promise.all([
      getShipmentToken(shipmentId),
      getCustodyTimeline(null, shipmentId),
      getShipmentCustodySummary(shipmentId),
    ]);
    if (token) qr = await custodyQrDataUrl(token);
  } catch {
    return (
      <div className="nx-surface card card-pad text-[11px] text-fg-muted">
        Cadena de Custodia no disponible (aplicar migraciones <code>0036</code>–<code>0039</code>).
      </div>
    );
  }
  if (!timeline || !summary) return null;

  const revalidate = `/wms/despachos/${orderId}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><Icon name="shield" size={14} /> Cadena de Custodia</h2>
        {summary.pod_present && (
          <Link href={`/wms/custody/pod/${shipmentId}`} className="btn btn-ghost btn-sm"><Icon name="file-pdf" size={12} /> Ver POD</Link>
        )}
      </div>

      {/* KPIs de custodia */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Eventos" value={String(summary.events)} />
        <MiniStat label="Evidencias" value={String(summary.evidences)} />
        <MiniStat label="POD" value={summary.pod_present ? "Sí" : "No"} color={summary.pod_present ? "#16a34a" : "#6b7280"} />
        <MiniStat label="Cadena" value={summary.chain_valid ? "Íntegra" : "ROTA"} color={summary.chain_valid ? "#16a34a" : "#dc2626"} />
      </div>
      {summary.last_activity && (
        <div className="text-[11px] text-fg-muted">Última actividad: {fmtDateTime(summary.last_activity)}</div>
      )}

      <div className="grid lg:grid-cols-[1fr_auto] gap-4 items-start">
        <div className="flex flex-col gap-4">
          <CustodyShipmentActions shipmentId={shipmentId} podPresent={summary.pod_present} revalidate={revalidate} />
          <CustodyTimeline timeline={timeline} allowRedact revalidate={revalidate} />
        </div>
        {qr && <QrCard dataUrl={qr} url={`/c/${token}`} publicId={shipmentPublicId} label="QR del despacho" />}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="nx-surface card p-3">
      <div className="kpi-label">{label}</div>
      <div className="text-lg font-bold tabular leading-none mt-1" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
