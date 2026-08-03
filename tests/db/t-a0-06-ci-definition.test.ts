/**
 * T-A0-06 · Esquema EXACTO del workflow de CI (H-02).
 *
 * El workflow se parsea como YAML y se compara contra `EXPECTED_WORKFLOW`
 * mediante diff profundo. Los mutantes se auditan EN MEMORIA: no se escribe una
 * copia del workflow en el árbol Git ni se ejecuta el workflow mutado.
 *
 * Cada mutación estructural produce findings y por tanto impide el sentinela
 * `P3_N1A0_CI_DEFINITION_PASS`.
 */

import { describe, expect, it } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { EXPECTED_WORKFLOW, WORKFLOW_RELATIVE_PATH, auditWorkflow } from "./harness/workflow-audit";

const REPO_ROOT = resolve(__dirname, "..", "..");
const WORKFLOW_TEXT = readFileSync(join(REPO_ROOT, WORKFLOW_RELATIVE_PATH), "utf8");

/** Aplica una mutación al documento parseado y lo vuelve a serializar. */
function mutate(fn: (doc: Record<string, unknown>) => void): string {
  const doc = parse(WORKFLOW_TEXT) as Record<string, unknown>;
  fn(doc);
  return stringify(doc);
}

function job(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc.jobs as Record<string, unknown>)["db-harness"] as Record<string, unknown>;
}
function steps(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  return job(doc).steps as Array<Record<string, unknown>>;
}
function svc(doc: Record<string, unknown>): Record<string, unknown> {
  return (job(doc).services as Record<string, unknown>).postgres as Record<string, unknown>;
}
function rules(yamlText: string): string[] {
  return auditWorkflow(yamlText).map((f) => f.rule);
}
function hasFindings(yamlText: string): boolean {
  return auditWorkflow(yamlText).length > 0;
}

