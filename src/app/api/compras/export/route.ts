import { listPurchaseOrders } from "@/lib/compras/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
    "neto",
    "iva",
    "total",
    "estado",
    "firmada_por",
    "firmada_at",
    "factura_id",
  ].join(",");
  const lines = rows.map((o) =>
    [
      o.public_id,
      o.date,
      o.depot,
      JSON.stringify(o.vendor?.razon ?? ""),
      o.vendor?.cuit ?? "",
      o.vendor?.categoria ?? o.categoria ?? "",
      o.cond_pago,
      o.items?.length ?? 0,
      o.neto,
      o.iva,
      o.total,
      o.status,
      JSON.stringify(o.signed_by ?? ""),
      o.signed_at ?? "",
      o.factura_id ?? "",
    ].join(",")
  );
  const csv = [header, ...lines].join("\n");
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="OC-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
