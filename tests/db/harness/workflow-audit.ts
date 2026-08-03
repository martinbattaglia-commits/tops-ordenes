/**
 * P3-N1A0 · Auditoría ESTRUCTURAL y FAIL-CLOSED del workflow de CI (H-03).
 *
 * La segunda revisión C4 mostró que la versión anterior aceptaba mutaciones
 * peligrosas con `findings=[]`: `if: false` en un step, `container` a nivel job,
 * `env` remoto de workflow, cambio de puertos del servicio, variables extra del
 * servicio, `working-directory` en steps, `permissions: {}`. El auditor miraba
 * sólo lo que conocía e ignoraba lo demás.
 *
 * Ahora es una VALIDACIÓN DE ESQUEMA EXACTO: se enumeran las claves permitidas
 * en cada nivel y CUALQUIER clave desconocida es un hallazgo. Todo lo que no
 * está explícitamente autorizado rompe la auditoría — allowlist, no denylist.
 */

import { parse } from "yaml";

export const WORKFLOW_RELATIVE_PATH = ".github/workflows/p3-n1a0-db-harness.yml";

export const ALLOWED_USES: readonly string[] = [
  "actions/checkout@v4",
  "actions/setup-node@v4",
];
export const ALLOWED_SERVICE_IMAGE = "postgres:17";
export const REQUIRED_NODE_VERSION = 22;
export const REQUIRED_POSTGRES_MAJOR = "17";

export const ALLOWED_STEP_NAMES: readonly string[] = [
  "Checkout",
  "Setup Node",
  "Instalar dependencias desde lockfile",
  "Ejecutar suite de integracion SQL",
  "Verificar bases de test residuales",
];

export const ALLOWED_RUN_COMMANDS: readonly string[] = [
  "npm ci --no-audit --no-fund",
  "npm run test:db",
  "node tests/db/scripts/assert-no-residual-databases.mjs",
];

export const ALLOWED_JOB_ENV: Readonly<Record<string, string>> = {
  P3N1A0_TEST_PG_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
};

export const ALLOWED_PERMISSIONS: Readonly<Record<string, string>> = {
  contents: "read",
};

/** Puertos y env del servicio postgres, exactos. */
export const ALLOWED_SERVICE_PORTS: readonly string[] = ["5432:5432"];
export const ALLOWED_SERVICE_ENV: Readonly<Record<string, string>> = {
  POSTGRES_USER: "postgres",
  POSTGRES_PASSWORD: "postgres",
  POSTGRES_DB: "postgres",
};

// ── Claves permitidas por nivel (allowlist estructural) ────────────────────
const TOP_KEYS = new Set(["name", "on", "permissions", "concurrency", "jobs"]);
const JOB_KEYS = new Set(["runs-on", "timeout-minutes", "services", "env", "steps"]);
const STEP_KEYS = new Set(["name", "uses", "with", "run", "if"]); // `if` sólo con valor exacto
const SERVICE_KEYS = new Set(["image", "env", "ports", "options"]);

export const FORBIDDEN_RUN_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "url-postgres-literal", re: /\bpostgres(ql)?:\/\// },
  { id: "psql", re: /(^|\s|\/)psql(\s|$)/ },
  { id: "curl", re: /(^|\s|\/)curl(\s|$)/ },
  { id: "wget", re: /(^|\s|\/)wget(\s|$)/ },
  { id: "supabase-cli", re: /(^|\s|\/)supabase(\s|$)/ },
  { id: "netlify-cli", re: /(^|\s|\/)netlify(\s|$)/ },
  { id: "deploy", re: /\bdeploy\b/i },
  { id: "db-push", re: /\bdb\s+push\b/i },
  { id: "apply-migration", re: /apply_migration/i },
  { id: "terraform", re: /(^|\s|\/)terraform(\s|$)/ },
  { id: "kubectl", re: /(^|\s|\/)kubectl(\s|$)/ },
  { id: "docker", re: /(^|\s|\/)docker(\s|$)/ },
  { id: "aws-cli", re: /(^|\s|\/)aws(\s|$)/ },
  { id: "gcloud", re: /(^|\s|\/)gcloud(\s|$)/ },
  { id: "ssh", re: /(^|\s|\/)ssh(\s|$)/ },
  { id: "nc", re: /(^|\s|\/)(nc|netcat)(\s|$)/ },
];

export function normalizeCommand(cmd: string): string {
  return cmd.replace(/\s+/g, " ").trim();
}

export interface AuditFinding {
  rule: string;
  detail: string;
}

