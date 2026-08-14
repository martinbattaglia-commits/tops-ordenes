// Nexus Link · FASE B — Identidad del contacto de WhatsApp (PURA, sin IO).
//
// ─── FUENTE ÚNICA Y AUTORITATIVA ──────────────────────────────────────────
//
// El teléfono de la contraparte NO se guarda en una columna propia: ya vive,
// desde el día uno, en `connect_conversations.context_id` con la forma
// `wa:<E164>`. Esa convención la fijan a la vez el importador histórico
// (`connect/wa-import/ingest.ts`) y la proyección del inbound vivo
// (`whatsapp/link-projection.ts`), y el índice único
// `connect_conversations_context_uidx` la sostiene: dos hilos de la misma
// contraparte son EL MISMO hilo porque comparten ese `context_id`.
//
// Medido en producción (2026-08-14, sólo lectura):
//
//   · 20 / 20 conversaciones `kind='whatsapp'` tienen `context_id like 'wa:%'`
//   · 20 / 20 de esos teléfonos validan como E.164
//   · 20 / 20 tienen `title` (el nombre visible confirmado en la importación)
//   ·  5 / 20 tienen fila en `wa_identities`
//
// Por eso la ficha se resuelve contra `connect_conversations` y NO contra
// `wa_identities`: la segunda cubre un cuarto del universo y —esto es lo
// decisivo— tiene RLS activa con CERO políticas, de modo que `authenticated`
// no puede leerla nunca; sólo `service_role` la ve. Leerla para pintar una
// ficha exigiría saltar la RLS con la clave de servicio, que es exactamente lo
// que no debe hacerse para exponer un dato personal. No se crea columna, no se
// duplica el dato y no se inventa ningún número.
//
// ─── PRESENTACIÓN vs IDENTIDAD ────────────────────────────────────────────
//
// `e164` es la IDENTIDAD: canónica, sin espacios, comparable y copiable.
// `legible` es sólo PRESENTACIÓN: agrupa dígitos para que un humano los lea en
// voz alta. Nunca se compara, nunca se persiste y nunca se manda a Meta. Si el
// agrupado no fuera perfecto para un país exótico, no se pierde nada: el dato
// verdadero está al lado y es el que copia el botón.

/** Prefijo canónico del `context_id` de un hilo de WhatsApp. */
export const WA_CONTEXT_PREFIX = "wa:";

export interface WaContactIdentity {
  /** Nombre visible del contacto. Nunca vacío: cae al teléfono o a un genérico. */
  nombre: string;
  /** E.164 canónico (`+` y 8–15 dígitos) o `null` si la fuente no lo tiene. */
  e164: string | null;
  /** Agrupado legible para lectura humana. `null` cuando no hay número. */
  legible: string | null;
}

/**
 * E.164 estricto: `+`, primer dígito distinto de cero, 8 a 15 dígitos en total.
 * Deliberadamente NO normaliza: si la fuente canónica trae basura, la respuesta
 * es «no disponible», no un número reconstruido. Inventar dígitos sería peor
 * que no mostrar nada.
 */
export function esE164(valor: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(valor);
}

/**
 * Extrae el teléfono del `context_id`. Devuelve `null` ante cualquier forma que
 * no sea exactamente `wa:<E164>` — incluido el `context_id` de un hilo interno,
 * que tiene otra forma por completo (`CTX-AAAA-NNNNNN`).
 */
export function telefonoDesdeContextId(contextId: string | null | undefined): string | null {
  if (!contextId || !contextId.startsWith(WA_CONTEXT_PREFIX)) return null;
  const crudo = contextId.slice(WA_CONTEXT_PREFIX.length);
  return esE164(crudo) ? crudo : null;
}

/**
 * Códigos de país de UN dígito. El resto se resuelve por tabla de dos dígitos y,
 * si tampoco cae ahí, se asume tres. Es la regla estándar de desambiguación de
 * E.164 y alcanza para separar el país del número nacional.
 */
const CC_1 = new Set(["1", "7"]);
const CC_2 = new Set([
  "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44",
  "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58",
  "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91",
  "92", "93", "94", "95", "98",
]);

