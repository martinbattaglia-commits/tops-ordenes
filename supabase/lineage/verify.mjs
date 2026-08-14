#!/usr/bin/env node
/**
 * VERIFICADOR DETERMINISTA DEL CATÁLOGO DE LINAJE.
 *
 * El catálogo es la fuente única del orden de replay y de la identidad de cada
 * migración. Este verificador existe para que esa fuente no pueda desincronizarse
 * en silencio: falla CERRADO ante cualquier discrepancia.
 *
 * Uso:  node supabase/lineage/verify.mjs [--json]
 * Exit: 0 si todo cierra · 1 con el detalle de cada violación.
 */

import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR_MIGRACIONES = join(RAIZ, "supabase", "migrations");
const CATALOGO = join(RAIZ, "supabase", "lineage", "catalog.json");

/** Rango preservado como evidencia documental. NUNCA ejecutable. */
export const APPLIED_REMOTE_ARCHIVE = Array.from({ length: 14 }, (_, i) =>
  String(205 + i).padStart(4, "0"),
);

const ESTADOS = new Set(["active", "corrective", "superseded", "rollback"]);
const EJECUTABLES = new Set(["active", "corrective"]);

/**
 * Convención CERRADA de rollback: el NOMBRE lo declara. Un artefacto que se
 * llama a sí mismo rollback no puede entrar al árbol ejecutable aunque el
 * catálogo lo reclasifique —esa reclasificación coordinada es exactamente la
 * vía que este bloque cierra—.
 */
const esRollbackPorNombre = (nombre) =>
  typeof nombre === "string" &&
  (nombre.startsWith("ROLLBACK_") || nombre.endsWith("_rollback.sql"));

/**
 * Ancla EXACTA de los rollbacks conocidos. La convención cubre los futuros;
 * esta lista impide que uno conocido eluda la política mediante rename: con el
 * nombre que tenga, cada uno debe seguir catalogado con estado `rollback`.
 */
const ROLLBACKS_CONOCIDOS = [
  "0083_cash_box_rollback.sql",
  "0091_prospeccion_rollback.sql",
  "ROLLBACK_0233_wa_make_relay_outbox.sql",
];

/**
 * Regla CERRADA del nombre de archivo. Se aplica ANTES de resolver ningún
 * path: un `filename` es un nombre, nunca una ruta. Sin esto, `join(dir, name)`
 * con `../` leería fuera del directorio de migraciones.
 */
export const FILENAME_RE = /^[A-Za-z0-9._-]+\.sql$/;

/** `null` si el nombre es válido; el motivo si no. */
export function motivoFilenameInvalido(nombre) {
  if (typeof nombre !== "string" || nombre.length === 0) return "vacío o no es texto";
  if (nombre.includes("/") || nombre.includes("\\")) return "contiene separador de ruta";
  if (nombre.includes("..")) return "contiene ..";
  if (nombre.startsWith("/") || /^[A-Za-z]:/.test(nombre)) return "path absoluto";
  if (!FILENAME_RE.test(nombre)) return `no matchea ${FILENAME_RE}`;
  return null;
}

/**
 * Resuelve el path DENTRO del directorio y comprueba que no se escape, ni por
 * la ruta ni por un symlink. Devuelve `null` si escapa.
 */
function pathSeguro(dir, nombre) {
  if (motivoFilenameInvalido(nombre)) return null;
  const base = resolve(dir);
  const destino = resolve(base, nombre);
  if (destino !== join(base, nombre)) return null;
  if (!destino.startsWith(base + sep)) return null;
  try {
    // Un symlink que apunte afuera tampoco vale.
    const real = realpathSync(destino);
    const realBase = realpathSync(base);
    if (!real.startsWith(realBase + sep)) return null;
  } catch {
    return null; // no existe o no se puede resolver: fail-closed
  }
  return destino;
}

export function cargarCatalogo(ruta = CATALOGO) {
  return JSON.parse(readFileSync(ruta, "utf8"));
}

function sha256(ruta) {
  return createHash("sha256").update(readFileSync(ruta)).digest("hex");
}

/**
 * Devuelve la lista de violaciones. Vacía = catálogo sano.
 * Cada violación lleva `codigo` para que las pruebas afirmen sobre el motivo y
 * no sobre el texto.
 */
