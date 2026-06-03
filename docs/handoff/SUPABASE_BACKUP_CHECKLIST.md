# TOPS NEXUS — Supabase Backup Checklist (auditoría)

> Generado 2026-06-03. **Solo auditoría + checklist. NO ejecuta backups, restores ni borrados.**
> Proyecto Supabase: `arsksytgdnzukbmfgkju`. ⚠️ DEV/PROD comparten esta misma DB.

---

## 1. Inventario de migraciones (en `supabase/migrations/`)

| # | Archivo | Dominio | En git | Aplicada en DB |
|---|---|---|---|---|
| 0001 | init | base + audit_log | ✅ | ✅ |
| 0002 | seed | seed | ✅ | ✅ |
| 0003 | storage | storage | ✅ | ✅ |
| 0004 | extended_schema | base | ✅ | ✅ |
| 0005 | fix_rls_recursion | RLS | ✅ | ✅ |
| 0006 | real_operators | seed | ✅ | ✅ |
| 0007 | extend_service_units | servicios | ✅ | ✅ |
| 0008 | purchase_orders | compras | ✅ | ✅ |
| 0009 | rbac | RBAC | ✅ | ✅ |
| 0010 | documents | docs | ✅ | ✅ |
| 0011 | arca_billing | ARCA | ✅ | ✅ |
| **0012** | — | **(hueco intencional, no existe)** | — | — |
| 0013 | invoices_storage_isolation | ARCA | ✅ | ✅ |
| 0014 | supplier_invoices | compras | ✅ | ✅ |
| 0015 | supplier_invoice_attachments | compras | ✅ | ✅ |
| 0016-0019 | tracking_* | tracking | ✅ | ✅ |
| 0020 | wms_physical_model | Digital Twin | ✅ | ✅ |
| 0021 | wms_permission_module | RBAC WMS | ✅ | ✅ |
| 0022 | wms_rbac_seed | RBAC WMS | ✅ | ✅ |
| 0023 | lujan_cubiculos | Twin seed | ✅ | ✅ |
| 0024 | wms_inventory | Inventario | ✅ | ✅ |
| 0025 | wms_receptions | Recepciones | ❌ **sin commit** | ✅ |
| 0026 | inventory_movements | Ledger | ❌ **sin commit** | ✅ |
| 0027 | wms_functions | RPC recepción/mov | ❌ **sin commit** | ✅ |
| **0028** | — | **(hueco intencional — Twin v2, bloqueado)** | — | — |
| 0029 | pedidos_permission_module | RBAC pedidos | ❌ **sin commit** | ✅ |
| 0030 | logistics_orders | Pedidos/Reserva | ❌ **sin commit** | ✅ |
| 0031 | pedidos_functions | RPC reserva | ❌ **sin commit** | ✅ |
| 0032 | wms_picking | Picking | ✅ (`17b0be5`) | ✅ |
| 0033 | wms_packing | Packing | ✅ (`c5390bd`) | ✅ |

**Total:** 31 archivos de migración (0001-0033 menos 0012 y 0028).

---

## 2. Verificación de 0032 / 0033 aplicadas

**Estado: ✅ CONFIRMADAS APLICADAS.**

Método de verificación (esta sesión no tiene MCP de Supabase para consultar el catálogo directo; la confirmación es **por evidencia funcional**):
- **0032:** el kit `gate4a_picking_validation_report.sql` devolvió **25 filas OK** (requiere que existan las RPC `confirm_picking`/`confirm_picking_order`/`unpick_allocation` y la lógica de roll-up). Además el E2E de picking operó contra la DB real.
- **0033:** el kit `gate4b_packing_validation_report.sql` devolvió **todas OK** (requiere `packing_units`, `packing_unit_items`, `packing_status_t` y las 6 RPC). El E2E de packing (12/12) creó/leyó `BLT-2026-0015/0016` en la DB real.

**Verificación directa recomendada (READ-ONLY, correr en SQL Editor):**
```sql
-- Tablas de picking/packing
select to_regclass('public.packing_units')        as packing_units,
       to_regclass('public.packing_unit_items')   as packing_unit_items;
-- Enum packing_status_t
select exists(select 1 from pg_type where typname='packing_status_t') as packing_status_t;
-- RPC de picking + packing
select proname from pg_proc
 where proname in ('confirm_picking','confirm_picking_order','unpick_allocation',
                   'create_packing_unit','pack_allocation','unpack_allocation',
                   'close_packing_unit','reopen_packing_unit','confirm_packing_order')
 order by proname;   -- deben aparecer las 9
```

---

## 3. Comandos recomendados de backup (NO ejecutados — ejecutar manualmente)

> Requieren `SUPABASE_DB_URL` / connection string del proyecto (Dashboard → Settings → Database).

### 3.1 Dump lógico completo (esquema + datos)
```bash
# Esquema + datos (recomendado para snapshot pre-Gate 4C)
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges \
  -F c -f backups/tops_nexus_$(date +%Y%m%d).dump

# Solo esquema (estructura/RPC/enums)
pg_dump "$SUPABASE_DB_URL" --schema-only --no-owner \
  -f backups/tops_nexus_schema_$(date +%Y%m%d).sql
```

### 3.2 Vía Supabase CLI (si está linkeado)
```bash
supabase db dump --db-url "$SUPABASE_DB_URL" -f backups/db_$(date +%Y%m%d).sql
supabase db dump --db-url "$SUPABASE_DB_URL" --data-only -f backups/data_$(date +%Y%m%d).sql
```

### 3.3 Backup nativo del proyecto
- Dashboard → **Database → Backups**: verificar que los **backups automáticos diarios** estén activos. Tomar un **backup on-demand** (PITR si está disponible) **antes** de aplicar cualquier migración de Gate 4C.

### 3.4 Verificación del dump (integridad)
```bash
pg_restore --list backups/tops_nexus_$(date +%Y%m%d).dump | head    # inspección, NO restore
```

---

## 4. Riesgos

- **🔴 DEV/PROD misma DB:** un backup tomado ahora contiene datos productivos **y** footprint de pruebas E2E (pedidos `TEST_*`/`Test-general-001` cancelados, bultos `BLT-*` vacíos, filas `picking.*`/`packing.*` en `audit_log`). Documentar que esas filas son de QA.
- **🟠 Antes de Gate 4C:** Gate 4C introduce el **primer egreso irreversible** (ledger inmutable + `inventory_lots--`). **Obligatorio** tomar backup on-demand + verificar PITR antes de aplicar `0034+`.
- **🟠 Cadena de migraciones git incompleta:** un re-deploy desde git aplicaría `0032/0033` pero **no** `0025-0031` (sin commitear) → DB inconsistente en un entorno nuevo. Reparar con Fase 0 (commit Gates 1/2/3) antes de cualquier rebuild.
- **🟡 No ejecutar restores destructivos** sobre la DB compartida sin coordinar (afecta producción).

**Checklist pre-Gate 4C:**
- [ ] Backup on-demand del proyecto (Dashboard).
- [ ] `pg_dump -F c` guardado fuera del repo.
- [ ] Verificar 0032/0033 con el SQL READ-ONLY de §2.
- [ ] Confirmar PITR activo.
- [ ] Reparar cadena de migraciones en git (Fase 0).
