#!/usr/bin/env node
/**
 * SIMULADOR DEL BACKFILL DEL LEDGER — PLAN, NO EJECUCIÓN.
 *
 * ─── QUÉ CORRIGE ────────────────────────────────────────────────────────────
 *
 * La simulación anterior vivía en un heredoc que no quedó en ninguna parte, su
 * salida estaba fuera del candidato, y el reporte afirmó que cada fila estaba
 * «condicionada a que su sonda acredite el objeto» cuando NO SE EJECUTÓ NINGUNA
 * SONDA. Este generador existe para que eso no vuelva a pasar: es determinista,
 * versionado, y marca explícitamente qué es dato observado y qué no.
 *
 * ─── QUÉ ES Y QUÉ NO ES CADA FILA ───────────────────────────────────────────
 *
 *   OBSERVED_REGISTERED   · el ledger remoto leído en la evidencia trae esta
 *                           migración: es un HECHO observado.
 *   INFERRED_NOT_REGISTERED · no aparece en esa evidencia. Es una INFERENCIA
 *                           sobre el ledger, no sobre el esquema.
 *   PROBE_REQUIRED_NOT_EXECUTED · para decidir si el objeto está realmente
 *                           aplicado hace falta una sonda contra la base. NO se
 *                           ejecutó ninguna. Sin ella, la fila NO es candidata
 *                           legítima a backfill.
 *
 * NINGUNA fila queda autorizada a escritura por este archivo. `authorized_for_write`
 * es `false` en todas, y así se mantiene hasta que existan sondas reales
 * autorizadas. El backfill NO aplica SQL de migración: sólo registraría en el
 * ledger lo que una sonda acredite como ya aplicado.
 *
 * Uso:
 *   node supabase/lineage/simulate-backfill.mjs            → escribe el JSON
 *   node supabase/lineage/simulate-backfill.mjs --check    → falla si difiere
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verificarCatalogo } from "./verify.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const CATALOGO = join(AQUI, "catalog.json");
const SALIDA = join(AQUI, "BACKFILL-SIMULATION.json");

/**
 * Evidencia del ledger remoto. Vive FUERA del repositorio a propósito: es una
 * lectura puntual de producción, no un artefacto del código. Si no está, el
 * plan se genera igual y lo dice —no se inventa el estado del ledger—.
 */
export const EVIDENCIA_LEDGER = join(
  RAIZ, "..", "..", "NEXUS-ARTIFACTS", "wms-lineage-gate", "ledger-evidence-20260811.json",
);

