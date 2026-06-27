"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PdfPreview } from "@/components/compras/PdfPreview";
import type { PurchaseOrder } from "@/lib/types-po";
import { fmtCurrency, fmtDate } from "@/lib/compras/format";
import { ORG } from "@/lib/org";

type Tab = "pdf" | "email" | "whatsapp" | "recon";

export function OrderDetailTabs({ po }: { po: PurchaseOrder }) {
  const [tab, setTab] = useState<Tab>("pdf");

  return (
    <>
      <div className="flex items-center justify-between px-5 py-3 border-b border-stroke-soft">
        <div>
          <div className="eyebrow-tiny">Vista previa · A4</div>
          <div className="text-sm font-bold text-fg-primary">Comprobante firmado</div>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-md bg-neutral-100">
          {(["pdf", "email", "whatsapp", "recon"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`btn btn-sm capitalize ${tab === t ? "btn-primary" : "btn-ghost border-none bg-transparent"}`}
            >
              {t === "pdf" && <Icon name="file-pdf" size={12} />}
              {t === "email" && <Icon name="mail" size={12} />}
              {t === "whatsapp" && <Icon name="whatsapp" size={12} />}
              {t === "recon" && <Icon name="check-circle" size={12} />}
              {t === "recon" ? "Conciliación" : t}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 md:p-6 bg-neutral-50">
        {tab === "pdf" && <PdfPreview po={po} className="max-w-[640px] mx-auto" />}
        {tab === "email" && <EmailMockup po={po} />}
        {tab === "whatsapp" && <WhatsappMockup po={po} />}
        {tab === "recon" && (
          <div className="max-w-[560px] mx-auto bg-white rounded-md shadow-md p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-status-success/10 text-status-success grid place-items-center">
                <Icon name="check-circle" size={20} />
              </div>
              <div>
                <div className="text-sm font-bold text-fg-primary">Conciliación de OC</div>
                <div className="text-[11px] text-fg-muted font-mono">{po.public_id}</div>
              </div>
            </div>
            <p className="text-sm text-fg-secondary leading-relaxed">
              Abrí el módulo de conciliación para cotejar esta orden contra la factura del proveedor,
              registrar diferencias y cerrar el ciclo de compra.
            </p>
            <Link
              href={`/compras/conciliacion/${po.public_id}`}
              className="btn btn-primary btn-sm self-start"
            >
              <Icon name="check-circle" size={14} />
              Abrir módulo de conciliación
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

function EmailMockup({ po }: { po: PurchaseOrder }) {
  return (
    <div className="max-w-[560px] mx-auto bg-white rounded-md shadow-md overflow-hidden">
      <div className="px-3 py-2 bg-neutral-100 border-b border-stroke-soft flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
        <span className="ml-3 text-[11px] text-fg-muted font-mono">{po.vendor?.email ?? "—"}</span>
      </div>
      <div className="px-5 py-4 border-b border-stroke-soft flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-tops-blue-900 text-white grid place-items-center font-bold">
          T
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-fg-primary">TOPS Compras</div>
          <div className="text-[11px] text-fg-muted">
            {ORG.emitter.email} → {po.vendor?.email}
          </div>
        </div>
        <div className="text-[11px] text-fg-muted">{fmtDate(po.signed_at ?? po.date)}</div>
      </div>
      <div className="px-5 py-4">
        <h3 className="text-base font-bold text-fg-brand mb-2">
          Orden de Compra {po.public_id} · {ORG.brand}
        </h3>
        <p className="text-sm text-fg-primary leading-relaxed mb-3">
          Estimado/a <b>{po.vendor?.contacto ?? po.vendor?.razon}</b>,<br />
          Adjuntamos la orden de compra firmada por nuestro {ORG.emitter.role}. Le solicitamos
          confirmación de recepción y coordinación de entrega.
        </p>
        <div className="grid grid-cols-2 gap-3 my-4 p-3 bg-neutral-50 rounded-md">
          <KV label="Orden" value={po.public_id} mono />
          <KV label="Fecha" value={fmtDate(po.date)} />
          <KV label="Cond. pago" value={po.cond_pago} />
          <KV label="Entrega" value={po.entrega ?? "—"} />
          <KV label="Items" value={String(po.items?.length ?? 0)} />
          <KV label="Total" value={fmtCurrency(po.total)} accent />
        </div>
        <a
          href={`/api/compras/${po.public_id}/pdf`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-2 bg-tops-red text-white font-bold px-4 py-2 rounded-md text-sm hover:opacity-90"
        >
          Ver Orden de Compra (PDF) →
        </a>
        <div className="mt-5 text-[11px] text-fg-muted">
          {ORG.emitter.name} · {ORG.emitter.role}
          <br />
          {ORG.legalName} · CUIT {ORG.cuit}
        </div>
      </div>
      <div className="px-5 py-3 bg-neutral-50 border-t border-stroke-soft flex items-center gap-3 text-[11px] text-fg-muted">
        <Icon name="paperclip" size={12} />
        <span>OC-{po.public_id}.pdf · 312 KB</span>
        <span className="text-fg-muted">|</span>
        <Icon name="paperclip" size={12} />
        <span>firma-{po.public_id}.png · 34 KB</span>
      </div>
    </div>
  );
}

function WhatsappMockup({ po }: { po: PurchaseOrder }) {
  return (
    <div className="max-w-[420px] mx-auto bg-[#ECE5DD] rounded-md p-4 shadow-md">
      <div className="bg-white rounded-lg p-3 max-w-[320px] ml-auto shadow-sm">
        <div className="text-xs text-fg-secondary mb-1">{ORG.brand}</div>
        <div className="text-sm text-fg-primary leading-snug whitespace-pre-line">
          {`Hola ${po.vendor?.contacto ?? po.vendor?.razon},
Te paso la OC ${po.public_id} firmada.

Total: ${fmtCurrency(po.total)}
Cond. pago: ${po.cond_pago}
Entrega: ${po.entrega ?? "—"}

PDF: ${typeof window !== "undefined" ? window.location.origin : ""}/api/compras/${po.public_id}/pdf

Saludos,
JL`}
        </div>
        <div className="text-[10px] text-fg-muted text-right mt-1">{fmtDate(po.signed_at ?? po.date)}</div>
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
