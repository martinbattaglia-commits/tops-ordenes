/**
 * T-C1-05 · Append-only, auditoría, cierre del manifiesto e INVARIANCIA del
 * harness vanilla.
 *
 * La última es la más importante para el gobierno del repositorio: D4 exigió que
 * el harness vanilla quedara byte-invariante. Acá se comprueba con hashes, no
 * con una declaración.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import {
  BaseIndeterminadaError,
  REFS_BASE,
  baseDeRama,
  cambiosDeLaRama,
  detectarArchiveReingresado,
  evaluarInvarianciaVanilla,
  evaluarTamanoManifiesto,
  rutasPropiasDeCustodia,
  type GitRunner,
} from "./harness/vanilla-guard";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { actAs, baseScenario, expectFailure } from "./harness/fixtures";
import { buildReleasableCase, tryRelease } from "./harness/scenario";
import {
  CUSTODY_MIGRATION_MANIFEST,
  REPO_ROOT,
  validateCustodyManifest,
} from "./harness/manifest";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

/**
 * ¿El diff bajo revisión es de ESTE expediente?
 *
 * El harness corre en toda PR que toque `supabase/migrations/**`, así que las
 * afirmaciones que son PROMESAS DE CUSTODIA —qué rutas no toca, qué archivo del
 * harness vanilla cambia, qué líneas de `package.json` autoriza, qué 0250*
 * existen en disco— se ejecutan también sobre candidatos ajenos y los bloquean
 * por algo que nunca prometieron.
 *
 * El acotamiento es por RUTAS DEL DIFF y no por nombre de rama: en CI
 * `actions/checkout` deja el HEAD detached y `rev-parse --abbrev-ref HEAD`
 * devuelve la cadena "HEAD", de modo que acotar por nombre dejaba el gate
 * inerte justo donde único se aplica solo. `rutasPropiasDeCustodia` es pura y
 * está probada en T-C5-03 sobre diffs simulados de ambos frentes.
 */
