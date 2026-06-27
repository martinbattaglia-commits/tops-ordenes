"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { fmtCurrency } from "@/lib/utils";
import { SUPPLIER_COMPROBANTE_LABEL, SUPPLIER_COMPROBANTE_VALUES } from "@/lib/erp/types";
import {
  mapOcrToInvoice,
  alicuotaToId,
  type Confidence,
  type InvoicePrefill,
  type ItemPrefill,
  type VendorLite,
} from "@/lib/erp/ocr-map";
import type { ExtractedDocument } from "@/lib/ocr/types";
import { createSupplierInvoiceAction } from "./actions";
import { attachSupplierInvoiceFileAction } from "./ocr-actions";
import { RetenciongananciasPanel } from "@/components/compras/RetenciongananciasPanel";

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

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const MAX_MB = 12;

type OcrStatus = "idle" | "uploading" | "done" | "error" | "unsupported";

// Campos de cabecera que llevan badge de confianza tras un OCR.
type FieldKey =
  | "vendor"
  | "tipo"
  | "puntoVenta"
  | "numero"
  | "cae"
  | "fechaEmision"
  | "fechaVto"
  | "fiscal"
  | "observ";

// Alícuotas AFIP seleccionables.
const ALICUOTA_OPTIONS = ["21", "10.5", "27", "5", "2.5", "0"];
const OTHER_TAX_OPTIONS: { value: string; label: string }[] = [
  { value: "PERCEPCION_IVA", label: "Percepción IVA" },
  { value: "PERCEPCION_IIBB", label: "Percepción IIBB" },
  { value: "PERCEPCION_GANANCIAS", label: "Percepción Ganancias" },
  { value: "IMPUESTO_INTERNO", label: "Impuesto interno" },
  { value: "OTRO", label: "Otro" },
];

interface VatRow {
  alicuota: string;
  baseNeto: string;
  importeIva: string;
}
interface OtherRow {
  kind: string;
  jurisdiction: string;
  base: string;
  alicuota: string;
  importe: string;
}

const CONF_META: Record<Confidence, { label: string; cls: string } | null> = {
  alta: { label: "Alta", cls: "bg-status-success/12 text-status-success" },
  media: { label: "Media", cls: "bg-status-warning/15 text-status-warning" },
  baja: { label: "Revisar", cls: "bg-status-danger/12 text-status-danger" },
  vacio: null,
};

