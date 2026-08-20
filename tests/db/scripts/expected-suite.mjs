/**
 * P3-N1A0 · Universo EXACTO de la suite de integración (H-04).
 *
 * `assert-clean-run.mjs` exige que la corrida haya ejecutado EXACTAMENTE estos
 * archivos y este total de casos: un subconjunto —por ejemplo, un
 * `vitest.db.config.ts` mutado para incluir un solo archivo— deja la corrida
 * en rojo aunque todos los casos ejecutados hayan pasado.
 *
 * t-a0-13-run-report.test.ts verifica que esta lista coincide con los archivos
 * reales bajo tests/db/: agregar un archivo de test exige actualizarla en el
 * mismo commit, y el total se hace cumplir en cada corrida.
 */

export const EXPECTED_TEST_FILES = [
  "t-a0-01-schema-load.test.ts",
  "t-a0-02-real-constraint.test.ts",
  "t-a0-03-production-guard.test.ts",
  "t-a0-04-teardown.test.ts",
  "t-a0-05-missing-dependency.test.ts",
  "t-a0-06-ci-definition.test.ts",
  "t-a0-07-sentinel.test.ts",
  "t-a0-08-version-gate.test.ts",
  "t-a0-09-process-ownership.test.ts",
  "t-a0-10-manifest.test.ts",
  "t-a0-11-rls-effective.test.ts",
  "t-a0-12-storage-stub.test.ts",
  "t-a0-13-run-report.test.ts",
  "t-a0-14-script-guards.test.ts",
  // LINK-WA WA-8R9 · suite del dominio WhatsApp. Monta su propio cierre acotado
  // (no el manifiesto WMS) y ejercita las funciones del archivo 0227 tal como
  // están en disco, contra el mismo cluster efímero.
  "t-wa-r9-01-atomic-status.test.ts",
  "t-wa-r9-02-post-message.test.ts",
  "t-wa-r9-03-backfill.test.ts",
  "t-wa-r9-04-inbound-queue.test.ts",
  "t-wa-r9-05-isolation.test.ts",
  "t-wa-r9-06-forgery-rls.test.ts",
  "t-wa-r9-07-end-to-end.test.ts",
  "t-a0-15-residual-failclosed.test.ts",
  "t-a0-16-cleanup-propagation.test.ts",
  // ── P3-N1B: identidad canónica de cliente + business_unit (0219/0220) ──
  "t-n1b-01-identity-foundation.test.ts",
  "t-n1b-02-bu-projection.test.ts",
  "t-n1b-03-cutover-gates.test.ts",
  "t-n1b-04-allocate-canonical.test.ts",
  "t-n1b-05-confirm-reception-canonical.test.ts",
  "t-n1b-06-rollback-reapply.test.ts",
  // ── NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A: contadores reales y
  //    campanita tricolor (0234). Monta su propio cierre acotado Connect y
  //    ejecuta 0234 y su ROLLBACK tal como están en disco.
  "t-link-a1-01-tricolor-badges.test.ts",
  // Ensayo prod-shaped de 0234+0235: orden de aplicación, rollback inverso sin
  // residuos, reaplicación idéntica y aislamiento A / B / administrador.
  "t-link-a1-03-migration-rehearsal.test.ts",
  // Frontera de canal de Nexus Link (0236): prueba adversarial Jefe de
  // Deposito + participante WhatsApp + legacy connect.* = DENEGADO.
  "t-link-b1-01-channel-boundary.test.ts",
  // Cierre estructural (0237): RLS, realtime, búsqueda, signed URL y Storage.
  "t-link-b1-02-channel-rls.test.ts",
  // Ciclo de vida de la subida (0238): carreras reales entre finalize y
  // barrido, adopción ajena, reintento tras fallo de Storage y rollback.
  "t-link-b2-01-upload-lifecycle.test.ts",
  // Cierre de H1 (0239): fuga de connect_participants.external_ref. Entorno
  // C5 con esquema REAL derivado de main (0001/.../0238 vía readFileSync,
  // no un cierre sintético), incluidos los dos defectos que ese entorno
  // descubrió en 0236 (columna label, no name; unique(module,action) real).
  "t-link-h1-01-participants-channel-rls.test.ts",
  // PR #66 · FASE A: maestro nativo, OC y Ordenes de Servicio. Cada suite
  // monta su cierre de dependencias y ejecuta los SQL productivos en PG17.
  "t-cli-a1-01-clients-search.test.ts",
  "t-cli-a1-02-clients-master-rollback.test.ts",
  "t-cli-a2-01-atomic-mutations.test.ts",
  "t-cli-a3-01-nivel-contratado.test.ts",
  "t-pr66-a1-purchase-order-integrity.test.ts",
  "t-pr66-01-order-pricing.test.ts",
  // Remediación 0261 (desambiguación de sobrecarga connect_archive_conversation) y 0261a (enums RBAC Finanzas).
  "t-0261-0261a-remediation.test.ts",
];

/**
 * ── WA-8R9 CLOSEOUT · HIGH-1 · CONTEO POR ARCHIVO ─────────────────────────
 *
 * El total suelto (`EXPECTED_TOTAL_TESTS = 350` contra 454 reales) quedó
 * desactualizado sin que nada lo delatara hasta que la corrida completa falló.
 * Un número global es fácil de desincronizar y no dice DÓNDE está la diferencia.
 *
 * Ahora el universo se declara por archivo. `EXPECTED_TOTAL_TESTS` se DERIVA de
 * esta tabla, así que ya no puede contradecirla; y `assertSuiteCoherence()`
 * exige que la tabla y `EXPECTED_TEST_FILES` describan exactamente el mismo
 * conjunto. Agregar un archivo sin su conteo —o al revés— rompe antes de correr
 * una sola prueba.
 */
