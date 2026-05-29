"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { ExtractedDocument } from "@/lib/ocr/types";
import { processDocumentAction, type ProcessResult } from "./actions";

/**
 * Componente cliente para subir documentos al Centro Documental.
 *
 * Flow:
 *  1. Usuario arrastra/selecciona PDF o imagen
 *  2. Server action sube a Storage + ejecuta OCR con OpenAI
 *  3. Mostramos resultado estructurado (tipo, fecha, partes, montos, tags)
 *  4. Doc queda persistido en `public.documents` con extract JSON
 */
export function UploadDocument() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submitFile = (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      setResult({ ok: false, error: "Archivo > 20 MB no soportado" });
      return;
    }
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    start(async () => {
      const res = await processDocumentAction(fd);
      setResult(res);
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) submitFile(file);
  };

  const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) submitFile(file);
    e.target.value = ""; // permite re-seleccionar el mismo archivo
  };

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          "card p-8 border-2 border-dashed cursor-pointer transition-all text-center",
          dragOver
            ? "border-tops-blue-700 bg-tops-blue-700/5"
            : "border-stroke-strong hover:border-tops-blue-700 hover:bg-neutral-50",
          pending ? "opacity-60 pointer-events-none" : "",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          onChange={onSelect}
          className="hidden"
        />
        {pending ? (
          <div className="flex flex-col items-center gap-3">
            <Icon name="refresh" size={28} className="text-tops-blue-700 animate-spin" />
            <div>
              <div className="text-sm font-bold text-fg-primary">Procesando con OpenAI…</div>
              <div className="text-[11px] text-fg-muted mt-0.5">
                Extrayendo texto + clasificando + extrayendo estructura
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-tops-blue-700/10 text-tops-blue-700 grid place-items-center">
              <Icon name="paperclip" size={26} />
            </div>
            <div>
              <div className="text-sm font-bold text-fg-primary">
                Arrastrá un PDF o imagen acá
              </div>
              <div className="text-[11px] text-fg-muted mt-0.5">
                Factura, remito, contrato, habilitación, certificado, presupuesto…
                <br />
                Máx. 20 MB · OCR automático con GPT-4o-mini
              </div>
            </div>
            <button type="button" className="btn btn-primary btn-sm">
              <Icon name="plus" size={14} stroke={2.2} />
              Seleccionar archivo
            </button>
          </div>
        )}
      </div>

      {/* Resultado */}
      {result && <ResultPanel result={result} onReset={() => setResult(null)} />}
    </div>
  );
}

