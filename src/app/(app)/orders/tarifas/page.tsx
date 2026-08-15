import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listClients } from "@/lib/data/orders";
import { loadServicePricing } from "@/lib/data/service-pricing";
import { approveClientRateAction } from "./actions";

export const metadata = { title: "Tarifas de servicios" };
export const dynamic = "force-dynamic";

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

interface Props {
  searchParams?: { result?: string; message?: string };
}

export default async function ServiceTariffsPage({ searchParams }: Props) {
  const [pricing, clients] = await Promise.all([loadServicePricing(), listClients("edit")]);
  const rates = [
    ...pricing.catalog
      .filter((service) => service.active)
      .map((service) => ({
        slug: service.slug,
        label: service.label,
        unit: service.unit,
      })),
    ...Object.entries(pricing.generalRates)
      .filter(([slug, rate]) => slug.startsWith("transporte:") && rate.category === "transporte")
      .map(([slug, rate]) => ({ slug, label: rate.label, unit: rate.unit })),
  ];
  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/orders" className="btn btn-ghost btn-sm">
          <Icon name="arrow-left" size={13} /> Órdenes
        </Link>
      </div>
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Tarifario general versionado</div>
          <h1 className="page-title">Precios de servicios</h1>
          <p className="page-subtitle">
            Versión activa {pricing.versionCode} · moneda {pricing.currency}. Los conceptos sin
            tarifa permanecen A COTIZAR hasta aprobar un precio particular.
          </p>
        </div>
      </div>

      {searchParams?.message && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          searchParams.result === "approved"
            ? "border-status-success/30 bg-status-success/10 text-status-success"
            : "border-tops-red/30 bg-tops-red/5 text-tops-red"
        }`}>
          {searchParams.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-5 items-start">
        <div className="card overflow-hidden">
          <div className="card-pad border-b border-stroke-soft">
            <div className="font-bold text-fg-brand">Tarifas vigentes</div>
            <div className="text-xs text-fg-muted mt-1">Snapshot de la versión aprobada.</div>
          </div>
          <div className="divide-y divide-stroke-soft max-h-[680px] overflow-auto">
            {rates.map((service) => {
              const rate = pricing.generalRates[service.slug];
              return (
                <div key={service.slug} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-fg-primary">{service.label}</div>
                    <div className="text-[11px] text-fg-muted">{service.unit} · {service.slug}</div>
                  </div>
                  {rate?.requiresQuote || rate?.rate == null ? (
                    <span className="badge badge-warning">A COTIZAR</span>
                  ) : (
                    <span className="text-sm font-bold tabular text-fg-brand">
                      {new Intl.NumberFormat("es-AR", { style: "currency", currency: pricing.currency }).format(rate.rate)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card card-pad">
          <div className="font-bold text-fg-brand">Aprobar precio particular</div>
          <p className="text-xs text-fg-muted mt-1 mb-4">
            El precio queda versionado por cliente, con moneda, vigencia, responsable y motivo.
          </p>
          {!pricing.canAdjust ? (
            <div className="rounded-lg bg-neutral-50 border border-stroke-soft p-3 text-sm text-fg-secondary">
              Se requiere el permiso <span className="font-mono">servicios.edit</span>.
            </div>
          ) : (
            <form action={approveClientRateAction} className="space-y-3">
              <label className="block text-xs font-semibold">
                Cliente
                <select name="client_id" required className="input mt-1 w-full">
                  <option value="">Seleccionar…</option>
                  {clients.filter((client) => client.activo !== false).map((client) => (
                    <option key={client.id} value={client.id}>{client.razon} · {client.cuit}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold">
                Servicio
                <select name="service_slug" required className="input mt-1 w-full">
                  <option value="">Seleccionar…</option>
                  {rates.map((service) => (
                    <option key={service.slug} value={service.slug}>
                      {service.label}{pricing.generalRates[service.slug]?.requiresQuote ? " · A COTIZAR" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold">
                  Precio ({pricing.currency})
                  <input name="rate" type="number" min="0.01" step="0.01" required className="input mt-1 w-full" />
                </label>
                <label className="block text-xs font-semibold">
                  Vigente desde
                  <input name="valid_from" type="date" required defaultValue={todayInBuenosAires()} className="input mt-1 w-full" />
                </label>
              </div>
              <input type="hidden" name="currency" value={pricing.currency} />
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold">
                  Cantidad mínima
                  <input name="min_qty" type="number" min="0" step="0.01" className="input mt-1 w-full" />
                </label>
                <label className="block text-xs font-semibold">
                  Mínimo facturable
                  <input name="min_billing" type="number" min="0" step="0.01" className="input mt-1 w-full" />
                </label>
              </div>
              <label className="block text-xs font-semibold">
                Motivo / fuente aprobatoria
                <textarea name="reason" required minLength={3} className="input mt-1 w-full min-h-20" />
              </label>
              <button type="submit" className="btn btn-primary w-full">Aprobar precio</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
