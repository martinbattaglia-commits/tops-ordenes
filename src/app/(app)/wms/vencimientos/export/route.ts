import { NextResponse } from "next/server";
import { listExpiries, todayIso, type LotFilters } from "@/lib/wms/lots";
import { EXPIRY_STATUS_META, EXPIRY_THRESHOLDS, type ExpiryThresholds } from "@/lib/wms/types";

export const dynamic = "force-dynamic";

/**
 * Export CSV de Vencimientos (FASE 9A). Solo lectura. Respeta filtros
 * (cliente/sku/lote) y umbrales (rojo/naranja/amarillo) del query string.
 * Mismo formato que el resto del ERP: UTF-8 con BOM, separador coma, escape.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const g = (k: string) => (url.searchParams.get(k) ?? "").trim() || null;

  const filters: LotFilters = { cliente: g("cliente"), sku: g("sku"), lote: g("lote") };

  const num = (k: string, d: number) => {
    const n = Number(url.searchParams.get(k));
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const thresholds: ExpiryThresholds = {
    rojo: num("rojo", EXPIRY_THRESHOLDS.rojo),
    naranja: num("naranja", EXPIRY_THRESHOLDS.naranja),
    amarillo: num("amarillo", EXPIRY_THRESHOLDS.amarillo),
  };

  const rows = await listExpiries(filters, thresholds);

  const header = [
    "Cliente",
    "SKU",
    "Descripción",
    "Lote",
    "Vencimiento",
    "Días restantes",
    "Cantidad",
    "Ubicación",
    "Estado",
  ];

  const escape = (v: unknown) => {
    const str = v == null ? "" : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.client_name,
        r.sku,
        r.description,
        r.lot_number,
        r.expiration_date ?? "",
        r.days_left ?? "",
        r.quantity,
        r.position_full_code ?? "",
        r.expiry_status ? EXPIRY_STATUS_META[r.expiry_status].label : "",
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
      "Content-Disposition": `attachment; filename="vencimientos-${todayIso()}.csv"`,
    },
  });
}
