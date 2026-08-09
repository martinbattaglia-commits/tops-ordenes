"use client";

import type { PurchaseOrder, POItem, Vendor } from "@/lib/types-po";
import { fmtCurrency, fmtDateTime, fmtCuit } from "@/lib/compras/format";
import { ORG } from "@/lib/org";
import { Icon } from "@/components/Icon";
import { DOC } from "@/lib/doc-system/tokens";

/**
 * Vista previa A4 — espejo HTML del PDF generado por @react-pdf/renderer
 * (PoPdfDocument, layout REF-OC del doc-system). Usado en wizard live-preview
 * y detalle. Colores desde los tokens del doc-system para evitar drift.
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
  const year = po.date ? String(new Date(po.date).getFullYear()) : String(new Date().getFullYear());

  return (
    <div className={className}>
      <div
        className="pdf-page bg-white relative overflow-hidden shadow-md flex flex-col"
        style={{
          aspectRatio: "1 / 1.414",
          color: DOC.ink,
          fontSize: 12,
          borderRadius: 4,
          boxShadow: "0 0 0 1px rgba(5,5,85,0.08), 0 12px 32px rgba(5,5,85,0.10)",
        }}
      >
        {/* Header banda navy */}
        <div
          className="flex items-start justify-between px-7 pt-4 pb-3"
          style={{ background: DOC.navy }}
        >
          <div>
            <img
              src="/icons/logo-white-transparent.png"
              alt="Logística TOPS"
              style={{ width: 54, height: 54, objectFit: "contain" }}
            />
            <div
              className="mt-1 font-semibold"
              style={{ color: DOC.onNavySoft, fontSize: 7, letterSpacing: "0.2em" }}
            >
              {ORG.legalName.toUpperCase()} · DESDE {ORG.since}
            </div>
          </div>
          <div className="text-right">
            <div
              className="font-bold uppercase"
              style={{ color: DOC.red, fontSize: 8, letterSpacing: "0.2em" }}
            >
              TOPS Compras
            </div>
            <div className="flex items-center justify-end gap-2 mt-1">
              <div
                className="font-extrabold text-right leading-tight"
                style={{ color: DOC.white, fontSize: 22 }}
              >
                ORDEN DE
                <br />
                COMPRA
              </div>
              <div
                className="rounded-sm px-1.5 py-1 text-center"
                style={{ background: DOC.white, color: DOC.navy }}
              >
                <div className="font-extrabold leading-none" style={{ fontSize: 14 }}>
                  OC
                </div>
                <div className="font-bold" style={{ fontSize: 6, letterSpacing: "0.06em" }}>
                  {year}
                </div>
              </div>
            </div>
            <div className="font-mono mt-1.5" style={{ color: DOC.white, fontSize: 9 }}>
              N.° {po.public_id ?? "OC-2026-XXXX"}
            </div>
          </div>
        </div>
        <div style={{ height: 4, background: DOC.red }} />

        <div className="px-7 pb-2 grow">
          <Section num="01" label="Datos de la orden">
            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(3, 1fr)", border: `1px solid ${DOC.rule}` }}
            >
              <GridCell>
                <KV label="Fecha de emisión" value={fmtDateTime(po.date ?? new Date())} mono />
              </GridCell>
              <GridCell>
                <KV label="Categoría" value={po.categoria ?? "—"} />
              </GridCell>
              <GridCell last>
                <KV label="Moneda" value="ARS" mono />
              </GridCell>
            </div>
          </Section>

          <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Section num="02" label="Emisor">
              <KV label="Razón social" value={ORG.legalName} strong />
              <div className="text-[10px] mt-0.5" style={{ color: DOC.textSec }}>
                {ORG.brand} · {ORG.iva}
              </div>
              <div className="text-[10px] mb-1" style={{ color: DOC.textSec }}>
                {ORG.address}
              </div>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
                <KV label="CUIT" value={fmtCuit(ORG.cuit)} mono />
                <KV label="Teléfonos" value={ORG.phone} mono />
              </div>
            </Section>
            <Section num="03" label="Proveedor">
              <KV label="Razón social" value={po.vendor?.razon ?? "—"} strong />
              <KV label="Domicilio" value={po.vendor?.domicilio ?? "—"} />
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <KV label="CUIT" value={fmtCuit(po.vendor?.cuit ?? "")} mono />
                <KV label="Teléfono" value={po.vendor?.telefono ?? "—"} />
                <KV label="Contacto" value={po.vendor?.contacto ?? "—"} />
                <KV label="Email" value={po.vendor?.email ?? "—"} />
              </div>
            </Section>
          </div>

          <Section num="04" label="Destino y condiciones">
            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(3, 1fr)", border: `1px solid ${DOC.rule}` }}
            >
              <GridCell>
                <KV label="Destino" value={po.destino ?? "—"} />
              </GridCell>
              <GridCell>
                <KV label="Cond. de pago" value={po.cond_pago ?? "—"} />
              </GridCell>
              <GridCell last>
                <KV label="Entrega" value={po.entrega ?? "—"} />
              </GridCell>
            </div>
          </Section>

          <Section num="05" label="Detalle de productos y servicios">
            <table className="w-full text-[10px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${DOC.navy}` }}>
                  <Th className="text-left w-8">N.°</Th>
                  <Th className="text-left">Producto / Servicio</Th>
                  <Th className="text-right w-12">Cant.</Th>
                  <Th className="text-center w-10">Un.</Th>
                  <Th className="text-right w-20">P. Unitario</Th>
                  <Th className="text-right w-24">Subtotal</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${DOC.rule}` }}>
                    <td className="py-1.5 font-mono" style={{ color: DOC.labelSoft }}>
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td className="py-1.5 font-semibold">
                      {it.label}
                      {it.sku && (
                        <span className="font-mono text-[9px] ml-1" style={{ color: DOC.labelSoft }}>
                          ({it.sku})
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right font-mono">{it.qty}</td>
                    <td className="py-1.5 text-center" style={{ color: DOC.textSec }}>
                      {it.unit}
                    </td>
                    <td className="py-1.5 text-right font-mono">{fmtCurrency(it.price)}</td>
                    <td
                      className="py-1.5 text-right font-mono font-semibold"
                      style={{ color: DOC.navy }}
                    >
                      {fmtCurrency(it.subtotal)}
                    </td>
                  </tr>
                ))}
                {Array.from({ length: filler }).map((_, i) => (
                  <tr key={`f-${i}`} style={{ borderBottom: `1px solid ${DOC.ruleSoft}` }}>
                    <td className="py-1.5 font-mono opacity-30">
                      {String(items.length + i + 1).padStart(2, "0")}
                    </td>
                    <td colSpan={5}>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {po.observ && (
            <Section num="06" label="Observaciones">
              <div className="text-[10px]" style={{ color: DOC.textSec }}>
                {po.observ}
              </div>
            </Section>
          )}

          <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Section num={po.observ ? "07" : "06"} label="Autorizaciones">
              <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <Label>Autorizado por</Label>
                  {signatureDataUrl ? (
                    <img
                      src={signatureDataUrl}
                      alt="firma"
                      style={{ maxHeight: 30, objectFit: "contain" }}
                    />
                  ) : (
                    <div style={{ height: 30 }} />
                  )}
                  <div className="pt-0.5" style={{ borderTop: `1px solid ${DOC.ink}` }}>
                    <div className="text-[9px] font-bold">{ORG.emitter.name}</div>
                    <div className="text-[8px]" style={{ color: DOC.labelSoft }}>
                      {ORG.emitter.role}
                    </div>
                    {po.signed_at && (
                      <div className="text-[8px]" style={{ color: DOC.labelSoft }}>
                        {fmtDateTime(po.signed_at)}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <Label>Recibido y verificado</Label>
                  <div style={{ height: 30 }} />
                  <div className="pt-0.5" style={{ borderTop: `1px solid ${DOC.ink}` }}>
                    {po.recibido_por ? (
                      <>
                        <div className="text-[9px] font-bold">{po.recibido_por}</div>
                        {po.recibido_at && (
                          <div className="text-[8px]" style={{ color: DOC.labelSoft }}>
                            {fmtDateTime(po.recibido_at)}
                          </div>
                        )}
                        {po.factura_id && (
                          <div className="font-mono text-[8px]" style={{ color: DOC.labelSoft }}>
                            Factura {po.factura_id}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-[8px]" style={{ color: DOC.label }}>
                        Aclaración / DNI / fecha
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Section>
            <Section num={po.observ ? "08" : "07"} label="Resumen">
              <div
                className="flex justify-between py-1 text-[10px]"
                style={{ borderBottom: `1px solid ${DOC.rule}` }}
              >
                <span style={{ color: DOC.textSec }}>Subtotal neto</span>
                <span className="font-mono">{fmtCurrency(neto)}</span>
              </div>
              <div
                className="flex justify-between py-1 text-[10px]"
                style={{ borderBottom: `1px solid ${DOC.rule}` }}
              >
                <span style={{ color: DOC.textSec }}>IVA 21%</span>
                <span className="font-mono">{fmtCurrency(iva)}</span>
              </div>
              <div
                className="flex items-center justify-between mt-2 px-3 py-2.5"
                style={{ background: DOC.navy }}
              >
                <div>
                  <div
                    className="font-extrabold"
                    style={{ color: DOC.red, fontSize: 8, letterSpacing: "0.16em" }}
                  >
                    TOTAL
                  </div>
                  <div style={{ color: DOC.onNavySoft, fontSize: 6.5, letterSpacing: "0.1em" }}>
                    PESOS ARGENTINOS
                  </div>
                </div>
                <div className="font-mono font-bold" style={{ color: DOC.white, fontSize: 16 }}>
                  {fmtCurrency(total)}
                </div>
              </div>
            </Section>
          </div>

          <Section num={po.observ ? "09" : "08"} label="Validación documental">
            <div className="flex gap-4">
              <div className="text-center w-[70px]">
                <div
                  className="grid place-items-center w-[62px] h-[62px] bg-white mx-auto"
                  style={{ border: `1px solid ${DOC.ruleSoft}` }}
                >
                  {qrUrl ? (
                    <img src={qrUrl} alt="QR" className="w-full h-full" />
                  ) : (
                    <Icon name="qr" size={48} />
                  )}
                </div>
                <div
                  className="mt-0.5 font-bold uppercase"
                  style={{ color: DOC.labelSoft, fontSize: 6, letterSpacing: "0.16em" }}
                >
                  Validar OC
                </div>
              </div>
              <div className="grow">
                <KV label="Hash SHA-256" value={po.integrity_hash ?? "—"} mono small />
                <KV label="Drive" value={po.drive_file_id ?? "—"} mono small />
                <div className="mt-1 pl-2" style={{ borderLeft: `3px solid ${DOC.red}` }}>
                  <div
                    className="font-extrabold uppercase"
                    style={{ color: DOC.red, fontSize: 8, letterSpacing: "0.08em" }}
                  >
                    Generado por TOPS Compras
                  </div>
                  <div className="text-[8px] leading-relaxed" style={{ color: DOC.textSec }}>
                    Documento interno de compras. La recepción de mercadería o servicio debe
                    verificarse contra esta orden antes de conformar la factura del proveedor.
                  </div>
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* Footer banda navy */}
        <div
          className="flex items-center justify-between px-7 py-2.5"
          style={{ background: DOC.navy }}
        >
          <div>
            <div
              className="font-extrabold uppercase"
              style={{ color: DOC.white, fontSize: 8, letterSpacing: "0.14em" }}
            >
              Logística TOPS
            </div>
            <div style={{ color: DOC.onNavySoft, fontSize: 7 }}>
              Buenos Aires, Argentina · {ORG.website} · {ORG.phone}
            </div>
          </div>
          <div>
            <div
              className="font-extrabold uppercase"
              style={{ color: DOC.white, fontSize: 8, letterSpacing: "0.14em" }}
            >
              {ORG.legalName}
            </div>
            <div style={{ color: DOC.onNavySoft, fontSize: 7 }}>
              Orden de compra {po.public_id ?? "OC-2026-XXXX"} · TOPS Compras
            </div>
          </div>
          <div className="font-mono" style={{ color: DOC.onNavySoft, fontSize: 7 }}>
            Página 1 de 1
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  num,
  label,
  children,
}: {
  num: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div
        className="font-bold uppercase"
        style={{ color: DOC.red, fontSize: 9, letterSpacing: "0.14em" }}
      >
        {num} · {label}
      </div>
      <div className="mb-1.5 mt-0.5" style={{ height: 2, background: DOC.navy }} />
      {children}
    </div>
  );
}

function GridCell({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div
      className="px-2 py-1.5"
      style={last ? undefined : { borderRight: `1px solid ${DOC.rule}` }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-bold uppercase mb-0.5"
      style={{ color: DOC.label, fontSize: 8, letterSpacing: "0.12em" }}
    >
      {children}
    </div>
  );
}

function KV({
  label,
  value,
  mono,
  strong,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  small?: boolean;
}) {
  return (
    <div className="mb-1">
      <Label>{label}</Label>
      <div
        className={[small ? "text-[8px]" : "text-[10px]", mono ? "font-mono" : "", strong ? "font-bold" : ""].join(" ")}
        style={{ color: strong ? DOC.navy : DOC.ink, wordBreak: "break-all" }}
      >
        {value}
      </div>
    </div>
  );
}

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <th
      className={`py-1 font-bold uppercase ${className ?? ""}`}
      style={{ color: DOC.label, fontSize: 8, letterSpacing: "0.1em" }}
    >
      {children}
    </th>
  );
}
