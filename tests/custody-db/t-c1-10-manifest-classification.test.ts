/**
 * T-C1-10 · SCR-WMS-002 — clasificación DEDICADA y EXACTA de la serie de
 * Integridad de Custodia, y conteos de los DOS manifiestos.
 *
 * ─── POR QUÉ ESTAS PRUEBAS VIVEN ACÁ Y NO EN `tests/db/t-a0-10` ────────────
 *
 * El harness vanilla tiene un guard de UNIVERSO EXACTO
 * (`tests/db/scripts/assert-clean-run.mjs` + `expected-suite.mjs`) que exige un
 * total de casos fijo. Agregar un solo `it` allí exige actualizar
 * `EXPECTED_TOTAL_TESTS`, y ese archivo NO está entre los paths autorizados de
 * esta remediación. Cambiarlo en silencio habría sido peor que el defecto que
 * se está corrigiendo: es precisamente el artefacto que impide que una corrida
 * parcial pase por completa.
 *
 * La corrección de SCR-WMS-002 en sí queda probada por el propio harness
 * vanilla SIN casos nuevos: `T-A0-10 · toda migración del repositorio está
 * clasificada` fallaba con 0221–0223 sin clasificar y ahora pasa gracias a la
 * exclusión dedicada. Lo que se agrega acá es el detalle granular que §6 exige
 * demostrar, importando el módulo REAL del vanilla —no una copia—, de modo que
 * cualquier divergencia futura se vea.
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import {
  EXPECTED_MANIFEST_SIZE,
  MANIFEST_EXCLUSIONS,
  MIGRATIONS_DIR,
  WMS_MIGRATION_MANIFEST,
  validateCanonicalManifest,
} from "../db/harness/manifest";
import {
  CUSTODY_CLOSURE_SIZE,
  CUSTODY_MIGRATION_MANIFEST,
  EXPECTED_CUSTODY_MANIFEST_SIZE,
  validateCustodyManifest,
} from "./harness/manifest";

const CUSTODY_HARNESS_FILES = [
  "0221_custody_integrity_enums.sql",
  "0222_custody_integrity_foundation.sql",
  "0223_custody_integrity_decision.sql",
  "0224_custody_integrity_authority_hardening.sql",
  "0225_custody_0039_tristate_compat.sql",
  "0226_custody_content_attestation.sql",
  "0231_custody_read_tenant_scope.sql",
  "0232_custody_evaluation_lease_exclusive.sql",
];

const dedicated = () =>
  MANIFEST_EXCLUSIONS.find((e) => e.id === "custody-integrity-dedicated-harness");
const frozen = () => MANIFEST_EXCLUSIONS.find((e) => e.id === "frozen-excluded-snapshot");

describe("T-C1-10 · los DOS manifiestos y sus conteos", () => {
  it("vanilla ACTUAL: 31, y valida por completo con 0221-0223 en el árbol", () => {
    expect(EXPECTED_MANIFEST_SIZE).toBe(31);
    expect(WMS_MIGRATION_MANIFEST).toHaveLength(31);
    // Éste es EL defecto de SCR-WMS-002: antes de la exclusión dedicada esto
    // lanzaba «hay migraciones sin clasificar: 0221..., 0222..., 0223...».
    expect(() => validateCanonicalManifest()).not.toThrow();
  });

  it("cierre HISTÓRICO de custodia: 36", () => {
    const d1d3 = CUSTODY_MIGRATION_MANIFEST.filter((m) => CUSTODY_HARNESS_FILES.includes(m));
    expect(d1d3).toHaveLength(8);
    expect(CUSTODY_MIGRATION_MANIFEST.length - d1d3.length).toBe(36);
    expect(CUSTODY_CLOSURE_SIZE).toBe(36);
  });

  it("manifiesto DEDICADO actual: 44", () => {
    expect(EXPECTED_CUSTODY_MANIFEST_SIZE).toBe(44);
    expect(CUSTODY_MIGRATION_MANIFEST).toHaveLength(44);
    expect(() => validateCustodyManifest()).not.toThrow();
  });

  it("36 + 8 = 44, y las ocho NO están en el vanilla", () => {
    expect(CUSTODY_CLOSURE_SIZE + CUSTODY_HARNESS_FILES.length).toBe(
      EXPECTED_CUSTODY_MANIFEST_SIZE,
    );
    for (const f of CUSTODY_HARNESS_FILES) {
      expect(CUSTODY_MIGRATION_MANIFEST).toContain(f);
      expect(WMS_MIGRATION_MANIFEST).not.toContain(f);
    }
  });
});

describe("T-C1-10 · la exclusión dedicada es separada, exacta y no absorbe nada más", () => {
  it("existe, está separada del snapshot congelado y justifica", () => {
    expect(dedicated()).toBeDefined();
    expect(frozen()).toBeDefined();
    expect(dedicated()!.id).not.toBe(frozen()!.id);
    expect(dedicated()!.reason.trim().length).toBeGreaterThanOrEqual(20);
    expect(dedicated()!.reason).toMatch(/PostGIS/i);
    expect(dedicated()!.reason).toMatch(/custody-db/);
    // Honestidad: 0222 toca objetos del dominio de custodia y hay que decirlo.
    expect(dedicated()!.reason).toMatch(/custody_events/);
    expect(dedicated()!.reason).toMatch(/attach_custody_evidence/);
  });

  it.each(CUSTODY_HARNESS_FILES)("clasifica %s por la DEDICADA, no por la congelada", (f) => {
    expect(dedicated()!.matches(f)).toBe(true);
    // El snapshot congelado NO se amplió: sigue sin conocer estos archivos.
    expect(frozen()!.matches(f)).toBe(false);
  });

  it("cubre EXACTAMENTE esos ocho archivos del árbol y ninguno más", () => {
    const onDisk = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const cubiertos = onDisk.filter((f) => dedicated()!.matches(f)).sort();
    expect(cubiertos).toEqual([...CUSTODY_HARNESS_FILES].sort());
  });

  it("0227 y cualquier migración futura siguen SIN clasificarse solas", () => {
    const futuras = [
      // M2 · el caso exacto que el mandato exige demostrar: una 0227 ficticia,
      // incluso con nombre plausible de la serie de custodia, NO queda
      // clasificada por la exclusión dedicada ni por ninguna otra.
      "0227_custody_content_attestation_v2.sql",
      "0227_custody_integrity_extra.sql",
      "0227_wms_required.sql",
      "0226_custody_content_attestation_v2.sql",
      "0224_custody_integrity_extra.sql",
      "0224_custody_integrity_decision.sql",
      "0225_custody_integrity_enums.sql",
      "0225_custody_0039_tristate_compat_v2.sql",
      "0300_custody_whatever.sql",
      "9999_custody_integrity_foundation.sql",
      "9999_wms_required.sql",
    ];
    for (const f of futuras) {
      expect(dedicated()!.matches(f), f).toBe(false);
      expect(
        MANIFEST_EXCLUSIONS.some((e) => e.matches(f)),
        `${f} no debe quedar clasificada por ninguna exclusión`,
      ).toBe(false);
      expect(WMS_MIGRATION_MANIFEST).not.toContain(f);
    }
  });

  it("las VARIANTES de nombre no coinciden: la regla es por filename EXACTO", () => {
    const variantes = [
      "0221_custody_integrity_enums.SQL",
      "0221_custody_integrity_enums.sql.bak",
      "0221_custody_integrity_enums.sql ",
      " 0221_custody_integrity_enums.sql",
      "x0221_custody_integrity_enums.sql",
      "0221_custody_integrity_enum.sql",
      "0221a_custody_integrity_enums.sql",
      "0221_custody_integrity_enums.sql.disabled",
      "supabase/migrations/0221_custody_integrity_enums.sql",
      "0222_custody_integrity_Foundation.sql",
      "0222-custody-integrity-foundation.sql",
    ];
    for (const f of variantes) {
      expect(dedicated()!.matches(f), f).toBe(false);
      expect(MANIFEST_EXCLUSIONS.some((e) => e.matches(f)), f).toBe(false);
    }
  });
});
