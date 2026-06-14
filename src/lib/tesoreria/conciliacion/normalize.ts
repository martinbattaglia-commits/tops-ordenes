/**
 * Normalizador unificado — Conciliación Bancaria IA (S1).
 *
 * `ParsedLine[]` (pesos con signo, específico por banco) → `NormalizedLine[]`
 * canónico en CENTAVOS ENTEROS, ordenado cronológicamente (orden de aplicación),
 * con clasificación sistémico/operativo. Toda la aritmética en centavos para
 * evitar drift de punto flotante (misma disciplina que `cuentaCorriente.ts`).
 *
 * El extracto de Galicia viene en orden ascendente (más viejo primero); el de
 * Santander en descendente — `normalize` reordena a ascendente (= orden de
 * aplicación del saldo) según el banco. La validación de continuidad de saldo es
 * AUTO-VERIFICANTE: si el orden o el parseo fueran incorrectos, aparecen rupturas.
 */
import type { Banco, NormalizedLine, ParsedLine, SaldoValidation } from "./types";
import { classify } from "./systemic";

const cents = (pesos: number): number => Math.round((Number(pesos) || 0) * 100);

/** Dirección cronológica del archivo por banco. */
const FILE_ORDER: Record<Banco, "asc" | "desc"> = {
  galicia: "asc",
  santander: "desc",
};

export function normalize(parsed: ParsedLine[], banco: Banco): NormalizedLine[] {
  // Reordenar a orden de aplicación (ascendente cronológico).
  const enOrden =
    FILE_ORDER[banco] === "desc" ? [...parsed].reverse() : [...parsed];

  return enOrden.map((p) => {
    const tipo = p.importe >= 0 ? "credito" : "debito";
    const { categoria, subtipo } = classify(p.descripcion, p.codigoConcepto);
    return {
      fecha: p.fecha,
      importe: Math.abs(cents(p.importe)),
      tipo,
      descripcion: p.descripcion,
      contraparte: p.contraparte,
      referencia: p.referencia,
      saldo: cents(p.saldo),
      categoria,
      subtipo,
      codigoConcepto: p.codigoConcepto,
    };
  });
}

/** Importe con signo en centavos (crédito +, débito −). */
function signedCents(l: NormalizedLine): number {
  return l.tipo === "credito" ? l.importe : -l.importe;
}

/**
 * Cruce duro de saldo: para cada paso, `saldo[i] − saldo[i-1]` debe igualar el
 * importe con signo de la línea `i`. Δ acumulado debe ser 0,00.
 */
export function validateSaldoContinuity(lines: NormalizedLine[]): SaldoValidation {
  if (lines.length === 0) {
    return { ok: true, deltaCents: 0, openingCents: 0, closingCents: 0, rupturas: [] };
  }
  const rupturas: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const paso = lines[i].saldo - lines[i - 1].saldo;
    if (paso !== signedCents(lines[i])) rupturas.push(i);
  }
  const openingCents = lines[0].saldo - signedCents(lines[0]);
  const closingCents = lines[lines.length - 1].saldo;
  const sumaSigned = lines.reduce((s, l) => s + signedCents(l), 0);
  const deltaCents = closingCents - (openingCents + sumaSigned);
  return { ok: rupturas.length === 0 && deltaCents === 0, deltaCents, openingCents, closingCents, rupturas };
}

/** Resumen de totales por tipo (para cuadrar contra la fila de totales del banco). */
export function totales(lines: NormalizedLine[]): {
  countDebito: number;
  countCredito: number;
  sumaDebitoCents: number;
  sumaCreditoCents: number;
} {
  let countDebito = 0,
    countCredito = 0,
    sumaDebitoCents = 0,
    sumaCreditoCents = 0;
  for (const l of lines) {
    if (l.tipo === "debito") {
      countDebito++;
      sumaDebitoCents += l.importe;
    } else {
      countCredito++;
      sumaCreditoCents += l.importe;
    }
  }
  return { countDebito, countCredito, sumaDebitoCents, sumaCreditoCents };
}
