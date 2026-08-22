"use client";

import React, { useState, useEffect, useRef, useTransition } from "react";
import { Icon } from "@/components/Icon";
import {
  parseAndValidateQuickenExport,
  computeSHA256,
  QUICKEN_CATEGORY_MAP,
  QUICKEN_ACCOUNT_MAP,
  type QuickenValidationResult,
} from "@/lib/finanzas/quicken-importer";
import {
  getQuickenHistoryAction,
  getQuickenSummaryAction,
  type QuickenRowRecord,
} from "@/lib/finanzas/actions";
import { fmtCurrency, fmtMoney } from "@/lib/utils";

const ACCOUNT_COLORS: Record<string, string> = {
  GALICIA: "bg-red-500/10 text-red-600 dark:bg-red-950/50 dark:text-red-400 border-red-500/20",
  "SANTANDER RIO": "bg-red-600/10 text-red-700 dark:bg-red-950/60 dark:text-red-300 border-red-600/30",
  BBVA: "bg-blue-600/10 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-600/30",
  HSBC: "bg-red-700/10 text-red-800 dark:bg-red-950/70 dark:text-red-200 border-red-700/30",
  Cash: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border-emerald-500/20",
  "Fondos GALICIA": "bg-amber-500/10 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border-amber-500/20",
  "Fondos SANTANDER": "bg-amber-600/10 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-600/30",
  "Credit Card": "bg-purple-500/10 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400 border-purple-500/20",
};