describe("T-A0-06 · esquema exacto del workflow", () => {
  emitSentinelWhenGreen("P3_N1A0_CI_DEFINITION_PASS");

  it("el workflow real coincide EXACTAMENTE con el esquema esperado", () => {
    expect(auditWorkflow(WORKFLOW_TEXT)).toEqual([]);
  });

  it("el esquema esperado documenta el checkout por comportamiento predeterminado (sin `with`)", () => {
    const checkout = EXPECTED_WORKFLOW.jobs["db-harness"].steps[0];
    expect(checkout.uses).toBe("actions/checkout@v4");
    expect("with" in checkout).toBe(false);
  });

  // ── §3.4 · las diez mutaciones obligatorias ──────────────────────────────

  it("1 · checkout con `ref` arbitrario", () => {
    const m = mutate((doc) => {
      steps(doc)[0].with = { ref: "refs/heads/otra-rama" };
    });
    expect(rules(m)).toContain("unknown-key"); // steps[0].with no está en el esquema
    expect(hasFindings(m)).toBe(true);
  });

  it("1b · checkout con cualquier `with` se rechaza (política sin ref)", () => {
    for (const w of [
      { ref: "${{ github.event.pull_request.head.sha }}" },
      { "fetch-depth": 0 },
      { repository: "otro/repo" },
    ]) {
      const m = mutate((doc) => {
        steps(doc)[0].with = w;
      });
      expect(hasFindings(m)).toBe(true);
    }
  });

  it("2 · eliminación de `pull_request`", () => {
    const m = mutate((doc) => {
      delete (doc.on as Record<string, unknown>).pull_request;
    });
    expect(rules(m)).toContain("missing-key");
  });

  it("3 · trigger adicional bajo `on`", () => {
    const m = mutate((doc) => {
      (doc.on as Record<string, unknown>).workflow_dispatch = {};
    });
    expect(rules(m)).toContain("unknown-key");
  });

  it("3b · cron bajo `on`", () => {
    const m = mutate((doc) => {
      (doc.on as Record<string, unknown>).schedule = [{ cron: "0 * * * *" }];
    });
    expect(hasFindings(m)).toBe(true);
  });

  it("3c · rama de push cambiada", () => {
    const m = mutate((doc) => {
      (((doc.on as Record<string, unknown>).push as Record<string, unknown>).branches as string[]) = ["main"];
    });
    expect(rules(m)).toContain("value");
  });

  it("4 · concurrency cambiada (group)", () => {
    const m = mutate((doc) => {
      (doc.concurrency as Record<string, unknown>).group = "otro-grupo";
    });
    expect(rules(m)).toContain("value");
  });

  it("4b · concurrency cambiada (cancel-in-progress)", () => {
    const m = mutate((doc) => {
      (doc.concurrency as Record<string, unknown>)["cancel-in-progress"] = false;
    });
    expect(rules(m)).toContain("value");
  });

  it("4c · concurrency eliminada", () => {
    const m = mutate((doc) => {
      delete doc.concurrency;
    });
    expect(rules(m)).toContain("missing-key");
  });

  it("5 · timeout eliminado", () => {
    const m = mutate((doc) => {
      delete job(doc)["timeout-minutes"];
    });
    expect(rules(m)).toContain("missing-key");
  });

  it("5b · timeout cambiado", () => {
    const m = mutate((doc) => {
      job(doc)["timeout-minutes"] = 600;
    });
    expect(rules(m)).toContain("value");
  });

  it("6 · opciones del servicio sustituidas (healthcheck debilitado)", () => {
    const m = mutate((doc) => {
      svc(doc).options = "--health-cmd true";
    });
    expect(rules(m)).toContain("value");
  });

  it("6b · imagen del servicio distinta", () => {
    const m = mutate((doc) => {
      svc(doc).image = "postgres:16";
    });
    expect(rules(m)).toContain("value");
  });

  it("6c · puertos del servicio cambiados", () => {
    const m = mutate((doc) => {
      svc(doc).ports = ["6543:5432"];
    });
    expect(rules(m)).toContain("value");
  });

  it("6d · variable extra en el servicio", () => {
    const m = mutate((doc) => {
      (svc(doc).env as Record<string, unknown>).EXTRA = "x";
    });
    expect(rules(m)).toContain("unknown-key");
  });

  it("7 · mecanismo de cache cambiado", () => {
    const m = mutate((doc) => {
      (steps(doc)[1].with as Record<string, unknown>).cache = "yarn";
    });
    expect(rules(m)).toContain("value");
  });

  it("7b · parámetro de cache adicional (cache-dependency-path)", () => {
    const m = mutate((doc) => {
      (steps(doc)[1].with as Record<string, unknown>)["cache-dependency-path"] = "**/evil";
    });
    expect(rules(m)).toContain("unknown-key");
  });

  it("7c · node-version cambiada", () => {
    const m = mutate((doc) => {
      (steps(doc)[1].with as Record<string, unknown>)["node-version"] = 20;
    });
    expect(rules(m)).toContain("value");
  });

  it("8 · condición del control residual modificada", () => {
    const m = mutate((doc) => {
      steps(doc)[4].if = "success()";
    });
    expect(rules(m)).toContain("value");
  });

  it("8b · condición del control residual eliminada (ya no corre tras fallos)", () => {
    const m = mutate((doc) => {
      delete steps(doc)[4].if;
    });
    // Sin `if: always()`, el step no correría tras un fallo previo: divergencia.
    expect(rules(m)).toContain("missing-key");
  });

  it("9 · reordenamiento que pone el control residual antes de la suite", () => {
    const m = mutate((doc) => {
      const s = steps(doc);
      const residual = s.splice(4, 1)[0];
      s.splice(3, 0, residual); // lo mueve antes de la suite
    });
    // El orden exacto de steps cambia ⇒ divergencia.
    expect(hasFindings(m)).toBe(true);
  });

  it("10 · action no autorizada (step adicional)", () => {
    const m = mutate((doc) => {
      steps(doc).push({ name: "extra", uses: "some-org/some-action@v1" });
    });
    expect(rules(m)).toContain("array-length");
  });

  it("10b · parámetro `with` no autorizado en una action existente", () => {
    const m = mutate((doc) => {
      (steps(doc)[1].with as Record<string, unknown>)["always-auth"] = true;
    });
    expect(rules(m)).toContain("unknown-key");
  });

  // ── mutaciones de contenido de steps ────────────────────────────────────

  it("comando de la suite alterado", () => {
    const m = mutate((doc) => {
      steps(doc)[3].run = "npm run test:db -- --coverage";
    });
    expect(rules(m)).toContain("value");
  });

  it("comando del control residual alterado", () => {
    const m = mutate((doc) => {
      steps(doc)[4].run = "node tests/db/scripts/assert-no-residual-databases.mjs --skip";
    });
    expect(rules(m)).toContain("value");
  });

  it.each([
    ["psql remoto", 'psql postgresql://postgres@example.invalid:5432/prod -c "select 1"', "forbidden:psql"],
    ["curl", "curl https://example.invalid/x", "forbidden:curl"],
    ["netlify deploy", "netlify deploy --prod", "forbidden:netlify-cli"],
    ["docker", "docker run x", "forbidden:docker"],
  ])("step con %s se rechaza", (_l, cmd, rule) => {
    const m = mutate((doc) => {
      steps(doc).push({ name: "x", run: cmd });
    });
    const r = rules(m);
    expect(r).toContain(rule);
    expect(r).toContain("array-length");
  });

  it("MUTANTE: interpolación de secrets a nivel job env", () => {
    const m = mutate((doc) => {
      (job(doc).env as Record<string, unknown>).TOKEN = "${{ secrets.SOME_TOKEN }}";
    });
    const r = rules(m);
    expect(r).toContain("secrets-interpolation");
    expect(r).toContain("unknown-key");
  });

  it("MUTANTE: permisos ampliados", () => {
    const m = mutate((doc) => {
      (doc.permissions as Record<string, unknown>).contents = "write";
    });
    expect(rules(m)).toContain("value");
  });

  it("MUTANTE: permisos vacíos", () => {
    const m = mutate((doc) => {
      doc.permissions = {};
    });
    expect(rules(m)).toContain("missing-key");
  });

  it("MUTANTE: `container` a nivel job", () => {
    const m = mutate((doc) => {
      job(doc).container = "node:22";
    });
    expect(rules(m)).toContain("unknown-key");
  });

  it("MUTANTE: `env` remoto a nivel workflow", () => {
    const m = mutate((doc) => {
      doc.env = { EVIL: "x" };
    });
    expect(rules(m)).toContain("unknown-key");
  });

  it("MUTANTE: `runs-on` cambiado", () => {
    const m = mutate((doc) => {
      job(doc)["runs-on"] = "self-hosted";
    });
    expect(rules(m)).toContain("value");
  });

  it("MUTANTE: `working-directory` en un step", () => {
    const m = mutate((doc) => {
      steps(doc)[3]["working-directory"] = "/tmp";
    });
    expect(rules(m)).toContain("unknown-key");
  });

  it("MUTANTE: continue-on-error en un step", () => {
    const m = mutate((doc) => {
      steps(doc)[3]["continue-on-error"] = true;
    });
    expect(rules(m)).toContain("unknown-key");
  });

  it("MUTANTE: job adicional", () => {
    const m = mutate((doc) => {
      (doc.jobs as Record<string, unknown>).otro = { "runs-on": "ubuntu-latest", steps: [] };
    });
    expect(rules(m)).toContain("unknown-key");
  });

  it("un YAML inválido produce un hallazgo, no una excepción", () => {
    expect(() => auditWorkflow("::: no es yaml :::")).not.toThrow();
    expect(auditWorkflow("a:\n  - b\n c: d").length).toBeGreaterThan(0);
  });
});
