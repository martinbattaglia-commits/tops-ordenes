import { NextResponse, type NextRequest } from "next/server";
import { extractFromPdf, extractFromImage, OcrError } from "@/lib/ocr/openai";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/documental/ocr
 *
 * Recibe un archivo (PDF o imagen JPG/PNG/WEBP) en multipart/form-data bajo el
 * campo `file` y devuelve el documento estructurado (`ExtractedDocument`)
 * extraído por OpenAI. Es la capa de transporte sobre el motor que ya existía
 * en `src/lib/ocr/openai.ts` (que estaba huérfano: sin ruta que lo invocara).
 *
 * Decisión-independiente: este endpoint sólo EXTRAE y devuelve datos. El modo
 * de autonomía ("IA llena, humano confirma" vs auto-insert) es una decisión de
 * la UI/flujo que consume este JSON — no de esta ruta. Por eso NO persiste nada.
 *
 * Límites:
 *   · Sólo usuarios autenticados (protege la cuota/costo de la API key).
 *   · Rate-limit 20 req/min por usuario (OCR es caro y lento; uso humano ~1-2/min).
 *   · Tamaño máximo 12 MB (factura típica < 2 MB; margen para fotos de celular).
 */

const RL_LIMIT = 20;
const RL_WINDOW_MS = 60_000;
const MAX_BYTES = 12 * 1024 * 1024;

const SUPPORTED_IMAGE = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}

export async function POST(req: NextRequest) {
  // 1. Motor disponible
  if (!env.openai.configured) {
    return NextResponse.json(
      { error: "OCR no disponible: falta OPENAI_API_KEY en el entorno." },
      { status: 503 }
    );
  }

  // 2. Autenticación (salvo demo explícito sin Supabase)
  let userId: string | null = null;
  if (!env.app.demoMode) {
    const supabase = createClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Backend no disponible." },
        { status: 503 }
      );
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "No autenticado." },
        { status: 401 }
      );
    }
    userId = user.id;
  }

  // 3. Rate-limit
  const rl = rateLimit(clientKey(clientIp(req), userId), {
    limit: RL_LIMIT,
    windowMs: RL_WINDOW_MS,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Probá de nuevo en un momento." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  // 4. Leer el archivo del form-data
  let file: File | null = null;
  let modelOverride: string | undefined;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    const m = form.get("model");
    if (typeof m === "string" && m.trim()) modelOverride = m.trim();
  } catch {
    return NextResponse.json(
      { error: "Body inválido: se espera multipart/form-data con campo 'file'." },
      { status: 400 }
    );
  }

  if (!file) {
    return NextResponse.json(
      { error: "Falta el archivo en el campo 'file'." },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Archivo demasiado grande (máx ${MAX_BYTES / 1024 / 1024} MB).` },
      { status: 413 }
    );
  }

  const mime = (file.type || "").toLowerCase();
  const isPdf = mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = SUPPORTED_IMAGE.has(mime);

  if (!isPdf && !isImage) {
    return NextResponse.json(
      {
        error:
          "Formato no soportado. Subí un PDF o una imagen (JPG, PNG, WEBP).",
      },
      { status: 415 }
    );
  }

  // 5. Extraer
  try {
    const bytes = Buffer.from(await file.arrayBuffer());

    const result = isPdf
      ? await extractFromPdf(bytes, { modelOverride })
      : await extractFromImage(
          `data:${mime};base64,${bytes.toString("base64")}`,
          { modelOverride }
        );

    return NextResponse.json({ ok: true, document: result });
  } catch (e) {
    if (e instanceof OcrError) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status ?? 500 }
      );
    }
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json(
      { error: `No se pudo procesar el documento: ${msg}` },
      { status: 500 }
    );
  }
}
