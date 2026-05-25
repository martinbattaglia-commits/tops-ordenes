"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { cn, fmtCurrency, isValidCuit, sha256 } from "@/lib/utils";
import { createOrder } from "./actions";
import type { Client, Operator, ServiceCatalogItem } from "@/lib/types";

interface Props {
  clients: Client[];
  operators: Operator[];
  catalog: ServiceCatalogItem[];
}

interface WizardState {
  client_id: string | null;
  razon: string;
  cuit: string;
  domicilio: string;
  telefono: string;
  contacto: string;
  email: string;
  depot: "MAGALDI" | "LUJAN";
  operator_id: string;
  services: string[];
  qty: Record<string, number>;
  h_start: string;
  h_end: string;
  pallets: number;
  units: number;
  km: number;
  observ: string;
  signer_name: string;
  signer_doc: string;
  signature_data: string | null;
  signature_hash: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
}

const STEPS = ["Cliente", "Operativo", "Servicio", "Firma"];
const DRAFT_KEY = "tops:new-order:draft:v1";

export default function NewOrderWizard({ clients, operators, catalog }: Props) {
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WizardState>(initial(clients[0]));

  // Auto-save en localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setData((prev) => ({ ...prev, ...parsed, signature_data: null }));
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      const { signature_data: _drop, ...rest } = data;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
    } catch {}
  }, [data]);

  const update = (patch: Partial<WizardState>) =>
    setData((d) => ({ ...d, ...patch }));

  const total = useMemo(() => {
    return data.services.reduce((acc, slug) => {
      const s = catalog.find((c) => c.slug === slug);
      const q = data.qty[slug] ?? 1;
      return acc + (s ? s.rate * q : 0);
    }, 0);
  }, [data.services, data.qty, catalog]);

  const canAdvance = () => {
    if (stepIdx === 0) return data.razon.trim().length > 1 && data.cuit.replace(/\D/g, "").length === 11;
    if (stepIdx === 1) return Boolean(data.depot && data.operator_id);
    if (stepIdx === 2) return data.services.length > 0;
    return true;
  };

  const goNext = () => setStepIdx((s) => Math.min(STEPS.length - 1, s + 1));
  const goPrev = () => setStepIdx((s) => Math.max(0, s - 1));

  const handleSubmit = async (sig: { data: string; hash: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      const services = data.services.map((slug) => {
        const s = catalog.find((c) => c.slug === slug)!;
        const qty = data.qty[slug] ?? 1;
        return {
          service_slug: slug,
          label: s.label,
          qty,
          unit: s.unit,
          rate: s.rate,
          subtotal: qty * s.rate,
        };
      });

      const result = await createOrder({
        client: {
          id: data.client_id,
          razon: data.razon,
          cuit: data.cuit,
          domicilio: data.domicilio,
          telefono: data.telefono,
          contacto: data.contacto,
          email: data.email,
        },
        depot: data.depot,
        operator_id: data.operator_id,
        services,
        h_start: data.h_start,
        h_end: data.h_end,
        pallets: Number(data.pallets) || 0,
        units: Number(data.units) || 0,
        km: Number(data.km) || 0,
        observ: data.observ,
        total,
        signature: {
          signed_by: data.signer_name,
          signed_doc: data.signer_doc || null,
          data_url: sig.data,
          hash: sig.hash,
          geo_lat: data.geo_lat,
          geo_lng: data.geo_lng,
        },
      });

      if (!result.ok) {
        setError(result.error ?? "No pudimos guardar la orden.");
        setSubmitting(false);
        return;
      }

      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}

      router.push(`/orders/${result.public_id}?created=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-bg-page">
      <div className="px-4 lg:px-8 pt-4 lg:pt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/orders")}
          className="btn btn-ghost btn-sm"
        >
          <Icon name="x" size={13} /> Cancelar
        </button>
        <Stepper steps={STEPS} current={stepIdx} />
        <div className="ml-auto text-xs text-fg-secondary hidden sm:block">
          <span className="font-mono">Borrador</span> · Auto-guardado
        </div>
      </div>

      <div className="px-4 lg:px-8 py-5 pb-32 lg:pb-10 grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-6 items-start">
        <div className="card p-5 lg:p-7 min-h-[480px]">
          {stepIdx === 0 && (
            <StepClient clients={clients} data={data} update={update} />
          )}
          {stepIdx === 1 && (
            <StepOperativo operators={operators} data={data} update={update} />
          )}
          {stepIdx === 2 && (
            <StepServicio catalog={catalog} data={data} update={update} total={total} />
          )}
          {stepIdx === 3 && (
            <StepFirma
              data={data}
              update={update}
              total={total}
              onConfirm={handleSubmit}
              submitting={submitting}
            />
          )}

          {error && (
            <div className="mt-4 rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
              {error}
            </div>
          )}

          {stepIdx < STEPS.length - 1 && (
            <div className="flex justify-between mt-8 pt-5 border-t border-stroke-soft">
              <button
                type="button"
                onClick={goPrev}
                disabled={stepIdx === 0}
                className="btn btn-ghost"
              >
                <Icon name="arrow-left" size={13} /> Atrás
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!canAdvance()}
                className="btn btn-primary"
              >
                Continuar <Icon name="arrow-right" size={13} stroke={2.2} />
              </button>
            </div>
          )}
        </div>

        {/* Resumen lateral */}
        <aside className="hidden lg:block lg:sticky lg:top-20">
          <SummaryCard
            data={data}
            total={total}
            catalog={catalog}
            operator={operators.find((o) => o.id === data.operator_id)}
          />
        </aside>
      </div>
    </div>
  );
}

function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="stepper overflow-x-auto -mx-1 px-1 flex-1 lg:flex-initial">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center">
          <div
            className={cn(
              "step-item",
              current === i && "active",
              i < current && "done"
            )}
          >
            <span className="num">
              {i < current ? <Icon name="check" size={12} stroke={2.4} /> : i + 1}
            </span>
            <span className="hidden sm:inline">{s}</span>
          </div>
          {i < steps.length - 1 && <span className="step-sep" />}
        </div>
      ))}
    </div>
  );
}

/* ========================================================================== */
/* Steps                                                                       */
/* ========================================================================== */

function StepClient({
  clients,
  data,
  update,
}: {
  clients: Client[];
  data: WizardState;
  update: (p: Partial<WizardState>) => void;
}) {
  const [search, setSearch] = useState("");
  const [showSug, setShowSug] = useState(false);

  const cuitValid = data.cuit.replace(/\D/g, "").length === 11 && isValidCuit(data.cuit);

  const filtered = search
    ? clients.filter(
        (c) =>
          c.razon.toLowerCase().includes(search.toLowerCase()) ||
          c.cuit.includes(search)
      )
    : clients.slice(0, 5);

  const pick = (c: Client) => {
    update({
      client_id: c.id,
      razon: c.razon,
      cuit: c.cuit,
      domicilio: c.domicilio ?? "",
      telefono: c.telefono ?? "",
      contacto: c.contacto ?? "",
      email: c.email ?? "",
    });
    setSearch("");
    setShowSug(false);
  };

  return (
    <div>
      <div className="eyebrow-tiny">Paso 1 de 4</div>
      <h2 className="text-xl font-bold text-fg-brand mb-1">Cliente</h2>
      <p className="text-sm text-fg-secondary mb-5">
        Buscá un cliente existente o cargá los datos manualmente.
      </p>

      <div className="relative mb-5">
        <div className="field-label">
          <Icon
            name="sparkle"
            size={11}
            stroke={2}
            className="inline-block text-tops-red mr-1 -mt-0.5"
          />
          Búsqueda inteligente
        </div>
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            className="input pl-9"
            placeholder="Razón social, CUIT, alias…"
            value={search}
            onFocus={() => setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 200)}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowSug(true);
            }}
          />
        </div>
        {showSug && (
          <div className="absolute z-20 left-0 right-0 mt-1.5 bg-white border border-stroke-soft rounded-lg shadow-md overflow-hidden max-h-80 overflow-y-auto">
            <div className="px-3 py-2 text-[10px] uppercase tracking-[0.12em] font-bold text-fg-muted bg-neutral-50 border-b border-stroke-soft">
              {search ? "Coincidencias" : "Clientes recientes"}
            </div>
            {filtered.map((c) => (
              <button
                type="button"
                key={c.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-neutral-50 border-b border-stroke-soft"
              >
                <div className="w-7 h-7 rounded-md bg-tops-blue-700 text-white grid place-items-center text-xs font-bold shrink-0">
                  {c.razon[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{c.razon}</div>
                  <div className="text-[11px] text-fg-muted font-mono">{c.cuit}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {c.tags.slice(0, 2).map((t) => (
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
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-sm text-fg-muted italic text-center">
                Sin coincidencias.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1.2fr] gap-3 mb-3">
        <Field label="Razón Social" required>
          <input
            className="input"
            value={data.razon}
            onChange={(e) => update({ razon: e.target.value })}
          />
        </Field>
        <Field
          label="CUIT"
          required
          help={data.cuit && !cuitValid ? "CUIT inválido" : "Validación AFIP"}
        >
          <div className="relative">
            <input
              className="input mono pr-10"
              value={data.cuit}
              onChange={(e) => update({ cuit: e.target.value })}
              inputMode="numeric"
            />
            {cuitValid && (
              <Icon
                name="check-circle"
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-status-success"
              />
            )}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3 mb-3">
        <Field label="Domicilio">
          <input
            className="input"
            value={data.domicilio}
            onChange={(e) => update({ domicilio: e.target.value })}
          />
        </Field>
        <Field label="Teléfono">
          <input
            className="input"
            inputMode="tel"
            value={data.telefono}
            onChange={(e) => update({ telefono: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1.2fr_1.4fr] gap-3">
        <Field label="Contacto">
          <input
            className="input"
            value={data.contacto}
            onChange={(e) => update({ contacto: e.target.value })}
          />
        </Field>
        <Field label="Email para envío" required>
          <div className="relative">
            <Icon
              name="mail"
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
            />
            <input
              className="input pl-9"
              type="email"
              value={data.email}
              onChange={(e) => update({ email: e.target.value })}
            />
          </div>
        </Field>
      </div>
    </div>
  );
}

function StepOperativo({
  operators,
  data,
  update,
}: {
  operators: Operator[];
  data: WizardState;
  update: (p: Partial<WizardState>) => void;
}) {
  return (
    <div>
      <div className="eyebrow-tiny">Paso 2 de 4</div>
      <h2 className="text-xl font-bold text-fg-brand mb-1">Datos operativos</h2>
      <p className="text-sm text-fg-secondary mb-5">
        Depósito de origen y responsable a cargo.
      </p>

      <Field label="Depósito" required>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DepotCard
            selected={data.depot === "MAGALDI"}
            onClick={() => update({ depot: "MAGALDI" })}
            name="Magaldi"
            address="Agustín Magaldi 1765 · CABA"
            badge="ANMAT"
            ops={6}
          />
          <DepotCard
            selected={data.depot === "LUJAN"}
            onClick={() => update({ depot: "LUJAN" })}
            name="Luján"
            address="Ruta 8 km 67.5 · BsAs"
            badge="General"
            ops={3}
          />
        </div>
      </Field>

      <div className="mt-5">
        <Field label="Responsable operativo" required>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {operators.map((op) => (
              <button
                type="button"
                key={op.id}
                onClick={() => update({ operator_id: op.id })}
                className={cn(
                  "p-3 border rounded-lg flex items-center gap-3 text-left transition-all duration-200",
                  data.operator_id === op.id
                    ? "border-tops-blue-700 bg-tops-blue-700/5 shadow-ring-brand"
                    : "border-stroke-soft bg-white hover:border-tops-blue-700/40"
                )}
              >
                <div className="w-9 h-9 rounded-full bg-tops-blue-700 text-white grid place-items-center font-bold text-xs">
                  {op.avatar ?? op.full_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{op.full_name}</div>
                  <div className="text-[11px] text-fg-muted truncate">{op.role}</div>
                </div>
                {data.operator_id === op.id && (
                  <Icon name="check-circle" size={16} className="text-tops-blue-700" />
                )}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </div>
  );
}

function DepotCard({
  selected,
  onClick,
  name,
  address,
  badge,
  ops,
}: {
  selected: boolean;
  onClick: () => void;
  name: string;
  address: string;
  badge: string;
  ops: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "p-4 rounded-lg border text-left transition-all duration-200 relative overflow-hidden",
        selected
          ? "bg-tops-blue-900 text-white border-tops-blue-900"
          : "bg-white text-fg-primary border-stroke-soft hover:border-tops-blue-700/40"
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon name="building" size={15} />
        <span className="text-sm font-bold">{name}</span>
        <span
          className={cn(
            "ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
            selected ? "bg-white/16 text-white" : "bg-tops-red/10 text-tops-red"
          )}
        >
          {badge}
        </span>
      </div>
      <div className={cn("text-[11px] mb-2", selected ? "text-white/70" : "text-fg-muted")}>
        {address}
      </div>
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <span className={selected ? "text-white/85" : "text-fg-secondary"}>
          {ops} operarios activos
        </span>
      </div>
      {selected && (
        <Icon name="check-circle" size={16} className="absolute top-3 right-3" />
      )}
    </button>
  );
}

function StepServicio({
  catalog,
  data,
  update,
  total,
}: {
  catalog: ServiceCatalogItem[];
  data: WizardState;
  update: (p: Partial<WizardState>) => void;
  total: number;
}) {
  const toggle = (slug: string) => {
    const next = data.services.includes(slug)
      ? data.services.filter((s) => s !== slug)
      : [...data.services, slug];
    const qty = { ...data.qty };
    if (!qty[slug]) qty[slug] = 1;
    update({ services: next, qty });
  };

  const bump = (slug: string, delta: number) => {
    const cur = data.qty[slug] ?? 1;
    update({ qty: { ...data.qty, [slug]: Math.max(1, cur + delta) } });
  };

  return (
    <div>
      <div className="eyebrow-tiny">Paso 3 de 4</div>
      <h2 className="text-xl font-bold text-fg-brand mb-1">Detalle del servicio</h2>
      <p className="text-sm text-fg-secondary mb-5">
        Seleccioná los servicios prestados. La estimación se calcula en tiempo real.
      </p>

      <Field label="Tipo de servicio" required>
        <div className="chip-group">
          {catalog.map((s) => (
            <button
              type="button"
              key={s.slug}
              onClick={() => toggle(s.slug)}
              className={cn("chip", data.services.includes(s.slug) && "selected")}
            >
              {data.services.includes(s.slug) && (
                <Icon name="check" size={12} stroke={2.4} />
              )}
              {s.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="mt-5">
        <Field label="Cantidades por servicio">
          <div className="flex flex-col gap-2">
            {data.services.length === 0 && (
              <div className="text-sm text-fg-muted italic p-3">
                Seleccioná al menos un servicio.
              </div>
            )}
            {data.services.map((slug) => {
              const s = catalog.find((c) => c.slug === slug);
              if (!s) return null;
              const q = data.qty[slug] ?? 1;
              return (
                <div
                  key={slug}
                  className="grid grid-cols-[1fr_auto_auto_auto] sm:grid-cols-[1.4fr_120px_80px_1fr] items-center gap-2 sm:gap-3 px-3 py-2 bg-neutral-50 rounded-md"
                >
                  <div className="text-sm font-semibold truncate">{s.label}</div>
                  <div className="flex items-center gap-1 bg-white border border-stroke-soft rounded-md p-0.5">
                    <button
                      type="button"
                      onClick={() => bump(slug, -1)}
                      className="w-8 h-8 grid place-items-center text-fg-secondary hover:bg-neutral-100 rounded"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      value={q}
                      onChange={(e) =>
                        update({
                          qty: {
                            ...data.qty,
                            [slug]: Math.max(1, parseInt(e.target.value, 10) || 1),
                          },
                        })
                      }
                      className="w-10 text-center bg-transparent border-none font-bold text-sm outline-none"
                      style={{ fontSize: "14px" }}
                    />
                    <button
                      type="button"
                      onClick={() => bump(slug, 1)}
                      className="w-8 h-8 grid place-items-center text-fg-secondary hover:bg-neutral-100 rounded"
                    >
                      +
                    </button>
                  </div>
                  <div className="text-xs text-fg-muted font-bold">{s.unit}</div>
                  <div className="text-sm font-bold text-fg-brand text-right tabular">
                    {fmtCurrency(s.rate * q)}
                  </div>
                </div>
              );
            })}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        <Field label="Hora inicio">
          <input
            className="input"
            type="time"
            value={data.h_start}
            onChange={(e) => update({ h_start: e.target.value })}
          />
        </Field>
        <Field label="Hora fin">
          <input
            className="input"
            type="time"
            value={data.h_end}
            onChange={(e) => update({ h_end: e.target.value })}
          />
        </Field>
        <Field label="Pallets">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            value={data.pallets}
            onChange={(e) => update({ pallets: +e.target.value })}
          />
        </Field>
        <Field label="Unidades">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            value={data.units}
            onChange={(e) => update({ units: +e.target.value })}
          />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Observaciones">
          <textarea
            className="textarea"
            rows={3}
            value={data.observ}
            onChange={(e) => update({ observ: e.target.value })}
            placeholder="Detalles adicionales del servicio prestado…"
          />
        </Field>
      </div>

      <div className="mt-5 p-4 rounded-lg border border-stroke-soft bg-gradient-to-br from-tops-blue-900/5 to-tops-red/5 flex items-center gap-4">
        <div className="w-9 h-9 rounded-md bg-tops-blue-900 text-white grid place-items-center shrink-0">
          <Icon name="sparkle" size={16} stroke={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-tops-red">
            Estimación inteligente
          </div>
          <div className="text-xs text-fg-secondary">
            Basada en tarifas vigentes (mayo {new Date().getFullYear()}).
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-fg-brand tabular -tracking-[0.01em]">
            {fmtCurrency(total)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">
            + IVA · neto
          </div>
        </div>
      </div>
    </div>
  );
}

function StepFirma({
  data,
  update,
  total,
  onConfirm,
  submitting,
}: {
  data: WizardState;
  update: (p: Partial<WizardState>) => void;
  total: number;
  onConfirm: (sig: { data: string; hash: string }) => void;
  submitting: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasInk, setHasInk] = useState(false);

  // Geolocation
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => update({ geo_lat: pos.coords.latitude, geo_lng: pos.coords.longitude }),
      () => {},
      { timeout: 4000, maximumAge: 60_000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const setup = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#050555";
    };
    setup();

    let down = false;
    let last: { x: number; y: number } | null = null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const getPos = (e: PointerEvent | TouchEvent | MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const point =
        "touches" in e
          ? e.touches[0] ?? (e as unknown as TouchEvent).changedTouches?.[0]
          : (e as PointerEvent | MouseEvent);
      return { x: (point as MouseEvent).clientX - r.left, y: (point as MouseEvent).clientY - r.top };
    };

    const start = (e: PointerEvent) => {
      e.preventDefault();
      down = true;
      last = getPos(e);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
    };
    const move = (e: PointerEvent) => {
      if (!down || !last) return;
      e.preventDefault();
      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      if (!hasInk) setHasInk(true);
    };
    const end = (e?: PointerEvent) => {
      down = false;
      if (e) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {}
      }
    };

    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", end);

    return () => {
      canvas.removeEventListener("pointerdown", start);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", end);
      canvas.removeEventListener("pointercancel", end);
      canvas.removeEventListener("pointerleave", end);
    };
  }, [hasInk]);

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const confirm = async () => {
    const c = canvasRef.current;
    if (!c || !hasInk) return;
    const dataUrl = c.toDataURL("image/png");
    const hash = await sha256(dataUrl);
    update({ signature_data: dataUrl, signature_hash: hash });
    onConfirm({ data: dataUrl, hash });
  };

  return (
    <div>
      <div className="eyebrow-tiny">Paso 4 de 4</div>
      <h2 className="text-xl font-bold text-fg-brand mb-1">Firma del cliente</h2>
      <p className="text-sm text-fg-secondary mb-5">
        El cliente confirma el servicio firmando con el dedo o lápiz óptico. La firma se incrusta en
        el PDF con timestamp, geolocalización e IP del dispositivo.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <Field label="Nombre del firmante" required>
          <input
            className="input"
            value={data.signer_name}
            onChange={(e) => update({ signer_name: e.target.value })}
          />
        </Field>
        <Field label="DNI / Documento" help="Opcional">
          <input
            className="input mono"
            inputMode="numeric"
            value={data.signer_doc}
            onChange={(e) => update({ signer_doc: e.target.value })}
            placeholder="32.450.812"
          />
        </Field>
      </div>

      <Field label="Firma del cliente" required>
        <div className="relative bg-white border-2 border-dashed border-stroke-strong rounded-lg overflow-hidden">
          {!hasInk && (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="text-center text-fg-muted">
                <Icon name="pen" size={28} stroke={1.4} className="mx-auto mb-1.5" />
                <div className="text-sm font-medium">Firmá aquí con el dedo o el mouse</div>
                <div className="text-[11px] mt-0.5">
                  El cliente acepta la prestación del servicio descripto arriba.
                </div>
              </div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="w-full h-[200px] block cursor-crosshair"
            style={{ touchAction: "none" }}
          />
          <span className="absolute top-2 left-3 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
            X
          </span>
        </div>
        <div className="flex justify-between mt-2 text-[11px] text-fg-muted">
          <button
            type="button"
            onClick={clear}
            disabled={!hasInk}
            className="btn btn-ghost btn-sm disabled:opacity-40"
          >
            <Icon name="refresh" size={12} /> Limpiar
          </button>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="lock" size={11} /> Hash SHA-256 al guardar
          </span>
        </div>
      </Field>

      <div className="mt-4 p-3 bg-neutral-50 rounded-lg flex gap-2 text-[11px] text-fg-secondary">
        <Icon name="pin" size={14} className="text-tops-blue-700 shrink-0 mt-0.5" />
        <div>
          <strong className="text-fg-primary">Trazabilidad:</strong> al confirmar se registran
          posición GPS aproximada
          {data.geo_lat && data.geo_lng ? (
            <> ({data.geo_lat.toFixed(4)}, {data.geo_lng.toFixed(4)})</>
          ) : (
            " (pendiente de permisos)"
          )}
          , IP del dispositivo, timestamp UTC y hash criptográfico. Esta información viaja con el
          comprobante.
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center mt-6 pt-5 border-t border-stroke-soft">
        <div className="text-xs text-fg-secondary">
          Total estimado:{" "}
          <strong className="text-fg-brand text-base tabular">{fmtCurrency(total)}</strong>
        </div>
        <button
          type="button"
          onClick={confirm}
          disabled={!hasInk || submitting || !data.signer_name.trim()}
          className="btn btn-danger btn-lg"
        >
          {submitting ? (
            "Guardando…"
          ) : (
            <>
              <Icon name="check" size={15} stroke={2.4} /> Confirmar y enviar
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Summary side card                                                          */
/* ========================================================================== */

function SummaryCard({
  data,
  total,
  catalog,
  operator,
}: {
  data: WizardState;
  total: number;
  catalog: ServiceCatalogItem[];
  operator?: Operator;
}) {
  return (
    <div className="card p-5">
      <div className="eyebrow-tiny">Resumen en vivo</div>
      <div className="text-base font-bold text-fg-brand mb-4">Comprobante a generar</div>

      <SummaryRow label="Cliente" value={data.razon || "—"} />
      <SummaryRow label="CUIT" value={data.cuit || "—"} mono />
      <SummaryRow label="Depósito" value={data.depot === "MAGALDI" ? "Magaldi · CABA" : "Luján · BsAs"} />
      <SummaryRow label="Responsable" value={operator?.full_name ?? "—"} />
      <SummaryRow
        label="Horario"
        value={data.h_start && data.h_end ? `${data.h_start} – ${data.h_end}` : "—"}
      />

      <div className="mt-3 pt-3 border-t border-stroke-soft">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted mb-2">
          Servicios
        </div>
        {data.services.length === 0 && (
          <div className="text-xs text-fg-muted italic">Sin servicios seleccionados.</div>
        )}
        {data.services.map((slug) => {
          const s = catalog.find((c) => c.slug === slug);
          if (!s) return null;
          const q = data.qty[slug] ?? 1;
          return (
            <div
              key={slug}
              className="flex justify-between text-xs py-1.5 border-b border-stroke-soft last:border-b-0"
            >
              <span className="text-fg-primary">
                {s.label} · <span className="text-fg-muted">{q} {s.unit}</span>
              </span>
              <span className="font-bold tabular">{fmtCurrency(s.rate * q)}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 p-3 bg-tops-blue-900 text-white rounded-md flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/60 font-bold">
            Total estimado
          </div>
          <div className="text-xs text-white/70">+ IVA</div>
        </div>
        <div className="text-2xl font-bold tabular">{fmtCurrency(total)}</div>
      </div>

      {data.observ && (
        <div className="mt-3 text-xs text-fg-secondary">
          <strong className="text-fg-primary">Observaciones:</strong> {data.observ}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between text-xs py-1.5">
      <span className="text-fg-muted">{label}</span>
      <span className={cn("font-semibold text-fg-primary text-right max-w-[60%] truncate", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}

function Field({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-0">
      <div className="field-label">
        {label}
        {required && <span className="req">*</span>}
        {help && (
          <span className="ml-2 text-fg-muted font-normal normal-case tracking-normal">· {help}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function initial(firstClient?: Client): WizardState {
  return {
    client_id: firstClient?.id ?? null,
    razon: firstClient?.razon ?? "",
    cuit: firstClient?.cuit ?? "",
    domicilio: firstClient?.domicilio ?? "",
    telefono: firstClient?.telefono ?? "",
    contacto: firstClient?.contacto ?? "",
    email: firstClient?.email ?? "",
    depot: "MAGALDI",
    operator_id: "",
    services: [],
    qty: {},
    h_start: "08:00",
    h_end: "12:00",
    pallets: 0,
    units: 0,
    km: 0,
    observ: "",
    signer_name: firstClient?.contacto ?? "",
    signer_doc: "",
    signature_data: null,
    signature_hash: null,
    geo_lat: null,
    geo_lng: null,
  };
}