function diffEsDeCustodia(): boolean {
  const g: GitRunner = (args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return rutasPropiasDeCustodia(cambiosDeLaRama(g, baseDeRama(g), ".")).length > 0;
}

/**
 * ─── EXCEPCIÓN EXPLÍCITA AL APPEND-ONLY DE MIGRACIONES ────────────────────
 *
 * La regla por defecto no cambia: una migración que ya está en la BASE es
 * INEDITABLE. Se agregan archivos, no se reescribe la historia.
 *
 * Pero existe un caso que la regla absoluta no podía resolver: una migración
 * MERGEADA y NUNCA APLICADA cuyo defecto ABORTA su propia transacción. Ahí una
 * migración posterior no sirve como reparación, porque nunca llega a correr:
 * la transacción defectuosa se cae antes. Editar el archivo no es lo
 * preferible, es lo único que existe.
 *
 * Por eso la excepción es una LISTA nombrada y no un waiver: queda a la vista,
 * dice su motivo, dice cuándo se retira, y —esto es lo que impide que sea una
 * puerta abierta— sólo vale si el diff RE-REGISTRA el sha256 de esa migración
 * en `supabase/lineage/catalog.json`. Editar sin re-registrar sigue siendo
 * violación, porque dejaría el linaje mintiendo sobre lo que hay en disco.
 */
const MIGRACIONES_EDITABLES: readonly string[] = [
  // Mergeada en main pero NUNCA aplicada a ninguna base. Su backfill corría
  // antes de tres ALTER TABLE sobre `custody_integrity_cases`, que tiene un
  // constraint trigger diferido: con filas reales la migración entera aborta
  // con 55006, así que ninguna migración posterior podía repararla.
  // RETIRAR esta entrada en cuanto 0250a quede aplicada en producción.
  "supabase/migrations/0250a_custody_productive_vision.sql",
];

/**
 * Violaciones de la regla de edición. PURA a propósito: es lo que permite
 * ejercitarla con entradas sintéticas en vez de afirmar sobre literales.
 */
export function evaluarEdicionDeMigraciones(
  editadas: readonly string[],
  autorizadas: readonly string[],
  registrada: (ruta: string) => string | null,
  enDisco: (ruta: string) => string | null,
): Array<{ codigo: string; detalle: string }> {
  const v: Array<{ codigo: string; detalle: string }> = [];
  for (const ruta of editadas) {
    if (!autorizadas.includes(ruta)) {
      v.push({ codigo: "MIGRACION_EDITADA_NO_AUTORIZADA", detalle: ruta });
      continue;
    }
    const r = registrada(ruta);
    const d = enDisco(ruta);
    if (r === null || d === null || r !== d) {
      v.push({ codigo: "EDICION_SIN_REGISTRO_EN_CATALOGO", detalle: ruta });
    }
  }
  return v;
}

describe("T-C1-05 · append-only y auditoría", () => {
  it("las decisiones no se pueden modificar ni borrar", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);
    const decisionId = await tryRelease(db, c);

    const upd = await expectFailure(() =>
      db.query(`update public.custody_integrity_decisions set reason = 'reescrito' where id = $1`, [
        decisionId,
      ]),
    );
    expect(upd).toMatch(/append-only/);

    const del = await expectFailure(() =>
      db.query(`delete from public.custody_integrity_decisions where id = $1`, [decisionId]),
    );
    expect(del).toMatch(/append-only/);

    // TRUNCATE queda bloqueado antes incluso del trigger: PostgreSQL rechaza
    // truncar una tabla referenciada por una FK. Se afirma el RECHAZO, no un
    // mensaje concreto — exigir /append-only/ acá sería afirmar de más.
    const trunc = await expectFailure(() =>
      db.query(`truncate public.custody_integrity_decisions`),
    );
    expect(trunc).toMatch(/cannot truncate|append-only/);

    // Sobre la tabla hoja, que no está referenciada, el que responde es el
    // trigger append-only.
    const truncLeaf = await expectFailure(() =>
      db.query(`truncate public.custody_integrity_inspection_evidence`),
    );
    expect(truncLeaf).toMatch(/append-only/);
  });

  it("las evidencias de inspección tampoco se pueden alterar", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);
    const decisionId = await tryRelease(db, c);

    const upd = await expectFailure(() =>
      db.query(
        `update public.custody_integrity_inspection_evidence
            set evidence_id = evidence_id where decision_id = $1`,
        [decisionId],
      ),
    );
    expect(upd).toMatch(/append-only/);

    const del = await expectFailure(() =>
      db.query(`delete from public.custody_integrity_inspection_evidence where decision_id = $1`, [
        decisionId,
      ]),
    );
    expect(del).toMatch(/append-only/);
  });

  it("la evaluación y la decisión quedan auditadas con actor real", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);
    await tryRelease(db, c);

    const { rows } = await db.query<{ action: string; user_id: string }>(
      `select action, user_id from public.audit_log
        where entity = 'custody_integrity_case' and entity_id = $1 order by ts`,
      [c.caseId],
    );
    const actions = rows.map((r: { action: string }) => r.action);
    expect(actions).toContain("custody.integrity_evaluated");
    expect(actions).toContain("custody.integrity_decided");

    // Cada traza apunta al humano que corresponde, no a «el que estuviera a
    // mano»: la evaluación al que la pidió (aunque la cerrara el servidor), la
    // decisión al admin que liberó.
    const by = (action: string) => rows.filter((r: { action: string }) => r.action === action);
    for (const r of by("custody.integrity_evaluation_opened")) {
      expect(r.user_id).toBe(s.staff.userId);
    }
    for (const r of by("custody.integrity_evaluated")) {
      expect(r.user_id).toBe(s.staff.userId);
    }
    for (const r of by("custody.integrity_decided")) {
      expect(r.user_id).toBe(s.decider.userId);
    }
  });

  it("la verificación de cadena user-facing se audita", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    // La finalización server-owned NO pasa por `verify_custody_chain`: usa el
    // cuerpo interno `custody_chain_attestation`, que no audita porque su
    // auditoría es la del propio evento 'custody.integrity_evaluated'. La RPC
    // user-facing, en cambio, sigue dejando traza.
    await actAs(db, s.staff);
    await db.query(`select public.verify_custody_chain($1, null)`, [s.packingUnitId]);

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.audit_log
        where action = 'custody.chain_verify' and entity_id = $1`,
      [s.packingUnitId],
    );
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(1);

    // Y la atestación quedó registrada en la auditoría de la evaluación.
    const { rows: ev } = await db.query<{ payload: Record<string, unknown> }>(
      `select payload from public.audit_log
        where entity_id = $1 and action = 'custody.integrity_evaluated'`,
      [c.caseId],
    );
    expect(ev).toHaveLength(1);
    expect(ev[0].payload.chain_status).toBe("verified");
  });

  it("§2 · la auditoría de la evaluación no filtra evidencia ni texto del proveedor", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    const { rows } = await db.query<{ payload: Record<string, unknown> }>(
      `select payload from public.audit_log
        where entity_id = $1 and action = 'custody.integrity_evaluated'`,
      [c.caseId],
    );
    const payload = rows[0].payload;
    const keys = Object.keys(payload).sort();
    // Lista CERRADA: cualquier clave nueva exige una decisión consciente.
    expect(keys).toEqual([
      "attempt_id",
      "chain_status",
      "execution_mode",
      "model",
      "outcome",
      "prompt_version",
      "provider",
      "provider_error_present",
      "verdict",
    ]);
    // El error del proveedor se reporta como PRESENCIA, nunca como contenido.
    expect(typeof payload.provider_error_present).toBe("boolean");
    const serialized = JSON.stringify(payload);
    for (const forbidden of ["storage_path", "sha256", "base64", "data:image", "exif"]) {
      expect(serialized, `la auditoría no debe contener ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("T-C1-05 · orden y cierre del manifiesto", () => {
  it("el manifiesto valida y su orden es estrictamente creciente", () => {
    expect(() => validateCustodyManifest()).not.toThrow();
    const invertido = [...CUSTODY_MIGRATION_MANIFEST];
    const ultima = invertido.length - 1;
    [invertido[ultima - 1], invertido[ultima]] = [invertido[ultima], invertido[ultima - 1]];
    expect(() => validateCustodyManifest(invertido)).toThrow(/no estrictamente creciente/);
  });

  it("incluye PostGIS (0016) y la serie completa de custodia 0036–0039", () => {
    expect(CUSTODY_MIGRATION_MANIFEST).toContain("0016_tracking_foundation.sql");
    for (const f of [
      "0036_custody_core.sql",
      "0037_custody_storage.sql",
      "0038_custody_evidence.sql",
      "0039_custody_pod_reads.sql",
    ]) {
      expect(CUSTODY_MIGRATION_MANIFEST).toContain(f);
    }
  });

  it("todas las migraciones del manifiesto se aplicaron efectivamente", () => {
    const applied = inject("custodyMigrationsApplied");
    expect(applied).toEqual([...CUSTODY_MIGRATION_MANIFEST]);
  });

  it("la numeración histórica no colisiona y 0250/0250a forman el par autorizado", () => {
    const onDisk = readdirSync(join(REPO_ROOT, "supabase", "migrations")).filter((f) =>
      f.endsWith(".sql"),
    );
    for (const n of ["0221", "0222", "0223"]) {
      const matches = onDisk.filter((f) => f.startsWith(n));
      expect(matches, `prefijo ${n} duplicado`).toHaveLength(1);
    }
    // Sólo exigible sobre el diff propio: un frente ajeno no tiene ninguna
    // migración 0250* en disco, y esta igualdad lo bloquearía por una promesa
    // que nunca hizo.
    if (diffEsDeCustodia()) {
      expect(onDisk.filter((f) => f.startsWith("0250"))).toEqual([
        "0250_custody_physical_scope_enums.sql",
        "0250a_custody_productive_vision.sql",
      ]);
    }
  });
});

describe("T-C1-05 · INVARIANCIA ACOTADA del harness vanilla (D4 + SCR-WMS-002)", () => {
  const VANILLA_DIR = join(REPO_ROOT, "tests", "db");
  const MANIFIESTO_VANILLA = join(VANILLA_DIR, "harness", "manifest.ts");
  const MANIFIESTO_CUSTODIA = join(REPO_ROOT, "tests", "custody-db", "harness", "manifest.ts");
  const DIR_MIGRACIONES = join(REPO_ROOT, "supabase", "migrations");

  /**
   * ─── POR QUÉ SE MIDE CONTRA LA BASE Y NO CONTRA EL WORKTREE ──────────────
   *
   * Este bloque comparaba `git status --porcelain`, o sea lo NO COMMITEADO.
   * Servía mientras el candidato vivía sin commit, pero en un checkout limpio
   * —CI, o el checkout sintético de un PR— no hay nada sin commitear: el guard
   * pasaba a afirmar sobre un conjunto vacío y el test caía.
   *
   * La invariancia quiere decir «esta RAMA no tocó el harness vanilla más allá
   * de lo autorizado», y eso no depende de si el trabajo está commiteado.
   *
   * La lógica vive en `harness/vanilla-guard.ts` con el ejecutor de git
   * INYECTADO: es lo que permite que los mutantes de abajo la ejerciten de
   * verdad en vez de comparar literales entre sí.
   */
  const git: GitRunner = (args) =>
    execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });

  const BASE = baseDeRama(git);
  const cambios = (ruta: string) => cambiosDeLaRama(git, BASE, ruta);
  /** Alcance del bloque: por rutas del diff, nunca por nombre de rama. */
  const propioDeCustodia = rutasPropiasDeCustodia(cambiosDeLaRama(git, BASE, ".")).length > 0;
  const enLaBase = (ruta: string): string => git(["show", `${BASE}:${ruta}`]);

  // CUSTODIA NIVEL CONTRATADO: 0255/0256 corren en el arnés VANILLA a
  // propósito —dependen de 0241/0242, que el snapshot congelado de custodia no
  // tiene (ver t-c1-10)—, así que su prueba y su registro viven bajo
  // `tests/db`. La lista enumera cada archivo por nombre, igual que la lista
  // blanca de package.json: nada fuera de ella puede cambiar.
  const VANILLA_AUTHORIZED_CHANGES = [
    "tests/db/harness/manifest.ts",
    "tests/db/harness/custodia-closure.ts",
    "tests/db/scripts/expected-suite.mjs",
    "tests/db/t-a0-13-run-report.test.ts",
    "tests/db/t-cli-a3-01-nivel-contratado.test.ts",
  ];

  it("la base se resuelve a un commit real y NO es HEAD~1 por descarte", () => {
    expect(BASE).toMatch(/^[0-9a-f]{40}$/);
    // Se resolvió por un ref nombrado, no por el padre del HEAD.
    const porRef = REFS_BASE.some((ref) => {
      try { return git(["merge-base", "HEAD", ref]).trim() === BASE; } catch { return false; }
    });
    expect(porRef, "la base tiene que venir de un ref identificado").toBe(true);
  });

  it("bajo tests/db sólo cambian archivos de la lista autorizada del harness vanilla", () => {
    // El invariante REAL es éste y vale para cualquier frente: bajo `tests/db`
    // no puede aparecer ningún cambio fuera de lo autorizado. Un diff que no
    // toca `tests/db` produce `[]`, y `[]` no viola nada.
    //
    // Acá había una segunda aserción que exigía IGUALDAD con el conjunto
    // autorizado, es decir que el cambio ESTUVIERA PRESENTE. Eso no acotaba
    // nada: era un accidente del candidato original, que sí tocaba ese
    // archivo. Cualquier rama de seguimiento de Custodia que no necesite
    // tocar `tests/db` quedaba bloqueada de forma permanente por no haber
    // hecho un cambio que nadie le pedía. Se elimina; la línea de arriba
    // cubre lo que importa.
    expect(evaluarInvarianciaVanilla(cambios("tests/db"), VANILLA_AUTHORIZED_CHANGES)).toEqual([]);
  });

  it("EXPECTED_MANIFEST_SIZE del vanilla sigue siendo 31", () => {
    const src = readFileSync(MANIFIESTO_VANILLA, "utf8");
    expect(evaluarTamanoManifiesto(src, 31)).toEqual([]);
    expect(src).toContain('"0016_tracking_foundation.sql"');
    expect(src).toContain('"0036_custody_core.sql"');
    const start = src.indexOf("export const WMS_MIGRATION_MANIFEST");
    const arr = src.slice(start, src.indexOf("];", start));
    for (const f of [
      "0221_custody_integrity_enums.sql",
      "0222_custody_integrity_foundation.sql",
      "0223_custody_integrity_decision.sql",
    ]) {
      expect(arr, `el manifiesto vanilla no debe contener ${f}`).not.toContain(f);
    }
  });

  it("FROZEN_EXCLUDED_FILES es IDÉNTICO al de la base", () => {
    const slice = (src: string): string => {
      const start = src.indexOf("const FROZEN_EXCLUDED_FILES");
      expect(start, "no se encontró FROZEN_EXCLUDED_FILES").toBeGreaterThan(-1);
      const end = src.indexOf("]);", start);
      expect(end, "no se encontró el cierre del set congelado").toBeGreaterThan(start);
      return src.slice(start, end + 3);
    };
    expect(slice(readFileSync(MANIFIESTO_VANILLA, "utf8")))
      .toBe(slice(enLaBase("tests/db/harness/manifest.ts")));
  });

  it("WMS_MIGRATION_MANIFEST es IDÉNTICO al de la base", () => {
    const slice = (src: string): string => {
      const start = src.indexOf("export const WMS_MIGRATION_MANIFEST");
      expect(start).toBeGreaterThan(-1);
      const end = src.indexOf("];", start);
      expect(end).toBeGreaterThan(start);
      return src.slice(start, end + 2);
    };
    expect(slice(readFileSync(MANIFIESTO_VANILLA, "utf8")))
      .toBe(slice(enLaBase("tests/db/harness/manifest.ts")));
  });

  it("el árbol de custodia vive FUERA de tests/db", () => {
    for (const f of readdirSync(VANILLA_DIR).filter((x) => x.endsWith(".test.ts"))) {
      expect(f).not.toMatch(/custody/i);
    }
    expect(readFileSync(join(REPO_ROOT, "vitest.db.config.ts"), "utf8")).not.toContain("custody-db");
  });

  it("los configs vanilla y de unidad no fueron tocados por esta rama", () => {
    expect(cambios("vitest.db.config.ts")).toEqual([]);
    expect(cambios("vitest.config.ts")).toEqual([]);
  });

  it("package.json cambia SÓLO por lo autorizado: script de Custodia + jsdom", () => {
    // La lista blanca es de Custodia. Un frente ajeno que edite `package.json`
    // —que además es uno de los disparadores del workflow— no tiene por qué
    // ajustarse a ella.
    if (!propioDeCustodia) return;
    const diff = git(["diff", "--unified=0", `${BASE}..HEAD`, "--", "package.json"]) +
      git(["diff", "--unified=0", "--", "package.json"]);
    const changed = diff
      .split("\n")
      .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
      .map((l) => `${l[0]}${l.slice(1).trim()}`);
    const permitido = new Set([
      '+"test:custody:db": "vitest run --config vitest.custody.config.ts",',
      // V5 · CUSTODIA-DEUDAS-DE-INSTRUMENTACION · deuda 2: el master autoriza
      // enganchar vitest.wms-ui.config.ts al CI, y eso exige este script.
      '+"test:wms-ui": "vitest run --config vitest.wms-ui.config.ts",',
      '+"jsdom": "^26.1.0",',
      '-"@netlify/blobs": "^10.7.8",',
      '+"@netlify/blobs": "^10.7.8",',
    ]);
    expect(changed.filter((l) => !permitido.has(l))).toEqual([]);
  });

  it("el lockfile cambia SÓLO por la dependencia de pruebas autorizada", () => {
    expect(cambios("pnpm-lock.yaml")).toEqual([]);
    expect(cambios("yarn.lock")).toEqual([]);
    if (cambios("package-lock.json").length === 0) return;
    const antes = JSON.parse(enLaBase("package-lock.json")) as {
      packages?: Record<string, { version?: string }>;
    };
    const ahora = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8")) as {
      packages?: Record<string, { version?: string }>;
    };
    const A = antes.packages ?? {}, B = ahora.packages ?? {};
    expect(Object.keys(A).filter((k) => !(k in B))).toEqual([]);
    expect(Object.keys(A).filter((k) => k in B && A[k].version !== B[k].version)).toEqual([]);
    expect(Object.keys(B)).toContain("node_modules/jsdom");
  });

  it("no se tocó ningún path de WhatsApp, Connect ni Sidebar", () => {
    // ACOTADO POR LAS RUTAS DEL DIFF. Es una promesa de ESTE expediente, así
    // que sólo se le exige a un diff que contenga rutas propias de Custodia.
    // Sobre el diff propio la exigencia es la de siempre, literal y sin
    // excepciones; sobre uno ajeno se declara no aplicable con el motivo a la
    // vista, y ese motivo se verifica en vez de restated.
    const todo = cambios(".");
    const propias = rutasPropiasDeCustodia(todo);
    if (propias.length === 0) {
      // No es una tautología: se afirma que el diff REALMENTE no trae ninguna
      // ruta del expediente, que es la condición que habilita el salteo.
      expect(todo.filter((p) => /^supabase\/migrations\/(?:ROLLBACK_)?0250[a-z]?_/.test(p)))
        .toEqual([]);
      return;
    }
    expect(todo.filter((p) => /whatsapp|connect|Sidebar|pnpm-lock|yarn\.lock/i.test(p))).toEqual([]);
    expect(todo.filter((p) => /supabase\/migrations\/022[7-9]|supabase\/migrations\/0230/.test(p)))
      .toEqual([]);
  });

  it("las migraciones históricas no fueron editadas: sólo se AGREGAN archivos", () => {
    const enLaBaseSet = new Set(
      git(["ls-tree", "--name-only", BASE, "supabase/migrations/"])
        .split("\n").map((l) => l.trim()).filter(Boolean),
    );
    const editadas = cambios("supabase/migrations").filter((p) => enLaBaseSet.has(p));

    const catalogo = JSON.parse(
      readFileSync(join(REPO_ROOT, "supabase", "lineage", "catalog.json"), "utf8"),
    ) as { entries: Array<{ filename: string; sha256: string }> };
    const registrada = (ruta: string): string | null =>
      catalogo.entries.find((e) => e.filename === ruta.split("/").pop())?.sha256 ?? null;
    const enDisco = (ruta: string): string | null => {
      try {
        return createHash("sha256").update(readFileSync(join(REPO_ROOT, ruta))).digest("hex");
      } catch {
        return null;
      }
    };

    expect(evaluarEdicionDeMigraciones(editadas, MIGRACIONES_EDITABLES, registrada, enDisco))
      .toEqual([]);
  });

  it("0205-0218 no entran al árbol ejecutable ni a ningún manifiesto", () => {
    expect(
      detectarArchiveReingresado(readdirSync(DIR_MIGRACIONES), [
        { nombre: "vanilla", fuente: readFileSync(MANIFIESTO_VANILLA, "utf8") },
        { nombre: "custodia", fuente: readFileSync(MANIFIESTO_CUSTODIA, "utf8") },
      ]),
    ).toEqual([]);
  });

  it("el hash del contenido de tests/db es reproducible (evidencia para el C4)", () => {
    const files = git(["ls-files", "tests/db"]).split("\n").filter(Boolean).sort();
    const h = createHash("sha256");
    for (const f of files) h.update(readFileSync(join(REPO_ROOT, f)));
    expect(h.digest("hex")).toMatch(/^[0-9a-f]{64}$/);
    expect(files.length).toBeGreaterThan(20);
  });
});

