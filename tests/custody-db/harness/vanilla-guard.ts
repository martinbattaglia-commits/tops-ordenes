/**
 * GUARD DE INVARIANCIA DEL HARNESS VANILLA — lógica extraída y testeable.
 *
 * Vivía embebida en `t-c1-05` y por eso sus "mutantes" no podían ejercitarla:
 * comparaban literales entre sí. Acá la lógica queda aislada y con el ejecutor
 * de git INYECTADO, así que un mutante puede simular un clon superficial, una
 * rama con varios commits o un `origin/HEAD` ambiguo sin tocar el repositorio.
 *
 * Regla de oro: si la BASE de comparación no puede determinarse con certeza,
 * el guard NO adivina. Lanza.
 */

/** Ejecutor de git inyectable. Devuelve stdout; lanza si el comando falla. */
export type GitRunner = (args: string[]) => string;

export class BaseIndeterminadaError extends Error {
  constructor(intentos: string[]) {
    super(
      "no se pudo determinar la base de comparación de la rama. " +
        `Refs probados: ${intentos.join(", ")}. ` +
        "Definí WMS_VANILLA_BASE con un commit exacto si el checkout no alcanza main.",
    );
    this.name = "BaseIndeterminadaError";
  }
}

/** Refs candidatos, en orden de preferencia. `HEAD~1` NO es uno de ellos. */
export const REFS_BASE = ["origin/main", "main", "origin/HEAD"] as const;

const ES_SHA = /^[0-9a-f]{40}$/;

/**
 * Base de fusión con main.
 *
 * FAIL-CLOSED: sin un ref identificado explícitamente —o una base exacta
 * suministrada por el entorno autorizado— lanza. El fallback anterior a
 * `HEAD~1` hacía que, en un clon superficial o en una rama con más de un
 * commit propio, el guard comparara contra el conjunto equivocado EN SILENCIO.
 */
export function baseDeRama(
  git: GitRunner,
  env: Record<string, string | undefined> = process.env,
): string {
  const explicita = env.WMS_VANILLA_BASE?.trim();
  if (explicita) {
    // Una base suministrada por el entorno tiene que existir y ser un commit.
    let resuelta: string;
    try {
      resuelta = git(["rev-parse", `${explicita}^{commit}`]).trim();
    } catch {
      throw new BaseIndeterminadaError([`WMS_VANILLA_BASE=${explicita} (no resuelve)`]);
    }
    if (!ES_SHA.test(resuelta)) {
      throw new BaseIndeterminadaError([`WMS_VANILLA_BASE=${explicita} (no es un commit)`]);
    }
    return resuelta;
  }

  const intentos: string[] = [];
  let mergeHead: string | null = null;
  try {
    const resuelta = git(["rev-parse", "--verify", "MERGE_HEAD^{commit}"]).trim();
    if (ES_SHA.test(resuelta)) mergeHead = resuelta;
  } catch {
    // No hay merge en curso: se aplica la resolución ordinaria por merge-base.
  }

  // Durante un merge controlado todavía no existe el commit de dos padres.
  // La base correcta es MERGE_HEAD sólo si coincide exactamente con un ref
  // nombrado de main; aceptar un MERGE_HEAD huérfano permitiría inyectar una
  // base arbitraria y volvería el guard fail-open.
  if (mergeHead) {
    for (const ref of REFS_BASE) {
      try {
        if (ref === "origin/HEAD") {
          const destino = git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).trim();
          if (!destino) { intentos.push(`${ref} (ambiguo o ausente)`); continue; }
        }
        const nombrada = git(["rev-parse", `${ref}^{commit}`]).trim();
        if (nombrada === mergeHead) return mergeHead;
        intentos.push(`${ref} (no coincide con MERGE_HEAD)`);
      } catch {
        intentos.push(`${ref} (no existe durante merge)`);
      }
    }
    throw new BaseIndeterminadaError(intentos);
  }

  for (const ref of REFS_BASE) {
    try {
      // `origin/HEAD` sólo vale si resuelve a UNA rama sin ambigüedad.
      if (ref === "origin/HEAD") {
        const destino = git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).trim();
        if (!destino) { intentos.push(`${ref} (ambiguo o ausente)`); continue; }
      }
      const base = git(["merge-base", "HEAD", ref]).trim();
      if (ES_SHA.test(base)) return base;
      intentos.push(`${ref} (merge-base no es un sha)`);
    } catch {
      intentos.push(`${ref} (no existe)`);
    }
  }
  throw new BaseIndeterminadaError(intentos);
}

