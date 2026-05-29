# FASE 1 — PARIDAD · Cierre de PARIDAD-1 / PARIDAD-2 / PARIDAD-3

> **Estado:** en ejecución · **Fecha:** 2026-05-29 · **Modo:** CTO / Governance-first
> **Autorización:** Charter Maestro → "FASE 1 PARIDAD · Objetivo: Cerrar PARIDAD-1 PARIDAD-2 PARIDAD-3".
> **Metodología obligatoria:** Diagnóstico → Riesgos → Impacto → Plan → Rollback → Recomendación.
> **Prohibido sin aprobación explícita:** merge a `main`, deploy, `supabase db push`, ejecución de
> migraciones, activación de RBAC/ARCA/Documents, modificación de producción.

---

## 0. Resumen de estado

| Divergencia | Qué es | Estado al cierre de esta fase |
|-------------|--------|-------------------------------|
| **PARIDAD-1** | `main` no contenía el SQL de `0008`/`0009`/`0010` (sí aplicadas/pendientes en DB) | 🟢 **Preparado** — rama `fix/paridad-1-migraciones` lista. Falta **GATE A** (merge). |
| **PARIDAD-2** | El rector §5 y `erp-arquitectura-objetivo.md` sobre-declaraban tablas como creadas | ✅ **Cerrado** — docs corregidos contra DB real (rama `docs/consolidacion-arquitectonica`). |
| **PARIDAD-3** | El tracker `schema_migrations` solo conoce `0001`–`0005`; `0006`–`0009` quedaron fuera | ✅ **CERRADO (2026-05-29)** — `migration repair` ejecutado (GATE B). Tracker = `0001`–`0009`. Ver §7. |

PARIDAD-1 quedó **preparado** (rama no-`main`, sin deploy); PARIDAD-2 y PARIDAD-3 **cerrados**.
La única acción mutante fue GATE B sobre el **tracker** de migraciones — el esquema físico no cambió.

---

## 1. Diagnóstico (REGLA N°1: verificado, no asumido)

### PARIDAD-1 — Código (main) vs Migraciones (disco)
Re-verificado en vivo:

- Diferencia de archivos entre `origin/main` y `origin/wip/erp-consolidation` en `supabase/migrations/`
  = **exactamente 3 archivos**: `0008_purchase_orders.sql`, `0009_rbac.sql`, `0010_documents.sql`.
- Los 3 son **byte-idénticos** a los de `origin/wip/erp-consolidation` (checkout directo).
- `git diff --stat --cached origin/main` = `3 files changed, 728 insertions(+)`. Cero modificaciones,
  cero borrados — solo se **agregan** los 3 archivos faltantes.
- Las migraciones `0001`–`0007` y `0011` ya estaban presentes en `main`.

**Conclusión:** el alcance de PARIDAD-1 es aditivo y mínimo. No hay riesgo de pisar código existente.

### PARIDAD-2 — Documentación vs Base de datos real
- Rector `TOPS-NEXUS-ERP.md` §5 declaraba `documents` + 5 tablas ARCA como "creadas (0001–0011)".
- `erp-arquitectura-objetivo.md` §1 describía 5 tablas de la 0011 sin aclarar que **no existen**.
- Auditoría read-only confirmó: `documents`, `customer_invoices`, `invoice_items`, `fiscal_config`,
  `puntos_venta`, `invoice_audit` **NO existen** en la DB (0010/0011 no aplicadas).

**Conclusión:** desviación puramente documental, ya corregida (ver §4).

### PARIDAD-3 — Tracker de migraciones vs realidad aplicada
- `supabase_migrations.schema_migrations` registra **solo `0001`–`0005`**.
- La evidencia de esquema (enums, columnas, funciones, tablas) prueba que `0006`–`0009`
  **sí están aplicadas** en la DB — pero fuera del tracker.
- **Causa raíz:** `scripts/supabase-bootstrap.mjs` aplica SQL directo y **nunca escribe** en
  `schema_migrations` (grep = 0 coincidencias). Es deuda de **proceso**, no de datos.
- **Agravante de idempotencia:** `0008`/`0009`/`0010`/`0011` usan `create type ... as enum` **sin guard**.
  Re-ejecutarlas rompe con `type already exists`.

**Conclusión:** el tracker está desincronizado. `supabase db push` es **destructivo en potencia** hoy:
intentaría re-aplicar `0006`–`0011` y fallaría en el primer `create type`.

---

## 2. Riesgos

