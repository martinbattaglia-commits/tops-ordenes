/**
 * Ingesta de extracto bancario (S4). POST multipart: file + bankAccountId + banco + sourceKind.
 *
 * Flujo: permiso → extraer (pdf-parse LAZY para Galicia; texto para CSV/XLS) →
 * pipeline puro (`procesarExtracto`) → persistir vía RPC append-only → subir al
 * bucket privado. Nunca registra solo: el resultado queda en estado 'sugerido'.
 *
 * NOTA: RPC `tesoreria_recon_ingest` y bucket provienen de 0079/0080 (DISEÑO).
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccess } from "@/lib/rbac/guard";
import { procesarExtracto, type SourceKind } from "@/lib/tesoreria/conciliacion/ingest";
import { listCandidateMovements } from "@/lib/tesoreria/conciliacion/data";
import { subirExtracto } from "@/lib/tesoreria/conciliacion/storage";
import type { Banco } from "@/lib/tesoreria/conciliacion/types";

export const dynamic = "force-dynamic";

const MIME: Record<SourceKind, string> = { csv: "text/csv", xls: "text/plain", pdf: "application/pdf" };

/** Extrae texto del archivo. PDF Galicia → pdf-parse (import perezoso, anti-RSC). */
async function extraerTexto(buf: Buffer, source: SourceKind): Promise<string> {
  if (source === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const t = (await parser.getText()).text;
    await parser.destroy();
    return t;
  }
  return buf.toString(source === "csv" ? "latin1" : "utf8");
}

export async function POST(req: Request): Promise<Response> {
  if (!(await canAccess("tesoreria.conciliacion.upload"))) {
    return NextResponse.json({ ok: false, message: "Sin permiso." }, { status: 403 });
  }
  const supabase = createClient();
  if (!supabase) return NextResponse.json({ ok: false, message: "Servicio no disponible." }, { status: 503 });

  const form = await req.formData();
  const file = form.get("file");
  const bankAccountId = String(form.get("bankAccountId") ?? "");
  const banco = String(form.get("banco") ?? "") as Banco;
  const sourceKind = String(form.get("sourceKind") ?? "") as SourceKind;
  if (!(file instanceof File) || !bankAccountId || !["galicia", "santander"].includes(banco) || !["csv", "xls", "pdf"].includes(sourceKind)) {
    return NextResponse.json({ ok: false, message: "Parámetros inválidos." }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ ok: false, message: "Archivo > 20MB." }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  const contenido = await extraerTexto(buf, sourceKind);

  // Pipeline (con candidatos del período).
  const pre = procesarExtracto({ contenido, banco, sourceKind, candidatos: [] });
  const { period_from, period_to } = pre.payload.statement;
  const candidatos = await listCandidateMovements(bankAccountId, period_from ?? "1900-01-01", period_to ?? "2999-12-31");
  const res = procesarExtracto({ contenido, banco, sourceKind, candidatos });

  // Persistir (append-only) + subir archivo (idempotente por hash).
  const path = await subirExtracto({ bankAccountId, hash: res.payload.statement.hash, sourceKind, bytes: buf, contentType: MIME[sourceKind] });
  const { data, error } = await supabase.rpc("tesoreria_recon_ingest", {
    p_bank_account_id: bankAccountId,
    p_file_path: path,
    p_saldo_ok: res.saldoOk,
    p_payload: res.payload, // jsonb: statement + lines + matches
  });
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  return NextResponse.json({
    ok: true,
    statementId: data,
    saldoOk: res.saldoOk,
    deltaCents: res.deltaCents,
    resumen: { conciliados: res.metrics.conciliados, posibles: res.metrics.posibles, noConciliados: res.metrics.noConciliados, sistemicos: res.metrics.sistemicos },
  });
}
