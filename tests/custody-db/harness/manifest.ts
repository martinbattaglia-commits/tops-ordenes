/**
 * DB-1 · Manifiesto del CIERRE DE CUSTODIA (PostgreSQL 17 + PostGIS REAL).
 *
 * ─── POR QUÉ UN MANIFIESTO PROPIO Y NO UNA AMPLIACIÓN DEL VANILLA ──────────
 *
 * El harness vanilla (`tests/db/harness/manifest.ts`) excluye deliberadamente
 * 0016 y 0036–0039 porque exigen PostGIS, y fija `EXPECTED_MANIFEST_SIZE = 31`.
 * Tocarlo para meter custodia habría convertido PostGIS en dependencia
 * obligatoria de TODA la suite A0 y roto su prueba de tamaño.
 *
 * Decisión D4: harness DEDICADO. El vanilla queda BYTE-INVARIANTE — este
 * archivo no lo importa para mutarlo, sólo reutiliza `loadSchema(client,
 * manifest)`, que ya acepta un manifiesto por parámetro.
 *
 * Este árbol vive en `tests/custody-db/`, FUERA de `tests/db/**`, porque
 * `vitest.db.config.ts` incluye `tests/db/**\/*.test.ts`: un test de custodia
 * ahí dentro se ejecutaría también en la corrida vanilla —sobre un esquema sin
 * las tablas de custodia— y la rompería. La separación de directorio es lo que
 * hace que la invariancia del vanilla sea real y no sólo declarada.
 */

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(__dirname, "..", "..", "..");
export const MIGRATIONS_DIR = resolve(REPO_ROOT, "supabase", "migrations");
export const CUSTODY_BOOTSTRAP_DIR = resolve(__dirname, "..", "bootstrap");

/**
 * Tamaño esperado. Igual que en el vanilla: cambiarlo exige tocar el manifiesto
 * y esta constante en el mismo diff.
 *
 *   31 vanilla + 0016 + 0036..0039 = 36 (cierre de custodia inventariado)
 *   + 0221 + 0222 + 0223           = 39 (D1–D3 ejecutables)
 *   + 0224                         = 40 (W22-BIS: B-1, M-1, M-3/M-4)
 *   + 0225                         = 41 (W22-TER-B: M-5 tri-state 0039)
 *   + 0226                         = 42 (W22-TER-C: M-2 atestación de contenido)
 *   + 0231                         = 43 (UI/E2E: lectura de custodia acotada por tenant)
 *   + 0232                         = 44 (remediación: reserva exclusiva de evaluación)
 *   + 0250 + 0250a                = 46 (scope físico + visión productiva)
 */
export const EXPECTED_CUSTODY_MANIFEST_SIZE = 47;

/** Cierre inventariado ANTES de D1–D3. Se conserva para poder afirmarlo. */
export const CUSTODY_CLOSURE_SIZE = 36;

export const CUSTODY_MIGRATION_MANIFEST: readonly string[] = [
  // ── Base del ERP ──
  "0001_init.sql",
  "0002_seed.sql",
  "0003_storage.sql",
  "0004_extended_schema.sql",
  "0005_fix_rls_recursion.sql",
  "0006_real_operators.sql",
  "0007_extend_service_units.sql",
  "0008_purchase_orders.sql",
  "0009_rbac.sql",
  "0010_documents.sql",
  "0011_arca_billing.sql",
  "0013_invoices_storage_isolation.sql",
  "0014_supplier_invoices.sql",
  "0015_supplier_invoice_attachments.sql",

  // ── PostGIS REAL: crea `schema extensions` y la extensión. 0036 la exige. ──
  "0016_tracking_foundation.sql",

  // ── WMS ──
  "0020_wms_physical_model.sql",
  "0021_wms_permission_module.sql",
  "0022_wms_rbac_seed.sql",
  "0023_lujan_cubiculos.sql",
  "0024_wms_inventory.sql",
  "0025_wms_receptions.sql",
  "0026_inventory_movements.sql",
  "0027_wms_functions.sql",

  // ── Pedidos ──
  "0029_pedidos_permission_module.sql",
  "0030_logistics_orders.sql",
  "0031_pedidos_functions.sql",
  "0032_wms_picking.sql",
  "0033_wms_packing.sql",
  "0034_wms_packing_cancel.sql",
  "0035_wms_dispatch.sql",

  // ── Cadena de custodia (GATE 5) ──
  "0036_custody_core.sql",     // custody_events, hash-chain, geom PostGIS
  "0037_custody_storage.sql",
  "0038_custody_evidence.sql", // custody_evidence, verify_custody_chain
  "0039_custody_pod_reads.sql",

  // ── Identidad canónica de cliente ──
  "0219_wms_client_identity_foundation.sql",
  "0220_wms_canonical_identity_cutover.sql",

  // ── D1–D3 ──
  "0221_custody_integrity_enums.sql",       // D1: valores de enum, aislados
  "0222_custody_integrity_foundation.sql",  // D1 esquema + D2 atestación
  "0223_custody_integrity_decision.sql",    // D1 validación + D3 sin liberación automática

  // ── W22-BIS · remediación DB-C4 ──
  "0224_custody_integrity_authority_hardening.sql", // B-1 · M-1 · M-3/M-4
  "0225_custody_0039_tristate_compat.sql",          // M-5 · tri-state compatible con 0039
  "0226_custody_content_attestation.sql",           // M-2 · atestación server-side + anti-replay

  // ── Serial UI/E2E · RLS cross-client ──
  "0231_custody_read_tenant_scope.sql",     // lectura de custodia acotada por tenant

  // ── Remediación consolidada · exclusividad de la reserva de evaluación ──
  "0232_custody_evaluation_lease_exclusive.sql", // begin exclusivo + abandono explícito

  // ── Visión productiva · enum aislado + núcleo transaccional ──
  "0250_custody_physical_scope_enums.sql",
  "0250a_custody_productive_vision.sql",

  // ── Cierre del circuito · S1-1 autoridad de decisión + S1-4 evidencia ──
  "0251_custody_decide_authority.sql",
];

