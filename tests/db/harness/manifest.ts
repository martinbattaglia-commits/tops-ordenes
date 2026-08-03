/**
 * P3-N1A0 · Manifiesto determinista del cierre de dependencias WMS.
 *
 * ─── POR QUÉ UN MANIFIESTO Y NO LA HISTORIA COMPLETA ───────────────────────
 *
 * La historia completa NO es reproducible sobre PostgreSQL vanilla: las
 * migraciones 0016, 0017, 0036 y 0126 ejecutan
 * `create extension postgis with schema extensions`, y PostGIS no está
 * disponible en una instalación PostgreSQL 17 estándar. Exigirlo convertiría
 * una extensión pesada en dependencia obligatoria del harness sin necesidad
 * demostrada. Se usa entonces el manifiesto determinista autorizado, con sus
 * cuatro condiciones: exclusiones justificadas, ninguna dependencia real
 * omitida, manifiesto versionado, y prueba que detecta una dependencia
 * faltante (T-A0-05).
 *
 * ─── LISTA EXPLÍCITA, NO RANGO ─────────────────────────────────────────────
 *
 * Se enumeran los archivos uno por uno a propósito. Un rango calculado en
 * tiempo de ejecución incorporaría en silencio cualquier migración nueva.
 * `validateManifest()` además exige que TODA migración del repositorio esté o
 * bien en el manifiesto, o bien cubierta por una exclusión documentada: una
 * migración nueva rompe la validación hasta que alguien decida conscientemente
 * dónde va, y ese cambio queda visible en el diff.
 *
 * El manifiesto NO deriva de `supabase_migrations.schema_migrations`: ese
 * tracker está verificado como no fiel al catálogo (no registra la serie WMS
 * pese a estar aplicada). La única autoridad es `information_schema`/`pg_catalog`.
 */

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "..", "supabase", "migrations");

/** Cantidad esperada. Cambiarla exige tocar el manifiesto y esta constante. */
export const EXPECTED_MANIFEST_SIZE = 29;

/** Cierre de dependencias WMS, en orden de aplicación. */
export const WMS_MIGRATION_MANIFEST: readonly string[] = [
  // ── Base del ERP: tipos, tablas núcleo, RLS, RBAC ──
  "0001_init.sql", // user_role_t, depot_t, profiles, clients, orders, current_role()
  "0002_seed.sql", // catálogo de servicios base
  "0003_storage.sql", // buckets y policies de storage
  "0004_extended_schema.sql", // clients.deposito_asignado/activo/updated_at
  "0005_fix_rls_recursion.sql", // current_role()/is_staff()/is_admin() SECURITY DEFINER
  "0006_real_operators.sql",
  "0007_extend_service_units.sql",
  "0008_purchase_orders.sql",
  "0009_rbac.sql", // permission_module_t, permissions, roles, has_permission()
  "0010_documents.sql", // documents + scoping por profiles.client_id
  "0011_arca_billing.sql", // clients.condicion_iva/tipo_doc/localidad
  "0013_invoices_storage_isolation.sql",
  "0014_supplier_invoices.sql",
  "0015_supplier_invoice_attachments.sql",

  // ── WMS: modelo físico, inventario, recepciones, ledger, RPC ──
  "0020_wms_physical_model.sql", // warehouse_type_t, jerarquía de 6 niveles
  "0021_wms_permission_module.sql", // permission_module_t += 'wms'
  "0022_wms_rbac_seed.sql", // permisos wms.view/edit/admin
  "0023_lujan_cubiculos.sql", // posiciones físicas de Pedro de Luján
  "0024_wms_inventory.sql", // inventory_items, inventory_lots
  "0025_wms_receptions.sql", // business_unit_t, receptions, CHECK ANMAT
  "0026_inventory_movements.sql", // ledger append-only + triggers de inmutabilidad
  "0027_wms_functions.sql", // identity_uk, lockdown RLS, confirm_reception/movement

  // ── Pedidos: órdenes logísticas, reservas, picking, packing, despacho ──
  "0029_pedidos_permission_module.sql", // permission_module_t += 'pedidos'
  "0030_logistics_orders.sql", // logistics_orders, order_items, stock_allocations
  "0031_pedidos_functions.sql", // allocate_order, release_allocation, cancel_order
  "0032_wms_picking.sql",
  "0033_wms_packing.sql",
  "0034_wms_packing_cancel.sql",
  "0035_wms_dispatch.sql", // shipments, confirm_dispatch, confirm_delivery, revert_dispatch
];

