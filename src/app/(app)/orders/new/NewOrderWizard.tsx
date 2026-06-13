"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { cn, fmtCurrency, isValidCuit, sha256, URGENT_SERVICE_SLUG } from "@/lib/utils";
import { createOrder } from "./actions";
import type { Client, Operator, ServiceCatalogItem } from "@/lib/types";
import { DEPOT_META } from "@/lib/types";
import {
  VEHICLES,
  getVehicle,
  getVehicleZone,
  suggestVehicleByPallets,
  TRANSPORT_RULES,
  type VehicleZoneKey,
  type VehicleSpec,
} from "@/lib/pricing/vehicles";
import {
  computeServiceLine,
  computeTransportLine,
  sumLines,
  ivaEstimate,
  type LineItem,
} from "@/lib/pricing/calculator";
import { SERVICE_CATEGORIES, unitLabel } from "@/lib/services-catalog";

interface Props {
  clients: Client[];
  operators: Operator[];
  catalog: ServiceCatalogItem[];
}

interface ConceptoLibre {
  enabled: boolean;
  label: string;
  price: number;
  observ: string;
}

interface TransportSelection {
  vehicle_slug: string;
  zone: VehicleZoneKey;
  trips: number;
  second_trip_discount: boolean;
  surcharge: "none" | "17_19" | "19_21" | "21_plus";
}

/**
 * Bonificación comercial sobre una línea ya incorporada a la orden. Referencia
 * a la línea destino por su `key` estable (svc:slug, trip:slug:zona,
 * concepto-libre, etc.). Se modela como línea NEGATIVA propia para conservar la
 * trazabilidad: el servicio original queda visible + la bonificación aparte.
 */
interface Bonification {
  /** key del LineItem destino que se bonifica. */
  target_key: string;
  /** "pct" = porcentaje (100/75/50/25/10…) · "fixed" = importe fijo en ARS. */
  type: "pct" | "fixed";
  /** pct: 1..100 · fixed: importe positivo a descontar (se topea al subtotal). */
  value: number;
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
  /** Transportes seleccionados (multi-vehículo: cada uno con su zona/viajes/recargo). */
  transports: TransportSelection[];
  /** Envío urgente (mismo día): aplica recargo del 100% sobre el transporte. */
  transport_urgent: boolean;
  /** Bonificaciones comerciales aplicadas a líneas de la orden (trazabilidad). */
  bonifications: Bonification[];
  h_start: string;
  h_end: string;
  pallets: number;
  units: number;
  km: number;
  observ: string;
  concepto_libre: ConceptoLibre;
  signer_name: string;
  signer_doc: string;
  signature_data: string | null;
  signature_hash: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
}

const STEPS = ["Cliente", "Operativo", "Servicio", "Firma"];
const DRAFT_KEY = "tops:new-order:draft:v3";