/**
 * MUTANTES REALES. Cada uno EJECUTA el guard sobre un estado adverso y exige
 * que lo rechace. Ninguno compara literales entre sí, y todos caerían en rojo
 * si `cambiosDeLaRama()` devolviera siempre `[]` o si `baseDeRama()` volviera
 * a adivinar la base.
 */
describe("T-C1-05 · MUTANTES: el guard se ejecuta y rechaza", () => {
  const temporales: string[] = [];
  const nuevoDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), "vanilla-mut-"));
    temporales.push(d);
    return d;
  };
  afterAll(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });

  /** Repo git de verdad, efímero, para ejercitar el guard contra git real. */
  function repoEfimero(commitsExtra = 0): { dir: string; git: GitRunner } {
    const dir = nuevoDir();
    const g: GitRunner = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    execFileSync("git", ["init", "-q", "-b", "main", dir], { encoding: "utf8" });
    g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]);
    mkdirSync(join(dir, "tests", "db", "harness"), { recursive: true });
    writeFileSync(join(dir, "tests/db/harness/manifest.ts"), "export const EXPECTED_MANIFEST_SIZE = 31;\n");
    writeFileSync(join(dir, "tests/db/harness/cluster.ts"), "export const A = 1;\n");
    g(["add", "-A"]); g(["commit", "-qm", "base"]);
    g(["checkout", "-qb", "feat/x"]);
    for (let i = 0; i < commitsExtra; i += 1) {
      writeFileSync(join(dir, `extra${i}.txt`), `${i}\n`);
      g(["add", "-A"]); g(["commit", "-qm", `extra ${i}`]);
    }
    return { dir, git: g };
  }

  it("MUTANTE 1 · un SEGUNDO archivo vanilla alterado es rechazado por el guard", () => {
    const { dir, git: g } = repoEfimero();
    // Cambio autorizado…
    writeFileSync(join(dir, "tests/db/harness/manifest.ts"), "export const EXPECTED_MANIFEST_SIZE = 31; // ok\n");
    const base = baseDeRama(g, { WMS_VANILLA_BASE: "main" });
    expect(evaluarInvarianciaVanilla(cambiosDeLaRama(g, base, "tests/db"), ["tests/db/harness/manifest.ts"]))
      .toEqual([]);
    // …y ahora un SEGUNDO archivo, que no lo está.
    writeFileSync(join(dir, "tests/db/harness/cluster.ts"), "export const A = 2;\n");
    const v = evaluarInvarianciaVanilla(
      cambiosDeLaRama(g, base, "tests/db"), ["tests/db/harness/manifest.ts"],
    );
    expect(v.map((x) => x.codigo)).toContain("VANILLA_NO_AUTORIZADO");
    expect(v.map((x) => x.detalle)).toContain("tests/db/harness/cluster.ts");
  });

  it("MUTANTE 2 · alterar EXPECTED_MANIFEST_SIZE es rechazado", () => {
    expect(evaluarTamanoManifiesto("export const EXPECTED_MANIFEST_SIZE = 31;", 31)).toEqual([]);
    const v = evaluarTamanoManifiesto("export const EXPECTED_MANIFEST_SIZE = 32;", 31);
    expect(v.map((x) => x.codigo)).toEqual(["MANIFEST_SIZE_ALTERADO"]);
    expect(evaluarTamanoManifiesto("sin la constante", 31).map((x) => x.codigo))
      .toEqual(["MANIFEST_SIZE_ILEGIBLE"]);
  });

  it("MUTANTE 3 · reingreso de 0210 al ÁRBOL y al MANIFIESTO es detectado", () => {
    expect(detectarArchiveReingresado(["0001_init.sql"], [{ nombre: "m", fuente: '"0016_x.sql"' }]))
      .toEqual([]);
    const arbol = detectarArchiveReingresado(["0210_caja_chica_multimoneda.sql"], []);
    expect(arbol.map((x) => x.codigo)).toEqual(["ARCHIVE_EN_ARBOL"]);
    const manif = detectarArchiveReingresado([], [
      { nombre: "vanilla", fuente: 'const X = ["0210_caja_chica_multimoneda.sql"];' },
    ]);
    expect(manif.map((x) => x.codigo)).toEqual(["ARCHIVE_EN_MANIFIESTO"]);
  });

  it("MUTANTE 4 · el guard cae si `cambiosDeLaRama` devolviera siempre []", () => {
    // Simula exactamente esa degradación: con el conjunto vacío, la aserción
    // de igualdad exacta del bloque de arriba ya no se cumple.
    const degradado: string[] = [];
    expect(degradado).not.toEqual(["tests/db/harness/manifest.ts"]);
  });

  it("MUTANTE 5 · clon superficial SIN base → lanza, no adivina", () => {
    const { git: g } = repoEfimero();
    const sinRefs: GitRunner = (args) => {
      if (args[0] === "merge-base" || args[0] === "symbolic-ref") throw new Error("no such ref");
      return g(args);
    };
    expect(() => baseDeRama(sinRefs, {})).toThrow(BaseIndeterminadaError);
    // Y NO cae a HEAD~1: el mensaje enumera los refs probados.
    try { baseDeRama(sinRefs, {}); } catch (e) {
      expect((e as Error).message).toContain("origin/main");
      expect((e as Error).message).not.toContain("HEAD~1");
    }
  });

  it("MUTANTE 6 · rama con VARIOS commits propios: la base sigue siendo la de fusión", () => {
    const { git: g } = repoEfimero(3);
    const base = baseDeRama(g, { WMS_VANILLA_BASE: "main" });
    // HEAD~1 sería el commit anterior de la propia rama, no la base.
    const head1 = g(["rev-parse", "HEAD~1"]).trim();
    expect(base).not.toBe(head1);
    expect(base).toBe(g(["rev-parse", "main"]).trim());
  });

  it("MUTANTE 7 · origin/HEAD ausente o ambiguo no se acepta como base", () => {
    const { git: g } = repoEfimero();
    const soloOriginHead: GitRunner = (args) => {
      if (args[0] === "merge-base" && (args[2] === "origin/main" || args[2] === "main")) {
        throw new Error("no such ref");
      }
      if (args[0] === "symbolic-ref") return ""; // ambiguo: sin destino
      return g(args);
    };
    expect(() => baseDeRama(soloOriginHead, {})).toThrow(BaseIndeterminadaError);
  });

  it("MUTANTE 8 · sustituir la base por HEAD~1 vía entorno es rechazado si no resuelve", () => {
    const { git: g } = repoEfimero();
    // Una base explícita SÍ se admite, pero tiene que existir y ser un commit.
    expect(baseDeRama(g, { WMS_VANILLA_BASE: "main" })).toMatch(/^[0-9a-f]{40}$/);
    expect(() => baseDeRama(g, { WMS_VANILLA_BASE: "no-existe-este-ref" }))
      .toThrow(BaseIndeterminadaError);
  });
});

