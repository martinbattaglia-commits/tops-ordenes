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

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      alert("Por favor ingresá un monto válido mayor a 0.");
      return;
    }
    if (!concept.trim()) {
      alert("Por favor ingresá un concepto.");
      return;
    }

    onSave({
      mode,
      direction,
      amount: numAmount,
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

  const selectedGroupAccounts = accountGroups.find((g) => g.group === accountGroup)?.accounts || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-bg-surface w-full max-w-2xl rounded-2xl border border-stroke-soft shadow-lg overflow-hidden flex flex-col max-h-[90vh] transition-colors">
        {/* Header Modal */}
        <div className="px-6 py-4 border-b border-stroke-soft bg-bg-surface-alt flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-tops-blue-700/10 dark:bg-blue-950/60 flex items-center justify-center text-tops-blue-700 dark:text-blue-400">
              <Icon name="plus" className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-fg-primary">
                Nuevo Movimiento Financiero
              </h2>
              <p className="text-xs text-fg-muted">
                Registrar hecho ejecutado, proyección o recurrencia de caja.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Formulario con Scroll */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Selector de Modo */}
          <div>
            <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1.5">
              Tipo de Registro
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "programado", label: "📅 Proyectado / Programado" },
                { key: "ejecutado", label: "✓ Hecho Ejecutado" },
                { key: "recurrente", label: "🔁 Recurrente" },
              ].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key as any)}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold transition-all ${
                    mode === m.key
                      ? "border-tops-blue-700 bg-tops-blue-700/10 text-tops-blue-700 dark:border-blue-400 dark:bg-blue-950/60 dark:text-blue-400"
                      : "border-stroke-soft bg-bg-surface text-fg-secondary hover:bg-bg-surface-alt"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dirección y Moneda */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1.5">
                Dirección del Flujo
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setDirection("ingreso")}
                  className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                    direction === "ingreso"
                      ? "bg-emerald-50 text-status-success border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-700"
                      : "bg-bg-surface border-stroke-soft text-fg-secondary"
                  }`}
                >
                  + Cobro
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("egreso")}
                  className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                    direction === "egreso"
                      ? "bg-rose-50 text-tops-red border-rose-300 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-700"
                      : "bg-bg-surface border-stroke-soft text-fg-secondary"
                  }`}
                >
                  - Pago
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("transferencia")}
                  className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                    direction === "transferencia"
                      ? "bg-blue-50 text-tops-blue-700 border-blue-300 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-700"
                      : "bg-bg-surface border-stroke-soft text-fg-secondary"
                  }`}
                >
                  ⇄ Transf.
                </button>
              </div>
            </div>

            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1.5">
                Moneda & Monto
              </label>
              <div className="flex gap-2">
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as FinanceCurrency)}
                  className="px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg font-bold text-fg-primary focus:ring-2 focus:ring-tops-blue-700"
                >
                  <option value="ARS">ARS ($)</option>
                  <option value="USD">USD (U$S)</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg font-bold text-fg-primary text-sm focus:ring-2 focus:ring-tops-blue-700 placeholder:text-fg-muted"
                  required
                />
              </div>
            </div>
          </div>

          {/* Concepto y Contraparte */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1">
                Concepto Principal *
              </label>
              <input
                type="text"
                placeholder="Ej: Cobranza Cliente X, Pago Combustible..."
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                className="w-full px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg text-fg-primary focus:ring-2 focus:ring-tops-blue-700 placeholder:text-fg-muted"
                required
              />
            </div>

            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1">
                Cliente / Proveedor / Contraparte
              </label>
              <input
                type="text"
                placeholder="Ej: YPF S.A., Roemmers..."
                value={counterpart}
                onChange={(e) => setCounterpart(e.target.value)}
                className="w-full px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg text-fg-primary focus:ring-2 focus:ring-tops-blue-700 placeholder:text-fg-muted"
              />
            </div>
          </div>

          {/* Agrupador de Cuenta y Cuenta Específica */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1">
                Agrupador de Cuenta
              </label>
              <select
                value={accountGroup}
                onChange={(e) => setAccountGroup(e.target.value as FinanceAccountGroup)}
                className="w-full px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg font-semibold text-fg-primary focus:ring-2 focus:ring-tops-blue-700"
              >
                <option value="bancos">Bancos (Galicia / Santander)</option>
                <option value="caja">Caja (Caja Central / Sucursales)</option>
                <option value="ahorros">Ahorros e Inversiones (FCI / Plazo Fijo)</option>
                <option value="tarjetas">Tarjetas Corporativas</option>
              </select>
            </div>

            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1">
                Cuenta Bancaria o Caja
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg text-fg-primary focus:ring-2 focus:ring-tops-blue-700"
              >
                <option value="">Seleccionar cuenta...</option>
                {selectedGroupAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.bankName})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Categoría y Centro de Costo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1">
                Categoría Analítica
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg text-fg-primary focus:ring-2 focus:ring-tops-blue-700"
              >
                <option value="">Seleccionar rubro...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} - {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1">
                Línea de Negocio / Centro de Costo
              </label>
              <select
                value={costCenterId}
                onChange={(e) => setCostCenterId(e.target.value)}
                className="w-full px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg text-fg-primary focus:ring-2 focus:ring-tops-blue-700"
              >
                <option value="">Sin asignar / General</option>
                {costCenters.map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.code} - {cc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Fecha, Hora y Nivel de Certeza */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1">
                Fecha
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg text-fg-primary focus:ring-2 focus:ring-tops-blue-700"
                required
              />
            </div>

            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1">
                Hora
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg text-fg-primary focus:ring-2 focus:ring-tops-blue-700"
              />
            </div>

            <div>
              <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1">
                Nivel de Certeza
              </label>
              <select
                value={certainty}
                onChange={(e) => setCertainty(e.target.value as FinanceCertaintyLevel)}
                className="w-full px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg text-fg-primary focus:ring-2 focus:ring-tops-blue-700"
              >
                <option value="alta">Alta (Comprometido / Pactado)</option>
                <option value="media">Media (Estimado)</option>
                <option value="baja">Baja (Supuesto / Escenario)</option>
              </select>
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="block text-fg-secondary font-bold uppercase text-[10px] mb-1">
              Notas y Auditoría
            </label>
            <textarea
              rows={2}
              placeholder="Detalle complementario o justificación del supuesto..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-stroke-soft bg-bg-surface rounded-lg text-fg-primary focus:ring-2 focus:ring-tops-blue-700 placeholder:text-fg-muted"
            />
          </div>

          {/* Botones de acción */}
          <div className="pt-4 border-t border-stroke-soft flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-fg-secondary hover:text-fg-primary bg-bg-surface border border-stroke-soft rounded-lg hover:bg-bg-surface-alt transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-tops-blue-900 dark:bg-tops-blue-700 hover:bg-tops-blue-700 dark:hover:bg-blue-600 rounded-lg shadow-xs transition-all"
            >
              Guardar Movimiento
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
