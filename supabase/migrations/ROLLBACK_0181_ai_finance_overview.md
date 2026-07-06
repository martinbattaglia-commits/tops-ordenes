# ROLLBACK 0181 — ai_finance_overview

**Migración:** `0181_ai_finance_overview.sql` (fix/f5-2-copilot-context-retrieval)
**Naturaleza:** 100% aditiva — crea 4 funciones read-only nuevas. No toca tablas,
datos, RLS ni funciones existentes. Rollback = drop de las 4 funciones.

**Riesgo de rollback:** nulo. Solo desregistra tools del Copilot (que vuelven a
no cubrir facturas/OC/proveedores). Ningún otro módulo depende de estas RPC.

> Recordá (G3): aplicar/revertir A MANO en el SQL Editor de Supabase. No `db push`.

## Revertir

```sql
drop function if exists public.ai_customer_invoices_overview(text, text, int);
drop function if exists public.ai_supplier_invoices_overview(text, text, int);
drop function if exists public.ai_purchase_orders_overview(text, text, int);
drop function if exists public.ai_suppliers_overview(text, int);
```

Tras revertir el SQL, en la app hay que quitar las 4 tools del catálogo
(`src/lib/ai/types.ts`, `tools.ts`, `mock.ts`, prompt) o el modelo intentará
invocar RPC inexistentes → `executeTool` las absorbe devolviendo `[]` (P1a mostraría
"No encontré facturas…"), así que un desfasaje temporal degrada seguro, no rompe.

## Verificación post-aplicación (read-only, como piloto)

```sql
-- Debe devolver la última factura emitida (no anulada):
select * from public.ai_customer_invoices_overview('ultima', null, 1);
-- Última OC:
select * from public.ai_purchase_orders_overview('ultima', null, 1);
-- Última factura de proveedor / pendientes de aprobación:
select * from public.ai_supplier_invoices_overview('ultima', null, 1);
select count(*) from public.ai_supplier_invoices_overview('pendientes_aprobacion', null, 50);
-- Último proveedor cargado (primera fila):
select * from public.ai_suppliers_overview(null, 1);
```

Valores esperados al 2026-07-06 (validados leyendo prod, RLS bypass):
- customer_invoices: 29 filas (21 no anuladas), última `FACTURA_A 2-21`, 2026-07-01.
- supplier_invoices: 16 filas, 0 aprobadas (todas 'cargada'), última 2026-06-28.
- purchase_orders: 24 filas, última `OC-2026-0371`, 2026-07-06.
- vendors: primero por `created_at desc` = último proveedor cargado.