/** Parsea un value de <input type="number"> a entero ≥ 0. Nunca devuelve NaN. */
function safeNonNegInt(raw: string): number {
  if (raw === "" || raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

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

  // ==========================================================================
  // Motor de Precio Inteligente:
  //  - Cada servicio seleccionado pasa por computeServiceLine (aplica min_qty
  //    y min_billing del catálogo).
  //  - Si hay transporte configurado, computeTransportLine añade el viaje
  //    con su zona, descuento de segundo viaje y recargos por horario.
  //  - El total final es la suma de líneas. La UI muestra desglose y badges
  //    de "mínimo aplicado".
  // ==========================================================================
  const lines: LineItem[] = useMemo(() => {
    const out: LineItem[] = [];
    for (const slug of data.services) {
      const svc = catalog.find((c) => c.slug === slug);
      if (!svc) continue;
      const q = data.qty[slug] ?? 1;
      out.push(computeServiceLine(svc, q));
    }
    // Multi-vehículo: una línea de transporte por cada vehículo seleccionado.
    let transportSum = 0;
    for (const t of data.transports) {
      const v = getVehicle(t.vehicle_slug);
      const z = v ? getVehicleZone(v.slug, t.zone) : undefined;
      if (v && z) {
        const tl = computeTransportLine({
          vehicle: v,
          zone: z,
          trips: t.trips,
          secondTripDiscount: t.second_trip_discount,
          surcharge: t.surcharge,
        });
        transportSum += tl.subtotal;
        out.push(tl);
      }
    }
    // Envío urgente (mismo día): recargo del 100% sobre el transporte. Se modela
    // como línea propia para que persista y se refleje en resumen, comprobante,
    // PDF, emails e historial SIN tocar el cálculo de transporte ni migraciones.
    if (data.transport_urgent && transportSum > 0) {
      out.push({
        key: URGENT_SERVICE_SLUG,
        label: "🚨 Recargo envío urgente (+100%)",
        qty_requested: 1,
        qty_effective: 1,
        rate: transportSum,
        unit: "un",
        subtotal: transportSum,
        min_applied: false,
        min_reason: "Despacho prioritario para ejecución el mismo día.",
        service_slug: URGENT_SERVICE_SLUG,
        category: "transporte",
      });
    }
    const cl = data.concepto_libre;
    if (cl.enabled && cl.label.trim() && cl.price > 0) {
      out.push({
        key: "concepto-libre",
        label: cl.label.trim(),
        qty_requested: 1,
        qty_effective: 1,
        rate: cl.price,
        unit: "un",
        subtotal: cl.price,
        min_applied: false,
        service_slug: "concepto-libre",
        category: "personalizado",
      });
    }
    // Bonificaciones comerciales: por cada bonificación cuyo destino siga
    // presente (línea positiva), se agrega una línea NEGATIVA propia. El
    // servicio original queda intacto y visible → trazabilidad total. El
    // descuento se topea al subtotal del destino (nunca deja la línea < $0).
    for (const b of data.bonifications) {
      const target = out.find((l) => l.key === b.target_key && l.subtotal > 0);
      if (!target) continue;
      const raw =
        b.type === "pct"
          ? Math.round(target.subtotal * (b.value / 100))
          : Math.round(b.value);
      const amount = Math.min(Math.max(0, raw), target.subtotal);
      if (amount <= 0) continue;
      out.push({
        key: `bonif:${b.target_key}`,
        label: `Bonificación · ${target.label}`,
        qty_requested: 1,
        qty_effective: 1,
        rate: -amount,
        unit: "un",
        subtotal: -amount,
        min_applied: false,
        min_reason:
          b.type === "pct"
            ? `Bonificación comercial ${b.value}% sobre ${target.label}.`
            : `Bonificación comercial (importe fijo) sobre ${target.label}.`,
        service_slug: `bonif:${b.target_key}`,
        category: "bonificacion",
      });
    }
    return out;
  }, [
    data.services,
    data.qty,
    data.transports,
    data.transport_urgent,
    data.concepto_libre,
    data.bonifications,
    catalog,
  ]);

  const total = useMemo(() => sumLines(lines), [lines]);
  const ivaEst = useMemo(() => ivaEstimate(total), [total]);

  const canAdvance = () => {
    if (stepIdx === 0) return data.razon.trim().length > 1 && data.cuit.replace(/\D/g, "").length === 11;
    if (stepIdx === 1) return Boolean(data.depot && data.operator_id);
    if (stepIdx === 2) {
      const cl = data.concepto_libre;
      const conceptoOk = cl.enabled && cl.label.trim().length > 0 && cl.price > 0;
      return data.services.length > 0 || data.transports.length > 0 || conceptoOk;
    }
    return true;
  };

  const goNext = () => setStepIdx((s) => Math.min(STEPS.length - 1, s + 1));
  const goPrev = () => setStepIdx((s) => Math.max(0, s - 1));

  const handleSubmit = async (sig: { data: string; hash: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      // Coerción defensiva: el server ya hace preprocess Zod, pero blindamos
      // acá también para que el payload viaje limpio y los logs sean claros.
      const numOr0 = (v: unknown) => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
      };
      const numOrDefault = (v: unknown, def: number) => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : def;
      };

      // Convertimos las líneas calculadas (con mínimos aplicados) al formato
      // OrderService que espera el server. Cada línea ya tiene su subtotal
      // final correcto — el server confía en estos valores y revalida con Zod.
      //
      // Defensa contra DB sin migration 0007: si el enum aún no tiene
      // 'm3' o 'viaje', los mapeamos a 'un' para que el insert no falle.
      // El label preserva la unidad real ("Picking · 5 m³" o "Qubo · 1 viaje")
      // para que el comprobante PDF y el detalle de orden lo muestren bien.
      const SUPPORTED_UNITS = new Set(["hs", "km", "pal", "mes", "un"]);
      const normalizeUnit = (u: string): "hs" | "km" | "pal" | "mes" | "un" => {
        return (SUPPORTED_UNITS.has(u) ? u : "un") as "hs" | "km" | "pal" | "mes" | "un";
      };

      const services = lines
        .filter((ln) => ln.service_slug || ln.vehicle_slug)
        .map((ln) => {
          const slug = ln.service_slug ?? `transporte:${ln.vehicle_slug}`;
          const realUnit = ln.unit || "un";
          // Embebemos la unidad real en el label cuando no es estándar, así
          // queda visible en el comprobante sin depender de la migration.
          const isExtendedUnit = !SUPPORTED_UNITS.has(realUnit);
          const label = isExtendedUnit
            ? `${ln.label} · ${unitLabel(realUnit)}`
            : ln.label;
          // Las bonificaciones son líneas NEGATIVAS: NO se clampan a ≥0 (si no,
          // se perdería el descuento). El resto de los servicios sí (no admiten
          // importes negativos por error de cálculo).
          const isBonif = slug.startsWith("bonif:");
          const rate = isBonif
            ? numOrDefault(ln.rate, 0)
            : Math.max(0, numOrDefault(ln.rate, 0));
          const subtotal = isBonif
            ? numOrDefault(ln.subtotal, 0)
            : Math.max(0, numOrDefault(ln.subtotal, 0));
          return {
            service_slug: slug,
            label,
            qty: Math.max(1, numOrDefault(ln.qty_effective, 1)),
            unit: normalizeUnit(realUnit),
            rate,
            subtotal,
          };
        });

      // Pre-check rápido del lado cliente — evita un round-trip si falta
      // algo obvio. El server siempre vuelve a validar.
      const signerName = data.signer_name.trim();
      if (signerName.length < 2) {
        setError("Ingresá el nombre completo del firmante (mínimo 2 caracteres).");
        setSubmitting(false);
        return;
      }
      if (services.length === 0) {
        setError("Seleccioná al menos un servicio o un transporte antes de confirmar.");
        setSubmitting(false);
        return;
      }

      // Fusionamos la observación del concepto libre (si la hay) en la
      // observación general de la orden — así no se pierde al guardar
      // (la línea de concepto libre sólo viaja con label/precio).
      const cl = data.concepto_libre;
      const conceptoObserv =
        cl.enabled && cl.label.trim() && cl.observ.trim()
          ? `${cl.label.trim()}: ${cl.observ.trim()}`
          : "";
      const combinedObserv = [data.observ ?? "", conceptoObserv]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" · ")
        .slice(0, 2000);

      const result = await createOrder({
        client: {
          id: data.client_id,
          razon: data.razon.trim(),
          cuit: data.cuit.trim(),
          domicilio: data.domicilio.trim(),
          telefono: data.telefono.trim(),
          contacto: data.contacto.trim(),
          email: data.email.trim(),
        },
        depot: data.depot,
        operator_id: data.operator_id,
        services,
        h_start: data.h_start || "08:00",
        h_end: data.h_end || "12:00",
        pallets: numOr0(data.pallets),
        units: numOr0(data.units),
        km: numOr0(data.km),
        observ: combinedObserv,
        total: Math.max(0, numOrDefault(total, 0)),
        signature: {
          signed_by: signerName,
          signed_doc: data.signer_doc?.trim() || null,
          data_url: sig.data,
          hash: sig.hash,
          geo_lat: typeof data.geo_lat === "number" ? data.geo_lat : null,
          geo_lng: typeof data.geo_lng === "number" ? data.geo_lng : null,
        },
      });

      if (!result.ok) {
        setError(result.error ?? "No pudimos guardar la orden. Intentá de nuevo en un momento.");
        setSubmitting(false);
        return;
      }

      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}

      router.push(`/orders/${result.public_id}?created=1`);
    } catch (e) {
      console.error("[NewOrderWizard] submit failed", e);
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Error inesperado al guardar la orden. Probá nuevamente."
      );
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
            <StepServicio
              catalog={catalog}
              data={data}
              update={update}
              total={total}
              lines={lines}
              ivaEst={ivaEst}
            />
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
            <div
              role="alert"
              className="mt-4 rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2.5 border border-status-danger/20"
            >
              <div className="flex items-start gap-2">
                <Icon name="x" size={14} className="mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold mb-0.5">No pudimos guardar la orden</div>
                  {error.split(" · ").map((line, i) => (
                    <div key={i} className="leading-relaxed">
                      {line}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="text-status-danger/70 hover:text-status-danger text-xs underline shrink-0"
                >
                  Cerrar
                </button>
              </div>
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
            lines={lines}
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
          <div className="absolute z-20 left-0 right-0 mt-1.5 bg-bg-surface border border-stroke-soft rounded-lg shadow-lg overflow-hidden max-h-80 overflow-y-auto">
            <div className="px-3 py-2 text-[10px] uppercase tracking-[0.12em] font-bold text-fg-muted bg-bg-surface-alt border-b border-stroke-soft">
              {search ? "Coincidencias" : "Clientes recientes"}
            </div>
            {filtered.map((c) => {
              const isSelected = Boolean(data.cuit) && c.cuit === data.cuit;
              return (
              <button
                type="button"
                key={c.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                className={cn(
                  "w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-stroke-soft cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tops-blue-700",
                  isSelected
                    ? "bg-tops-blue-700/15 ring-1 ring-inset ring-tops-blue-700"
                    : "hover:bg-bg-surface-alt hover:ring-1 hover:ring-inset hover:ring-tops-blue-700/40"
                )}
              >
                <div className="w-7 h-7 rounded-md bg-tops-blue-700 text-white grid place-items-center text-xs font-bold shrink-0">
                  {c.razon[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate text-fg-primary">{c.razon}</div>
                  <div className="text-[11px] text-fg-secondary font-mono">{c.cuit}</div>
                </div>
                <div className="flex gap-1 shrink-0 items-center">
                  {isSelected && <Icon name="check-circle" size={14} className="text-tops-blue-700" />}
                  {c.tags.slice(0, 2).map((t) => (
                    <span
                      key={t}
                      className={cn(
                        "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                        t === "ANMAT"
                          ? "bg-tops-red/15 text-tops-red"
                          : "bg-tops-blue-700/15 text-fg-link"
                      )}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </button>
              );
            })}
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
            name={DEPOT_META.MAGALDI.label}
            address={DEPOT_META.MAGALDI.address}
            capabilities={DEPOT_META.MAGALDI.capabilities}
            ops={6}
          />
          <DepotCard
            selected={data.depot === "LUJAN"}
            onClick={() => update({ depot: "LUJAN" })}
            name={DEPOT_META.LUJAN.label}
            address={DEPOT_META.LUJAN.address}
            capabilities={DEPOT_META.LUJAN.capabilities}
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
                    : "border-stroke-soft bg-bg-surface hover:border-tops-blue-700/40"
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
  capabilities,
  ops,
}: {
  selected: boolean;
  onClick: () => void;
  name: string;
  address: string;
  capabilities: string[];
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
          : "bg-bg-surface text-fg-primary border-stroke-soft hover:border-tops-blue-700/40"
      )}
    >
      <div className="flex items-center gap-2 mb-1.5 pr-6">
        <Icon name="building" size={15} />
        <span className="text-sm font-bold">{name}</span>
      </div>
      <div className={cn("text-[11px] mb-2", selected ? "text-white/70" : "text-fg-muted")}>
        {address}
      </div>
      {/* Clasificación operativa real de la sede (ANMAT / General / Oficinas). */}
      <div className="flex flex-wrap gap-1 mb-2">
        {capabilities.map((c) => (
          <span
            key={c}
            className={cn(
              "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
              selected ? "bg-white/16 text-white" : "bg-tops-red/10 text-tops-red"
            )}
          >
            {c}
          </span>
        ))}
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
  lines,
  ivaEst,
}: {
  catalog: ServiceCatalogItem[];
  data: WizardState;
  update: (p: Partial<WizardState>) => void;
  total: number;
  lines: LineItem[];
  ivaEst: number;
}) {
  const patchConceptoLibre = (patch: Partial<ConceptoLibre>) =>
    update({ concepto_libre: { ...data.concepto_libre, ...patch } });
  const toggle = (slug: string) => {
    const next = data.services.includes(slug)
      ? data.services.filter((s) => s !== slug)
      : [...data.services, slug];
    const qty = { ...data.qty };
    if (!qty[slug]) qty[slug] = 1;
    update({ services: next, qty });
  };

  const setQty = (slug: string, qty: number) => {
    update({ qty: { ...data.qty, [slug]: Math.max(1, qty) } });
  };

  // Servicios agrupados por categoría visible.
  const grouped = useMemo(() => {
    const byCat: Record<string, ServiceCatalogItem[]> = {};
    for (const svc of catalog) {
      if (!svc.active) continue;
      const cat = svc.category ?? "otros";
      (byCat[cat] = byCat[cat] || []).push(svc);
    }
    return byCat;
  }, [catalog]);

  return (
    <div>
      <div className="eyebrow-tiny">Paso 3 de 4</div>
      <h2 className="text-xl font-bold text-fg-brand mb-1">Detalle del servicio</h2>
      <p className="text-sm text-fg-secondary mb-5">
        Configurá transporte y/o servicios operativos. El precio se calcula en tiempo real
        con tarifas vigentes 2026.
      </p>

      {/* ============ TRANSPORTE ============ */}
      <TransportSection data={data} update={update} />

      {/* ============ SERVICIOS POR CATEGORÍA ============ */}
      {SERVICE_CATEGORIES.map((cat) => {
        const items = grouped[cat.key] ?? [];
        if (items.length === 0) return null;
        return (
          <CategorySection
            key={cat.key}
            title={cat.label}
            iconName={cat.icon as "user" | "forklift" | "package" | "bill" | "building"}
            items={items}
            selected={data.services}
            qty={data.qty}
            onToggle={toggle}
            onQty={setQty}
          />
        );
      })}

      {/* ============ CONCEPTO LIBRE ============ */}
      <ConceptoLibreSection
        state={data.concepto_libre}
        onToggle={() => patchConceptoLibre({ enabled: !data.concepto_libre.enabled })}
        onChange={patchConceptoLibre}
      />

      {/* ============ BONIFICACIONES (al final del acordeón) ============ */}
      <BonificacionesSection
        bonifiableLines={lines.filter((l) => l.subtotal > 0 && l.category !== "bonificacion")}
        bonifications={data.bonifications}
        onChange={(next) => update({ bonifications: next })}
      />

      {/* ============ Datos operativos complementarios ============ */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
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
        <Field label="Pallets totales">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={data.pallets}
            onChange={(e) => update({ pallets: safeNonNegInt(e.target.value) })}
          />
        </Field>
        <Field label="Unidades">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={data.units}
            onChange={(e) => update({ units: safeNonNegInt(e.target.value) })}
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

      {/* ============ Desglose visual + total ============ */}
      <BreakdownCard lines={lines} total={total} ivaEst={ivaEst} />
    </div>
  );
}

// ============================================================================
// Sección: Transporte (vehículos + zonas)
// ============================================================================

function TransportSection({
  data,
  update,
}: {
  data: WizardState;
  update: (p: Partial<WizardState>) => void;
}) {
  const hasTransport = data.transports.length > 0;
  const [expanded, setExpanded] = useState<boolean>(hasTransport);
  // Si se restaura un borrador con transportes, abrimos la sección.
  useEffect(() => {
    if (hasTransport) setExpanded(true);
  }, [hasTransport]);

  const suggested = useMemo(
    () => (data.pallets > 0 ? suggestVehicleByPallets(data.pallets) : undefined),
    [data.pallets]
  );

  const isSelected = (slug: string) => data.transports.some((t) => t.vehicle_slug === slug);

  const toggleVehicle = (slug: string) => {
    if (isSelected(slug)) {
      update({ transports: data.transports.filter((t) => t.vehicle_slug !== slug) });
      return;
    }
    const v = getVehicle(slug);
    const defaultZone = (v?.zones[0]?.zone ?? "CABA") as VehicleZoneKey;
    update({
      transports: [
        ...data.transports,
        {
          vehicle_slug: slug,
          zone: defaultZone,
          trips: 1,
          second_trip_discount: false,
          surcharge: "none",
        },
      ],
    });
    setExpanded(true);
  };

  const patchVehicle = (slug: string, patch: Partial<TransportSelection>) => {
    update({
      transports: data.transports.map((t) =>
        t.vehicle_slug === slug ? { ...t, ...patch } : t
      ),
    });
  };

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between p-3 rounded-lg bg-tops-blue-900 text-white"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon name="truck" size={18} stroke={2} />
          <div className="text-left min-w-0">
            <div className="font-bold text-sm">Transporte por viaje</div>
            <div className="text-[11px] text-white/70 truncate">
              {hasTransport
                ? `${data.transports.length} vehículo${data.transports.length > 1 ? "s" : ""} seleccionado${data.transports.length > 1 ? "s" : ""}`
                : "Tarifario febrero 2026 · Por viaje (no por hora)"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasTransport && (
            <span className="text-[10px] font-bold tabular-nums bg-white/15 px-1.5 py-0.5 rounded">
              {data.transports.length}
            </span>
          )}
          <Icon
            name="chevron-right"
            size={14}
            className={cn("transition-transform duration-200 ease-out", expanded && "rotate-90")}
          />
        </div>
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden" {...(expanded ? {} : ({ inert: "" } as object))}>
          <div className="mt-2 p-4 rounded-lg border border-stroke-soft bg-bg-surface">
            <div className="text-[11px] font-bold uppercase tracking-wider text-fg-muted mb-2">
              Seleccioná uno o más vehículos
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
              {VEHICLES.map((v) => {
                const overCap = data.pallets > v.capacity_pallets;
                const sel = isSelected(v.slug);
                const isSuggested = suggested?.slug === v.slug;
                return (
                  <button
                    type="button"
                    key={v.slug}
                    onClick={() => toggleVehicle(v.slug)}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all duration-200 relative",
                      sel
                        ? "border-tops-red bg-tops-red/5 shadow-ring-brand"
                        : "border-stroke-soft bg-bg-surface hover:border-tops-blue-700/40"
                    )}
                    title={
                      overCap
                        ? `${v.label}: capacidad ${v.capacity_pallets} pallets, pediste ${data.pallets} — válido si repartís la carga entre varios vehículos`
                        : undefined
                    }
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className={cn(
                          "w-4 h-4 rounded border-2 grid place-items-center shrink-0",
                          sel ? "border-tops-red bg-tops-red" : "border-stroke-strong"
                        )}
                      >
                        {sel && <Icon name="check" size={9} stroke={2.8} className="text-white" />}
                      </div>
                      <Icon name="truck" size={14} />
                      <span className="text-sm font-bold">{v.label}</span>
                    </div>
                    <div className="text-[10px] text-fg-muted">{v.brand}</div>
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-tops-blue-700/10 text-tops-blue-700">
                        {v.capacity_pallets} pal
                      </span>
                      {isSuggested && !sel && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-status-success/10 text-status-success">
                          Sugerido
                        </span>
                      )}
                      {overCap && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning">
                          Excede
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 🚨 ENVÍO URGENTE — recargo +100%, destacado en rojo corporativo */}
            {hasTransport && (
              <button
                type="button"
                onClick={() => update({ transport_urgent: !data.transport_urgent })}
                aria-pressed={data.transport_urgent}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all duration-200",
                  data.transport_urgent
                    ? "border-tops-red bg-tops-red/10 shadow-ring-brand"
                    : "border-tops-red/40 bg-tops-red/[0.04] hover:bg-tops-red/[0.08]"
                )}
              >
                <div
                  className={cn(
                    "w-5 h-5 rounded border-2 grid place-items-center shrink-0",
                    data.transport_urgent ? "border-tops-red bg-tops-red" : "border-tops-red/60"
                  )}
                >
                  {data.transport_urgent && (
                    <Icon name="check" size={11} stroke={2.6} className="text-white" />
                  )}
                </div>
                <span className="text-lg leading-none" aria-hidden>
                  🚨
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-black uppercase tracking-wide text-tops-red">
                    Envío urgente{" "}
                    <span className="font-bold">(+100%)</span>
                  </div>
                  <div className="text-[11px] text-fg-secondary mt-0.5">
                    Despacho prioritario para ejecución el mismo día. Aplica un recargo del 100%
                    sobre el transporte.
                  </div>
                </div>
                {data.transport_urgent && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-tops-red text-white shrink-0">
                    Activo
                  </span>
                )}
              </button>
            )}

            {/* Bloque de configuración por cada vehículo seleccionado */}
            {data.transports.map((t) => {
              const v = getVehicle(t.vehicle_slug);
              if (!v) return null;
              return (
                <div
                  key={t.vehicle_slug}
                  className="mt-3 p-3 rounded-lg border border-tops-red/30 bg-tops-red/[0.03]"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon name="truck" size={14} className="text-tops-red" />
                      <span className="text-sm font-bold text-fg-primary">{v.label}</span>
                      <span className="text-[10px] text-fg-muted">· {v.capacity_pallets} pal</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleVehicle(t.vehicle_slug)}
                      className="text-[11px] text-fg-muted hover:text-status-danger inline-flex items-center gap-1"
                    >
                      <Icon name="x" size={11} /> Quitar
                    </button>
                  </div>

                  <div className="text-[11px] font-bold uppercase tracking-wider text-fg-muted mb-2">
                    Zona / distancia
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
                    {v.zones.map((z) => {
                      const isSel = t.zone === z.zone;
                      return (
                        <button
                          type="button"
                          key={z.zone}
                          onClick={() => patchVehicle(t.vehicle_slug, { zone: z.zone })}
                          className={cn(
                            "p-2.5 rounded-md border text-left transition-all duration-150",
                            isSel
                              ? "border-tops-blue-900 bg-tops-blue-900 text-white"
                              : "border-stroke-soft bg-bg-surface hover:border-tops-blue-700/40"
                          )}
                        >
                          <div className="text-xs font-bold">{z.label}</div>
                          <div
                            className={cn(
                              "text-[11px] tabular font-mono mt-0.5",
                              isSel ? "text-white/85" : "text-fg-muted"
                            )}
                          >
                            {z.price === null ? "A cotizar" : fmtCurrency(z.price)}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Cantidad de viajes">
                      <input
                        className="input"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={t.trips}
                        onChange={(e) =>
                          patchVehicle(t.vehicle_slug, {
                            trips: Math.max(1, safeNonNegInt(e.target.value) || 1),
                          })
                        }
                      />
                    </Field>
                    <Field label="Recargo horario (camión)">
                      <select
                        className="input"
                        value={t.surcharge}
                        onChange={(e) =>
                          patchVehicle(t.vehicle_slug, {
                            surcharge: e.target.value as TransportSelection["surcharge"],
                          })
                        }
                      >
                        <option value="none">Horario diurno (sin recargo)</option>
                        <option value="17_19">17–19 hs (+25%)</option>
                        <option value="19_21">19–21 hs (+50%)</option>
                        <option value="21_plus">+21 hs (+100%)</option>
                      </select>
                    </Field>
                    <Field label="2do viaje al 50%" help="Aplica si hay retorno / vuelta vacío">
                      <label className="input flex items-center gap-2 cursor-pointer h-[44px]">
                        <input
                          type="checkbox"
                          checked={t.second_trip_discount}
                          onChange={(e) =>
                            patchVehicle(t.vehicle_slug, { second_trip_discount: e.target.checked })
                          }
                          className="w-4 h-4 accent-tops-blue-900"
                        />
                        <span className="text-sm">Activar descuento</span>
                      </label>
                    </Field>
                  </div>
                </div>
              );
            })}

            {hasTransport && (
              <details className="text-[11px] text-fg-muted mt-3">
                <summary className="cursor-pointer hover:text-fg-primary">
                  Ver reglas operativas del tarifario
                </summary>
                <ul className="mt-2 pl-4 space-y-1 list-disc">
                  {TRANSPORT_RULES.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Control de cantidad: botones −/+ + campo editable de ingreso directo.
// Permite tipear superficies grandes (500, 1000, 2500 m²) sin clickear cientos
// de veces. Sólo enteros positivos; bloquea 0, negativos, texto y símbolos.
// ============================================================================

function QtyStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  // Buffer local de texto para permitir edición libre (incl. vacío transitorio)
  // sin que el valor "salte" a 1 en cada tecla. El padre recibe el entero
  // validado en vivo cuando es ≥ 1, y se normaliza al perder el foco.
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const handleChange = (raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, ""); // sólo dígitos: bloquea −, texto, símbolos
    setText(cleaned);
    const n = parseInt(cleaned, 10);
    if (Number.isFinite(n) && n >= 1) onChange(n); // actualiza en vivo (recalcula total)
  };

  // Normaliza al perder el foco leyendo el valor REAL del input (no el estado
  // de React, que puede ir un tick atrasado ante ediciones muy rápidas).
  const normalize = (raw: string) => {
    const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
    const safe = Number.isFinite(n) && n >= 1 ? n : 1; // vacío / 0 → 1
    setText(String(safe));
    onChange(safe);
  };

  return (
    <div className="flex items-center gap-1 bg-bg-surface border border-stroke-soft rounded-md p-0.5">
      <button
        type="button"
        aria-label="Restar"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="w-7 h-7 grid place-items-center text-fg-secondary hover:bg-bg-surface-alt rounded"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => normalize(e.currentTarget.value)}
        aria-label="Cantidad"
        className="w-16 text-center bg-transparent border-none font-bold text-fg-primary outline-none tabular"
        style={{ fontSize: "14px" }}
      />
      <button
        type="button"
        aria-label="Sumar"
        onClick={() => onChange(value + 1)}
        className="w-7 h-7 grid place-items-center text-fg-secondary hover:bg-bg-surface-alt rounded"
      >
        +
      </button>
    </div>
  );
}

// ============================================================================
// Sección: Categoría de servicios (toggle + qty inline)
// ============================================================================

function CategorySection({
  title,
  iconName,
  items,
  selected,
  qty,
  onToggle,
  onQty,
}: {
  title: string;
  iconName: "user" | "forklift" | "package" | "bill" | "building";
  items: ServiceCatalogItem[];
  selected: string[];
  qty: Record<string, number>;
  onToggle: (slug: string) => void;
  onQty: (slug: string, qty: number) => void;
}) {
  const selectedCount = items.filter((i) => selected.includes(i.slug)).length;
  const [open, setOpen] = useState<boolean>(selectedCount > 0);
  // Abrir si aparecen selecciones (p. ej. al restaurar un borrador).
  useEffect(() => {
    if (selectedCount > 0) setOpen(true);
  }, [selectedCount > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left",
          selectedCount > 0
            ? "border-tops-blue-700/40 bg-tops-blue-700/5"
            : "border-stroke-soft bg-bg-surface-alt hover:border-tops-blue-700/40"
        )}
      >
        <Icon name={iconName} size={16} className="text-tops-blue-700 shrink-0" />
        <span className="flex-1 text-sm font-bold text-fg-primary">{title}</span>
        {selectedCount > 0 && (
          <span className="text-[10px] font-bold tabular-nums bg-tops-blue-700 text-white px-1.5 py-0.5 rounded">
            {selectedCount}
          </span>
        )}
        <Icon
          name="chevron-right"
          size={14}
          className={cn(
            "text-fg-muted shrink-0 transition-transform duration-200 ease-out",
            open && "rotate-90"
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden" {...(open ? {} : ({ inert: "" } as object))}>
          <div className="grid grid-cols-1 gap-2 pt-2">
        {items.map((s) => {
          const isSel = selected.includes(s.slug);
          const q = qty[s.slug] ?? 1;
          return (
            <div
              key={s.slug}
              className={cn(
                "rounded-md border transition-colors duration-150",
                isSel
                  ? "border-tops-blue-700 bg-tops-blue-700/5"
                  : "border-stroke-soft bg-bg-surface hover:border-tops-blue-700/30"
              )}
            >
              <button
                type="button"
                onClick={() => onToggle(s.slug)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
              >
                <div
                  className={cn(
                    "w-5 h-5 rounded border-2 grid place-items-center shrink-0",
                    isSel ? "border-tops-blue-700 bg-tops-blue-700" : "border-stroke-strong"
                  )}
                >
                  {isSel && <Icon name="check" size={11} stroke={2.6} className="text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-fg-primary truncate">{s.label}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[11px] font-mono text-tops-red font-bold tabular">
                      {fmtCurrency(s.rate)} <span className="text-fg-muted font-sans font-normal">/ {unitLabel(s.unit)}</span>
                    </span>
                    {s.min_qty != null && s.min_qty > 1 && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning">
                        Mín {s.min_qty} {unitLabel(s.unit)}
                      </span>
                    )}
                    {s.min_billing != null && s.min_billing > 0 && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning">
                        Mín {fmtCurrency(s.min_billing)}
                      </span>
                    )}
                  </div>
                  {s.observ && (
                    <div className="text-[11px] text-fg-muted mt-1 italic">{s.observ}</div>
                  )}
                </div>
              </button>
              {isSel && (
                <div className="px-3 pb-2.5 flex items-center gap-3 border-t border-stroke-soft pt-2">
                  <div className="text-[11px] text-fg-muted font-bold uppercase">Cantidad</div>
                  <QtyStepper value={q} onChange={(n) => onQty(s.slug, n)} />
                  <div className="text-[11px] text-fg-muted">{unitLabel(s.unit)}</div>
                </div>
              )}
            </div>
          );
        })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sección: Concepto libre (facturación de ítems no catalogados)
// ============================================================================

function ConceptoLibreSection({
  state,
  onToggle,
  onChange,
}: {
  state: ConceptoLibre;
  onToggle: () => void;
  onChange: (patch: Partial<ConceptoLibre>) => void;
}) {
  const [open, setOpen] = useState<boolean>(state.enabled);
  // Abrir si el concepto se habilita (incluye restauración de borrador).
  useEffect(() => {
    if (state.enabled) setOpen(true);
  }, [state.enabled]);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left",
          state.enabled
            ? "border-tops-blue-700/40 bg-tops-blue-700/5"
            : "border-stroke-soft bg-bg-surface-alt hover:border-tops-blue-700/40"
        )}
      >
        <Icon name="sparkle" size={16} className="text-tops-blue-700 shrink-0" />
        <span className="flex-1 text-sm font-bold text-fg-primary">Servicios personalizados</span>
        {state.enabled && (
          <span className="text-[10px] font-bold tabular-nums bg-tops-blue-700 text-white px-1.5 py-0.5 rounded">
            1
          </span>
        )}
        <Icon
          name="chevron-right"
          size={14}
          className={cn(
            "text-fg-muted shrink-0 transition-transform duration-200 ease-out",
            open && "rotate-90"
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden" {...(open ? {} : ({ inert: "" } as object))}>
          <div className="pt-2">
      <div
        className={cn(
          "rounded-md border transition-colors duration-150",
          state.enabled
            ? "border-tops-blue-700 bg-tops-blue-700/5"
            : "border-stroke-soft bg-bg-surface hover:border-tops-blue-700/30"
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
        >
          <div
            className={cn(
              "w-5 h-5 rounded border-2 grid place-items-center shrink-0",
              state.enabled ? "border-tops-blue-700 bg-tops-blue-700" : "border-stroke-strong"
            )}
          >
            {state.enabled && <Icon name="check" size={11} stroke={2.6} className="text-white" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-fg-primary">Concepto libre</div>
            <div className="text-[11px] text-fg-muted mt-0.5 italic">
              Permite facturar conceptos no contemplados en el catálogo estándar.
            </div>
          </div>
        </button>

        {state.enabled && (
          <div className="px-3 pb-3 border-t border-stroke-soft pt-3 space-y-3">
            <Field label="Concepto" required>
              <input
                className="input"
                placeholder="Ej: Gestión especial, Servicio extraordinario, Honorarios…"
                value={state.label}
                onChange={(e) => onChange({ label: e.target.value })}
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Precio neto sin IVA" required>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted text-sm font-mono">$</span>
                  <input
                    className="input pl-7 tabular"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={1000}
                    placeholder="150000"
                    value={state.price || ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      onChange({ price: Number.isFinite(v) && v >= 0 ? v : 0 });
                    }}
                  />
                </div>
              </Field>
              <Field label="Observaciones" help="Opcional">
                <input
                  className="input"
                  placeholder="Detalle adicional…"
                  value={state.observ}
                  onChange={(e) => onChange({ observ: e.target.value })}
                />
              </Field>
            </div>
            {state.price > 0 && state.label.trim() && (
              <div className="text-xs text-fg-secondary flex items-center gap-1.5">
                <Icon name="check-circle" size={13} className="text-status-success shrink-0" />
                <span>
                  Se facturará: <strong className="text-fg-primary">{state.label.trim()}</strong> ·{" "}
                  <strong className="text-fg-brand tabular">{fmtCurrency(state.price)}</strong> neto + IVA
                </span>
              </div>
            )}
          </div>
        )}
      </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sección: Bonificaciones comerciales (descuentos con trazabilidad)
// ============================================================================

const BONIF_PCT_OPTIONS = [100, 75, 50, 25, 10] as const;

function BonificacionesSection({
  bonifiableLines,
  bonifications,
  onChange,
}: {
  bonifiableLines: LineItem[];
  bonifications: Bonification[];
  onChange: (next: Bonification[]) => void;
}) {
  // Sólo cuentan las bonificaciones cuyo destino sigue presente.
  const activeCount = bonifications.filter((b) =>
    bonifiableLines.some((l) => l.key === b.target_key)
  ).length;
  const [open, setOpen] = useState<boolean>(activeCount > 0);
  useEffect(() => {
    if (activeCount > 0) setOpen(true);
  }, [activeCount > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const getBonif = (key: string) => bonifications.find((b) => b.target_key === key);
  const toggle = (key: string) => {
    const exists = bonifications.some((b) => b.target_key === key);
    onChange(
      exists
        ? bonifications.filter((b) => b.target_key !== key)
        : [...bonifications, { target_key: key, type: "pct", value: 100 }]
    );
  };
  const patch = (key: string, p: Partial<Bonification>) =>
    onChange(bonifications.map((b) => (b.target_key === key ? { ...b, ...p } : b)));

  const computeAmount = (line: LineItem, b: Bonification) => {
    const raw =
      b.type === "pct" ? Math.round(line.subtotal * (b.value / 100)) : Math.round(b.value);
    return Math.min(Math.max(0, raw), line.subtotal);
  };

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left",
          activeCount > 0
            ? "border-status-success/50 bg-status-success/5"
            : "border-stroke-soft bg-bg-surface-alt hover:border-tops-blue-700/40"
        )}
      >
        <Icon name="tag-alt" size={16} className="text-status-success shrink-0" />
        <span className="flex-1 text-sm font-bold text-fg-primary">Bonificaciones</span>
        {activeCount > 0 && (
          <span className="text-[10px] font-bold tabular-nums bg-status-success text-white px-1.5 py-0.5 rounded">
            {activeCount}
          </span>
        )}
        <Icon
          name="chevron-right"
          size={14}
          className={cn(
            "text-fg-muted shrink-0 transition-transform duration-200 ease-out",
            open && "rotate-90"
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden" {...(open ? {} : ({ inert: "" } as object))}>
          <div className="pt-2">
            <div className="text-[11px] text-fg-muted mb-2 italic">
              Bonificá líneas ya cargadas. El servicio original queda visible y la bonificación se
              registra como una línea aparte (trazabilidad comercial completa).
            </div>
            {bonifiableLines.length === 0 ? (
              <div className="rounded-md border border-stroke-soft bg-bg-surface p-3 text-sm text-fg-muted italic text-center">
                Agregá servicios o transporte para poder bonificarlos.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {bonifiableLines.map((line) => {
                  const b = getBonif(line.key);
                  const sel = Boolean(b);
                  const amount = b ? computeAmount(line, b) : 0;
                  const net = line.subtotal - amount;
                  return (
                    <div
                      key={line.key}
                      className={cn(
                        "rounded-md border transition-colors duration-150",
                        sel
                          ? "border-status-success/50 bg-status-success/5"
                          : "border-stroke-soft bg-bg-surface hover:border-status-success/30"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggle(line.key)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                      >
                        <div
                          className={cn(
                            "w-5 h-5 rounded border-2 grid place-items-center shrink-0",
                            sel ? "border-status-success bg-status-success" : "border-stroke-strong"
                          )}
                        >
                          {sel && <Icon name="check" size={11} stroke={2.6} className="text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-fg-primary truncate">
                            {line.label}
                          </div>
                          <div className="text-[11px] text-fg-muted">
                            Vendido: <span className="tabular">{fmtCurrency(line.subtotal)}</span>
                          </div>
                        </div>
                      </button>

                      {sel && b && (
                        <div className="px-3 pb-3 border-t border-stroke-soft pt-3 space-y-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-fg-muted">
                              Tipo
                            </span>
                            <select
                              className="input h-9 py-0 w-auto"
                              value={b.type === "fixed" ? "fixed" : String(b.value)}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "fixed") patch(line.key, { type: "fixed", value: b.value && b.type === "fixed" ? b.value : 0 });
                                else patch(line.key, { type: "pct", value: parseInt(v, 10) });
                              }}
                            >
                              {BONIF_PCT_OPTIONS.map((p) => (
                                <option key={p} value={p}>
                                  {p}%{p === 100 ? " (total)" : ""}
                                </option>
                              ))}
                              <option value="fixed">Importe fijo</option>
                            </select>
                            {b.type === "fixed" && (
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted text-sm font-mono">
                                  $
                                </span>
                                <input
                                  className="input h-9 py-0 pl-7 tabular w-36"
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  step={1000}
                                  placeholder="100000"
                                  value={b.value || ""}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    patch(line.key, { value: Number.isFinite(v) && v >= 0 ? v : 0 });
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="inline-flex items-center gap-1.5 text-status-success font-semibold">
                              <Icon name="check-circle" size={13} className="shrink-0" />
                              Bonificación: −{fmtCurrency(amount)}
                            </span>
                            <span className="text-fg-secondary">
                              Subtotal: <strong className="text-fg-primary tabular">{fmtCurrency(net)}</strong>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Card: Desglose visual del precio inteligente
// ============================================================================

function BreakdownCard({
  lines,
  total,
  ivaEst,
}: {
  lines: LineItem[];
  total: number;
  ivaEst: number;
}) {
  return (
    <div className="mt-6 rounded-lg border border-stroke-soft bg-gradient-to-br from-tops-blue-900/5 to-tops-red/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-stroke-soft flex items-center gap-3 bg-bg-surface">
        <div className="w-8 h-8 rounded-md bg-tops-blue-900 text-white grid place-items-center shrink-0">
          <Icon name="sparkle" size={14} stroke={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-tops-red">
            Precio Inteligente
          </div>
          <div className="text-xs text-fg-secondary">
            Tarifas oficiales Logística TOPS · ENERO–FEBRERO 2026
          </div>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="p-4 text-center text-sm text-fg-muted italic">
          Seleccioná al menos un servicio o un transporte para ver el cálculo.
        </div>
      ) : (
        <div className="p-3 space-y-1.5">
          {lines.map((ln) => {
            const isBonif = ln.category === "bonificacion";
            return (
            <div
              key={ln.key}
              className={cn(
                "grid grid-cols-[1fr_auto] gap-3 items-start px-3 py-2 rounded-md",
                isBonif ? "bg-status-success/5 border border-status-success/30" : "bg-bg-surface-alt"
              )}
            >
              <div className="min-w-0">
                <div className={cn("text-sm font-semibold truncate", isBonif ? "text-status-success" : "text-fg-primary")}>
                  {ln.label}
                </div>
                <div className="text-[11px] text-fg-muted flex items-center gap-1.5 flex-wrap mt-0.5">
                  {!isBonif && (
                    <span>
                      {ln.qty_effective} {unitLabel(ln.unit)} × {fmtCurrency(ln.rate)}
                    </span>
                  )}
                  {ln.min_applied && ln.min_reason && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning">
                      Mínimo aplicado
                    </span>
                  )}
                </div>
                {ln.min_reason && (
                  <div className={cn("text-[11px] mt-0.5", isBonif ? "text-status-success" : "text-status-warning")}>
                    {ln.min_reason}
                  </div>
                )}
              </div>
              <div
                className={cn(
                  "text-sm font-bold tabular shrink-0 self-center",
                  isBonif ? "text-status-success" : "text-fg-brand"
                )}
              >
                {isBonif ? `− ${fmtCurrency(Math.abs(ln.subtotal))}` : fmtCurrency(ln.subtotal)}
              </div>
            </div>
            );
          })}
        </div>
      )}

      <div className="px-4 py-3 border-t border-stroke-soft bg-bg-surface flex items-center justify-between">
        <div className="text-xs text-fg-secondary">
          IVA estimado (21%): <strong className="text-fg-primary">{fmtCurrency(ivaEst)}</strong>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted font-bold">
            Total neto
          </div>
          <div className="text-2xl font-bold text-fg-brand tabular -tracking-[0.01em]">
            {fmtCurrency(total)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">+ IVA</div>
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

      <div className="mt-4 p-3 bg-bg-surface-alt rounded-lg flex gap-2 text-[11px] text-fg-secondary">
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
  lines,
  operator,
}: {
  data: WizardState;
  total: number;
  lines: LineItem[];
  operator?: Operator;
}) {
  return (
    <div className="card p-5">
      <div className="eyebrow-tiny">Resumen en vivo</div>
      <div className="text-base font-bold text-fg-brand mb-4">Comprobante a generar</div>

      {data.transport_urgent && data.transports.length > 0 && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-md bg-tops-red/10 border border-tops-red/40">
          <span aria-hidden>🚨</span>
          <span className="text-[11px] font-black uppercase tracking-wider text-tops-red">
            Envío urgente · +100%
          </span>
        </div>
      )}

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
          Items facturables
        </div>
        {lines.length === 0 && (
          <div className="text-xs text-fg-muted italic">Sin items seleccionados.</div>
        )}
        {lines.map((ln) => {
          const isBonif = ln.category === "bonificacion";
          return (
          <div
            key={ln.key}
            className="flex justify-between text-xs py-1.5 border-b border-stroke-soft last:border-b-0 gap-2"
          >
            <span className={cn("min-w-0 truncate", isBonif ? "text-status-success" : "text-fg-primary")}>
              {ln.label}
              {!isBonif && (
                <span className="text-fg-muted">
                  {" "}· {ln.qty_effective} {unitLabel(ln.unit)}
                </span>
              )}
            </span>
            <span className={cn("font-bold tabular shrink-0", isBonif && "text-status-success")}>
              {isBonif ? `− ${fmtCurrency(Math.abs(ln.subtotal))}` : fmtCurrency(ln.subtotal)}
            </span>
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
    transports: [],
    transport_urgent: false,
    bonifications: [],
    concepto_libre: { enabled: false, label: "", price: 0, observ: "" },
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

