/**
 * Ingesta de extracto bancario (S4 → endurecida en E2 · TREAS-RECON-001).
 * POST multipart: file + bankAccountId + banco + sourceKind.
 *
 * Flujo: permiso → COHERENCIA BANCO↔CUENTA (hallazgo E1: extractos Santander
 * quedaron asociados a la cuenta Caja) → extraer (pdf-parse LAZY para
 * Galicia; texto para CSV/XLS) → pipeline puro (`procesarExtracto`) →
 * persistir vía RPC append-only → subir al bucket privado.
 *
 * Fallos NO silenciosos (E2): toda etapa fallida devuelve `ok:false` con la
 * etapa y la causa, queda registrada por log estructurado, y si el archivo se
 * subió en esta misma request se compensa (los blobs históricos no se tocan).
 * Nunca registra solo: el resultado queda en estado 'sugerido'.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccess } from "@/lib/rbac/guard";
import { procesarExtracto, type SourceKind } from "@/lib/tesoreria/conciliacion/ingest";
import { listCandidateMovements } from "@/lib/tesoreria/conciliacion/data";
import { subirExtracto, compensarExtractoSubido, type UploadExtractoResult } from "@/lib/tesoreria/conciliacion/storage";
import { validarCoherenciaCuenta, normalizarBanco, BANCOS_SOPORTADOS, type CuentaParaIngesta } from "@/lib/tesoreria/conciliacion/account-guard";
import { humanizeRpcError } from "@/lib/tesoreria/errors";

export const dynamic = "force-dynamic";

const MIME: Record<SourceKind, string> = { csv: "text/csv", xls: "text/plain", pdf: "application/pdf" };

function fallo(etapa: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  console.error(`[recon-ingest] fallo en etapa=${etapa}`, { message, ...extra });
  return NextResponse.json({ ok: false, etapa, message }, { status });
}

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
    return NextResponse.json({ ok: false, etapa: "permiso", message: "Sin permiso." }, { status: 403 });
  }
  const supabase = createClient();
  if (!supabase) return fallo("backend", "Servicio no disponible.", 503);

  const form = await req.formData();
  const file = form.get("file");
  const bankAccountId = String(form.get("bankAccountId") ?? "");
  const sourceKind = String(form.get("sourceKind") ?? "") as SourceKind;
  // B4 · dominio CERRADO: normaliza y rechaza vacío/genérico/desconocido.
  const banco = normalizarBanco(String(form.get("banco") ?? ""));
  if (!(file instanceof File) || !bankAccountId || !["csv", "xls", "pdf"].includes(sourceKind)) {
    return fallo("parametros", "Parámetros inválidos.");
  }
  if (!banco) {
    return fallo("parametros", `Banco no soportado. Sólo se admiten: ${BANCOS_SOPORTADOS.join(", ")}.`);
  }
  if (file.size > 20 * 1024 * 1024) return fallo("parametros", "Archivo > 20MB.", 413);

  // ── Coherencia banco↔cuenta (rechazo explícito, nunca silencioso) ──
  const { data: cuentaRows, error: cuentaErr } = await supabase
    .from("bank_accounts")
    .select("id,bank_name,account_name,account_type,currency,active")
    .eq("id", bankAccountId)
    .limit(1);
  if (cuentaErr) return fallo("cuenta", `No se pudo verificar la cuenta: ${cuentaErr.message}`, 500);
  const cuenta = ((cuentaRows ?? [])[0] ?? null) as CuentaParaIngesta | null;
  const incoherencia = validarCoherenciaCuenta(banco, cuenta);
  if (incoherencia) return fallo("cuenta", incoherencia, 400, { bankAccountId, banco });

  // ── Extracción + pipeline puro ──
  let buf: Buffer;
  let contenido: string;
  try {
    buf = Buffer.from(await file.arrayBuffer());
    contenido = await extraerTexto(buf, sourceKind);
  } catch (e) {
    return fallo("extraccion", e instanceof Error ? e.message : "No se pudo leer el archivo.", 422);
  }

  let res: ReturnType<typeof procesarExtracto>;
  try {
    const pre = procesarExtracto({ contenido, banco, sourceKind, candidatos: [] });
    const { period_from, period_to } = pre.payload.statement;
    const candidatos = await listCandidateMovements(bankAccountId, period_from ?? "1900-01-01", period_to ?? "2999-12-31");
    res = procesarExtracto({ contenido, banco, sourceKind, candidatos });
  } catch (e) {
    return fallo("pipeline", e instanceof Error ? e.message : "No se pudo procesar el extracto.", 422);
  }

  // ── Storage (idempotente por hash) + RPC append-only ──
  let subida: UploadExtractoResult | null = null;
  try {
    subida = await subirExtracto({ bankAccountId, hash: res.payload.statement.hash, sourceKind, bytes: buf, contentType: MIME[sourceKind] });
  } catch (e) {
    return fallo("storage", e instanceof Error ? e.message : "No se pudo guardar el archivo.", 500);
  }

  const { data, error } = await supabase.rpc("tesoreria_recon_ingest", {
    p_bank_account_id: bankAccountId,
    p_file_path: subida?.path ?? null,
    p_saldo_ok: res.saldoOk,
    p_payload: res.payload, // jsonb: statement + lines + matches
  });
  if (error) {
    // Compensación segura: sólo el objeto creado en ESTA request; los
    // históricos se preservan siempre.
    const compensado = await compensarExtractoSubido(subida);
    console.error("[recon-ingest] fallo en etapa=persistencia", {
      bankAccountId,
      banco,
      hash: res.payload.statement.hash,
      filePath: subida?.path ?? null,
      fileCreado: subida?.created ?? false,
      compensado,
      rpcError: error.message,
    });
    return NextResponse.json(
      { ok: false, etapa: "persistencia", message: humanizeRpcError(error.message), detail: error.message },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    statementId: data,
    saldoOk: res.saldoOk,
    deltaCents: res.deltaCents,
    cuenta: { banco: cuenta!.bank_name, nombre: cuenta!.account_name },
    resumen: { conciliados: res.metrics.conciliados, posibles: res.metrics.posibles, noConciliados: res.metrics.noConciliados, sistemicos: res.metrics.sistemicos },
  });
}