| ID | Riesgo | Prob. | Impacto | Mitigación |
|----|--------|-------|---------|------------|
| R1 | Merge de `fix/paridad-1` dispara deploy Netlify automático de `main` | Alta (si se mergea) | Medio | **GATE A**: merge solo con aprobación; el branch por sí solo NO deploya |
| R2 | `migration repair` mal escrito marca una migración inexistente | Baja | Bajo | Comando exacto pre-validado en §3; repair solo escribe el tracker, no ejecuta SQL |
| R3 | Alguien corre `supabase db push` antes de cerrar PARIDAD-3 | Media | **Alto** | Regla activa: prohibido `db push` hasta repair + idempotencia. Documentado en charter |
| R4 | Las 3 migraciones nuevas en `main` inducen a `db push` creyendo que faltan aplicar | Media | Alto | `0008`/`0009` ya están aplicadas; el doc aclara que solo falta **registrar**, no ejecutar |
| R5 | Aplicar `0010`/`0011` sin backup (RP6: sin backup externo) | — | Alto | Fuera de alcance de FASE 1; se trata como decisión separada con backup previo |

---

## 3. Plan de cierre (por divergencia)

### PARIDAD-1 → GATE A (requiere aprobación)
1. ✅ Rama `fix/paridad-1-migraciones` creada desde `origin/main`.
2. ✅ Checkout byte-idéntico de `0008`/`0009`/`0010` desde `origin/wip/erp-consolidation`.
3. ✅ Commit `4e20d62` + push (rama no-`main` → **no deploya**).
4. 🔒 **GATE A — PENDIENTE DE APROBACIÓN:** merge `fix/paridad-1-migraciones` → `main`.
   - Efecto colateral: **dispara deploy Netlify de producción** (solo `main` auto-deploya).
   - El merge NO ejecuta SQL ni toca la DB; solo alinea Código↔Migraciones.

### PARIDAD-2 → CERRADO
- Correcciones ya commiteadas en `docs/consolidacion-arquitectonica`. Sin merge requerido para
  que la documentación sea correcta (vive en la rama de docs). Ver §4.

### PARIDAD-3 → GATE B (requiere aprobación)
Mecanismo seguro = `migration repair` (escribe el tracker **sin ejecutar SQL**). NO usar `db push`.

```bash
# Pre-requisito: config.toml + link CLI verificado (ref arsksytgdnzukbmfgkju)
# Marca como aplicadas SOLO las que la evidencia de esquema confirma aplicadas:
supabase migration repair --status applied 0006
supabase migration repair --status applied 0007
supabase migration repair --status applied 0008
supabase migration repair --status applied 0009
# Resultado esperado: schema_migrations pasa de {0001..0005} a {0001..0009}.
# 0010 y 0011 se dejan SIN registrar (no están aplicadas) — correcto.
```

🔒 **GATE B — PENDIENTE DE APROBACIÓN:** ejecutar `migration repair` (toca el tracker de producción).

---

## 4. Impacto