function ResultPanel({ result, onReset }: { result: ProcessResult; onReset: () => void }) {
  if (!result.ok) {
    return (
      <div className="card p-5 border-tops-red/30 bg-tops-red/5">
        <div className="flex items-start gap-3">
          <Icon name="x" size={20} className="text-tops-red mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-tops-red mb-1">No se pudo procesar</div>
            <div className="text-[12px] text-fg-secondary">{result.error}</div>
          </div>
          <button onClick={onReset} className="btn btn-ghost btn-sm">
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>
    );
  }

  const e = result.extract;
  return (
    <div className="card overflow-hidden border-status-success/30">
      <div className="px-5 py-4 border-b border-stroke-soft bg-status-success/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="check-circle" size={18} className="text-status-success" stroke={2} />
          <div>
            <div className="text-sm font-bold text-fg-primary">Documento procesado</div>
            <div className="text-[11px] text-fg-muted">
              ID: <span className="font-mono">{result.documentId.slice(0, 18)}</span>
              {" · "}
              {e.meta.tokensUsed} tokens · {e.meta.elapsedMs}ms · {e.meta.model}
            </div>
          </div>
        </div>
        <button onClick={onReset} className="btn btn-ghost btn-sm">
          Nuevo documento
        </button>
      </div>
      <div className="p-5 space-y-4">
        {/* Header con tipo + título */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-tops-red mb-1">
              {labelForType(e.type)} · confianza {Math.round(e.typeConfidence * 100)}%
            </div>
            <h3 className="text-xl font-bold text-fg-brand">{e.title ?? "(sin título)"}</h3>
            <p className="text-sm text-fg-secondary mt-1">{e.summary}</p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted bg-neutral-100 px-2 py-1 rounded">
            {e.meta.sourceKind}
          </span>
        </div>

        {/* Fechas */}
        {(e.date || e.expiresAt) && (
          <div className="grid grid-cols-2 gap-3">
            {e.date && <KV label="Fecha emisión" value={e.date} />}
            {e.expiresAt && (
              <KV label="Vence" value={e.expiresAt} accent="warning" />
            )}
          </div>
        )}

        {/* Partes */}
        {e.parties.length > 0 && (
          <Section title="Partes">
            <div className="space-y-2">
              {e.parties.map((p, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-2 rounded-md bg-neutral-50 border border-stroke-soft"
                >
                  <div className="w-8 h-8 rounded-full bg-tops-blue-700 text-white grid place-items-center font-bold text-xs flex-shrink-0">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-fg-primary truncate">{p.name}</div>
                    {p.taxId && (
                      <div className="text-[11px] font-mono text-fg-muted">{p.taxId}</div>
                    )}
                    {p.address && (
                      <div className="text-[11px] text-fg-secondary truncate">{p.address}</div>
                    )}
                  </div>
                  {p.role && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted bg-neutral-100 px-1.5 py-0.5 rounded">
                      {p.role}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Montos */}
        {e.amounts.length > 0 && (
          <Section title="Montos">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {e.amounts.map((a, i) => (
                <div
                  key={i}
                  className="p-2 rounded-md bg-neutral-50 border border-stroke-soft text-right"
                >
                  <div className="text-[10px] uppercase tracking-wider font-bold text-fg-muted">
                    {a.kind ?? "monto"}
                  </div>
                  <div className="text-sm font-bold tabular text-fg-brand">
                    {a.currency} {a.value.toLocaleString("es-AR")}
                  </div>
                  {a.original && (
                    <div className="text-[10px] text-fg-muted font-mono mt-0.5">{a.original}</div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Line items */}
        {e.lineItems.length > 0 && (
          <Section title={`Items (${e.lineItems.length})`}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Descripción</th>
                    <th className="text-right">Cant.</th>
                    <th>Un.</th>
                    <th className="text-right">P. unit</th>
                    <th className="text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {e.lineItems.slice(0, 12).map((it, i) => (
                    <tr key={i}>
                      <td className="text-xs text-fg-primary">
                        {it.description}
                        {it.sku && (
                          <span className="text-[10px] font-mono text-fg-muted ml-2">
                            {it.sku}
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular text-xs">{it.quantity ?? "—"}</td>
                      <td className="text-xs text-fg-secondary">{it.unit ?? "—"}</td>
                      <td className="text-right tabular text-xs">
                        {it.unitPrice ? it.unitPrice.toLocaleString("es-AR") : "—"}
                      </td>
                      <td className="text-right tabular text-xs font-bold text-fg-brand">
                        {it.subtotal ? it.subtotal.toLocaleString("es-AR") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Tags */}
        {e.tags.length > 0 && (
          <Section title="Tags">
            <div className="flex flex-wrap gap-1.5">
              {e.tags.map((t) => (
                <span
                  key={t}
                  className="text-[11px] font-bold text-fg-secondary bg-neutral-100 px-2 py-1 rounded-pill"
                >
                  {t}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* PDF Link — URL firmada temporal (bucket privado) */}
        {result.signedUrl && (
          <div className="pt-3 border-t border-stroke-soft">
            <a
              href={result.signedUrl}
              target="_blank"
              rel="noopener"
              className="btn btn-ghost btn-sm"
            >
              <Icon name="download" size={14} />
              Ver archivo original
            </a>
            <span className="ml-2 text-[10px] text-fg-muted">enlace temporal (5 min)</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function KV({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "warning";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-fg-muted mb-0.5">
        {label}
      </div>
      <div
        className={`text-sm font-bold tabular ${
          accent === "warning" ? "text-status-warning" : "text-fg-primary"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  factura: "Factura",
  remito: "Remito",
  contrato: "Contrato",
  habilitacion: "Habilitación",
  certificado: "Certificado",
  auditoria: "Auditoría",
  presupuesto: "Presupuesto",
  orden_compra: "Orden de Compra",
  orden_servicio: "Orden de Servicio",
  constancia_afip: "Constancia AFIP",
  otro: "Documento",
};

function labelForType(t: string): string {
  return TYPE_LABELS[t] ?? t;
}
