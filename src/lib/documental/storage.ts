import { createAdminClient } from "@/lib/supabase/server";
import { createHash } from "crypto";

/**
 * Helpers para Centro Documental: upload a Supabase Storage + hash SHA-256
 * + path canonical por fecha.
 */

const MONTHS = [
  "01-enero",
  "02-febrero",
  "03-marzo",
  "04-abril",
  "05-mayo",
  "06-junio",
  "07-julio",
  "08-agosto",
  "09-septiembre",
  "10-octubre",
  "11-noviembre",
  "12-diciembre",
];

export function fileHashSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function buildDocPath(opts: {
  originalName: string;
  date?: Date;
}): string {
  const now = opts.date ?? new Date();
  const year = now.getFullYear();
  const month = MONTHS[now.getMonth()];
  // Sanitize filename
  const safe = opts.originalName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  const ts = Date.now();
  return `${year}/${month}/${ts}-${safe}`;
}

export interface UploadedDoc {
  bucket: string;
  path: string;
  publicUrl: string | null;
  size: number;
  hash: string;
}

export async function uploadDocument(opts: {
  buffer: Buffer;
  originalName: string;
  contentType: string;
}): Promise<UploadedDoc> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase admin no disponible");

  const path = buildDocPath({ originalName: opts.originalName });
  const hash = fileHashSha256(opts.buffer);

  const { error } = await admin.storage
    .from("documents")
    .upload(path, opts.buffer, {
      contentType: opts.contentType,
      upsert: true,
      cacheControl: "3600",
    });
  if (error) throw new Error(`Storage upload: ${error.message}`);

  const { data: pub } = admin.storage.from("documents").getPublicUrl(path);

  return {
    bucket: "documents",
    path,
    publicUrl: pub?.publicUrl ?? null,
    size: opts.buffer.byteLength,
    hash,
  };
}
