/**
 * T-C2-04 · W22-TER-A/M6 — CONTRATO DE CI DEL HARNESS DEDICADO DE CUSTODIA.
 *
 * El DB-C4 marcó que el harness de Custodia existía y corría en local, pero
 * NADA lo ejecutaba en CI: no había comando oficial en `package.json` ni
 * workflow propio. El workflow vanilla `p3-n1a0-db-harness.yml` no lo sustituye
 * —corre `npm run test:db` sobre `postgres:17` SIN PostGIS y sobre el manifiesto
 * de 31 migraciones, que excluye por diseño 0016 y 0036–0039—.
 *
 * ─── POR QUÉ SE PARSEA EL YAML Y NO SE HACE grep ──────────────────────────
 *
 * Una batería de expresiones regulares aprueba un workflow inoperante: basta
 * que las cadenas aparezcan en un comentario, en un step deshabilitado o en una
 * rama muerta. Acá el documento se PARSEA y se navega su estructura —jobs,
 * services, steps, triggers— igual que hace `t-a0-06` con el workflow vanilla.
 * Las afirmaciones son sobre el árbol, no sobre el texto.
 *
 * Lo que este archivo NO afirma: que GitHub Actions haya ejecutado el workflow.
 * No hay push en esta sesión. El contrato es LOCAL.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const REPO_ROOT = resolve(__dirname, "..", "..");
const WORKFLOW_PATH = ".github/workflows/wms-custody-db-harness.yml";
const VANILLA_WORKFLOW_PATH = ".github/workflows/p3-n1a0-db-harness.yml";
const OFFICIAL_SCRIPT = "test:custody:db";
const POSTGIS_PROBE = "tests/custody-db/scripts/assert-postgis-runtime.mjs";

type Dict = Record<string, unknown>;

function readRepo(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

/**
 * Código sin comentarios. Las afirmaciones sobre lo que un archivo NO hace se
 * evalúan contra lo EJECUTABLE: un comentario que documenta la prohibición
 * («no se usa pg_available_extensions») no puede contar como su violación.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const pkg = JSON.parse(readRepo("package.json")) as {
  scripts: Record<string, string>;
};

function loadWorkflow(): Dict {
  if (!existsSync(join(REPO_ROOT, WORKFLOW_PATH))) {
    throw new Error(
      `[M6] falta el workflow dedicado de Custodia: ${WORKFLOW_PATH}. ` +
        "El workflow vanilla NO lo sustituye.",
    );
  }
  return parse(readRepo(WORKFLOW_PATH)) as Dict;
}

/** Único job del workflow, sea cual sea su nombre. */
function theJob(wf: Dict): Dict {
  const jobs = wf.jobs as Dict;
  const names = Object.keys(jobs ?? {});
  expect(names).toHaveLength(1);
  return jobs[names[0]] as Dict;
}

function steps(wf: Dict): Dict[] {
  return (theJob(wf).steps as Dict[]) ?? [];
}

/** Todos los `run` del job, concatenados para inspección de comandos. */
function runCommands(wf: Dict): string[] {
  return steps(wf)
    .map((s) => (typeof s.run === "string" ? s.run : ""))
    .filter(Boolean);
}

/**
 * `on:` es una trampa clásica de YAML 1.1: la clave desnuda `on` se interpreta
 * como el booleano `true`. El parser `yaml` v2 usa el core schema de YAML 1.2 y
 * conserva la cadena, pero se contemplan las dos formas para no depender de eso.
 */
function triggers(wf: Dict): Dict {
  return (wf.on ?? (wf as Record<string, unknown>)[true as unknown as string]) as Dict;
}