export const ESTADO_LEDGER = {
  OBSERVADA: "OBSERVED_REGISTERED",
  INFERIDA: "INFERRED_NOT_REGISTERED",
  SIN_EVIDENCIA: "LEDGER_EVIDENCE_ABSENT",
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Nombres registrados en el ledger. En prod el número lógico vive en `name`. */
function nombresRegistrados(evidencia) {
  const reg = new Set();
  for (const e of evidencia?.ledger_completo ?? []) {
    if (e?.name) reg.add(e.name);
  }
  return reg;
}

/**
 * ¿El ledger trae esta migración?
 *
 * Se compara por el nombre del archivo sin extensión y, como los registros
 * `0001`–`0011` se grabaron sin prefijo numérico, también por el sufijo. Es una
 * heurística de MATCHEO SOBRE LA EVIDENCIA, no una comprobación del esquema:
 * por eso su resultado nunca se llama «aplicado».
 */
export function matchearLedger(filename, registrados) {
  const base = filename.replace(/\.sql$/, "");
  if (registrados.has(base)) return { match: true, via: "nombre exacto" };
  const i = base.indexOf("_");
  if (i > 0 && registrados.has(base.slice(i + 1))) {
    return { match: true, via: "sufijo sin prefijo numérico" };
  }
  return { match: false, via: null };
}

export function construirPlan({
  catalogo = JSON.parse(readFileSync(CATALOGO, "utf8")),
  evidencia = existsSync(EVIDENCIA_LEDGER)
    ? JSON.parse(readFileSync(EVIDENCIA_LEDGER, "utf8"))
    : null,
  evidenciaSha = existsSync(EVIDENCIA_LEDGER)
    ? sha256(readFileSync(EVIDENCIA_LEDGER))
    : null,
} = {}) {
  // El plan sólo se construye sobre un catálogo VÁLIDO. Un rollback
  // reclasificado, un contador maquillado o cualquier otra violación aborta
  // ACÁ: antes de emitir una sola fila y antes de que la CLI pueda escribir
  // BACKFILL-SIMULATION.json.
  const violaciones = verificarCatalogo({ catalogo });
  if (violaciones.length > 0) {
    const detalle = violaciones.map((x) => `${x.codigo}: ${x.detalle}`).join(" · ");
    throw new Error(`CATALOGO_INVALIDO — el plan de backfill no se genera: ${detalle}`);
  }

  const ejecutables = (catalogo.entries ?? []).filter(
    (e) => e.estado === "active" || e.estado === "corrective",
  );
  const registrados = evidencia ? nombresRegistrados(evidencia) : null;

  const filas = ejecutables.map((e) => {
    if (!registrados) {
      return {
        ledger_version: e.ledger_version,
        ledger_name: e.ledger_name,
        estado_ledger: ESTADO_LEDGER.SIN_EVIDENCIA,
        evidencia: "no hay lectura del ledger disponible en este entorno",
        schema_probe: "PROBE_REQUIRED_NOT_EXECUTED",
        authorized_for_write: false,
      };
    }
    const { match, via } = matchearLedger(e.filename, registrados);
    return {
      ledger_version: e.ledger_version,
      ledger_name: e.ledger_name,
      estado_ledger: match ? ESTADO_LEDGER.OBSERVADA : ESTADO_LEDGER.INFERIDA,
      evidencia: match
        ? `dato observado en el ledger (match por ${via})`
        : "inferencia: ausente de la evidencia del ledger; NO implica que el objeto no exista",
      // La sonda es lo ÚNICO que podría acreditar que el objeto está aplicado.
      // No se ejecutó ninguna, y sin ella la fila no es candidata a escritura.
      schema_probe: "PROBE_REQUIRED_NOT_EXECUTED",
      authorized_for_write: false,
    };
  });

  const observadas = filas.filter((f) => f.estado_ledger === ESTADO_LEDGER.OBSERVADA).length;
  const inferidas = filas.filter((f) => f.estado_ledger === ESTADO_LEDGER.INFERIDA).length;

  return {
    $schema: "wms-lineage-backfill-plan/1",
    naturaleza: "PLAN ONLY — no se ejecutó ninguna sonda ni ninguna escritura",
    generado_por: "supabase/lineage/simulate-backfill.mjs",
    determinista: "misma entrada → mismos bytes; no usa reloj, azar ni orden de directorio",
    fuente_ledger: {
      archivo: "ledger-evidence-20260811.json",
      presente: Boolean(evidencia),
      sha256: evidenciaSha,
      alcance: "lectura read-only del ledger productivo; NO incluye estado del esquema",
    },
    conteos: {
      ejecutables_en_catalogo: ejecutables.length,
      observadas_en_ledger: observadas,
      inferidas_no_registradas: inferidas,
      filas_autorizadas_a_escritura: 0,
      sondas_ejecutadas: 0,
    },
    advertencia:
      "Las filas inferidas NO son seguras para producción. Afirmar que lo son exigiría " +
      "sondas reales autorizadas contra el esquema, que este generador no ejecuta y esta " +
      "sesión no autoriza.",
    escritura: {
      sentencia_prevista:
        "insert into supabase_migrations.schema_migrations(version,name) " +
        "values (<ledger_version>,<ledger_name>) on conflict (version) do nothing",
      idempotencia: "on conflict (version) do nothing → una segunda corrida escribe 0 filas",
      precondicion: "cada fila exige su sonda ejecutada y autorizada; hoy: 0 de " + filas.length,
      ejecutada: false,
    },
    filas,
  };
}

/** Serialización estable: el JSON es byte-reproducible. */
export const serializar = (plan) => `${JSON.stringify(plan, null, 2)}\n`;

/** ¿Está disponible la evidencia del ledger en este entorno? */
export const hayEvidenciaLedger = () => existsSync(EVIDENCIA_LEDGER);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const texto = serializar(construirPlan());
  if (process.argv.includes("--check")) {
    // Sin la evidencia del ledger —que vive FUERA del repositorio— el plan no
    // se puede reconstruir igual, y decir «desactualizado» sería mentir sobre
    // la causa. Se informa NO VERIFICABLE y no se falla.
    if (!existsSync(EVIDENCIA_LEDGER)) {
      console.log("BACKFILL PLAN NO VERIFICABLE AQUÍ · falta la evidencia del ledger (fuera del repo)");
      process.exit(0);
    }
    const actual = existsSync(SALIDA) ? readFileSync(SALIDA, "utf8") : "";
    if (actual !== texto) {
      console.error("BACKFILL PLAN DESACTUALIZADO: regenerá con `node supabase/lineage/simulate-backfill.mjs`");
      process.exit(1);
    }
    console.log("BACKFILL PLAN OK · reproducible byte a byte");
  } else {
    writeFileSync(SALIDA, texto);
    const p = JSON.parse(texto);
    console.log(
      `BACKFILL PLAN generado · ${p.conteos.ejecutables_en_catalogo} ejecutables · ` +
        `${p.conteos.observadas_en_ledger} observadas · ${p.conteos.inferidas_no_registradas} inferidas · ` +
        `${p.conteos.sondas_ejecutadas} sondas · ${p.conteos.filas_autorizadas_a_escritura} autorizadas`,
    );
  }
}
