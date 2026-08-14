/**
 * T-A0-10 · Integridad del manifiesto (§11).
 *
 * Valida programáticamente cantidad, duplicados, existencia, orden y —lo más
 * importante— que TODA migración del repositorio esté clasificada: en el
 * manifiesto o en una exclusión documentada. Una migración nueva rompe la
 * validación hasta que alguien decida conscientemente dónde va.
 */

import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import {
  EXPECTED_MANIFEST_SIZE,
  MANIFEST_EXCLUSIONS,
  MIGRATIONS_DIR,
  ManifestIntegrityError,
  WMS_MIGRATION_MANIFEST,
  migrationSeq,
  validateCanonicalManifest,
  validateManifest,
} from "./harness/manifest";

describe("T-A0-10 · manifiesto", () => {
  it("el manifiesto vigente es íntegro (estructura y cobertura)", () => {
    expect(() => validateManifest()).not.toThrow();
    expect(() => validateCanonicalManifest()).not.toThrow();
  });

  it("tiene exactamente la cantidad esperada", () => {
    expect(WMS_MIGRATION_MANIFEST).toHaveLength(EXPECTED_MANIFEST_SIZE);
    // 29 de A0 + 0219/0220 de P3-N1B + 0240/0241 del registro maestro de
    // clientes (cada incorporación es una decisión consciente, visible en el diff).
    expect(EXPECTED_MANIFEST_SIZE).toBe(33);
  });

  it("no tiene duplicados", () => {
    expect(new Set(WMS_MIGRATION_MANIFEST).size).toBe(WMS_MIGRATION_MANIFEST.length);
  });

  it("está en orden estrictamente creciente", () => {
    const seqs = WMS_MIGRATION_MANIFEST.map(migrationSeq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
  });

  it("el orden semántico coincide con el lexicográfico", () => {
    expect([...WMS_MIGRATION_MANIFEST].sort()).toEqual([...WMS_MIGRATION_MANIFEST]);
  });

  it("toda migración del repositorio está clasificada", () => {
    const onDisk = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const inManifest = new Set(WMS_MIGRATION_MANIFEST);
    const unclassified = onDisk.filter(
      (f) => !inManifest.has(f) && !MANIFEST_EXCLUSIONS.some((e) => e.matches(f)),
    );
    expect(unclassified).toEqual([]);
  });

  // ── H-05: una migración FUTURA no puede clasificarse sola ──────────────

  it("MUTANTE PERMANENTE: una migración WMS futura queda SIN CLASIFICAR", () => {
    // La exclusión anterior era `migrationSeq(f) >= 36`, que habría absorbido
    // en silencio a `9999_wms_required.sql`. Con exclusiones por filename
    // exacto, una migración nueva NO está en el snapshot congelado y por tanto
    // no queda clasificada: rompe la suite hasta una decisión consciente.
    const futura = "9999_wms_required.sql";
    expect(WMS_MIGRATION_MANIFEST).not.toContain(futura);
    expect(MANIFEST_EXCLUSIONS.some((e) => e.matches(futura))).toBe(false);
  });

  it.each([
    "0036_custody_core.sql",
    "0126_knowledge_core.sql",
    "0194_treasury_beneficiaries.sql",
    "0016_tracking_foundation.sql",
  ])("la migración existente %s SÍ está clasificada por filename exacto", (f) => {
    expect(MANIFEST_EXCLUSIONS.some((e) => e.matches(f))).toBe(true);
  });

  it("las exclusiones NO usan un rango numérico abierto", () => {
    // Cualquier número por encima del máximo conocido debe quedar fuera.
    for (const f of ["0500_futura.sql", "9999_wms_required.sql", "0999_lo_que_sea.sql"]) {
      expect(MANIFEST_EXCLUSIONS.some((e) => e.matches(f))).toBe(false);
    }
  });

  it("clasifica la migración con sufijo de letra (0061a)", () => {
    // El repositorio tiene `0061a_rrhh_modalidad_real.sql`. La validación la
    // detectó como no clasificada al construirse; el parser ahora la reconoce.
    expect(migrationSeq("0061a_rrhh_modalidad_real.sql")).toBe(61);
    expect(
      MANIFEST_EXCLUSIONS.some((e) => e.matches("0061a_rrhh_modalidad_real.sql")),
    ).toBe(true);
  });

  it("un manifiesto PARCIAL pasa la validación estructural pero no la de cobertura", () => {
    // Distinción necesaria: T-A0-05 usa manifiestos parciales a propósito, y
    // confundir ambas reglas enmascararía el fallo que esa prueba busca.
    const parcial = WMS_MIGRATION_MANIFEST.slice(0, 5);
    expect(() => validateManifest(parcial)).not.toThrow();
  });

  it("rechaza un manifiesto con archivos inexistentes", () => {
    expect(() => validateManifest(["0001_init.sql", "9999_no_existe.sql"])).toThrow(
      ManifestIntegrityError,
    );
    expect(() => validateManifest(["0001_init.sql", "9999_no_existe.sql"])).toThrow(
      /archivos inexistentes/,
    );
  });

  it("rechaza duplicados", () => {
    expect(() => validateManifest(["0001_init.sql", "0001_init.sql"])).toThrow(/duplicadas/);
  });

  it("rechaza orden no creciente", () => {
    expect(() => validateManifest(["0009_rbac.sql", "0001_init.sql"])).toThrow(
      /no estrictamente creciente/,
    );
  });

  it("rechaza entradas sin prefijo numérico", () => {
    expect(() => validateManifest(["README.sql"])).toThrow(/prefijo numérico/);
  });

  it("toda exclusión tiene justificación sustantiva", () => {
    for (const e of MANIFEST_EXCLUSIONS) {
      expect(e.reason.trim().length).toBeGreaterThanOrEqual(20);
    }
  });

  it("la exclusión de 0036 documenta HONESTAMENTE que toca objetos del WMS", () => {
    const rule = MANIFEST_EXCLUSIONS.find((e) => e.matches("0036_custody_core.sql"));
    expect(rule).toBeDefined();
    // No basta con decir "es posterior": 0036 modifica packing_units y shipments.
    expect(rule!.reason).toMatch(/packing_units/);
    expect(rule!.reason).toMatch(/shipments/);
    expect(rule!.reason).toMatch(/PostGIS/i);
    // Y debe advertir contra la afirmación falsa opuesta.
    expect(rule!.reason).toMatch(/NO debe afirmarse/);
  });

  it("las exclusiones de tracking citan PostGIS y el dominio ajeno", () => {
    const r16 = MANIFEST_EXCLUSIONS.find((e) => e.matches("0016_tracking_foundation.sql"));
    expect(r16!.reason).toMatch(/postgis/i);
    const r18 = MANIFEST_EXCLUSIONS.find((e) => e.matches("0018_tracking_events.sql"));
    expect(r18!.reason).toMatch(/Tracking/);
  });

  it("migrationSeq extrae el número de secuencia", () => {
    expect(migrationSeq("0025_wms_receptions.sql")).toBe(25);
    expect(migrationSeq("0001_init.sql")).toBe(1);
    expect(Number.isNaN(migrationSeq("sin-prefijo.sql"))).toBe(true);
  });
});
