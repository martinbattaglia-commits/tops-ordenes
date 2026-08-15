import {
  listPurchaseOrders,
  PurchaseAccessError,
  requirePurchasePermission,
} from "@/lib/compras/data";
import { purchaseOrderAmount } from "@/lib/compras/order-amounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  // Excel/LibreOffice ejecutan fórmulas incluso dentro de celdas CSV quoted.
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET() {
  try {
    await requirePurchasePermission("compras.export");
  } catch (error) {
    if (error instanceof PurchaseAccessError) {
      const message = error.status === 401
        ? "Autenticación requerida."
        : error.status === 403
          ? "Acceso denegado."
          : "No se pudo autorizar la exportación.";
      return new Response(message, {
        status: error.status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return new Response("No se pudo autorizar la exportación.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const { rows } = await listPurchaseOrders({ pageSize: 1000 });
  const header = [
    "public_id",
    "fecha",
    "depot",
    "proveedor",
    "cuit",
    "categoria",
    "cond_pago",
    "items",
    "moneda",
    "naturaleza_importe",
    "price_state_emitido",
    "neto",
    "iva",
    "total",
    "planning_neto",
    "planning_iva",
    "planning_total",
    "lineas_precio_pendiente",
    "precio_conciliado_at",
    "estado",
    "firmada_por",
    "firmada_at",
    "factura_id",
  ].map(csvCell).join(",");
  const lines = rows.map((o) => {
    const amount = purchaseOrderAmount(o);
    return [
      o.public_id,
      o.date,
      o.depot,
      o.vendor?.razon ?? "",
      o.vendor?.cuit ?? "",
      o.vendor?.categoria ?? o.categoria ?? "",
      o.cond_pago,
      o.items?.length ?? 0,
      "ARS",
      amount.kind === "real"
        ? (o.price_reconciled_at ? "real_conciliado" : "real_conocido")
        : amount.kind === "estimated"
          ? "estimado_no_contable"
          : "pendiente_sin_importe_real",
      o.price_state,
      o.neto,
      o.iva,
      o.total,
      o.planning_neto,
      o.planning_iva,
      o.planning_total,
      o.pending_price_lines,
      o.price_reconciled_at ?? "",
      o.status,
      o.signed_by ?? "",
      o.signed_at ?? "",
      o.factura_id ?? "",
    ].map(csvCell).join(",");
  });
  const csv = [header, ...lines].join("\n");
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="OC-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
