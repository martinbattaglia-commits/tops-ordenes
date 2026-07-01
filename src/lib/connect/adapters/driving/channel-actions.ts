"use server";

// Nexus Link · driving adapters (RC1.2): canal/membresía/moderación/fijados. Patrón fail-closed
// de RC1.1 (createClient→null demo · getUser→401 · canAccess→403 · zod→400 · use-case → revalidate).
// Escritura por sesión vía RPC SECDEF (0144/0150): el RPC re-valida member_role/membresía.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccess } from "@/lib/rbac/guard";
import { createClient } from "@/lib/supabase/server";
import { channelOps } from "../../application/channel-use-cases";
import { ConnectOpsAdapter } from "../supabase/connect-ops.adapter";
import type { RpcCapableClient } from "../supabase/connect-rpc.adapter";

export type SimpleResult = { ok: true } | { ok: false; message: string };

const MEMBER_ROLES = ["owner", "moderator", "member", "guest"] as const;

function ops(client: unknown) {
  return channelOps(new ConnectOpsAdapter(client as RpcCapableClient));
}
function revalidateChannel() {
  revalidatePath("/connect");
  revalidatePath("/connect/canales", "layout");
}

async function guard(slug: string): Promise<{ ok: true; client: unknown } | { ok: false; message: string }> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: la acción no persiste (sin Supabase)." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess(slug))) return { ok: false, message: `Sin permiso (${slug}).` };
  return { ok: true, client: supabase };
}

// ── Unirse a canal público (D-RC1.2-1) ──────────────────────────────────────
export async function joinChannelAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ conversationId: z.string().min(1) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const g = await guard("connect.create");
  if (!g.ok) return g;
  const r = await ops(g.client).join.execute(p.data.conversationId);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidateChannel();
  return { ok: true };
}

// ── Membresía / roles (moderación) ──────────────────────────────────────────
export async function addMemberAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({
    conversationId: z.string().min(1), profileId: z.string().uuid(),
    role: z.enum(MEMBER_ROLES).default("member"),
  }).safeParse(raw);
  // DEFECT-4: mensaje claro (el UUID lo resuelve el selector; si falta, guiar al usuario).
  if (!p.success) return { ok: false, message: "Seleccioná un usuario válido de la lista (buscá por nombre o email)." };
  const g = await guard("connect.edit");
  if (!g.ok) return g;
  const r = await ops(g.client).member.add(p.data.conversationId, p.data.profileId, p.data.role);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidateChannel();
  return { ok: true };
}

// ── Búsqueda de usuarios internos para agregar miembros (DEFECT-3) ────────────
// SEGURIDAD: NO exponemos email (PII lockdown 0040); solo id + nombre. La RPC permite
// buscar por email pero no lo devuelve.
export type ProfileHit = { profileId: string; fullName: string | null };

export async function searchProfilesAction(
  raw: unknown
): Promise<{ ok: true; hits: ProfileHit[] } | { ok: false; message: string }> {
  const p = z.object({ q: z.string() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Ingresá un texto para buscar." };
  const query = p.data.q.trim();
  if (query.length < 2) return { ok: true, hits: [] };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: la búsqueda de usuarios no está disponible." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  const { data, error } = await supabase.rpc("connect_search_profiles", { q: query, limit_count: 10 });
  if (error) {
    console.error("[connect/searchProfilesAction] rpc error:", error.message);
    return { ok: false, message: "No se pudo buscar usuarios. Intentá de nuevo." };
  }
  const hits = ((data ?? []) as Array<{ profile_id: string; full_name: string | null }>).map(
    (r) => ({ profileId: r.profile_id, fullName: r.full_name })
  );
  return { ok: true, hits };
}

export async function removeMemberAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ conversationId: z.string().min(1), profileId: z.string().uuid() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const g = await guard("connect.edit");
  if (!g.ok) return g;
  const r = await ops(g.client).member.remove(p.data.conversationId, p.data.profileId);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidateChannel();
  return { ok: true };
}

export async function setMemberRoleAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({
    conversationId: z.string().min(1), profileId: z.string().uuid(), role: z.enum(MEMBER_ROLES),
  }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const g = await guard("connect.edit");
  if (!g.ok) return g;
  const r = await ops(g.client).member.setRole(p.data.conversationId, p.data.profileId, p.data.role);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidateChannel();
  return { ok: true };
}

// ── Moderación: tema / archivar ─────────────────────────────────────────────
export async function setTopicAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ conversationId: z.string().min(1), topic: z.string().max(280) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const g = await guard("connect.edit");
  if (!g.ok) return g;
  const r = await ops(g.client).topic.execute(p.data.conversationId, p.data.topic);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidateChannel();
  return { ok: true };
}

export async function archiveConversationAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ conversationId: z.string().min(1) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const g = await guard("connect.edit");
  if (!g.ok) return g;
  const r = await ops(g.client).archive.execute(p.data.conversationId);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidateChannel();
  return { ok: true };
}

// ── Mensajes fijados (Pinned) ───────────────────────────────────────────────
export async function pinMessageAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ messageId: z.string().min(1) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const g = await guard("connect.edit");
  if (!g.ok) return g;
  const r = await ops(g.client).pin.pin(p.data.messageId);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidateChannel();
  return { ok: true };
}

export async function unpinMessageAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ messageId: z.string().min(1) }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const g = await guard("connect.edit");
  if (!g.ok) return g;
  const r = await ops(g.client).pin.unpin(p.data.messageId);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidateChannel();
  return { ok: true };
}
