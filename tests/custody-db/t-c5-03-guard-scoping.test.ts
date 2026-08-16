/**
 * T-C5-03 · EL GUARD SE ACOTA POR LAS RUTAS DEL DIFF, NO POR EL NOMBRE DE LA RAMA.
 *
 * Historia del defecto, que es lo que justifica cada aserción de acá:
 *
 *  1. El harness de Custodia corre en TODA PR que toque `supabase/migrations/**`
 *     (`wms-custody-db-harness.yml`), así que sus invariantes se ejecutan sobre
 *     candidatos de otros frentes.
 *  2. Varias aserciones del bloque de invariancia son promesas de ESTE
 *     expediente —qué rutas no toca, qué archivo del harness vanilla cambia,
 *     qué líneas de `package.json` autoriza, qué migraciones 0250* existen en
 *     disco—. Aplicadas a un frente ajeno lo bloquean por algo que nunca
 *     prometió.
 *  3. El primer intento de arreglo acotó por NOMBRE DE RAMA
 *     (`rev-parse --abbrev-ref HEAD`). En CI `actions/checkout` deja el HEAD
 *     DETACHED y ese comando devuelve la cadena "HEAD", que no matchea: el
 *     gate quedó inerte justamente donde único se aplica solo, mientras el
 *     comentario afirmaba lo contrario.
 *
 * El criterio correcto es el DIFF: la aserción aplica si lo que se está
 * revisando contiene rutas propias de Custodia. Eso no depende de cómo se
 * llame la rama ni de si el HEAD está adjunto.
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  baseDeRama,
  cambiosDeLaRama,
  rutasPropiasDeCustodia,
  type GitRunner,
} from "./harness/vanilla-guard";

/** Diff realista de un frente ajeno: Clientes Fase B. */
const DIFF_AJENO = [
  "supabase/migrations/0246_clientes_fase_b_principals_capabilities.sql",
  "supabase/migrations/ROLLBACK_0246_clientes_fase_b_principals_capabilities.sql",
  "supabase/migrations/0249_clientes_fase_b_service_pricing_redaction.sql",
  "src/app/(app)/clientes/actions.ts",
  "src/lib/clientes/rbac.ts",
  "tests/db/harness/manifest.ts",
  "package.json",
];

/** Diff realista de este expediente. */
const DIFF_PROPIO = [
  "supabase/migrations/0250_custody_physical_scope_enums.sql",
  "supabase/migrations/0250a_custody_productive_vision.sql",
  "src/lib/custody/productive-vision-evaluation.ts",
  "tests/custody-db/t-c2-05-shipment-tristate.test.ts",
  "tests/db/harness/manifest.ts",
];

describe("T-C5-03 · el frente ajeno queda fuera de alcance", () => {
  it("1 · un diff de Fase B no contiene ninguna ruta propia de Custodia", () => {
    expect(rutasPropiasDeCustodia(DIFF_AJENO)).toEqual([]);
  });

  it("2 · tocar supabase/migrations NO alcanza para quedar dentro", () => {
    // Es exactamente el disparador del workflow: si bastara con eso, el
    // acotamiento no acotaría nada.
    expect(rutasPropiasDeCustodia(["supabase/migrations/0246_x.sql"])).toEqual([]);
    expect(rutasPropiasDeCustodia(["supabase/migrations/0249_y.sql"])).toEqual([]);
  });

  it("3 · un diff vacío tampoco entra en alcance", () => {
    expect(rutasPropiasDeCustodia([])).toEqual([]);
  });
});

