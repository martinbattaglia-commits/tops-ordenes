"use client";

import React, { useState, useTransition, useMemo } from "react";
import { Icon } from "@/components/Icon";
import { saveClientRateAction, resetClientRateAction } from "@/app/(app)/orders/tarifas/actions";
import { formatTariffAmount } from "./currency";

export interface ServiceItemRate {
  slug: string;
  label: string;
  unit: string;
  category: string;
  requiresQuote: boolean;
  listRate: number | null;
}

export interface ClientCustomRateData {
  clientRateId: string;
  rate: number;
  minQty: number | null;
  minBilling: number | null;
  validFrom?: string;
  reason?: string;
  status?: "active" | "scheduled";
  futureCount?: number;
}

interface ClientOption {
  id: string;
  razon: string;
  cuit: string;
  activo?: boolean;
}

interface Props {
  /** ID del cliente preseleccionado o fijo */
  clientId?: string;
  clientName?: string;
  clientCuit?: string;
  /** Moneda del tarifario */
  currency: "ARS" | "USD";
  /** Si el usuario tiene permisos para editar */
  canAdjust: boolean;
  /** Lista de todos los servicios del catálogo con sus precios de lista */
  services: ServiceItemRate[];
  /** Mapa de tarifas personalizadas activas del cliente { [serviceSlug]: ClientCustomRateData } */
  clientRates: Record<string, ClientCustomRateData>;
  /** Lista de clientes disponibles para seleccionar (requerido si no hay clientId fijo) */
  clients?: ClientOption[];
  /** Modo de visualización: 'profile' (en ficha de cliente) o 'panel' (en /orders/tarifas) */
  mode?: "profile" | "panel";
  /** Callback opcional al cambiar de cliente en el panel */
  onSelectClient?: (clientId: string) => void;
}

