"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { fmtCurrency } from "@/lib/utils";
import { SUPPLIER_COMPROBANTE_LABEL, SUPPLIER_COMPROBANTE_VALUES } from "@/lib/erp/types";
import {
  mapOcrToInvoice,
  type Confidence,
  type InvoicePrefill,
  type VendorLite,
} from "@/lib/erp/ocr-map";
import type { ExtractedDocument } from "@/lib/ocr/types";
import { createSupplierInvoiceAction } from "./actions";
import { attachSupplierInvoiceFileAction } from "./ocr-actions";

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

// Campos que llevan badge de confianza tras un OCR.
type FieldKey =
  | "vendor"
  | "tipo"
  | "puntoVenta"
  | "numero"
  | "cae"
  | "fechaEmision"
  | "fechaVto"
  | "neto"
  | "iva"
  | "percepciones"
  | "observ";

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

  // --- OCR / archivo original ---------------------------------------
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>("idle");
  const [ocrMsg, setOcrMsg] = useState<string | null>(null);
  const [conf, setConf] = useState<Partial<Record<FieldKey, Confidence>>>({});
  const [notes, setNotes] = useState<Partial<Record<FieldKey, string>>>({});
  const [overall, setOverall] = useState<Confidence | null>(null);
  const [detectedVendor, setDetectedVendor] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const total = useMemo(
    () => (Number(neto) || 0) + (Number(iva) || 0) + (Number(percepciones) || 0),
    [neto, iva, percepciones]
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
    setNeto(p.neto.value);
    setIva(p.iva.value);
    setPercepciones(p.percepciones.value);
    if (p.observ.value) setObserv(p.observ.value);

    setConf({
      vendor: p.vendor.confidence,
      tipo: p.tipo.confidence,
      puntoVenta: p.puntoVenta.confidence,
      numero: p.numero.confidence,
      cae: p.cae.confidence,
      fechaEmision: p.fechaEmision.confidence,
      fechaVto: p.fechaVto.confidence,
      neto: p.neto.confidence,
      iva: p.iva.confidence,
      percepciones: p.percepciones.confidence,
      observ: p.observ.confidence,
    });
    setNotes({
      vendor: p.vendor.note,
      tipo: p.tipo.note,
      puntoVenta: p.puntoVenta.note,
      numero: p.numero.note,
      cae: p.cae.note,
      fechaEmision: p.fechaEmision.note,
      neto: p.neto.note,
    });
    setOverall(p.overall);
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
          // OCR no configurado: dejamos el archivo adjunto y carga manual.
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
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Best-effort: vincular el archivo original al registro recién creado.
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
              PDF, JPG, PNG o WebP · hasta {MAX_MB} MB · la IA precompleta y vos confirmás
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

        {/* Importes */}
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="field-label block mb-1.5">
              Neto * <ConfBadge c={conf.neto} note={notes.neto} />
            </label>
            <input className="input font-mono" inputMode="decimal" value={neto} onChange={(e) => setNeto(e.target.value)} placeholder="0.00" required />
          </div>
          <div>
            <label className="field-label block mb-1.5">
              IVA * <ConfBadge c={conf.iva} note={notes.iva} />
            </label>
            <input className="input font-mono" inputMode="decimal" value={iva} onChange={(e) => setIva(e.target.value)} placeholder="0.00" required />
          </div>
          <div>
            <label className="field-label block mb-1.5">
              Percepciones <ConfBadge c={conf.percepciones} note={notes.percepciones} />
            </label>
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
