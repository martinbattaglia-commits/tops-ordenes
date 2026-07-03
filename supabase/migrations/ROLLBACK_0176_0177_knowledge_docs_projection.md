# ROLLBACK — 0176 (proyección metadata documental) + 0177 (grant knowledge.view piloto)

> F5.1-b.0 · Dirección 2026-07-03. Ejecutar A MANO en el SQL Editor (G3).
> Todo es reversible sin pérdida de datos de negocio: `searchable_items` es un índice
> DERIVADO (las fuentes `compliance_documents`/`contract_documents`/`contracts` no se tocan).

## Nivel 0 — vaciar la proyección documental (el Copilot vuelve a "sin evidencia" documental)

Efecto: cero impacto en datos de negocio; sólo deja de encontrarse documentos por metadata.
Scope ESTRICTO a los 2 entity_types de b.0 → NO toca connect_incident/task ni otras proyecciones.

```sql
delete from public.searchable_items
 where entity_type in ('compliance_documento', 'contrato');
```

## Nivel 1 — desmontar triggers, funciones y vista (0176)

```sql
-- Triggers
drop trigger if exists tg_ai_docs_compliance_ins on public.compliance_documents;
drop trigger if exists tg_ai_docs_compliance_upd on public.compliance_documents;
drop trigger if exists tg_ai_docs_compliance_del on public.compliance_documents;
drop trigger if exists tg_ai_docs_contract_ins  on public.contract_documents;
drop trigger if exists tg_ai_docs_contract_upd  on public.contract_documents;
drop trigger if exists tg_ai_docs_contract_del  on public.contract_documents;
drop trigger if exists tg_ai_docs_contract_parent_upd on public.contracts;

-- Trigger functions
drop function if exists public.tg_ai_docs_compliance();
drop function if exists public.tg_ai_docs_contract();
drop function if exists public.tg_ai_docs_contract_parent();

-- RPCs
drop function if exists public.ai_docs_backfill_apply(int, int);
drop function if exists public.ai_docs_backfill_dryrun();
drop function if exists public.ai_docs_reproject(text, text);

-- Vista y helpers
drop view     if exists public.ai_docs_projection;
drop function if exists public.ai_docs_visibility_key(text);
drop function if exists public.ai_docs_redact(text);

select pg_notify('pgrst', 'reload schema');
```

> Orden: primero Nivel 0 (o incluir el delete acá); las funciones no dependen de las
> filas. `ai_docs_reproject` se dropea después de los triggers que la usan.

## Rollback de 0177 (grant knowledge.view piloto)

```sql
-- Quitar la asignación del rol dedicado a los pilotos.
delete from public.user_roles ur
 using public.roles r
 where ur.role_id = r.id and r.slug = 'ai_docs_pilot';

-- Quitar la permission del rol.
delete from public.role_permissions rp
 using public.roles r
 where rp.role_id = r.id and r.slug = 'ai_docs_pilot';

-- Quitar el rol dedicado.
delete from public.roles where slug = 'ai_docs_pilot';

select pg_notify('pgrst', 'reload schema');
```

> ⚠️ Se retira SOLO el grant agregado por 0177 (rol `ai_docs_pilot` = knowledge.view +
> compliance.view + comercial.view). Los pilotos que ya tenían esos permisos por su rol
> funcional (supervisores→gerencia, joseluis→director_ops, martin@→admin) los conservan.
> `martin.battaglia@` (operaciones, 0 asignaciones) vuelve a NO ver documentos — esperado.

## Notas

- Ninguna migración altera DDL existente ni datos de negocio; el rollback restablece el
  estado previo (searchable_items vacía para estos tipos, sin triggers/funciones ai_docs_*,
  sin el rol ai_docs_pilot).
- Si sólo se quiere PAUSAR la búsqueda documental sin desmontar: aplicar **Nivel 0** y dejar
  triggers/funciones; re-`ai_docs_backfill_apply()` la reconstruye.
