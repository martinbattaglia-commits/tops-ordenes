# F3 · F-SEARCH — Hotfix Plan (`connect_search`)

> Plan de hotfix quirúrgico para corregir la búsqueda global de Nexus Link (`connect_search`), condición de cierre formal de F3 (decisión de Dirección 2026-07-01).
> **PREPARACIÓN read-only. NO aplicado a producción. Requiere autorización explícita para ejecutar.**
> Migración preparada: `supabase/migrations/0156_fix_connect_search_ambiguous_conversation_id.sql`.

---

## 1. Causa raíz confirmada

`public.connect_search(text,int)` (creada en mig `0153`, RC1.4) declara un `RETURNS TABLE(... conversation_id uuid ...)`. En PL/pgSQL, cada columna OUT del `RETURNS TABLE` es una **variable implícita**. Dentro del cuerpo, la CTE `my_convs` tiene una columna también llamada `conversation_id`, y el cuerpo la referencia **sin calificar** en 4 lugares:

```
... c.id in (select conversation_id from my_convs) ...            -- rama conversación (0153:55)
... c.id in (select conversation_id from my_convs) ...            -- rama erp_context   (0153:66)
... m.conversation_id in (select conversation_id from my_convs)   -- rama message       (0153:77)
... a.conversation_id in (select conversation_id from my_convs)   -- rama attachment    (0153:86)
```

Postgres no puede resolver `conversation_id` (¿variable OUT o columna de `my_convs`?) → lanza en **cada** ejecución:

```
ERROR 42702: column reference "conversation_id" is ambiguous
CONTEXT: PL/pgSQL function connect_search(text,integer) line 17 at RETURN QUERY
```

**Confirmado empíricamente** llamando la RPC directamente (ver `F3-PILOT-VALIDATION-LOG.md § Pasada #2b`). El guard `has_permission('connect.view')` **pasa** (la excepción es posterior, en el RETURN QUERY). Resultado: **la búsqueda falla siempre, para todos los usuarios**; la UI enmascara la excepción como "Sin resultados".

**Metadata de la función (prod):** owner `postgres` · `SECURITY DEFINER` · `search_path=public, pg_temp` · grants `EXECUTE` a `authenticated` (+ `service_role`, `postgres` por defecto) · 1 sola sobrecarga `connect_search(text,integer)`.

---

## 2. SQL propuesto (`0156`)

Cambio **quirúrgico**: calificar las 4 subqueries con alias explícito `mc`:

```
select mc.conversation_id from my_convs mc      -- ×4 (una por rama)
```

**Nada más cambia:** misma firma, mismo `RETURNS TABLE`, misma lógica, mismo `SECURITY DEFINER`/`search_path`, mismos grants (re-aplicados idénticos a `0153`). `CREATE OR REPLACE FUNCTION` preserva owner y ACL. Cierra con `notify pgrst, 'reload schema'` (igual que `0153`).

El archivo completo está en `supabase/migrations/0156_fix_connect_search_ambiguous_conversation_id.sql`.

*(Alternativa considerada y descartada: `#variable_conflict use_column` — resuelve globalmente pero cambia semántica de resolución en toda la función; se prefiere la calificación explícita, más acotada y auditable, que es lo pedido por Dirección.)*

---

## 3. Impacto esperado

- **Búsqueda global vuelve a funcionar** para todos los roles con `connect.view` (los 7 del piloto + admins).
- **Sin cambio** para ninguna otra RPC, tabla, RLS, permiso ni dato. Firma pública intacta → **la UI no requiere cambios** (llama `connect_search(p_query, p_limit)` igual).
- **Sin migración de datos** (solo `CREATE OR REPLACE FUNCTION`).
- Efecto inmediato tras `notify pgrst` (recarga de esquema PostgREST).

**Validación read-only ya realizada:** la subquery calificada es SQL válido y compatible con el esquema; ejecutada standalone con el uid del tester, la rama de mensajes devuelve el `[PRUEBA-F3] Mensaje de validación`. La ambigüedad plpgsql se elimina porque `mc.conversation_id` ya no puede resolver a la variable OUT.

---

## 4. Riesgos

| Riesgo | Sev. | Mitigación |
|---|---|---|
| Regresión de comportamiento de la función | Muy baja | Cambio limitado a calificación de columnas; lógica idéntica byte a byte salvo alias |
| Pérdida de grants/owner al reemplazar | Nula | `CREATE OR REPLACE` preserva ACL/owner; además se re-aplican `revoke/grant` idénticos a 0153 |
| PostgREST no recarga esquema | Baja | `notify pgrst, 'reload schema'` incluido; si no, esperar el ciclo de recarga o re-notificar |
| Aplicar sin autorización | N/A | **NO aplicar hasta GO explícito de Dirección** |
| Numeración de migración | Baja | `0156` verificado libre; sigue a `0155`; convención `NNNN_snake_case.sql` respetada |

