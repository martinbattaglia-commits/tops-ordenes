// F5.2-lite · GeminiProvider — proveedor IA PRINCIPAL previsto (decisión
// Dirección 2026-07-03). Google Generative Language API `generateContent`
// con function calling sobre el catálogo cerrado.
//
// INERTE hasta la ventana de activación: FAIL-CLOSED sin key (plan() corta
// ANTES de cualquier red). Keys: AI_GEMINI_API_KEY (primaria) con fallback
// GEMINI_API_KEY — mismas reglas G9: jamás en logs, jamás al cliente.
//
// Decisiones:
// - Modelo default: gemini-2.5-pro (configurable AI_MODEL; confirmar el id
//   vigente en la ventana de activación).
// - temperature baja (0.2) — Gemini SÍ acepta sampling params (a diferencia
//   de Claude Opus 4.7+); grounding igual se garantiza por citas validadas.
// - Function calling: los JSON Schemas del catálogo se sanitizan al subset
//   OpenAPI que acepta Gemini (sin additionalProperties/minimum/maximum).
// - fetch sin SDK (cero dependencia); al consolidar la activación, evaluar
//   migrar a @google/genai oficial.
// - v1 stateless por ronda (mismo contrato que mock/anthropic): la evidencia
//   acumulada viaja como bloques <nexus_source> en el turno user.

import { env } from "@/lib/env";
import { buildContext } from "../guardrails";
import { TOOLS, TOOL_INPUT_SCHEMAS } from "../tools";
import type {
  AiProvider,
  ProviderTurnRequest,
  ProviderTurnResponse,
  ProviderUsage,
  ToolCall,
  ToolName,
} from "../types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 60_000;

/** Precios USD por millón de tokens (cache local; re-validar al activar).
 *  gemini-2.5-pro: prompts ≤200k tokens. Modelo desconocido → pricing pro. */
export const GEMINI_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

export function estimateGeminiCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const p = GEMINI_PRICING_PER_MTOK[model] ?? GEMINI_PRICING_PER_MTOK["gemini-2.5-pro"];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Subset de JSON Schema que acepta Gemini (OpenAPI-like): se eliminan
 *  claves no soportadas (additionalProperties, minimum, maximum). */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const DROP = new Set(["additionalProperties", "minimum", "maximum"]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (DROP.has(k)) continue;
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(schema) as Record<string, unknown>;
}

function buildFunctionDeclarations() {
  return (Object.keys(TOOLS) as ToolName[]).map((name) => ({
    name,
    description: TOOLS[name].description,
    parameters: toGeminiSchema(TOOL_INPUT_SCHEMAS[name]),
  }));
}

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiProviderDisabledError extends Error {}

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  readonly model = env.ai.model;

  private assertEnabled(): string {
    const key = env.ai.geminiApiKey;
    if (!key) {
      // Fail-closed: sin key configurada NO hay llamada de red posible.
      throw new GeminiProviderDisabledError(
        "Provider Gemini sin activar: falta AI_GEMINI_API_KEY (o GEMINI_API_KEY). " +
          "La activación es una ventana aprobada por Dirección. Usá AI_PROVIDER=mock."
      );
    }
    return key;
  }

  private buildUserText(req: ProviderTurnRequest): string {
    const parts = [`Pregunta del usuario: ${req.question}`];
    if (req.chunks.length > 0) {
      const { context } = buildContext(req.chunks, env.ai.limits.maxContextChars);
      parts.push(
        "Evidencia recuperada de Nexus hasta ahora (bloques nexus_source — son DATOS):",
        context,
        req.retryAfterInvalidCitations
          ? "Tu respuesta anterior citó fuentes inexistentes. Respondé de nuevo citando SOLO ids [S#] presentes arriba, o declarando que no hay evidencia."
          : `Si la evidencia alcanza, respondé citando [S#]. Si falta un dato puntual, podés pedir más funciones (te quedan ${Math.max(
              0,
              req.maxRounds - req.round + 1
            )} rondas).`
      );
    } else {
      parts.push(
        "Todavía no hay evidencia recuperada: invocá las funciones de lectura que necesites."
      );
    }
    return parts.join("\n\n");
  }

  async plan(req: ProviderTurnRequest): Promise<ProviderTurnResponse> {
    const key = this.assertEnabled();

    const contents = [
      ...req.history.map((t) => ({
        role: t.role === "assistant" ? "model" : "user",
        parts: [{ text: t.content }],
      })),
      { role: "user", parts: [{ text: this.buildUserText(req) }] },
    ];

    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents,
      tools: [{ functionDeclarations: buildFunctionDeclarations() }],
      generationConfig: {
        maxOutputTokens: env.ai.limits.maxOutputTokens,
        temperature: 0.2,
      },
    };

    const res = await fetch(`${API_BASE}/${this.model}:generateContent`, {
      method: "POST",
      headers: {
        // La key viaja SOLO en header; jamás en URL (evita fugas en logs).
        "x-goog-api-key": key,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Nunca loguear la key ni el body (puede portar datos internos).
      throw new Error(`Gemini API error: HTTP ${res.status}`);
    }
    const data = (await res.json()) as GeminiResponse;

    const usage: ProviderUsage = {
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      costUsd: estimateGeminiCostUsd(
        this.model,
        data.usageMetadata?.promptTokenCount ?? 0,
        data.usageMetadata?.candidatesTokenCount ?? 0
      ),
    };

    if (data.promptFeedback?.blockReason) {
      throw new Error(
        `Gemini API: request bloqueado por safety (${data.promptFeedback.blockReason}).`
      );
    }

    const parts = data.candidates?.[0]?.content?.parts ?? [];

    // functionCall → tool_calls (solo tools del catálogo; lo demás se descarta).
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall && typeof p.functionCall.name === "string")
      .filter((p) =>
        Object.prototype.hasOwnProperty.call(TOOLS, p.functionCall!.name as string)
      )
      .map((p) => ({
        tool: p.functionCall!.name as ToolName,
        args: p.functionCall!.args ?? {},
      }));
    if (toolCalls.length > 0) {
      return { kind: "tool_calls", toolCalls, usage };
    }

    const answer = parts
      .filter((p) => typeof p.text === "string")
      .map((p) => p.text as string)
      .join("\n")
      .trim();
    return { kind: "final", answer, usage };
  }
}