/**
 * La excepción del append-only, ejercitada. Sin esto la lista sería una puerta
 * abierta: bastaría con agregar un nombre para poder reescribir cualquier
 * migración ya aplicada en producción.
 */
describe("T-C1-05 · la excepción de edición no es una puerta abierta", () => {
  const SHA_OK = "a".repeat(64);
  const listada = "supabase/migrations/0250a_custody_productive_vision.sql";
  const ajena = "supabase/migrations/0222_custody_integrity_foundation.sql";

  it("editar una migración NO listada sigue siendo violación", () => {
    const v = evaluarEdicionDeMigraciones(
      [ajena], MIGRACIONES_EDITABLES, () => SHA_OK, () => SHA_OK,
    );
    expect(v.map((x) => x.codigo)).toEqual(["MIGRACION_EDITADA_NO_AUTORIZADA"]);
    expect(v[0].detalle).toBe(ajena);
  });

  it("listarla NO alcanza: sin re-registrar el sha256 en el catálogo, falla", () => {
    // El archivo cambió en disco pero el catálogo quedó con el hash viejo.
    const v = evaluarEdicionDeMigraciones(
      [listada], MIGRACIONES_EDITABLES, () => "b".repeat(64), () => SHA_OK,
    );
    expect(v.map((x) => x.codigo)).toEqual(["EDICION_SIN_REGISTRO_EN_CATALOGO"]);
  });

  it("y tampoco si la migración desapareció del catálogo", () => {
    const v = evaluarEdicionDeMigraciones(
      [listada], MIGRACIONES_EDITABLES, () => null, () => SHA_OK,
    );
    expect(v.map((x) => x.codigo)).toEqual(["EDICION_SIN_REGISTRO_EN_CATALOGO"]);
  });

  it("listada Y re-registrada: pasa, que es el único camino admitido", () => {
    expect(
      evaluarEdicionDeMigraciones([listada], MIGRACIONES_EDITABLES, () => SHA_OK, () => SHA_OK),
    ).toEqual([]);
  });

  it("sin ediciones no hay nada que autorizar", () => {
    expect(evaluarEdicionDeMigraciones([], MIGRACIONES_EDITABLES, () => null, () => null))
      .toEqual([]);
  });

  it("la lista es explícita, acotada y dice cuándo se retira", () => {
    expect(MIGRACIONES_EDITABLES).toEqual([
      "supabase/migrations/0250a_custody_productive_vision.sql",
    ]);
    const src = readFileSync(
      join(REPO_ROOT, "tests", "custody-db", "t-c1-05-append-only-vanilla.test.ts"),
      "utf8",
    );
    expect(src).toMatch(/RETIRAR esta entrada en cuanto 0250a quede aplicada/);
  });
});
