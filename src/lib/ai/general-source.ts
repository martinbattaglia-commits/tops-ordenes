// Pirámide de conocimiento (2026-07-07) · CONTEXTO GENERAL (tool LOCAL).
//
// Dos responsabilidades, ambas SIN API externa y sin inventar nada:
//   1. Triviales del reloj del servidor: fecha, hora, día de la semana — con el
//      origen declarado ("fecha/hora del servidor, zona X").
//   2. Actualidad SIN fuente conectada (dólar, noticias, clima, inflación): la
//      respuesta honesta es la LIMITACIÓN específica + qué integración la
//      resolvería. Jamás un valor inventado ni memoria del modelo como dato
//      actual, y jamás el fallback "no encontré registros en Nexus".

import type { TemaActual } from "./intent-classifier";

export interface GeneralContextRow {
  kind: "fecha" | "limitacion";
  tema: string;
  detalle: string;
  fuente: string;
  [key: string]: string;
}

// Zona horaria FIJA de la operación (review adversarial): sin esto, la fecha/
// hora dependía del TZ del runtime — Netlify corre en UTC, así que en prod la
// hora se mostraba 3h adelantada. TOPS opera en Argentina: se ancla la zona.
const AR_TZ = "America/Argentina/Buenos_Aires";

const LIMITACIONES: Record<string, { que: string; integracion: string }> = {
  dolar: {
    que: "una cotización del dólar en tiempo real",
    integracion: "un proveedor de tipo de cambio (p.ej. BCRA / API de cotizaciones) o Gemini con grounding",
  },
  noticias: {
    que: "noticias en tiempo real",
    integracion: "un proveedor de noticias o Gemini con grounding/búsqueda",
  },
  clima: {
    que: "el pronóstico del tiempo en tiempo real",
    integracion: "un proveedor meteorológico o Gemini con grounding",
  },
  inflacion: {
    que: "el índice de inflación vigente",
    integracion: "una fuente oficial (INDEC) o Gemini con grounding",
  },
  // Review adversarial: normativa específica/vigencia — jamás inventar el
  // estado de una norma; se declara y se apunta a la fuente oficial.
  normativa: {
    que: "el estado vigente de una norma específica (fuente oficial actualizada)",
    integracion:
      "una fuente oficial (ANMAT, Boletín Oficial, argentina.gob.ar, InfoLEG) o Gemini con grounding — no debo afirmar la vigencia desde mi memoria",
  },
};

export function resolveGeneralContext(args: Record<string, unknown>): GeneralContextRow[] {
  const tema = String(args.tema ?? "fecha") as TemaActual;

  if (tema === "fecha" || tema === "hora") {
    const ahora = new Date();
    const fecha = new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: AR_TZ,
    }).format(ahora);
    const hora = new Intl.DateTimeFormat("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: AR_TZ,
    }).format(ahora);
    return [
      {
        kind: "fecha",
        tema,
        detalle:
          tema === "hora"
            ? `Son las ${hora} del ${fecha} (hora de Argentina — reloj del servidor).`
            : `Hoy es ${fecha} (hora de Argentina — reloj del servidor). Hora actual: ${hora}.`,
        fuente: "reloj del servidor (zona America/Argentina/Buenos_Aires)",
      },
    ];
  }

  const lim = LIMITACIONES[tema];
  if (!lim) return [];
  return [
    {
      kind: "limitacion",
      tema,
      detalle:
        `Esa consulta requiere ${lim.que}. Nexus Copilot todavía no tiene conectada una fuente externa para eso ` +
        `(integración posible: ${lim.integracion}). No invento valores actuales ni uso memoria del modelo como si fuera un dato de hoy.`,
      fuente: "sin fuente externa conectada",
    },
  ];
}
