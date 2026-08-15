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
export const EXPECTED_MANIFEST_SIZE = 31;

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

  // ── P3-N1B: identidad canónica de cliente + proyección de business_unit ──
  // El salto 0036→0219 NO es un hueco del manifiesto: 0036-0194 están en la
  // exclusión congelada (dominios ajenos al WMS) y 0195-0218 viven en el
  // candidato Git bf33fa4, fuera de main. Se numera 0219 para no colisionar
  // con esa secuencia observada. Esto NO prueba el estado de producción, que
  // permanece NO VERIFICABLE en este expediente.
  "0219_wms_client_identity_foundation.sql", // client_id ×3, BU proyectada, anomalías, bu_declaration_t
  "0220_wms_canonical_identity_cutover.sql", // gates 100 %, unicidad canónica, RPC v2 (allocate/confirm)
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
/**
 * Snapshot CONGELADO de las migraciones excluidas del cierre WMS, tal como
 * existían en el árbol al cerrar la segunda revisión C4.
 *
 * Hallazgo H-05: la exclusión anterior usaba `migrationSeq(f) >= 36`, que
 * clasificaba AUTOMÁTICAMENTE cualquier migración futura —incluida una posible
 * migración WMS necesaria como `9999_wms_required.sql`— sin exigir una decisión
 * consciente. Ahora las exclusiones son por FILENAME EXACTO: una migración
 * nueva NO figura en este set, queda "sin clasificar" y ROMPE la suite hasta
 * que alguien decida explícitamente si va al manifiesto o a una exclusión, y
 * ese cambio queda visible en el diff.
 */
