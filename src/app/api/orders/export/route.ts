import { NextResponse } from "next/server";
import { listOrders } from "@/lib/data/orders";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/utils";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const { rows } = await listOrders({ pageSize: 1000 });

  // Audit log: registrar export
  if (!env.app.demoMode) {
    const supabase = createClient();
    const admin = createAdminClient();
    if (supabase && admin) {
      const { data: { user } } = await supabase.auth.getUser();
      admin
        .from("audit_log")
        .insert({
          user_id: user?.id ?? null,
          entity: "orders",
          action: "export_csv",
          payload: { row_count: rows.length },
        })
        .then(() => undefined);
    }
  }

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
