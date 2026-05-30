import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Centro documental — data layer.
 *
 * QW Fase 1 (2026-05-29):
 *  - Se ELIMINÓ la mezcla de mocks (OC PDFs de compras-mock + DOCS de ANMAT
 *    + 5 facturas/remitos/contratos ficticios).
 *  - `listDocs()` ahora consulta la tabla real `documents` en Supabase.
 *  - Si la tabla está vacía (estado actual en prod) la UI muestra un empty
 *    state claro: "Sin documentos cargados aún".
 *  - Se mantiene `getDocTypes()` para los filtros del UI.
 */

export type DocType =
  | "OC PDF"
  | "Contrato"
  | "Habilitación"
  | "Auditoría"
  | "Procedimiento"
  | "Capacitación"
  | "Factura"
  | "Remito"
  | "Otro";

export interface DocItem {
  id: string;
  title: string;
  type: DocType;
  vendor?: string;
  client?: string;
  uploadedAt: string;
  size: string;
  hash: string;
  href?: string;
  tags: string[];
}

/** Fila cruda de la tabla `documents` (subset relevante). */
interface DocumentRow {
  id: string;
  title: string | null;
  doc_type: string | null;
  uploaded_at: string | null;
  created_at: string | null;
  bytes: number | null;
  sha256: string | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
}

function fmtBytes(b: number | null): string {
  if (!b || b <= 0) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeDocType(raw: string | null): DocType {
  if (!raw) return "Otro";
  const t = raw as DocType;
  const valid: DocType[] = [
    "OC PDF",
    "Contrato",
    "Habilitación",
    "Auditoría",
    "Procedimiento",
    "Capacitación",
    "Factura",
    "Remito",
    "Otro",
  ];
  return valid.includes(t) ? t : "Otro";
}

function rowToDocItem(r: DocumentRow): DocItem {
  const meta = r.metadata ?? {};
  return {
    id: r.id,
    title: r.title ?? "(sin título)",
    type: normalizeDocType(r.doc_type),
    vendor: typeof meta.vendor === "string" ? (meta.vendor as string) : undefined,
    client: typeof meta.client === "string" ? (meta.client as string) : undefined,
    uploadedAt: (r.uploaded_at ?? r.created_at ?? "").slice(0, 10),
    size: fmtBytes(r.bytes),
    hash: r.sha256 ?? "—",
    tags: r.tags ?? [],
  };
}

/**
 * Lista documentos del Centro Documental.
 * - En producción: query a Supabase `documents` (con RLS multi-tenant).
 * - En demo mode / sin Supabase: retorna [].
 *
 * La UI debe manejar el caso de array vacío mostrando un empty state.
 */
export async function listDocs(): Promise<DocItem[]> {
  if (env.app.demoMode || env.app.needsSupabase) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, doc_type, uploaded_at, created_at, bytes, sha256, tags, metadata")
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) {
    console.warn("[documental] listDocs error:", error.message);
    return [];
  }
  const rows = (data ?? []) as DocumentRow[];
  return rows.map(rowToDocItem);
}

export function getDocTypes(): DocType[] {
  return ["OC PDF", "Contrato", "Habilitación", "Auditoría", "Procedimiento", "Capacitación", "Factura", "Remito"];
}
