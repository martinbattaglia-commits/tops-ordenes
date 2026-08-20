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

const CUSTODY_FORWARD_FILES = [
  "0221_custody_integrity_enums.sql",
  "0222_custody_integrity_foundation.sql",
  "0223_custody_integrity_decision.sql",
  "0224_custody_integrity_authority_hardening.sql",
  "0225_custody_0039_tristate_compat.sql",
  "0226_custody_content_attestation.sql",
  "0231_custody_read_tenant_scope.sql",
  "0232_custody_evaluation_lease_exclusive.sql",
  "0250_custody_physical_scope_enums.sql",
  "0250a_custody_productive_vision.sql",
  "0251_custody_decide_authority.sql",
  "0252_custody_two_levels.sql",
  "0253_custody_egress_gate.sql",
  "0254_custody_certificate_read.sql",
  "0257_custody_legacy_creator_revoke.sql",
  // V4 · el testigo de la punta evaluada + RPC de lectura del documento.
  "0258_custody_evaluated_head_witness.sql",
  "0263_custody_pod_signature_and_reception_idempotency.sql",
];

const CUSTODY_ARTIFACT_FILES = [
  ...CUSTODY_FORWARD_FILES,
  "ROLLBACK_0250a_custody_productive_vision.sql",
  "ROLLBACK_0251_custody_decide_authority.sql",
  "ROLLBACK_0252_custody_two_levels.sql",
  "ROLLBACK_0253_custody_egress_gate.sql",
  "ROLLBACK_0254_custody_certificate_read.sql",
  // CUSTODIA NIVEL CONTRATADO · los tres artefactos nuevos. NO entran al
  // manifiesto de custodia —se apoyan en 0241/0242, que el snapshot congelado
  // no tiene, y corren en el arnes vanilla— pero SI los captura la exclusion
  // dedicada, que es lo unico que este inventario mide: archivos en disco.
  // Por eso van aca y no en CUSTODY_FORWARD_FILES, que es la lista de los que
  // el manifiesto dedicado si contiene (36 + 16 = 52).
  // 0255 no tiene inversa a proposito: PostgreSQL no admite quitar un valor
  // de un enum. Mismo tratamiento que 0221.
  "0255_clients_custody_action_enum.sql",
  "0256_clients_custody_level_rpc.sql",
  "ROLLBACK_0256_clients_custody_level_rpc.sql",
  "ROLLBACK_0257_custody_legacy_creator_revoke.sql",
  "ROLLBACK_0258_custody_evaluated_head_witness.sql",
  "ROLLBACK_0263_custody_pod_signature_and_reception_idempotency.sql",
];

const dedicated = () =>
  MANIFEST_EXCLUSIONS.find((e) => e.id === "custody-integrity-dedicated-harness");
const frozen = () => MANIFEST_EXCLUSIONS.find((e) => e.id === "frozen-excluded-snapshot");
const linkHandover = () =>
  MANIFEST_EXCLUSIONS.find((e) => e.id === "connect-link-archive-override");

const LINK_HANDOVER_ARTIFACT_FILES = [
  "0260_nexus_link_handover_archived.sql",
  "ROLLBACK_0260_nexus_link_handover_archived.sql",
  "0261_connect_archive_force_override.sql",
  "ROLLBACK_0261_connect_archive_force_override.sql",
];

