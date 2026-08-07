// LINK-WA-002 · FASE 2 E1 — Generador MOCK determinista. PURO (sin IO, sin red, costo 0).
//
// ⚠️ HONESTIDAD: esto NO es inteligencia artificial. Es un simulador por palabras clave
// que emite el MISMO formato de salida cruda que emitiría un LLM (un string con JSON),
// para poder validar el circuito completo — esquema, citas, persistencia, bandeja,
// permisos, límites — sin gastar un peso ni exponer datos a un provider.
// En E2 lo único que cambia es QUIÉN produce ese string; el parser y el validador
// (schema.ts) son exactamente los mismos.

import type { WaMessageInput } from "./prompt";
import { EVIDENCE_OPEN, EVIDENCE_CLOSE } from "./prompt";

const RX = {
  // Señales de contenido dirigido al modelo ⇒ se CLASIFICA como riesgo, no se obedece.
  injection: /(ignor[áa]|olvid[áa]|desestim[áa])\s+(las\s+)?(instrucciones|reglas)|system\s*prompt|actu[áa]\s+como|eres\s+un|sos\s+un\s+asistente|<<<|jailbreak/i,
  comercial: /cotiz|presupuest|precio|tarifa|propuesta|contrat|alquil|m2|metros|oportunidad/i,
  proveedor: /factur|remito|servicio t[eé]cnico|reparaci|manteni|instalaci|repuesto|obra/i,
  rrhh: /licencia|vacacion|sueldo|n[oó]mina|ausent|carpeta m[eé]dica|contrataci[oó]n de personal/i,
  administrativo: /escritur|poder|habilitaci[oó]n|anmat|senasa|documentaci[oó]n|tr[aá]mite|seguro|impuest/i,
  operativo: /dep[oó]sito|cajas|pallet|ingres|retir|entrega|recepci|horario|sereno|camion/i,
  pendiente: /qued[oó] pendiente|te aviso|me confirm[áa]s|esperando|para ma[ñn]ana|recordar|pendiente/i,
  riesgo: /reclam|problema|no lleg|error|urgente|rotur|da[ñn]ad|falta|queja|demora/i,
  docFaltante: /falta (el|la|un|una)?\s*(documento|remito|factura|certificado|habilitaci)|mand[áa]me (el|la)|nos falta/i,
  decision: /acordamos|confirmado|queda as[ií]|decidimos|aprobado|listo entonces|de acuerdo/i,
};

function count(messages: WaMessageInput[], re: RegExp): number {
  return messages.filter((m) => re.test(m.body ?? "")).length;
}

function firstMatch(messages: WaMessageInput[], re: RegExp): WaMessageInput | undefined {
  return messages.find((m) => re.test(m.body ?? ""));
}

function cite(m: WaMessageInput | undefined, fallback: WaMessageInput) {
  const src = m ?? fallback;
  return [{ messageId: src.id, quote: (src.body ?? "").slice(0, 120) }];
}

/** Devuelve el string crudo (JSON) que emitiría el modelo. Determinista. */
export function mockAnalyzeRaw(messages: WaMessageInput[]): string {
  if (messages.length === 0) {
    return JSON.stringify({
      clasificacion: { clase: "operativo", confidence: 0.1, citations: [], rationale: "Sin mensajes." },
      hallazgos: [], acciones: [],
    });
  }
  const base = messages[0];

  // Clasificación por volumen de señales (empate → operativo, el default del canal).
  const scores: Array<[string, number]> = [
    ["comercial", count(messages, RX.comercial)],
    ["proveedor", count(messages, RX.proveedor)],
    ["administrativo", count(messages, RX.administrativo)],
    ["rrhh", count(messages, RX.rrhh)],
    ["operativo", count(messages, RX.operativo)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const [clase, top] = scores[0];
  const total = messages.length;
  const confidence = total > 0 ? Math.min(0.95, 0.35 + (top / total)) : 0.3;

  const hallazgos: unknown[] = [];
  const acciones: unknown[] = [];

  // Contenido dirigido al modelo ⇒ RIESGO clasificado (nunca obedecido).
  const inj = firstMatch(messages, RX.injection);
  if (inj) {
    hallazgos.push({
      tipo: "riesgo",
      resumen: "Un mensaje contiene texto que intenta dar instrucciones al sistema. Se trata como dato, no se ejecuta.",
      confidence: 0.9,
      citations: cite(inj, base),
    });
  }

  const pend = firstMatch(messages, RX.pendiente);
  if (pend) {
    hallazgos.push({
      tipo: "seguimiento",
      resumen: "Hay un compromiso o pendiente mencionado sin cierre explícito en el hilo.",
      confidence: 0.55,
      citations: cite(pend, base),
    });
    acciones.push({
      accion: "crear_tarea",
      titulo: "Revisar pendiente detectado en la conversación",
      detalle: "Se menciona un compromiso sin confirmación posterior. Verificar si sigue abierto.",
      entidades: { prioridad: "media" },
      confidence: 0.5,
      citations: cite(pend, base),
    });
  }

  const riesgo = firstMatch(messages, RX.riesgo);
  if (riesgo && !inj) {
    hallazgos.push({
      tipo: "riesgo",
      resumen: "Se menciona un problema, reclamo o demora que podría requerir atención.",
      confidence: 0.5,
      citations: cite(riesgo, base),
    });
  }

  const doc = firstMatch(messages, RX.docFaltante);
  if (doc) {
    hallazgos.push({
      tipo: "documentacion_faltante",
      resumen: "Se solicita o se menciona documentación faltante.",
      confidence: 0.6,
      citations: cite(doc, base),
    });
  }

  const dec = firstMatch(messages, RX.decision);
  if (dec) {
    hallazgos.push({
      tipo: "decision_relevante",
      resumen: "Se registra un acuerdo o confirmación entre las partes.",
      confidence: 0.55,
      citations: cite(dec, base),
    });
  }

  const com = firstMatch(messages, RX.comercial);
  if (com && clase === "comercial") {
    hallazgos.push({
      tipo: "oportunidad",
      resumen: "Aparecen señales comerciales (cotización, precio o propuesta).",
      confidence: 0.5,
      citations: cite(com, base),
    });
    acciones.push({
      accion: "crear_oportunidad",
      titulo: "Evaluar oportunidad comercial mencionada",
      detalle: "La conversación contiene señales de interés comercial sin cierre registrado.",
      entidades: { prioridad: "media" },
      confidence: 0.45,
      citations: cite(com, base),
    });
  }

  return JSON.stringify({
    clasificacion: {
      clase,
      confidence: Number(confidence.toFixed(2)),
      citations: cite(firstMatch(messages, RX[clase as keyof typeof RX] ?? RX.operativo), base),
      rationale: `Predominan señales de tipo "${clase}" en ${top} de ${total} mensajes analizados.`,
    },
    hallazgos,
    acciones,
  });
}

/** Emula prosa alrededor del JSON (como haría un LLM real) para ejercitar el parser. */
export function mockAnalyzeRawWithProse(messages: WaMessageInput[]): string {
  return `Analicé la conversación.\n\n${mockAnalyzeRaw(messages)}\n\nEspero que sirva.`;
}

export const MOCK_MARKERS = { EVIDENCE_OPEN, EVIDENCE_CLOSE };
