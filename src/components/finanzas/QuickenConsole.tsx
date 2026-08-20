"use client";

import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import { parseAndValidateQuickenExport, QUICKEN_CATEGORY_MAP, type QuickenValidationResult } from "@/lib/finanzas/quicken-importer";
import { fmtCurrency } from "@/lib/utils";

const SAMPLE_QUICKEN_CSV = `Date,Description,Category,Account,Amount
2026-01-05,"Cobro Flete Meli Luján","Fletes","Galicia CC ARS",5820000.00
2026-01-08,"Pago Gasoil YPF Ruta 9","Combustible","Santander CC ARS",-1450000.00
2026-01-12,"Liquidacion Sueldos Choferes","Sueldos","Galicia CC ARS",-4850000.00
2026-01-15,"Cobro ANMAT Roemmers","Flete ANMAT","Galicia CC ARS",13297400.00
2026-01-18,"Poliza Seguro Cargas Rivadavia","Seguros","Santander CC ARS",-380000.00
2026-01-20,"Alquiler Deposito Barracas","Alquiler Barracas","Galicia CC ARS",-2800000.00
2026-01-25,"Servicio Mantenimiento Iveco","Mantenimiento","Santander CC ARS",-950000.00
2026-01-28,"Anticipo Ganancias AFIP","AFIP","Galicia CC ARS",-1200000.00`;

export function QuickenConsole() {
  const [csvText, setCsvText] = useState(SAMPLE_QUICKEN_CSV);
  const [fileHash, setFileHash] = useState("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const [validationResult, setValidationResult] = useState<QuickenValidationResult | null>(null);

  const handleValidate = () => {
    try {
      const res = parseAndValidateQuickenExport(csvText, fileHash);
      setValidationResult(res);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al procesar archivo");
    }
  };

  return (
    <div className="space-y-6">
      {/* Disclaimer de Gobernanza */}
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
        <Icon name="lock" className="w-5 h-5 text-amber-800 mt-0.5" />
        <div className="text-xs text-amber-900">
          <span className="font-bold">Política de Migración Histórica Gobernada:</span> Quicken se utiliza históricamente como libro de caja analítico (8.763 movimientos, 268 categorías). Esta consola permite validar hashes, verificar sumas y revisar el mapeo analítico en modo seguro (Dry-Run). La importación definitiva a base de datos se ejecutará únicamente con la autorización formal de Dirección.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Panel de Carga y Parámetros */}
        <div className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs p-5 space-y-4">
          <h3 className="text-sm font-bold text-[#050555]">
            Parámetros de Importación
          </h3>

          <div>
            <label className="block text-[#687087] text-[10px] font-semibold uppercase mb-1">
              Hash SHA-256 del Archivo Fuente
            </label>
            <input
              type="text"
              value={fileHash}
              onChange={(e) => setFileHash(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono border border-[#DDE2EB] rounded-lg text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
            />
          </div>

          <div>
            <label className="block text-[#687087] text-[10px] font-semibold uppercase mb-1">
              Contenido CSV / Export de Quicken
            </label>
            <textarea
              rows={8}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono border border-[#DDE2EB] rounded-lg text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
            />
          </div>

          <button
            type="button"
            onClick={handleValidate}
            className="w-full py-2.5 px-4 bg-[#050555] hover:bg-[#214576] text-white font-semibold text-xs rounded-lg transition-colors shadow-sm"
          >
            🔍 Validar e Inspeccionar Mapeo (Dry-Run)
          </button>
        </div>

        {/* Panel de Resultados de Validación */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#DDE2EB] shadow-xs p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#DDE2EB] mb-4">
              <h3 className="text-sm font-bold text-[#050555]">
                Resultado de Validación y Balance de Sumas
              </h3>
              {validationResult && (
                <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-[#E6F4EA] text-[#137333]">
                  VALIDACIÓN EXITOSA
                </span>
              )}
            </div>

            {validationResult ? (
              <div className="space-y-4">
                {/* KPIs de Control */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 bg-[#F4F5F8] rounded-lg">
                    <span className="text-[#687087] block text-[10px] uppercase">Registros Procesados</span>
                    <span className="text-lg font-bold text-[#111331]">{validationResult.totalRows}</span>
                  </div>
                  <div className="p-3 bg-[#F4F5F8] rounded-lg">
                    <span className="text-[#687087] block text-[10px] uppercase">Registros Válidos</span>
                    <span className="text-lg font-bold text-[#137333]">{validationResult.validRows}</span>
                  </div>
                  <div className="p-3 bg-[#F4F5F8] rounded-lg">
                    <span className="text-[#687087] block text-[10px] uppercase">Duplicados Filtrados</span>
                    <span className="text-lg font-bold text-[#C9070D]">{validationResult.duplicateRows}</span>
                  </div>
                  <div className="p-3 bg-[#F4F5F8] rounded-lg">
                    <span className="text-[#687087] block text-[10px] uppercase">Balance Neto ARS</span>
                    <span className="text-lg font-bold text-[#050555]">{fmtCurrency(validationResult.totalAmountArs)}</span>
                  </div>
                </div>

                {/* Mapeo de Categorías Detectadas */}
                <div>
                  <h4 className="text-xs font-bold text-[#050555] mb-2">Mapeo de Categorías Analíticas:</h4>
                  <div className="max-h-40 overflow-y-auto border border-[#DDE2EB] rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#F4F5F8] text-[#687087] font-semibold">
                        <tr>
                          <th className="py-2 px-3">Categoría Quicken</th>
                          <th className="py-2 px-3">Categoría Canónica Nexus</th>
                          <th className="py-2 px-3">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#DDE2EB]">
                        {validationResult.categoriesFound.map((cat) => {
                          const mapped = QUICKEN_CATEGORY_MAP[cat];
                          return (
                            <tr key={cat}>
                              <td className="py-2 px-3 font-medium text-[#111331]">{cat}</td>
                              <td className="py-2 px-3 font-mono text-[#214576]">{mapped || "EGR_OTROS (Default)"}</td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-0.2 rounded text-[10px] font-bold ${
                                  mapped ? "bg-[#E6F4EA] text-[#137333]" : "bg-amber-100 text-amber-800"
                                }`}>
                                  {mapped ? "Mapeada" : "Sin mapeo directo"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-[#687087] text-xs">
                Hacé click en &ldquo;Validar e Inspeccionar Mapeo&rdquo; para analizar el contenido del archivo.
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-[#DDE2EB] mt-4 flex items-center justify-between text-xs text-[#687087]">
            <span>Seguridad: El archivo original permanece intacto.</span>
            <span className="font-semibold text-[#050555]">Estado: MODO SIMULACIÓN SEGURO</span>
          </div>
        </div>
      </div>
    </div>
  );
}