describe("T-C1-10 · los DOS manifiestos y sus conteos", () => {
  it("vanilla ACTUAL: 31, y valida por completo con 0221-0223 en el árbol", () => {
    expect(EXPECTED_MANIFEST_SIZE).toBe(31);
    expect(WMS_MIGRATION_MANIFEST).toHaveLength(31);
    // Éste es EL defecto de SCR-WMS-002: antes de la exclusión dedicada esto
    // lanzaba «hay migraciones sin clasificar: 0221..., 0222..., 0223...».
    expect(() => validateCanonicalManifest()).not.toThrow();
  });

  it("cierre HISTÓRICO de custodia: 36", () => {
    const d1d3 = CUSTODY_MIGRATION_MANIFEST.filter((m) => CUSTODY_FORWARD_FILES.includes(m));
    expect(d1d3).toHaveLength(17);
    expect(CUSTODY_MIGRATION_MANIFEST.length - d1d3.length).toBe(36);
    expect(CUSTODY_CLOSURE_SIZE).toBe(36);
  });

  it("manifiesto DEDICADO actual: 53", () => {
    expect(EXPECTED_CUSTODY_MANIFEST_SIZE).toBe(53);
    expect(CUSTODY_MIGRATION_MANIFEST).toHaveLength(53);
    expect(() => validateCustodyManifest()).not.toThrow();
  });

  // El cierre HISTÓRICO (36) no se mueve: es el pasado. Lo que crece es la
  // serie de forwards gobernados, que con 0258 pasa de quince a dieciséis.
  it("36 + 17 = 53, y los diecisiete forwards NO están en el vanilla", () => {
    expect(CUSTODY_CLOSURE_SIZE + CUSTODY_FORWARD_FILES.length).toBe(
      EXPECTED_CUSTODY_MANIFEST_SIZE,
    );
    for (const f of CUSTODY_FORWARD_FILES) {
      expect(CUSTODY_MIGRATION_MANIFEST).toContain(f);
      expect(WMS_MIGRATION_MANIFEST).not.toContain(f);
    }
    expect(CUSTODY_MIGRATION_MANIFEST).not.toContain(
      "ROLLBACK_0250a_custody_productive_vision.sql",
    );
    expect(CUSTODY_MIGRATION_MANIFEST).not.toContain(
      "ROLLBACK_0251_custody_decide_authority.sql",
    );
    expect(CUSTODY_MIGRATION_MANIFEST).not.toContain(
      "ROLLBACK_0252_custody_two_levels.sql",
    );
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
    expect(dedicated()!.reason).toMatch(/rollback/i);
    expect(dedicated()!.reason).toMatch(/nunca integran? un manifiesto/i);
    // Honestidad: 0222 toca objetos del dominio de custodia y hay que decirlo.
    expect(dedicated()!.reason).toMatch(/custody_events/);
    expect(dedicated()!.reason).toMatch(/attach_custody_evidence/);
  });

  it.each(CUSTODY_ARTIFACT_FILES)("clasifica %s por la DEDICADA, no por la congelada", (f) => {
    expect(dedicated()!.matches(f)).toBe(true);
    // El snapshot congelado NO se amplió: sigue sin conocer estos archivos.
    expect(frozen()!.matches(f)).toBe(false);
  });

  it("cubre EXACTAMENTE los veinticinco artefactos del árbol y ninguno más", () => {
    const onDisk = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const cubiertos = onDisk.filter((f) => dedicated()!.matches(f)).sort();
    expect(cubiertos).toEqual([...CUSTODY_ARTIFACT_FILES].sort());
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

describe("T-C1-10 · Nexus Link 0260/0261 queda clasificado de forma exacta", () => {
  it("documenta forwards activos e inversas fuera del plan forward", () => {
    expect(linkHandover()).toBeDefined();
    expect(linkHandover()!.reason).toMatch(/forwards?.*activos?/i);
    expect(linkHandover()!.reason).toMatch(/inversas? lógicas?/i);
    expect(linkHandover()!.reason).toMatch(/nunca integran? el manifiesto forward/i);
  });

  it.each(LINK_HANDOVER_ARTIFACT_FILES)("clasifica %s exactamente una vez fuera del vanilla", (f) => {
    expect(linkHandover()!.matches(f)).toBe(true);
    expect(MANIFEST_EXCLUSIONS.filter((entry) => entry.matches(f)).map((entry) => entry.id))
      .toEqual(["connect-link-archive-override"]);
    expect(WMS_MIGRATION_MANIFEST).not.toContain(f);
  });

  it("no absorbe variantes ni la numeración 0262 reservada a otro frente", () => {
    for (const f of [
      "0260_nexus_link_handover_archived.sql.bak",
      "0261_connect_archive_force_override.SQL",
      "0262_nexus_link_future.sql",
      "supabase/migrations/0260_nexus_link_handover_archived.sql",
    ]) {
      expect(linkHandover()!.matches(f), f).toBe(false);
      expect(MANIFEST_EXCLUSIONS.some((e) => e.matches(f)), f).toBe(false);
    }
  });
});
