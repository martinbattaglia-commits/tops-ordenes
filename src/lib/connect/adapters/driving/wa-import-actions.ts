"use server";

// Nexus Link · LINK-WA-002 F1a — server actions del importador de WhatsApp histórico.
// FAIL-CLOSED estricto: sesión + profiles.role='admin' verificado EN LA ACTION (la página
// también gatea, pero el server re-valida siempre). El export bruto viaja como texto y
// NO se persiste; preview = parseo en seco (cero escritura).

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseWaExport, type WaParseResult } from "../../wa-import/parser";
import { ingestWaExport, normalizePhoneE164, type WaIngestResult } from "../../wa-import/ingest";

const MAX_RAW = 900_000; // límite de body de server actions (~1MB): exports de texto típicos entran holgado

type AdminGuard =
  | { ok: true; profileId: string }
  | { ok: false; message: string };

async function requireAdmin(): Promise<AdminGuard> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: importación deshabilitada." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if ((prof as { role?: string } | null)?.role !== "admin") {
    return { ok: false, message: "Solo administradores pueden importar (D2)." };
  }
  return { ok: true, profileId: user.id };
}

const PreviewSchema = z.object({ raw: z.string().min(1).max(MAX_RAW) });

export type PreviewResult =
  | { ok: true; preview: WaParseResult }
  | { ok: false; message: string };

export async function previewWaExportAction(rawInput: unknown): Promise<PreviewResult> {
  const g = await requireAdmin();
  if (!g.ok) return g;
  const p = PreviewSchema.safeParse(rawInput);
  if (!p.success) {
    return { ok: false, message: "Export inválido o demasiado grande (máx ~900 KB de texto; dividí el export)." };
  }
  const preview = parseWaExport(p.data.raw);
  // El preview NO devuelve los cuerpos: sólo métricas y autores (privacidad en tránsito mínima).
  return { ok: true, preview: { ...preview, messages: [] } };
}

const IngestSchema = z.object({
  raw: z.string().min(1).max(MAX_RAW),
  counterpartAuthor: z.string().min(1).max(120),
  counterpartPhone: z.string().min(8).max(20),
  displayName: z.string().min(1).max(120),
  entityType: z.enum(["cliente", "proveedor", "contacto", "interno"]).nullable().optional(),
});

export async function ingestWaExportAction(rawInput: unknown): Promise<WaIngestResult> {
  const g = await requireAdmin();
  if (!g.ok) return { ok: false, message: g.message };
  const p = IngestSchema.safeParse(rawInput);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  if (!normalizePhoneE164(p.data.counterpartPhone)) {
    return { ok: false, message: "Teléfono inválido: formato +549… (E164)." };
  }
  const result = await ingestWaExport({
    raw: p.data.raw,
    counterpartAuthor: p.data.counterpartAuthor,
    counterpartPhone: p.data.counterpartPhone,
    displayName: p.data.displayName,
    entityType: p.data.entityType ?? null,
    importerProfileId: g.profileId,
  });
  if (result.ok) revalidatePath("/connect", "layout");
  return result;
}