describe("T-C2-04 · M6 · comando oficial", () => {
  it("1 · `package.json` expone el script oficial de Custodia", () => {
    expect(Object.keys(pkg.scripts)).toContain(OFFICIAL_SCRIPT);
  });

  it("2 · el script ejecuta vitest contra `vitest.custody.config.ts`", () => {
    const cmd = pkg.scripts[OFFICIAL_SCRIPT] ?? "";
    expect(cmd).toMatch(/vitest\s+run/);
    expect(cmd).toContain("--config vitest.custody.config.ts");
    // Nada que trague el exit code real.
    expect(cmd).not.toMatch(/\|\|\s*true|;\s*exit\s+0|continue-on-error/);
  });

  it("2.b · el script NO es un alias del harness vanilla", () => {
    const cmd = pkg.scripts[OFFICIAL_SCRIPT] ?? "";
    expect(cmd).not.toContain("vitest.db.config.ts");
    expect(cmd).not.toMatch(/\btest:db\b/);
  });
});

describe("T-C2-04 · M6 · el workflow existe y ejecuta el comando oficial", () => {
  it("3 · el workflow dedicado existe y lo invoca", () => {
    const wf = loadWorkflow();
    const cmds = runCommands(wf);
    expect(cmds.some((c) => c.includes(`npm run ${OFFICIAL_SCRIPT}`))).toBe(true);
  });

  it("5 · NO se limita a ejecutar el harness vanilla", () => {
    const wf = loadWorkflow();
    const cmds = runCommands(wf);
    expect(cmds.some((c) => /npm run test:db\b/.test(c))).toBe(false);
    expect(cmds.some((c) => c.includes("vitest.db.config.ts"))).toBe(false);
  });

  it("4 · los triggers cubren migraciones, harness, config, package y el propio workflow", () => {
    const wf = loadWorkflow();
    const paths = ((triggers(wf).pull_request as Dict)?.paths as string[]) ?? [];
    for (const p of [
      "supabase/migrations/**",
      "tests/custody-db/**",
      "vitest.custody.config.ts",
      "package.json",
      WORKFLOW_PATH,
    ]) {
      expect(paths).toContain(p);
    }
  });
});