const FROZEN_EXCLUDED_FILES: ReadonlySet<string> = new Set([
  "0016_tracking_foundation.sql",
  "0017_tracking_geofences.sql",
  "0018_tracking_events.sql",
  "0019_tracking_rbac_seed.sql",
  "0036_custody_core.sql",
  "0037_custody_storage.sql",
  "0038_custody_evidence.sql",
  "0039_custody_pod_reads.sql",
  "0040_profiles_pii_lockdown.sql",
  "0041_crm_enums.sql",
  "0042_crm_core.sql",
  "0043_crm_quotes_proposals.sql",
  "0044_crm_contracts_onboarding.sql",
  "0045_crm_sync_audit.sql",
  "0046_crm_rbac_seed.sql",
  "0047_crm_write_path_fns.sql",
  "0048_crm_ingest_lead.sql",
  "0049_crm_list_commercial_users.sql",
  "0050_crm_promote_lead.sql",
  "0051_crm_onboarding_autocreate.sql",
  "0052_crm_opportunity_clientify_mirror.sql",
  "0052_treasury_permission_module.sql",
  "0053_crm_ingest_deal.sql",
  "0053_treasury_core.sql",
  "0054_treasury_functions.sql",
  "0055_treasury_security_fix.sql",
  "0056_ap_fiscal_detail.sql",
  "0056_rrhh_permission_module.sql",
  "0057_ap_workflow_permissions.sql",
  "0057_rrhh_rbac_seed.sql",
  "0058_ap_rpcs.sql",
  "0058_rrhh_core.sql",
  "0059_iva_compras_views.sql",
  "0059_rrhh_workflows.sql",
  "0060_rrhh_documents_storage.sql",
  "0061_mi_espacio_permission.sql",
  "0061a_rrhh_modalidad_real.sql",
  "0062_rrhh_carga_inicial.sql",
  "0063_rrhh_bancario_carga.sql",
  "0064_rrhh_doc_class_recibo.sql",
  "0065_compliance_core.sql",
  "0066_crm_units.sql",
  "0067_crm_units_seed.sql",
  "0068_crm_reserve_units.sql",
  "0069_crm_opportunities_deal_name.sql",
  "0070_rbac_gerencia_finanzas.sql",
  "0071_fiscal_hardening.sql",
  "0072_vat_sales_fiscal_detail.sql",
  "0073_libro_iva_ventas.sql",
  "0074_add_operator_ruth.sql",
  "0075_email_sends_dedup.sql",
  "0076_crm_contracts.sql",
  "0077_contracts_drive_sync.sql",
  "0081_compliance_drive_sync.sql",
  "0082_cash_box_foundation.sql",
  "0083_cash_box_rollback.sql",
  "0084_announcements.sql",
  "0085_clientify_dashboard.sql",
  "0086_mi_espacio_module_enum.sql",
  "0087_mi_espacio_permission_and_grant.sql",
  "0088_prospeccion_module_enum.sql",
  "0089_prospeccion_core.sql",
  "0091_prospeccion_rollback.sql",
  "0092_add_deal_source.sql",
  "0093_refresh_v_clientify_deals_enriched_deal_source.sql",
  "0094_rpc_add_deal_source_to_cache_replace.sql",
  "0095_add_lost_reason_to_deals.sql",
  "0096_sync_log_observability.sql",
  "0097_recon_schema.sql",
  "0098_recon_rpc.sql",
  "0099_ganancias_retencion.sql",
  "0100_vendors_fiscal_ganancias.sql",
  "0101_fiscal_dashboard_views.sql",
  "0102_recon_views.sql",
  "0103_recon_role_fix.sql",
  "0104_recon_approve_role_fix.sql",
  "0105_recon_approve_admin_self_approval.sql",
  "0106_prospeccion_qualification.sql",
  "0107_prospeccion_approval.sql",
  "0120_chart_of_accounts_baseline.sql",
  "0121_legajo_cuenta_contable.sql",
  "0122_mipyme_foundation.sql",
  "0123_comprobante_tipo_fce_enum.sql",
  "0124_contabilidad_permissions_seed.sql",
  "0125_knowledge_module_enum.sql",
  "0126_knowledge_core.sql",
  "0127_knowledge_rpc.sql",
  "0128_knowledge_projection_triggers.sql",
  "0129_knowledge_rbac_seed.sql",
  "0130_knowledge_views.sql",
  "0131_knowledge_harden_grants.sql",
  "0132_knowledge_emit_status.sql",
  "0133_knowledge_dispatch.sql",
  "0134_knowledge_sentinel_fix.sql",
  "0135_knowledge_adapter_recon.sql",
  "0136_knowledge_adapter_po.sql",
  "0137_knowledge_adapter_treasury.sql",
  "0138_knowledge_adapter_custody.sql",
  "0139_knowledge_adapter_rrhh.sql",
  "0140_knowledge_kpis_admin.sql",
  "0142_connect_module_enum.sql",
  "0143_connect_schema.sql",
  "0144_connect_rpc.sql",
  "0145_connect_views.sql",
  "0146_connect_rbac_seed.sql",
  "0147_connect_notifications_ext.sql",
  "0148_connect_storage.sql",
  "0149_connect_knowledge_adapter.sql",
  "0150_connect_join_channel.sql",
  "0151_connect_moderation_failclose.sql",
  "0152_connect_get_or_create_entity_conversation.sql",
  "0153_connect_search.sql",
  "0154_profile_experience.sql",
  "0155_connect_rbac_pilot_grants.sql",
  "0156_fix_connect_search_ambiguous_conversation_id.sql",
  "0157_fix_connect_search_union_order_by.sql",
  "0158_connect_member_profile_search.sql",
  "0159_connect_archive_rename_hotfix.sql",
  "0160_connect_outbox_worker.sql",
  "0161_connect_mentions_fanout.sql",
  "0162_connect_notification_actions.sql",
  "0163_connect_archived_guards.sql",
  "0164_connect_incidents_schema.sql",
  "0165_connect_incidents_rpcs.sql",
  "0166_connect_incidents_knowledge.sql",
  "0167_connect_tasks_enums_permissions.sql",
  "0168_connect_tasks_schema.sql",
  "0169_connect_tasks_rpcs_workflows.sql",
  "0170_connect_tasks_knowledge.sql",
  "0171_wa_inbound_events.sql",
  "0172_connect_automations_mvp.sql",
  "0173_ai_module_enum.sql",
  "0174_ai_core.sql",
  "0175_ai_rbac_seed.sql",
  "0176_knowledge_docs_projection.sql",
  "0177_knowledge_view_pilot_grant.sql",
  "0178_docs_retrieval_improvements.sql",
  "0179_docs_browse_fts.sql",
  "0180_ai_budget_overrides.sql",
  "0181_ai_finance_overview.sql",
  "0182_ai_analytics_overview.sql",
  "0183_ai_customer_revenue.sql",
  "0184_ai_revenue_by_category.sql",
  "0185_company_knowledge_base.sql",
  "0186_manual_nexus_kb_layer.sql",
  "0189_treasury_operational_movement_enum.sql",
  "0190_treasury_operational_movements.sql",
  "0191_treasury_operational_movement_fix_reference_type.sql",
  "0192_treasury_type_direction_add_movimiento_operativo.sql",
  "0193_treasury_operational_category_add_honorarios_sueldo.sql",
  "0194_treasury_beneficiaries.sql",
]);

