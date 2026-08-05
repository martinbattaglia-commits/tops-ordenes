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
  "t-a0-15-residual-failclosed.test.ts",
  "t-a0-16-cleanup-propagation.test.ts",
  // ── P3-N1B: identidad canónica de cliente + business_unit (0219/0220) ──
  "t-n1b-01-identity-foundation.test.ts",
  "t-n1b-02-bu-projection.test.ts",
  "t-n1b-03-cutover-gates.test.ts",
  "t-n1b-04-allocate-canonical.test.ts",
  "t-n1b-05-confirm-reception-canonical.test.ts",
  "t-n1b-06-rollback-reapply.test.ts",
];

/** Total exacto de casos. Se actualiza conscientemente con cada cambio. */
export const EXPECTED_TOTAL_TESTS = 350;