describe("T-C5-03 · el diff propio conserva la fuerza literal", () => {
  it("4 · reconoce las tres familias de rutas del expediente", () => {
    expect(rutasPropiasDeCustodia(DIFF_PROPIO)).toEqual([
      "supabase/migrations/0250_custody_physical_scope_enums.sql",
      "supabase/migrations/0250a_custody_productive_vision.sql",
      "src/lib/custody/productive-vision-evaluation.ts",
      "tests/custody-db/t-c2-05-shipment-tristate.test.ts",
    ]);
  });

  it("5 · una sola ruta propia basta para quedar dentro de alcance", () => {
    for (const r of [
      "supabase/migrations/0250_custody_physical_scope_enums.sql",
      "supabase/migrations/ROLLBACK_0250a_custody_productive_vision.sql",
      "tests/custody-db/harness/vanilla-guard.ts",
      "src/lib/custody/custody.ts",
    ]) {
      expect(rutasPropiasDeCustodia([r, "docs/otro.md"]), r).toEqual([r]);
    }
  });

  it("6 · no se cuela un prefijo parecido", () => {
    // `0251`, `custody` fuera de `src/lib`, y un directorio que empieza igual.
    expect(
      rutasPropiasDeCustodia([
        "supabase/migrations/0251_otra_cosa.sql",
        "src/app/(app)/wms/custody/actions.ts",
        "tests/custody-db-extra/x.test.ts",
      ]),
    ).toEqual([]);
  });
});

describe("T-C5-03 · el acotamiento no depende del nombre de la rama", () => {
  it("7 · la función es pura sobre el diff: no consulta git ni el entorno", () => {
    const fuente = rutasPropiasDeCustodia.toString();
    expect(fuente).not.toMatch(/abbrev-ref|rev-parse|process\.env|execSync/);
  });
});

/**
 * PRUEBA DE EXTREMO A EXTREMO CONTRA GIT REAL, INCLUIDO HEAD DETACHED.
 *
 * El defecto anterior no estaba en la idea de acotar sino en el dato usado
 * para hacerlo: `rev-parse --abbrev-ref HEAD` devuelve "HEAD" cuando el
 * checkout está detached, que es exactamente lo que hace `actions/checkout` en
 * un `pull_request`. Por eso acá el repo se DETACHA a propósito antes de medir.
 */
describe("T-C5-03 · el acotamiento funciona con git real y HEAD detached", () => {
  const temporales: string[] = [];
  afterAll(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });

  /** Repo efímero con un commit de rama y el HEAD detached sobre él. */
  function repoConDiff(archivos: readonly string[]): { git: GitRunner; rama: string } {
    const dir = mkdtempSync(join(tmpdir(), "scoping-"));
    temporales.push(dir);
    const g: GitRunner = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    execFileSync("git", ["init", "-q", "-b", "main", dir], { encoding: "utf8" });
    g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]);
    writeFileSync(join(dir, "README.md"), "base\n");
    g(["add", "-A"]); g(["commit", "-qm", "base"]);
    g(["checkout", "-qb", "codex/otro-frente-cualquiera"]);
    for (const f of archivos) {
      mkdirSync(join(dir, f.split("/").slice(0, -1).join("/")), { recursive: true });
      writeFileSync(join(dir, f), "x\n");
    }
    g(["add", "-A"]); g(["commit", "-qm", "cambio"]);
    // Lo que hace CI: deja de haber nombre de rama.
    g(["checkout", "-q", "--detach"]);
    return { git: g, rama: g(["rev-parse", "--abbrev-ref", "HEAD"]).trim() };
  }

  it("8 · en detached NO hay nombre de rama, y aun así el alcance se resuelve", () => {
    const { git, rama } = repoConDiff([
      "supabase/migrations/0246_clientes_fase_b_principals_capabilities.sql",
      "src/lib/clientes/rbac.ts",
    ]);
    // La prueba de que el criterio viejo era inservible acá.
    expect(rama).toBe("HEAD");

    const todo = cambiosDeLaRama(git, baseDeRama(git), ".");
    expect(todo).toContain("supabase/migrations/0246_clientes_fase_b_principals_capabilities.sql");
    // Frente ajeno ⇒ las aserciones del bloque se declaran no aplicables.
    expect(rutasPropiasDeCustodia(todo)).toEqual([]);
  });

  it("9 · el diff propio entra en alcance también en detached", () => {
    const { git, rama } = repoConDiff([
      "supabase/migrations/0250a_custody_productive_vision.sql",
      "tests/custody-db/t-c9-99-x.test.ts",
    ]);
    expect(rama).toBe("HEAD");

    const todo = cambiosDeLaRama(git, baseDeRama(git), ".");
    expect(rutasPropiasDeCustodia(todo)).toEqual([
      "supabase/migrations/0250a_custody_productive_vision.sql",
      "tests/custody-db/t-c9-99-x.test.ts",
    ]);
  });
});
