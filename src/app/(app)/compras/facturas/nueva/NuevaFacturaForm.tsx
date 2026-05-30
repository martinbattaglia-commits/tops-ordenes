"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { fmtCurrency } from "@/lib/utils";
import { SUPPLIER_COMPROBANTE_LABEL, SUPPLIER_COMPROBANTE_VALUES } from "@/lib/erp/types";
import { createSupplierInvoiceAction } from "./actions";

interface VendorOpt {
  id: string;
  razon: string;
  cuit: string;
}
interface CcOpt {
  id: string;
  code: string;
  name: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NuevaFacturaForm({
  vendors,
  costCenters,
}: {
  vendors: VendorOpt[];
  costCenters: CcOpt[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [vendorId, setVendorId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [tipo, setTipo] = useState<string>("FACTURA_A");
  const [puntoVenta, setPuntoVenta] = useState("1");
  const [numero, setNumero] = useState("");
  const [cae, setCae] = useState("");
  const [fechaEmision, setFechaEmision] = useState(today());
  const [fechaVto, setFechaVto] = useState("");
  const [neto, setNeto] = useState("");
  const [iva, setIva] = useState("");
  const [percepciones, setPercepciones] = useState("");
  const [observ, setObserv] = useState("");

  const total = useMemo(
    () => (Number(neto) || 0) + (Number(iva) || 0) + (Number(percepciones) || 0),
    [neto, iva, percepciones]
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createSupplierInvoiceAction({
        vendor_id: vendorId,
        cost_center_id: costCenterId || null,
        purchase_order_id: null,
        tipo_comprobante: tipo,
        punto_venta: Number(puntoVenta) || 0,
        numero,
        cae: cae || null,
        fecha_emision: fechaEmision,
        fecha_vencimiento: fechaVto || null,
        moneda: "ARS",
        neto: Number(neto) || 0,
        iva: Number(iva) || 0,
        percepciones: Number(percepciones) || 0,
        observ: observ || null,
      });
      if (res.ok) {
        router.push("/compras/facturas");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="card p-5 space-y-5"
    >
      {error && (
        <div className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
          {error}
        </div>
      )}

      {/* Proveedor + centro de costo */}
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="field-label block mb-1.5">Proveedor *</label>
          <select className="input appearance-none pr-8" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
            <option value="">Seleccioná un proveedor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.razon} · {v.cuit}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label block mb-1.5">Centro de costo</label>
          <select className="input appearance-none pr-8" value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
            <option value="">Sin imputar</option>
            {costCenters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Comprobante */}
      <div className="grid md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <label className="field-label block mb-1.5">Tipo de comprobante *</label>
          <select className="input appearance-none pr-8" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {SUPPLIER_COMPROBANTE_VALUES.map((t) => (
              <option key={t} value={t}>
                {SUPPLIER_COMPROBANTE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label block mb-1.5">Punto de venta *</label>
          <input className="input font-mono" inputMode="numeric" value={puntoVenta} onChange={(e) => setPuntoVenta(e.target.value)} required />
        </div>
        <div>
          <label className="field-label block mb-1.5">Número *</label>
          <input className="input font-mono" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="00012345" required />
        </div>
      </div>

      {/* Fechas + CAE */}
      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="field-label block mb-1.5">Fecha de emisión *</label>
          <input type="date" className="input" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} required />
        </div>
        <div>
          <label className="field-label block mb-1.5">Vencimiento</label>
          <input type="date" className="input" value={fechaVto} onChange={(e) => setFechaVto(e.target.value)} />
        </div>
        <div>
          <label className="field-label block mb-1.5">CAE</label>
          <input className="input font-mono" value={cae} onChange={(e) => setCae(e.target.value)} placeholder="Opcional" />
        </div>
      </div>

      {/* Importes */}
      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="field-label block mb-1.5">Neto *</label>
          <input className="input font-mono" inputMode="decimal" value={neto} onChange={(e) => setNeto(e.target.value)} placeholder="0.00" required />
        </div>
        <div>
          <label className="field-label block mb-1.5">IVA *</label>
          <input className="input font-mono" inputMode="decimal" value={iva} onChange={(e) => setIva(e.target.value)} placeholder="0.00" required />
        </div>
        <div>
          <label className="field-label block mb-1.5">Percepciones</label>
          <input className="input font-mono" inputMode="decimal" value={percepciones} onChange={(e) => setPercepciones(e.target.value)} placeholder="0.00" />
        </div>
      </div>

      <div>
        <label className="field-label block mb-1.5">Observaciones</label>
        <textarea className="input min-h-[72px]" value={observ} onChange={(e) => setObserv(e.target.value)} placeholder="Detalle, referencia de OC, etc." />
      </div>

      {/* Total + submit */}
      <div className="flex items-center justify-between pt-3 border-t border-stroke-soft">
        <div>
          <div className="text-eyebrow-sm uppercase text-fg-muted">Total comprobante</div>
          <div className="text-2xl font-bold text-fg-brand tabular">{fmtCurrency(total)}</div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending || !vendorId || !numero}>
          {pending ? (
            <>
              <Icon name="refresh" size={14} className="animate-spin" /> Registrando…
            </>
          ) : (
            <>
              <Icon name="check" size={14} stroke={2.2} /> Registrar factura
            </>
          )}
        </button>
      </div>
    </form>
  );
}
