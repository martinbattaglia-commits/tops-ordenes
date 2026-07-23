# ROLLBACK — 0179 (ai_docs_browse FTS)

> F5.1-b.0.1.2. Ejecutar A MANO en el SQL Editor (G3). Reversible sin pérdida de datos:
> 0179 solo redefine una RPC de lectura. Restaurar = volver a la definición ILIKE de 0178.
> NO toca `searchable_items` ni datos de negocio.

## Restaurar `ai_docs_browse` a la definición de 0178 (ILIKE substring)

```sql
create or replace function public.ai_docs_browse(
  p_tipo  text default null,
  p_query text default null,
  p_limit int  default 30
) returns table (
  entity_type text, entity_id text, public_id text, title text,
  excerpt text, status text, entity_date timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with t as (
    select case lower(coalesce(btrim(p_tipo), ''))
      when 'compliance'            then 'compliance_documento'
      when 'compliance_documento'  then 'compliance_documento'
      when 'contrato'              then 'contrato'
      when 'contratos'             then 'contrato'
      else null
    end as et
  )
  select
    s.entity_type, s.entity_id, s.public_id, s.title,
    left(coalesce(s.body, ''), 400) as excerpt,
    s.status, s.entity_date
  from public.searchable_items s, t
  where s.entity_type in ('compliance_documento', 'contrato')
    and (t.et is null or s.entity_type = t.et)
    and (p_query is null or btrim(p_query) = '' or s.title ilike '%' || btrim(p_query) || '%')
  order by s.entity_date desc nulls last, s.title asc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

revoke all on function public.ai_docs_browse(text, text, int) from public, anon;
grant execute on function public.ai_docs_browse(text, text, int) to authenticated;
select pg_notify('pgrst', 'reload schema');
```

## Notas
- 0179 NO altera datos ni otras funciones; el rollback deja `ai_docs_browse` exactamente
  como quedó tras 0178 (búsqueda por `title ILIKE`).
- El código TS (tool `docs_browse`) llama a `ai_docs_browse` con el mismo contrato de
  salida (7 columnas) en ambas versiones → no requiere revert de código para la RPC.
- Si además se quiere revertir el fix code-only de b.0.1.2 (guard/prompt v5/descripción),
  eso es `git revert` del commit correspondiente (rama aislada, sin push).
