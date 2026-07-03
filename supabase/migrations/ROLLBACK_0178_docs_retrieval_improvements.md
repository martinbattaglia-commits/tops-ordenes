# ROLLBACK — 0178 (mejoras de retrieval documental sobre metadata)

> F5.1-b.0.1. Ejecutar A MANO en el SQL Editor (G3). Reversible sin pérdida de datos:
> `searchable_items` es un índice DERIVADO; las fuentes no se tocan. Las 2 RPC nuevas
> son de solo lectura; dropearlas solo quita capacidad de búsqueda.

## Nivel 1 — quitar las 2 RPC nuevas

```sql
drop function if exists public.ai_contracts_overview(text, int, text, int);
drop function if exists public.ai_docs_browse(text, text, int);
select pg_notify('pgrst', 'reload schema');
```

Efecto: el Copilot pierde `contracts_overview` y `docs_browse`. `ai_search_knowledge` /
`ai_compliance_pending` siguen intactas. (El código TS que declara esas tools también
debe revertirse por git — rama aislada, sin merge — o la tool fallará silenciosamente
con `rpc error` y `executeTool` devolverá `[]`, que degrada a NO_EVIDENCE, no rompe.)

## Nivel 2 — restaurar el `body` de la vista a la definición 0176 (des-enriquecer)

`create or replace view` restaura la definición EXACTA de 0176 (solo `body` volvía a su
forma previa). El cambio de `body` recién impacta `searchable_items` al REPROYECTAR.

```sql
create or replace view public.ai_docs_projection as
  select
    'compliance_documento'::text as entity_type,
    cd.id::text                  as entity_id,
    left(public.ai_docs_redact(coalesce(nullif(btrim(cd.titulo), ''), 'Documento de compliance')), 512) as title,
    left(public.ai_docs_redact(
      concat_ws(' · ',
        '[ficha metadata]',
        nullif(btrim(cd.titulo), ''),
        nullif(btrim(cd.categoria), ''),
        nullif(btrim(cd.tipo_doc), ''),
        nullif(btrim(cd.organismo), ''),
        nullif(btrim(cd.sede), ''),
        case when cd.fecha_vencimiento is not null then 'vence ' || to_char(cd.fecha_vencimiento, 'YYYY-MM-DD') end
      )
    ), 8192) as body,
    (coalesce(nullif(btrim(cd.item_id), ''), 'CMP') || '#' || left(cd.id::text, 8)) as public_id,
    nullif(btrim(cd.riesgo), '') as status,
    case when coalesce(cd.fecha_vencimiento, cd.fecha_emision) is not null
         then (coalesce(cd.fecha_vencimiento, cd.fecha_emision)::timestamp at time zone 'America/Argentina/Buenos_Aires')
         else null end as entity_date,
    public.ai_docs_visibility_key('compliance_documento') as visibility_key
  from public.compliance_documents cd
  union all
  select
    'contrato'::text as entity_type,
    cdo.id::text     as entity_id,
    left(public.ai_docs_redact(
      concat_ws(' — ', nullif(btrim(cdo.titulo), ''), nullif(btrim(c.razon_social), ''))
    ), 512) as title,
    left(public.ai_docs_redact(
      concat_ws(' · ',
        '[ficha metadata]',
        nullif(btrim(cdo.titulo), ''),
        nullif(btrim(cdo.tipo_doc::text), ''),
        nullif(btrim(c.razon_social), ''),
        nullif(btrim(c.tipo::text), ''),
        nullif(btrim(c.estado), ''),
        nullif(btrim(c.deposito), ''),
        case when c.fecha_fin is not null then 'vence ' || to_char(c.fecha_fin, 'YYYY-MM-DD') end
      )
    ), 8192) as body,
    (coalesce(nullif(btrim(c.public_id), ''), 'CTR') || '#' || left(cdo.id::text, 8)) as public_id,
    nullif(btrim(c.estado), '') as status,
    case when c.fecha_fin is not null
         then (c.fecha_fin::timestamp at time zone 'America/Argentina/Buenos_Aires')
         else null end as entity_date,
    case when c.id is null then public.ai_docs_visibility_key('__unknown__')
         else public.ai_docs_visibility_key('contrato') end as visibility_key
  from public.contract_documents cdo
  left join public.contracts c on c.id = cdo.contract_id;

revoke all on public.ai_docs_projection from public, anon, authenticated;
select pg_notify('pgrst', 'reload schema');
```

## Nivel 3 (opcional) — re-materializar `body` viejo en searchable_items

Solo si ya se había corrido la reproyección con el `body` enriquecido y se quiere volver
al `body` previo en las filas:

```sql
select public.ai_docs_backfill_apply();  -- lo ejecuta Dirección a mano (SECURITY DEFINER)
```

## Notas

- 0178 NO altera DDL existente ni datos de negocio; NO corre backfill. El `body`
  enriquecido solo impacta filas tras reproyección (paso de apply aprobado aparte).
- Si se aplicó 0178 pero NUNCA se reproyectó, el Nivel 2 es innecesario (las filas
  siguen con el `body` de 0176); alcanza con el Nivel 1.
