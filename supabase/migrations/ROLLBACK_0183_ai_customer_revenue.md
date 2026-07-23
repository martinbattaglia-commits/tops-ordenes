# ROLLBACK 0183 — ai_customer_revenue

**Migración:** `0183_ai_customer_revenue.sql` (fix/f5-2-copilot-context-retrieval)
**Naturaleza:** 100% aditiva — crea 1 función read-only `SECURITY INVOKER`.
No toca tablas, datos, RLS ni funciones existentes. **NO aplicada** hasta OK explícito.

> G3: aplicar/revertir A MANO en el SQL Editor. No `db push`.

## Revertir

```sql
drop function if exists public.ai_customer_revenue_overview(text, int);
```

Con la función ausente, la tool degrada seguro: `executeTool` absorbe el error de RPC
devolviendo `[]` → P1a responde "No encontré facturación por cliente registrada en
Nexus para ese período." — nunca rompe el turno.

## Verificación post-aplicación (read-only, como piloto)

```sql
select * from public.ai_customer_revenue_overview('todo', 1);    -- cliente top histórico
select * from public.ai_customer_revenue_overview('ultimo_mes', 5); -- ranking junio
select * from public.ai_customer_revenue_overview('mes_actual', 5); -- julio
```

Los valores esperados quedaron validados 2026-07-07 ejecutando el MISMO cuerpo SELECT
read-only contra prod (ver COPILOT_NEXUS_COVERAGE_MATRIX.md / reporte de sesión).
Bajo RLS, el piloto staff ve lo mismo; un cliente B2B solo vería su propia facturación.
