"use client";

import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import type {
  FinanceCurrency,
  FinanceDirection,
  FinanceAccountGroup,
  FinanceCertaintyLevel,
  FinanceCategory,
  FinanceCostCenter,
  AccountGroupPosition,
} from "@/lib/finanzas/types";

interface NewMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: FinanceCategory[];
  costCenters: FinanceCostCenter[];
  accountGroups: AccountGroupPosition[];
  onSave: (data: {
    mode: "ejecutado" | "programado" | "recurrente";
    direction: FinanceDirection;
    amount: number;
    currency: FinanceCurrency;
    accountGroup: FinanceAccountGroup;
    accountId?: string;
    date: string;
    time?: string;
    concept: string;
    counterpart?: string;
    categoryId?: string;
    costCenterId?: string;
    certainty: FinanceCertaintyLevel;
    recurrenceRule?: string;
    notes?: string;
  }) => void;
}

export function NewMovementModal({
  isOpen,
  onClose,
  categories,
  costCenters,
  accountGroups,
  onSave,
}: NewMovementModalProps) {
  const [mode, setMode] = useState<"ejecutado" | "programado" | "recurrente">("programado");
  const [direction, setDirection] = useState<FinanceDirection>("egreso");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<FinanceCurrency>("ARS");
  const [accountGroup, setAccountGroup] = useState<FinanceAccountGroup>("bancos");
  const [accountId, setAccountId] = useState<string>("");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState<string>("12:00");
  const [concept, setConcept] = useState<string>("");
  const [counterpart, setCounterpart] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [costCenterId, setCostCenterId] = useState<string>("");
  const [certainty, setCertainty] = useState<FinanceCertaintyLevel>("alta");
  const [recurrenceRule, setRecurrenceRule] = useState<string>("mensual");
  const [notes, setNotes] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      setErrorMsg("El importe debe ser un número positivo.");
      return;
    }
    if (!concept.trim()) {
      setErrorMsg("El concepto es obligatorio.");
      return;
    }

    onSave({
      mode,
      direction,
      amount: num,
      currency,
      accountGroup,
      accountId: accountId || undefined,
      date,
      time,
      concept: concept.trim(),
      counterpart: counterpart.trim() || undefined,
      categoryId: categoryId || undefined,
      costCenterId: costCenterId || undefined,
      certainty,
      recurrenceRule: mode === "recurrente" ? recurrenceRule : undefined,
      notes: notes.trim() || undefined,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#111331]/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl border border-[#DDE2EB] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header del Modal */}
        <div className="px-6 py-4 border-b border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#050555]">
              Nuevo Movimiento Financiero
            </h2>
            <p className="text-xs text-[#687087]">
              {mode === "ejecutado"
                ? "Registra un hecho real en Tesorería."
                : "Programa una proyección de flujo en Finanzas sin alterar saldos reales."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#687087] hover:text-[#111331] hover:bg-white transition-colors"
          >
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-xs flex-1">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-[#FBE9EA] border border-[#F0B0B4] text-[#C9070D] font-medium">
              {errorMsg}
            </div>
          )}

          {/* Selector de Modo */}
          <div>
            <label className="block text-[#687087] font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
              Modo de Operación
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMode("programado")}
                className={`py-2 px-3 rounded-lg border font-semibold text-center transition-all ${
                  mode === "programado"
                    ? "border-[#050555] bg-[#050555] text-white shadow-xs"
                    : "border-[#DDE2EB] bg-white text-[#687087] hover:bg-[#F4F5F8]"
                }`}
              >
                📅 Programar Futuro (Finanzas)
              </button>
              <button
                type="button"
                onClick={() => setMode("ejecutado")}
                className={`py-2 px-3 rounded-lg border font-semibold text-center transition-all ${
                  mode === "ejecutado"
                    ? "border-[#214576] bg-[#214576] text-white shadow-xs"
                    : "border-[#DDE2EB] bg-white text-[#687087] hover:bg-[#F4F5F8]"
                }`}
              >
                ⚡ Registrar Ejecutado (Tesorería)
              </button>
              <button
                type="button"
                onClick={() => setMode("recurrente")}
                className={`py-2 px-3 rounded-lg border font-semibold text-center transition-all ${
                  mode === "recurrente"
                    ? "border-[#050555] bg-[#050555] text-white shadow-xs"
                    : "border-[#DDE2EB] bg-white text-[#687087] hover:bg-[#F4F5F8]"
                }`}
              >
                🔄 Crear Recurrencia
              </button>
            </div>
          </div>

          {/* Dirección y Moneda */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
                Dirección
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setDirection("ingreso")}
                  className={`py-1.5 text-center rounded-lg border font-bold transition-all ${
                    direction === "ingreso"
                      ? "border-[#137333] bg-[#E6F4EA] text-[#137333]"
                      : "border-[#DDE2EB] bg-white text-[#687087]"
                  }`}
                >
                  + Ingreso / Cobro
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("egreso")}
                  className={`py-1.5 text-center rounded-lg border font-bold transition-all ${
                    direction === "egreso"
                      ? "border-[#C9070D] bg-[#FBE9EA] text-[#C9070D]"
                      : "border-[#DDE2EB] bg-white text-[#687087]"
                  }`}
                >
                  - Egreso / Pago
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("transferencia")}
                  className={`py-1.5 text-center rounded-lg border font-bold transition-all ${
                    direction === "transferencia"
                      ? "border-[#214576] bg-[#E9EEF5] text-[#214576]"
                      : "border-[#DDE2EB] bg-white text-[#687087]"
                  }`}
                >
                  ⇄ Transferencia
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
                Importe y Moneda
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-[#DDE2EB] rounded-lg text-[#111331] font-bold text-sm focus:outline-none focus:ring-2 focus:ring-[#214576]"
                />
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as FinanceCurrency)}
                  className="px-3 py-1.5 border border-[#DDE2EB] rounded-lg bg-white font-bold text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
                >
                  <option value="ARS">ARS ($)</option>
                  <option value="USD">USD (U$S)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Cuenta y Agrupador */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
                Agrupador de Cuentas
              </label>
              <select
                value={accountGroup}
                onChange={(e) => setAccountGroup(e.target.value as FinanceAccountGroup)}
                className="w-full px-3 py-1.5 border border-[#DDE2EB] rounded-lg bg-white text-[#111331] font-medium focus:outline-none focus:ring-2 focus:ring-[#214576]"
              >
                <option value="bancos">Bancos (Cuentas Corrientes)</option>
                <option value="caja">Caja (Efectivo & Chicas)</option>
                <option value="ahorros">Ahorros / Inversiones</option>
                <option value="tarjetas">Tarjetas Corporativas</option>
              </select>
            </div>

            <div>
              <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
                Fecha y Hora
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-[#DDE2EB] rounded-lg bg-white text-[#111331] font-medium focus:outline-none focus:ring-2 focus:ring-[#214576]"
                />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-24 px-2 py-1.5 border border-[#DDE2EB] rounded-lg bg-white text-[#111331] font-medium focus:outline-none focus:ring-2 focus:ring-[#214576]"
                />
              </div>
            </div>
          </div>

          {/* Concepto y Contraparte */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
                Concepto / Descripción *
              </label>
              <input
                type="text"
                placeholder="Ej. Pago Combustible YPF / Cobranza Factura A"
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                className="w-full px-3 py-1.5 border border-[#DDE2EB] rounded-lg text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
              />
            </div>

            <div>
              <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
                Contraparte / Beneficiario
              </label>
              <input
                type="text"
                placeholder="Ej. YPF S.A. / MercadoLibre"
                value={counterpart}
                onChange={(e) => setCounterpart(e.target.value)}
                className="w-full px-3 py-1.5 border border-[#DDE2EB] rounded-lg text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
              />
            </div>
          </div>

          {/* Categoría Analítica y Centro de Costo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
                Categoría Analítica
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-1.5 border border-[#DDE2EB] rounded-lg bg-white text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
              >
                <option value="">Seleccionar categoría...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
                Centro de Costo / Línea de Negocio
              </label>
              <select
                value={costCenterId}
                onChange={(e) => setCostCenterId(e.target.value)}
                className="w-full px-3 py-1.5 border border-[#DDE2EB] rounded-lg bg-white text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
              >
                <option value="">Seleccionar centro de costo...</option>
                {costCenters.map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.name} ({cc.business_line})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Certeza & Recurrencia */}
          {mode === "programado" && (
            <div>
              <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
                Nivel de Certeza de la Proyección
              </label>
              <div className="flex gap-3">
                {(["alta", "media", "baja"] as FinanceCertaintyLevel[]).map((lvl) => (
                  <label key={lvl} className="flex items-center gap-1.5 text-xs text-[#111331] cursor-pointer">
                    <input
                      type="radio"
                      name="certainty"
                      value={lvl}
                      checked={certainty === lvl}
                      onChange={() => setCertainty(lvl)}
                    />
                    <span className="capitalize font-medium">{lvl}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {mode === "recurrente" && (
            <div>
              <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
                Frecuencia de Recurrencia
              </label>
              <select
                value={recurrenceRule}
                onChange={(e) => setRecurrenceRule(e.target.value)}
                className="w-full px-3 py-1.5 border border-[#DDE2EB] rounded-lg bg-white text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
              >
                <option value="semanal">Semanal (cada 7 días)</option>
                <option value="quincenal">Quincenal (cada 15 días)</option>
                <option value="mensual">Mensual (mismo día de cada mes)</option>
                <option value="bimestral">Bimestral (cada 2 meses)</option>
              </select>
            </div>
          )}

          {/* Notas */}
          <div>
            <label className="block text-[#687087] font-semibold mb-1 uppercase tracking-wider text-[10px]">
              Notas / Observaciones
            </label>
            <textarea
              rows={2}
              placeholder="Detalle adicional, justificación o referencia de factura..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-1.5 border border-[#DDE2EB] rounded-lg text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
            />
          </div>
        </form>

        {/* Footer del Modal */}
        <div className="px-6 py-4 border-t border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-[#687087] hover:text-[#111331] rounded-lg border border-[#DDE2EB] bg-white transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-5 py-2 text-xs font-semibold text-white bg-[#050555] hover:bg-[#214576] rounded-lg shadow-sm transition-all"
          >
            Guardar Movimiento
          </button>
        </div>
      </div>
    </div>
  );
}
