import "server-only";

import { createHash } from "node:crypto";
import {
  CUSTODY_VISION_MODEL,
  CUSTODY_VISION_PROMPT,
  CUSTODY_VISION_RESPONSE_SCHEMA,
  parseCustodyVisionResult,
  type CustodyVisionResult,
} from "./openai-vision-contract";

export type CustodyVisionMime = "image/jpeg" | "image/png" | "image/webp";

export interface CustodyVisionImage {
  bytes: Uint8Array;
  mimeType: CustodyVisionMime;
}

export type CustodyVisionProviderFailure =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_INVALID_RESPONSE";

export class CustodyVisionProviderError extends Error {
  constructor(readonly code: CustodyVisionProviderFailure) {
    super(code);
    this.name = "CustodyVisionProviderError";
  }
}

export interface CustodyVisionProviderResult {
  result: CustodyVisionResult;
  providerResponseId: string;
  responseModel: string;
  systemFingerprint: string | null;
  openaiRequestId: string | null;
  requestSha256: string;
  responseSha256: string;
}

export interface OpenAICustodyVisionProviderOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function dataUrl(image: CustodyVisionImage): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

function extractOutputText(response: Record<string, unknown>): string | null {
  if (!Array.isArray(response.output)) return null;
  const texts: string[] = [];
  for (const item of response.output) {
    if (typeof item !== "object" || item === null) continue;
    const message = item as Record<string, unknown>;
    if (message.type !== "message" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (typeof part !== "object" || part === null) continue;
      const content = part as Record<string, unknown>;
      if (content.type === "refusal") return null;
      if (content.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }
  return texts.length === 1 ? texts[0] : null;
}

export class OpenAICustodyVisionProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAICustodyVisionProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = options.endpoint ?? "https://api.openai.com/v1/responses";
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  async compare(
    ingress: CustodyVisionImage,
    egress: CustodyVisionImage,
  ): Promise<CustodyVisionProviderResult> {
    if (!this.apiKey) throw new CustodyVisionProviderError("PROVIDER_UNAVAILABLE");

    const request = {
      model: CUSTODY_VISION_MODEL,
      store: false,
      reasoning: { effort: "none" },
      max_output_tokens: 1200,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: CUSTODY_VISION_PROMPT },
            { type: "input_image", image_url: dataUrl(ingress), detail: "high" },
            { type: "input_image", image_url: dataUrl(egress), detail: "high" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "custody_vision_comparison",
          strict: true,
          schema: CUSTODY_VISION_RESPONSE_SCHEMA,
        },
      },
    } as const;
    const requestText = JSON.stringify(request);
    const requestSha256 = sha256(requestText);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: requestText,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new CustodyVisionProviderError("PROVIDER_TIMEOUT");
      }
      throw new CustodyVisionProviderError("PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }

    let responseBytes: Uint8Array;
    try {
      responseBytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new CustodyVisionProviderError("PROVIDER_INVALID_RESPONSE");
    }
    if (!response.ok) throw new CustodyVisionProviderError("PROVIDER_UNAVAILABLE");

    const responseSha256 = sha256(responseBytes);
    let raw: Record<string, unknown>;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(responseBytes));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
      raw = parsed as Record<string, unknown>;
    } catch {
      throw new CustodyVisionProviderError("PROVIDER_INVALID_RESPONSE");
    }

    const providerResponseId = typeof raw.id === "string" && raw.id.length <= 128 ? raw.id : null;
    const responseModel = typeof raw.model === "string" ? raw.model : null;
    const outputText = extractOutputText(raw);
    if (raw.status !== "completed" || !providerResponseId || responseModel !== CUSTODY_VISION_MODEL || !outputText) {
      throw new CustodyVisionProviderError("PROVIDER_INVALID_RESPONSE");
    }

    let result: CustodyVisionResult | null = null;
    try {
      result = parseCustodyVisionResult(JSON.parse(outputText));
    } catch {
      result = null;
    }
    if (!result) throw new CustodyVisionProviderError("PROVIDER_INVALID_RESPONSE");

    return {
      result,
      providerResponseId,
      responseModel,
      systemFingerprint:
        typeof raw.system_fingerprint === "string" ? raw.system_fingerprint.slice(0, 128) : null,
      openaiRequestId: response.headers.get("x-request-id")?.slice(0, 128) ?? null,
      requestSha256,
      responseSha256,
    };
  }
}
