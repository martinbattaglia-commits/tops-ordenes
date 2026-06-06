# CRM_STAGING_GO_NO_GO_REPORT — CRM Comercial F2.1

**Fase:** 4–5 — Validación dirigida + decisión · **Entorno:** staging (no prod) · **Fecha:** 2026-06-06
**Pregunta:** ¿GO o NO GO para pasar a la fase de activación / producción?

---

## VEREDICTO: 🟢 **GO**

**Tras corregir el harness (Opción A) y re-ejecutar: `46 tests · 46 PASS · 0 FAIL`, con R-G2 CONFIRMADO.**

> **Trazabilidad honesta (evidencia formal):**
> 1. **1ª corrida → NO GO** (9 FAIL) — causa raíz: el script de validación chocaba con el trigger `on_auth_user_created → handle_new_user` de staging (auto-crea `profiles`). **No era defecto del dominio.**
> 2. **Corrección de Opción A** — solo el **harness** (`CRM_STAGING_VALIDATION.sql`): insertar `auth.users`, dejar que el trigger cree el profile, y **UPDATE** del role. **No se tocó dominio / migraciones / RLS / RBAC / esquema.**
> 3. **2ª corrida → GO** — `failed = 0`, **R-G2 = PASS**.
> No fue necesario `0047_*` (R-G2 no falló tras el arreglo del harness).

---

## Fase 4 — Validación dirigida (lo que pidió el master prompt)

| Verificación | Resultado | Estado |
|---|---|---|
| **R-G2** · `has_permission()` bajo usuario `comercial` | ✅ **VERIFICADO (2ª corrida)** — `val=true`. Funciona bajo `authenticated` **a pesar** de que las tablas RBAC tienen RLS (`con RLS=3`): el RBAC de 0009 ya habilita el self-read. **No se requiere `security definer` ni `0047`.** | 🟢 GO |
| **R-G3** · `profiles_public` | ✅ **VERIFICADO** — legible por `authenticated` (5 filas) y **sin columna email**. | 🟢 GO |
| **R-G1** · `ON DELETE RESTRICT` contratos | ✅ **VERIFICADO** — borrar oportunidad con contrato → **bloqueado**. | 🟢 GO |
| **Public IDs** · LEAD/OPP/QUOTE/PROP/CONT/ONB | ✅ **VERIFICADO** — los 6 generan correctamente (`LEAD-2026-0001`, `OPP-…`, `COT-…`, `PROP-…`, `CON-…`, `ONB-…`). | 🟢 GO |
| **Ledgers** · `crm_stage_history` / `clientify_sync_log` | ✅ **VERIFICADO** — UPDATE bloqueado (0 filas), inmutables. | 🟢 GO |

**4 de 5 verificaciones dirigidas en verde.** La única abierta — **R-G2** — es justamente la más importante para la seguridad del acceso comercial, y no pudo evaluarse.

---

## Análisis del bloqueo

### Causa raíz
Staging ejecuta el trigger `on_auth_user_created → handle_new_user`, que **inserta automáticamente en `profiles`** cuando se crea un usuario en `auth.users`. El script de validación inserta `auth.users` y **luego** `profiles` explícitamente → colisión `profiles_pkey` → fallan los fixtures → sin usuarios de prueba, las secciones RBAC/RLS no se evalúan.

### Qué NO está en duda (verde en staging)
Migraciones (6/6 OK), estructura (10 tablas/10 enums/vista/RLS), public_id, R-G1, R-G3, cascade, FK, enums, uniques, ledgers inmutables, hook de capacidad dormido, y que la **RLS deniega** correctamente a usuarios sin permiso y a `cliente`.

### Qué falta confirmar
Que un usuario con rol **comercial**/**operaciones** efectivamente **pueda** operar (R-G2 + los "permitido" de la sección 8). Esto depende de poder crear los fixtures.

---

## Solución aplicada (Opción A — aprobada y ejecutada)

> Conforme al master prompt: el error de la 1ª corrida **no se corrigió automáticamente**; se documentó, se propuso y se **esperó aprobación**. Aprobada la Opción A, se aplicó **solo al harness**.

**El arreglo fue del harness de validación (`CRM_STAGING_VALIDATION.sql`), NO del dominio ni del esquema.** Sección 6 (fixtures), adaptada al trigger `handle_new_user`:

- ✅ **Opción A (aplicada):** insertar solo `auth.users`, dejar que el trigger cree los `profiles`, y **`UPDATE`** el `role` de esos profiles (en vez de insertarlos). Se mantiene el insert de `user_roles`.
- No se tocó: dominio, migraciones, RLS, RBAC, esquema.

**Resultado de la re-validación:** `R-G2 = PASS` (`val=true`). `has_permission()` funciona bajo `authenticated` a pesar de la RLS en las tablas RBAC → **no se necesitó `0047_*` ni `security definer`.**

---

## Re-validación (2ª corrida, harness Opción A) — RESULTADO

| Total | PASS | FAIL |
|---|---|---|
| **46** | **46** | **0** |

Confirmaciones clave:
- `6-fixtures` → **5/5 profiles** (trigger + UPDATE) ✅
- `7-rbac` → comercial **TRUE** (R-G2) · operaciones TRUE · admin TRUE · sin-permiso FALSE · cliente FALSE ✅
- `8-rls` → INSERT permitido a comercial **y** operaciones · DELETE denegado a operaciones · cliente insert✗ / SELECT=0 · comercial SELECT=7 filas ✅

## Camino recorrido a GO (completado)

1. ✅ Ajuste del harness (Opción A) — sin tocar dominio/esquema.
2. ✅ Re-ejecución completa en staging → **`failed = 0`**.
3. ✅ **R-G2 = PASS**, sección 8 "permitido" en verde.
4. ✅ `0047_*` **no necesario** (R-G2 no falló tras el arreglo).
5. ➡️ **GO** para **F2.1-4** (activación de `committed_m2`) y planificación de producción.

---

## Estado de producción y staging

- **Producción:** 🟢 **intacta** (ref `arsksytgdnzukbmfgkju` jamás tocada).
- **Staging:** CRM aplicado (0041–0046), **sin datos residuales** de test (rollback). Listo para re-validar.
- **main / Netlify / Capacity Engine / Dashboard / Clientify PROD:** sin cambios.

---

## Resumen ejecutivo (1 línea)

**GO** — el dominio CRM Comercial F2.1 se aplicó y validó en staging con **46/46 tests en verde** (R-G1, R-G2, R-G3, public IDs, ledgers, RLS por rol ✅). La 1ª corrida marcó un choque del **script de prueba** con un trigger de staging (`handle_new_user`); corregido el harness (Opción A, sin tocar dominio), la 2ª corrida confirmó **`failed = 0`** y **R-G2**. Listo para **F2.1-4** (activación de capacidad). Producción intacta.
