import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listClients } from "@/lib/data/orders";
import { loadServicePricing } from "@/lib/data/service-pricing";
import { TarifasConsole } from "./TarifasConsole";

export const metadata = { title: "Tarifas de servicios" };
export const dynamic = "force-dynamic";

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
        category: service.category || "servicios",
        requiresQuote: service.requires_quote ?? (pricing.generalRates[service.slug]?.requiresQuote ?? false),
        listRate: pricing.generalRates[service.slug]?.rate ?? null,
      })),
    ...Object.entries(pricing.generalRates)
      .filter(([slug, rate]) => slug.startsWith("transporte:") && rate.category === "transporte")
      .map(([slug, rate]) => ({
        slug,
        label: rate.label,
        unit: rate.unit,
        category: "transporte",
        requiresQuote: rate.requiresQuote,
        listRate: rate.rate,
      })),
  ];

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/orders" className="btn btn-ghost btn-sm">
          <Icon name="arrow-left" size={13} /> Órdenes
        </Link>
        <Link href="/orders/new" className="btn btn-ghost btn-sm">
          <Icon name="plus" size={13} /> Nueva Orden
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
        <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${
          searchParams.result === "approved"
            ? "border-status-success/30 bg-status-success/10 text-status-success"
            : "border-tops-red/30 bg-tops-red/5 text-tops-red"
        }`}>
          {searchParams.message}
        </div>
      )}

      <TarifasConsole
        pricing={pricing}
        services={rates}
        clients={clients.map((c) => ({
          id: c.id,
          razon: c.razon,
          cuit: c.cuit,
          activo: c.activo !== false,
        }))}
      />
    </div>
  );
}
