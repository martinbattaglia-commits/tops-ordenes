/**
 * P3-N1A0 · Manifiesto determinista del cierre de dependencias WMS.
 *
 * ─── POR QUÉ UN MANIFIESTO Y NO LA HISTORIA COMPLETA ───────────────────────
 *
 * La resolución de Dirección (§7.3) prefiere cargar la historia completa si
 * resulta reproducible. NO lo es, y la razón está verificada:
 *
 *   Las migraciones 0016, 0017, 0036 y 0126 ejecutan
 *   `create extension postgis with schema extensions`.
 *   PostGIS no está disponible en una instalación PostgreSQL 17 vanilla y
 *   exigirlo convertiría a una extensión pesada en dependencia obligatoria
 *   del harness — precisamente lo que §6.2 prohíbe hacer sin necesidad
 *   demostrada. Ninguna de esas cuatro migraciones pertenece al cierre WMS.
 *
 * Por eso se usa el manifiesto determinista que §7.3 autoriza, con las cuatro
 * condiciones que exige: exclusiones justificadas, ninguna dependencia real
 * omitida, manifiesto versionado, y una prueba que detecta una dependencia
 * faltante (T-A0-05).
 *
 * ─── EL MANIFIESTO ES UNA LISTA EXPLÍCITA, NO UN RANGO ─────────────────────
 *
 * Se enumeran los archivos uno por uno a propósito. Un rango calculado en
 * tiempo de ejecución incorporaría en silencio cualquier migración nueva que
 * alguien agregue dentro del rango. La lista explícita obliga a una decisión
 * consciente y deja el cambio visible en el diff.
 *
 * NOTA: este manifiesto NO deriva de `supabase_migrations.schema_migrations`.
 * Ese tracker está verificado como no fiel al catálogo (P3-N1 · §4): no
 * registra ninguna de las migraciones de la serie WMS pese a estar aplicadas.
 */

/** Cierre de dependencias WMS, en orden de aplicación. */
export const WMS_MIGRATION_MANIFEST: readonly string[] = [
  // ── Base del ERP: tipos, tablas núcleo, RLS, RBAC ──
  "0001_init.sql", // user_role_t, depot_t, profiles, clients, orders, current_role()
  "0002_seed.sql", // catálogo de servicios base
  "0003_storage.sql", // buckets y policies de storage
  "0004_extended_schema.sql", // clients.deposito_asignado/activo/updated_at, tg_touch_updated_at
  "0005_fix_rls_recursion.sql", // redefine current_role()/is_staff()/is_admin() como SECURITY DEFINER
  "0006_real_operators.sql",
  "0007_extend_service_units.sql",
  "0008_purchase_orders.sql",
  "0009_rbac.sql", // permission_module_t, permissions, roles, role_permissions, has_permission()
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
  "0025_wms_receptions.sql", // business_unit_t, receptions, reception_items, CHECK ANMAT
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
 * Exclusiones, con su justificación. Cada entrada documenta POR QUÉ una
 * migración del repositorio no forma parte del cierre WMS.
 */
export const MANIFEST_EXCLUSIONS: ReadonlyArray<{
  pattern: string;
  reason: string;
}> = [
  {
    pattern: "0012_*, 0028_*",
    reason: "No existen en el repositorio (huecos de numeración históricos).",
  },
  {
    pattern: "0016_tracking_foundation.sql, 0017_tracking_geofences.sql",
    reason:
      "Requieren PostGIS, no disponible en PostgreSQL vanilla. Pertenecen al " +
      "dominio Tracking. Ninguna migración del cierre WMS depende de ellas.",
  },
  {
    pattern: "0018_tracking_events.sql, 0019_tracking_rbac_seed.sql",
    reason:
      "Dependen de las tablas creadas por 0016/0017. Dominio Tracking, ajeno al WMS.",
  },
  {
    pattern: "0036_* y posteriores",
    reason:
      "Custody, CRM, tesorería, knowledge, connect, AI y fiscal son posteriores " +
      "al cierre WMS y ninguno es dependencia suya. 0036 y 0126 además requieren PostGIS.",
  },
];

/**
 * Objetos que DEBEN existir tras cargar el manifiesto. Si el manifiesto pierde
 * una dependencia, alguna de estas comprobaciones falla — este es el mecanismo
 * que impide que una exclusión silenciosa pase inadvertida (T-A0-01 / T-A0-05).
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
