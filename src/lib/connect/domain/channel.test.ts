import { describe, it, expect } from "vitest";
import { normalizeSlug, isValidSlug, canModerate, canManageRoles, normalizeTopic, MAX_TOPIC_LENGTH, normalizeTitle, MAX_TITLE_LENGTH } from "./channel";

describe("connect/domain/channel · slug", () => {
  it("normaliza nombre a kebab-case sin acentos", () => {
    expect(normalizeSlug("Operaciones Magaldi")).toBe("operaciones-magaldi");
    expect(normalizeSlug("Canal #1 · Logística")).toBe("canal-1-logistica");
    expect(normalizeSlug("  héllo   WORLD  ")).toBe("hello-world");
  });
  it("vacío para entradas vacías", () => {
    expect(normalizeSlug("")).toBe("");
    expect(normalizeSlug(null)).toBe("");
  });
  it("valida slugs", () => {
    expect(isValidSlug("operaciones-magaldi")).toBe(true);
    expect(isValidSlug("ab")).toBe(true);
    expect(isValidSlug("a")).toBe(false);
    expect(isValidSlug("-bad")).toBe(false);
    expect(isValidSlug("bad-")).toBe(false);
    expect(isValidSlug("Bad Slug")).toBe(false);
    expect(isValidSlug("doble--guion")).toBe(false);
  });
});

describe("connect/domain/channel · roles", () => {
  it("canModerate = owner/moderator", () => {
    expect(canModerate("owner")).toBe(true);
    expect(canModerate("moderator")).toBe(true);
    expect(canModerate("member")).toBe(false);
    expect(canModerate("guest")).toBe(false);
    expect(canModerate(null)).toBe(false);
  });
  it("canManageRoles = solo owner", () => {
    expect(canManageRoles("owner")).toBe(true);
    expect(canManageRoles("moderator")).toBe(false);
  });
});

describe("connect/domain/channel · topic", () => {
  it("trimea y acota el tema", () => {
    expect(normalizeTopic("  hola  ")).toBe("hola");
    expect(normalizeTopic("x".repeat(MAX_TOPIC_LENGTH + 50)).length).toBe(MAX_TOPIC_LENGTH);
    expect(normalizeTopic(null)).toBe("");
  });
});

// DEFECT-7 (piloto F3): el nombre VISIBLE del canal (title) es distinto de topic y de slug.
describe("connect/domain/channel · title (DEFECT-7)", () => {
  it("trimea y acota el nombre visible del canal", () => {
    expect(normalizeTitle("  Operaciones Magaldi  ")).toBe("Operaciones Magaldi");
    expect(normalizeTitle("x".repeat(MAX_TITLE_LENGTH + 50)).length).toBe(MAX_TITLE_LENGTH);
  });
  it("vacío para entradas nulas/blancas (el use-case lo rechaza)", () => {
    expect(normalizeTitle(null)).toBe("");
    expect(normalizeTitle(undefined)).toBe("");
    expect(normalizeTitle("   ")).toBe("");
  });
});
