"use client";
import { useRouter } from "next/navigation";
import type { ReconRecord } from "@/lib/recon/types";
import { DiffRow } from "./DiffRow";
import { ScoreBadge } from "./ScoreBadge";
import { ReconTimeline } from "./ReconTimeline";
import { ReconStatusBadge } from "@/components/compras/ReconStatusBadge";
import { ReconActions } from "./ReconActions";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import type { PurchaseOrder } from "@/lib/types-po";
import type { SupplierInvoice } from "@/lib/erp/types";

interface Props {
  po: PurchaseOrder;
  invoice: SupplierInvoice;
  recon: ReconRecord;
  poId: string;
}

function Field({ label, oc, inv }: {
  label: string; oc: string; inv: string;
}) {
  const diff = oc !== inv;
  return (
    <div className={`grid grid-cols-[1fr_1fr] gap-4 py-2.5 border-b border-[var(--stroke-soft)] ${diff ? "bg-[var(--status-warning)]/5" : ""}`}>
      <div className="pl-2">
        <div className="text-eyebrow-sm text-fg-muted">{label}</div>
        <div className="text-sm font-medium text-fg-primary mt-0.5">{oc || "—"}</div>
      </div>
      <div>
        <div className="text-eyebrow-sm text-fg-muted">&nbsp;</div>
        <div className={`text-sm font-medium mt-0.5 ${diff ? "text-[var(--status-danger)]" : "text-fg-primary"}`}>
          {inv || "—"}
          {diff && <span className="ml-1 text-xs">⚠</span>}
        </div>
      </div>
    </div>
  );
}

export function ReconDetail({ po, invoice, recon, poId }: Props) {
  const router = useRouter();

  const handleAccept = async (diffId: string, note?: string) => {
    await fetch(`/api/compras/conciliar/${poId}/accept-diff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diffId, note }),
    });
    router.refresh();
  };

  const canEdit = recon.status === "pendiente" || recon.status === "en_revision";
  const nv = (v: number | null | undefined) => v != null ? fmtCurrency(v) : "—";
  const nro = (pv: number, n: string) =>
    `${String(pv).padStart(5, "0")}-${n.padStart(8, "0")}`;

  const poDate  = po.date  ? fmtDate(po.date)              : "—";
  const invDate = invoice.fecha_emision ? fmtDate(invoice.fecha_emision) : "—";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
      {/* Main panel */}
      <div className="space-y-6">

        {/* Score + header */}
        <div className="nx-surface rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-fg-primary">Comparación de documentos</h2>
              <p className="text-sm text-fg-muted">Cada campo se verifica automáticamente</p>
            </div>
            <div className="flex items-center gap-4">
              <ScoreBadge score={recon.score} size="lg" />
              <ReconStatusBadge status={recon.status} />
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-2 gap-4 pb-2 border-b border-[var(--stroke-soft)]">
            <div className="flex items-center gap-2">
              <span className="badge badge-muted">OC</span>
              <span className="font-semibold text-sm text-fg-primary">{po.public_id}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge badge-info">FACTURA</span>
              <span className="font-semibold text-sm text-fg-primary">{invoice.public_id}</span>
            </div>
          </div>

          {/* Comparison fields */}
          <div className="divide-y divide-[var(--stroke-soft)] -mx-2 px-2">
            <Field label="Proveedor"
              oc={po.vendor?.razon ?? "—"}
              inv={invoice.vendor?.razon ?? "—"} />
            <Field label="CUIT"
              oc={po.vendor?.cuit ?? "—"}
              inv={invoice.vendor?.cuit ?? "—"} />
            <Field label="Fecha"
              oc={poDate}
              inv={invDate} />
            <Field label="Condición de pago"
              oc={po.cond_pago ?? "—"}
              inv="(en factura)" />
            <Field label="Tipo de comprobante"
              oc="FACTURA_A / FACTURA_B"
              inv={invoice.tipo_comprobante} />
            <Field label="Nro. comprobante"
              oc="(OC)"
              inv={nro(invoice.punto_venta, invoice.numero)} />
            <Field label="CAE"
              oc="(requerido)"
              inv={invoice.cae ?? "(sin CAE)"} />
            <Field label="Importe Neto"
              oc={nv(po.neto)}
              inv={nv(invoice.neto)} />
            <Field label="IVA"
              oc={nv(po.iva)}
              inv={nv(invoice.iva)} />
            <Field label="Percepciones"
              oc="—"
              inv={nv(invoice.percepciones)} />
            <Field label="TOTAL"
              oc={nv(po.total)}
              inv={nv(invoice.total)} />
          </div>
        </div>

        {/* Diferencias detectadas */}
        {recon.diffs.length > 0 && (
          <div className="nx-surface rounded-xl p-6 space-y-3">
            <h3 className="text-sm font-semibold text-fg-primary">
              Diferencias detectadas
              <span className="ml-2 badge badge-warning">{recon.diffs.length}</span>
            </h3>
            {recon.diffs.map(d => (
              <DiffRow
                key={d.id}
                diff={d}
                onAccept={handleAccept}
                canEdit={canEdit}
              />
            ))}
          </div>
        )}

        {recon.diffs.length === 0 && (
          <div className="nx-surface rounded-xl p-6 flex items-center gap-3 text-[var(--status-success)]">
            <span className="text-2xl">✓</span>
            <div>
              <div className="font-semibold">Sin diferencias</div>
              <div className="text-sm text-fg-muted">Todos los campos concuerdan dentro de la tolerancia.</div>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="nx-surface rounded-xl p-6">
          <h3 className="text-sm font-semibold text-fg-primary mb-4">Historial de eventos</h3>
          <ReconTimeline events={recon.events} />
        </div>
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
        <ReconActions recon={recon} poId={poId} />

        <div className="nx-surface rounded-xl p-4 space-y-2 text-xs text-fg-muted">
          <div className="font-semibold text-fg-secondary text-sm">Resumen</div>
          <div className="flex justify-between">
            <span>Score</span>
            <span className="font-bold text-fg-primary">{recon.score}%</span>
          </div>
          <div className="flex justify-between">
            <span>Diferencias totales</span>
            <span>{recon.diffs.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Pendientes de aceptar</span>
            <span className={recon.diffs.filter(d => !d.accepted && d.severity !== "info").length > 0
              ? "text-[var(--status-danger)]" : ""}>
              {recon.diffs.filter(d => !d.accepted && d.severity !== "info").length}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Listo para pago</span>
            <span className={
              (recon.status === "conciliada" || recon.status === "con_diferencias")
                ? "text-[var(--status-success)] font-semibold"
                : "text-[var(--status-danger)]"
            }>
              {(recon.status === "conciliada" || recon.status === "con_diferencias") ? "Sí" : "No"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
