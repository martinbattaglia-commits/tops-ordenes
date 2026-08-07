# ROLLBACK — `0217_ai_run_lifecycle.sql`

Convención del repo (`ROLLBACK_0142_0149.md`, `ROLLBACK_0160_0163.md`, …).
**Por pasos independientes**, porque el último puede fallar legítimamente y no debe
arrastrar a los anteriores — la lección de `0215`, cuyo rollback original era una
sola transacción que no revertía nada cuando existía auditoría huérfana.

## Qué introdujo `0217`

| Objeto | Tipo |
|---|---|
| `outcome` con `en_curso` y `audit_failure` | CHECK reemplazado |
| `analysis_kind`, `tokens_in`, `tokens_out`, `cost_usd`, `audited`, `finish_reason`, `error_code`, `started_at`, `expires_at` | columnas aditivas |
| `ai_analysis_runs_una_activa_uq` | índice único parcial — **el candado** |
| `ai_analysis_runs_no_auditadas_idx`, `ai_analysis_runs_activas_idx` | índices |
| `ai_claim_analysis_run`, `ai_finalize_analysis_run` | RPC `security definer` |
| `v_ai_spend_reconciliation` | vista con `security_invoker = true` |

Cero DML de negocio. El único `update` de datos es el backfill de `started_at`
desde `created_at`, y los dos `update` internos de las RPC.

## PASO 1 — soltar vista y RPC (siempre seguro)

```sql
begin;
drop view if exists public.v_ai_spend_reconciliation;
drop function if exists public.ai_finalize_analysis_run(
  uuid, text, text, text, int, int, text, text, text, timestamptz, timestamptz);
drop function if exists public.ai_claim_analysis_run(uuid, uuid, text, text, int, int);
commit;
```

⚠️ **Tras este paso el analizador queda inoperante**: `analyze.ts` llama a esas RPC
y, al no existir, corta en el claim y devuelve «No se pudo iniciar el análisis».
Falla **cerrado**: no gasta tokens, no crea sugerencias. Es el comportamiento
deseado si se está revirtiendo, pero hay que saberlo.

## PASO 2 — soltar el candado y los índices (siempre seguro)

```sql
begin;
drop index if exists public.ai_analysis_runs_una_activa_uq;
drop index if exists public.ai_analysis_runs_no_auditadas_idx;
drop index if exists public.ai_analysis_runs_activas_idx;
commit;
```

## PASO 3 — cerrar corridas `en_curso` (obligatorio antes del paso 4)

El CHECK original no admite `en_curso`, así que **hay que cerrarlas primero** o el
paso 4 falla. No se borran: una corrida ocurrida es evidencia.

```sql
begin;
update public.ai_analysis_runs
   set outcome = 'error',
       detail = coalesce(detail,'') || ' · cerrada por rollback de 0217'
 where outcome = 'en_curso';
-- Verificar que no quede ninguna antes de seguir:
select count(*) from public.ai_analysis_runs where outcome in ('en_curso','audit_failure');
commit;
```

Si hay filas con `audit_failure`, decidir explícitamente qué estado terminal les
corresponde. **No** convertirlas en `ok`: eso maquillaría una corrida cuyo costo no
se pudo registrar.

## PASO 4 — restituir el CHECK original

```sql
begin;
alter table public.ai_analysis_runs drop constraint if exists ai_analysis_runs_outcome_check;
alter table public.ai_analysis_runs
  add constraint ai_analysis_runs_outcome_check
  check (outcome in ('ok','killed','denied','budget','invalid_output','error'));
commit;
```

## PASO 5 — columnas: NO se recomienda quitarlas

Son aditivas y no cuestan nada. Quitarlas **destruye evidencia económica**: tokens,
costo y `audited` de todas las corridas ya ejecutadas. Sólo con orden expresa:

```sql
-- ⚠️ DESTRUCTIVO: se pierde la economía de las corridas históricas.
begin;
alter table public.ai_analysis_runs
  drop column if exists analysis_kind, drop column if exists tokens_in,
  drop column if exists tokens_out,    drop column if exists cost_usd,
  drop column if exists audited,       drop column if exists finish_reason,
  drop column if exists error_code,    drop column if exists started_at,
  drop column if exists expires_at;
commit;
```

## Lo que el rollback NO revierte

- **`0213`–`0216`** quedan intactas: tablas, policies, RLS, FK `ON DELETE SET NULL`,
  triggers de referencia y autoría, y la matriz de grants (`authenticated` =
  SELECT + INSERT). `0217` no las toca.
- **La corrida histórica fallida** (`outcome='error'`, `audited=false`,
  `cost_usd=NULL`) se conserva. Es evidencia del defecto detectado durante el
  smoke y no se borra ni se maquilla.
- **El código** se revierte aparte, revirtiendo su commit. Código y `0217` son
  operativamente inseparables: revertir sólo uno de los dos deja el analizador
  inoperante —fallando cerrado— hasta que se revierta el otro.
