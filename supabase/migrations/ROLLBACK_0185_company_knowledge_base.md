# ROLLBACK 0185 · Company Knowledge Base (Capa 2 institucional)

Revierte `0185_company_knowledge_base.sql`. Aditiva y reversible: **no toca datos
ni objetos existentes**, solo crea la tabla `company_knowledge_documents`, sus
índices/trigger/policies y la RPC `ai_company_knowledge_search`.

> ⚠️ Ejecutar SOLO si se decidió no seguir con la Capa 2. Si ya hay documentos
> curados ingeridos en `company_knowledge_documents`, **exportarlos antes**
> (la biblioteca canónica es Drive, pero conviene respaldar el índice).
> Aplica Martín a mano en el SQL Editor (G3). El asistente NO ejecuta.

## SQL de rollback (idempotente)

```sql
-- 1. RPC de lectura
drop function if exists public.ai_company_knowledge_search(text, text, text, int);

-- 2. Trigger + función de updated_at
drop trigger  if exists company_kb_touch on public.company_knowledge_documents;
drop function if exists public.company_kb_touch_updated_at();

-- 3. Tabla (arrastra policies, índices y constraints).
--    CASCADE solo si alguna vista/FK futura dependiera de ella (hoy no hay).
drop table if exists public.company_knowledge_documents;
```

## Degradación segura

- El código es **fail-closed**: `company_knowledge_search` (tool) llama a
  `ai_company_knowledge_search`; si la RPC no existe, `executeTool` la absorbe
  devolviendo `[]` (ver `data.ts` rpc error → `[]`), y el engine cae a la
  **brecha institucional específica** (coverage). Es decir, revertir 0185 deja
  al Copilot exactamente como antes de C1 (Capa 2 = brecha declarada), sin
  errores de runtime.

## Verificación post-rollback (read-only)

```sql
select to_regclass('public.company_knowledge_documents');                 -- NULL
select to_regprocedure('public.ai_company_knowledge_search(text,text,text,int)'); -- NULL
```