---

## 5. Rollback

- **Reversible:** re-aplicar la definición de `0153` (restaura el estado previo = búsqueda rota, **no peor** que antes del hotfix). No hay datos que revertir.
- Como `CREATE OR REPLACE`, el rollback es simplemente correr de nuevo `0153_connect_search.sql`.
- No se requiere rollback de deploy ni de UI.

---

## 6. Mini-runbook de aplicación (a ejecutar SOLO con autorización)

**Pre-flight (read-only):**
1. `/api/version` = `88add4b`, prod sana, 0 5xx.
2. Confirmar def actual de `connect_search` = la de `0153` (ambigua) — `pg_get_functiondef`.
3. Confirmar `0156` no aplicada aún (la función sigue ambigua).
4. Confirmar `schema_migrations` no contiene `0156`.

**Aplicación:**
5. Aplicar `0156` vía `apply_migration` (MCP) o el mecanismo manual de G3 (NO push/deploy). Es solo `CREATE OR REPLACE FUNCTION` + `revoke/grant` + `notify`.
6. Registrar hora/resultado.

**Checkpoints post-apply:**
7. `pg_get_functiondef('public.connect_search'::regproc)` refleja las subqueries calificadas (`mc.conversation_id`).
8. Grants intactos (`authenticated` EXECUTE), owner `postgres`, SECDEF true, search_path `public, pg_temp`.
9. Llamada directa `select count(*) from connect_search('mensaje',30)` **NO lanza** 42702.

**Smoke funcional (ver §7).**

**GO/NO-GO de aplicación:** GO si pre-flight verde y `0156` revisada; NO-GO si prod inestable o def inesperada.

---

## 7. Smoke tests posteriores (post-`0156`)

> Nota: el canal de prueba `[PRUEBA-F3] Canal piloto` quedó **archivado** (`archived_at`). La rama de **título** filtra `archived_at is null` (por diseño) → una búsqueda por "piloto" NO lo devolverá mientras esté archivado. La rama de **mensajes** NO filtra archivado → "mensaje"/"validación" SÍ devuelven el mensaje.

- **Debe pasar (contenido real):**
  - Buscar `mensaje` → devuelve el `[PRUEBA-F3] Mensaje de validación` (rama message). ✅ esperado.
  - Buscar `validación` (o `validacion`) → ídem.
- **Para validar la rama de título** (opcional): **desarchivar** el canal `[PRUEBA-F3] Canal piloto` (acción segura y reversible) **o** crear un canal `[PRUEBA-F3]` activo nuevo, y buscar `piloto`/`canal` → debe devolver el canal.
- **Tokenización:** `PRUEBA-F3` puede o no matchear según el parser FTS (`websearch_to_tsquery` lo tokeniza como `prueba-f3`/`prueba`/`f3`); documentar. **Al menos una búsqueda del contenido real debe devolver resultado** (criterio de Dirección) → cubierto por `mensaje`/`validación`.
- **Regresión:** confirmar 0 5xx, sin error de consola nuevo, `/connect/buscar` renderiza resultados (no "Sin resultados" para contenido existente).
- Idealmente, re-test con un **rol-holder** (uno de los 7) en su sesión durante la validación manual.

---

## 8. Recomendación GO / NO GO para aplicar el hotfix

**🟢 GO (recomendado) para aplicar `0156`**, condicionado a autorización explícita de Dirección para tocar prod (aplicar migración). Justificación: causa raíz confirmada; fix mínimo/quirúrgico/idempotente/reversible; sin impacto en firma/UI/datos/otras RPC; validado read-only; grants/owner preservados. Es la vía correcta para habilitar el cierre de F3.

---

## 9. Confirmación: producción NO tocada

A la fecha de este plan, **NO** se aplicó `0156` ni ningún cambio a producción. Solo se hizo: lectura de código/migraciones, `pg_get_functiondef`/grants (read-only), un `SELECT` standalone de validación (read-only), y la **escritura del archivo de migración + este plan** (sin aplicar, sin commit, sin push, sin deploy). Producción sigue en `88add4b` con `connect_search` aún ambigua (búsqueda rota) hasta que Dirección autorice aplicar `0156`.

---

## 10. F4 sigue bloqueada

**F4 NO se inicia.** F3 solo se cierra formalmente cuando: `connect_search` corregido (aplicar `0156`) + smoke de búsqueda pasa + validación manual de los 7 completada o aceptada + deudas no bloqueantes documentadas + Dirección aprueba cierre + Dirección autoriza F4.
