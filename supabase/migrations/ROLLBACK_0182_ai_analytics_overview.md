# ROLLBACK 0182 — ai_analytics_overview

**Migración:** `0182_ai_analytics_overview.sql` (fix/f5-2-copilot-context-retrieval)
**Naturaleza:** 100% aditiva — crea 3 funciones read-only (`SECURITY INVOKER`).
No toca tablas, datos, RLS ni funciones existentes. **NO aplicada** hasta OK explícito.

> G3: aplicar/revertir A MANO en el SQL Editor. No `db push`.

## Revertir

```sql
drop function if exists public.ai_billing_summary(text, int);
drop function if exists public.ai_bank_balances_overview(text, int);
drop function if exists public.ai_supplier_spend_overview(text, text, int);
```

Con las funciones ausentes, las tools degradan seguro: `executeTool` absorbe el error
de RPC devolviendo `[]` → P1a responde el vacío honesto por dominio ("No encontré
facturación registrada…"), nunca rompe el turno.

## Verificación post-aplicación (read-only, como piloto)

```sql
select * from public.ai_billing_summary('ultimo_mes', 3);
-- esperado 2026-07: periodo=2026-06 · total 126.229.317,50 · 18 facturas
select * from public.ai_billing_summary('ultimos_meses', 3);
-- esperado: 2026-07 (parcial), 2026-06, 2026-05
select * from public.ai_bank_balances_overview('santander', 5);
-- esperado: Banco Santander · saldo 56.751.532,00
select * from public.ai_supplier_spend_overview('compromiso', 'todo', 3);
-- esperado top: Mobiliarios Fontenla SA · 579.870.471,00 (3 OC firmadas)
select * from public.ai_supplier_spend_overview('gasto', 'todo', 3);
-- esperado top: Mobiliarios Fontenla SA · 11.000.000,00
```

Valores esperados validados 2026-07-06 leyendo prod (RLS bypass) con los MISMOS
cuerpos SELECT de las funciones. Bajo RLS, el piloto (admin/operaciones) ve lo mismo.
