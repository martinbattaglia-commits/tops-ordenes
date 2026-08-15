/**
 * L4 · CATÁLOGO DE LINAJE — invariantes y MUTANTES NEGATIVOS.
 *
 * El catálogo es lo único que impide que el linaje vuelva a romperse en
 * silencio, así que cada invariante se prueba con un mutante que la viola: si
 * el verificador dejara de detectarlo, el test cae en rojo.
 *
 * Todos los mutantes operan sobre copias en memoria y sobre un directorio
 * temporal FUERA del repositorio. Ninguno toca `supabase/migrations/`.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  APPLIED_REMOTE_ARCHIVE,
  cargarCatalogo,
  motivoFilenameInvalido,
  verificarCatalogo,
} from "../../supabase/lineage/verify.mjs";
import {
  construirPlan,
  hayEvidenciaLedger,
  matchearLedger,
  serializar,
} from "../../supabase/lineage/simulate-backfill.mjs";
import { symlinkSync } from "node:fs";

const REAL = cargarCatalogo();
const DIR = join(process.cwd(), "supabase", "migrations");

/** Copia profunda: los mutantes no pueden contaminarse entre sí. */
const clon = (): typeof REAL => JSON.parse(JSON.stringify(REAL));

/** Espejo del directorio real en un temporal, para mutar el DISCO sin tocar el repo. */
const temporales: string[] = [];
function espejo(): string {
  const d = mkdtempSync(join(tmpdir(), "lineage-mut-"));
  temporales.push(d);
  mkdirSync(join(d, "m"));
  for (const f of readdirSync(DIR)) copyFileSync(join(DIR, f), join(d, "m", f));
  return join(d, "m");
}
afterAll(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });

const codigos = (v: Array<{ codigo: string }>) => v.map((x) => x.codigo);

/** Busca por filename y falla con un mensaje útil si no está. */
function entrada(filename: string) {
  const e = REAL.entries.find((x) => x.filename === filename);
  if (!e) throw new Error(`el catálogo no tiene ${filename}`);
  return e;
}

