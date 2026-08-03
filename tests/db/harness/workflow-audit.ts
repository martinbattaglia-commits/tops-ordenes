/**
 * P3-N1A0 · Auditoría ESTRUCTURAL del workflow de CI (M-04).
 *
 * La versión anterior hacía búsquedas de texto sobre el propio archivo y era
 * auto-referencial: para prohibir un literal, el patrón tenía que contenerlo.
 * Además sólo miraba unos pocos nombres, de modo que un paso remoto genérico
 * (`psql` contra un host externo, `curl`, un `uses:` arbitrario) pasaba.
 *
 * Ahora el YAML se PARSEA como estructura y se compara contra una ALLOWLIST
 * ESTRICTA: todo lo que no está explícitamente autorizado hace fallar la
 * auditoría. Es fail-closed: agregar un step, un `uses`, un servicio o una
 * variable exige autorizarlo en este archivo, y ese cambio queda en el diff.
 */

import { parse } from "yaml";

export const WORKFLOW_RELATIVE_PATH = ".github/workflows/p3-n1a0-db-harness.yml";

/** Actions autorizadas, por referencia exacta. */
export const ALLOWED_USES: readonly string[] = [
  "actions/checkout@v4",
  "actions/setup-node@v4",
];

/** Imagen de servicio autorizada, exacta. */
export const ALLOWED_SERVICE_IMAGE = "postgres:17";

/** Versiones fijadas. */
export const REQUIRED_NODE_VERSION = 22;
export const REQUIRED_POSTGRES_MAJOR = "17";

/** Nombres de step autorizados, en orden exacto. */
export const ALLOWED_STEP_NAMES: readonly string[] = [
  "Checkout",
  "Setup Node",
  "Instalar dependencias desde lockfile",
  "Ejecutar suite de integracion SQL",
  "Verificar bases de test residuales",
];

/** Comandos `run:` autorizados, normalizados (colapso de espacios + trim). */
export const ALLOWED_RUN_COMMANDS: readonly string[] = [
  "npm ci --no-audit --no-fund",
  "npm run test:db",
  "node tests/db/scripts/assert-no-residual-databases.mjs",
];

/** Variables de entorno autorizadas a nivel job, con su valor exacto. */
export const ALLOWED_JOB_ENV: Readonly<Record<string, string>> = {
  P3N1A0_TEST_PG_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
};

/** Permisos de GitHub autorizados. */
export const ALLOWED_PERMISSIONS: Readonly<Record<string, string>> = {
  contents: "read",
};

/**
 * Herramientas y patrones prohibidos en cualquier `run:`. Se evalúan sobre el
 * comando normalizado, NO sobre el archivo, de modo que este módulo puede
 * nombrarlos sin auto-marcarse.
 */
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

/** Normaliza un comando: colapsa espacios y recorta. */
export function normalizeCommand(cmd: string): string {
  return cmd.replace(/\s+/g, " ").trim();
}

export interface AuditFinding {
  rule: string;
  detail: string;
}

/** Recorre recursivamente el YAML buscando interpolaciones `secrets.*`. */
function findSecretsInterpolations(node: unknown, path: string, out: AuditFinding[]): void {
  if (typeof node === "string") {
    if (/\$\{\{[^}]*secrets\./.test(node)) {
      out.push({ rule: "secrets-interpolation", detail: `en ${path}` });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => findSecretsInterpolations(v, `${path}[${i}]`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      findSecretsInterpolations(v, `${path}.${k}`, out);
    }
  }
}

/** Recorre el YAML buscando `continue-on-error` en cualquier nivel. */
function findContinueOnError(node: unknown, path: string, out: AuditFinding[]): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => findContinueOnError(v, `${path}[${i}]`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "continue-on-error") {
        out.push({ rule: "continue-on-error", detail: `en ${path} (valor: ${String(v)})` });
      }
      findContinueOnError(v, `${path}.${k}`, out);
    }
  }
}

