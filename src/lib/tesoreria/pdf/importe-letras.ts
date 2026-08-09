/**
 * Importe en letras (es-AR) para comprobantes de Tesorería.
 * Derivación determinística del monto — no inventa datos. Formato recibo:
 * «Un millón doscientos cincuenta mil pesos con 00/100».
 */

const UNIDADES = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis",
  "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós",
  "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete",
  "veintiocho", "veintinueve",
];

const DECENAS = [
  "", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta",
  "ochenta", "noventa",
];

const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

/** 0–999 en letras. `apocope` usa «un»/«veintiún» (ante sustantivo). */
function tresCifras(n: number, apocope: boolean): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  let restoTxt: string;
  if (resto < 30) {
    restoTxt = UNIDADES[resto];
    if (apocope) {
      if (resto === 1) restoTxt = "un";
      if (resto === 21) restoTxt = "veintiún";
    }
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    let uTxt = UNIDADES[u];
    if (apocope && u === 1) uTxt = "un";
    restoTxt = u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${uTxt}`;
  }
  return [CENTENAS[c], restoTxt].filter(Boolean).join(" ");
}

/** Parte entera (0 – 999.999.999.999) en letras. */
function enteroEnLetras(n: number): string {
  if (n === 0) return "cero";
  const millones = Math.floor(n / 1_000_000);
  const partes: string[] = [];

  if (millones > 0) {
    const m = millones; // hasta 999.999 millones
    const milesDeMillon = Math.floor(m / 1000);
    const restoMillon = m % 1000;
    const trozos: string[] = [];
    if (milesDeMillon > 0) {
      trozos.push(milesDeMillon === 1 ? "mil" : `${tresCifras(milesDeMillon, true)} mil`);
    }
    if (restoMillon > 0) trozos.push(tresCifras(restoMillon, true));
    const cuerpo = trozos.join(" ");
    partes.push(m === 1 ? "un millón" : `${cuerpo} millones`);
  }

  const milesResto = Math.floor((n % 1_000_000) / 1000);
  if (milesResto > 0) {
    partes.push(milesResto === 1 ? "mil" : `${tresCifras(milesResto, true)} mil`);
  }

  const unidades = n % 1000;
  if (unidades > 0) partes.push(tresCifras(unidades, false));

  return partes.join(" ");
}

/** «Un millón doscientos cincuenta mil pesos con 00/100» (capitalizado). */
export function importeEnLetras(monto: number): string {
  if (!Number.isFinite(monto) || monto < 0) return "";
  // Redondear primero a centavos: `Math.floor` sobre el monto crudo dejaba
  // que 1,995 diera "un peso con 100/100" en vez de arrastrar el peso entero.
  const totalCentavos = Math.round(monto * 100);
  const entero = Math.floor(totalCentavos / 100);
  const centavos = totalCentavos % 100;
  // Apócope ante «pesos»: "uno" → "un", "veintiuno" → "veintiún".
  // El orden importa: encadenar dos `.replace` anclados con `$` no funciona,
  // porque el primero consume el sufijo de "veintiuno" y deja "veintiun" sin
  // tilde, y el segundo ya no encuentra nada que reemplazar.
  let letras = enteroEnLetras(entero);
  if (entero % 10 === 1 && entero % 100 !== 11) {
    letras = /veintiuno$/.test(letras)
      ? letras.replace(/veintiuno$/, "veintiún")
      : letras.replace(/uno$/, "un");
  }
  // «un millón de pesos», no «un millón pesos»: los múltiplos exactos de millón
  // llevan la preposición.
  const moneda = entero === 1 ? "peso" : "pesos";
  const nexo = entero >= 1_000_000 && entero % 1_000_000 === 0 ? "de " : "";
  const frase = `${letras} ${nexo}${moneda} con ${String(centavos).padStart(2, "0")}/100`;
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}