export function QuickenConsole() {
  // Modo de navegación: "buscador" (default) | "estadisticas" | "dry_run"
  const [mainView, setMainView] = useState<"buscador" | "estadisticas" | "dry_run">("buscador");

  // Estado del buscador
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("ALL");
  const [selectedYear, setSelectedYear] = useState("ALL");
  const [selectedDirection, setSelectedDirection] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // Datos del histórico
  const [rows, setRows] = useState<QuickenRowRecord[]>([]);
  const [totalRows, setTotalRows] = useState(9317);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState<QuickenRowRecord | null>(null);

  // Resumen del lote
  const [batchSummary, setBatchSummary] = useState<any>(null);

  // Estado de dry-run / carga manual
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileHash, setFileHash] = useState("");
  const [isComputingHash, setIsComputingHash] = useState(false);
  const [validationResult, setValidationResult] = useState<QuickenValidationResult | null>(null);
  const [dryRunTab, setDryRunTab] = useState<"resumen" | "movimientos" | "mapeo_categorias" | "mapeo_cuentas">("resumen");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isPending, startTransition] = useTransition();

  // Cargar resumen del lote al inicio
  useEffect(() => {
    getQuickenSummaryAction().then((res) => {
      if (res.ok && res.summary) {
        setBatchSummary(res.summary);
      }
    });
  }, []);

  // Cargar datos del buscador
  useEffect(() => {
    if (mainView !== "buscador") return;

    setIsLoading(true);
    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await getQuickenHistoryAction({
          search: searchTerm,
          account: selectedAccount,
          year: selectedYear,
          direction: selectedDirection === "ALL" ? undefined : selectedDirection,
          status: selectedStatus === "ALL" ? undefined : selectedStatus,
          page: currentPage,
          pageSize,
        });

        if (res.ok) {
          setRows(res.rows);
          setTotalRows(res.total);
        }
        setIsLoading(false);
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [searchTerm, selectedAccount, selectedYear, selectedDirection, selectedStatus, currentPage, mainView]);

  // Manejadores para Dry-Run
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
    if (file) handleProcessFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleProcessFile(file);
  };

  const totalPages = Math.ceil(totalRows / pageSize);

  return (
    <div className="space-y-6">
      {/* Banner de Gobierno y Estado Inmutable */}
      <div className="p-4 rounded-xl bg-tops-blue-900/10 dark:bg-tops-blue-700/10 border border-tops-blue-700/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-tops-blue-700/20 text-tops-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
            <Icon name="check-circle" className="w-5 h-5 text-status-success" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-fg-primary">
                Repositorio Histórico Quicken — Modo Consulta Inmutable
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-status-success border border-emerald-500/30 font-mono">
                9.317 REGISTROS ASEGURADOS
              </span>
            </div>
            <p className="text-xs text-fg-secondary mt-0.5">
              Base de datos histórica aislada de la Tesorería viva. Permite búsquedas instantáneas de 2020 a 2027 sin alterar saldos ni planes financieros operativos.
            </p>
          </div>
        </div>

        {/* Selector de Pestaña Principal */}
        <div className="inline-flex rounded-lg border border-stroke-soft bg-bg-surface p-1 text-xs font-bold shrink-0">
          <button
            type="button"
            onClick={() => setMainView("buscador")}
            className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-all ${
              mainView === "buscador"
                ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700 shadow-2xs"
                : "text-fg-muted hover:text-fg-primary"
            }`}
          >
            <span>🔍</span> Buscador Histórico
          </button>
          <button
            type="button"
            onClick={() => setMainView("estadisticas")}
            className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-all ${
              mainView === "estadisticas"
                ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700 shadow-2xs"
                : "text-fg-muted hover:text-fg-primary"
            }`}
          >
            <span>📊</span> Totales y Cuentas
          </button>
          <button
            type="button"
            onClick={() => setMainView("dry_run")}
            className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-all ${
              mainView === "dry_run"
                ? "bg-tops-blue-900 text-white dark:bg-tops-blue-700 shadow-2xs"
                : "text-fg-muted hover:text-fg-primary"
            }`}
          >
            <span>📁</span> Validar CSV
          </button>
        </div>
      </div>

      {/* KPI Cards de Resumen Histórico */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-bg-surface p-4 rounded-xl border border-stroke-soft shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-fg-muted block mb-1">
            Total Movimientos
          </span>
          <span className="text-xl font-bold text-fg-primary">9.317</span>
          <span className="text-[11px] text-fg-secondary block mt-0.5">
            9.300 únicos · 17 duplicados
          </span>
        </div>

        <div className="bg-bg-surface p-4 rounded-xl border border-stroke-soft shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-status-success block mb-1">
            Ingresos Históricos (ARS)
          </span>
          <span className="text-lg font-bold text-status-success tabular-nums">
            $ 9.751.908.001
          </span>
          <span className="text-[11px] text-fg-secondary block mt-0.5">
            Cobranzas y Facturación
          </span>
        </div>

        <div className="bg-bg-surface p-4 rounded-xl border border-stroke-soft shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-tops-red block mb-1">
            Egresos Históricos (ARS)
          </span>
          <span className="text-lg font-bold text-tops-red tabular-nums">
            $ 10.189.847.450
          </span>
          <span className="text-[11px] text-fg-secondary block mt-0.5">
            Gastos, Impuestos y Operación
          </span>
        </div>

        <div className="bg-bg-surface p-4 rounded-xl border border-stroke-soft shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-fg-muted block mb-1">
            Rango Temporal
          </span>
          <span className="text-sm font-bold text-fg-primary block">
            Oct 2020 — Feb 2027
          </span>
          <span className="text-[11px] text-tops-blue-700 dark:text-blue-400 block mt-0.5 font-medium">
            8 Cuentas · 73 Categorías
          </span>
        </div>
      </div>

      {/* VISTA 1: BUSCADOR HISTÓRICO INTERACTIVO */}
      {mainView === "buscador" && (
        <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors space-y-4 p-5">
          {/* Barra de Filtros */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              {/* Input de Búsqueda de Texto */}
              <div className="relative flex-1">
                <span className="absolute left-3 top-2.5 text-fg-muted">🔍</span>
                <input
                  type="text"
                  placeholder="Buscar por beneficiario, concepto, rubro o cuenta (ej. Porsche, Mecalux, Camejo, CEMAC)..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full pl-9 pr-4 py-2 text-xs border border-stroke-soft rounded-lg bg-bg-surface-alt text-fg-primary focus:outline-none focus:border-tops-blue-700 placeholder:text-fg-muted transition-colors"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm("");
                      setCurrentPage(1);
                    }}
                    className="absolute right-3 top-2 text-xs text-fg-muted hover:text-fg-primary"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Botón de limpiar filtros */}
              {(searchTerm || selectedAccount !== "ALL" || selectedYear !== "ALL" || selectedDirection !== "ALL" || selectedStatus !== "ALL") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm("");
                    setSelectedAccount("ALL");
                    setSelectedYear("ALL");
                    setSelectedDirection("ALL");
                    setSelectedStatus("ALL");
                    setCurrentPage(1);
                  }}
                  className="px-3 py-2 rounded-lg border border-stroke-soft bg-bg-surface-alt hover:bg-bg-surface text-xs font-bold text-fg-muted hover:text-fg-primary transition-colors shrink-0"
                >
                  Limpiar Filtros
                </button>
              )}
            </div>

            {/* Selectores de Filtro Rápido */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {/* Filtro por Cuenta */}
              <div>
                <label className="block text-[10px] font-bold text-fg-muted uppercase mb-1">
                  Cuenta Quicken
                </label>
                <select
                  value={selectedAccount}
                  onChange={(e) => {
                    setSelectedAccount(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-stroke-soft bg-bg-surface text-xs font-medium text-fg-primary focus:outline-none"
                >
                  <option value="ALL">Todas las cuentas (8)</option>
                  <option value="GALICIA">GALICIA</option>
                  <option value="SANTANDER RIO">SANTANDER RIO</option>
                  <option value="BBVA">BBVA</option>
                  <option value="HSBC">HSBC</option>
                  <option value="Cash">Cash (Efectivo)</option>
                  <option value="Fondos GALICIA">Fondos GALICIA (FCI)</option>
                  <option value="Fondos SANTANDER">Fondos SANTANDER (FCI)</option>
                  <option value="Credit Card">Credit Card</option>
                </select>
              </div>

              {/* Filtro por Año */}
              <div>
                <label className="block text-[10px] font-bold text-fg-muted uppercase mb-1">
                  Año
                </label>
                <select
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-stroke-soft bg-bg-surface text-xs font-medium text-fg-primary focus:outline-none"
                >
                  <option value="ALL">Todos los años</option>
                  <option value="2027">2027 (Proyecciones)</option>
                  <option value="2026">2026</option>
                  <option value="2025">2025</option>
                  <option value="2024">2024</option>
                  <option value="2023">2023</option>
                  <option value="2022">2022</option>
                  <option value="2021">2021</option>
                  <option value="2020">2020</option>
                </select>
              </div>

              {/* Filtro por Dirección */}
              <div>
                <label className="block text-[10px] font-bold text-fg-muted uppercase mb-1">
                  Tipo de Movimiento
                </label>
                <select
                  value={selectedDirection}
                  onChange={(e) => {
                    setSelectedDirection(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-stroke-soft bg-bg-surface text-xs font-medium text-fg-primary focus:outline-none"
                >
                  <option value="ALL">Todos los movimientos</option>
                  <option value="ingreso">Solo Ingresos (+)</option>
                  <option value="egreso">Solo Egresos (-)</option>
                  <option value="transferencia">Transferencias entre cuentas (⇄)</option>
                </select>
              </div>

              {/* Filtro por Estado */}
              <div>
                <label className="block text-[10px] font-bold text-fg-muted uppercase mb-1">
                  Estado Fuente
                </label>
                <select
                  value={selectedStatus}
                  onChange={(e) => {
                    setSelectedStatus(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-stroke-soft bg-bg-surface text-xs font-medium text-fg-primary focus:outline-none"
                >
                  <option value="ALL">Todos los estados</option>
                  <option value="EJECUTADO">Ejecutados reales (8.659)</option>
                  <option value="Scheduled">Programados / Scheduled (571)</option>
                  <option value="Overdue">Vencidos / Overdue (85)</option>
                  <option value="DueToday">Exigibles / DueToday (2)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Estado de Búsqueda y Resultados */}
          <div className="flex items-center justify-between pt-2 border-t border-stroke-soft text-xs text-fg-secondary">
            <span>
              Encontrados <strong className="text-fg-primary">{totalRows.toLocaleString()}</strong> movimientos
              {isLoading && <span className="ml-2 text-tops-blue-700 animate-pulse font-medium">Buscando...</span>}
            </span>
            <span>
              Página <strong className="text-fg-primary">{currentPage}</strong> de {totalPages || 1}
            </span>
          </div>

          {/* Grilla de Resultados */}
          <div className="overflow-x-auto rounded-lg border border-stroke-soft max-h-[500px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-surface-alt text-fg-muted font-bold sticky top-0 uppercase text-[10px] border-b border-stroke-soft z-10">
                <tr>
                  <th className="py-2.5 px-3">Línea</th>
                  <th className="py-2.5 px-3">Fecha</th>
                  <th className="py-2.5 px-4">Beneficiario / Concepto</th>
                  <th className="py-2.5 px-3">Rubro Quicken</th>
                  <th className="py-2.5 px-3">Cuenta</th>
                  <th className="py-2.5 px-3 text-right">Importe</th>
                  <th className="py-2.5 px-3 text-center">Estado</th>
                  <th className="py-2.5 px-2 text-center">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stroke-soft">
                {rows.length > 0 ? (
                  rows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedRow(r)}
                      className="hover:bg-bg-surface-alt/70 transition-colors cursor-pointer"
                    >
                      <td className="py-2 px-3 text-fg-muted font-mono text-[11px]">{r.source_line}</td>
                      <td className="py-2 px-3 font-semibold text-fg-primary whitespace-nowrap tabular-nums">
                        {r.date}
                      </td>
                      <td className="py-2 px-4 max-w-xs truncate font-medium text-fg-primary">
                        {r.payee}
                        {r.is_transfer && (
                          <span className="ml-2 text-[9px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono font-bold">
                            ⇄ {r.transfer_account || "Transferencia"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-fg-secondary font-medium truncate max-w-[140px]">
                        {r.category}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border font-mono whitespace-nowrap ${
                            ACCOUNT_COLORS[r.account] || "bg-bg-surface-alt text-fg-muted border-stroke-soft"
                          }`}
                        >
                          {r.account}
                        </span>
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-bold tabular-nums whitespace-nowrap ${
                          r.direction === "ingreso" ? "text-status-success" : "text-tops-red"
                        }`}
                      >
                        {r.direction === "ingreso" ? "+ " : "- "}{fmtMoney(r.amount)}
                      </td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        {r.scheduled_status === "Scheduled" && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-tops-blue-700 dark:text-blue-400 border border-blue-500/20">
                            Programado
                          </span>
                        )}
                        {r.scheduled_status === "Overdue" && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                            Vencido
                          </span>
                        )}
                        {r.scheduled_status === "DueToday" && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20">
                            Hoy
                          </span>
                        )}
                        {!r.scheduled_status && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                            Ejecutado
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-center text-fg-muted hover:text-tops-blue-700">
                        🔍
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-fg-muted">
                      {isLoading ? "Cargando movimientos..." : "No se encontraron movimientos con los filtros seleccionados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-stroke-soft text-xs">
              <button
                type="button"
                disabled={currentPage <= 1 || isLoading}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-stroke-soft bg-bg-surface-alt hover:bg-bg-surface font-bold text-fg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                ← Anterior
              </button>
              <div className="flex items-center gap-1 font-mono text-xs">
                <span>Página {currentPage} de {totalPages}</span>
              </div>
              <button
                type="button"
                disabled={currentPage >= totalPages || isLoading}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg border border-stroke-soft bg-bg-surface-alt hover:bg-bg-surface font-bold text-fg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Siguiente →
              </button>
            </div>
          )}
        </div>
      )}

      {/* VISTA 2: ESTADÍSTICAS Y DISTRIBUCIÓN POR CUENTA */}
      {mainView === "estadisticas" && (
        <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs p-6 space-y-6">
          <div>
            <h3 className="text-base font-bold text-fg-primary">
              Distribución Histórica por Cuenta de Origen
            </h3>
            <p className="text-xs text-fg-secondary mt-1">
              Desglose de los 9.317 movimientos cargados en la base de datos histórica.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { name: "GALICIA", count: "4.812 mov.", desc: "Cuenta Corriente y Operaciones Principales", color: "border-red-500/30 bg-red-500/5" },
              { name: "SANTANDER RIO", count: "3.245 mov.", desc: "Cuenta Corriente, Proveedores y Sueldos", color: "border-red-600/30 bg-red-600/5" },
              { name: "BBVA", count: "680 mov.", desc: "Operaciones y pagos corporativos", color: "border-blue-600/30 bg-blue-600/5" },
              { name: "HSBC", count: "295 mov.", desc: "Operaciones de comercio exterior y pagos", color: "border-red-700/30 bg-red-700/5" },
              { name: "Cash", count: "165 mov.", desc: "Caja Efectivo y Retiros", color: "border-emerald-500/30 bg-emerald-500/5" },
              { name: "Fondos GALICIA", count: "68 mov.", desc: "Fondos Comunes de Inversión Fima", color: "border-amber-500/30 bg-amber-500/5" },
              { name: "Fondos SANTANDER", count: "32 mov.", desc: "Fondos Comunes de Inversión Santander", color: "border-amber-600/30 bg-amber-600/5" },
              { name: "Credit Card", count: "20 mov.", desc: "Registros de Tarjetas Corporativas", color: "border-purple-500/30 bg-purple-500/5" },
            ].map((acc) => (
              <div
                key={acc.name}
                onClick={() => {
                  setSelectedAccount(acc.name);
                  setMainView("buscador");
                }}
                className={`p-4 rounded-xl border ${acc.color} hover:border-tops-blue-700 transition-all cursor-pointer flex items-center justify-between`}
              >
                <div>
                  <div className="font-bold text-fg-primary text-sm">{acc.name}</div>
                  <div className="text-xs text-fg-muted mt-0.5">{acc.desc}</div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold font-mono text-fg-primary">{acc.count}</span>
                  <span className="block text-[10px] text-tops-blue-700 dark:text-blue-400 font-bold mt-0.5">
                    Filtrar en buscador →
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VISTA 3: VALIDAR NUEVO CSV / DRY-RUN */}
      {mainView === "dry_run" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stroke-soft">
              <h3 className="text-sm font-bold text-fg-primary">
                Carga de Archivo CSV
              </h3>
              <span className="text-[11px] font-mono text-fg-muted font-semibold">CSV UTF-8</span>
            </div>

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

            {fileHash && (
              <div>
                <label className="block text-fg-secondary text-[10px] font-bold uppercase mb-1">
                  SHA-256 Validado
                </label>
                <input
                  type="text"
                  readOnly
                  value={fileHash}
                  className="w-full px-3 py-2 text-[11px] font-mono border border-stroke-soft rounded-lg bg-bg-surface-alt text-fg-primary focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            {validationResult ? (
              <div className="bg-bg-surface rounded-xl border border-stroke-soft p-5 space-y-4">
                <h4 className="text-sm font-bold text-fg-primary">Resultado de Validación</h4>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg border border-stroke-soft bg-bg-surface-alt">
                    <span className="text-[10px] font-bold uppercase text-fg-muted block">Filas Válidas</span>
                    <span className="text-base font-bold text-fg-primary">{validationResult.validRows}</span>
                  </div>
                  <div className="p-3 rounded-lg border border-stroke-soft bg-bg-surface-alt">
                    <span className="text-[10px] font-bold uppercase text-fg-muted block">Duplicados</span>
                    <span className="text-base font-bold text-tops-red">{validationResult.duplicateRows}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-bg-surface rounded-xl border border-stroke-soft p-12 text-center text-fg-muted space-y-3">
                <div className="w-12 h-12 rounded-full bg-tops-blue-700/10 dark:bg-blue-950/60 flex items-center justify-center text-tops-blue-700 dark:text-blue-400 mx-auto">
                  <Icon name="drive" className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-fg-primary">Consola de Dry-Run</h4>
                <p className="text-xs text-fg-secondary max-w-md mx-auto">
                  Cargá un archivo CSV para inspeccionar su estructura y cálculo de SHA-256 sin alterar la base de datos.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Detalle de Transacción */}
      {selectedRow && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-bg-surface rounded-2xl border border-stroke-soft shadow-xl max-w-lg w-full p-6 space-y-5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-stroke-soft">
              <div>
                <span className="text-[10px] font-bold uppercase text-fg-muted font-mono">
                  Línea Quicken #{selectedRow.source_line}
                </span>
                <h3 className="text-base font-bold text-fg-primary mt-0.5">
                  Detalle del Movimiento
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="w-8 h-8 rounded-lg border border-stroke-soft flex items-center justify-center text-fg-muted hover:text-fg-primary text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-bg-surface-alt rounded-lg">
                  <span className="text-[10px] font-bold text-fg-muted uppercase block">Fecha</span>
                  <span className="font-bold text-fg-primary text-sm">{selectedRow.date}</span>
                </div>
                <div className="p-3 bg-bg-surface-alt rounded-lg">
                  <span className="text-[10px] font-bold text-fg-muted uppercase block">Monto</span>
                  <span
                    className={`font-bold text-sm tabular-nums ${
                      selectedRow.direction === "ingreso" ? "text-status-success" : "text-tops-red"
                    }`}
                  >
                    {selectedRow.direction === "ingreso" ? "+ " : "- "}{fmtMoney(selectedRow.amount)} {selectedRow.currency}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-bg-surface-alt rounded-lg space-y-1">
                <span className="text-[10px] font-bold text-fg-muted uppercase block">Beneficiario / Payee</span>
                <span className="font-bold text-fg-primary text-sm block">{selectedRow.payee}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-bg-surface-alt rounded-lg">
                  <span className="text-[10px] font-bold text-fg-muted uppercase block">Cuenta Quicken</span>
                  <span className="font-bold text-fg-primary">{selectedRow.account}</span>
                </div>
                <div className="p-3 bg-bg-surface-alt rounded-lg">
                  <span className="text-[10px] font-bold text-fg-muted uppercase block">Categoría Quicken</span>
                  <span className="font-bold text-fg-primary">{selectedRow.category}</span>
                </div>
              </div>

              <div className="p-3 bg-bg-surface-alt rounded-lg space-y-1">
                <span className="text-[10px] font-bold text-fg-muted uppercase block">Registro Raw Quicken</span>
                <div className="font-mono text-[11px] text-fg-secondary break-all bg-bg-surface p-2 rounded border border-stroke-soft">
                  {selectedRow.raw_line}
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="px-4 py-2 bg-tops-blue-900 dark:bg-tops-blue-700 text-white text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
