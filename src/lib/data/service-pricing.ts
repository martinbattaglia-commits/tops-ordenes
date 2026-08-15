import { env } from "@/lib/env";
import { SERVICES_CATALOG } from "@/lib/services-catalog";
import { VEHICLES } from "@/lib/pricing/vehicles";
import { createClient } from "@/lib/supabase/server";
import type { ServiceCatalogItem, ServiceUnit } from "@/lib/types";
import type { VehicleSpec, VehicleZoneKey } from "@/lib/pricing/vehicles";

export interface ServiceRatePayload {
  tariffRateId: string;
  label: string;
  category: string;
  unit: ServiceUnit;
  rate: number | null;
  minQty: number;
  minBilling: number;
  requiresQuote: boolean;
  metadata: Record<string, unknown>;
}

export interface ClientServiceRatePayload {
  clientRateId: string;
  rate: number;
  minQty: number | null;
  minBilling: number | null;
}

export interface ServicePricingPayload {
  versionId: string | null;
  versionCode: string;
  currency: "ARS" | "USD";
  catalog: ServiceCatalogItem[];
  vehicles: VehicleSpec[];
  generalRates: Record<string, ServiceRatePayload>;
  clientRates: Record<string, Record<string, ClientServiceRatePayload>>;
  canAdjust: boolean;
}

function legacyPayload(): ServicePricingPayload {
  const generalRates: Record<string, ServiceRatePayload> = {};
  for (const service of SERVICES_CATALOG) {
    generalRates[service.slug] = {
      tariffRateId: service.id,
      label: service.label,
      category: service.category ?? "otros",
      unit: service.unit,
      rate: service.rate != null && service.rate > 0 ? service.rate : null,
      minQty: service.min_qty ?? 0,
      minBilling: service.min_billing ?? 0,
      requiresQuote: service.rate == null || service.rate <= 0,
      metadata: {},
    };
  }
  for (const vehicle of VEHICLES) {
    for (const zone of vehicle.zones) {
      const slug = `transporte:${vehicle.slug}:${zone.zone}`;
      generalRates[slug] = {
        tariffRateId: slug,
        label: `${vehicle.label} · ${zone.label}`,
        category: "transporte",
        unit: "viaje",
        rate: zone.price,
        minQty: 0,
        minBilling: 0,
        requiresQuote: zone.price == null,
        metadata: { vehicle: vehicle.slug, zone: zone.zone },
      };
    }
  }
  return {
    versionId: null,
    versionCode: "CATALOGO-LOCAL-PRE-0244",
    currency: "ARS",
    catalog: SERVICES_CATALOG.map((s) => ({
      ...s,
      requires_quote: s.rate == null || s.rate <= 0,
    })),
    vehicles: VEHICLES,
    generalRates,
    clientRates: {},
    canAdjust: true,
  };
}

/**
 * Carga el tarifario vigente y los precios particulares para el wizard.
 * La UI usa esta informacion solo como preview: `service_order_issue` vuelve
 * a resolver todo dentro de la transaccion y es la autoridad final.
 */
