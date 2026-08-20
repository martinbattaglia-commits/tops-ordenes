"use client";

import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import type { FinanceDocumentInboxItem } from "@/lib/finanzas/types";
import { fmtCurrency, fmtDate } from "@/lib/utils";

interface InboxViewProps {
  items: FinanceDocumentInboxItem[];
}

export function InboxView({ items }: InboxViewProps) {
  const [selectedItem, setSelectedItem] = useState<FinanceDocumentInboxItem | null>(items[0] || null);

  return (
    <div className="space-y-6">
      {/* Explicación de la regla de frontera del Inbox */}
      <div className="p-4 rounded-xl bg-[#E9EEF5] border border-[#214576]/20 flex items-start gap-3">
        <Icon name="mail" className="w-5 h-5 text-[#050555] mt-0.5" />
        <div className="text-xs text-[#050555]">
          <span className="font-bold">Circuito de Ingesta Documental Gobernado:</span> Los comprobantes recibidos por correo se extraen automáticamente como borradores. Al validarse por un responsable, se crea el movimiento ejecutado en Tesorería y se actualiza la previsión financiera sin duplicaciones.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lista de Correos / Borradores */}
        <div className="lg:col-span-1 bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-between">
            <span className="text-xs font-bold text-[#050555]">
              Bandeja de Entrada ({items.length})
            </span>
          </div>

          <div className="divide-y divide-[#DDE2EB]">
            {items.map((it) => {
              const isSelected = selectedItem?.id === it.id;
              return (
                <div
                  key={it.id}
                  onClick={() => setSelectedItem(it)}
                  className={`p-4 cursor-pointer transition-colors ${
                    isSelected ? "bg-[#E9EEF5]/60 border-l-4 border-l-[#050555]" : "hover:bg-[#F4F5F8]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-[#111331] truncate">{it.sender}</span>
                    <span className="text-[10px] text-[#687087]">{it.received_at.slice(0, 10)}</span>
                  </div>
                  <div className="text-xs font-medium text-[#050555] truncate">{it.subject}</div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 uppercase">
                      {it.status}
                    </span>
                    <span className="text-xs font-bold text-[#111331]">
                      {it.extracted_data.monto ? fmtCurrency(it.extracted_data.monto) : "Monto pendiente"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detalle y Extracción de Datos */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden flex flex-col">
          {selectedItem ? (
            <>
              <div className="px-6 py-4 border-b border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[#050555]">
                    {selectedItem.subject}
                  </h3>
                  <p className="text-xs text-[#687087]">
                    De: {selectedItem.sender} · Recibido el {fmtDate(selectedItem.received_at)}
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded text-xs font-bold bg-amber-100 text-amber-800 uppercase">
                  {selectedItem.status}
                </span>
              </div>

              <div className="p-6 space-y-4 flex-1">
                <div className="p-4 bg-[#F4F5F8] rounded-xl border border-[#DDE2EB]">
                  <h4 className="text-xs font-bold text-[#050555] mb-3 flex items-center gap-1.5">
                    <Icon name="check-circle" className="w-4 h-4 text-[#137333]" /> Datos Extraídos Automáticamente (OCR / Parser)
                  </h4>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-[#687087] block text-[10px] uppercase font-semibold">Proveedor / Razón Social</span>
                      <span className="font-bold text-[#111331]">{selectedItem.extracted_data.proveedor || "No detectado"}</span>
                    </div>
                    <div>
                      <span className="text-[#687087] block text-[10px] uppercase font-semibold">CUIT Emisor</span>
                      <span className="font-bold text-[#111331]">{selectedItem.extracted_data.cuit || "No detectado"}</span>
                    </div>
                    <div>
                      <span className="text-[#687087] block text-[10px] uppercase font-semibold">Nº Comprobante</span>
                      <span className="font-bold text-[#111331]">{selectedItem.extracted_data.comprobante || "No detectado"}</span>
                    </div>
                    <div>
                      <span className="text-[#687087] block text-[10px] uppercase font-semibold">Importe Total</span>
                      <span className="font-bold text-[#050555] text-sm">
                        {selectedItem.extracted_data.monto ? fmtCurrency(selectedItem.extracted_data.monto) : "0.00"} {selectedItem.extracted_data.moneda || "ARS"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#687087] block text-[10px] uppercase font-semibold">Fecha Emisión</span>
                      <span className="font-bold text-[#111331]">{selectedItem.extracted_data.fecha_emision || "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-[#687087] block text-[10px] uppercase font-semibold">Fecha Vencimiento</span>
                      <span className="font-bold text-[#111331]">{selectedItem.extracted_data.fecha_vencimiento || "N/A"}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[#DDE2EB]">
                    <span className="text-[#687087] block text-[10px] uppercase font-semibold">Rubro / Categoría Sugerida</span>
                    <span className="font-bold text-[#214576] inline-block px-2 py-0.5 rounded bg-[#E9EEF5] mt-1">
                      {selectedItem.extracted_data.categoria_sugerida || "EGR_OTROS"}
                    </span>
                  </div>
                </div>

                {selectedItem.attachment_url && (
                  <div className="p-4 bg-white rounded-xl border border-[#DDE2EB] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon name="paperclip" className="w-4 h-4 text-[#687087]" />
                      <span className="text-xs font-medium text-[#111331]">Comprobante Adjunto (PDF)</span>
                    </div>
                    <span className="text-xs text-[#214576] font-semibold hover:underline cursor-pointer">
                      Ver Adjunto Original
                    </span>
                  </div>
                )}
              </div>

              {/* Botonera de Aprobación */}
              <div className="px-6 py-4 border-t border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-end gap-3">
                <button
                  type="button"
                  className="px-4 py-2 text-xs font-semibold text-[#C9070D] bg-white border border-[#DDE2EB] rounded-lg hover:bg-[#FBE9EA] transition-colors"
                >
                  Descartar Borrador
                </button>
                <button
                  type="button"
                  className="px-5 py-2 text-xs font-semibold text-white bg-[#050555] rounded-lg hover:bg-[#214576] transition-colors shadow-sm"
                >
                  ✓ Validar y Registrar en Tesorería
                </button>
              </div>
            </>
          ) : (
            <div className="p-12 text-center text-[#687087]">
              Seleccioná un correo de la lista para revisar su extracción de datos.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