/**
 * Número de secuencia de un archivo de migración (`0025_x.sql` → 25).
 *
 * El repositorio tiene al menos una migración con sufijo de letra
 * (`0061a_rrhh_modalidad_real.sql`), producto de una inserción posterior en la
 * numeración. Se acepta el sufijo para que quede correctamente clasificada;
 * devolver NaN la habría dejado sin clasificar, que es lo que detectó la
 * validación al construirla.
 */
export function migrationSeq(file: string): number {
  const m = /^(\d{4})[a-z]?_/.exec(file);
  return m ? Number.parseInt(m[1], 10) : Number.NaN;
}

/**
 * Exclusiones documentadas. Cada regla explica POR QUÉ la migración no forma
 * parte del cierre WMS, y `validateManifest()` exige que toda migración del
 * repositorio quede cubierta por alguna.
 */
export const MANIFEST_EXCLUSIONS: ReadonlyArray<{
  id: string;
  matches: (file: string) => boolean;
  reason: string;
}> = [
  {
    id: "tracking-postgis",
    matches: (f) => [16, 17].includes(migrationSeq(f)),
    reason:
      "0016/0017 ejecutan `create extension postgis`, no disponible en PostgreSQL " +
      "vanilla. Pertenecen al dominio Tracking; ninguna migración del cierre WMS " +
      "depende de ellas.",
  },
  {
    id: "tracking-dependientes",
    matches: (f) => [18, 19].includes(migrationSeq(f)),
    reason:
      "0018/0019 dependen de las tablas creadas por 0016/0017. Dominio Tracking, ajeno al WMS.",
  },
  {
    id: "posteriores-al-cierre-wms",
    matches: (f) => migrationSeq(f) >= 36,
    reason:
      "Posteriores al cierre WMS. 0036 (custody) queda excluida por su acoplamiento " +
      "con PostGIS; ADVERTENCIA EXPLÍCITA: 0036 TAMBIÉN modifica `packing_units` y " +
      "`shipments`, es decir, toca objetos del dominio WMS. Se excluye porque no es " +
      "necesaria para las garantías funcionales que A0 verifica, NO porque sea ajena " +
      "al WMS. NO debe afirmarse que ninguna migración posterior toca objetos próximos " +
      "al WMS: 0036 lo hace. Si una prueba futura necesita custody, packing_units o " +
      "shipments en su forma post-0036, habrá que resolver PostGIS o stubearlo, y el " +
      "manifiesto deberá cambiar de forma visible.",
  },
];

export class ManifestIntegrityError extends Error {
  constructor(message: string) {
    super(`[P3-N1A0 MANIFEST] ${message}`);
    this.name = "ManifestIntegrityError";
  }
}

/**
 * Validación ESTRUCTURAL: aplica a CUALQUIER manifiesto, incluidos los
 * deliberadamente parciales que usa T-A0-05 para probar dependencias faltantes.
 * No incluye la cobertura del repositorio, que sólo tiene sentido para el
 * manifiesto canónico.
 */
export function validateManifest(
  manifest: readonly string[] = WMS_MIGRATION_MANIFEST,
  migrationsDir: string = MIGRATIONS_DIR,
): void {
  // 1) sin duplicados
  const seen = new Set<string>();
  const dups = manifest.filter((m) => (seen.has(m) ? true : (seen.add(m), false)));
  if (dups.length > 0) {
    throw new ManifestIntegrityError(`entradas duplicadas: ${[...new Set(dups)].join(", ")}`);
  }

  // 2) prefijo numérico válido y orden estrictamente creciente.
  //    Comprobaciones PURAS antes que las de I/O: un nombre mal formado es un
  //    error de configuración más básico que un archivo ausente.
  let prev = -1;
  for (const m of manifest) {
    const seq = migrationSeq(m);
    if (!Number.isInteger(seq)) {
      throw new ManifestIntegrityError(`"${m}" no tiene prefijo numérico de 4 dígitos.`);
    }
    if (seq <= prev) {
      throw new ManifestIntegrityError(
        `orden no estrictamente creciente en "${m}" (${seq} <= ${prev}).`,
      );
    }
    prev = seq;
  }

  // 3) archivos existentes
  const onDisk = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const onDiskSet = new Set(onDisk);
  const missing = manifest.filter((m) => !onDiskSet.has(m));
  if (missing.length > 0) {
    throw new ManifestIntegrityError(
      `referencia archivos inexistentes en supabase/migrations/: ${missing.join(", ")}`,
    );
  }

  // 4) el orden semántico coincide con el lexicográfico de los archivos
  const lexicographic = [...manifest].sort();
  if (JSON.stringify(lexicographic) !== JSON.stringify([...manifest])) {
    throw new ManifestIntegrityError(
      "el orden del manifiesto no coincide con el orden lexicográfico de los archivos.",
    );
  }

}