export async function loadServicePricing(): Promise<ServicePricingPayload> {
  if (env.app.demoMode) return legacyPayload();
  const supabase = createClient();
  if (!supabase) throw new Error("loadServicePricing: backend no disponible");

  const asOf = new Date().toISOString();
  const { data: version, error: versionError } = await supabase
    .from("service_tariff_versions")
    .select("id, code, currency")
    .in("status", ["active", "superseded"])
    .lte("effective_from", asOf)
    .or(`effective_to.is.null,effective_to.gt.${asOf}`)
    .maybeSingle();
  if (versionError || !version) {
    throw new Error(
      `loadServicePricing.version: ${versionError?.message ?? "no hay tarifario activo"}`
    );
  }

  const [
    { data: rates, error: ratesError },
    { data: overrides, error: overridesError },
    { data: canAdjust, error: adjustError },
  ] =
    await Promise.all([
      supabase
        .from("service_tariff_rates")
        .select("id, service_slug, label, category, unit, rate, min_qty, min_billing, requires_quote, metadata")
        .eq("version_id", version.id),
      supabase
        .from("client_service_rates")
        .select("id, client_id, service_slug, rate, min_qty, min_billing, currency")
        .eq("currency", version.currency)
        .lte("valid_from", asOf)
        .or(`valid_to.is.null,valid_to.gt.${asOf}`),
      supabase.rpc("has_permission", { p_slug: "servicios.edit" }),
    ]);
  if (ratesError) throw new Error(`loadServicePricing.rates: ${ratesError.message}`);
  if (overridesError) throw new Error(`loadServicePricing.clientRates: ${overridesError.message}`);
  if (adjustError) throw new Error(`loadServicePricing.adjustPermission: ${adjustError.message}`);

  const generalRates: Record<string, ServiceRatePayload> = {};
  for (const row of rates ?? []) {
    generalRates[row.service_slug] = {
      tariffRateId: row.id,
      label: row.label,
      category: row.category,
      unit: row.unit as ServiceUnit,
      rate: row.rate == null ? null : Number(row.rate),
      minQty: Number(row.min_qty ?? 0),
      minBilling: Number(row.min_billing ?? 0),
      requiresQuote: Boolean(row.requires_quote),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    };
  }

  const clientRates: ServicePricingPayload["clientRates"] = {};
  for (const row of overrides ?? []) {
    const byClient = (clientRates[row.client_id] ??= {});
    byClient[row.service_slug] = {
      clientRateId: row.id,
      rate: Number(row.rate),
      minQty: row.min_qty == null ? null : Number(row.min_qty),
      minBilling: row.min_billing == null ? null : Number(row.min_billing),
    };
  }

  const localVisual = new Map(SERVICES_CATALOG.map((service) => [service.slug, service]));
  const catalog: ServiceCatalogItem[] = Object.entries(generalRates)
    .filter(([slug, rate]) => !slug.startsWith("transporte:") && rate.category !== "transporte")
    .map(([slug, rate]) => {
    const visual = localVisual.get(slug);
    return {
      id: rate.tariffRateId,
      slug,
      label: rate.label,
      category: rate.category,
      unit: rate.unit,
      rate: rate.rate,
      min_qty: rate.minQty || undefined,
      min_billing: rate.minBilling || undefined,
      requires_quote: rate.requiresQuote,
      tariff_rate_id: rate.tariffRateId,
      tariff_version_id: version.id,
      observ: visual?.observ,
      icon: visual?.icon ?? null,
      active: true,
    };
  });

  const allowedZones = new Set<VehicleZoneKey>(["CABA", "40KM", "60KM", "80KM", "100KM", "MAS_100"]);
  const vehicleMap = new Map<string, VehicleSpec>();
  for (const [slug, rate] of Object.entries(generalRates)) {
    if (!slug.startsWith("transporte:") || rate.category !== "transporte") continue;
    const vehicleSlug = typeof rate.metadata.vehicle === "string" ? rate.metadata.vehicle : slug.split(":")[1];
    const zoneKey = typeof rate.metadata.zone === "string" ? rate.metadata.zone : slug.split(":")[2];
    if (!vehicleSlug || !allowedZones.has(zoneKey as VehicleZoneKey)) continue;
    const base = VEHICLES.find((vehicle) => vehicle.slug === vehicleSlug);
    const vehicle = vehicleMap.get(vehicleSlug) ?? {
      slug: vehicleSlug,
      label: base?.label ?? rate.label.split(/\s[-·]\s/)[0] ?? vehicleSlug,
      brand: base?.brand ?? "TOPS",
      model: base?.model ?? "—",
      capacity_pallets: base?.capacity_pallets ?? 0,
      icon: base?.icon ?? "truck",
      zones: [],
    };
    const baseZone = base?.zones.find((zone) => zone.zone === zoneKey);
    vehicle.zones.push({
      zone: zoneKey as VehicleZoneKey,
      label: rate.label,
      km_max: baseZone?.km_max ?? null,
      price: rate.rate,
    });
    vehicleMap.set(vehicleSlug, vehicle);
  }
  const vehicles = Array.from(vehicleMap.values());

  return {
    versionId: version.id,
    versionCode: version.code,
    currency: version.currency as "ARS" | "USD",
    catalog,
    vehicles,
    generalRates,
    clientRates,
    canAdjust: canAdjust === true,
  };
}

export async function canAdjustServicePricing(): Promise<boolean> {
  if (env.app.demoMode) return true;
  if (env.app.needsSupabase) return false;
  const supabase = createClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("has_permission", {
    p_slug: "servicios.edit",
  });
  if (error) throw new Error(`canAdjustServicePricing: ${error.message}`);
  return data === true;
}
