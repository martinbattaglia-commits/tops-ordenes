# F0.5 / E1 — Run Log de Ejecución Controlada

**Ventana:** Aplicación de Knowledge F0.5 (`0125-0130`) a prod `arsksytgdnzukbmfgkju`
**Protocolo:** aplicación manual · 1 migración por vez · validación read-only post-paso · STOP ante inconsistencia
**Asistente:** solo lectura; los WRITES a prod los ejecuta Dirección (Martín). G3.

---

## 0. Estado Go / No-Go (al abrir la ventana)

| # | Gate | Estado |
|---|---|---|
| 1 | Numeración / R-N1 (renum. `0125-0130`, libre en prod + ramas) | ✅ GO |
| 2 | Aditividad (100% aditivas; rollback = drop de objetos nuevos) | ✅ GO |
| 3 | F0.5.0 NO aplicado en prod (se aplican las 6) | ✅ GO |
| 4 | D-1 = `staff` (`0127:56`) | ✅ GO |
| 5 | D-3 = runner manual archivo-por-archivo | ✅ GO |
| 6 | Changeset validado (único cambio funcional = D-1) | ✅ GO |
| 7 | Orden + verificación read-only por paso | ✅ GO |
| 8 | Rollback documentado (§5 checklist) | ✅ GO |
| 9 | Asistente no escribe en prod | ✅ GO |
| 11 | Ventana / ejecutor (Dirección · SQL Editor) | ✅ GO |
| **10** | **Backup previo / PITR** | ✅ **GO (excepción de Dirección)** — ver nota abajo |

**Estado Go/No-Go: 11/11 GO** — gate #10 cerrado por **excepción operativa de Dirección**, NO por backup.

### Gate #10 — Excepción operativa de Dirección (2026-06-29)

Dirección autoriza continuar E1 bajo **excepción operativa aprobada** respecto del Gate #10.

**Se deja constancia explícita de que NO existe un backup dedicado para esta ventana.** No se tomó backup on-demand, ni `pg_dump`, ni se declaró un restore point como tal. No se representa la existencia de ningún backup.

Red de seguridad disponible (registrada por trazabilidad; **NO equivalente a un backup dedicado**):
- Archivado WAL continuo activo y sano (substrato de PITR): `archive_mode=on`, `failed_count=0`, último archive `2026-06-29 15:32:45 UTC`.
- Marcador LSN pre-ventana: `26/EC007D68` @ `2026-06-29 15:37:33 UTC` (WAL `0000000100000026000000EC`).
- Rollback aditivo (§5 del checklist): `DROP` de los objetos nuevos `0125-0130`.

**Riesgo residual asumido por Dirección.** Con esta excepción, el Go/No-Go queda 11/11 y se habilita la ventana de aplicación.

### Autorización de ejecución autónoma vía MCP (2026-06-29)

Dirección autoriza expresamente que **Cloud Code ejecute las migraciones `0125-0130` (WRITES DDL) directamente vía el MCP de Supabase**, de forma autónoma, exclusivamente sobre el proyecto de producción `arsksytgdnzukbmfgkju` (`tops-ordenes-prod`).

Esto **revierte explícitamente** el invariante previo **G3/D-3** ("el asistente nunca escribe en prod; aplica solo Dirección a mano"), por decisión directa de Dirección (autoridad máxima). Condiciones mandadas y respetadas:
- verificar el `project_id` = `arsksytgdnzukbmfgkju` antes de cada operación (STOP si no coincide);
- una migración por vez;
- validación read-only automática vía MCP tras cada una;
- actualización del Run Log + declaración ✅ OK / 🛑 STOP;
- STOP inmediato ante cualquier inconsistencia.

El MCP ejecuta **únicamente** los WRITES de migración autorizados (`0125-0130`); ningún otro WRITE, ni deploy, push, merge o creación de ramas.

---

## 1. Snapshot pre-ventana (estado inicial)

**Captura:** `2026-06-29 15:32:31.817729+00` (UTC) · read-only vía Supabase MCP.

| Campo | Valor |
|---|---|
| Entorno | `arsksytgdnzukbmfgkju` · tops-ordenes-prod · sa-east-1 · ACTIVE_HEALTHY |
| PostgreSQL | 17.6 |
| Migración head aplicada | `20260629142621` / `0107_prospeccion_approval` (41 migraciones registradas) |
| `permission_module_t` | 19 valores; **sin `'knowledge'`**: `{cockpit, compras, servicios, comercial, compliance, cctv, documental, analytics, sistema, operaciones, wms, pedidos, tesoreria, cuentas_pagar, rrhh, tesoreria_recon, contabilidad, mi_espacio, prospeccion}` |
| Objetos `knowledge_*` | relations=0 · functions=0 · types=0 · vistas `v_knowledge_*`=0 · permisos `knowledge.*`=0 → **F0.5 NO aplicado** |
| `audit_log` (filas) | **152** |
| `audit_log` por entity | orders 92 · shipment 17 · stock_allocation 16 · packing_unit 12 · profiles 7 · custody_evidence 3 · custody_event 2 · delivery_pod 1 · fiscal_config 1 · logistics_orders 1 |
| D-1 (contexto) | ninguno de los 6 literales del CASE (`purchase_order`/`supplier_invoice`/`vendor`/`fleet_vehicle`/`warehouse`/`compliance_item`) presente → backfill daría `'staff'` en cualquier caso |
| Numeración objetivo | `0125-0130` ausentes en prod (head=0107) → libres |