function partirCodigoPais(digitos: string): [string, string] {
  if (CC_1.has(digitos[0] ?? "")) return [digitos.slice(0, 1), digitos.slice(1)];
  if (CC_2.has(digitos.slice(0, 2))) return [digitos.slice(0, 2), digitos.slice(2)];
  return [digitos.slice(0, 3), digitos.slice(3)];
}

/** Agrupa de a cuatro desde la DERECHA: el resto corto queda adelante. */
function agruparDesdeLaDerecha(n: string): string[] {
  const grupos: string[] = [];
  for (let fin = n.length; fin > 0; fin -= 4) {
    grupos.unshift(n.slice(Math.max(0, fin - 4), fin));
  }
  return grupos;
}

/**
 * Formato internacional legible. Argentina (+54) recibe trato explícito porque
 * es el país de toda la operación: se separa el `9` de móvil y el código de área
 * de Buenos Aires (`11`), que es el caso real de los hilos existentes. Cualquier
 * otro país cae en el agrupado genérico, que es legible sin fingir que se conoce
 * su plan de numeración.
 */
export function formatearLegible(e164: string): string {
  if (!esE164(e164)) return e164;
  const [cc, nacional] = partirCodigoPais(e164.slice(1));

  if (cc === "54") {
    const movil = nacional.startsWith("9");
    const sinMovil = movil ? nacional.slice(1) : nacional;
    const marca = movil ? " 9" : "";
    if (sinMovil.startsWith("11") && sinMovil.length === 10) {
      return `+54${marca} 11 ${sinMovil.slice(2, 6)}-${sinMovil.slice(6)}`;
    }
    if (sinMovil.length === 10) {
      return `+54${marca} ${sinMovil.slice(0, 3)} ${sinMovil.slice(3, 6)}-${sinMovil.slice(6)}`;
    }
    return `+54${marca} ${agruparDesdeLaDerecha(sinMovil).join(" ")}`;
  }

  // Diez dígitos nacionales es la longitud más común del mundo (todo el plan
  // norteamericano, buena parte de Europa y Asia): agruparlos 3-3-4 se lee
  // mucho mejor que en bloques de cuatro desde la derecha.
  if (nacional.length === 10) {
    return `+${cc} ${nacional.slice(0, 3)} ${nacional.slice(3, 6)}-${nacional.slice(6)}`;
  }
  return `+${cc} ${agruparDesdeLaDerecha(nacional).join(" ")}`;
}

/**
 * Qué mostrar donde antes se pintaba el `context_id` crudo.
 *
 * En los hilos internos el `context_id` es una referencia técnica inocua
 * (`CTX-AAAA-NNNNNN`) y sirve para rastrear. En WhatsApp **es el teléfono**, y
 * pintarlo como cadena técnica lo repartía por toda la interfaz —un renglón por
 * resultado de búsqueda— sin que nadie lo hubiera pedido. El número se muestra
 * donde se lo pide: en la ficha de contacto.
 */
export function etiquetaDeContexto(kind: string, contextId: string | null): string {
  if (kind === "whatsapp") return "WhatsApp";
  return contextId ?? "";
}

/**
 * Resuelve la ficha a partir de la fila de conversación YA AUTORIZADA.
 *
 * Es pura a propósito: la decisión de autorización vive una capa más arriba
 * (`read/wa-contact.ts`), contra la base. Acá no hay forma de «colar» un dato,
 * porque lo único que entra es lo que la RLS dejó salir.
 *
 * Devuelve `null` para todo lo que no sea un hilo de WhatsApp: un hilo interno
 * no tiene ficha de contacto y no debe mostrar una vacía.
 */
export function resolverContactoWa(fila: {
  kind: string;
  title: string | null;
  contextId: string | null;
}): WaContactIdentity | null {
  if (fila.kind !== "whatsapp") return null;
  const e164 = telefonoDesdeContextId(fila.contextId);
  const titulo = fila.title?.trim();
  return {
    nombre: titulo || e164 || "Contacto de WhatsApp",
    e164,
    legible: e164 ? formatearLegible(e164) : null,
  };
}