/**
 * SCR-WMS-002 · Migraciones que pertenecen al HARNESS DEDICADO de Custodia.
 *
 * `0221`–`0223` viven en `supabase/migrations/` porque son migraciones reales
 * del repositorio, pero su cierre de dependencias exige PostGIS y la serie
 * 0036–0039, que el manifiesto vanilla excluye por diseño (ver arriba). Su
 * lugar es `tests/custody-db/harness/manifest.ts`, no éste.
 *
 * Sin esta regla quedaban SIN CLASIFICAR y `validateCanonicalManifest()`
 * rompía la suite A0 entera — que es exactamente lo que debe hacer con una
 * migración nueva hasta que alguien decida dónde va. Ésta es esa decisión, y
 * está tomada por FILENAME EXACTO: es un set aparte del snapshot congelado,
 * cuyo contenido no se toca, y no absorbe nada que no esté enumerado acá.
 * `0224_*` —o cualquier migración futura, se llame como se llame— sigue sin
 * clasificarse sola.
 *
 * NO agrega estos archivos al manifiesto vanilla ni altera
 * `EXPECTED_MANIFEST_SIZE`: el cierre WMS sobre PostgreSQL vanilla sigue
 * siendo el mismo de 31 archivos.
 */
const CUSTODY_HARNESS_MIGRATION_FILES: ReadonlySet<string> = new Set([
  "0221_custody_integrity_enums.sql",
  "0222_custody_integrity_foundation.sql",
  "0223_custody_integrity_decision.sql",
  // W22-BIS · remediación DB-C4 (B-1 · M-1 · M-3/M-4). Se incorpora por DECISIÓN
  // EXPLÍCITA, que es exactamente lo que la advertencia de abajo exigía.
  "0224_custody_integrity_authority_hardening.sql",
  // W22-TER-B · M-5 (compatibilidad tri-state con 0039). Misma decisión
  // explícita: depende de PostGIS y de 0036-0039, excluidas del vanilla.
  "0225_custody_0039_tristate_compat.sql",
  // W22-TER-C · M-2 (atestación server-side del contenido). Decisión explícita,
  // misma razón: PostGIS y la serie 0036-0039, excluidas del vanilla.
  "0226_custody_content_attestation.sql",
  // Serial UI/E2E · lectura de custodia acotada por tenant. Decisión explícita:
  // reescribe policies sobre `custody_events`/`custody_evidence`, que sólo
  // existen tras 0036-0039 (PostGIS), excluidas del vanilla.
  "0231_custody_read_tenant_scope.sql",
  // Remediación consolidada · reserva EXCLUSIVA del intento de evaluación y
  // abandono explícito. Misma decisión: redefine funciones de 0223 que se
  // apoyan en `custody_events` y en la serie 0036-0039, fuera del vanilla.
  "0232_custody_evaluation_lease_exclusive.sql",
]);

/**
 * L4 · LINAJE — recuperadas y correctivas forward-only.
 *
 * `0141` volvió al árbol ejecutable porque es la dependencia real de
 * `0174/0175/0177` (decisión de Dirección, opción (a) del gate de linaje), y
 * las tres correctivas reponen contratos que migraciones históricas
 * defectuosas no logran establecer sobre una base nueva.
 *
 * Igual que la serie de Custodia: quedarían SIN CLASIFICAR y romperían
 * `validateCanonicalManifest()`, que es exactamente lo que debe pasar con toda
 * migración nueva hasta que alguien decida dónde va. Ésta es esa decisión,
 * tomada por FILENAME EXACTO y en un set PROPIO, sin tocar el snapshot
 * congelado ni `EXPECTED_MANIFEST_SIZE`.
 *
 * `0205`–`0218` NO están acá ni en ningún otro set: son APPLIED_REMOTE_ARCHIVE
 * y viven fuera del árbol ejecutable.
 */
