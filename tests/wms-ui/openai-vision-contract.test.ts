import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CUSTODY_VISION_PROMPT,
  CUSTODY_VISION_PROMPT_SHA256,
  CUSTODY_VISION_RESPONSE_SCHEMA,
  CUSTODY_VISION_SCHEMA_SHA256,
  parseCustodyVisionResult,
} from "@/lib/custody/openai-vision-contract";

const valid = {
  identity: 91,
  packaging: 92,
  quantity: 93,
  condition: 94,
  model_confidence: 0.88,
  verdict: "coincide",
  packaging_changed: false,
  missing_items_suspected: false,
  damage_suspected: false,
  observations: ["Sin diferencias visibles"],
  zones: ["embalaje frontal"],
};

describe("contrato productivo OpenAI Vision", () => {
  it("congela hashes reproducibles de prompt y schema", () => {
    expect(createHash("sha256").update(CUSTODY_VISION_PROMPT).digest("hex"))
      .toBe(CUSTODY_VISION_PROMPT_SHA256);
    expect(createHash("sha256").update(JSON.stringify(CUSTODY_VISION_RESPONSE_SCHEMA)).digest("hex"))
      .toBe(CUSTODY_VISION_SCHEMA_SHA256);
  });

  it("acepta sólo el resultado exacto y acotado", () => {
    expect(parseCustodyVisionResult(valid)).toEqual(valid);
    expect(parseCustodyVisionResult({ ...valid, extra: true })).toBeNull();
    expect(parseCustodyVisionResult({ ...valid, identity: 101 })).toBeNull();
    expect(parseCustodyVisionResult({ ...valid, observations: ["x".repeat(241)] })).toBeNull();
  });

  it("no permite descartar ni contradecir señales de daño", () => {
    expect(parseCustodyVisionResult({ ...valid, damage_suspected: true })).toBeNull();
    expect(parseCustodyVisionResult({ ...valid, packaging_changed: true })).toBeNull();
    expect(parseCustodyVisionResult({
      ...valid,
      verdict: "posible_dano",
      damage_suspected: true,
    })).not.toBeNull();
  });
});