function walkForKey(node: unknown, key: string, path: string, out: AuditFinding[]): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkForKey(v, key, `${path}[${i}]`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === key) out.push({ rule: key, detail: `en ${path} (valor: ${String(v)})` });
      walkForKey(v, key, `${path}.${k}`, out);
    }
  }
}

function walkForSecrets(node: unknown, path: string, out: AuditFinding[]): void {
  if (typeof node === "string") {
    if (/\$\{\{[^}]*secrets\./.test(node)) out.push({ rule: "secrets-interpolation", detail: `en ${path}` });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkForSecrets(v, `${path}[${i}]`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walkForSecrets(v, `${path}.${k}`, out);
    }
  }
}

/** Marca como hallazgo toda clave de `obj` que no esté en `allowed`. */
function unknownKeys(
  obj: Record<string, unknown> | undefined,
  allowed: Set<string>,
  where: string,
  out: AuditFinding[],
): void {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) out.push({ rule: "unknown-key", detail: `${where}.${k} no autorizada` });
  }
}

export function auditWorkflow(yamlText: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  let doc: Record<string, unknown>;
  try {
    doc = parse(yamlText) as Record<string, unknown>;
  } catch (e) {
    return [{ rule: "yaml-parse", detail: e instanceof Error ? e.message : String(e) }];
  }
  if (!doc || typeof doc !== "object") {
    return [{ rule: "yaml-shape", detail: "el documento no es un mapa YAML" }];
  }

  // Reglas transversales, a cualquier profundidad.
  walkForSecrets(doc, "$", findings);
  walkForKey(doc, "continue-on-error", "$", findings);
  walkForKey(doc, "container", "$", findings); // ningún job/step puede usar container
  walkForKey(doc, "working-directory", "$", findings);
  walkForKey(doc, "defaults", "$", findings);
  walkForKey(doc, "uses-with-token", "$", findings);

  // ── nivel superior: sólo claves conocidas ──
  unknownKeys(doc, TOP_KEYS, "$", findings);

  // permisos: exactos
  const permissions = doc.permissions as Record<string, unknown> | undefined;
  if (!permissions || typeof permissions !== "object" || Object.keys(permissions).length === 0) {
    findings.push({ rule: "permissions", detail: "faltan permisos explícitos (permissions vacío o ausente)" });
  } else {
    unknownKeys(permissions, new Set(Object.keys(ALLOWED_PERMISSIONS)), "permissions", findings);
    for (const [k, v] of Object.entries(ALLOWED_PERMISSIONS)) {
      if (String(permissions[k]) !== v) findings.push({ rule: "permissions", detail: `${k} debe ser ${v}` });
    }
  }

  // disparadores: sin cron
  const on = doc.on as Record<string, unknown> | undefined;
  if (on && typeof on === "object" && "schedule" in on) {
    findings.push({ rule: "schedule", detail: "el workflow no debe correr por cron" });
  }

  // ── jobs ──
  const jobs = doc.jobs as Record<string, unknown> | undefined;
  if (!jobs || typeof jobs !== "object") return [...findings, { rule: "jobs", detail: "no hay jobs" }];
  const jobNames = Object.keys(jobs);
  if (jobNames.length !== 1 || jobNames[0] !== "db-harness") {
    findings.push({ rule: "jobs", detail: `jobs inesperados: ${jobNames.join(", ")}` });
  }
  const job = jobs["db-harness"] as Record<string, unknown> | undefined;
  if (!job) return [...findings, { rule: "jobs", detail: "falta el job db-harness" }];

  unknownKeys(job, JOB_KEYS, "job", findings);

  if (job["runs-on"] !== "ubuntu-latest") {
    findings.push({ rule: "runs-on", detail: `runs-on="${String(job["runs-on"])}" no autorizado` });
  }

  // ── servicios ──
  const services = job.services as Record<string, unknown> | undefined;
  if (!services || typeof services !== "object") {
    findings.push({ rule: "services", detail: "falta el servicio postgres" });
  } else {
    const svcNames = Object.keys(services);
    if (svcNames.length !== 1 || svcNames[0] !== "postgres") {
      findings.push({ rule: "services", detail: `servicios inesperados: ${svcNames.join(", ")}` });
    }
    const pg = services.postgres as Record<string, unknown> | undefined;
    unknownKeys(pg, SERVICE_KEYS, "services.postgres", findings);
    if (pg?.image !== ALLOWED_SERVICE_IMAGE) {
      findings.push({ rule: "service-image", detail: `imagen "${String(pg?.image)}" ≠ "${ALLOWED_SERVICE_IMAGE}"` });
    }
    // puertos exactos
    const ports = (pg?.ports ?? []) as unknown[];
    const portStrs = ports.map(String).sort();
    if (JSON.stringify(portStrs) !== JSON.stringify([...ALLOWED_SERVICE_PORTS].sort())) {
      findings.push({ rule: "service-ports", detail: `puertos ${portStrs.join(",")} no autorizados` });
    }
    // env del servicio exacto
    const svcEnv = (pg?.env ?? {}) as Record<string, unknown>;
    unknownKeys(svcEnv, new Set(Object.keys(ALLOWED_SERVICE_ENV)), "services.postgres.env", findings);
    for (const [k, v] of Object.entries(ALLOWED_SERVICE_ENV)) {
      if (String(svcEnv[k]) !== v) findings.push({ rule: "service-env", detail: `${k} no autorizado` });
    }
  }

  // ── env del job: exacto ──
  const jobEnv = (job.env ?? {}) as Record<string, unknown>;
  unknownKeys(jobEnv, new Set(Object.keys(ALLOWED_JOB_ENV)), "job.env", findings);
  for (const [k, v] of Object.entries(ALLOWED_JOB_ENV)) {
    if (String(jobEnv[k]) !== v) findings.push({ rule: "job-env", detail: `valor no autorizado para ${k}` });
  }

  // ── steps: cantidad, orden, claves y valores exactos ──
  const steps = job.steps as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(steps)) return [...findings, { rule: "steps", detail: "el job no declara steps" }];

  const names = steps.map((s) => String(s.name ?? "<sin nombre>"));
  if (names.length !== ALLOWED_STEP_NAMES.length) {
    findings.push({ rule: "step-count", detail: `${names.length} steps; se autorizan ${ALLOWED_STEP_NAMES.length}` });
  }
  names.forEach((n, i) => {
    if (ALLOWED_STEP_NAMES[i] !== n) {
      findings.push({ rule: "step-name", detail: `step ${i}: "${n}" no autorizado` });
    }
  });

  for (const [i, step] of steps.entries()) {
    unknownKeys(step, STEP_KEYS, `step[${i}]`, findings);

    // `if` sólo se admite con valores de una allowlist estricta: `true` (corre
    // siempre) o `always()` (corre incluso tras un fallo previo, necesario para
    // el paso de bases residuales). CUALQUIER otro valor —`false`, `success()`,
    // una expresión— se rechaza, porque podría DESACTIVAR el step (H-03).
    if ("if" in step) {
      const cond = String(step.if).trim().toLowerCase();
      if (cond !== "true" && cond !== "always()") {
        findings.push({ rule: "step-if", detail: `step ${i}: if=${String(step.if)} no autorizado` });
      }
    }

    const uses = step.uses;
    if (uses !== undefined) {
      if (!ALLOWED_USES.includes(String(uses))) {
        findings.push({ rule: "uses", detail: `step ${i}: "${String(uses)}" no autorizado` });
      }
      if (String(uses).startsWith("actions/setup-node")) {
        const w = (step.with ?? {}) as Record<string, unknown>;
        unknownKeys(w, new Set(["node-version", "cache"]), `step[${i}].with`, findings);
        if (Number(w["node-version"]) !== REQUIRED_NODE_VERSION) {
          findings.push({ rule: "node-version", detail: `node-version=${String(w["node-version"])} ≠ ${REQUIRED_NODE_VERSION}` });
        }
      }
    }

    const runRaw = step.run;
    if (runRaw !== undefined) {
      const cmd = normalizeCommand(String(runRaw));
      if (!ALLOWED_RUN_COMMANDS.includes(cmd)) {
        findings.push({ rule: "run-command", detail: `step ${i}: comando no autorizado` });
      }
      for (const { id, re } of FORBIDDEN_RUN_PATTERNS) {
        if (re.test(cmd)) findings.push({ rule: `forbidden:${id}`, detail: `step ${i}` });
      }
    }

    if (uses === undefined && runRaw === undefined) {
      findings.push({ rule: "step-shape", detail: `step ${i}: sin uses ni run` });
    }
  }

  // ── PostgreSQL 17 en la imagen ──
  const pg2 = (job.services as Record<string, unknown> | undefined)?.postgres as
    | Record<string, unknown>
    | undefined;
  const tag = String(pg2?.image ?? "").split(":")[1] ?? "";
  if (tag !== REQUIRED_POSTGRES_MAJOR) {
    findings.push({ rule: "postgres-major", detail: `tag "${tag}" ≠ "${REQUIRED_POSTGRES_MAJOR}"` });
  }

  return findings;
}
