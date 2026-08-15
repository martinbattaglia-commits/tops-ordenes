/**
 * P3-N1A0 · Auditoría de ESQUEMA EXACTO del workflow de CI (H-02, 3ª C4).
 *
 * La versión anterior era una allowlist parcial: rechazaba claves desconocidas
 * pero no validaba los VALORES de `on`, `concurrency`, `timeout-minutes`, el
 * `with` del checkout, el healthcheck del servicio ni el `cache`. Aceptaba, por
 * ejemplo, `with: { ref: <arbitrario> }` en el checkout, un trigger adicional o
 * un `concurrency` cambiado.
 *
 * Ahora el workflow parseado se compara contra una ESTRUCTURA ESPERADA COMPLETA
 * mediante un diff profundo: toda clave extra, faltante o con valor divergente
 * es un hallazgo, con la ruta exacta. La única normalización es colapsar los
 * espacios del bloque `options` del servicio (YAML `>-` pliega saltos de línea).
 *
 * Estrategia de checkout elegida y documentada: CHECKOUT POR COMPORTAMIENTO
 * PREDETERMINADO. El step de checkout NO debe declarar `with` alguno — en
 * particular ningún `ref`. Con el comportamiento por defecto, `actions/checkout`
 * usa el SHA que disparó el evento (el push para `push`, el merge ref para
 * `pull_request`), que es exactamente el commit bajo prueba. Cualquier `with`
 * en el checkout es un hallazgo.
 */

import { parse } from "yaml";

export const WORKFLOW_RELATIVE_PATH = ".github/workflows/p3-n1a0-db-harness.yml";

/** Normaliza el bloque `options` del servicio: colapsa espacios. */
function normOptions(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/** Estructura EXACTA esperada del workflow. */
export const EXPECTED_WORKFLOW = {
  name: "P3-N1A0 · WMS DB Harness",
  on: {
    push: { branches: ["test/p3-n1a0-wms-db-harness"] },
    pull_request: {
      paths: [
        "tests/db/**",
        "supabase/migrations/**",
        "vitest.db.config.ts",
        "package.json",
        "package-lock.json",
        ".github/workflows/p3-n1a0-db-harness.yml",
      ],
    },
  },
  permissions: { contents: "read" },
  concurrency: {
    group: "p3-n1a0-db-harness-${{ github.ref }}",
    "cancel-in-progress": true,
  },
  jobs: {
    "db-harness": {
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 20,
      services: {
        postgres: {
          image: "postgis/postgis:17-3.5",
          env: { POSTGRES_USER: "postgres", POSTGRES_PASSWORD: "postgres", POSTGRES_DB: "postgres" },
          ports: ["5432:5432"],
          options:
            '--health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10',
        },
      },
      env: { P3N1A0_TEST_PG_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres" },
      steps: [
        { name: "Checkout", uses: "actions/checkout@v4" },
        { name: "Setup Node", uses: "actions/setup-node@v4", with: { "node-version": 22, cache: "npm" } },
        { name: "Instalar dependencias desde lockfile", run: "npm ci --no-audit --no-fund" },
        { name: "Ejecutar suite de integracion SQL", run: "npm run test:db" },
        {
          name: "Verificar bases de test residuales",
          if: "always()",
          run: "node tests/db/scripts/assert-no-residual-databases.mjs",
        },
      ],
    },
  },
} as const;

export interface AuditFinding {
  rule: string;
  detail: string;
}

/** Serialización estable para comparar valores primitivos y arrays. */
function repr(v: unknown): string {
  return JSON.stringify(v);
}

/**
 * Diff profundo entre el valor observado y el esperado. Cada divergencia
 * —clave extra, faltante o valor distinto— produce un finding con su ruta.
 */
function deepDiff(actual: unknown, expected: unknown, path: string, out: AuditFinding[]): void {
  // arrays: longitud y orden exactos
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      out.push({ rule: "shape", detail: `${path}: se esperaba una lista` });
      return;
    }
    if (actual.length !== expected.length) {
      out.push({ rule: "array-length", detail: `${path}: ${actual.length} elementos, se esperan ${expected.length}` });
    }
    const n = Math.max(actual.length, expected.length);
    for (let i = 0; i < n; i++) {
      if (i >= expected.length) out.push({ rule: "extra", detail: `${path}[${i}] no autorizado` });
      else if (i >= actual.length) out.push({ rule: "missing", detail: `${path}[${i}] faltante` });
      else deepDiff(actual[i], expected[i], `${path}[${i}]`, out);
    }
    return;
  }

  // objetos: claves exactas
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      out.push({ rule: "shape", detail: `${path}: se esperaba un objeto` });
      return;
    }
    const eObj = expected as Record<string, unknown>;
    const aObj = actual as Record<string, unknown>;
    for (const k of Object.keys(aObj)) {
      if (!(k in eObj)) out.push({ rule: "unknown-key", detail: `${path}.${k} no autorizada` });
    }
    for (const k of Object.keys(eObj)) {
      if (!(k in aObj)) out.push({ rule: "missing-key", detail: `${path}.${k} faltante` });
      else deepDiff(aObj[k], eObj[k], `${path}.${k}`, out);
    }
    return;
  }

  // primitivos: igualdad exacta
  if (repr(actual) !== repr(expected)) {
    out.push({ rule: "value", detail: `${path}: ${repr(actual)} ≠ ${repr(expected)}` });
  }
}