describe("T-C4-01 · el catálogo real está sano", () => {
  it("no tiene ninguna violación", () => {
    expect(verificarCatalogo()).toEqual([]);
  });

  it("la identidad es el filename completo, no el prefijo", () => {
    for (const e of REAL.entries) expect(e.id).toBe(e.filename);
    // Los seis prefijos duplicados conviven porque la identidad es el nombre.
    for (const p of ["0052", "0053", "0056", "0057", "0058", "0059"]) {
      const mismos = REAL.entries.filter((e) => e.filename.startsWith(`${p}_`));
      expect(mismos).toHaveLength(2);
      expect(new Set(mismos.map((e) => e.ledger_version)).size).toBe(2);
    }
  });

  it("`ledger_version` es único en todo el catálogo", () => {
    const v = REAL.entries.map((e) => e.ledger_version);
    expect(new Set(v).size).toBe(v.length);
  });

  it("0061 está superseded por la cadena 0086/0087 y no se ejecuta", () => {
    const e = entrada("0061_mi_espacio_permission.sql");
    expect(e.estado).toBe("superseded");
    expect(e.superseded_by).toBe("0087_mi_espacio_permission_and_grant.sql");
  });

  it("0061a tiene posición explícita y 0062 depende de ella", () => {
    const a = entrada("0061a_rrhh_modalidad_real.sql");
    const b = entrada("0062_rrhh_carga_inicial.sql");
    expect(a.estado).toBe("active");
    expect(b.requires).toContain(a.filename);
    expect(a.orden).toBeLessThan(b.orden);
  });

  it("0176 está superseded por una correctiva forward-only", () => {
    const e = entrada("0176_knowledge_docs_projection.sql");
    expect(e.estado).toBe("superseded");
    const cor = entrada(e.superseded_by as string);
    expect(cor.estado).toBe("corrective");
    // La correctiva ocupa el lugar del histórico: los dependientes la ven.
    expect(cor.orden).toBeGreaterThan(e.orden);
  });

  it("los scripts de rollback nunca son ejecutables", () => {
    for (const f of [
      "0083_cash_box_rollback.sql",
      "0091_prospeccion_rollback.sql",
      "ROLLBACK_0233_wa_make_relay_outbox.sql",
    ]) {
      expect(entrada(f).estado).toBe("rollback");
    }
  });

  it("0221-0226, 0231 y 0232 son Custodia ejecutable, después de su base 0036-0039", () => {
    // Antes se afirmaba que Custodia quedaba «al final» del catálogo. Dejó de
    // ser cierto —y de ser el invariante— cuando el árbol integró las
    // migraciones de WhatsApp 0227-0230 y 0233: el orden es por FILENAME, así
    // que los dominios se intercalan por número. Lo que sí tiene que valer es
    // que Custodia sea ejecutable y venga después de la serie que la sostiene.
    const custodia = REAL.entries.filter((e) => /^02(2[1-6]|3[12])_/.test(e.filename));
    expect(custodia).toHaveLength(8);
    const base = entrada("0039_custody_pod_reads.sql");
    for (const e of custodia) {
      expect(e.estado, e.filename).toBe("active");
      expect(e.orden, `${e.filename} después de 0039`).toBeGreaterThan(base.orden);
    }
    // Y entre ellas, el orden del catálogo respeta el del filename.
    const porOrden = [...custodia].sort((a, b) => a.orden - b.orden).map((e) => e.filename);
    expect(porOrden).toEqual([...custodia].map((e) => e.filename).sort());
  });

  it("APPLIED_REMOTE_ARCHIVE (0205-0218) no está ni en el catálogo ni en el árbol", () => {
    expect(APPLIED_REMOTE_ARCHIVE).toHaveLength(14);
    for (const e of REAL.entries) {
      expect(APPLIED_REMOTE_ARCHIVE).not.toContain(e.filename.slice(0, 4));
    }
    for (const f of readdirSync(DIR)) {
      expect(APPLIED_REMOTE_ARCHIVE).not.toContain(f.slice(0, 4));
    }
  });
});

