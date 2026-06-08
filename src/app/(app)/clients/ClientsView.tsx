"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { cn, fmtCuit, isValidCuit } from "@/lib/utils";
import type { Client } from "@/lib/types";
import { createClient, fetchClients, refreshFromClientify, type NewClientInput } from "./actions";

interface Props {
  initialRows: Client[];
  initialSource: string;
  initialWarning?: string;
  clientifyConfigured: boolean;
}

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  msg: string;
}

export default function ClientsView({
  initialRows,
  initialSource,
  initialWarning,
  clientifyConfigured,
}: Props) {
  const [rows, setRows] = useState<Client[]>(initialRows);
  const [source, setSource] = useState<string>(initialSource);
  const [warning, setWarning] = useState<string | undefined>(initialWarning);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [refreshing, startRefresh] = useTransition();
  const [loadingSearch, startSearch] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (c) =>
        c.razon.toLowerCase().includes(q) ||
        c.cuit.includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.contacto?.toLowerCase().includes(q) ?? false)
    );
  }, [rows, search]);

  // Search vs Clientify cuando el local no encuentra nada
  useEffect(() => {
    const q = search.trim();
    if (!q || q.length < 3) return;
    const localHit = filtered.length > 0;
    if (localHit) return;
    const t = setTimeout(() => {
      startSearch(async () => {
        const r = await fetchClients(q);
        if (r.ok && r.rows.length > 0) {
          // Mergea, evitando duplicados por CUIT
          setRows((prev) => {
            const byCuit = new Map(prev.map((p) => [p.cuit, p]));
            for (const row of r.rows) byCuit.set(row.cuit, row);
            return Array.from(byCuit.values());
          });
        }
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const pushToast = (kind: Toast["kind"], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  };

  const handleRefresh = () => {
    startRefresh(async () => {
      const r = await refreshFromClientify();
      if (!r.ok) {
        pushToast("error", r.error ?? "No se pudo refrescar desde Clientify");
        return;
      }
      const list = await fetchClients();
      if (list.ok) {
        setRows(list.rows);
        setSource(list.source);
        setWarning(list.warning);
      }
      pushToast("success", `Sincronizados ${r.synced} clientes desde Clientify`);
    });
  };

  const handleCreated = (client: Client, syncSource: string) => {
    setRows((prev) => [client, ...prev.filter((p) => p.cuit !== client.cuit)]);
    pushToast(
      "success",
      syncSource === "clientify+supabase"
        ? `Cliente creado y sincronizado en Clientify`
        : `Cliente creado localmente (Clientify pendiente)`
    );
    setShowModal(false);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Maestro · {rows.length} clientes</div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">
            Razón social, CUIT, contacto y email para envío automático de comprobantes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {clientifyConfigured && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn btn-ghost btn-sm"
              title="Sincronizar empresas desde Clientify"
            >
              <Icon
                name="refresh"
                size={13}
                className={cn(refreshing && "animate-spin")}
              />
              {refreshing ? "Sincronizando…" : "Refrescar CRM"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="btn btn-primary btn-sm"
          >
            <Icon name="plus" size={14} stroke={2.2} />
            <span>Nuevo cliente</span>
          </button>
        </div>
      </div>

      {/* Source / warning badges */}
      <div className="flex items-center gap-2 flex-wrap mb-4 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill font-bold uppercase tracking-wider text-[10px]",
            source === "clientify"
              ? "bg-status-success/10 text-status-success"
              : source === "supabase"
                ? "bg-tops-blue-700/10 text-tops-blue-700"
                : "bg-neutral-100 text-fg-muted"
          )}
        >
          <span className="dot inline-block w-1.5 h-1.5 rounded-full bg-current" />
          {source === "clientify"
            ? "Clientify"
            : source === "supabase"
              ? "Supabase"
              : "Datos demo"}
        </span>
        {!clientifyConfigured && (
          <span className="text-fg-muted text-[11px]">
            ·{" "}
            <Link href="/settings" className="text-fg-link">
              Conectar Clientify
            </Link>{" "}
            para sincronizar empresas del CRM
          </span>
        )}
        {warning && (
          <span className="text-status-warning text-[11px] inline-flex items-center gap-1">
            ⚠ {warning}
          </span>
        )}
      </div>

      {/* Search */}
      <div className="card mb-4 p-3">
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            className="input pl-9"
            placeholder="Buscar por razón social, CUIT, email o contacto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {loadingSearch && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-fg-muted">
              Buscando en CRM…
            </span>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>CUIT</th>
                <th>Contacto</th>
                <th>Email</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="cell-cliente">
                    <Link href={`/clientes/${c.id}`} className="font-semibold text-fg-link hover:underline cursor-pointer" title="Abrir ficha del cliente">{c.razon}</Link>
                    {c.domicilio && <span className="cuit">{c.domicilio}</span>}
                  </td>
                  <td className="font-mono text-xs">{fmtCuit(c.cuit)}</td>
                  <td className="text-sm">{c.contacto ?? "—"}</td>
                  <td className="text-sm">{c.email ?? "—"}</td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      {(c.tags ?? []).map((t) => (
                        <span
                          key={t}
                          className={cn(
                            "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                            t === "ANMAT"
                              ? "bg-tops-red/10 text-tops-red"
                              : "bg-tops-blue-700/10 text-tops-blue-700"
                          )}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-fg-muted italic py-10">
                    {search ? (
                      <>
                        Sin coincidencias para <strong>"{search}"</strong>.{" "}
                        <button
                          type="button"
                          onClick={() => setShowModal(true)}
                          className="text-fg-link underline"
                        >
                          Crear cliente nuevo
                        </button>
                      </>
                    ) : (
                      <>
                        Todavía no cargaste clientes.{" "}
                        <button
                          type="button"
                          onClick={() => setShowModal(true)}
                          className="text-fg-link underline"
                        >
                          Crear el primero
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-stroke-soft">
          {filtered.map((c) => (
            <div key={c.id} className="p-4">
              <Link href={`/clientes/${c.id}`} className="font-semibold text-fg-link hover:underline cursor-pointer block">{c.razon}</Link>
              <div className="text-xs text-fg-muted font-mono mb-1">{fmtCuit(c.cuit)}</div>
              <div className="text-xs text-fg-secondary">
                {c.contacto ?? "—"} · {c.email ?? "—"}
              </div>
              {(c.tags ?? []).length > 0 && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {c.tags?.map((t) => (
                    <span
                      key={t}
                      className={cn(
                        "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                        t === "ANMAT"
                          ? "bg-tops-red/10 text-tops-red"
                          : "bg-tops-blue-700/10 text-tops-blue-700"
                      )}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="p-6 text-center text-fg-muted italic text-sm">
              {search ? "Sin coincidencias" : "Sin clientes cargados"}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <NewClientModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-md px-4 py-3 text-sm font-semibold shadow-lg border max-w-md",
              t.kind === "success" && "bg-status-success text-white border-status-success/40",
              t.kind === "error" && "bg-status-danger text-white border-status-danger/40",
              t.kind === "info" && "bg-tops-blue-900 text-white border-tops-blue-700/40"
            )}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Modal: Nuevo cliente
// ============================================================================

function NewClientModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: Client, source: string) => void;
}) {
  const [form, setForm] = useState<NewClientInput>({
    razon: "",
    cuit: "",
    contacto: "",
    email: "",
    telefono: "",
    tags: [],
    depot: "",
    observ: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cuitDigits = form.cuit.replace(/\D/g, "");
  const cuitValid = cuitDigits.length === 11 && isValidCuit(form.cuit);
  const emailValid =
    !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const canSubmit =
    form.razon.trim().length >= 2 && cuitValid && emailValid && !submitting;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await createClient({
        ...form,
        cuit: cuitDigits,
        tags: form.tags ?? [],
      });
      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      onCreated(result.client, result.source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      setSubmitting(false);
    }
  };

  const toggleTag = (t: string) => {
    setForm((f) => ({
      ...f,
      tags: f.tags?.includes(t)
        ? f.tags.filter((x) => x !== t)
        : [...(f.tags ?? []), t],
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[95vh] overflow-y-auto">
        <form onSubmit={onSubmit}>
          {/* Header */}
          <div className="sticky top-0 bg-tops-blue-900 text-white px-5 py-4 flex items-center justify-between rounded-t-2xl sm:rounded-t-xl z-10">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-tops-red opacity-90">
                Maestro de clientes
              </div>
              <div className="text-lg font-bold">Nuevo cliente</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/70 hover:text-white"
              aria-label="Cerrar"
            >
              <Icon name="x" size={20} />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            <ModalField label="Razón social" required>
              <input
                className="input"
                autoFocus
                value={form.razon}
                onChange={(e) => setForm((f) => ({ ...f, razon: e.target.value }))}
                placeholder="Ej: Laboratorios Bagó S.A."
              />
            </ModalField>

            <ModalField
              label="CUIT"
              required
              help={
                form.cuit.length > 0
                  ? cuitValid
                    ? "CUIT válido"
                    : "Verificá el dígito verificador"
                  : "Formato 30-12345678-9 o sólo dígitos"
              }
              helpKind={form.cuit.length > 0 ? (cuitValid ? "success" : "error") : "muted"}
            >
              <div className="relative">
                <input
                  className="input mono pr-10"
                  inputMode="numeric"
                  value={form.cuit}
                  onChange={(e) => setForm((f) => ({ ...f, cuit: e.target.value }))}
                  placeholder="30-12345678-9"
                />
                {cuitValid && (
                  <Icon
                    name="check-circle"
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-status-success"
                  />
                )}
              </div>
            </ModalField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ModalField label="Contacto">
                <input
                  className="input"
                  value={form.contacto}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contacto: e.target.value }))
                  }
                  placeholder="Nombre y apellido"
                />
              </ModalField>
              <ModalField label="Teléfono">
                <input
                  className="input"
                  inputMode="tel"
                  value={form.telefono}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, telefono: e.target.value }))
                  }
                  placeholder="11-5555-5555"
                />
              </ModalField>
            </div>

            <ModalField
              label="Email para envío de comprobantes"
              help={!emailValid ? "Email inválido" : undefined}
              helpKind={!emailValid ? "error" : undefined}
            >
              <div className="relative">
                <Icon
                  name="mail"
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
                />
                <input
                  className="input pl-9"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="facturacion@cliente.com"
                />
              </div>
            </ModalField>

            <ModalField label="Tags" help="Sirven para clasificar y filtrar">
              <div className="chip-group flex flex-wrap gap-1.5">
                {["ANMAT", "OFICINAS", "CARGAS GENERALES", "TRANSPORTE"].map((t) => {
                  const active = form.tags?.includes(t) ?? false;
                  return (
                    <button
                      type="button"
                      key={t}
                      onClick={() => toggleTag(t)}
                      className={cn(
                        "px-2.5 py-1 rounded-pill text-xs font-bold uppercase tracking-wider border transition-colors",
                        active
                          ? t === "ANMAT"
                            ? "bg-tops-red text-white border-tops-red"
                            : "bg-tops-blue-700 text-white border-tops-blue-700"
                          : "bg-bg-surface-alt text-fg-primary border-stroke-soft hover:border-tops-blue-700/60"
                      )}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </ModalField>

            <ModalField label="Depósito habitual">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "MAGALDI", label: "Magaldi · CABA" },
                  { value: "LUJAN", label: "Luján · BsAs" },
                  { value: "", label: "Sin asignar" },
                ].map((opt) => (
                  <button
                    type="button"
                    key={opt.value || "none"}
                    onClick={() =>
                      setForm((f) => ({ ...f, depot: opt.value as NewClientInput["depot"] }))
                    }
                    className={cn(
                      "px-3 py-2 text-xs font-semibold rounded-md border transition-colors text-center",
                      form.depot === opt.value
                        ? "bg-tops-blue-700 text-white border-tops-blue-700"
                        : "bg-bg-surface-alt text-fg-primary border-stroke-soft hover:border-tops-blue-700/60"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </ModalField>

            <ModalField label="Observaciones">
              <textarea
                className="textarea"
                rows={2}
                value={form.observ}
                onChange={(e) => setForm((f) => ({ ...f, observ: e.target.value }))}
                placeholder="Notas internas, condiciones de pago, etc."
              />
            </ModalField>

            {error && (
              <div
                role="alert"
                className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20"
              >
                <div className="flex items-start gap-2">
                  <Icon name="x" size={14} className="mt-0.5 shrink-0" />
                  <div className="flex-1">{error}</div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-neutral-50 border-t border-stroke-soft px-5 py-3 flex items-center justify-between rounded-b-2xl sm:rounded-b-xl">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-sm"
              disabled={submitting}
            >
              Cancelar
            </button>
            <button type="submit" disabled={!canSubmit} className="btn btn-primary">
              {submitting ? (
                <>Guardando…</>
              ) : (
                <>
                  <Icon name="check" size={14} stroke={2.2} /> Crear cliente
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalField({
  label,
  required,
  help,
  helpKind = "muted",
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  helpKind?: "muted" | "success" | "error";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </div>
      {children}
      {help && (
        <div
          className={cn(
            "mt-1 text-[11px]",
            helpKind === "success" && "text-status-success",
            helpKind === "error" && "text-status-danger",
            helpKind === "muted" && "text-fg-muted"
          )}
        >
          {help}
        </div>
      )}
    </div>
  );
}
