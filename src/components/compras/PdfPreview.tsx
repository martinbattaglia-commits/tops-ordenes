"use client";

import type { PurchaseOrder, POItem, Vendor } from "@/lib/types-po";
import { fmtCurrency, fmtDateTime, fmtCuit } from "@/lib/compras/format";
import { ORG } from "@/lib/org";
import { Icon } from "@/components/Icon";

/**
 * Vista previa A4 estilo planilla — coincide con la salida final del PDF
 * generado por @react-pdf/renderer. Usado en wizard live-preview y detalle.
 */

interface Props {
  po: Partial<PurchaseOrder> & { items?: POItem[]; vendor?: Vendor };
  signatureDataUrl?: string | null;
  qrUrl?: string | null;
  className?: string;
  /** Para minimum filler rows en la tabla. */
  fillerRows?: number;
}

export function PdfPreview({ po, signatureDataUrl, qrUrl, className, fillerRows = 4 }: Props) {
  const items = po.items ?? [];
  const neto = po.neto ?? items.reduce((a, b) => a + b.subtotal, 0);
  const iva = po.iva ?? Math.round(neto * 0.21);
  const total = po.total ?? neto + iva;
  const filler = Math.max(0, fillerRows - items.length);

  return (
    <div className={className}>
      <div
        className="pdf-page bg-white relative overflow-hidden shadow-md"
        style={{
          aspectRatio: "1 / 1.414",
          padding: "36px 38px",
          color: "#0B1220",
          fontSize: 12,
          borderRadius: 4,
          boxShadow: "0 0 0 1px rgba(5,5,85,0.08), 0 12px 32px rgba(5,5,85,0.10)",
        }}
      >
        {/* Top accent bar */}
        <div className="absolute left-0 right-0 top-0 h-1" style={{ background: "#C90812" }} />

        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-stroke-soft mb-4">
          <div>
            <div className="flex items-end gap-1">
              <span className="text-2xl font-black uppercase tracking-tight" style={{ color: "#050555" }}>
                TOPS
              </span>
              <span className="text-[9px] font-bold tracking-[0.18em] uppercase mb-1 text-tops-red">
                Compras
              </span>
            </div>
            <div className="text-[9px] text-fg-secondary leading-relaxed mt-1 max-w-[300px]">
              {ORG.legalName} · CUIT {ORG.cuit} · {ORG.iva}
              <br />
              {ORG.address}
              <br />
              {ORG.phone} · {ORG.website}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-tops-red">
              Orden de Compra
            </div>
            <div className="font-mono text-[20px] font-bold leading-tight" style={{ color: "#050555" }}>
              {po.public_id ?? "OC-2026-XXXX"}
            </div>
            <div className="text-[10px] text-fg-secondary">{fmtDateTime(po.date ?? new Date())}</div>
          </div>
        </div>

        {/* Bloque Proveedor */}
        <Section label="Proveedor">
          <div className="grid" style={{ gridTemplateColumns: "1.7fr 1fr 1fr", gap: 12 }}>
            <KV label="Razón social" value={po.vendor?.razon ?? "—"} strong />
            <KV label="CUIT" value={fmtCuit(po.vendor?.cuit ?? "")} mono />
            <KV label="Contacto" value={po.vendor?.contacto ?? "—"} />
            <KV label="Domicilio" value={po.vendor?.domicilio ?? "—"} colSpan={2} />
            <KV label="Email" value={po.vendor?.email ?? "—"} />
          </div>
        </Section>

        {/* Bloque Destino */}
        <Section label="Destino y condiciones">
          <div
            className="rounded-md p-3 grid gap-3"
            style={{ background: "#F7F8FB", gridTemplateColumns: "repeat(4, 1fr)" }}
          >
            <KV label="Destino" value={po.destino ?? "—"} />
            <KV label="Cond. pago" value={po.cond_pago ?? "—"} />
            <KV label="Entrega" value={po.entrega ?? "—"} />
            <KV label="Categoría" value={po.categoria ?? "—"} />
          </div>
        </Section>

        {/* Tabla items */}
        <table className="w-full mt-3 text-[10px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#050555", color: "#fff" }}>
              <th className="text-left py-1.5 px-2 font-bold uppercase tracking-wide text-[9px] w-10">N°</th>
              <th className="text-left py-1.5 px-2 font-bold uppercase tracking-wide text-[9px]">Producto / Servicio</th>
              <th className="text-right py-1.5 px-2 font-bold uppercase tracking-wide text-[9px] w-14">Cant.</th>
              <th className="text-left py-1.5 px-2 font-bold uppercase tracking-wide text-[9px] w-14">Un.</th>
              <th className="text-right py-1.5 px-2 font-bold uppercase tracking-wide text-[9px] w-20">P. Unit.</th>
              <th className="text-right py-1.5 px-2 font-bold uppercase tracking-wide text-[9px] w-24">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b" style={{ borderColor: "#EEF1F6" }}>
                <td className="py-1.5 px-2 text-fg-muted font-mono">{String(i + 1).padStart(2, "0")}</td>
                <td className="py-1.5 px-2 font-semibold" style={{ color: "#0B1220" }}>
                  {it.label}
                  {it.sku && (
                    <div className="font-mono text-[9px] text-fg-muted mt-0.5">{it.sku}</div>
                  )}
                </td>
                <td className="py-1.5 px-2 text-right tabular">{it.qty}</td>
                <td className="py-1.5 px-2 text-fg-secondary">{it.unit}</td>
                <td className="py-1.5 px-2 text-right tabular">{fmtCurrency(it.price)}</td>
                <td className="py-1.5 px-2 text-right tabular font-bold" style={{ color: "#050555" }}>
                  {fmtCurrency(it.subtotal)}
                </td>
              </tr>
            ))}
            {Array.from({ length: filler }).map((_, i) => (
              <tr key={`f-${i}`} className="border-b" style={{ borderColor: "#EEF1F6" }}>
                <td className="py-1.5 px-2 text-fg-muted/30 font-mono">
                  {String(items.length + i + 1).padStart(2, "0")}
                </td>
                <td className="py-1.5 px-2">&nbsp;</td>
                <td colSpan={4}>&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totales */}
        <div className="flex justify-end mt-3">
          <div className="text-[10px] min-w-[200px]">
            <div className="flex justify-between py-0.5">
              <span className="text-fg-secondary">Subtotal neto</span>
              <span className="tabular font-semibold">{fmtCurrency(neto)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-fg-secondary">IVA 21%</span>
              <span className="tabular">{fmtCurrency(iva)}</span>
            </div>
            <div
              className="flex justify-between pt-1 mt-1 text-[12px] font-bold"
              style={{ borderTop: "1.5px solid #050555", color: "#050555" }}
            >
              <span>TOTAL</span>
              <span className="tabular">{fmtCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Footer firma + recibido + QR */}
        <div className="absolute left-[38px] right-[38px] bottom-[26px] grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 100px" }}>
          <FooterCell label="Autorizado por">
            {signatureDataUrl ? (
              <img
                src={signatureDataUrl}
                alt="firma"
                style={{ maxHeight: 38, width: "100%", objectFit: "contain" }}
              />
            ) : po.signed_by ? (
              <div className="font-mono text-[18px] italic font-bold" style={{ color: "#050555" }}>
                José Luis
              </div>
            ) : (
              <div className="h-[24px] border-b border-dashed border-stroke-strong" />
            )}
            <div className="text-[9px] text-fg-primary font-semibold mt-1">{ORG.emitter.name}</div>
            <div className="text-[8px] text-fg-muted">{ORG.emitter.role}</div>
            {po.signed_at && (
              <div className="text-[8px] text-fg-muted mt-0.5">{fmtDateTime(po.signed_at)}</div>
            )}
          </FooterCell>
          <FooterCell label="Recibido y verificado por">
            {po.recibido_por ? (
              <>
                <div className="text-[10px] font-semibold">{po.recibido_por}</div>
                <div className="text-[9px] text-fg-muted">{fmtDateTime(po.recibido_at)}</div>
                {po.factura_id && (
                  <div className="font-mono text-[9px] text-fg-muted mt-0.5">
                    Factura {po.factura_id}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="h-[28px] border-b border-dashed border-stroke-strong" />
                <div className="text-[8px] text-fg-muted mt-1">Aclaración / DNI</div>
              </>
            )}
          </FooterCell>
          <FooterCell label="Validar OC">
            <div className="grid place-items-center w-[80px] h-[80px] mx-auto bg-white border border-stroke-soft rounded">
              {qrUrl ? (
                <img src={qrUrl} alt="QR" className="w-full h-full" />
              ) : (
                <Icon name="qr" size={64} />
              )}
            </div>
          </FooterCell>
        </div>

        {/* Hash disclaimer */}
        <div className="absolute left-[38px] right-[38px] bottom-[10px] text-[7px] text-fg-muted font-mono">
          SHA-256 {po.integrity_hash ?? "—"} · Drive {po.drive_file_id ?? "—"} · Generado por TOPS Compras
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-tops-red mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function KV({
  label,
  value,
  mono,
  strong,
  colSpan,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  colSpan?: number;
}) {
  return (
    <div style={colSpan ? { gridColumn: `span ${colSpan}` } : undefined}>
      <div className="text-[8px] uppercase tracking-[0.12em] font-bold text-fg-muted mb-0.5">
        {label}
      </div>
      <div
        className={[
          "text-[10px]",
          mono ? "font-mono" : "",
          strong ? "font-bold text-fg-brand" : "text-fg-primary",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

function FooterCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t pt-1.5" style={{ borderColor: "#DDE3EC" }}>
      <div className="text-[8px] font-bold uppercase tracking-[0.14em] text-fg-muted mb-1">{label}</div>
      {children}
    </div>
  );
}