/**
 * Todo lo que este trabajo tocó bajo `ruta`, esté commiteado o no.
 *
 * La unión de «lo que la rama cambió respecto de su base» y «lo pendiente» da
 * el MISMO resultado en el worktree local, en un checkout limpio y en el
 * checkout sintético de un PR.
 */
export function cambiosDeLaRama(git: GitRunner, base: string, ruta: string): string[] {
  let mergeContraBase = false;
  try {
    mergeContraBase = git(["rev-parse", "--verify", "MERGE_HEAD^{commit}"]).trim() === base;
  } catch {
    // No hay merge en curso.
  }

  if (mergeContraBase) {
    // El índice contiene el árbol candidato completo del merge. Compararlo
    // contra MERGE_HEAD excluye los cambios ya integrados en main y conserva
    // únicamente el delta de esta rama más sus resoluciones explícitas.
    const staged = git(["diff", "--cached", "--name-only", base, "--", ruta])
      .split("\n").map((l) => l.trim()).filter(Boolean);
    const unstaged = git(["diff", "--name-only", "--", ruta])
      .split("\n").map((l) => l.trim()).filter(Boolean);
    const untracked = git(["ls-files", "--others", "--exclude-standard", "--", ruta])
      .split("\n").map((l) => l.trim()).filter(Boolean);
    return [...new Set([...staged, ...unstaged, ...untracked])].sort();
  }

  const commiteado = git(["diff", "--name-only", `${base}..HEAD`, "--", ruta])
    .split("\n").map((l) => l.trim()).filter(Boolean);
  const pendiente = git(["status", "--porcelain", "--", ruta])
    .split("\n").map((l) => l.trim().split(/\s+/).pop() ?? "").filter(Boolean);
  return [...new Set([...commiteado, ...pendiente])].sort();
}

export interface Violacion { codigo: string; detalle: string }

/** Invariancia acotada: sólo los archivos autorizados pueden haber cambiado. */
export function evaluarInvarianciaVanilla(
  cambios: readonly string[],
  autorizados: readonly string[],
): Violacion[] {
  const permitidos = new Set(autorizados);
  return cambios
    .filter((f) => !permitidos.has(f))
    .map((f) => ({ codigo: "VANILLA_NO_AUTORIZADO", detalle: f }));
}

/** `EXPECTED_MANIFEST_SIZE` del fuente del manifiesto vanilla. */
export function tamanoManifiesto(fuente: string): number {
  const m = /EXPECTED_MANIFEST_SIZE\s*=\s*(\d+)/.exec(fuente);
  return m ? Number(m[1]) : Number.NaN;
}

/** Falla si el tamaño no es exactamente el esperado. */
export function evaluarTamanoManifiesto(fuente: string, esperado = 31): Violacion[] {
  const n = tamanoManifiesto(fuente);
  if (!Number.isInteger(n)) {
    return [{ codigo: "MANIFEST_SIZE_ILEGIBLE", detalle: String(n) }];
  }
  if (n !== esperado) {
    return [{ codigo: "MANIFEST_SIZE_ALTERADO", detalle: `${n} ≠ ${esperado}` }];
  }
  return [];
}

/** Rango preservado como evidencia documental. NUNCA ejecutable. */
export const ARCHIVE_PREFIJOS: readonly string[] = Array.from({ length: 14 }, (_, i) =>
  String(205 + i).padStart(4, "0"),
);

/**
 * Detecta el reingreso de 0205–0218 por CUALQUIER vía: el árbol de migraciones
 * o el texto de un manifiesto.
 */
