"use client";

import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import type { FinanceDocumentInboxItem, FinanceCurrency } from "@/lib/finanzas/types";
import { fmtCurrency, fmtDate } from "@/lib/utils";

interface InboxViewProps {
  items: FinanceDocumentInboxItem[];
  onApproveItem?: (item: FinanceDocumentInboxItem) => void;
  onDiscardItem?: (itemId: string) => void;
}

export function InboxView({ items: initialItems, onApproveItem, onDiscardItem }: InboxViewProps) {
  const [items, setItems] = useState<FinanceDocumentInboxItem[]>(initialItems);
  const [selectedItem, setSelectedItem] = useState<FinanceDocumentInboxItem | null>(
    items.length > 0 ? items[0] : null
  );
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleApprove = (item: FinanceDocumentInboxItem) => {
    setActionSuccess(`Comprobante ${item.extracted_data.comprobante || item.id} validado y registrado como borrador en Tesorería. Pago no ejecutado automáticamente.`);
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, status: "procesado" as const } : it))
    );
    if (selectedItem?.id === item.id) {
      setSelectedItem({ ...item, status: "procesado" });
    }
    onApproveItem?.(item);
  };

  const handleDiscard = (itemId: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, status: "descartado" as const } : it))
    );
    if (selectedItem?.id === itemId) {
      setSelectedItem((prev) => (prev ? { ...prev, status: "descartado" } : null));
    }
    onDiscardItem?.(itemId);
  };

  return (
    <div className="space-y-6">
      {/* Banner Informativo de Configuración de Ingesta */}
      <div className="p-4 rounded-xl bg-bg-surface border border-stroke-soft shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-tops-blue-700/10 dark:bg-blue-950/60 flex items-center justify-center text-tops-blue-700 dark:text-blue-400 shrink-0">
            <Icon name="mail" className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-fg-primary uppercase tracking-wider">
              Integración Operativa Gmail / Workspace
            </h3>
            <p className="text-xs text-fg-secondary mt-0.5">
              Alias receptor: <code className="font-mono font-bold text-tops-blue-700 dark:text-blue-400">facturas@logisticatops.com</code> · Buzón propietario: <code className="font-mono font-bold text-fg-primary">ruth@logisticatops.com</code>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-success"></span> Ingesta Idempotente Activa
          </span>
          <span className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-bg-surface-alt text-fg-muted border border-stroke-soft">
            Sin Pagos Automáticos (Gate Humano)
          </span>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-bold text-status-success dark:text-emerald-400 flex items-center justify-between">
          <span>✓ {actionSuccess}</span>
          <button type="button" onClick={() => setActionSuccess(null)} className="text-fg-muted hover:text-fg-primary">✕</button>
        </div>
      )}

      {/* Panel Principal de la Bandeja */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lista de Correos Ingestados */}
        <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors flex flex-col">
          <div className="p-4 border-b border-stroke-soft bg-bg-surface-alt flex items-center justify-between">
            <span className="text-xs font-bold text-fg-primary">
              Comprobantes Recibidos ({items.length})
            </span>
            <span className="text-[10px] text-fg-muted font-mono">Bandeja de Borradores</span>
          </div>

          <div className="divide-y divide-stroke-soft overflow-y-auto max-h-[550px]">
            {items.length === 0 ? (
              <div className="p-8 text-center text-fg-muted space-y-2">
                <Icon name="mail" className="w-8 h-8 text-fg-muted mx-auto mb-1" />
                <div className="text-xs font-bold text-fg-primary">Sin comprobantes pendientes</div>
                <p className="text-[11px] text-fg-muted">
                  Las facturas remitidas a <span className="font-semibold text-fg-secondary">facturas@logisticatops.com</span> aparecerán en esta bandeja tras la sincronización.
                </p>
              </div>
            ) : (
              items.map((it) => {
              const isSelected = selectedItem?.id === it.id;
              let statusBadge = "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400";
              if (it.status === "procesado") statusBadge = "bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400";
              if (it.status === "descartado") statusBadge = "bg-rose-50 text-tops-red dark:bg-rose-950/60 dark:text-rose-400";

              return (
                <div
                  key={it.id}
                  onClick={() => setSelectedItem(it)}
                  className={`p-4 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-tops-blue-700/10 dark:bg-blue-950/50 border-l-4 border-l-tops-blue-700 dark:border-l-blue-400"
                      : "hover:bg-bg-surface-alt"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-fg-primary truncate max-w-[170px]">{it.sender}</span>
                    <span className="text-[10px] text-fg-muted font-mono">{it.received_at.slice(0, 10)}</span>
                  </div>
                  <div className="text-xs font-semibold text-fg-secondary truncate mb-2">{it.subject}</div>
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${statusBadge}`}>
                      {it.status}
                    </span>
                    <span className="text-xs font-bold text-fg-primary">
                      {it.extracted_data.monto ? fmtCurrency(it.extracted_data.monto) : "Monto pendiente"}
                    </span>
                  </div>
                </div>
              );
            }))}
          </div>
        </div>

        {/* Detalle y Revisión de Extracción OCR / Parser */}
        <div className="lg:col-span-2 bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden flex flex-col transition-colors">
          {selectedItem ? (
            <>
              <div className="px-6 py-4 border-b border-stroke-soft bg-bg-surface-alt flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-fg-primary">
                    {selectedItem.subject}
                  </h3>
                  <p className="text-xs text-fg-muted mt-0.5">
                    De: <strong className="text-fg-secondary">{selectedItem.sender}</strong> · Recibido el {fmtDate(selectedItem.received_at)}
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase ${
                  selectedItem.status === "procesado" ? "bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400" :
                  selectedItem.status === "descartado" ? "bg-rose-50 text-tops-red dark:bg-rose-950/60 dark:text-rose-400" :
                  "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                }`}>
                  {selectedItem.status}
                </span>
              </div>

              <div className="p-6 space-y-4 flex-1">
                {/* Cuadrícula de Datos Extraídos */}
                <div className="p-4 bg-bg-surface-alt/70 rounded-xl border border-stroke-soft space-y-3">
                  <h4 className="text-xs font-bold text-fg-primary flex items-center gap-1.5 uppercase tracking-wider">
                    <Icon name="check-circle" className="w-4 h-4 text-status-success" /> Datos Extraídos Automáticamente (OCR & Parser)
                  </h4>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-fg-muted block text-[10px] uppercase font-bold">Proveedor / Razón Social</span>
                      <span className="font-bold text-fg-primary">{selectedItem.extracted_data.proveedor || "No detectado"}</span>
                    </div>
                    <div>
                      <span className="text-fg-muted block text-[10px] uppercase font-bold">CUIT Emisor</span>
                      <span className="font-mono font-bold text-fg-primary">{selectedItem.extracted_data.cuit || "No detectado"}</span>
                    </div>
                    <div>
                      <span className="text-fg-muted block text-[10px] uppercase font-bold">Nº Comprobante</span>
                      <span className="font-mono font-bold text-fg-primary">{selectedItem.extracted_data.comprobante || "No detectado"}</span>
                    </div>
                    <div>
                      <span className="text-fg-muted block text-[10px] uppercase font-bold">Importe Total</span>
                      <span className="font-bold text-tops-blue-700 dark:text-blue-400 text-sm">
                        {selectedItem.extracted_data.monto ? fmtCurrency(selectedItem.extracted_data.monto) : "0.00"} {selectedItem.extracted_data.moneda || "ARS"}
                      </span>
                    </div>
                    <div>
                      <span className="text-fg-muted block text-[10px] uppercase font-bold">Fecha Emisión</span>
                      <span className="font-bold text-fg-primary">{selectedItem.extracted_data.fecha_emision || "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-fg-muted block text-[10px] uppercase font-bold">Fecha Vencimiento</span>
                      <span className="font-bold text-fg-primary">{selectedItem.extracted_data.fecha_vencimiento || "N/A"}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-stroke-soft flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="text-fg-muted block text-[10px] uppercase font-bold">Rubro / Categoría Sugerida</span>
                      <span className="font-bold text-tops-blue-700 dark:text-blue-400 inline-block px-2 py-0.5 rounded bg-tops-blue-700/10 dark:bg-blue-950/60 mt-1">
                        {selectedItem.extracted_data.categoria_sugerida || "EGR_COMBUSTIBLE"}
                      </span>
                    </div>

                    <div className="text-[11px] text-fg-muted">
                      Concepto: <strong className="text-fg-primary">{selectedItem.extracted_data.concepto || "Sin descripción"}</strong>
                    </div>
                  </div>
                </div>

                {/* Adjunto Original */}
                {selectedItem.attachment_url && (
                  <div className="p-4 bg-bg-surface rounded-xl border border-stroke-soft flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon name="paperclip" className="w-4 h-4 text-fg-muted" />
                      <span className="text-xs font-bold text-fg-primary">Comprobante Original Adjunto (PDF / Imagen)</span>
                    </div>
                    <span className="text-xs text-tops-blue-700 dark:text-blue-400 font-bold hover:underline cursor-pointer">
                      Ver Adjunto de Evidencia
                    </span>
                  </div>
                )}

                {/* Trazabilidad y Seguridad */}
                <div className="text-[11px] text-fg-muted space-y-1">
                  <div>• Correo original en Gmail: <span className="font-mono text-fg-secondary">INMUTABLE (No se modifica ni borra).</span></div>
                  <div>• Generación de movimiento: <span className="font-semibold text-fg-secondary">Borrador en Tesorería / Finanzas para programación de pago.</span></div>
                </div>
              </div>

              {/* Botonera de Aprobación Humana */}
              <div className="px-6 py-4 border-t border-stroke-soft bg-bg-surface-alt flex items-center justify-end gap-3">
                {selectedItem.status !== "descartado" && (
                  <button
                    type="button"
                    onClick={() => handleDiscard(selectedItem.id)}
                    className="px-4 py-2 text-xs font-bold text-tops-red bg-bg-surface border border-stroke-soft rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                  >
                    Descartar Borrador
                  </button>
                )}
                {selectedItem.status !== "procesado" && (
                  <button
                    type="button"
                    onClick={() => handleApprove(selectedItem)}
                    className="px-5 py-2 text-xs font-bold text-white bg-tops-blue-900 dark:bg-tops-blue-700 hover:bg-tops-blue-700 dark:hover:bg-blue-600 rounded-lg transition-all shadow-xs"
                  >
                    ✓ Validar y Registrar en Tesorería
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="p-12 text-center text-fg-muted text-xs">
              Seleccioná un comprobante de la lista para revisar su extracción de datos.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
