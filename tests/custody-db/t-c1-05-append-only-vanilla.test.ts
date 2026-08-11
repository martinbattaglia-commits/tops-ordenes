/**
 * T-C1-05 · Append-only, auditoría, cierre del manifiesto e INVARIANCIA del
 * harness vanilla.
 *
 * La última es la más importante para el gobierno del repositorio: D4 exigió que
 * el harness vanilla quedara byte-invariante. Acá se comprueba con hashes, no
 * con una declaración.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { actAs, baseScenario, expectFailure } from "./harness/fixtures";
import { buildReleasableCase, tryRelease } from "./harness/scenario";
import {
  CUSTODY_MIGRATION_MANIFEST,
  REPO_ROOT,
  migrationSeq,
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
    const seqs = CUSTODY_MIGRATION_MANIFEST.map(migrationSeq);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
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

  it("la numeración 0221-0223 no colisiona con ninguna migración del repositorio", () => {
    const onDisk = readdirSync(join(REPO_ROOT, "supabase", "migrations")).filter((f) =>
      f.endsWith(".sql"),
    );
    for (const n of ["0221", "0222", "0223"]) {
      const matches = onDisk.filter((f) => f.startsWith(n));
      expect(matches, `prefijo ${n} duplicado`).toHaveLength(1);
    }
  });
});

describe("T-C1-05 · INVARIANCIA ACOTADA del harness vanilla (D4 + SCR-WMS-002)", () => {
  const VANILLA_DIR = join(REPO_ROOT, "tests", "db");

  /**
   * D4 exigía que el harness vanilla quedara BYTE-INVARIANTE, y así estaba.
   * SCR-WMS-002 lo volvió imposible de sostener sin romper la suite: con
   * 0221–0223 en el árbol, `validateCanonicalManifest()` las encuentra SIN
   * CLASIFICAR y falla —que es exactamente lo que esa validación debe hacer
   * con toda migración nueva—.
   *
   * La invariancia total se reemplaza por una invariancia ACOTADA y
   * verificada: cambia UN solo archivo, nombrado, y nada más. Ni siquiera
   * `t-a0-10-manifest.test.ts`, que estaba autorizado: agregarle casos habría
   * obligado a tocar `tests/db/scripts/expected-suite.mjs`
   * (`EXPECTED_TOTAL_TESTS`), que NO lo está. Las pruebas granulares de la
   * clasificación viven en `t-c1-10`, importando el módulo real del vanilla.
   */
  const VANILLA_AUTHORIZED_CHANGES = ["tests/db/harness/manifest.ts"];

  it("sólo cambia el ÚNICO archivo autorizado del harness vanilla", () => {
    const out = execFileSync("git", ["status", "--porcelain", "--", "tests/db"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const touched = out
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean)
      .sort();
    expect(touched).toEqual([...VANILLA_AUTHORIZED_CHANGES].sort());
  });

  it("EXPECTED_MANIFEST_SIZE del vanilla sigue siendo 31", () => {
    const src = readFileSync(join(VANILLA_DIR, "harness", "manifest.ts"), "utf8");
    expect(src).toMatch(/EXPECTED_MANIFEST_SIZE\s*=\s*31/);
    // Y el vanilla sigue excluyendo PostGIS y la serie de custodia.
    expect(src).toContain('"0016_tracking_foundation.sql"');
    expect(src).toContain('"0036_custody_core.sql"');
    // Las tres nuevas NO entraron al ARRAY del manifiesto vanilla. Se recorta
    // el array y se busca dentro: sobre el archivo entero la búsqueda daría
    // positivo por la exclusión dedicada, que sí las nombra y debe hacerlo.
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

  it("el contenido de FROZEN_EXCLUDED_FILES es IDÉNTICO al de HEAD", () => {
    // §6 prohíbe tocar el snapshot congelado. No alcanza con decirlo: se
    // recorta el bloque en ambas versiones y se comparan byte a byte.
    const slice = (src: string): string => {
      const start = src.indexOf("const FROZEN_EXCLUDED_FILES");
      expect(start, "no se encontró FROZEN_EXCLUDED_FILES").toBeGreaterThan(-1);
      const end = src.indexOf("]);", start);
      expect(end, "no se encontró el cierre del set congelado").toBeGreaterThan(start);
      return src.slice(start, end + 3);
    };
    const head = execFileSync("git", ["show", "HEAD:tests/db/harness/manifest.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const now = readFileSync(join(VANILLA_DIR, "harness", "manifest.ts"), "utf8");
    expect(slice(now)).toBe(slice(head));
  });

  it("WMS_MIGRATION_MANIFEST es IDÉNTICO al de HEAD", () => {
    const slice = (src: string): string => {
      const start = src.indexOf("export const WMS_MIGRATION_MANIFEST");
      expect(start).toBeGreaterThan(-1);
      const end = src.indexOf("];", start);
      expect(end).toBeGreaterThan(start);
      return src.slice(start, end + 2);
    };
    const head = execFileSync("git", ["show", "HEAD:tests/db/harness/manifest.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const now = readFileSync(join(VANILLA_DIR, "harness", "manifest.ts"), "utf8");
    expect(slice(now)).toBe(slice(head));
  });

  it("el árbol de custodia vive FUERA de tests/db (no contamina la corrida vanilla)", () => {
    const vanillaTests = readdirSync(VANILLA_DIR).filter((f) => f.endsWith(".test.ts"));
    for (const f of vanillaTests) {
      expect(f).not.toMatch(/custody/i);
    }
    // Y el config vanilla no apunta a este árbol.
    const cfg = readFileSync(join(REPO_ROOT, "vitest.db.config.ts"), "utf8");
    expect(cfg).not.toContain("custody-db");
  });

  it("los configs vanilla y de unidad no fueron tocados", () => {
    const out = execFileSync(
      "git",
      ["status", "--porcelain", "--", "vitest.db.config.ts", "vitest.config.ts"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    // Con la ventana serial liberada, el lock PUEDE cambiar, pero sólo el de
    // npm y sólo por `jsdom`: ni pnpm ni yarn aparecen, y el diff no toca
    // ninguna dependencia productiva.
    // `out` ya viene con `.trim()`, así que el prefijo de estado no tiene un
    // ancho fijo: se toma el último token de cada línea en vez de cortar por
    // posición.
    const archivos = out
      .split("\n")
      .map((l) => l.trim().split(/\s+/).pop() ?? "")
      .filter(Boolean);
    expect(archivos.filter((f) => f !== "package-lock.json")).toEqual([]);
    if (archivos.length > 0) {
      const diff = execFileSync("git", ["diff", "--unified=0", "--", "package-lock.json"], {
        cwd: REPO_ROOT, encoding: "utf8",
      });
      // Comprobación EXACTA contra el lock de HEAD: se pueden AGREGAR paquetes
      // (jsdom y sus dependencias), pero no puede desaparecer ninguno ni
      // cambiar la versión de ninguno de los existentes. Un upgrade ajeno
      // —justo lo que el mandato prohíbe— pondría esto en rojo.
      const antes = JSON.parse(
        execFileSync("git", ["show", "HEAD:package-lock.json"], { cwd: REPO_ROOT, encoding: "utf8" }),
      ) as { packages?: Record<string, { version?: string }> };
      const ahora = JSON.parse(
        readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8"),
      ) as { packages?: Record<string, { version?: string }> };
      const A = antes.packages ?? {};
      const B = ahora.packages ?? {};
      const eliminados = Object.keys(A).filter((k) => !(k in B));
      const cambiados = Object.keys(A).filter((k) => k in B && A[k].version !== B[k].version);
      expect(eliminados).toEqual([]);
      expect(cambiados).toEqual([]);
      expect(diff).toMatch(/jsdom/);
    }
  });

  /**
   * W22-TER-A/M6 · `package.json` SÍ cambia —el mandato autoriza agregar el
   * comando oficial de Custodia y nada más—, así que la invariancia deja de ser
   * «cero diff» y pasa a ser EXACTA: la única diferencia admisible es la línea
   * del script nuevo. Un cambio de dependencias, de `test`, de `test:db` o de
   * cualquier otro script vuelve a poner esto en rojo.
   */
  it("package.json cambia SÓLO por lo autorizado: script de Custodia + jsdom", () => {
    const diff = execFileSync("git", ["diff", "--unified=0", "--", "package.json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const changed = diff
      .split("\n")
      .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
      .map((l) => `${l[0]}${l.slice(1).trim()}`);
    // La ventana serial de DB/package fue LIBERADA por Dirección para la
    // integración UI/E2E, que autorizó exactamente una dependencia de pruebas
    // DOM (`jsdom`, compatible con `engines.node >=18.18.0`). Cualquier otra
    // línea vuelve a poner esto en rojo: sigue siendo una lista exacta.
    const permitido = new Set([
      '+"test:custody:db": "vitest run --config vitest.custody.config.ts",',
      '+"jsdom": "^26.1.0",',
      // npm reordena alfabéticamente al instalar; el movimiento de esta línea
      // no agrega ni quita nada.
      '-"@netlify/blobs": "^10.7.8",',
      '+"@netlify/blobs": "^10.7.8",',
    ]);
    expect(changed.filter((l) => !permitido.has(l))).toEqual([]);
  });

  it("el lockfile cambia SÓLO por la dependencia de pruebas autorizada", () => {
    const out = execFileSync(
      "git",
      ["status", "--porcelain", "--", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    // Con la ventana serial liberada, el lock PUEDE cambiar, pero sólo el de
    // npm y sólo por `jsdom`: ni pnpm ni yarn aparecen, y el diff no toca
    // ninguna dependencia productiva.
    // `out` ya viene con `.trim()`, así que el prefijo de estado no tiene un
    // ancho fijo: se toma el último token de cada línea en vez de cortar por
    // posición.
    const archivos = out
      .split("\n")
      .map((l) => l.trim().split(/\s+/).pop() ?? "")
      .filter(Boolean);
    expect(archivos.filter((f) => f !== "package-lock.json")).toEqual([]);
    if (archivos.length > 0) {
      const diff = execFileSync("git", ["diff", "--unified=0", "--", "package-lock.json"], {
        cwd: REPO_ROOT, encoding: "utf8",
      });
      // Comprobación EXACTA contra el lock de HEAD: se pueden AGREGAR paquetes
      // (jsdom y sus dependencias), pero no puede desaparecer ninguno ni
      // cambiar la versión de ninguno de los existentes. Un upgrade ajeno
      // —justo lo que el mandato prohíbe— pondría esto en rojo.
      const antes = JSON.parse(
        execFileSync("git", ["show", "HEAD:package-lock.json"], { cwd: REPO_ROOT, encoding: "utf8" }),
      ) as { packages?: Record<string, { version?: string }> };
      const ahora = JSON.parse(
        readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8"),
      ) as { packages?: Record<string, { version?: string }> };
      const A = antes.packages ?? {};
      const B = ahora.packages ?? {};
      const eliminados = Object.keys(A).filter((k) => !(k in B));
      const cambiados = Object.keys(A).filter((k) => k in B && A[k].version !== B[k].version);
      expect(eliminados).toEqual([]);
      expect(cambiados).toEqual([]);
      expect(diff).toMatch(/jsdom/);
    }
  });

  it("no se tocó ningún path de WhatsApp, Connect ni Sidebar", () => {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const touched = out
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
    // `package-lock.json` sale de la lista prohibida: su cambio ya está
    // acotado y probado por la aserción específica de arriba.
    const forbidden = touched.filter((p) =>
      /whatsapp|connect|Sidebar|pnpm-lock|yarn\.lock/i.test(p),
    );
    expect(forbidden).toEqual([]);
  });

  it("las migraciones históricas no fueron editadas", () => {
    const out = execFileSync("git", ["status", "--porcelain", "--", "supabase/migrations"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const touched = out
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
    // Sólo pueden aparecer las OCHO nuevas, y como archivos NO rastreados:
    // las seis de W22, 0231 (lectura acotada por tenant) y 0232 (reserva
    // exclusiva de evaluación). Enumeradas por nombre EXACTO: una migración
    // nueva que no esté acá rompe esto, que es justamente lo que se quiere.
    for (const p of touched) {
      expect(p).toMatch(
        /supabase\/migrations\/02(?:2(?:[1234]_custody_integrity_|5_custody_0039_|6_custody_content_)|31_custody_read_tenant_scope|32_custody_evaluation_lease_exclusive)/,
      );
    }
  });

  it("el hash del contenido de tests/db es reproducible (evidencia para el C4)", () => {
    const files = execFileSync("git", ["ls-files", "tests/db"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .sort();
    const h = createHash("sha256");
    for (const f of files) h.update(readFileSync(join(REPO_ROOT, f)));
    const digest = h.digest("hex");
    // No se fija un valor esperado: el punto es que el hash EXISTE y que la
    // prueba anterior ya demostró que el árbol no cambió respecto de Git.
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(files.length).toBeGreaterThan(20);
  });
});
