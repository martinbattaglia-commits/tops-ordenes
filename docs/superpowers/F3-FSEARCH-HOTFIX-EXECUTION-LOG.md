# F3 · F-SEARCH — Hotfix Execution Log

> Registro de ejecución del hotfix de `connect_search` en producción (`arsksytgdnzukbmfgkju`), autorizado por Dirección.
> **2026-07-01.** Referencias: `F3-FSEARCH-HOTFIX-PLAN.md`, `F3-PILOT-VALIDATION-LOG.md`.

---

## Etapa 1 — Pre-flight (✅)
- Prod en `88add4b` (HTTP 200).
- `connect_search` con el bug ambiguo presente (`tiene_bug_ambiguo=true`, `tiene_fix_aplicado=false`), owner `postgres`.
- `0156` NO en historial de migraciones (última = `0155_connect_rbac_pilot_grants`).
- Archivo `0156` verificado: SQL ejecutable = 4 subqueries calificadas `mc.conversation_id`, 0 ambiguas.
- Working tree: solo `docs/superpowers/*` + `supabase/migrations/0156*` (sin `src/`, sin package).
- Convención confirmada: prod usa `version=timestamp` + `name=0NNN_...`.

## Etapa 2 — Aplicación de `0156` (✅)
- `apply_migration(name='0156_fix_connect_search_ambiguous_conversation_id')` → **`{"success": true}`**.
- Registrada en `schema_migrations`: `version=20260701025846`, `name=0156_fix_connect_search_ambiguous_conversation_id`.

## Etapa 3 — Checkpoints post-apply (✅)
- Def refleja el fix: `tiene_fix=true`, `tiene_bug=false`.
- Preservado: firma `connect_search(text,integer)`, `RETURNS TABLE`, `SECURITY DEFINER`, `search_path=public, pg_temp`, owner `postgres`, grants `authenticated/postgres/service_role:EXECUTE`.
- No se modificaron tablas, datos, RBAC ni permisos.

## Etapa 4 — Smoke RPC (❌ — SEGUNDO bug descubierto)
- `connect_search('mensaje')` (en contexto auth de `martin@`) **ya NO lanza `42702`** (bug #1 corregido).
- **PERO lanza un error nuevo:**
  ```
  ERROR 0A000: invalid UNION/INTERSECT/EXCEPT ORDER BY clause
  DETAIL: Only result column names can be used, not expressions or functions.
  CONTEXT: connect_search line 17 at RETURN QUERY
  ```
- **Causa (F-SEARCH-2):** `order by sort_rank asc, occurred_at desc nulls last` sobre el UNION referencia nombres que no son columnas del resultado del UNION (los SELECT no llevan alias) y colisionan con las variables OUT del `RETURNS TABLE`. Bug **pre-existente en `0153`**, estaba **enmascarado** por el `42702` (ambos en el mismo RETURN QUERY; Postgres reportaba el primero). Al corregir #1, salió #2.
- **Criterio de éxito NO cumplido:** ninguna búsqueda devuelve resultado todavía (search sigue rota, con `0A000`).

## Decisiones (disciplina)
- **NO se improvisó** el fix de #2 (fuera del alcance autorizado de `0156`).
- **NO se hizo rollback** de `0156`: es un fix correcto y verificado; revertir a `0153` reintroduce el `42702` **sin** restaurar una búsqueda funcional (contraproducente). `0156` es una base válida para completar el fix.
- **Fix de #2 validado read-only:** `order by 10 asc, 9 desc nulls last` (posicional; 10=sort_rank, 9=occurred_at) sobre el UNION **no lanza `0A000`** y **devuelve** `[PRUEBA-F3] Mensaje de validación`. Posicional es inmune a la colisión con variables OUT.
- **`0157` PREPARADA (NO aplicada):** `supabase/migrations/0157_fix_connect_search_union_order_by.sql` (CREATE OR REPLACE con la calificación de `0156` + ORDER BY posicional). Requiere **autorización de Dirección para aplicar**.

## Estado
- Producción: `88add4b`. `0156` **aplicada** (bug #1 corregido). `connect_search` **aún no funcional** por F-SEARCH-2 → **`0157` pendiente de autorización**.
- **Rollback NO requerido/NO ejecutado.** Sin cambios de datos.
- **Commit local NO creado** (Etapa 8 condicionada a smoke OK; el smoke aún no pasa → se difiere el commit hasta que `0157` deje la búsqueda funcional).
- **F4 sigue BLOQUEADA.**

---

## Etapa 2b — Aplicación de `0157` (✅ RESUELTO)
- `apply_migration(name='0157_fix_connect_search_union_order_by')` → **`{"success": true}`**. Registrada en `schema_migrations` (`name=0157_fix_connect_search_union_order_by`).
- **Checkpoints:** `orderby_fix_ok=true` (`order by 10 asc, 9 desc`), `orderby_problematico=false`, `fix_conversation_id_ok=true` (0156 retenido); **preservados** firma `connect_search(text,integer)`, `RETURNS TABLE`, `SECURITY DEFINER`, `search_path=public,pg_temp`, owner `postgres`, grants `authenticated/postgres/service_role:EXECUTE`; sin cambios de tablas/datos/RBAC/permisos.
- **Smoke RPC (sin `42702` ni `0A000`):** `mensaje`→1, `validación`→1, `PRUEBA-F3`→1 (los 3 devuelven `message: [PRUEBA-F3] Canal piloto | [PRUEBA-F3] Mensaje de validación`). `validacion` (sin tilde)→0 (FTS español no des-acentúa). `canal`/`piloto`→0 (solo en título; canal ARCHIVADO → rama título lo excluye por diseño).
- **Smoke UI:** `/connect/buscar?q=mensaje` → **"Búsqueda global · 1 resultado"**, muestra `[PRUEBA-F3] Canal piloto / [PRUEBA-F3] Mensaje de validación / CTX-2026-000001`. **0 errores de consola, 0 5xx.** La UI ya NO enmascara el error como "sin resultados".
- **Rollback: NO requerido.**

## Resultado final
**✅ HOTFIX COMPLETO Y EXITOSO.** `connect_search` **funcional en producción** (`0156` corrige `42702`; `0157` corrige `0A000`). Búsqueda operativa a nivel RPC **y** UI. Criterio de éxito cumplido: al menos una búsqueda real devuelve el mensaje; sin `42702`/`0A000`/5xx; sin cambios de datos; sin rollback. Commit local `fix(db): repair Nexus Link search RPC` (docs + migraciones `0156`/`0157`, sin push/merge).

## Pendiente (para cierre formal de F3)
1. Validación manual de los 7 usuarios habilitados (runbook), incluyendo re-test de búsqueda con un rol-holder.
2. Aceptación formal de deudas no bloqueantes (H-1, hydration shell, `seguridad→knowledge.edit`).
3. Aprobación de cierre de F3 por Dirección.
4. **F4 permanece BLOQUEADA** hasta lo anterior + autorización explícita.