export const EXPECTED_TESTS_PER_FILE = Object.freeze({
  "t-a0-01-schema-load.test.ts": 17,
  "t-a0-02-real-constraint.test.ts": 14,
  "t-a0-03-production-guard.test.ts": 51,
  "t-a0-04-teardown.test.ts": 9,
  "t-a0-05-missing-dependency.test.ts": 5,
  "t-a0-06-ci-definition.test.ts": 41,
  "t-a0-07-sentinel.test.ts": 15,
  "t-a0-08-version-gate.test.ts": 7,
  "t-a0-09-process-ownership.test.ts": 20,
  "t-a0-10-manifest.test.ts": 24,
  "t-a0-11-rls-effective.test.ts": 15,
  "t-a0-12-storage-stub.test.ts": 8,
  "t-a0-13-run-report.test.ts": 27,
  "t-a0-14-script-guards.test.ts": 32,
  "t-a0-15-residual-failclosed.test.ts": 19,
  "t-a0-16-cleanup-propagation.test.ts": 2,
  "t-n1b-01-identity-foundation.test.ts": 14,
  "t-n1b-02-bu-projection.test.ts": 11,
  "t-n1b-03-cutover-gates.test.ts": 13,
  "t-n1b-04-allocate-canonical.test.ts": 9,
  "t-n1b-05-confirm-reception-canonical.test.ts": 7,
  "t-n1b-06-rollback-reapply.test.ts": 3,
  "t-wa-r9-01-atomic-status.test.ts": 46,
  "t-wa-r9-02-post-message.test.ts": 19,
  "t-wa-r9-03-backfill.test.ts": 29,
  "t-wa-r9-04-inbound-queue.test.ts": 25,
  "t-wa-r9-05-isolation.test.ts": 9,
  "t-wa-r9-06-forgery-rls.test.ts": 23,
  "t-wa-r9-07-end-to-end.test.ts": 7,
  "t-link-a1-01-tricolor-badges.test.ts": 53,
  "t-link-a1-03-migration-rehearsal.test.ts": 16,
  "t-link-b1-01-channel-boundary.test.ts": 21,
  "t-link-b1-02-channel-rls.test.ts": 41,
  "t-link-b2-01-upload-lifecycle.test.ts": 44,
  "t-link-h1-01-participants-channel-rls.test.ts": 34,
  "t-cli-a1-01-clients-search.test.ts": 38,
  "t-cli-a1-02-clients-master-rollback.test.ts": 10,
  "t-cli-a2-01-atomic-mutations.test.ts": 47,
  "t-cli-a3-01-nivel-contratado.test.ts": 8,
  "t-pr66-a1-purchase-order-integrity.test.ts": 7,
  "t-pr66-01-order-pricing.test.ts": 19,
  "t-0261-0261a-remediation.test.ts": 9,
});

/**
 * Total exacto de casos. DERIVADO de la tabla por archivo: no es un número
 * escrito a mano que pueda quedar desfasado.
 */
export const EXPECTED_TOTAL_TESTS = Object.values(EXPECTED_TESTS_PER_FILE)
  .reduce((a, b) => a + b, 0);

/**
 * Guarda de COHERENCIA INTERNA del universo declarado.
 *
 * Se ejecuta antes de comparar contra la corrida: si las dos declaraciones no
 * concuerdan entre sí, cualquier veredicto sobre la corrida sería ruido.
 *
 * @returns {string[]} lista de incoherencias; vacía significa consistente.
 */
export function suiteCoherenceProblems() {
  const problemas = [];
  const archivos = [...EXPECTED_TEST_FILES].sort();
  const conConteo = Object.keys(EXPECTED_TESTS_PER_FILE).sort();

  const sinConteo = archivos.filter((f) => !conConteo.includes(f));
  const sinArchivo = conConteo.filter((f) => !archivos.includes(f));
  if (sinConteo.length) {
    problemas.push(`archivos declarados sin conteo esperado: ${sinConteo.join(", ")}`);
  }
  if (sinArchivo.length) {
    problemas.push(`conteos declarados para archivos ausentes: ${sinArchivo.join(", ")}`);
  }

  const duplicados = archivos.filter((f, i) => archivos.indexOf(f) !== i);
  if (duplicados.length) {
    problemas.push(`archivos duplicados en EXPECTED_TEST_FILES: ${[...new Set(duplicados)].join(", ")}`);
  }

  for (const [f, n] of Object.entries(EXPECTED_TESTS_PER_FILE)) {
    if (!Number.isInteger(n) || n <= 0) {
      problemas.push(`conteo inválido para ${f}: ${n}`);
    }
  }
  return problemas;
}

/** Lanza si el universo declarado es internamente incoherente. */
export function assertSuiteCoherence() {
  const problemas = suiteCoherenceProblems();
  if (problemas.length) {
    throw new Error(
      "[P3-N1A0 SUITE] universo declarado incoherente:\n  - " + problemas.join("\n  - "),
    );
  }
}
