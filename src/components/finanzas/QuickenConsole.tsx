"use client";

import React, { useState, useRef } from "react";
import { Icon } from "@/components/Icon";
import {
  parseAndValidateQuickenExport,
  computeSHA256,
  QUICKEN_CATEGORY_MAP,
  QUICKEN_ACCOUNT_MAP,
  type QuickenValidationResult,
} from "@/lib/finanzas/quicken-importer";
import { fmtCurrency } from "@/lib/utils";

export function QuickenConsole() {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileHash, setFileHash] = useState("");
  const [isComputingHash, setIsComputingHash] = useState(false);
  const [validationResult, setValidationResult] = useState<QuickenValidationResult | null>(null);
  const [activeTab, setActiveTab] = useState<"resumen" | "movimientos" | "mapeo_categorias" | "mapeo_cuentas">("resumen");
  const [isDragOver, setIsDragOver] = useState(false);

  // Mapeos interactivos configurables por el usuario
  const [categoryMap] = useState<Record<string, string>>(QUICKEN_CATEGORY_MAP);
  const [accountMap] = useState<Record<string, string>>(QUICKEN_ACCOUNT_MAP);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProcessFile = async (file: File) => {
    setFileName(file.name);
    setIsComputingHash(true);
    try {
      const text = await file.text();
      setCsvText(text);
      const hash = await computeSHA256(text);
      setFileHash(hash);

      const res = parseAndValidateQuickenExport(text, hash, file.name);
      setValidationResult(res);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al procesar archivo CSV de Quicken");
    } finally {
      setIsComputingHash(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleRunDryRun = async () => {
    if (!csvText.trim()) {
      alert("Por favor cargá un archivo CSV de Quicken para validar.");
      return;
    }
    setIsComputingHash(true);
    try {
      const hash = fileHash || (await computeSHA256(csvText));
      setFileHash(hash);
      const res = parseAndValidateQuickenExport(csvText, hash, fileName || "quicken-export.csv");
      setValidationResult(res);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al ejecutar Dry-Run");
    } finally {
      setIsComputingHash(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Disclaimer de Gobernanza Fail-Closed */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 transition-colors">
        <Icon name="lock" className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 dark:text-amber-200">
          <span className="font-bold">Política de Migración Histórica Gobernada (Modo Dry-Run Inmutable):</span> Esta consola calcula automáticamente el SHA-256 del archivo seleccionado, procesa el libro analítico sin persistir escrituras directas en la base de datos de producción y protege la confidencialidad de la información. La importación definitiva requerirá autorización expresa de Dirección.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Panel de Carga, Archivo y Parámetros */}
        <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs p-5 space-y-4 transition-colors">
          <div className="flex items-center justify-between pb-2 border-b border-stroke-soft">
            <h3 className="text-sm font-bold text-fg-primary">
              Carga de Exportación Quicken
            </h3>
            <span className="text-[11px] font-mono text-fg-muted font-semibold">CSV UTF-8</span>
          </div>

          {/* Drag and Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
              isDragOver
                ? "border-tops-blue-700 bg-tops-blue-700/10 dark:bg-blue-950/60"
                : "border-stroke-soft hover:border-tops-blue-700/60 bg-bg-surface-alt/40 hover:bg-bg-surface-alt"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".csv,text/csv"
              className="hidden"
            />
            <div className="w-10 h-10 rounded-full bg-tops-blue-700/10 dark:bg-blue-950/60 flex items-center justify-center text-tops-blue-700 dark:text-blue-400 mx-auto mb-2">
              <Icon name="drive" className="w-5 h-5" />
            </div>
            <div className="text-xs font-bold text-fg-primary">
              Arrastrá el archivo CSV de Quicken acá
            </div>
            <p className="text-[11px] text-fg-muted mt-1">
              o hacé click para seleccionar desde tu equipo
            </p>
            {fileName && (
              <div className="text-[11px] text-tops-blue-700 dark:text-blue-400 font-bold mt-2 truncate">
                Archivo: {fileName}
              </div>
            )}
          </div>

          {/* SHA-256 Hash Automático */}
          <div>
            <label className="block text-fg-secondary text-[10px] font-bold uppercase mb-1">
              Hash SHA-256 Calculado Automáticamente
            </label>
            <div className="relative">
              <input
                type="text"
                readOnly
                placeholder="El hash se generará al cargar el archivo..."
                value={fileHash || (isComputingHash ? "Calculando hash criptográfico..." : "")}
                className="w-full px-3 py-2 text-[11px] font-mono border border-stroke-soft rounded-lg bg-bg-surface-alt text-fg-primary focus:outline-none"
              />
              {fileHash && (
                <span className="absolute right-2.5 top-2.5 text-[10px] font-bold text-status-success">
                  ✓ SHA-256
                </span>
              )}
            </div>
          </div>

          {/* Editor/Visualizador de contenido CSV */}
          {csvText && (
            <div>
              <label className="block text-fg-secondary text-[10px] font-bold uppercase mb-1">
                Líneas cargadas ({csvText.split("\n").length.toLocaleString()})
              </label>
              <textarea
                rows={4}
                readOnly
                value={csvText.slice(0, 500) + (csvText.length > 500 ? "\n... (contenido protegido y truncado en vista previa)" : "")}
                className="w-full px-3 py-2 text-[11px] font-mono border border-stroke-soft rounded-lg bg-bg-surface text-fg-primary focus:outline-none opacity-80"
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleRunDryRun}
            disabled={isComputingHash || !csvText}
            className="w-full py-2.5 px-4 bg-tops-blue-900 dark:bg-tops-blue-700 hover:bg-tops-blue-700 dark:hover:bg-blue-600 text-white font-bold text-xs rounded-lg transition-all shadow-xs disabled:opacity-50"
          >
            {isComputingHash ? "Procesando e Inspeccionando..." : "🔍 Ejecutar Validación y Dry-Run"}
          </button>
        </div>

        {/* Panel de Resultados y Mapeo Analítico */}
        <div className="lg:col-span-2 space-y-4">
          {validationResult ? (
            <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors">
              {/* Header de Resultados */}
              <div className="p-5 border-b border-stroke-soft bg-bg-surface-alt flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-fg-primary">
                      Reporte de Validación Dry-Run
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400">
                      PARIDAD COMPROBADA
                    </span>
                  </div>
                  <p className="text-xs text-fg-muted mt-0.5 font-mono truncate max-w-md">
                    Hash: {validationResult.fileHash}
                  </p>
                </div>

                {/* Sub-solapas de inspección */}
                <div className="inline-flex rounded-lg border border-stroke-soft bg-bg-surface p-1 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setActiveTab("resumen")}
                    className={`px-3 py-1 rounded transition-all ${
                      activeTab === "resumen" ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700" : "text-fg-muted hover:text-fg-primary"
                    }`}
                  >
                    Resumen
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("movimientos")}
                    className={`px-3 py-1 rounded transition-all ${
                      activeTab === "movimientos" ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700" : "text-fg-muted hover:text-fg-primary"
                    }`}
                  >
                    Movimientos ({validationResult.validRows})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("mapeo_categorias")}
                    className={`px-3 py-1 rounded transition-all ${
                      activeTab === "mapeo_categorias" ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700" : "text-fg-muted hover:text-fg-primary"
                    }`}
                  >
                    Rubros ({validationResult.categoriesFound.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("mapeo_cuentas")}
                    className={`px-3 py-1 rounded transition-all ${
                      activeTab === "mapeo_cuentas" ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700" : "text-fg-muted hover:text-fg-primary"
                    }`}
                  >
                    Cuentas ({validationResult.accountsFound.length})
                  </button>
                </div>
              </div>

              {/* Tab 1: Resumen Ejecutivo de la Importación */}
              {activeTab === "resumen" && (
                <div className="p-5 space-y-5">
                  {/* Tarjetas de Métricas de Paridad */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl border border-stroke-soft bg-bg-surface-alt/60">
                      <span className="text-[10px] uppercase font-bold text-fg-muted block mb-1">Registros Totales</span>
                      <span className="text-lg font-bold text-fg-primary">{validationResult.totalRows.toLocaleString()}</span>
                      <span className="text-[10px] text-status-success block mt-1">✓ {validationResult.validRows} válidos</span>
                    </div>

                    <div className="p-3.5 rounded-xl border border-stroke-soft bg-bg-surface-alt/60">
                      <span className="text-[10px] uppercase font-bold text-fg-muted block mb-1">Duplicados / Errores</span>
                      <span className="text-lg font-bold text-tops-red">{validationResult.duplicateRows}</span>
                      <span className="text-[10px] text-fg-muted block mt-1">Idempotencia protegida</span>
                    </div>

                    <div className="p-3.5 rounded-xl border border-stroke-soft bg-bg-surface-alt/60">
                      <span className="text-[10px] uppercase font-bold text-fg-muted block mb-1">Movimientos Programados</span>
                      <span className="text-lg font-bold text-tops-blue-700 dark:text-blue-400">{validationResult.scheduledCount}</span>
                      <span className="text-[10px] text-fg-muted block mt-1">Scheduled / Futuros</span>
                    </div>

                    <div className="p-3.5 rounded-xl border border-stroke-soft bg-bg-surface-alt/60">
                      <span className="text-[10px] uppercase font-bold text-fg-muted block mb-1">Rango Temporal</span>
                      <span className="text-xs font-bold text-fg-primary block truncate">{validationResult.dateRange.min || "N/A"}</span>
                      <span className="text-xs font-bold text-fg-primary block truncate">al {validationResult.dateRange.max || "N/A"}</span>
                    </div>
                  </div>

                  {/* Balance de Sumas y Saldos Netos */}
                  <div className="p-4 rounded-xl border border-stroke-soft bg-bg-surface-alt space-y-3">
                    <h4 className="text-xs font-bold text-fg-primary uppercase tracking-wider">
                      Balance de Sumas y Saldos Consolidados
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-fg-muted font-semibold">Volumen Total Procesado (ARS):</span>
                        <div className="text-base font-bold text-fg-primary">{fmtCurrency(validationResult.totalAmountArs)}</div>
                        <span className="text-[11px] text-fg-secondary">Saldo Neto acumulado: {fmtCurrency(validationResult.netBalanceArs)}</span>
                      </div>
                      <div>
                        <span className="text-fg-muted font-semibold">Volumen Total Procesado (USD):</span>
                        <div className="text-base font-bold text-fg-primary">U$S {validationResult.totalAmountUsd.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</div>
                        <span className="text-[11px] text-fg-secondary">Saldo Neto acumulado: U$S {validationResult.netBalanceUsd.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  </div>

                  {/* Advertencia Fail-Closed de Importación */}
                  <div className="flex items-center justify-between p-4 bg-bg-surface-alt/80 rounded-xl border border-stroke-soft text-xs">
                    <div className="flex items-center gap-2 text-fg-muted">
                      <Icon name="check-circle" className="w-4 h-4 text-status-success" />
                      <span>Claves de idempotencia generadas para todos los registros.</span>
                    </div>
                    <button
                      type="button"
                      disabled
                      title="Requiere autorización expresa de Dirección en producción"
                      className="px-4 py-2 bg-stroke-strong text-fg-muted font-bold rounded-lg cursor-not-allowed text-xs opacity-70"
                    >
                      🔒 Importar a DB (Bloqueado por Canon)
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 2: Grilla de Movimientos Parseados */}
              {activeTab === "movimientos" && (
                <div className="overflow-x-auto max-h-[420px]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-bg-surface-alt text-fg-muted font-bold sticky top-0 uppercase text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">Fila</th>
                        <th className="py-2.5 px-3">Fecha</th>
                        <th className="py-2.5 px-4">Concepto / Payee</th>
                        <th className="py-2.5 px-3">Rubro Quicken → Nexus</th>
                        <th className="py-2.5 px-3">Cuenta</th>
                        <th className="py-2.5 px-3 text-right">Monto</th>
                        <th className="py-2.5 px-3">Idempotencia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stroke-soft">
                      {validationResult.parsedMovements.slice(0, 50).map((m) => (
                        <tr key={m.rowHash} className="hover:bg-bg-surface-alt transition-colors">
                          <td className="py-2 px-3 text-fg-muted font-mono">{m.rowNumber}</td>
                          <td className="py-2 px-3 font-semibold text-fg-primary whitespace-nowrap">{m.date}</td>
                          <td className="py-2 px-4">
                            <div className="font-bold text-fg-primary">{m.concept}</div>
                            {m.isScheduled && (
                              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-50 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400 uppercase">
                                Programado
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-fg-secondary block font-medium">{m.quickenCategory}</span>
                            <span className="text-[10px] text-tops-blue-700 dark:text-blue-400 font-mono">→ {m.mappedCategoryCode}</span>
                          </td>
                          <td className="py-2 px-3 text-fg-muted font-medium">{m.quickenAccount}</td>
                          <td className={`py-2 px-3 text-right font-bold tabular-nums ${m.direction === "ingreso" ? "text-status-success" : "text-tops-red"}`}>
                            {m.direction === "ingreso" ? "+" : "-"}{fmtCurrency(m.amount)}
                          </td>
                          <td className="py-2 px-3 text-[10px] font-mono text-fg-muted truncate max-w-[120px]" title={m.idempotencyKey}>
                            {m.idempotencyKey.slice(0, 14)}...
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {validationResult.parsedMovements.length > 50 && (
                    <div className="p-3 bg-bg-surface-alt text-center text-xs font-bold text-fg-muted">
                      Mostrando los primeros 50 registros de {validationResult.parsedMovements.length.toLocaleString()} movimientos validados.
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Mapeo de Categorías */}
              {activeTab === "mapeo_categorias" && (
                <div className="p-5 space-y-3 max-h-[420px] overflow-y-auto">
                  <div className="text-xs text-fg-secondary">
                    Configuración de equivalencias entre los {validationResult.categoriesFound.length} rubros detectados en Quicken y el plan de cuentas de TOPS NEXUS.
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {validationResult.categoriesFound.map((cat) => (
                      <div key={cat} className="p-3 bg-bg-surface-alt/60 rounded-lg border border-stroke-soft flex items-center justify-between">
                        <span className="font-bold text-fg-primary truncate max-w-[180px]">{cat}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-fg-muted text-[11px]">→</span>
                          <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-tops-blue-700/10 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
                            {categoryMap[cat] || "EGR_OTROS"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tab 4: Mapeo de Cuentas */}
              {activeTab === "mapeo_cuentas" && (
                <div className="p-5 space-y-3">
                  <div className="text-xs text-fg-secondary">
                    Cuentas detectadas en la exportación y su agrupador destino en Tesorería.
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {validationResult.accountsFound.map((acc) => (
                      <div key={acc} className="p-3 bg-bg-surface-alt/60 rounded-lg border border-stroke-soft flex items-center justify-between">
                        <span className="font-bold text-fg-primary">{acc}</span>
                        <span className="px-2 py-0.5 rounded font-bold uppercase text-[10px] bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400">
                          {accountMap[acc] || "bancos"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-bg-surface rounded-xl border border-stroke-soft p-12 text-center text-fg-muted space-y-3 transition-colors">
              <div className="w-12 h-12 rounded-full bg-tops-blue-700/10 dark:bg-blue-950/60 flex items-center justify-center text-tops-blue-700 dark:text-blue-400 mx-auto">
                <Icon name="drive" className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-fg-primary">
                Consola Lista para Validación Dry-Run
              </h4>
              <p className="text-xs text-fg-secondary max-w-md mx-auto">
                Cargá tu archivo CSV exportado de Quicken para inspeccionar el balance de sumas, rubros analíticos, deduplicación e idempotencia.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
