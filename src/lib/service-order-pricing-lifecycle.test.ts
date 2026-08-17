import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeServiceLine, computeTransportLine } from "./pricing/calculator";
import type { ServiceCatalogItem } from "./types";
import type { VehicleSpec, VehicleZonePricing } from "./pricing/vehicles";

/**
 * X-1 · LINAJE. 0249:330 renombra `service_order_issue(jsonb,jsonb)` a
 * `service_order_issue_0244` y le revoca todo privilegio (0249:331). Desde
 * entonces la AUTORIDAD del ciclo de precios es 0249, y afirmar sobre el
 * cuerpo de 0244 describe código que nadie puede invocar.
 *
 * `sql` se conserva porque 0244 SIGUE siendo la definición vigente de todo lo
 * que 0249 no superseded: `service_order_adjust_billing`, los constraint
 * triggers de continuidad temporal, `_service_pricing_boundary` y el seed del
 * catálogo. Las aserciones sobre la emisión, en cambio, viven en `sqlFaseB`.
 */
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0244_service_order_pricing_lifecycle.sql"),
  "utf8"
);
const sqlFaseB = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0249_clientes_fase_b_service_pricing_redaction.sql"),
  "utf8"
);
const rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/ROLLBACK_0244_service_order_pricing_lifecycle.sql"),
  "utf8"
);
const m2Rates = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260815002807_service_tariff_m2_rates.sql"),
  "utf8"
);
const m2Rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/ROLLBACK_20260815002748_service_unit_m2.sql"),
  "utf8"
);
const issueAction = readFileSync(
  resolve(process.cwd(), "src/app/(app)/orders/new/actions.ts"),
  "utf8",
);
const pdf = readFileSync(resolve(process.cwd(), "src/lib/pdf/OrderPdfDocument.tsx"), "utf8");
// R-3: la decisión "importe ausente vs. moneda ausente" se centralizó acá para
// que PDF, preview y listado no la reimplementen cada uno a su manera.
const moneyDisplay = readFileSync(
  resolve(process.cwd(), "src/lib/pricing/money-display.ts"),
  "utf8",
);
const ordersList = readFileSync(
  resolve(process.cwd(), "src/app/(app)/orders/page.tsx"),
  "utf8",
);
const orderDetail = readFileSync(
  resolve(process.cwd(), "src/app/(app)/orders/[publicId]/page.tsx"),
  "utf8",
);
const bootPermissions = readFileSync(
  resolve(process.cwd(), "src/lib/rbac/boot-permissions.ts"),
  "utf8",
);
const commercialWizard = readFileSync(
  resolve(process.cwd(), "src/app/(app)/orders/new/NewOrderWizard.tsx"),
  "utf8",
);
const onlinePreview = readFileSync(
  resolve(process.cwd(), "src/app/(app)/orders/[publicId]/PdfPreview.tsx"),
  "utf8",
);
const email = readFileSync(resolve(process.cwd(), "src/lib/order-email.ts"), "utf8");
const pricingLoader = readFileSync(
  resolve(process.cwd(), "src/lib/data/service-pricing.ts"),
  "utf8",
);
const tariffPage = readFileSync(
  resolve(process.cwd(), "src/app/(app)/orders/tarifas/page.tsx"),
  "utf8",
);
const servicesCatalog = readFileSync(
  resolve(process.cwd(), "src/lib/services-catalog.ts"),
  "utf8",
);