/**
 * Audita el contenido de un workflow. Devuelve la lista de hallazgos: vacía
 * significa que el workflow está dentro del alcance autorizado.
 *
 * Función pura sobre el TEXTO del YAML: los tests pueden auditar mutantes en
 * memoria sin escribir archivos en el árbol Git.
 */
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

  // ── secretos y continue-on-error, en cualquier nivel ─────────────────────
  findSecretsInterpolations(doc, "$", findings);
  findContinueOnError(doc, "$", findings);

  // ── permisos ─────────────────────────────────────────────────────────────
  const permissions = doc.permissions as Record<string, unknown> | undefined;
  if (!permissions || typeof permissions !== "object") {
    findings.push({ rule: "permissions", detail: "faltan permisos explícitos" });
  } else {
    for (const [k, v] of Object.entries(permissions)) {
      if (ALLOWED_PERMISSIONS[k] !== String(v)) {
        findings.push({ rule: "permissions", detail: `permiso no autorizado ${k}=${String(v)}` });
      }
    }
  }

  // ── disparadores: sin cron ───────────────────────────────────────────────
  const on = doc.on as Record<string, unknown> | undefined;
  if (on && typeof on === "object" && "schedule" in on) {
    findings.push({ rule: "schedule", detail: "el workflow no debe correr por cron" });
  }

  // ── jobs ─────────────────────────────────────────────────────────────────
  const jobs = doc.jobs as Record<string, unknown> | undefined;
  if (!jobs || typeof jobs !== "object") {
    return [...findings, { rule: "jobs", detail: "no hay jobs" }];
  }
  const jobNames = Object.keys(jobs);
  if (jobNames.length !== 1 || jobNames[0] !== "db-harness") {
    findings.push({ rule: "jobs", detail: `jobs inesperados: ${jobNames.join(", ")}` });
  }

  const job = jobs["db-harness"] as Record<string, unknown> | undefined;
  if (!job) return [...findings, { rule: "jobs", detail: "falta el job db-harness" }];

  // ── servicios ────────────────────────────────────────────────────────────
  const services = job.services as Record<string, unknown> | undefined;
  if (!services || typeof services !== "object") {
    findings.push({ rule: "services", detail: "falta el servicio postgres" });
  } else {
    const svcNames = Object.keys(services);
    if (svcNames.length !== 1 || svcNames[0] !== "postgres") {
      findings.push({ rule: "services", detail: `servicios inesperados: ${svcNames.join(", ")}` });
    }
    const pg = services.postgres as Record<string, unknown> | undefined;
    const image = pg?.image;
    if (image !== ALLOWED_SERVICE_IMAGE) {
      findings.push({
        rule: "service-image",
        detail: `imagen "${String(image)}" ≠ "${ALLOWED_SERVICE_IMAGE}"`,
      });
    }
  }

  // ── env del job ──────────────────────────────────────────────────────────
  const jobEnv = (job.env ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(jobEnv)) {
    if (!(k in ALLOWED_JOB_ENV)) {
      findings.push({ rule: "job-env", detail: `variable no autorizada: ${k}` });
    } else if (String(v) !== ALLOWED_JOB_ENV[k]) {
      findings.push({ rule: "job-env", detail: `valor no autorizado para ${k}` });
    }
  }
  for (const k of Object.keys(ALLOWED_JOB_ENV)) {
    if (!(k in jobEnv)) findings.push({ rule: "job-env", detail: `falta la variable ${k}` });
  }

  // ── steps ────────────────────────────────────────────────────────────────
  const steps = job.steps as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(steps)) {
    return [...findings, { rule: "steps", detail: "el job no declara steps" }];
  }

  const names = steps.map((s) => String(s.name ?? "<sin nombre>"));
  if (names.length !== ALLOWED_STEP_NAMES.length) {
    findings.push({
      rule: "step-count",
      detail: `${names.length} steps; se autorizan ${ALLOWED_STEP_NAMES.length}`,
    });
  }
  names.forEach((n, i) => {
    if (ALLOWED_STEP_NAMES[i] !== n) {
      findings.push({
        rule: "step-name",
        detail: `step ${i}: "${n}" no autorizado (se esperaba "${ALLOWED_STEP_NAMES[i] ?? "<ninguno>"}")`,
      });
    }
  });

  for (const [i, step] of steps.entries()) {
    const uses = step.uses;
    if (uses !== undefined) {
      if (!ALLOWED_USES.includes(String(uses))) {
        findings.push({ rule: "uses", detail: `step ${i}: "${String(uses)}" no autorizado` });
      }
      if (String(uses).startsWith("actions/setup-node")) {
        const w = (step.with ?? {}) as Record<string, unknown>;
        if (Number(w["node-version"]) !== REQUIRED_NODE_VERSION) {
          findings.push({
            rule: "node-version",
            detail: `node-version=${String(w["node-version"])} ≠ ${REQUIRED_NODE_VERSION}`,
          });
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
        if (re.test(cmd)) {
          findings.push({ rule: `forbidden:${id}`, detail: `step ${i}` });
        }
      }
      if (step.shell !== undefined) {
        findings.push({ rule: "shell", detail: `step ${i}: shell explícito no autorizado` });
      }
    }

    if (uses === undefined && runRaw === undefined) {
      findings.push({ rule: "step-shape", detail: `step ${i}: sin uses ni run` });
    }
  }

  // ── PostgreSQL 17 en la imagen del servicio ──────────────────────────────
  const pg = (job.services as Record<string, unknown> | undefined)?.postgres as
    | Record<string, unknown>
    | undefined;
  const tag = String(pg?.image ?? "").split(":")[1] ?? "";
  if (tag !== REQUIRED_POSTGRES_MAJOR) {
    findings.push({ rule: "postgres-major", detail: `tag "${tag}" ≠ "${REQUIRED_POSTGRES_MAJOR}"` });
  }

  return findings;
}
