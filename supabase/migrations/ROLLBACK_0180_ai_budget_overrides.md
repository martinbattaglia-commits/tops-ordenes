# ROLLBACK 0180_ai_budget_overrides

Revierte `0180_ai_budget_overrides.sql`. **Sin efecto sobre datos de negocio.**
Al quitar la tabla/función, TODOS los usuarios vuelven al límite diario default
(`AI_DAILY_LIMIT` / 40). No toca `ai_messages`, `ai_pilot_users`, el tope mensual
ni la RLS de datos.

## Propiedad fail-closed (por qué el rollback es seguro)
`src/lib/ai/budget.ts::checkBudget` usa el default cuando la RPC `ai_daily_limit_for`
no existe o falla. Por eso, si se dropea la función con el código aún desplegado,
el Copilot **degrada solo** a 40/día para todos (no rompe, no abre). El orden
código↔DB es indistinto; lo consistente es revertir también el deploy del código
si se revierte el bloque completo.

## Pasos (SQL Editor de prod `arsksytgdnzukbmfgkju`, en este orden)

```sql
-- 1. Función de resolución (el engine cae a su fallback = env default 40).
drop function if exists public.ai_daily_limit_for(integer);

-- 2. Trigger + función de updated_at.
drop trigger if exists ai_budget_overrides_touch on public.ai_budget_overrides;
drop function if exists public.ai_budget_overrides_touch_updated_at();

-- 3. Tabla (borra los overrides; todos vuelven a 40/día).
drop table if exists public.ai_budget_overrides;
```

## Rollback parcial (solo revertir el seed, dejar la infra)
Si solo se quiere quitar el override de las cuentas de Martín pero mantener la tabla:

```sql
delete from public.ai_budget_overrides o
using auth.users u
where u.id = o.user_id
  and lower(u.email) in ('martin@logisticatops.com','martin.battaglia@logisticatops.com');
```

Alternativa no destructiva: `update ... set expires_at = now()` (deja el registro
para auditoría; la función lo ignora por vencido).