export class CustodyManifestError extends Error {
  constructor(message: string) {
    super(`[DB-1 CUSTODY MANIFEST] ${message}`);
    this.name = "CustodyManifestError";
  }
}

export function migrationSeq(file: string): number {
  const m = /^(\d{4})[a-z]?_/.exec(file);
  return m ? Number.parseInt(m[1], 10) : Number.NaN;
}

/**
 * Validación del manifiesto de custodia: sin duplicados, orden estrictamente
 * creciente, archivos existentes, orden lexicográfico y tamaño esperado.
 */
export function validateCustodyManifest(
  manifest: readonly string[] = CUSTODY_MIGRATION_MANIFEST,
  migrationsDir: string = MIGRATIONS_DIR,
): void {
  const seen = new Set<string>();
  const dups = manifest.filter((m) => (seen.has(m) ? true : (seen.add(m), false)));
  if (dups.length > 0) {
    throw new CustodyManifestError(`entradas duplicadas: ${[...new Set(dups)].join(", ")}`);
  }

  let prev = -1;
  let prevSuffix = -1;
  for (const m of manifest) {
    const seq = migrationSeq(m);
    if (!Number.isInteger(seq)) {
      throw new CustodyManifestError(`"${m}" no tiene prefijo numérico de 4 dígitos.`);
    }
    const suffix = /^(\d{4})([a-z])?_/.exec(m)?.[2];
    const suffixOrder = suffix ? suffix.charCodeAt(0) - 96 : 0;
    if (seq < prev || (seq === prev && suffixOrder <= prevSuffix)) {
      throw new CustodyManifestError(
        `orden no estrictamente creciente en "${m}" (${seq}${suffix ?? ""} <= ${prev}${prevSuffix > 0 ? String.fromCharCode(96 + prevSuffix) : ""}).`,
      );
    }
    prev = seq;
    prevSuffix = suffixOrder;
  }

  const onDisk = new Set(readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")));
  const missing = manifest.filter((m) => !onDisk.has(m));
  if (missing.length > 0) {
    throw new CustodyManifestError(`referencia archivos inexistentes: ${missing.join(", ")}`);
  }

  const lexicographic = [...manifest].sort();
  if (JSON.stringify(lexicographic) !== JSON.stringify([...manifest])) {
    throw new CustodyManifestError("el orden del manifiesto no coincide con el lexicográfico.");
  }

  if (manifest.length !== EXPECTED_CUSTODY_MANIFEST_SIZE) {
    throw new CustodyManifestError(
      `se esperaban ${EXPECTED_CUSTODY_MANIFEST_SIZE} migraciones, hay ${manifest.length}. ` +
        `Si el cambio es intencional, actualizá EXPECTED_CUSTODY_MANIFEST_SIZE en el mismo commit.`,
    );
  }
}

/**
 * Objetos que DEBEN existir tras cargar el manifiesto de custodia. Barrera del
 * global setup: si falta uno, ninguna prueba funcional corre.
 */
export const CUSTODY_REQUIRED_OBJECTS = {
  tables: [
    "custody_events",
    "custody_evidence",
    "custody_integrity_cases",
    "custody_integrity_decisions",
    "custody_integrity_inspection_evidence",
    "custody_integrity_evaluation_attempts",
    "custody_physical_units",
    "custody_allocation_physical_units",
    "custody_integrity_policies",
    "custody_integrity_policy_activations",
    "custody_release_certificates",
    "custody_legacy_release_allocation_coverage",
    "custody_productive_installations",
    // W22-TER-C · M-2
    "custody_content_attestations",
    "custody_inspection_content_claims",
    "packing_units",
    "shipments",
    "logistics_orders",
    "clients",
    "profiles",
  ],
  functions: [
    "verify_custody_chain",
    "custody_chain_attestation",
    "custody_chain_lock",
    "attach_custody_evidence",
    "assert_custody_access",
    "assert_custody_tenant",
    "upsert_custody_integrity_assessment",
    "begin_custody_integrity_evaluation",
    "complete_custody_integrity_evaluation",
    "decide_custody_integrity",
    "is_custody_inspection_evidence",
    "custody_entity_client_id",
    "custody_evidence_scope",
    "current_client_id",
    // W22-BIS · B-1 y M-3/M-4
    "guard_profile_authority",
    "custody_inspection_candidates",
    // W22-TER-B · M-5
    "custody_shipment_chain_rollup",
    "get_shipment_custody_summary",
    // W22-TER-C · M-2
    "attest_custody_content",
    "revoke_custody_content_attestation",
    // Visión productiva 0250a.
    "verify_custody_chain_v2",
    "custody_materialize_reception_item_row",
    "custody_bind_allocation",
    "attest_custody_physical_content",
    "attach_custody_physical_evidence",
    "begin_custody_integrity_evaluation_v2",
    "complete_custody_integrity_evaluation_v2",
    "fail_custody_integrity_evaluation_v2",
    "is_custody_inspection_evidence_v2",
  "custody_inspection_candidates_v2",
  "get_custody_physical_timeline",
  "get_custody_physical_token",
  "get_custody_physical_by_token",
    "decide_custody_integrity_v2",
    "custody_assert_physical_unit_released",
    "custody_assert_allocation_released",
    "custody_assert_packing_unit_released",
    "custody_assert_shipment_released",
    "custody_assert_release_certificate",
    "enforce_custody_release_certificate",
    "enforce_custody_packing_content_freeze",
  ],
  /**
   * §2 · `record_custody_integrity_evaluation` NO figura acá y no es un olvido:
   * 0223 la ELIMINA. Mientras existiera, seguía siendo una vía de escritura de
   * las columnas de evaluación sin intento previo. Su ausencia se comprueba
   * como barrera positiva en T-C0-01.
   */
  absentFunctions: ["record_custody_integrity_evaluation"],
  triggers: [
    "trg_custody_integrity_decisions_immutable",
    "trg_custody_integrity_decisions_no_truncate",
    "trg_custody_integrity_inspection_immutable",
    "trg_custody_integrity_case_coherence",
    "trg_custody_integrity_decision_coherence",
    "trg_custody_integrity_attempt_guard",
    // W22-BIS · B-1: sin este trigger, `role` vuelve a ser autoescribible.
    "trg_profiles_authority_guard",
    // W22-TER-C · M-2: el ledger de contenido reclamado es append-only.
    "trg_custody_claims_immutable",
    // Visión productiva 0250a.
    "trg_custody_physical_units_immutable",
    "trg_custody_physical_units_no_truncate",
    "trg_custody_materialize_reception_item",
    "trg_custody_lock_reception_identity",
    "trg_custody_allocation_physical_immutable",
    "trg_custody_allocation_physical_no_truncate",
    "trg_custody_allocation_physical_coherence",
    "trg_custody_productive_installations_immutable",
    "trg_custody_productive_installations_no_truncate",
    "trg_custody_bind_stock_allocation",
    "trg_custody_integrity_policies_immutable",
    "trg_custody_integrity_policies_no_truncate",
    "trg_custody_policy_activations_immutable",
    "trg_custody_policy_activations_no_truncate",
    "trg_custody_release_certificates_immutable",
    "trg_custody_release_certificates_no_truncate",
    "trg_custody_release_certificate_coherence",
    "trg_custody_legacy_coverage_immutable",
    "trg_custody_legacy_coverage_no_truncate",
    "trg_stock_allocations_custody_release",
    "trg_packing_units_custody_release",
    "trg_packing_unit_items_custody_freeze",
    "trg_shipments_custody_release",
    "trg_delivery_pods_custody_release",
    "trg_shipments_custody_final_state",
  ],
  /** D1: el enum debe contener el valor canónico de inspección humana. */
  enumValues: {
    custody_event_type_t: "inspeccion_humana",
    permission_action_t: "custody_decide",
  },
} as const;

export const MIGRATION_PATH = (file: string): string => join(MIGRATIONS_DIR, file);