/**
 * Validación de COBERTURA del manifiesto CANÓNICO: cantidad esperada y
 * clasificación exhaustiva de todas las migraciones del repositorio.
 *
 * Se separa de `validateManifest` porque estas dos reglas sólo tienen sentido
 * para el manifiesto real: un manifiesto parcial —como el que T-A0-05 usa para
 * probar dependencias faltantes— dejaría por definición migraciones sin
 * clasificar, y confundir ambos casos enmascararía el fallo que esa prueba busca.
 */
export function validateCanonicalManifest(migrationsDir: string = MIGRATIONS_DIR): void {
  validateManifest(WMS_MIGRATION_MANIFEST, migrationsDir);

  if (WMS_MIGRATION_MANIFEST.length !== EXPECTED_MANIFEST_SIZE) {
    throw new ManifestIntegrityError(
      `se esperaban ${EXPECTED_MANIFEST_SIZE} migraciones, hay ${WMS_MIGRATION_MANIFEST.length}. ` +
        `Si el cambio es intencional, actualizá EXPECTED_MANIFEST_SIZE en el mismo commit.`,
    );
  }

  const onDisk = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const inManifest = new Set(WMS_MIGRATION_MANIFEST);
  const unclassified = onDisk.filter(
    (f) => !inManifest.has(f) && !MANIFEST_EXCLUSIONS.some((e) => e.matches(f)),
  );
  if (unclassified.length > 0) {
    throw new ManifestIntegrityError(
      `hay migraciones sin clasificar (ni en el manifiesto ni en una exclusión ` +
        `documentada): ${unclassified.join(", ")}. Toda migración nueva exige una ` +
        `decisión explícita y visible en el diff.`,
    );
  }

  for (const e of MANIFEST_EXCLUSIONS) {
    if (!e.reason || e.reason.trim().length < 20) {
      throw new ManifestIntegrityError(`la exclusión "${e.id}" carece de justificación.`);
    }
  }
}

/**
 * Objetos que DEBEN existir tras cargar el manifiesto. Se verifican como
 * BARRERA del global setup (§10), antes de habilitar las suites funcionales:
 * si falta uno, ninguna prueba funcional debe correr, porque estaría midiendo
 * un esquema incompleto.
 */
export const REQUIRED_OBJECTS = {
  tables: [
    "inventory_items",
    "inventory_lots",
    "inventory_movements",
    "receptions",
    "reception_items",
    "logistics_orders",
    "logistics_order_items",
    "stock_allocations",
    "clients",
    "profiles",
    "warehouses",
    "warehouse_positions",
  ],
  enums: {
    business_unit_t: ["ANMAT", "GENERAL", "CORPORATE"],
    warehouse_type_t: ["general", "anmat", "mixed"],
    user_role_t: ["admin", "operaciones", "supervisor", "cliente"],
    movement_type_t: ["ingreso", "traslado", "egreso", "ajuste"],
  },
  functions: [
    "confirm_reception",
    "release_quarantine",
    "confirm_movement",
    "allocate_order",
    "release_allocation",
    "cancel_order",
    "confirm_dispatch",
    "confirm_delivery",
    "revert_dispatch",
    "current_role",
    "has_permission",
  ],
  triggers: [
    "trg_inventory_movements_immutable",
    "trg_inventory_movements_no_truncate",
    "trg_reception_item_bu",
    "trg_reception_cascade_bu",
  ],
  constraints: ["reception_items_anmat_lot_chk"],
  indexes: ["inventory_items_identity_uk", "inventory_lots_identity_uk"],
} as const;

export const MIGRATION_PATH = (file: string): string => join(MIGRATIONS_DIR, file);