describe("T-C4-01 · MUTANTES NEGATIVOS: cada invariante falla cuando se la viola", () => {
  it("filename desconocido en el árbol → NO_CATALOGADA", () => {
    const dir = espejo();
    writeFileSync(join(dir, "9999_intruso.sql"), "select 1;");
    expect(codigos(verificarCatalogo({ dirMigraciones: dir }))).toContain("NO_CATALOGADA");
  });

  it("checksum cambiado → CHECKSUM_CAMBIADO", () => {
    const c = clon();
    c.entries[10].sha256 = "0".repeat(64);
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("CHECKSUM_CAMBIADO");
  });

  it("id duplicado → ID_DUPLICADO", () => {
    const c = clon();
    c.entries.push(JSON.parse(JSON.stringify(c.entries[3])));
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("ID_DUPLICADO");
  });

  it("ledger_version duplicada → LEDGER_VERSION_DUPLICADA", () => {
    const c = clon();
    c.entries[5].ledger_version = c.entries[4].ledger_version;
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("LEDGER_VERSION_DUPLICADA");
  });

  it("dependencia ausente → DEPENDENCIA_AUSENTE", () => {
    const c = clon();
    c.entries[20].requires = ["0000_no_existe.sql"];
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("DEPENDENCIA_AUSENTE");
  });

  it("dependencia POSTERIOR → DEPENDENCIA_POSTERIOR (el defecto 0061→0086)", () => {
    const c = clon();
    const i = c.entries.findIndex((e) => e.filename === "0062_rrhh_carga_inicial.sql");
    c.entries[i].requires = [c.entries[c.entries.length - 1].filename];
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("DEPENDENCIA_POSTERIOR");
  });

  it("dependencia no ejecutable → DEPENDENCIA_NO_EJECUTABLE", () => {
    const c = clon();
    const i = c.entries.findIndex((e) => e.filename === "0106_prospeccion_qualification.sql");
    c.entries[i].requires = ["0091_prospeccion_rollback.sql"];
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("DEPENDENCIA_NO_EJECUTABLE");
  });

  it("ciclo → CICLO", () => {
    const c = clon();
    const a = c.entries[30], b = c.entries[31];
    a.requires = [b.filename]; b.requires = [a.filename];
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("CICLO");
  });

  it("migración catalogada pero ausente del árbol → CATALOGADA_AUSENTE", () => {
    const c = clon();
    c.entries[15].filename = "0000_borrada.sql";
    c.entries[15].id = "0000_borrada.sql";
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("CATALOGADA_AUSENTE");
  });

  it("reingreso de 0205-0218 al CATÁLOGO → APPLIED_REMOTE_ARCHIVE_EN_CATALOGO", () => {
    const c = clon();
    c.entries.push({
      id: "0205_connect_membership_notifications.sql",
      filename: "0205_connect_membership_notifications.sql",
      sha256: "0".repeat(64), orden: 99999, requires: [],
      estado: "active", ledger_version: "L99999",
      ledger_name: "0205_connect_membership_notifications", provenance: "repo",
    });
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("APPLIED_REMOTE_ARCHIVE_EN_CATALOGO");
  });

  it("reingreso de 0205-0218 al ÁRBOL → APPLIED_REMOTE_ARCHIVE_EN_ARBOL", () => {
    const dir = espejo();
    writeFileSync(join(dir, "0210_caja_chica_multimoneda.sql"), "select 1;");
    expect(codigos(verificarCatalogo({ dirMigraciones: dir })))
      .toContain("APPLIED_REMOTE_ARCHIVE_EN_ARBOL");
  });

  it("superseded sin reemplazo declarado → SUPERSEDED_SIN_REEMPLAZO", () => {
    const c = clon();
    const i = c.entries.findIndex((e) => e.estado === "superseded");
    delete c.entries[i].superseded_by;
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("SUPERSEDED_SIN_REEMPLAZO");
  });
});


describe("T-C4-01 · ORDEN: una sola fuente para dependencias y replay", () => {
  it("el catálogo real tiene orden entero, único, contiguo y = posición del array", () => {
    REAL.entries.forEach((e, i) => {
      expect(Number.isInteger(e.orden)).toBe(true);
      expect(e.orden).toBe(i + 1);
    });
  });

  it("MUTANTE · hueco en la numeración → ORDEN_NO_CONTIGUO", () => {
    const c = clon();
    for (let i = 40; i < c.entries.length; i += 1) c.entries[i].orden += 1;
    const cods = codigos(verificarCatalogo({ catalogo: c }));
    expect(cods).toContain("ORDEN_NO_CONTIGUO");
    expect(cods).toContain("ORDEN_INCOHERENTE_CON_ARRAY");
  });

  it("MUTANTE · orden duplicado → ORDEN_DUPLICADO", () => {
    const c = clon();
    c.entries[7].orden = c.entries[6].orden;
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("ORDEN_DUPLICADO");
  });

  it("MUTANTE · array permutado sin tocar `orden` → ORDEN_INCOHERENTE_CON_ARRAY", () => {
    const c = clon();
    const a = c.entries[20]; c.entries[20] = c.entries[21]; c.entries[21] = a;
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("ORDEN_INCOHERENTE_CON_ARRAY");
  });

  it("MUTANTE · orden descendente → rechazado", () => {
    const c = clon();
    const n = c.entries.length;
    c.entries.forEach((e, i) => { e.orden = n - i; });
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("ORDEN_INCOHERENTE_CON_ARRAY");
  });

  it("MUTANTE · dependencia válida por `orden` pero POSTERIOR en el array", () => {
    const c = clon();
    // Se intercambian dos entradas en el array conservando sus `orden`, y se
    // declara una dependencia que por número parece anterior.
    const i = c.entries.findIndex((e) => e.filename === "0062_rrhh_carga_inicial.sql");
    const j = c.entries.findIndex((e) => e.filename === "0061a_rrhh_modalidad_real.sql");
    const tmp = c.entries[i]; c.entries[i] = c.entries[j]; c.entries[j] = tmp;
    const cods = codigos(verificarCatalogo({ catalogo: c }));
    expect(cods).toContain("DEPENDENCIA_POSTERIOR_EN_ARRAY");
  });
});