function todayInBuenosAires(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function ClientCustomRatesEditor({
  clientId: initialClientId,
  clientName,
  clientCuit,
  currency = "ARS",
  canAdjust = true,
  services = [],
  clientRates: initialClientRates = {},
  clients = [],
  mode = "profile",
  onSelectClient,
}: Props) {
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId || (clients[0]?.id ?? ""));
  const [clientRates, setClientRates] = useState<Record<string, ClientCustomRateData>>(initialClientRates);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Modal de edición
  const [editingService, setEditingService] = useState<ServiceItemRate | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [minQtyInput, setMinQtyInput] = useState("");
  const [minBillingInput, setMinBillingInput] = useState("");
  const [validFromInput, setValidFromInput] = useState(todayInBuenosAires());
  const [reasonInput, setReasonInput] = useState("");

  // Estados de feedback asíncrono
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Sincronizar si cambian las props iniciales
  React.useEffect(() => {
    if (initialClientId) setSelectedClientId(initialClientId);
  }, [initialClientId]);

  React.useEffect(() => {
    setClientRates(initialClientRates);
  }, [initialClientRates]);

  const selectedClient = useMemo(() => {
    if (clientName) return { id: selectedClientId, razon: clientName, cuit: clientCuit ?? "" };
    return clients.find((c) => c.id === selectedClientId);
  }, [selectedClientId, clients, clientName, clientCuit]);

  const categories = useMemo(() => {
    const cats = new Set(services.map((s) => s.category).filter(Boolean));
    return ["all", ...Array.from(cats)];
  }, [services]);

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      const matchCat = categoryFilter === "all" || s.category === categoryFilter;
      const matchQuery = !q || s.label.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q);
      return matchCat && matchQuery;
    });
  }, [services, search, categoryFilter]);

  const customRatesCount = useMemo(() => {
    return Object.keys(clientRates).length;
  }, [clientRates]);

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => {
      setSuccessToast(null);
    }, 4000);
  };

  const handleOpenEdit = (service: ServiceItemRate) => {
    const currentCustom = clientRates[service.slug];
    if (currentCustom) {
      setErrorMsg("Para cambiar una tarifa vigente, restablecela primero. La nueva aprobación debe comenzar en una vigencia posterior.");
      return;
    }
    setEditingService(service);
    setRateInput(service.listRate != null ? String(service.listRate) : "");
    setMinQtyInput("");
    setMinBillingInput("");
    setValidFromInput(todayInBuenosAires());
    setReasonInput("Tarifa acordada comercialmente");
    setErrorMsg(null);
  };

  const handleCloseModal = () => {
    setEditingService(null);
    setErrorMsg(null);
  };

  const handleSaveRate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService) return;
    if (!selectedClientId) {
      setErrorMsg("Debés seleccionar un cliente para asignar la tarifa.");
      return;
    }

    const rateNum = parseFloat(rateInput);
    if (isNaN(rateNum) || rateNum <= 0) {
      setErrorMsg("Ingresá un precio válido mayor a 0.");
      return;
    }

    if (!reasonInput || reasonInput.trim().length < 3) {
      setErrorMsg("El motivo de aprobación debe tener al menos 3 caracteres.");
      return;
    }

    setErrorMsg(null);

    startTransition(async () => {
      const res = await saveClientRateAction({
        clientId: selectedClientId,
        serviceSlug: editingService.slug,
        currency,
        rate: rateNum,
        minQty: minQtyInput ? parseFloat(minQtyInput) : null,
        minBilling: minBillingInput ? parseFloat(minBillingInput) : null,
        validFrom: validFromInput || todayInBuenosAires(),
        reason: reasonInput.trim(),
      });

      if (!res.ok) {
        setErrorMsg(res.error || "No se pudo guardar la tarifa. Verificá los datos.");
      } else {
        // La RPC devolvió un UUID válido: la persistencia quedó confirmada.
        setClientRates((prev) => ({
          ...prev,
          [editingService.slug]: {
            clientRateId: "temp-" + Date.now(),
            rate: rateNum,
            minQty: minQtyInput ? parseFloat(minQtyInput) : null,
            minBilling: minBillingInput ? parseFloat(minBillingInput) : null,
            reason: reasonInput.trim(),
            validFrom: validFromInput,
            status: "active",
            futureCount: 0,
          },
        }));
        showToast(`Tarifa para "${editingService.label}" guardada con éxito.`);
        handleCloseModal();
      }
    });
  };

  const handleResetRate = (service: ServiceItemRate) => {
    if (!selectedClientId) return;
    if (!window.confirm(`¿Restablecer "${service.label}" al precio de lista estándar de Tops?`)) {
      return;
    }

    startTransition(async () => {
      const res = await resetClientRateAction(selectedClientId, service.slug);
      if (!res.ok) {
        alert(res.error || "Error al restablecer tarifa.");
      } else {
        setClientRates((prev) => {
          const next = { ...prev };
          delete next[service.slug];
          return next;
        });
        showToast(`Tarifa de "${service.label}" restablecida al precio de lista.`);
      }
    });
  };

  const formatPrice = (val: number | null) => {
    if (val == null) return "A COTIZAR";
    return formatTariffAmount(val, currency);
  };

  return (
    <div className="space-y-4">
      {/* Toast flotante */}
      {successToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-status-success px-4 py-3 text-sm font-semibold text-white shadow-2xl animate-fade-in">
          <Icon name="check-circle" size={16} />
          <span>{successToast}</span>
        </div>
      )}

      {/* Header del bloque */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-fg-primary flex items-center gap-2">
              <Icon name="calculator" size={16} className="text-accent-primary" />
              Precios y Tarifas del Cliente
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-neutral-100 dark:bg-neutral-800 text-fg-secondary">
              Moneda: {currency}
            </span>
          </div>
          <p className="text-xs text-fg-muted mt-0.5">
            {customRatesCount > 0
              ? `${customRatesCount} ${customRatesCount === 1 ? "servicio con tarifa personalizada vigente o programada" : "servicios con tarifas personalizadas vigentes o programadas"}. El resto rige según el precio de lista estándar.`
              : "Este cliente utiliza actualmente el 100% de las tarifas de lista estándar."}
          </p>
        </div>

        {/* Selector de cliente en modo panel */}
        {mode === "panel" && clients.length > 0 && (
          <div className="w-full sm:w-72">
            <select
              value={selectedClientId}
              onChange={(e) => {
                const newId = e.target.value;
                setSelectedClientId(newId);
                if (onSelectClient) onSelectClient(newId);
              }}
              className="input text-xs w-full font-medium"
            >
              <option value="">Seleccionar cliente…</option>
              {clients
                .filter((c) => c.activo !== false)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.razon} ({c.cuit})
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* Resumen de estado de tarifas del cliente */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-3.5 bg-bg-surface border border-stroke-soft rounded-xl flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
            <Icon name="orders" size={18} />
          </div>
          <div>
            <div className="text-[11px] font-medium text-fg-muted uppercase tracking-wider">Catálogo Total</div>
            <div className="text-lg font-bold text-fg-primary">{services.length} conceptos</div>
          </div>
        </div>

        <div className="card p-3.5 bg-bg-surface border border-stroke-soft rounded-xl flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            customRatesCount > 0 ? "bg-amber-500/10 text-amber-500" : "bg-neutral-500/10 text-neutral-400"
          }`}>
            <Icon name="tag-alt" size={18} />
          </div>
          <div>
            <div className="text-[11px] font-medium text-fg-muted uppercase tracking-wider">Tarifas Especiales</div>
            <div className="text-lg font-bold text-fg-primary">
              {customRatesCount} <span className="text-xs font-normal text-fg-muted">personalizadas</span>
            </div>
          </div>
        </div>

        <div className="card p-3.5 bg-bg-surface border border-stroke-soft rounded-xl flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
            <Icon name="check-circle" size={18} />
          </div>
          <div>
            <div className="text-[11px] font-medium text-fg-muted uppercase tracking-wider">Precio de Lista Base</div>
            <div className="text-lg font-bold text-fg-primary">
              {services.length - customRatesCount} <span className="text-xs font-normal text-fg-muted">de lista</span>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de búsqueda y filtros */}
      <div className="flex flex-col sm:flex-row gap-2 items-center justify-between">
        <div className="relative w-full sm:w-64">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            type="text"
            placeholder="Buscar servicio o código…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input text-xs pl-8 w-full"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                categoryFilter === cat
                  ? "bg-fg-primary text-bg-page"
                  : "bg-bg-surface border border-stroke-soft text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {cat === "all" ? "Todos" : cat.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla de tarifas */}
      <div className="card border border-stroke-soft rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-bg-surface border-b border-stroke-soft sticky top-0 z-10">
              <tr className="text-fg-muted uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3">Servicio / Concepto</th>
                <th className="py-2.5 px-3">Unidad</th>
                <th className="py-2.5 px-3">Precio Lista</th>
                <th className="py-2.5 px-3">Tarifa Cliente Activa</th>
                <th className="py-2.5 px-3">Estado</th>
                <th className="py-2.5 px-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke-soft/60 bg-bg-card">
              {filteredServices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-fg-muted">
                    No se encontraron servicios que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                filteredServices.map((service) => {
                  const custom = clientRates[service.slug];
                  const hasCustom = custom != null;
                  const effectivePrice = hasCustom ? custom.rate : service.listRate;

                  return (
                    <tr
                      key={service.slug}
                      className={`hover:bg-bg-surface/50 transition-colors ${
                        hasCustom ? "bg-amber-500/5 dark:bg-amber-500/10" : ""
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-fg-primary">{service.label}</div>
                        <div className="text-[10px] text-fg-muted font-mono">{service.slug}</div>
                      </td>
                      <td className="py-2.5 px-3 text-fg-secondary">{service.unit}</td>
                      <td className="py-2.5 px-3 tabular font-medium text-fg-secondary">
                        {service.requiresQuote || service.listRate == null ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-fg-muted">
                            A COTIZAR
                          </span>
                        ) : (
                          formatPrice(service.listRate)
                        )}
                      </td>
                      <td className="py-2.5 px-3 tabular">
                        {hasCustom ? (
                          <div className="flex flex-col">
                            <span className="font-bold text-amber-600 dark:text-amber-400">
                              {formatPrice(custom.rate)}
                            </span>
                            {custom.status === "scheduled" && custom.validFrom && (
                              <span className="text-[10px] text-fg-muted">Programada desde {new Date(custom.validFrom).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</span>
                            )}
                            {(custom.futureCount ?? 0) > 0 && custom.status === "active" && (
                              <span className="text-[10px] text-fg-muted">Incluye {custom.futureCount} cambio futuro programado</span>
                            )}
                            {service.listRate != null && custom.rate !== service.listRate && (
                              <span className="text-[10px] text-fg-muted">
                                {custom.rate > service.listRate ? "Diferencial (+)" : "Bonificado (-)"}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="font-medium text-fg-primary">
                            {formatPrice(effectivePrice)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {hasCustom ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                            {custom.status === "scheduled" ? "◷ Programada" : "★ Personalizada"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 dark:bg-neutral-800 text-fg-muted border border-stroke-soft">
                            Lista estándar
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {hasCustom && canAdjust && (
                            <button
                              type="button"
                              onClick={() => handleResetRate(service)}
                              disabled={isPending}
                              title="Restablecer al precio de lista estándar"
                              className="btn btn-ghost btn-xs text-red-500 hover:bg-red-500/10 px-2 py-1 h-auto"
                            >
                              <Icon name="refresh" size={12} />
                              <span className="hidden md:inline">Restablecer</span>
                            </button>
                          )}
                          {canAdjust && !hasCustom && (
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(service)}
                              disabled={isPending}
                              className="btn btn-xs px-2.5 py-1 h-auto font-semibold btn-ghost text-fg-link"
                            >
                              <Icon name="tag-alt" size={12} />
                              <span>Personalizar</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de edición interactivo */}
      {editingService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div
            className="card w-full max-w-lg p-5 bg-bg-surface border border-stroke-soft shadow-2xl rounded-2xl animate-scale-in space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-stroke-soft pb-3">
              <div>
                <div className="text-[10px] uppercase font-bold tracking-wider text-accent-primary">
                  Asignar Tarifa Especial
                </div>
                <h4 className="text-base font-bold text-fg-primary">{editingService.label}</h4>
                <p className="text-xs text-fg-muted mt-0.5">
                  Cliente: <span className="font-semibold text-fg-primary">{selectedClient?.razon || "Cliente seleccionado"}</span>
                  {selectedClient?.cuit ? ` · CUIT ${selectedClient.cuit}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="btn btn-ghost btn-sm p-1 text-fg-muted hover:text-fg-primary"
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-500 flex items-center gap-2">
                <Icon name="clock" size={14} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSaveRate} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-fg-primary mb-1">
                    Precio particular ({currency}) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    autoFocus
                    placeholder="0.00"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    className="input w-full font-semibold"
                  />
                  {editingService.listRate != null && (
                    <div className="text-[10px] text-fg-muted mt-1">
                      Precio de lista: <span className="font-semibold">{formatPrice(editingService.listRate)}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fg-primary mb-1">
                    Vigente desde <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    min={todayInBuenosAires()}
                    max={todayInBuenosAires()}
                    value={validFromInput}
                    readOnly
                    className="input w-full text-xs"
                  />
                  <div className="text-[10px] text-fg-muted mt-1">La aprobación comienza hoy; no se anticipan vigencias futuras desde esta pantalla.</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-fg-primary mb-1">Cantidad mínima</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Opcional"
                    value={minQtyInput}
                    onChange={(e) => setMinQtyInput(e.target.value)}
                    className="input w-full text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-fg-primary mb-1">Mínimo facturable</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Opcional"
                    value={minBillingInput}
                    onChange={(e) => setMinBillingInput(e.target.value)}
                    className="input w-full text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-fg-primary mb-1">
                  Motivo / Justificación comercial <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={2}
                  minLength={3}
                  placeholder="Ej: Bonificación por volumen acordada en contrato 2026..."
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  className="input w-full text-xs py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stroke-soft">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={isPending}
                  className="btn btn-ghost btn-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn btn-primary btn-sm flex items-center gap-2 min-w-[130px] justify-center"
                >
                  {isPending ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Guardando…</span>
                    </>
                  ) : (
                    <>
                      <Icon name="check-circle" size={14} />
                      <span>Guardar tarifa</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
