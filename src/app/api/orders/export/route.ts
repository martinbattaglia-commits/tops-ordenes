import { NextResponse } from "next/server";
import { listOrders } from "@/lib/data/orders";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const { rows } = await listOrders({ pageSize: 1000 });

  const header = [
    "public_id",
    "fecha",
    "estado",
    "deposito",
    "cliente",
    "cuit",
    "responsable",
    "h_inicio",
    "h_fin",
    "horas",
    "pallets",
    "unidades",
    "km",
    "total",
    "firmado_por",
  ];

  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [header.join(",")];
  for (const o of rows) {
    lines.push(
      [
        o.public_id,
        fmtDate(o.date),
        o.status,
        o.depot,
        o.client?.razon ?? "",
        o.client?.cuit ?? "",
        o.operator?.full_name ?? "",
        o.h_start ?? "",
        o.h_end ?? "",
        o.hours,
        o.pallets,
        o.units,
        o.km,
        o.total,
        o.signed_by ?? "",
      ]
        .map(escape)
        .join(",")
    );
  }

  const csv = "﻿" + lines.join("\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tops-ordenes-${Date.now()}.csv"`,
    },
  });
}