- **PARIDAD-1 (preparado):** una vez mergeado, `main` deja de divergir de las migraciones. Riesgo de
  reconstrucción desde cero (Definición de Éxito #1/#2) eliminado para estas 3 migraciones.
- **PARIDAD-2 (cerrado):** la documentación deja de mentir sobre el estado de la DB. Cualquier futura
  decisión (aplicar 0010/0011) parte de una base honesta.
- **PARIDAD-3 (planificado):** tras GATE B, `db push` y `migration up` vuelven a ser seguros para
  `0010`/`0011` (previa idempotencia + backup). Hoy siguen prohibidos.

---

## 5. Rollback

| Acción | Rollback |
|--------|----------|
| Push de `fix/paridad-1-migraciones` | `git push origin --delete fix/paridad-1-migraciones` (no afecta main/DB) |
| **GATE A** merge a `main` | `git revert <merge_sha>` + nuevo deploy; las migraciones nuevas son aditivas, revertir el commit las quita del repo sin tocar la DB |
| **GATE B** `migration repair` | `supabase migration repair --status reverted 0006 0007 0008 0009` (vuelve el tracker a `0001`–`0005`). No ejecuta ni revierte SQL real |

---

## 6. Recomendación profesional

1. **Cerrar PARIDAD-2 ya** (hecho) — sin coste ni riesgo.
2. **Aprobar GATE A (merge PARIDAD-1)** en cuanto haya ventana de deploy. Es aditivo, byte-verificado y
   habilita la reconstrucción reproducible. Recomiendo hacerlo **antes** que GATE B, para que el repo y
   el tracker queden alineados en el mismo momento.
3. **Aprobar GATE B (`migration repair`)** inmediatamente después de GATE A. Solo escribe el tracker;
   es la acción de menor riesgo que desbloquea la gobernanza de migraciones.
4. **No** ejecutar `db push` ni aplicar `0010`/`0011` en esta fase: requieren idempotencia endurecida +
   backup externo (RP6), que son trabajo de una fase posterior.

**Decisión solicitada (al momento de redactar §1–§6):** ¿Apruebo GATE A y/o GATE B?
→ **GATE B fue aprobado y ejecutado el 2026-05-29.** Registro completo en §7. GATE A sigue pendiente.

---

## 7. Registro de ejecución — GATE B (2026-05-29)

**Autorización:** "AUTORIZACIÓN CONTROLADA – GATE B · Cerrar PARIDAD-3 · Regularizar el tracker · Sin
modificar esquema · Sin ejecutar SQL · Sin alterar datos productivos."

### 7.1 Tooling verificado
- `supabase` CLI `2.101.0`. Link parcial: `supabase/.temp/*` presente (ref `arsksytgdnzukbmfgkju`),
  `config.toml` **ausente** — el CLI igual conecta usando las credenciales del link almacenadas.
- Ejecución **no-interactiva**: `SUPABASE_ACCESS_TOKEN` (de `.env.local`, nunca commiteado) + `--linked`
  + `stdin < /dev/null` (un eventual prompt recibe EOF y falla rápido en vez de colgarse).

### 7.2 Verificación previa (read-only, vía Management API) — TODO confirmado
| Comprobación | Resultado |
|---|---|
| Tracker antes | `[0001, 0002, 0003, 0004, 0005]` |
| 0006 aplicada | ✅ índice `operators_full_name_uniq` (1) + 3 operadores reales activos |
| 0007 aplicada | ✅ `service_unit_t` = hs,km,pal,mes,un,**m3,viaje** |
| 0008 aplicada | ✅ `purchase_orders`, `po_items`, `po_events`, `po_email_sends` |
| 0009 aplicada | ✅ `roles`/`permissions`/`role_permissions`/`user_roles` + `current_role()`/`has_permission()` + `user_role_t` |
| 0010 **NO** aplicada | ✅ `documents` ausente (0), `document_type_t` ausente (0) |
| 0011 **NO** aplicada | ✅ `customer_invoices`/`invoice_items`/`fiscal_config`/`puntos_venta`/`invoice_audit` ausentes |
| RBAC | 7 roles / 22 permisos / 64 mapeos / `user_roles`=0 (dormido) |
| Tablas públicas | 20 |

### 7.3 Comando ejecutado
```bash
supabase migration repair --status applied 0006 0007 0008 0009 --linked < /dev/null
# → Repaired migration history: [0006 0007 0008 0009] => applied
# → Finished supabase migration repair.
```
`0010` y `0011` **excluidos deliberadamente** (no están aplicados).

### 7.4 Auditoría posterior — solo cambió el tracker
| Comprobación | Antes | Después | ¿Cambió? |
|---|---|---|---|
| Tracker | `[0001..0005]` | `[0001..0009]` | ✅ **sí (objetivo)** |
| Tablas públicas | 20 | 20 | no |
| `documents` | ausente | ausente | no |
| Tablas ARCA (0011) | ausentes | ausentes | no |
| Funciones `current_role`/`has_permission` | presentes | presentes | no |
| Buckets | 5 | 5 | no |
| Enums (incl. `service_unit_t`) | idénticos | idénticos | no |
| RBAC (7/22/64/0) | igual | igual | no (sigue dormido) |

`supabase migration list` post-repair: `0001`–`0009` con Local+Remote; `0010`/`0011` solo Local.
El CLI registró `name` + conteo de `statements` para `0006`–`0009` (real_operators/4,
extend_service_units/3, purchase_orders/67, rbac/40) pero **no ejecutó ese SQL** — el esquema físico
quedó intacto (verificado arriba).

### 7.5 Riesgo nuevo introducido por el cierre
> ⚠️ **Ahora el tracker conoce `0001`–`0009`, por lo que un `supabase db push` intentaría aplicar
> `0010` y `0011` como pendientes — DDL real (crearía `documents`, tablas ARCA, enums).** Antes fallaba
> al re-correr `0006`; ahora *avanzaría* a 0010/0011. **La prohibición de `db push` es MÁS crítica que
> antes** hasta endurecer idempotencia + tener backup externo (RP6) + cert X.509 para 0011.

### 7.6 Rollback de GATE B (si fuese necesario)
```bash
supabase migration repair --status reverted 0006 0007 0008 0009 --linked < /dev/null
# Devuelve el tracker a [0001..0005]. No ejecuta ni revierte SQL real.
```

### 7.7 Estado final FASE 1
- **PARIDAD-1:** preparado (rama `fix/paridad-1-migraciones`, commit `4e20d62`). **GATE A pendiente.**
- **PARIDAD-2:** cerrado.
- **PARIDAD-3:** ✅ **cerrado** — tracker alineado a la realidad (`0001`–`0009`), esquema sin cambios.
