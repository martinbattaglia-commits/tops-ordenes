/** Contrato inmutable de OpenAI Vision para Custodia productiva. */

export const CUSTODY_VISION_PROVIDER = "openai" as const;
export const CUSTODY_VISION_MODEL = "gpt-5.4-mini-2026-03-17" as const;
export const CUSTODY_VISION_POLICY_VERSION = "custody-similarity/v1" as const;
export const CUSTODY_VISION_PROMPT_VERSION = "custody-vision/v3" as const;
export const CUSTODY_VISION_SCHEMA_VERSION = "custody-vision-schema/v1" as const;
export const CUSTODY_VISION_SCORE_ALGORITHM = "custody-weighted-components/v1" as const;
export const CUSTODY_VISION_THRESHOLD = 90 as const;

export const CUSTODY_VISION_PROMPT = [
  "Compare two authenticated photographs of the same custody physical unit.",
  "The first image is the immutable reception reference and the second is the dispatch image.",
  "Score identity, packaging, quantity, and condition independently from 0 to 100.",
  "Report every visible packaging change, suspected missing item, or suspected damage.",
  "Use coincide only when all three damage flags are false; use posible_dano when damage_suspected is true; otherwise use diferencias.",
  "Do not identify people, infer sensitive attributes, or use information outside the two images.",
  "Return only the structured result required by the supplied JSON schema.",
].join("\n");

export const CUSTODY_VISION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    identity: { type: "integer", minimum: 0, maximum: 100 },
    packaging: { type: "integer", minimum: 0, maximum: 100 },
    quantity: { type: "integer", minimum: 0, maximum: 100 },
    condition: { type: "integer", minimum: 0, maximum: 100 },
    model_confidence: { type: "number", minimum: 0, maximum: 1 },
    verdict: { type: "string", enum: ["coincide", "diferencias", "posible_dano"] },
    packaging_changed: { type: "boolean" },
    missing_items_suspected: { type: "boolean" },
    damage_suspected: { type: "boolean" },
    observations: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
    zones: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 120 },
    },
  },
  required: [
    "identity",
    "packaging",
    "quantity",
    "condition",
    "model_confidence",
    "verdict",
    "packaging_changed",
    "missing_items_suspected",
    "damage_suspected",
    "observations",
    "zones",
  ],
} as const;

// Recalculados en tests sobre UTF-8 y JSON.stringify(schema), respectivamente.
export const CUSTODY_VISION_PROMPT_SHA256 =
  "831992df4a2eb04b73506acbd2e254efaa47e997f1a65562f3b9a14d18db961f";
export const CUSTODY_VISION_SCHEMA_SHA256 =
  "cae065149ca3c1cace80a3344ca68f4c7e938b2055ea8d4179dea8a894759e17";

export interface CustodyVisionResult {
  identity: number;
  packaging: number;
  quantity: number;
  condition: number;
  model_confidence: number;
  verdict: "coincide" | "diferencias" | "posible_dano";
  packaging_changed: boolean;
  missing_items_suspected: boolean;
  damage_suspected: boolean;
  observations: string[];
  zones: string[];
}

const RESULT_KEYS: ReadonlySet<string> = new Set(CUSTODY_VISION_RESPONSE_SCHEMA.required);

function isScore(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

function isBoundedStrings(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => typeof item === "string" && item.length >= 1 && item.length <= maxLength)
  );
}

export function parseCustodyVisionResult(value: unknown): CustodyVisionResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== RESULT_KEYS.size || keys.some((key) => !RESULT_KEYS.has(key))) return null;
  if (!isScore(row.identity) || !isScore(row.packaging) || !isScore(row.quantity) || !isScore(row.condition)) {
    return null;
  }
  if (typeof row.model_confidence !== "number" || !Number.isFinite(row.model_confidence)
      || row.model_confidence < 0 || row.model_confidence > 1) return null;
  if (row.verdict !== "coincide" && row.verdict !== "diferencias" && row.verdict !== "posible_dano") {
    return null;
  }
  if (typeof row.packaging_changed !== "boolean"
      || typeof row.missing_items_suspected !== "boolean"
      || typeof row.damage_suspected !== "boolean") return null;
  if (!isBoundedStrings(row.observations, 6, 240) || !isBoundedStrings(row.zones, 6, 120)) return null;
  if (row.damage_suspected && row.verdict !== "posible_dano") return null;
  if (!row.damage_suspected && (row.packaging_changed || row.missing_items_suspected)
      && row.verdict !== "diferencias") return null;
  if (row.verdict === "coincide"
      && (row.packaging_changed || row.missing_items_suspected || row.damage_suspected)) return null;
  return row as unknown as CustodyVisionResult;
}
