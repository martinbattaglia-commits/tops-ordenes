/**
 * T-A0-06 · La definición de CI respeta el alcance (M-04).
 *
 * El workflow se PARSEA como YAML y se compara contra una allowlist estricta.
 * Los mutantes se auditan EN MEMORIA: no se escribe una copia del workflow en
 * el árbol Git, ni se toca el archivo real.
 */

import { describe, expect, it } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import {
  ALLOWED_JOB_ENV,
  ALLOWED_RUN_COMMANDS,
  ALLOWED_SERVICE_IMAGE,
  ALLOWED_STEP_NAMES,
  ALLOWED_USES,
  REQUIRED_NODE_VERSION,
  WORKFLOW_RELATIVE_PATH,
  auditWorkflow,
  normalizeCommand,
} from "./harness/workflow-audit";

const REPO_ROOT = resolve(__dirname, "..", "..");
const WORKFLOW_TEXT = readFileSync(join(REPO_ROOT, WORKFLOW_RELATIVE_PATH), "utf8");

/** Aplica una mutación al documento parseado y lo vuelve a serializar. */
function mutate(fn: (doc: Record<string, unknown>) => void): string {
  const doc = parse(WORKFLOW_TEXT) as Record<string, unknown>;
  fn(doc);
  return stringify(doc);
}

function steps(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  const jobs = doc.jobs as Record<string, unknown>;
  const job = jobs["db-harness"] as Record<string, unknown>;
  return job.steps as Array<Record<string, unknown>>;
}

function rules(yamlText: string): string[] {
  return auditWorkflow(yamlText).map((f) => f.rule);
}