describe("T-C4-01 · FILENAMES fail-closed", () => {
  it("la regla acepta lo legítimo y rechaza lo demás", () => {
    expect(motivoFilenameInvalido("0001_init.sql")).toBeNull();
    expect(motivoFilenameInvalido("20260811195739_x.sql")).toBeNull();
    expect(motivoFilenameInvalido("0061a_rrhh_modalidad_real.sql")).toBeNull();
    for (const malo of [
      "../fuera.sql",                    // traversal unix
      "..\\fuera.sql",                    // traversal windows
      "sub/otro.sql",                    // separador unix
      "sub\\otro.sql",                    // separador windows
      "/etc/passwd.sql",                 // absoluto unix
      "C:\\Windows\\x.sql",               // absoluto windows
      "0001_init.txt",                   // extensión incorrecta
      "0001_init.sql ",                  // espacio final
      "",                                // vacío
    ]) {
      expect(motivoFilenameInvalido(malo), `debería rechazar ${JSON.stringify(malo)}`).not.toBeNull();
    }
  });

  it("MUTANTE · traversal en el CATÁLOGO → FILENAME_INVALIDO", () => {
    for (const malo of ["../0001_init.sql", "..\\0001_init.sql", "/etc/passwd.sql", "x/y.sql"]) {
      const c = clon();
      c.entries[3].filename = malo;
      c.entries[3].id = malo;
      expect(codigos(verificarCatalogo({ catalogo: c })), malo).toContain("FILENAME_INVALIDO");
    }
  });

  it("MUTANTE · extensión incorrecta en el catálogo → FILENAME_INVALIDO", () => {
    const c = clon();
    c.entries[4].filename = "0004_extended_schema.txt";
    c.entries[4].id = "0004_extended_schema.txt";
    expect(codigos(verificarCatalogo({ catalogo: c }))).toContain("FILENAME_INVALIDO");
  });

  it("MUTANTE · symlink que escapa del directorio → PATH_FUERA_DEL_DIRECTORIO", () => {
    const dir = espejo();
    const fuera = mkdtempSync(join(tmpdir(), "lineage-out-"));
    temporales.push(fuera);
    writeFileSync(join(fuera, "ajeno.sql"), "select 1;");
    // El symlink usa un nombre VÁLIDO: así el rechazo no puede venir del regex.
    symlinkSync(join(fuera, "ajeno.sql"), join(dir, "9998_symlink_externo.sql"));
    const c = clon();
    c.entries[0] = {
      ...c.entries[0],
      id: "9998_symlink_externo.sql",
      filename: "9998_symlink_externo.sql",
      sha256: "0".repeat(64),
    };
    const cods = codigos(verificarCatalogo({ catalogo: c, dirMigraciones: dir }));
    expect(cods).toContain("PATH_FUERA_DEL_DIRECTORIO");
  });
});

