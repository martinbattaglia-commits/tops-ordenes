// Nexus Link · dominio puro de canales/moderación (RC1.2). Sin I/O.

import type { MemberRole } from "../types";

/** Deriva un slug kebab-case válido a partir de un nombre. */
export function normalizeSlug(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isValidSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && slug.length >= 2 && slug.length <= 60 && SLUG_RE.test(slug);
}

/** ¿El rol puede moderar (tema, archivar, gestionar miembros, fijar)? */
export function canModerate(role: MemberRole | null | undefined): boolean {
  return role === "owner" || role === "moderator";
}

/** ¿El rol puede cambiar roles de otros? (solo owner). */
export function canManageRoles(role: MemberRole | null | undefined): boolean {
  return role === "owner";
}

/**
 * DEFECT-9 (piloto F3): ¿puede administrar el canal/grupo (renombrar, tema, miembros, archivar)?
 * owner/moderator del canal, O admin/superadmin global (`profiles.role='admin'` = `is_admin()`).
 * Espeja el gate de los RPCs (`connect_set_title`/`archive`/`set_topic`/`add_member`), que ya
 * permiten `is_admin()` aunque no sea owner/moderator ni miembro. NO abre RBAC global.
 */
export function canAdminister(role: MemberRole | null | undefined, isAdmin: boolean): boolean {
  return isAdmin || canModerate(role);
}

export const MAX_TOPIC_LENGTH = 280;
export function normalizeTopic(topic: string | null | undefined): string {
  return (topic ?? "").trim().slice(0, MAX_TOPIC_LENGTH);
}

/**
 * DEFECT-7 (piloto F3): el NOMBRE VISIBLE del canal (`title`) es un campo distinto de
 * `topic` (tema/descripción) y de `slug` (URL estable). Renombrar cambia solo `title`.
 */
export const MAX_TITLE_LENGTH = 120;
export function normalizeTitle(title: string | null | undefined): string {
  return (title ?? "").trim().slice(0, MAX_TITLE_LENGTH);
}