function ConfBadge({ c, note }: { c?: Confidence; note?: string }) {
  if (!c) return null;
  const meta = CONF_META[c];
  if (!meta) return null;
  return (
    <span
      title={note}
      className={`ml-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${meta.cls}`}
    >
      <Icon name="sparkle" size={9} aria-hidden /> {meta.label}
    </span>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  const [observ, setObserv] = useState("");

  // --- Detalle fiscal (ERP-B2) ---
  const [vatRows, setVatRows] = useState<VatRow[]>([{ alicuota: "21", baseNeto: "", importeIva: "" }]);
  const [otherRows, setOtherRows] = useState<OtherRow[]>([]);
  const [noGravado, setNoGravado] = useState("");
  const [exento, setExento] = useState("");
  const [items, setItems] = useState<ItemPrefill[]>([]);

  // --- OCR / archivo original ---------------------------------------
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>("idle");
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | undefined>(undefined);
  const [ocrMsg, setOcrMsg] = useState<string | null>(null);
  const [conf, setConf] = useState<Partial<Record<FieldKey, Confidence>>>({});
  const [notes, setNotes] = useState<Partial<Record<FieldKey, string>>>({});
  const [overall, setOverall] = useState<Confidence | null>(null);
  const [detectedVendor, setDetectedVendor] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // --- Totales derivados del detalle (identidad B1) ---
  const netoGravado = useMemo(
    () => round2(vatRows.reduce((s, r) => s + (Number(r.baseNeto) || 0), 0)),
    [vatRows]
  );
  const ivaTotal = useMemo(
    () => round2(vatRows.reduce((s, r) => s + (Number(r.importeIva) || 0), 0)),
    [vatRows]
  );
  const percepTotal = useMemo(
    () =>
      round2(
        otherRows
          .filter((r) => r.kind.startsWith("PERCEPCION_"))
          .reduce((s, r) => s + (Number(r.importe) || 0), 0)
      ),
    [otherRows]
  );
  const tributosTotal = useMemo(
    () =>
      round2(
        otherRows
          .filter((r) => r.kind === "IMPUESTO_INTERNO" || r.kind === "OTRO")
          .reduce((s, r) => s + (Number(r.importe) || 0), 0)
      ),
    [otherRows]
  );
  const total = useMemo(
    () => round2(netoGravado + (Number(noGravado) || 0) + (Number(exento) || 0) + ivaTotal + percepTotal + tributosTotal),
    [netoGravado, noGravado, exento, ivaTotal, percepTotal, tributosTotal]
  );

  // Liberar el object URL al cambiar/desmontar.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function applyPrefill(p: InvoicePrefill) {
    if (p.vendor.id) setVendorId(p.vendor.id);
    setDetectedVendor(p.vendor.detectedName ?? p.vendor.detectedCuit ?? null);
    setTipo(p.tipo.value);
    setPuntoVenta(p.puntoVenta.value);
    setNumero(p.numero.value);
    setCae(p.cae.value);
    if (p.fechaEmision.value) setFechaEmision(p.fechaEmision.value);
    setFechaVto(p.fechaVto.value);
    if (p.observ.value) setObserv(p.observ.value);

    // Detalle fiscal
    const fv = p.fiscal.vatLines.map((l) => ({
      alicuota: String(l.alicuota),
      baseNeto: l.baseNeto,
      importeIva: l.importeIva,
    }));
    setVatRows(fv.length ? fv : [{ alicuota: "21", baseNeto: "", importeIva: "" }]);
    setOtherRows(
      p.fiscal.otherTaxes.map((t) => ({
        kind: t.kind,
        jurisdiction: t.jurisdiction,
        base: t.base,
        alicuota: t.alicuota,
        importe: t.importe,
      }))
    );
    setNoGravado(p.fiscal.noGravado);
    setExento(p.fiscal.exento);
    setItems(p.fiscal.items);

    setConf({
      vendor: p.vendor.confidence,
      tipo: p.tipo.confidence,
      puntoVenta: p.puntoVenta.confidence,
      numero: p.numero.confidence,
      cae: p.cae.confidence,
      fechaEmision: p.fechaEmision.confidence,
      fechaVto: p.fechaVto.confidence,
      fiscal: p.fiscal.confidence,
      observ: p.observ.confidence,
    });
    setNotes({
      vendor: p.vendor.note,
      tipo: p.tipo.note,
      puntoVenta: p.puntoVenta.note,
      numero: p.numero.note,
      cae: p.cae.note,
      fechaEmision: p.fechaEmision.note,
      fiscal: p.fiscal.note,
    });
    setOverall(p.overall);
  }

  // --- Edición de renglones de IVA ---
  function updateVatRow(i: number, patch: Partial<VatRow>) {
    setVatRows((rows) => {
      const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      // Si cambió base o alícuota, recalculamos el IVA del renglón.
      if (patch.baseNeto !== undefined || patch.alicuota !== undefined) {
        const r = next[i];
        const base = Number(r.baseNeto) || 0;
        const alic = Number(r.alicuota) || 0;
        next[i] = { ...r, importeIva: base > 0 ? round2((base * alic) / 100).toFixed(2) : r.importeIva };
      }
      return next;
    });
  }
  function addVatRow() {
    const used = new Set(vatRows.map((r) => r.alicuota));
    const free = ALICUOTA_OPTIONS.find((a) => !used.has(a)) ?? "10.5";
    setVatRows((r) => [...r, { alicuota: free, baseNeto: "", importeIva: "" }]);
  }
  function removeVatRow(i: number) {
    setVatRows((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : r));
  }

  // --- Edición de percepciones / tributos ---
  function updateOtherRow(i: number, patch: Partial<OtherRow>) {
    setOtherRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addOtherRow() {
    setOtherRows((r) => [...r, { kind: "PERCEPCION_IIBB", jurisdiction: "", base: "", alicuota: "", importe: "" }]);
  }
  function removeOtherRow(i: number) {
    setOtherRows((r) => r.filter((_, idx) => idx !== i));
  }

  async function runOcr(f: File) {
    setOcrStatus("uploading");
    setOcrMsg(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/documental/ocr", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 503) {
          setOcrStatus("unsupported");
          setOcrMsg("OCR no disponible en este entorno. Cargá los datos manualmente; el archivo quedará vinculado igual.");
          return;
        }
        setOcrStatus("error");
        setOcrMsg(json?.error || `No se pudo leer el documento (${res.status}).`);
        return;
      }

      const doc = json?.document as ExtractedDocument | undefined;
      if (!doc) {
        setOcrStatus("error");
        setOcrMsg("La lectura no devolvió datos.");
        return;
      }
      const prefill = mapOcrToInvoice(doc, vendors as VendorLite[]);
      applyPrefill(prefill);
      setOcrStatus("done");
    } catch (e) {
      setOcrStatus("error");
      setOcrMsg(e instanceof Error ? e.message : "Error al procesar el archivo.");
    }
  }

  function acceptFile(f: File) {
    if (f.size > MAX_MB * 1024 * 1024) {
      setOcrStatus("error");
      setOcrMsg(`El archivo supera ${MAX_MB} MB.`);
      return;
    }
    if (!ACCEPT.split(",").includes(f.type)) {
      setOcrStatus("error");
      setOcrMsg("Formato no soportado. Usá PDF, JPG, PNG o WebP.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    void runOcr(f);
  }

  function clearFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setOcrStatus("idle");
    setOcrMsg(null);
    setConf({});
    setNotes({});
    setOverall(null);
    setDetectedVendor(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  // Validación de cliente (espejo del RPC; el RPC es la autoridad final).
  function clientValidate(): string | null {
    if (!vendorId) return "Seleccioná un proveedor.";
    if (!numero) return "El número de comprobante es obligatorio.";
    const activeVat = vatRows.filter((r) => Number(r.baseNeto) > 0 || Number(r.importeIva) > 0);
    const hasFiscal = activeVat.length > 0 || otherRows.some((r) => Number(r.importe) > 0) || Number(noGravado) > 0 || Number(exento) > 0;
    if (!hasFiscal) return "Cargá al menos un renglón de IVA o un concepto no gravado/exento.";
    // V1: par AFIP válido por renglón
    for (const r of activeVat) {
      if (alicuotaToId(Number(r.alicuota)) === null) return `Alícuota ${r.alicuota}% no es válida para AFIP.`;
      // V2: IVA coherente
      const base = Number(r.baseNeto) || 0;
      const expected = round2((base * Number(r.alicuota)) / 100);
      if (Math.abs((Number(r.importeIva) || 0) - expected) > 0.05)
        return `El IVA del renglón ${r.alicuota}% no coincide con base × alícuota.`;
    }
    // V4: alícuotas únicas
    if (new Set(activeVat.map((r) => r.alicuota)).size !== activeVat.length)
      return "Hay renglones de IVA repetidos para la misma alícuota; consolidalos.";
    // V5: IIBB exige jurisdicción
    for (const r of otherRows) {
      if (r.kind === "PERCEPCION_IIBB" && !r.jurisdiction.trim())
        return "La percepción de IIBB requiere jurisdicción (provincia).";
    }
    return null;
  }

  function submit() {
    setError(null);
    const v = clientValidate();
    if (v) {
      setError(v);
      return;
    }
    startTransition(async () => {
      const activeVat = vatRows.filter((r) => Number(r.baseNeto) > 0 || Number(r.importeIva) > 0);
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
        importe_no_gravado: Number(noGravado) || 0,
        importe_exento: Number(exento) || 0,
        observ: observ || null,
        vat_lines: activeVat.map((r) => ({
          alic_iva_id: alicuotaToId(Number(r.alicuota)) ?? 5,
          alicuota_iva: Number(r.alicuota) || 0,
          base_neto: Number(r.baseNeto) || 0,
          importe_iva: Number(r.importeIva) || 0,
        })),
        other_taxes: otherRows
          .filter((r) => Number(r.importe) > 0)
          .map((r) => ({
            tax_kind: r.kind as "PERCEPCION_IVA" | "PERCEPCION_IIBB" | "PERCEPCION_GANANCIAS" | "IMPUESTO_INTERNO" | "OTRO",
            jurisdiction: r.jurisdiction || null,
            base: r.base ? Number(r.base) : null,
            alicuota: r.alicuota ? Number(r.alicuota) : null,
            importe: Number(r.importe) || 0,
          })),
        items: items.map((it, i) => ({
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad) || 1,
          precio_unitario: Number(it.precioUnitario) || 0,
          alic_iva_id: it.alicIvaId,
          importe_neto: Number(it.importeNeto) || 0,
          importe_iva: Number(it.importeIva) || 0,
          importe_total: Number(it.importeTotal) || 0,
          orden: i,
        })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.id) setCreatedInvoiceId(res.id);
      if (file && res.id) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          await attachSupplierInvoiceFileAction(res.id, fd);
        } catch {
          // El adjunto nunca bloquea: la factura ya quedó registrada.
        }
      }
      router.push("/compras/facturas");
      router.refresh();
    });
  }

  const isImage = file?.type.startsWith("image/");
  const isPdf = file?.type === "application/pdf";
  const usingOcr = ocrStatus !== "idle";
  const ocrBusy = ocrStatus === "uploading";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5"
    >
      {/* ---------- Cargador OCR (drag & drop + cámara móvil) ---------- */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="wand" size={16} className="text-fg-brand" />
          <h2 className="text-sm font-bold text-fg-primary">Cargar factura (lectura automática)</h2>
        </div>

        {!file ? (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) acceptFile(f);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
              dragOver ? "border-fg-brand bg-fg-brand/5" : "border-stroke-soft hover:border-fg-brand/50 hover:bg-neutral-50"
            }`}
          >
            <Icon name="download" size={22} className="text-fg-muted rotate-180" />
            <span className="text-sm font-semibold text-fg-primary">
              Arrastrá el PDF o foto, o tocá para elegir
            </span>
            <span className="text-[11px] text-fg-muted">
              PDF, JPG, PNG o WebP · hasta {MAX_MB} MB · la IA precompleta el IVA por alícuota y vos confirmás
            </span>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) acceptFile(f);
              }}
            />
          </label>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {/* Preview */}
            <div className="rounded-lg border border-stroke-soft overflow-hidden bg-neutral-50">
              <div className="flex items-center justify-between px-3 py-2 border-b border-stroke-soft bg-white">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name={isPdf ? "file-pdf" : "eye"} size={14} className="text-fg-muted flex-shrink-0" />
                  <span className="text-[11px] text-fg-secondary truncate">{file.name}</span>
                </div>
                <button type="button" onClick={clearFile} className="btn btn-ghost btn-sm flex-shrink-0" title="Quitar archivo">
                  <Icon name="x" size={12} />
                </button>
              </div>
              {previewUrl && isImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="Vista previa de la factura" className="w-full max-h-[280px] object-contain" />
              )}
              {previewUrl && isPdf && (
                <iframe title="Vista previa de la factura" src={previewUrl} className="w-full h-[280px]" />
              )}
            </div>

            {/* Estado de la lectura */}
            <div className="flex flex-col justify-center gap-2">
              {ocrBusy && (
                <div className="flex items-center gap-2 text-sm text-fg-secondary">
                  <Icon name="refresh" size={14} className="animate-spin" /> Leyendo el documento…
                </div>
              )}
              {ocrStatus === "done" && (
                <>
                  <div className="flex items-center gap-2 text-sm font-semibold text-status-success">
                    <Icon name="check-circle" size={16} /> Datos precompletados
                    {overall && <ConfBadge c={overall} note="Confianza global de la lectura" />}
                  </div>
                  <p className="text-[11px] text-fg-muted leading-relaxed">
                    Revisá cada campo abajo. Las etiquetas indican la confianza de la IA. Nada se guarda hasta que confirmes.
                  </p>
                  {detectedVendor && !vendorId && (
                    <p className="text-[11px] text-status-warning">
                      Proveedor detectado: <strong>{detectedVendor}</strong> — seleccionalo en la lista.
                    </p>
                  )}
                </>
              )}
              {ocrStatus === "unsupported" && (
                <div className="flex items-start gap-2 text-[12px] text-fg-secondary">
                  <Icon name="bolt" size={14} className="text-status-warning flex-shrink-0 mt-0.5" />
                  <span>{ocrMsg}</span>
                </div>
              )}
              {ocrStatus === "error" && (
                <div className="flex items-start gap-2 text-[12px] text-status-danger">
                  <Icon name="x" size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{ocrMsg}</span>
                  <button type="button" onClick={() => file && runOcr(file)} className="underline ml-1">
                    Reintentar
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---------- Formulario (precompletado y editable) ---------- */}
      <div className="card p-5 space-y-5">
        {error && (
          <div className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
            {error}
          </div>
        )}

        {/* Proveedor + centro de costo */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="field-label block mb-1.5">
              Proveedor * <ConfBadge c={conf.vendor} note={notes.vendor} />
            </label>
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
            <label className="field-label block mb-1.5">
              Tipo de comprobante * <ConfBadge c={conf.tipo} note={notes.tipo} />
            </label>
            <select className="input appearance-none pr-8" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {SUPPLIER_COMPROBANTE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {SUPPLIER_COMPROBANTE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label block mb-1.5">
              Punto de venta * <ConfBadge c={conf.puntoVenta} note={notes.puntoVenta} />
            </label>
            <input className="input font-mono" inputMode="numeric" value={puntoVenta} onChange={(e) => setPuntoVenta(e.target.value)} required />
          </div>
          <div>
            <label className="field-label block mb-1.5">
              Número * <ConfBadge c={conf.numero} note={notes.numero} />
            </label>
            <input className="input font-mono" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="00012345" required />
          </div>
        </div>

        {/* Fechas + CAE */}
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="field-label block mb-1.5">
              Fecha de emisión * <ConfBadge c={conf.fechaEmision} note={notes.fechaEmision} />
            </label>
            <input type="date" className="input" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} required />
          </div>
          <div>
            <label className="field-label block mb-1.5">
              Vencimiento <ConfBadge c={conf.fechaVto} note={notes.fechaVto} />
            </label>
            <input type="date" className="input" value={fechaVto} onChange={(e) => setFechaVto(e.target.value)} />
          </div>
          <div>
            <label className="field-label block mb-1.5">
              CAE <ConfBadge c={conf.cae} note={notes.cae} />
            </label>
            <input className="input font-mono" value={cae} onChange={(e) => setCae(e.target.value)} placeholder="Opcional" />
          </div>
        </div>

        {/* ---------- IVA por alícuota ---------- */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="field-label">
              IVA por alícuota * <ConfBadge c={conf.fiscal} note={notes.fiscal} />
            </label>
            <button type="button" onClick={addVatRow} className="btn btn-ghost btn-sm">
              <Icon name="plus" size={12} /> Agregar alícuota
            </button>
          </div>
          <div className="space-y-2">
            {vatRows.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <select
                  className="input appearance-none col-span-3"
                  value={r.alicuota}
                  onChange={(e) => updateVatRow(i, { alicuota: e.target.value })}
                >
                  {ALICUOTA_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}%
                    </option>
                  ))}
                </select>
                <input
                  className="input font-mono col-span-4"
                  inputMode="decimal"
                  value={r.baseNeto}
                  onChange={(e) => updateVatRow(i, { baseNeto: e.target.value })}
                  placeholder="Base neta"
                  aria-label="Base neta"
                />
                <input
                  className="input font-mono col-span-4"
                  inputMode="decimal"
                  value={r.importeIva}
                  onChange={(e) => updateVatRow(i, { importeIva: e.target.value })}
                  placeholder="IVA"
                  aria-label="Importe IVA"
                />
                <button
                  type="button"
                  onClick={() => removeVatRow(i)}
                  className="btn btn-ghost btn-sm col-span-1 text-status-danger"
                  title="Quitar renglón"
                  disabled={vatRows.length <= 1}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-fg-muted">
            Neto gravado <strong className="tabular">{fmtCurrency(netoGravado)}</strong> · IVA{" "}
            <strong className="tabular">{fmtCurrency(ivaTotal)}</strong>. El IVA se recalcula al editar base o alícuota; podés ajustarlo.
          </p>
        </div>

        {/* ---------- No gravado / exento ---------- */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="field-label block mb-1.5">No gravado</label>
            <input className="input font-mono" inputMode="decimal" value={noGravado} onChange={(e) => setNoGravado(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="field-label block mb-1.5">Exento</label>
            <input className="input font-mono" inputMode="decimal" value={exento} onChange={(e) => setExento(e.target.value)} placeholder="0.00" />
          </div>
        </div>

        {/* ---------- Percepciones / tributos ---------- */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="field-label">Percepciones y otros tributos</label>
            <button type="button" onClick={addOtherRow} className="btn btn-ghost btn-sm">
              <Icon name="plus" size={12} /> Agregar percepción
            </button>
          </div>
          {otherRows.length === 0 && (
            <p className="text-[11px] text-fg-muted">Sin percepciones. Agregá si el comprobante las incluye (IVA, IIBB, Ganancias…).</p>
          )}
          <div className="space-y-2">
            {otherRows.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <select
                  className="input appearance-none col-span-4"
                  value={r.kind}
                  onChange={(e) => updateOtherRow(i, { kind: e.target.value })}
                >
                  {OTHER_TAX_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  className="input col-span-4"
                  value={r.jurisdiction}
                  onChange={(e) => updateOtherRow(i, { jurisdiction: e.target.value })}
                  placeholder={r.kind === "PERCEPCION_IIBB" ? "Provincia *" : "Jurisdicción"}
                  aria-label="Jurisdicción"
                />
                <input
                  className="input font-mono col-span-3"
                  inputMode="decimal"
                  value={r.importe}
                  onChange={(e) => updateOtherRow(i, { importe: e.target.value })}
                  placeholder="Importe"
                  aria-label="Importe percepción"
                />
                <button
                  type="button"
                  onClick={() => removeOtherRow(i)}
                  className="btn btn-ghost btn-sm col-span-1 text-status-danger"
                  title="Quitar percepción"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>
          {(percepTotal > 0 || tributosTotal > 0) && (
            <p className="text-[10px] text-fg-muted">
              Percepciones <strong className="tabular">{fmtCurrency(percepTotal)}</strong> · Tributos{" "}
              <strong className="tabular">{fmtCurrency(tributosTotal)}</strong>
            </p>
          )}
        </div>

        <div>
          <label className="field-label block mb-1.5">Observaciones</label>
          <textarea className="input min-h-[72px]" value={observ} onChange={(e) => setObserv(e.target.value)} placeholder="Detalle, referencia de OC, etc." />
        </div>

        {/* ---------- Retención de Ganancias ---------- */}
        {vendorId && netoGravado > 0 && (
          <RetenciongananciasPanel
            tipoComprobante={tipo}
            netoGravado={netoGravado}
            totalFactura={total}
            vendorId={vendorId}
            fechaEmision={fechaEmision}
            supplierInvoiceId={createdInvoiceId}
          />
        )}

        {/* Total + submit */}
        <div className="flex items-center justify-between pt-3 border-t border-stroke-soft">
          <div>
            <div className="text-eyebrow-sm uppercase text-fg-muted">Total comprobante</div>
            <div className="text-2xl font-bold text-fg-brand tabular">{fmtCurrency(total)}</div>
            {items.length > 0 && (
              <div className="text-[10px] text-fg-muted">{items.length} renglón{items.length === 1 ? "" : "es"} de detalle detectado{items.length === 1 ? "" : "s"}</div>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={pending || ocrBusy || !vendorId || !numero}>
            {pending ? (
              <>
                <Icon name="refresh" size={14} className="animate-spin" /> Guardando…
              </>
            ) : (
              <>
                <Icon name="check" size={14} stroke={2.2} /> {usingOcr ? "Confirmar y guardar" : "Registrar factura"}
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