**A aplicar (en orden):** `0125 → 0126 → 0127 → 0128 → 0129 → 0130`.

### Evidencia PITR / archivado WAL (gate #10)

| Señal | Valor |
|---|---|
| `archive_mode` | `on` |
| `wal_level` | `logical` |
| `archive_command` | `admin-mgr wal-push` (WAL-G) |
| `archive_timeout` | `120` s |
| `pg_stat_archiver.archived_count` | 9998 |
| `pg_stat_archiver.failed_count` | **0** |
| `last_archived_time` | `2026-06-29 15:32:45+00` (hace ~33 s al snapshot) |

**Interpretación:** archivado WAL continuo **activo y sano** → substrato de PITR operativo; cubre la ventana para un restore point inmediato (RPO ≤ ~2 min).
**No verificable por tool / pendiente de Dirección:** (a) ventana de retención de PITR (profundidad de restauración), (b) enablement del add-on PITR self-service, (c) cumplimiento de la *política de recuperación de producción* (no documentada en este repo). → El cierre del gate #10 requiere juicio de Dirección o un backup explícito.

### Marcador LSN pre-ventana (read-only · evidencia adicional, NO sustituye el backup)

| Campo | Valor |
|---|---|
| Captura | `2026-06-29 15:37:33.297159+00` (UTC) |
| `pg_current_wal_lsn()` | `26/EC007D68` |
| `pg_current_wal_insert_lsn()` | `26/EC007D68` |
| WAL file actual | `0000000100000026000000EC` |
| PostgreSQL | 17.6 |

Punto de referencia para "restaurar a antes de la ventana". **No reemplaza el requisito del gate #10** (backup explícito); solo complementa la trazabilidad.

---

## 2. Aplicación (a completar durante la ventana)

| Paso | Migración | Hora `Success` (Dirección) | Verificación read-only | Resultado |
|---|---|---|---|---|
| 3.1 | `0125_knowledge_module_enum` | ✅ aplicada (MCP) | enum `'knowledge'` presente · módulos 19→20 · registrada en `schema_migrations` | ✅ **OK** |
| 3.2 | `0126_knowledge_core` | ✅ aplicada (MCP) | 9 tablas · RLS 9/9 · 9 policies SELECT · trigger append-only ×2 · fn forbid_delete | ✅ **OK** |
| 3.3 | `0127_knowledge_rpc` | ✅ aplicada (MCP) | tipo canónico + emit + visibility; D-1 funcional: vendor/PO/compliance/default=`staff` | ✅ **OK** |
| 3.4 | `0128_knowledge_projection_triggers` | ✅ aplicada (MCP) | fuente audit_log `enabled` · 3 fns · trigger vivo · `knowledge_events`=0 (backfill=Bloque 4) | ✅ **OK** |
| 3.5 | `0129_knowledge_rbac_seed` | ✅ aplicada (MCP) | 5 permisos · 28 grants (view×12) · `cliente_b2b` excluido (0) | ✅ **OK** |
| 3.6 | `0130_knowledge_views` | ✅ aplicada (MCP) | 2 vistas `security_invoker` · realtime · set `0125-0130` completo (6/6) | ✅ **OK** |
| 3.7 | `0131_knowledge_harden_grants` (H-E1-1) | ✅ aplicada (MCP) | `revoke execute` anon/authenticated en 3 fns SECDEF; ACL=`{postgres, service_role}` | ✅ **OK** |

## 3. Smoke tests (Bloque 4)

### Read-only (ejecutados automáticamente vía MCP) — ✅
- Vistas `v_knowledge_timeline` / `v_knowledge_entity_360`: queryables, 0 filas (sin backfill aún). ✅
- RLS estructural: policy `knowledge_events_select` exige `has_permission('knowledge.view')`. ✅
- Realtime: `knowledge_events` en `supabase_realtime`. ✅
- Advisors (security): `v_knowledge_*` **NO** figuran en `security_definer_view` (son `security_invoker`) → **criterio 4.6 ✅**. Ninguna tabla `knowledge_*` con RLS sin policy. ✅