describe("T-A0-06 · definición de CI", () => {
  emitSentinelWhenGreen("P3_N1A0_CI_DEFINITION_PASS");

  it("el workflow real pasa la auditoría estructural", () => {
    const findings = auditWorkflow(WORKFLOW_TEXT);
    expect(findings).toEqual([]);
  });

  it("la allowlist describe exactamente el workflow vigente", () => {
    const doc = parse(WORKFLOW_TEXT) as Record<string, unknown>;
    const s = steps(doc);
    expect(s.map((x) => String(x.name))).toEqual([...ALLOWED_STEP_NAMES]);
    expect(s.filter((x) => x.uses).map((x) => String(x.uses))).toEqual([...ALLOWED_USES]);
    expect(s.filter((x) => x.run).map((x) => normalizeCommand(String(x.run)))).toEqual([
      ...ALLOWED_RUN_COMMANDS,
    ]);
  });

  // ── MUTANTES PERMANENTES ────────────────────────────────────────────────

  it("MUTANTE: step remoto con psql contra un host externo", () => {
    const mutated = mutate((doc) => {
      steps(doc).push({
        name: "remote mutation",
        run: 'psql postgresql://postgres@example.invalid:5432/production -c "select 1"',
      });
    });
    const r = rules(mutated);
    expect(r).toContain("step-count"); // step adicional
    expect(r).toContain("step-name"); // nombre no autorizado
    expect(r).toContain("run-command"); // comando no autorizado
    expect(r).toContain("forbidden:psql"); // conexión remota
    expect(r).toContain("forbidden:url-postgres-literal");
  });

  it.each([
    ["curl", "curl https://example.invalid/x", "forbidden:curl"],
    ["wget", "wget https://example.invalid/x", "forbidden:wget"],
    ["supabase db push", "supabase db push", "forbidden:supabase-cli"],
    ["netlify deploy", "netlify deploy --prod", "forbidden:netlify-cli"],
    ["docker", "docker run postgres:17", "forbidden:docker"],
    ["terraform", "terraform apply", "forbidden:terraform"],
    ["ssh", "ssh user@example.invalid", "forbidden:ssh"],
  ])("MUTANTE: step con %s", (_label, cmd, expectedRule) => {
    const mutated = mutate((doc) => {
      steps(doc).push({ name: "mutación", run: cmd });
    });
    const r = rules(mutated);
    expect(r).toContain(expectedRule);
    expect(r).toContain("step-count");
  });

  it("MUTANTE: continue-on-error en un step", () => {
    const mutated = mutate((doc) => {
      steps(doc)[3]["continue-on-error"] = true;
    });
    expect(rules(mutated)).toContain("continue-on-error");
  });

  it("MUTANTE: interpolación de secrets", () => {
    const mutated = mutate((doc) => {
      const jobs = doc.jobs as Record<string, unknown>;
      const job = jobs["db-harness"] as Record<string, unknown>;
      (job.env as Record<string, unknown>).TOKEN = "${{ secrets.SOME_TOKEN }}";
    });
    const r = rules(mutated);
    expect(r).toContain("secrets-interpolation");
    expect(r).toContain("job-env");
  });

  it("MUTANTE: imagen de servicio distinta", () => {
    const mutated = mutate((doc) => {
      const jobs = doc.jobs as Record<string, unknown>;
      const job = jobs["db-harness"] as Record<string, unknown>;
      const svc = job.services as Record<string, unknown>;
      (svc.postgres as Record<string, unknown>).image = "postgres:16";
    });
    const r = rules(mutated);
    expect(r).toContain("service-image");
    expect(r).toContain("postgres-major");
  });

  it("MUTANTE: PostgreSQL distinto de 17", () => {
    const mutated = mutate((doc) => {
      const jobs = doc.jobs as Record<string, unknown>;
      const job = jobs["db-harness"] as Record<string, unknown>;
      const svc = job.services as Record<string, unknown>;
      (svc.postgres as Record<string, unknown>).image = "postgres:18";
    });
    expect(rules(mutated)).toContain("postgres-major");
  });

  it("MUTANTE: action no autorizada", () => {
    const mutated = mutate((doc) => {
      steps(doc).push({ name: "mutación", uses: "some-org/some-action@v1" });
    });
    const r = rules(mutated);
    expect(r).toContain("uses");
    expect(r).toContain("step-count");
  });

  it("MUTANTE: versión de Node distinta", () => {
    const mutated = mutate((doc) => {
      const s = steps(doc).find((x) => String(x.uses).startsWith("actions/setup-node"));
      (s!.with as Record<string, unknown>)["node-version"] = 20;
    });
    expect(rules(mutated)).toContain("node-version");
    expect(REQUIRED_NODE_VERSION).toBe(22);
  });

  it("MUTANTE: variable de entorno adicional", () => {
    const mutated = mutate((doc) => {
      const jobs = doc.jobs as Record<string, unknown>;
      const job = jobs["db-harness"] as Record<string, unknown>;
      (job.env as Record<string, unknown>).EXTRA = "x";
    });
    expect(rules(mutated)).toContain("job-env");
  });

  it("MUTANTE: destino de P3N1A0_TEST_PG_URL cambiado", () => {
    const mutated = mutate((doc) => {
      const jobs = doc.jobs as Record<string, unknown>;
      const job = jobs["db-harness"] as Record<string, unknown>;
      (job.env as Record<string, unknown>).P3N1A0_TEST_PG_URL =
        "postgresql://postgres:postgres@db.example.invalid:5432/postgres";
    });
    expect(rules(mutated)).toContain("job-env");
  });

  it("MUTANTE: disparador por cron", () => {
    const mutated = mutate((doc) => {
      (doc.on as Record<string, unknown>).schedule = [{ cron: "0 * * * *" }];
    });
    expect(rules(mutated)).toContain("schedule");
  });

  it("MUTANTE: permisos ampliados", () => {
    const mutated = mutate((doc) => {
      (doc.permissions as Record<string, unknown>).contents = "write";
    });
    expect(rules(mutated)).toContain("permissions");
  });

  it("MUTANTE: job adicional", () => {
    const mutated = mutate((doc) => {
      (doc.jobs as Record<string, unknown>).otro = { "runs-on": "ubuntu-latest", steps: [] };
    });
    expect(rules(mutated)).toContain("jobs");
  });

  it("MUTANTE: shell explícito en un step", () => {
    const mutated = mutate((doc) => {
      steps(doc)[2].shell = "bash";
    });
    expect(rules(mutated)).toContain("shell");
  });

  it("MUTANTE: comando de bases residuales alterado", () => {
    const mutated = mutate((doc) => {
      steps(doc)[4].run = "node tests/db/scripts/assert-no-residual-databases.mjs --skip";
    });
    expect(rules(mutated)).toContain("run-command");
  });

  it("un YAML inválido produce un hallazgo, no una excepción", () => {
    expect(() => auditWorkflow("::: no es yaml :::")).not.toThrow();
    expect(rules("a:\n  - b\n c: d").length).toBeGreaterThan(0);
  });

  it("la imagen y las constantes declaradas son las esperadas", () => {
    expect(ALLOWED_SERVICE_IMAGE).toBe("postgres:17");
    expect(ALLOWED_JOB_ENV.P3N1A0_TEST_PG_URL).toMatch(/@127\.0\.0\.1:/);
  });
});
