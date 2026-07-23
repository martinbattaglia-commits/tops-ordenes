# ROLLBACK 0184 — ai_revenue_by_category

**Migración:** `0184_ai_revenue_by_category.sql` (fix/f5-2-copilot-context-retrieval)
**Naturaleza:** 100% aditiva — crea 1 función read-only `SECURITY INVOKER`.
No toca tablas, datos, RLS ni funciones existentes. **NO aplicada** hasta OK explícito.

> G3: aplicar/revertir A MANO en el SQL Editor. No `db push`.

## Revertir

```sql
drop function if exists public.ai_revenue_by_category(text, int);
```

Con la función ausente, la tool degrada seguro: `executeTool` absorbe el error → P1a
responde "No encontré ingresos registrados en Nexus para ese período (reporte por
categoría)." — nunca rompe el turno.

## Verificación post-aplicación (read-only, como piloto)

```sql
select * from public.ai_revenue_by_category('ultimo_mes', 10);
-- esperado 2026-07: ANMAT 100.187.092,50 (79,4% · 9) · Sin clasificar 21.668.075
-- (17,2% · 7) · Cargas Generales 4.374.150 (3,5% · 2); total_periodo 126.229.317,50
-- (= ai_billing_summary junio, EXACTO).
select * from public.ai_revenue_by_category('mes_actual', 10);
select * from public.ai_revenue_by_category('todo', 10);
-- Invariantes: sum(monto) = total_periodo · porcentajes ≈ 100% (±0,2 por redondeo)
-- · 'Sin clasificar' visible si existe · sin filtros por nombre.
```

## Criterio de clasificación (auditable)
1. `clients.tags` contiene 'ANMAT' → ANMAT
2. `clients.tags` contiene 'CARGAS GENERALES' → Cargas Generales
3. ítems de la factura con `%anmat%`/`%regulad%` → ANMAT
4. resto → **Sin clasificar** (visible; brecha = asignar tags a los clientes sin tag)

Brecha registrada en matriz: clientes sin tag hoy = `CLIENTE TEST QA TOPS`, `Verotin SA`
(el fix de datos es asignarles tags en /clients — NO es parte de esta migración).