export function detectarArchiveReingresado(
  archivosEnArbol: readonly string[],
  fuentesDeManifiesto: readonly { nombre: string; fuente: string }[] = [],
): Violacion[] {
  const v: Violacion[] = [];
  for (const f of archivosEnArbol) {
    if (ARCHIVE_PREFIJOS.includes(f.slice(0, 4))) {
      v.push({ codigo: "ARCHIVE_EN_ARBOL", detalle: f });
    }
  }
  for (const { nombre, fuente } of fuentesDeManifiesto) {
    for (const p of ARCHIVE_PREFIJOS) {
      if (fuente.includes(`"${p}_`)) {
        v.push({ codigo: "ARCHIVE_EN_MANIFIESTO", detalle: `${nombre}: ${p}` });
      }
    }
  }
  return v;
}

/**
 * RUTAS PROPIAS DE ESTE EXPEDIENTE.
 *
 * El harness de Custodia se dispara en toda PR que toque
 * `supabase/migrations/**`, así que sus invariantes se ejecutan también sobre
 * candidatos de OTROS frentes. Varias de esas afirmaciones son promesas de
 * Custodia —qué rutas no toca, qué archivo del harness vanilla cambia, qué
 * líneas de `package.json` autoriza, qué migraciones 0250* hay en disco—, y
 * aplicadas a un frente ajeno lo bloquean por algo que nunca prometió.
 *
 * El acotamiento se hace por el DIFF bajo revisión y NO por el nombre de la
 * rama: `rev-parse --abbrev-ref HEAD` devuelve la cadena "HEAD" cuando el
 * checkout está detached, que es exactamente lo que hace `actions/checkout` en
 * un `pull_request`. Acotar por nombre dejaba el gate inerte justo donde único
 * se aplica solo.
 *
 * Tocar `supabase/migrations/**` NO alcanza para entrar en alcance: ése es el
 * disparador del workflow, no la marca del expediente. La marca es el lease
 * 0250 y los directorios propios.
 */
const RUTAS_CUSTODIA: readonly RegExp[] = [
  /^supabase\/migrations\/(?:ROLLBACK_)?0250[a-z]?_/,
  /^tests\/custody-db\//,
  /^src\/lib\/custody\//,
];

/**
 * ─── LAS ANCLAS DE GOBERNANZA COMPARTIDAS · EXCLUIDAS POR ARCHIVO ──────────
 *
 * 1. `t-c4-01-lineage-catalog.test.ts` es el ANCLA DE LINAJE DE TODO EL REPOSITORIO.
 * 2. `t-c1-05-append-only-vanilla.test.ts` es el ANCLA DE MIGRACIONES HISTÓRICAS
 *    Y `MIGRACIONES_EDITABLES` DE TODO EL REPOSITORIO.
 *
 * Ambos archivos son compuertas transversales que cualquier frente autorizado
 * (ej. remediación in-place de migraciones no aplicadas o registro de nuevos rollbacks)
 * debe actualizar en su propio PR sin que el guardián lo clasifique falsamente
 * como perteneciente al dominio Custodia.
 *
 * LA EXCLUSIÓN ES POR ARCHIVO EXACTO, NUNCA POR CARPETA.
 *
 * REGLA FAIL-CLOSED: `vanilla-guard.ts` y `t-c5-03-guard-scoping.test.ts` NUNCA
 * se excluyen; son el motor y la prueba del guard, y su modificación activa
 * incondicionalmente el alcance de Custodia.
 */
const RUTAS_CUSTODIA_EXCLUIDAS: readonly string[] = [
  "tests/custody-db/t-c4-01-lineage-catalog.test.ts",
  "tests/custody-db/t-c1-05-append-only-vanilla.test.ts",
];

/**
 * Las rutas del diff que pertenecen a Custodia, en el orden en que llegaron.
 * Vacío ⇒ lo que se está revisando no es de este expediente y sus promesas no
 * son exigibles. Función PURA: no consulta git, entorno ni disco.
 */
export function rutasPropiasDeCustodia(cambios: readonly string[]): string[] {
  return cambios.filter(
    (p) => !RUTAS_CUSTODIA_EXCLUIDAS.includes(p) && RUTAS_CUSTODIA.some((re) => re.test(p)),
  );
}