### ✅ HALLAZGO H-E1-1 — grants de funciones SECURITY DEFINER (RESUELTO vía 0131)
`knowledge_emit_event`, `knowledge_visibility_for`, `knowledge_backfill_audit_log` (SECURITY DEFINER) son **ejecutables por `anon` y `authenticated`** — ACL `{postgres=X, anon=X, authenticated=X, service_role=X}` — pese a `revoke all from public` en 0127/0128. Causa: Supabase concede EXECUTE a anon/authenticated por `ALTER DEFAULT PRIVILEGES` directo; el `revoke from public` no los alcanza.
- **Riesgo:** `knowledge_emit_event` es SECURITY DEFINER y escribe en `knowledge_events` saltando RLS → un `authenticated` podría inyectar eventos (vía PostgREST RPC). Blast radius hoy: interno (0 clientes externos). Patrón preexistente en 171 funciones del DB. NO afecta el criterio formal 4.6.
- **Resolución (Dirección, `0131`):** `revoke execute … from anon, authenticated` en las 3 funciones. ACL re-verificado: `{postgres=X, service_role=X}` — anon/authenticated SIN execute. Vector cerrado. ✅

### Smokes ejecutados (continuación) — ✅
- **4.2 Backfill (idempotencia):** 1ª corrida = **152** materializados; 2ª corrida = **0** (idempotente). `knowledge_events`=152 · `v_knowledge_timeline`=152 · `event_type` 100% `audit.*`. Visibility: **119 `staff` + 33 `client:<uuid>`** (órdenes con `client_id`). ✅
- **4.4 entity_360:** orden real `e0daa52c…` → evento `audit.create_signed`, `annotation_id=NULL` (sin anotaciones en F0.5). ✅
- **4.5 RLS negativo:** `authenticated` sin `knowledge.view` → **0 filas** en `v_knowledge_timeline`. ✅
- **4.6 Advisors / 4.7 Realtime:** ✅ (sección read-only).

### Smokes con inyección de datos (4.1 trigger en vivo, 4.3 gate) — OMITIDOS (decisión Dirección, 2026-06-29)
- **4.1** inserta `test_smoke` en `audit_log` con `enabled=true` → proyecta un evento que queda **PERMANENTE** en `knowledge_events` (append-only, no borrable salvo rollback total).
- **4.3** inserta `test_gate` con `enabled=false` → ensucia `audit_log` (limpiable), sin residuo en `knowledge_events`.
- El trigger ya está **verificado por construcción** (existe, AFTER INSERT, `enabled`, defensivo) y su **path de emisión probado por el backfill**. Recomendación: **omitir** para no contaminar prod.

## 4. Cierre (Bloque 5) — ✅ E1 COMPLETO

- **Proyecto:** `arsksytgdnzukbmfgkju` (tops-ordenes-prod) — único, verificado antes de cada operación.
- **Fecha:** 2026-06-29.
- **Método:** aplicación vía MCP `apply_migration` (D-3 reasignado a Cloud Code por autorización expresa de Dirección, revirtiendo el invariante G3); validación read-only automática por paso; Gate #10 cerrado por **excepción de Dirección** (sin backup dedicado; PITR/WAL activo + marcador LSN como trazabilidad).
- **Migraciones aplicadas (7/7):** `0125` enum · `0126` 9 tablas+RLS+FTS · `0127` tipo+emit+visibility (D-1=`staff`) · `0128` adapter+trigger+backfill · `0129` 5 permisos+28 grants · `0130` 2 vistas+realtime · `0131` hardening H-E1-1. Todas en `schema_migrations`.
- **Verificación final read-only:** migs=7 · tablas=9 · vistas=2 · permisos=5 · eventos=152 · timeline=152 · enum `knowledge`=true · realtime=1 · funciones SECDEF hardened (authenticated sin execute)=true · fuente `audit_log` enabled=true.
- **Smokes:** 6 ejecutados (backfill idempotente 152→0, entity_360, RLS negativo, advisors, realtime, RLS estructural) — **todos ✅**. 2 (4.1/4.3 inyección) **OMITIDOS** por decisión de Dirección (evitar residuo en append-only; trigger verificado por construcción + path probado por backfill).
- **Incidencias:** **H-E1-1** (funciones SECDEF ejecutables por anon/authenticated) detectada en smoke de advisors y **RESUELTA en la misma ventana** vía `0131`. Sin otras.
- **Estado final:** **Knowledge F0.5 OPERATIVO en producción** — timeline corporativo poblado (152 eventos), proyección viva, RBAC+RLS activos, realtime habilitado, funciones de máquina bloqueadas a `service_role`.
- **Pendiente:** nada de E1. F0.5.2 **NO iniciado** (fuera de alcance).

*Run Log cerrado: 2026-06-29 · E1 Knowledge F0.5 · estado final: ✅ COMPLETO Y OPERATIVO.*

---

*Run Log iniciado: 2026-06-29 · E1 Knowledge F0.5 · estado al abrir: **NO-GO** (gate #10 abierto).*