describe("T-C4-01 · BACKFILL: plan reproducible, sin sondas, sin autorización", () => {
  const PLAN = JSON.parse(
    readFileSync(join(process.cwd(), "supabase", "lineage", "BACKFILL-SIMULATION.json"), "utf8"),
  );

  it("el JSON versionado coincide byte a byte con el generador", () => {
    // La evidencia del ledger vive FUERA del repositorio: es una lectura
    // puntual de producción, no un artefacto del código. Donde no está —un
    // checkout de CI, por ejemplo— el plan no se puede reconstruir igual, y
    // afirmar que «difiere» sería culpar al generador de una ausencia de
    // entorno. Se afirma lo que sí se puede: que el snapshot declara esa
    // dependencia y que el generador es determinista.
    if (!hayEvidenciaLedger()) {
      expect(PLAN.fuente_ledger.archivo).toBe("ledger-evidence-20260811.json");
      expect(PLAN.fuente_ledger.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(serializar(construirPlan())).toBe(serializar(construirPlan()));
      return;
    }
    expect(serializar(construirPlan())).toBe(
      readFileSync(join(process.cwd(), "supabase", "lineage", "BACKFILL-SIMULATION.json"), "utf8"),
    );
  });

  it("es idempotente: dos construcciones dan los mismos bytes", () => {
    expect(serializar(construirPlan())).toBe(serializar(construirPlan()));
  });

  /**
   * ─── POR QUÉ SE AFIRMA SOBRE `construirPlan()` Y NO SOBRE EL JSON ────────
   *
   * Esta comprobación afirmaba sobre `PLAN`, es decir sobre el archivo
   * commiteado. Una mutación del GENERADOR no toca ese archivo, así que el
   * guard pasaba en verde con un generador que autorizara todas las filas.
   * En el worktree local la comparación byte a byte lo tapaba; en un checkout
   * de CI —sin la evidencia del ledger, que vive fuera del repositorio— esa
   * comparación se saltea y no quedaba NADA verificando al generador.
   *
   * Las invariantes fail-closed se afirman ahora sobre la SALIDA GENERADA, y
   * en los dos contextos. La ausencia de evidencia puede omitir la comparación
   * contra el archivo; nunca puede omitir esto.
   */
  /**
   * Identidades ESPERADAS, derivadas del catálogo REAL de forma independiente
   * del generador. Es la única manera de detectar una OMISIÓN: `filas.length > 0`
   * sobrevivía a que el plan dejara migraciones afuera, y un plan incompleto es
   * un falso verde —el backfill parecería cubrir el linaje sin cubrirlo—.
   */
  const esperadas = REAL.entries
    .filter((e) => e.estado === "active" || e.estado === "corrective")
    .map((e) => ({ ledger_version: e.ledger_version, ledger_name: e.ledger_name }));
  // Separador legible: el NUL ensuciaba los mensajes de fallo y volvía binaria
  // la salida. `::` no aparece en ningún `ledger_name` (son nombres de archivo).
  const clave = (x: { ledger_version: string; ledger_name: string }) =>
    `${x.ledger_version}::${x.ledger_name}`;

  const invariantesFailClosed = (plan: ReturnType<typeof construirPlan>, ctx: string) => {
    // ── Fail-closed: nada autorizado, ninguna sonda, ninguna escritura ──
    expect(plan.conteos.filas_autorizadas_a_escritura, ctx).toBe(0);
    expect(plan.conteos.sondas_ejecutadas, ctx).toBe(0);
    expect(plan.escritura.ejecutada, ctx).toBe(false);
    for (const f of plan.filas) {
      expect(f.authorized_for_write, `${ctx} · ${f.ledger_name}`).toBe(false);
      expect(f.schema_probe, `${ctx} · ${f.ledger_name}`).toBe("PROBE_REQUIRED_NOT_EXECUTED");
    }
    expect(plan.filas.filter((f) => f.authorized_for_write !== false), ctx).toEqual([]);
    expect(
      plan.filas.filter((f) => f.schema_probe !== "PROBE_REQUIRED_NOT_EXECUTED"), ctx,
    ).toEqual([]);

    // ── COMPLETITUD contra el catálogo real ──────────────────────────────
    //
    // No alcanza con contar: una omisión acompañada de un duplicado deja el
    // total intacto. Por eso se comparan CONJUNTOS de identidades y además se
    // exige que no haya repetidos, que es lo que hace que sustituir una fila
    // por otra tampoco pase.
    expect(plan.conteos.ejecutables_en_catalogo, `${ctx} · conteo declarado`)
      .toBe(esperadas.length);
    expect(plan.filas.length, `${ctx} · filas emitidas`).toBe(esperadas.length);

    const versiones = plan.filas.map((f) => f.ledger_version);
    const nombres = plan.filas.map((f) => f.ledger_name);
    expect(new Set(versiones).size, `${ctx} · ledger_version duplicada`).toBe(versiones.length);
    expect(new Set(nombres).size, `${ctx} · ledger_name duplicado`).toBe(nombres.length);

    const emitidas = plan.filas.map((f) => clave(f)).sort();
    const requeridas = esperadas.map((e) => clave(e)).sort();
    expect(emitidas, `${ctx} · conjunto exacto de identidades`).toEqual(requeridas);

    // Mensaje útil cuando falla: qué falta y qué sobra, por nombre.
    const faltantes = requeridas.filter((k) => !emitidas.includes(k));
    const sobrantes = emitidas.filter((k) => !requeridas.includes(k));
    expect({ faltantes, sobrantes }, `${ctx} · diferencias`).toEqual({ faltantes: [], sobrantes: [] });
  };

  it("el PLAN GENERADO nunca autoriza filas ni declara sondas (con evidencia)", () => {
    invariantesFailClosed(construirPlan(), "plan generado con el entorno actual");
  });

  it("el PLAN GENERADO tampoco lo hace SIN evidencia del ledger (contexto CI)", () => {
    // Es el caso que el guard anterior dejaba sin cubrir: en CI no hay
    // evidencia, y ahí es donde una mutación del generador viajaba en verde.
    invariantesFailClosed(
      construirPlan({ evidencia: null, evidenciaSha: null }),
      "plan generado sin evidencia (CI)",
    );
  });

  it("el JSON commiteado cumple las mismas invariantes", () => {
    expect(PLAN.conteos.filas_autorizadas_a_escritura).toBe(0);
    expect(PLAN.conteos.sondas_ejecutadas).toBe(0);
    expect(PLAN.escritura.ejecutada).toBe(false);
    for (const f of PLAN.filas) {
      expect(f.authorized_for_write).toBe(false);
      expect(f.schema_probe).toBe("PROBE_REQUIRED_NOT_EXECUTED");
    }
  });

  it("distingue dato OBSERVADO de INFERENCIA", () => {
    const estados = new Set(PLAN.filas.map((f: { estado_ledger: string }) => f.estado_ledger));
    expect([...estados].sort()).toEqual(["INFERRED_NOT_REGISTERED", "OBSERVED_REGISTERED"]);
    expect(PLAN.conteos.observadas_en_ledger + PLAN.conteos.inferidas_no_registradas)
      .toBe(PLAN.conteos.ejecutables_en_catalogo);
  });

  it("es consistente con el catálogo: una fila por ejecutable, sin repetir versión", () => {
    const ejec = REAL.entries.filter((e) => e.estado === "active" || e.estado === "corrective");
    expect(PLAN.filas).toHaveLength(ejec.length);
    const vs = PLAN.filas.map((f: { ledger_version: string }) => f.ledger_version);
    expect(new Set(vs).size).toBe(vs.length);
    expect(new Set(vs)).toEqual(new Set(ejec.map((e) => e.ledger_version)));
  });

  it("sin evidencia del ledger no inventa: marca LEDGER_EVIDENCE_ABSENT", () => {
    const p = construirPlan({ evidencia: null, evidenciaSha: null });
    expect(p.fuente_ledger.presente).toBe(false);
    expect(p.conteos.observadas_en_ledger).toBe(0);
    for (const f of p.filas) expect(f.estado_ledger).toBe("LEDGER_EVIDENCE_ABSENT");
  });

  it("el matcheo por sufijo sólo aplica a los registros sin prefijo numérico", () => {
    const reg = new Set(["init", "0086_mi_espacio_module_enum"]);
    expect(matchearLedger("0001_init.sql", reg).match).toBe(true);
    expect(matchearLedger("0086_mi_espacio_module_enum.sql", reg).via).toBe("nombre exacto");
    expect(matchearLedger("0016_tracking_foundation.sql", reg).match).toBe(false);
  });
});

describe("T-C4-01 · ROLLBACK: la vía coordinada está cerrada", () => {
  /**
   * El hallazgo del C4 integrado: reclasificar un rollback como `active` en el
   * catálogo y maquillar los contadores top-level en el mismo commit dejaba al
   * verificador en verde, y el generador emitía el rollback como fila
   * ejecutable del plan. Estas pruebas fijan las tres defensas: la convención
   * de filename, el ancla exacta de rollbacks conocidos y el recálculo de
   * contadores desde `entries`.
   */
  const ROLLBACKS = [
    "0083_cash_box_rollback.sql",
    "0091_prospeccion_rollback.sql",
    "ROLLBACK_0233_wa_make_relay_outbox.sql",
    // FASE A · NEXUS-LINK-NOTIFICATIONS-MEDIA-001: las inversas de 0234 y 0235.
    // Entran por la CONVENCIÓN de nombre, no por una excepción: el prefijo
    // ROLLBACK_ ya las obliga a estado `rollback` en el validador.
    "ROLLBACK_0234_link_notification_badges_tricolor.sql",
    "ROLLBACK_0235_link_notification_personal_read.sql",
    // Frontera de canal de Nexus Link: inversa de 0236. Entra por la CONVENCIÓN
    // de nombre, no por una excepción.
    "ROLLBACK_0236_nexus_link_channel_capabilities.sql",
    "ROLLBACK_0237_nexus_link_channel_rls.sql",
    "ROLLBACK_0238_nexus_link_upload_lifecycle.sql",
    // Hallazgo de C5: enum de módulo (prerrequisito de 0236) y cierre de H1
    // sobre connect_participants. Misma convención de nombre.
    "ROLLBACK_0235a_nexus_link_permission_module.sql",
    "ROLLBACK_0239_nexus_link_participants_channel_rls.sql",
  ];
  const OBJETIVO = "ROLLBACK_0233_wa_make_relay_outbox.sql";

  it("control sano: 214 entradas, 201 ejecutables y 13 no ejecutables, recalculados", () => {
    // +4 en FASE A (0234/0235 y sus inversas) y +6 en FASE B (0236, 0237 y
    // 0238 con sus inversas), sobre la línea previa 200/194/6; +4 en el
    // hallazgo de C5 (0235a y 0239, cada una con su inversa) sobre la línea
    // 210/199/11. Las cifras se contrastan contra el recálculo desde
    // `entries`, así que no pueden quedar desfasadas en silencio.
    expect(REAL.entries).toHaveLength(214);
    const ejec = REAL.entries.filter(
      (e) => e.estado === "active" || e.estado === "corrective",
    );
    expect(ejec).toHaveLength(201);
    expect(REAL.entries.length - ejec.length).toBe(13);
    // Y los contadores declarados coinciden con lo recalculado.
    expect(REAL.ejecutables).toBe(201);
    expect(REAL.no_ejecutables).toBe(13);
  });

  it("la convención cerrada identifica exactamente a los tres rollbacks del árbol", () => {
    const porNombre = REAL.entries.filter(
      (e) => e.filename.startsWith("ROLLBACK_") || e.filename.endsWith("_rollback.sql"),
    );
    expect(porNombre.map((e) => e.filename).sort()).toEqual([...ROLLBACKS].sort());
    for (const e of porNombre) expect(e.estado, e.filename).toBe("rollback");
  });

  it("MUTANTE A · rollback reclasificado a active → FAIL por semántica, no sólo por conteos", () => {
    const c = clon();
    const i = c.entries.findIndex((e) => e.filename === OBJETIVO);
    c.entries[i].estado = "active";
    const cods = codigos(verificarCatalogo({ catalogo: c }));
    expect(cods).toContain("ROLLBACK_RECLASIFICADO");
    expect(cods).toContain("ROLLBACK_CONOCIDO_RECLASIFICADO");
    // Sin maquillar contadores, además quedan incoherentes.
    expect(cods).toContain("CONTADOR_EJECUTABLES_INCOHERENTE");
    expect(cods).toContain("CONTADOR_NO_EJECUTABLES_INCOHERENTE");
  });

  it("MUTANTE B · reclasificación CON contadores maquillados (202/12) → sigue FAIL por rollback", () => {
    const c = clon();
    const i = c.entries.findIndex((e) => e.filename === OBJETIVO);
    c.entries[i].estado = "active";
    c.ejecutables = 202;
    c.no_ejecutables = 12;
    const cods = codigos(verificarCatalogo({ catalogo: c }));
    // Los contadores ahora «cuadran» con las entries mutadas: si el rechazo
    // dependiera de ellos, este mutante viajaría en verde.
    expect(cods).not.toContain("CONTADOR_EJECUTABLES_INCOHERENTE");
    expect(cods).not.toContain("CONTADOR_NO_EJECUTABLES_INCOHERENTE");
    expect(cods).toContain("ROLLBACK_RECLASIFICADO");
    expect(cods).toContain("ROLLBACK_CONOCIDO_RECLASIFICADO");
  });

  it("MUTANTE C · con el catálogo mutado, construirPlan se NIEGA antes de emitir filas", () => {
    const c = clon();
    const i = c.entries.findIndex((e) => e.filename === OBJETIVO);
    c.entries[i].estado = "active";
    c.ejecutables = 202;
    c.no_ejecutables = 12;
    expect(() => construirPlan({ catalogo: c })).toThrow(/CATALOGO_INVALIDO/);
    expect(() => construirPlan({ catalogo: c })).toThrow(/ROLLBACK_RECLASIFICADO/);
  });

  it("ningún rollback aparece jamás como fila del plan sano", () => {
    const plan = construirPlan();
    const nombres = new Set(plan.filas.map((f: { ledger_name: string }) => f.ledger_name));
    for (const f of ROLLBACKS) {
      expect(nombres.has(entrada(f).ledger_name), f).toBe(false);
    }
  });

  it("MUTANTE · rename coordinado (catálogo + disco) que eluda la convención → lo mata el ANCLA", () => {
    // El nombre nuevo es VÁLIDO por FILENAME_RE y no matchea la convención de
    // rollback; el archivo del espejo se renombra igual, así que checksum,
    // árbol, orden y contadores maquillados cuadran todos. La ÚNICA defensa
    // que queda en pie es el ancla exacta — y tiene que alcanzar.
    const dir = espejo();
    const disfraz = "0233b_wa_make_relay_outbox_redo.sql";
    renameSync(join(dir, OBJETIVO), join(dir, disfraz));
    const c = clon();
    const i = c.entries.findIndex((e) => e.filename === OBJETIVO);
    c.entries[i] = {
      ...c.entries[i],
      id: disfraz,
      filename: disfraz,
      estado: "active",
      ledger_name: "0233b_wa_make_relay_outbox_redo",
    };
    c.ejecutables = 202;
    c.no_ejecutables = 12;
    const v = verificarCatalogo({ catalogo: c, dirMigraciones: dir });
    expect(codigos(v)).toEqual(["ROLLBACK_CONOCIDO_AUSENTE"]);
    expect(v[0].detalle).toBe(OBJETIVO);
  });

  it("MUTANTE D · contador ejecutables 194→195 sin tocar entries → CONTADOR_EJECUTABLES_INCOHERENTE", () => {
    const c = clon();
    c.ejecutables = 195;
    const cods = codigos(verificarCatalogo({ catalogo: c }));
    expect(cods).toContain("CONTADOR_EJECUTABLES_INCOHERENTE");
    expect(cods).not.toContain("CONTADOR_NO_EJECUTABLES_INCOHERENTE");
  });

  it("MUTANTE E · contador no_ejecutables 6→5 sin tocar entries → CONTADOR_NO_EJECUTABLES_INCOHERENTE", () => {
    const c = clon();
    c.no_ejecutables = 5;
    const cods = codigos(verificarCatalogo({ catalogo: c }));
    expect(cods).toContain("CONTADOR_NO_EJECUTABLES_INCOHERENTE");
    expect(cods).not.toContain("CONTADOR_EJECUTABLES_INCOHERENTE");
  });
});