describe("service order pricing lifecycle", () => {
  it("resolves pricing in the atomic issue RPC and rejects a changed signed total", () => {
    expect(sqlFaseB).toContain("create function public.service_order_issue(p_order jsonb,p_lines jsonb)");
    // El linaje se afirma explícitamente: la de 0244 quedó renombrada y revocada.
    expect(sqlFaseB).toContain("rename to service_order_issue_0244");
    expect(sqlFaseB).toContain("revoke all on function public.service_order_issue_0244");
    expect(sqlFaseB).toContain("from public.client_service_rates");
    expect(sqlFaseB).toContain("from public.service_tariff_rates");
    expect(sqlFaseB).toContain("El total firmado no coincide");
  });

  it("keeps quoted services null instead of inventing zero", () => {
    expect(sql).toContain("requires_quote and rate is null");
    expect(sql).toContain("('oficina-privada','Oficina privada','coworking','mes',null");
    expect(sql).toContain("('transporte:semi:CABA','Semi - CABA a CABA','transporte','viaje',null");
    expect(sql.match(/'transporte:[^']+:MAS_100'/g)).toHaveLength(4);
    expect(tariffPage).toContain("Object.entries(pricing.generalRates)");
    expect(tariffPage).toContain('slug.startsWith("transporte:")');
    expect(m2Rates).toContain("null, 0, 0, true");
    expect(m2Rates).toContain("'approval_state','A_COTIZAR'");
    expect(m2Rates).not.toContain("20000::numeric");
    expect(m2Rates).not.toContain("80000::numeric");
  });

  it("pins snapshot currency and forbids implicit client-rate currency crossing", () => {
    // 0249 ya no detecta el cruce de moneda con una excepción: lo IMPIDE por
    // construcción, filtrando la tarifa del cliente por la moneda del
    // tarifario. Se afirma el mecanismo vivo, no el superado.
    expect(sqlFaseB).toContain("currency=v_version.currency");
    expect(sqlFaseB).toContain("currency_snapshot");
    expect(sqlFaseB).toContain("pricing_currency");
    expect(issueAction).toContain("pricing_currency: pricingCurrency");
    expect(issueAction).toContain('issued.currency === "ARS" || issued.currency === "USD"');
    expect(pdf).toContain('value={currency ?? "NO INFORMADA"}');
    // La señal de moneda ausente sigue existiendo; vive en el formateador
    // compartido y ambas superficies delegan en él en vez de duplicarlo.
    expect(moneyDisplay).toContain('"— · MONEDA NO INFORMADA"');
    // R-3.d · exigir USO, no import: afirmar sólo el nombre se satisface con
    // la línea de import, de modo que revertir la delegación real dejaría
    // este test igual de verde. Se fija el cuerpo del helper y que ninguna
    // superficie vuelva a llamar a fmtCurrency para importes que pueden ser
    // NULL.
    expect(pdf).toContain(") => fmtMoneyOrPending(amount, amountCurrency)");
    expect(onlinePreview).toContain(") => fmtMoneyOrPending(amount, amountCurrency)");
    expect(pdf).not.toContain("fmtCurrency(");
    expect(onlinePreview).not.toContain("fmtCurrency(");
    // R-3.b · el listado no puede inventar pesos cuando la moneda no consta:
    // una OS anterior a 0244 tiene pricing_currency NULL y con `?? "ARS"` se
    // mostraba "$ 18.400" mientras el PDF de la MISMA orden decía
    // "— · MONEDA NO INFORMADA".
    expect(ordersList).not.toContain('pricing_currency ?? "ARS"');
    expect(ordersList).toContain("o.pricing_currency ?? null");
    // R-7 · el wizard COMERCIAL no habilita avanzar con cotizaciones
    // pendientes: esa capacidad es del flujo operativo del encargado, y una OS
    // comercial sin precios no puede alimentar facturación.
    expect(commercialWizard).toContain("!hasPendingPricing && sinCotizacionesPendientes");
    // R-8 · el fallback de timeout del boot no puede afirmar una identidad que
    // no resolvió. Marcar al sujeto como encargado NO autorizado hacía que el
    // layout 404-eara a TODOS los usuarios ante una latencia transitoria.
    expect(bootPermissions).toContain(
      "perms: CLOSED, depotManager: STANDARD_DEPOT_MANAGER }",
    );
    expect(bootPermissions).not.toContain(
      "depotManager: { restricted: true, authorized: false",
    );
    // R-3.e · una bonificación sin base no se puede autorizar: antes el `max`
    // colapsaba a 0 y el campo obligatorio sólo admitía enviar 0, que
    // materializaba un importe facturado de cero sobre una línea sin cotizar.
    expect(orderDetail).toContain("const sinBaseBonificable =");
    expect(orderDetail).toContain("disabled={sinBaseBonificable}");
    expect(orderDetail).not.toContain(
      "Math.abs(line.subtotal_requested ?? line.subtotal ?? 0)",
    );
    // El formateador propio del email resuelve el pendiente por su cuenta y
    // debe seguir haciéndolo: es la otra superficie del mismo contrato.
    expect(email).toContain('if (n == null) return "PENDIENTE DE COTIZACIÓN"');
    expect(onlinePreview).toContain('value={currency ?? "NO INFORMADA"}');
    expect(onlinePreview).toContain("s.currency_snapshot ?? currency");
    expect(email).toContain('`Moneda: ${currency ?? "NO INFORMADA"}`');
    expect(email).toContain('if (!currency) return "IMPORTE SIN MONEDA"');
  });

  it("preserves requested, provided and billed values with authorized append-only events", () => {
    expect(sqlFaseB).toContain("qty_requested");
    expect(sqlFaseB).toContain("qty_provided");
    expect(sqlFaseB).toContain("qty_billed");
    expect(sql).toContain("function public.service_order_adjust_billing");
    expect(sql).toContain("Permiso requerido: servicios.edit");
    expect(sql).toContain("El ledger de Ordenes de Servicio es append-only");
  });

  it("uses exact half-open windows, ordered locks and deferred continuity checks", () => {
    expect(sql).toContain("Ventana temporal exacta [effective_from, effective_to)");
    expect(sql).toContain("effective_to > v_pricing_at");
    expect(sql).toContain("valid_to > v_pricing_at");
    expect(sql).toContain("_service_pricing_boundary");
    expect(sql).toContain("America/Argentina/Buenos_Aires");
    expect(sql).toContain("create constraint trigger trg_service_tariff_timeline_ck");
    expect(sql).toContain("create constraint trigger trg_client_service_rate_timeline_ck");
    expect(sql.match(/pg_advisory_xact_lock_shared\(hashtextextended\('tops:service-pricing:tariff:v1'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("set status='superseded', effective_to=v_start");
    expect(sql).not.toContain("effective_to=v_start - interval '1 day'");
  });

  it("loads one exact as-of instant and never deactivates a future predecessor early", () => {
    expect(pricingLoader.match(/const asOf = new Date\(\)\.toISOString\(\);/g)).toHaveLength(1);
    expect(pricingLoader).toContain('.in("status", ["active", "superseded"])');
    expect(pricingLoader).toContain("effective_to.gt.${asOf}");
    expect(pricingLoader).toContain("valid_to.gt.${asOf}");
    expect(pricingLoader).not.toContain('.eq("active", true)');
    expect(pricingLoader).not.toContain("rate ?? 0");
    expect(tariffPage).toContain('timeZone: "America/Argentina/Buenos_Aires"');
    expect(tariffPage).not.toContain("toISOString().slice(0,10)");
  });

  it("represents every catalog quote as null, never as a numeric zero", () => {
    const quoteBlocks = servicesCatalog.match(/rate:\s*null,[\s\S]{0,160}?requires_quote:\s*true/g) ?? [];
    expect(quoteBlocks.length).toBeGreaterThanOrEqual(7);
    expect(servicesCatalog).not.toMatch(/rate:\s*0,[\s\S]{0,160}?requires_quote:\s*true/);
  });

  it("never converts A COTIZAR into zero and replays the frozen transport formula", () => {
    const quoted: ServiceCatalogItem = {
      id: "quoted",
      slug: "alm-general",
      label: "Almacenamiento general",
      unit: "m2",
      rate: null,
      requires_quote: true,
      active: true,
    };
    expect(() => computeServiceLine(quoted, 1)).toThrow(/tarifa aprobada/i);

    const vehicle: VehicleSpec = {
      slug: "qubo",
      label: "Qubo",
      brand: "Fiat",
      model: "Qubo",
      capacity_pallets: 1,
      icon: "truck",
      zones: [],
    };
    const zone: VehicleZonePricing = {
      zone: "CABA",
      label: "Qubo · CABA",
      km_max: 0,
      price: 203_000,
    };
    expect(computeTransportLine({
      vehicle,
      zone,
      trips: 1,
      minQty: 3,
      minBilling: 500_000,
      secondTripDiscount: true,
      surcharge: "17_19",
    })).toMatchObject({
      label: "Qubo · CABA",
      qty_requested: 1,
      qty_effective: 3,
      subtotal: 625_000,
      pricing_kind: "transport",
    });

    expect(() => computeTransportLine({
      vehicle,
      zone: { ...zone, price: null },
      trips: 1,
    })).toThrow(/tarifa aprobada/i);
  });

  it("requires create and sign capabilities before issuing a priced service order", () => {
    expect(sqlFaseB).toContain("has_permission('servicios.create')");
    expect(sqlFaseB).toContain("has_permission('servicios.sign')");
    expect(issueAction).toContain('p_slug: "servicios.create"');
    expect(issueAction).toContain('p_slug: "servicios.sign"');
  });

  it("has a guarded executable rollback for every new table and RPC", () => {
    expect(rollback).toContain("ROLLBACK_0244_BLOCKED");
    expect(sql).toContain("grant select on public.service_order_signatures to service_role");
    for (const token of [
      "service_order_adjust_billing",
      "service_order_record_fulfillment",
      "service_order_issue",
      "service_tariff_publish",
      "client_service_rate_set",
      "service_order_billing_adjustments",
      "service_order_events",
      "client_service_rates",
      "service_tariff_rates",
      "service_tariff_versions",
      "service_order_signatures",
    ]) {
      expect(rollback).toContain(token);
    }
    expect(rollback).toContain("_service_order_png_is_valid");
    expect(rollback).toContain("pricing_formula_snapshot");
  });

  it("has an executable fail-closed logical rollback for the m2 enum label", () => {
    expect(m2Rollback).toContain("Rollback m2 bloqueado");
    expect(m2Rollback).toContain("select 1;");
    expect(m2Rollback).toContain("where unit='m2'::public.service_unit_t");
  });
});