/** Recorre el YAML buscando interpolaciones `secrets.*` a cualquier profundidad. */
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
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) walkForSecrets(v, `${path}.${k}`, out);
  }
}

/** Herramientas y patrones prohibidos en cualquier `run:`. */
export const FORBIDDEN_RUN_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "url-postgres-literal", re: /\bpostgres(ql)?:\/\// },
  { id: "psql", re: /(^|\s|\/)psql(\s|$)/ },
  { id: "curl", re: /(^|\s|\/)curl(\s|$)/ },
  { id: "wget", re: /(^|\s|\/)wget(\s|$)/ },
  { id: "supabase-cli", re: /(^|\s|\/)supabase(\s|$)/ },
  { id: "netlify-cli", re: /(^|\s|\/)netlify(\s|$)/ },
  { id: "deploy", re: /\bdeploy\b/i },
  { id: "db-push", re: /\bdb\s+push\b/i },
  { id: "docker", re: /(^|\s|\/)docker(\s|$)/ },
  { id: "ssh", re: /(^|\s|\/)ssh(\s|$)/ },
];

/**
 * Audita el TEXTO de un workflow. Findings vacíos ⇒ coincide con el esquema
 * autorizado. Función pura: los tests auditan mutantes en memoria.
 */
export function auditWorkflow(yamlText: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  let doc: Record<string, unknown>;
  try {
    doc = parse(yamlText) as Record<string, unknown>;
  } catch (e) {
    return [{ rule: "yaml-parse", detail: e instanceof Error ? e.message : String(e) }];
  }
  if (!doc || typeof doc !== "object") return [{ rule: "yaml-shape", detail: "el documento no es un mapa YAML" }];

  // Normalizar `options` del servicio antes de comparar (YAML `>-` pliega).
  const normalized = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  try {
    const svc = (((normalized.jobs as Record<string, unknown>)["db-harness"] as Record<string, unknown>)
      .services as Record<string, unknown>).postgres as Record<string, unknown>;
    if (svc && "options" in svc) svc.options = normOptions(svc.options);
  } catch {
    /* si la ruta no existe, el diff lo reportará */
  }

  // Diff estructural exacto contra el esquema esperado.
  deepDiff(normalized, EXPECTED_WORKFLOW, "$", findings);

  // Defensa en profundidad, independiente del diff.
  walkForSecrets(doc, "$", findings);
  for (const [i, step] of (
    (((doc.jobs as Record<string, unknown>)?.["db-harness"] as Record<string, unknown>)?.steps as
      | Array<Record<string, unknown>>
      | undefined) ?? []
  ).entries()) {
    if (step.run !== undefined) {
      const cmd = String(step.run).replace(/\s+/g, " ").trim();
      for (const { id, re } of FORBIDDEN_RUN_PATTERNS) {
        if (re.test(cmd)) findings.push({ rule: `forbidden:${id}`, detail: `step ${i}` });
      }
    }
  }

  return findings;
}