export function verificarCatalogo({
  catalogo = cargarCatalogo(),
  dirMigraciones = DIR_MIGRACIONES,
} = {}) {
  const v = [];
  const push = (codigo, detalle) => v.push({ codigo, detalle });
  const entries = Array.isArray(catalogo?.entries) ? catalogo.entries : [];

  if (entries.length === 0) push("CATALOGO_VACIO", "el catálogo no tiene entradas");

  // ORDEN: una sola fuente. `orden` DEBE ser la posición del array (1-based),
  // porque el replay consume el array y las dependencias se validan con
  // `orden`. Si divergieran, se estaría validando un orden distinto del que se
  // ejecuta —exactamente el agujero que este bloque cierra—.
  entries.forEach((e, i) => {
    const esperado = i + 1;
    if (!Number.isInteger(e?.orden)) {
      push("ORDEN_NO_ENTERO", `${e?.id}: ${e?.orden}`);
    } else if (e.orden !== esperado) {
      push("ORDEN_INCOHERENTE_CON_ARRAY", `${e?.id}: orden=${e.orden}, posición=${esperado}`);
    }
  });
  {
    const ords = entries.map((e) => e?.orden).filter(Number.isInteger).sort((a, b) => a - b);
    for (let i = 0; i < ords.length; i += 1) {
      if (ords[i] !== i + 1) {
        push("ORDEN_NO_CONTIGUO", `se esperaba ${i + 1} y se encontró ${ords[i]}`);
        break;
      }
    }
  }

  const enDisco = new Set(
    readdirSync(dirMigraciones).filter((f) => f.endsWith(".sql")),
  );
  const enCatalogo = new Set();
  const ids = new Set();
  const versiones = new Set();
  const ordenes = new Set();

  for (const e of entries) {
    const id = e?.id ?? "(sin id)";

    if (ids.has(id)) push("ID_DUPLICADO", id);
    ids.add(id);

    if (!ESTADOS.has(e?.estado)) push("ESTADO_DESCONOCIDO", `${id}: ${e?.estado}`);

    if (versiones.has(e?.ledger_version)) {
      push("LEDGER_VERSION_DUPLICADA", `${id}: ${e?.ledger_version}`);
    }
    versiones.add(e?.ledger_version);

    if (ordenes.has(e?.orden)) push("ORDEN_DUPLICADO", `${id}: ${e?.orden}`);
    ordenes.add(e?.orden);

    // Identidad = filename completo. El prefijo numérico NO alcanza.
    if (e?.filename !== e?.id) push("IDENTIDAD_INCONSISTENTE", id);

    const malNombre = motivoFilenameInvalido(e?.filename);
    if (malNombre) {
      push("FILENAME_INVALIDO", `${e?.filename}: ${malNombre}`);
    } else if (!enDisco.has(e?.filename)) {
      push("CATALOGADA_AUSENTE", e?.filename);
    } else {
      enCatalogo.add(e.filename);
      const seguro = pathSeguro(dirMigraciones, e.filename);
      if (!seguro) {
        push("PATH_FUERA_DEL_DIRECTORIO", e.filename);
      } else {
        const real = sha256(seguro);
        if (real !== e?.sha256) push("CHECKSUM_CAMBIADO", `${e.filename}: ${real}`);
      }
    }

    // El archivo documental no puede entrar al árbol ejecutable por ninguna vía.
    const prefijo = String(e?.filename ?? "").slice(0, 4);
    if (APPLIED_REMOTE_ARCHIVE.includes(prefijo)) {
      push("APPLIED_REMOTE_ARCHIVE_EN_CATALOGO", e?.filename);
    }

    // Semántica de rollback: el filename manda sobre el estado declarado.
    if (esRollbackPorNombre(e?.filename) && e?.estado !== "rollback") {
      push("ROLLBACK_RECLASIFICADO", `${id}: estado=${e?.estado}, el filename declara rollback`);
    }

    if (e?.estado === "superseded" && !e?.superseded_by) {
      push("SUPERSEDED_SIN_REEMPLAZO", id);
    }
  }

  // Ancla exacta: cada rollback conocido tiene que estar en el catálogo y con
  // estado `rollback`. Sin esto, un rename coordinado (catálogo + disco) hacia
  // un nombre que no matchee la convención lo sacaría de la política.
  for (const nombre of ROLLBACKS_CONOCIDOS) {
    const e = entries.find((x) => x?.filename === nombre);
    if (!e) {
      push("ROLLBACK_CONOCIDO_AUSENTE", nombre);
    } else if (e.estado !== "rollback") {
      push("ROLLBACK_CONOCIDO_RECLASIFICADO", `${nombre}: ${e.estado}`);
    }
  }

  // Contadores top-level: se RECALCULAN desde `entries`. El JSON no puede ser
  // fuente de verdad sobre sí mismo: un contador maquillado acompaña siempre a
  // una reclasificación coordinada.
  const ejecutablesReales = entries.filter((e) => EJECUTABLES.has(e?.estado)).length;
  const noEjecutablesReales = entries.filter(
    (e) => ESTADOS.has(e?.estado) && !EJECUTABLES.has(e.estado),
  ).length;
  if (catalogo?.ejecutables !== ejecutablesReales) {
    push(
      "CONTADOR_EJECUTABLES_INCOHERENTE",
      `declarado=${catalogo?.ejecutables}, recalculado=${ejecutablesReales}`,
    );
  }
  if (catalogo?.no_ejecutables !== noEjecutablesReales) {
    push(
      "CONTADOR_NO_EJECUTABLES_INCOHERENTE",
      `declarado=${catalogo?.no_ejecutables}, recalculado=${noEjecutablesReales}`,
    );
  }

  // Toda migración en disco tiene que estar catalogada: nada se ejecuta por
  // el solo hecho de existir en el directorio.
  for (const f of enDisco) {
    const mal = motivoFilenameInvalido(f);
    if (mal) push("FILENAME_INVALIDO_EN_ARBOL", `${f}: ${mal}`);
    if (!enCatalogo.has(f)) push("NO_CATALOGADA", f);
    const prefijo = f.slice(0, 4);
    if (APPLIED_REMOTE_ARCHIVE.includes(prefijo)) {
      push("APPLIED_REMOTE_ARCHIVE_EN_ARBOL", f);
    }
  }

  // Dependencias: existentes, ejecutables y ANTERIORES. Un `requires` que
  // apunta hacia adelante es exactamente el defecto 0061→0086.
  const porId = new Map(entries.map((e) => [e.id, e]));
  const posicion = new Map(entries.map((e, i) => [e.id, i]));
  for (const e of entries) {
    for (const req of e?.requires ?? []) {
      const dep = porId.get(req);
      if (!dep) { push("DEPENDENCIA_AUSENTE", `${e.id} → ${req}`); continue; }
      if (dep.orden >= e.orden) push("DEPENDENCIA_POSTERIOR", `${e.id} → ${req}`);
      // Y también en el ARRAY, que es lo que el replay recorre: una dependencia
      // que parece válida por `orden` pero está después en el array sería
      // ejecutada tarde.
      if ((posicion.get(req) ?? -1) >= (posicion.get(e.id) ?? 0)) {
        push("DEPENDENCIA_POSTERIOR_EN_ARRAY", `${e.id} → ${req}`);
      }
      if (!EJECUTABLES.has(dep.estado)) {
        push("DEPENDENCIA_NO_EJECUTABLE", `${e.id} → ${req} (${dep.estado})`);
      }
    }
  }

  // Ciclos: con `requires` estrictamente hacia atrás no puede haber, pero se
  // comprueba igual porque el catálogo se edita a mano.
  const visitando = new Set(), listo = new Set();
  const hayCiclo = (id, ruta = []) => {
    if (listo.has(id)) return false;
    if (visitando.has(id)) { push("CICLO", [...ruta, id].join(" → ")); return true; }
    visitando.add(id);
    for (const req of porId.get(id)?.requires ?? []) {
      if (porId.has(req) && hayCiclo(req, [...ruta, id])) return true;
    }
    visitando.delete(id); listo.add(id);
    return false;
  };
  for (const e of entries) hayCiclo(e.id);

  return v;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violaciones = verificarCatalogo();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(violaciones, null, 2));
  } else if (violaciones.length === 0) {
    const c = cargarCatalogo();
    // Conteos RECALCULADOS desde `entries`: la CLI no repite los del JSON.
    const ejec = c.entries.filter((e) => EJECUTABLES.has(e.estado)).length;
    console.log(
      `LINEAGE CATALOG OK · ${c.entries.length} entradas · ` +
        `${ejec} ejecutables · ${c.entries.length - ejec} no ejecutables · ` +
        `APPLIED_REMOTE_ARCHIVE fuera del árbol`,
    );
  } else {
    for (const x of violaciones) console.error(`  ${x.codigo}: ${x.detalle}`);
    console.error(`LINEAGE CATALOG FAIL · ${violaciones.length} violaciones`);
  }
  process.exit(violaciones.length === 0 ? 0 : 1);
}