const LINEAGE_RECOVERED_AND_CORRECTIVE_FILES: ReadonlySet<string> = new Set([
  "0141_compliance_cases.sql",
  "20260811195739_ai_docs_redact_paren_fix.sql",
  "20260811230308_contabilidad_module_enum.sql",
  "20260811230310_rbac_gerencia_finanzas_constraint_safe.sql",
]);

export const MANIFEST_EXCLUSIONS: ReadonlyArray<{
  id: string;
  matches: (file: string) => boolean;
  reason: string;
}> = [
  {
    id: "frozen-excluded-snapshot",
    // Filename EXACTO contra el snapshot congelado: NO es un rango. Una
    // migración nueva no está en el set y por tanto NO queda clasificada.
    matches: (f) => FROZEN_EXCLUDED_FILES.has(f),
    reason:
      "Snapshot congelado de las migraciones ajenas al cierre WMS al cerrar la " +
      "segunda revisión C4: dominio Tracking (0016-0019, PostGIS) y todo lo " +
      "posterior a 0035 (custody, CRM, tesorería, knowledge, connect, AI, fiscal). " +
      "0016/0017/0036/0126 además requieren PostGIS. ADVERTENCIA: 0036 (custody) " +
      "TAMBIÉN modifica `packing_units` y `shipments`, objetos del dominio WMS; se " +
      "excluye porque A0 no necesita su forma post-0036, NO porque sea ajena al WMS. " +
      "NO debe afirmarse que ninguna migración posterior toca objetos del WMS: 0036 " +
      "lo hace. Toda migración NUEVA queda fuera de este set, sin clasificar, y " +
      "rompe la suite hasta una decisión explícita.",
  },
  {
    // LINK-WA WA-8R9 · decisión explícita, en entrada propia y por filename
    // EXACTO. Deliberadamente NO se agregó al snapshot congelado de arriba: ese
    // set describe el árbol al cerrar la segunda revisión C4 y no debe crecer
    // con dominios posteriores. Una entrada aparte deja la decisión legible.
    id: "link-wa-r9-whatsapp-status",
    matches: (f) => f === "0227_wa_atomic_status.sql" || f === "0228_wa_provenance_backfill.sql" ||
      f === "0229_wa_inbound_queue.sql" ||
      f === "0230_wa_forgery_lockdown.sql",
    reason:
      "Dominio WhatsApp/Connect, ajeno al cierre de dependencias WMS: 0227 sólo " +
      "toca `connect_messages` y `connect_post_message` (cadena Connect 0142+), " +
      "que el manifiesto A0 no carga. Se excluye del cierre WMS, NO de la " +
      "verificación: sus funciones se ejercitan contra PostgreSQL real en " +
      "tests/db/t-wa-r9-0{1,2,3}-*.test.ts, que montan su propio " +
      "cierre acotado y ejecutan los archivos 0227/0228 tal como están en disco.",
  },
  {
    // WhatsApp Relay Nexus → Make · decisión explícita y por filename EXACTO.
    // La migración y su inversa pre-activación se clasifican juntas, sin abrir
    // un rango que pueda absorber futuras migraciones sin revisión consciente.
    id: "whatsapp-make-relay-outbox",
    matches: (f) =>
      f === "0233_wa_make_relay_outbox.sql" ||
      f === "ROLLBACK_0233_wa_make_relay_outbox.sql",
    reason:
      "Dominio WhatsApp Relay, ajeno al cierre de dependencias WMS: 0233 crea " +
      "la outbox durable y sus RPC de custodia/entrega Nexus → Make; " +
      "ROLLBACK_0233 es su inversa pre-activación. Se excluyen del cierre WMS, " +
      "NO de su verificación específica en " +
      "src/lib/whatsapp/make-relay-migration.test.ts.",
    },
    {
    // NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A · decisión explícita y por
    // filename EXACTO. La migración y su inversa se clasifican juntas, sin
    // abrir un rango que absorba migraciones futuras sin revisión consciente.
    id: "link-notification-badges-tricolor",
    matches: (f) =>
      f === "0234_link_notification_badges_tricolor.sql" ||
      f === "ROLLBACK_0234_link_notification_badges_tricolor.sql" ||
      f === "0235_link_notification_personal_read.sql" ||
      f === "ROLLBACK_0235_link_notification_personal_read.sql" ||
      f === "0236_nexus_link_channel_capabilities.sql" ||
      f === "ROLLBACK_0236_nexus_link_channel_capabilities.sql" ||
      f === "0237_nexus_link_channel_rls.sql" ||
      f === "ROLLBACK_0237_nexus_link_channel_rls.sql" ||
      f === "0238_nexus_link_upload_lifecycle.sql" ||
      f === "ROLLBACK_0238_nexus_link_upload_lifecycle.sql" ||
      f === "0235a_nexus_link_permission_module.sql" ||
      f === "ROLLBACK_0235a_nexus_link_permission_module.sql" ||
      f === "0239_nexus_link_participants_channel_rls.sql" ||
      f === "ROLLBACK_0239_nexus_link_participants_channel_rls.sql" ||
      f === "0239a_nexus_link_revoke_trigger_execute.sql" ||
      f === "ROLLBACK_0239a_nexus_link_revoke_trigger_execute.sql",
    reason:
      "Dominio Connect/Nexus Link, ajeno al cierre de dependencias WMS: 0234 " +
      "sólo redefine las vistas de la cadena Connect 0142+ (v_connect_inbox, " +
      "v_connect_unread_total) y agrega v_link_notification_badges; 0235 agrega " +
      "notification_reads (lectura personal de broadcasts), " +
      "v_link_my_notifications y las RPC de marcado. Ninguna de las dos toca " +
      "objetos WMS y el manifiesto A0 no carga esa cadena. Se excluyen del " +
      "cierre WMS, NO de su verificación: ambas se ejercitan contra PostgreSQL " +
      "real en tests/db/t-link-a1-01-tricolor-badges.test.ts, que monta su " +
      "propio cierre acotado y ejecuta los cuatro archivos tal como están en " +
      "disco, incluidos sus ROLLBACK. 0236 agrega la frontera de canal " +
      "(capacidades nexus_link.*) sobre la misma cadena Connect y se verifica " +
      "en tests/db/t-link-b1-01-channel-boundary.test.ts. 0238 agrega el ciclo " +
      "de vida de la subida (connect_pending_uploads y su máquina de estados) " +
      "sobre esa misma cadena y se verifica en " +
      "tests/db/t-link-b2-01-upload-lifecycle.test.ts, que además ejecuta su " +
      "ROLLBACK y contrasta el catálogo resultante. 0235a agrega dos valores " +
      "al enum permission_module_t ('nexus_link_chat','nexus_link_whatsapp'), " +
      "aislada en su propia migración por la misma razón que 0142 (Postgres " +
      "prohíbe usar un valor de enum recién agregado en la misma transacción " +
      "que lo agrega); es el hallazgo de C5 que corrige a 0236 (unique(module," +
      "action) real, medido contra producción, que 'connect' ya no podía " +
      "absorber). 0239 cierra H1 (fuga de connect_participants.external_ref, " +
      "el teléfono de la contraparte de WhatsApp) agregando el predicado de " +
      "canal —reutilizando _connect_channel_allowed de 0237, sin función " +
      "nueva— a la policy SELECT de connect_participants. Ambas se verifican " +
      "contra PostgreSQL real, con el esquema REAL derivado de main (no un " +
      "cierre sintético), en tests/db/t-link-h1-01-participants-channel-rls." +
      "test.ts, que además ejecuta ambos ROLLBACK y una reaplicación limpia." +
      " 0239a revoca la invocación directa de la función trigger interna de " +
      "0238 a PUBLIC/anon/authenticated/service_role sin cambiar su lógica; " +
      "se verifica contra PostgreSQL real en t-link-b2-01, incluido el binding, " +
      "el rechazo de subidas no finalizadas y el flujo legítimo.",
    },
    {
    id: "lineage-recovered-and-correctives",
    // Filename EXACTO, set propio. No absorbe rangos ni prefijos.
    matches: (f) => LINEAGE_RECOVERED_AND_CORRECTIVE_FILES.has(f),
    reason:
      "Gate de linaje L4: 0141 (dependencia real de 0174/0175/0177, restaurada por decisión " +
      "de Dirección) y las tres correctivas forward-only que reponen contratos rotos en " +
      "instalación limpia (ai_docs_redact de 0176, el valor de enum contabilidad que 0124 " +
      "usa y nadie agrega, y el seed de 0070 que choca con unique (module, action) de 0009). " +
      "Se excluyen del cierre WMS vanilla por la misma razón que la serie de custodia: su " +
      "cierre de dependencias exige PostGIS y la serie 0036-0039. Se verifican en el replay " +
      "gobernado por supabase/lineage/catalog.json y en tests/custody-db/. " +
      "0205-0218 NO participan: son APPLIED_REMOTE_ARCHIVE, fuera del arbol ejecutable.",
  },
  {
    id: "custody-integrity-dedicated-harness",
    // Filename EXACTO, en un set PROPIO y separado del snapshot congelado, cuyo
    // contenido no se modifica. No es un rango ni un patrón por prefijo.
    matches: (f) => CUSTODY_HARNESS_MIGRATION_FILES.has(f),
    reason:
      "Serie de Integridad de Custodia (0221 enums · 0222 fundación · 0223 decisión · " +
      "0224 contención de autoridad y cota temporal · 0225 tri-state 0039 · " +
      "0226 atestación de contenido). " +
      "Se excluye del cierre WMS vanilla porque su cierre de dependencias exige " +
      "PostGIS y la serie 0036-0039, que este manifiesto excluye por diseño para " +
      "no convertir una extensión pesada en dependencia obligatoria de toda la " +
      "suite A0. Estas migraciones SÍ se cargan, y se verifican, en el harness " +
      "DEDICADO de `tests/custody-db/`, cuyo manifiesto propio las enumera. " +
      "ADVERTENCIA: 0222 modifica `custody_events` (CHECK stage/event_type) y " +
      "reemplaza `attach_custody_evidence`, objetos del dominio de custodia; se " +
      "excluye por la dependencia de PostGIS, NO porque sea ajena. La exclusión " +
      "es por los SEIS filenames exactos de esta serie; cualquier migración que " +
      "no enumere ninguna regla queda sin clasificar y rompe la suite hasta una " +
      "decisión explícita.",
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
    "inventory_bu_anomalies", // P3-N1B: anomalías durables multi-BU (0219)
  ],
  enums: {
    business_unit_t: ["ANMAT", "GENERAL", "CORPORATE"],
    warehouse_type_t: ["general", "anmat", "mixed"],
    user_role_t: ["admin", "operaciones", "supervisor", "cliente"],
    movement_type_t: ["ingreso", "traslado", "egreso", "ajuste"],
    bu_declaration_t: ["declared", "defaulted", "unknown"], // P3-N1B (0219)
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
    // P3-N1B (0219): proyección determinista de la línea + traza de declaración
    "wms_recompute_item_business_unit",
    "wms_reception_item_bu_projection",
    "wms_reception_bu_declaration",
  ],
  triggers: [
    "trg_inventory_movements_immutable",
    "trg_inventory_movements_no_truncate",
    "trg_reception_item_bu",
    "trg_reception_cascade_bu",
    // P3-N1B (0219)
    "trg_reception_bu_declaration",
    "trg_reception_item_bu_projection",
  ],
  constraints: ["reception_items_anmat_lot_chk", "inventory_bu_anomalies_kind_ck"],
  // P3-N1B (0220): la unicidad legacy por client_name se RETIRA en el corte;
  // la barrera exige la canónica. La legacy ya NO debe existir tras 0220.
  indexes: [
    "inventory_items_canonical_identity_uk",
    "inventory_lots_identity_uk",
    "inventory_bu_anomalies_open_uk",
  ],
} as const;

export const MIGRATION_PATH = (file: string): string => join(MIGRATIONS_DIR, file);