describe("T-C2-04 · M6 · PostgreSQL 17 + PostGIS REAL", () => {
  it("6 · el runtime declarado es una imagen PostGIS sobre PostgreSQL 17", () => {
    const wf = loadWorkflow();
    const services = theJob(wf).services as Dict;
    expect(services).toBeTruthy();
    const images = Object.values(services).map((s) => String((s as Dict).image ?? ""));
    expect(images).toHaveLength(1);
    const image = images[0];
    // La imagen tiene que ser de PostGIS —no `postgres:17` pelado— y su tag
    // tiene que empezar por la major 17.
    expect(image).toMatch(/^postgis\/postgis:17-/);
  });

  it("6.b · el harness apunta REALMENTE a ese servicio (sustrato externo)", () => {
    const wf = loadWorkflow();
    const job = theJob(wf);
    const env = (job.env as Dict) ?? {};
    const url = String(env.P3N1A0_TEST_PG_URL ?? "");
    // Sin esta variable el harness levantaría un cluster efímero con los
    // binarios del runner, y el service container no probaría nada.
    expect(url).toMatch(/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\/postgres$/);
  });

  it("7 · PostGIS real se verifica ANTES de la suite", () => {
    const wf = loadWorkflow();
    const all = steps(wf);
    const probeIdx = all.findIndex((s) => String(s.run ?? "").includes(POSTGIS_PROBE));
    const suiteIdx = all.findIndex((s) =>
      String(s.run ?? "").includes(`npm run ${OFFICIAL_SCRIPT}`),
    );
    expect(probeIdx).toBeGreaterThanOrEqual(0);
    expect(suiteIdx).toBeGreaterThanOrEqual(0);
    expect(probeIdx).toBeLessThan(suiteIdx);
    // Y la sonda existe en el árbol y prueba la función, no el nombre.
    expect(existsSync(join(REPO_ROOT, POSTGIS_PROBE))).toBe(true);
    const probe = readRepo(POSTGIS_PROBE);
    expect(probe).toContain("postgis_lib_version");
  });

  it("7.b · la sonda prueba la extensión REAL y no la fabrica", () => {
    const probe = codeOf(readRepo(POSTGIS_PROBE));
    // Conexión real contra el mismo servidor que usará la suite…
    expect(probe).toMatch(/from ["']pg["']/);
    expect(probe).toContain("P3N1A0_TEST_PG_URL");
    // …y la extensión REAL, creada de verdad.
    expect(probe).toMatch(/create extension postgis/i);
    // Ninguna definición propia que pueda hacerse pasar por la función: un
    // shim se vería exactamente así.
    expect(probe).not.toMatch(/create (or replace )?function[^\n]*postgis_lib_version/i);
    expect(probe).not.toMatch(/(function|const|let|var)\s+postgis_lib_version/);
    // Y no alcanza con leer el catálogo: eso devuelve el NOMBRE, no la carga de
    // la biblioteca compartida.
    expect(probe).not.toMatch(/pg_available_extensions/);
    // Sin residuo.
    expect(probe).toMatch(/rollback/i);
  });
});

describe("T-C2-04 · M6 · higiene del workflow", () => {
  it("8 · privilegios mínimos, timeout y concurrency", () => {
    const wf = loadWorkflow();
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(theJob(wf)["timeout-minutes"]).toBeGreaterThan(0);
    expect(theJob(wf)["timeout-minutes"]).toBeLessThanOrEqual(30);
    const concurrency = wf.concurrency as Dict;
    expect(typeof concurrency?.group).toBe("string");
    expect(concurrency?.["cancel-in-progress"]).toBe(true);
  });

  it("9 · sin Supabase remoto, project ref, service role ni secretos de producción", () => {
    const text = readRepo(WORKFLOW_PATH);
    expect(text).not.toMatch(/supabase\.co|supabase\.com|\.supabase\./i);
    expect(text).not.toMatch(/service_role|SERVICE_ROLE/);
    expect(text).not.toMatch(/arsksytgdnzukbmfgkju/i);
    expect(text).not.toMatch(/\$\{\{\s*secrets\./);
    expect(text).not.toMatch(/OPENAI|ANTHROPIC|META_|WHATSAPP|RESEND/i);
  });

  it("10 · ningún step oculta su exit code", () => {
    const wf = loadWorkflow();
    for (const s of steps(wf)) {
      expect(s["continue-on-error"]).toBeUndefined();
      const run = String(s.run ?? "");
      expect(run).not.toMatch(/\|\|\s*true/);
      expect(run).not.toMatch(/\bset\s+\+e\b/);
      // Un pipe puede enmascarar el exit code del primer comando.
      expect(run).not.toMatch(/\|\s*(tee|head|tail|cat)\b/);
    }
    expect(theJob(wf)["continue-on-error"]).toBeUndefined();
  });

  it("11 · verifica residuos al finalizar, pase lo que pase", () => {
    const wf = loadWorkflow();
    const residual = steps(wf).find((s) =>
      String(s.run ?? "").includes("assert-no-residual-databases.mjs"),
    );
    expect(residual).toBeTruthy();
    expect(residual?.if).toBe("always()");
  });

  it("11.b · instala dependencias desde el lockfile", () => {
    const wf = loadWorkflow();
    expect(runCommands(wf).some((c) => /\bnpm ci\b/.test(c))).toBe(true);
  });
});

describe("T-C2-04 · M6 · el contrato vanilla queda intacto", () => {
  it("12 · el workflow vanilla sigue existiendo y no fue reapuntado a Custodia", () => {
    const vanilla = parse(readRepo(VANILLA_WORKFLOW_PATH)) as Dict;
    const vjob = (vanilla.jobs as Dict)["db-harness"] as Dict;
    const vruns = ((vjob.steps as Dict[]) ?? []).map((s) => String(s.run ?? ""));
    expect(vruns.some((c) => /npm run test:db\b/.test(c))).toBe(true);
    expect(vruns.some((c) => c.includes(OFFICIAL_SCRIPT))).toBe(false);
    const vimg = String(((vjob.services as Dict).postgres as Dict).image ?? "");
    expect(vimg).toBe("postgis/postgis:17-3.5");
  });

  it("12.b · el workflow de Custodia es un archivo DISTINTO", () => {
    expect(WORKFLOW_PATH).not.toBe(VANILLA_WORKFLOW_PATH);
    expect(existsSync(join(REPO_ROOT, VANILLA_WORKFLOW_PATH))).toBe(true);
  });
});
