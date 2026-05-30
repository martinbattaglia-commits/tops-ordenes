# RBAC-SANDBOX-EXECUTION-PLAN

**Fecha:** 2026-05-30
**Bloqueante:** P0.2 (RBAC) — cierre previo a Track Backup GCS.
**Entorno objetivo:** SANDBOX `vrxosunxlhohmqymxots` (tops-nexus-staging).
**Estado:** 📋 **plan · NO ejecutado**. Diseño de sandbox + diseño de pruebas + validaciones read-only.
**Restricciones honradas:** 🛑 NO EJECUTAR SQL · NO CREAR USUARIOS · NO MODIFICAR SANDBOX · NO MODIFICAR PRODUCCIÓN · NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT.

> **Insumos verificados (read-only, 2026-05-30):**
> - Matriz `role_permissions` live de `director_ops`/`admin` (query `read_only:true` contra sandbox — ver Apéndice A).
> - Lectura de código de enforcement: `src/lib/rbac/check.ts`, `src/middleware.ts`, guards en `src/app/api/drive/*`.
> - Catálogo: 7 roles · 24 permisos · `user_roles = 0` (RBAC **dormido**) en ambos entornos.

---

## 0 · Hallazgo crítico que condiciona TODO el plan

**El catálogo RBAC está 100% seedeado y es consistente, pero el _enforcement_ está cableado en UNA sola superficie.**

| Capa | Estado real (verificado en código) |
|------|-------------------------------------|
| Catálogo (`roles`, `permissions`, `role_permissions`) | ✅ Completo y consistente (7 roles / 24 permisos) |
| Asignaciones (`user_roles`) | ⚪ Vacío (0 filas) → RBAC **dormido**, fail-open |
| Guard server-side | ⚠️ **Solo** `GET /api/drive/ping` y `GET /api/drive/list`, ambos exigen `compliance.view` |
| Guard en páginas (`/billing`, `/cctv`, `/settings`, `/compras`, `/anmat`…) | ❌ **Ninguno** — solo gate de autenticación (login) vía middleware |
| Gating de UI por rol (ocultar items, botones) | ❌ **Ninguno** (`grep` sin resultados) |
| Acción crítica `compras.sign` (firma de OC) | ❌ **Sin guard server-side** todavía |

**Consecuencia para la validación:** la **única ruta RBAC end-to-end testeable hoy** es Drive (`compliance.view`). Por eso el plan define **dos niveles** de validación, y el criterio 🟢 RBAC VALIDADO se aplica honestamente a cada uno:

- **Nivel 1 — Enforcement real (end-to-end):** Drive API. Permite probar 200/403 reales con sesión.
- **Nivel 2 — Resolución (sin enforcement aún):** Billing, CCTV, Settings, Compras, Compliance-páginas. Se valida que la **capa de resolución** `user → role → permisos` devuelva el set correcto; el bloqueo efectivo de cada pantalla queda **pendiente de cablear guards** (tarea de ingeniería separada, fuera de P0.2, registrada en §6).

Esto **no** invalida P0.2: P0.2 es "habilitar RBAC vivo" (seedear `user_roles` + confirmar que el motor de checks resuelve y deniega correctamente). El cableado exhaustivo de guards por pantalla es una fase posterior (ETAPA 1).

---

## 1 · Estrategia Sandbox

### 1.1 · Situación de partida (verificada read-only)

- `joseluis@logisticatops.com` → **NO existe** en `auth.users` de sandbox.
- `ruth@logisticatops.com` → **NO existe** en `auth.users` de sandbox.
- `user_roles` = 0 filas.
- El script ya preparado `scripts/seed-rbac-assign-users-OPCION-A.sql` identifica por **email + slug** y tiene pre-flight `RAISE EXCEPTION` que **aborta si el usuario no existe**.

### 1.2 · Opciones evaluadas

| Opción | Descripción | Pros | Contras |
|--------|-------------|------|---------|
| **A · Espejar identidades reales** | Crear en sandbox `joseluis@` + `ruth@` + 1 usuario sin rol | Ensaya el **script exacto de prod** sin modificar una línea (mismos emails, mismo `ON CONFLICT`) → máxima fidelidad como dress-rehearsal | Reusa emails reales en staging (mitigado: sandbox es entorno aislado, no se expone a terceros) |
| **B · Usuarios sandbox existentes** | Asignar roles a cuentas ya presentes en sandbox | No requiere crear cuentas | Las cuentas existentes NO son `joseluis@`/`ruth@` → habría que **editar el script** (romper la fidelidad 1:1 con prod) y no se ensaya el pre-flight real |
| **C · Usuarios sintéticos** | `test-director@sandbox.local`, etc. | Datos de prueba claramente separados de prod (sin PII) | El script de prod no se ejecuta tal cual → se valida un script distinto al que correrá en prod |

### 1.3 · Recomendación: **Opción A + tercer usuario sin rol**

**Crear (manualmente, por el operador) tres usuarios en sandbox:**

| Email | Propósito | Rol a asignar (vía script) |
|-------|-----------|----------------------------|
| `joseluis@logisticatops.com` | Espejo del Director real | `director_ops` |
| `ruth@logisticatops.com` | Espejo de Administración real | `admin` |
| `test-norole@sandbox.local` | Caso negativo (denegación) | **ninguno** (no se asigna) |

**Justificación:**

1. **Fidelidad de ensayo.** El objetivo final del Track A es *"que la única acción pendiente sea ejecutar el SQL ya preparado"*. El SQL preparado (`seed-rbac-assign-users-OPCION-A.sql`) está keyed a `joseluis@`/`ruth@`. Espejar esas identidades en sandbox convierte la prueba en un **dry-run 1:1 del bloque de producción** — incluido el pre-flight, los dos `INSERT … ON CONFLICT` y el `SELECT` de verificación. Cualquier otra opción valida un artefacto distinto del que correrá en prod.
2. **El caso negativo necesita un usuario SIN asignación.** El test de denegación (403) solo es real si existe un usuario autenticado que **no** está en `user_roles` *mientras la tabla globalmente tiene filas* (si la tabla está vacía, `check.ts` hace fail-open). `test-norole@sandbox.local` cubre exactamente eso.
3. **Aislamiento.** Sandbox es un proyecto Supabase separado de prod; reusar los emails ahí no expone PII a terceros ni contamina datos productivos. El usuario sintético usa dominio `.local` no enrutable.

> 🛑 **Este plan NO crea los usuarios.** La creación es un paso manual del operador (Supabase Dashboard → Authentication → Add user), documentado en §3 paso 1. Aquí solo se **diseña** la estrategia.

---

## 2 · Matriz de pruebas

### 2.1 · Mapeo dominio → permiso real → enforcement actual

Anclado a la matriz live (Apéndice A) y a los guards reales del código:

| Dominio (pedido) | Ruta | Permiso live que aplica | ¿Guard cableado hoy? | Nivel |
|------------------|------|--------------------------|----------------------|-------|
| **Drive** | `/api/drive/ping`, `/api/drive/list`, `/drive` | `compliance.view` | ✅ **SÍ** (`requireDrivePermission`) | **1 · end-to-end** |
| **Compliance** | `/anmat`, `/documental` | `compliance.view` / `compliance.edit` / `documental.*` | ❌ no (Drive API es el enforcement de facto de `compliance.view`) | 2 · resolución |
| **Compras** | `/compras`, firma OC | `compras.view` … `compras.sign` | ❌ no (incl. **`compras.sign` sin guard**) | 2 · resolución |
| **CCTV** | `/cctv` | `cctv.view` / `cctv.admin` | ❌ no | 2 · resolución |
| **Settings** | `/settings`, `/settings/roles`, `/settings/users` | `sistema.admin` | ❌ no | 2 · resolución |
| **Billing** | `/billing` | `analytics.view` (⚠️ **no existe `billing.*`** — divergencia D3) | ❌ no | 2 · resolución |

### 2.2 · Matriz de casos — Nivel 1 (Drive · enforcement real)

Estado **post-seed** (`user_roles` con 2 filas → RBAC ACTIVO):

| Caso | Usuario | Rol | Acción | Resultado esperado |
|------|---------|-----|--------|--------------------|
| N1-1 | `joseluis@` | `director_ops` | `GET /api/drive/list` | **200** · `enforced:true` (tiene `compliance.view`) |
| N1-2 | `ruth@` | `admin` | `GET /api/drive/list` | **200** · `enforced:true` (tiene `compliance.view`) |
| N1-3 | `test-norole@` | (ninguno) | `GET /api/drive/list` | **403** · `Permiso requerido: compliance.view` |
| N1-4 | `test-norole@` | (ninguno) | `GET /api/drive/ping` | **403** |
| N1-5 | (sin sesión) | — | `GET /api/drive/list` | **401** (cae en middleware antes del guard) |

Estado **pre-seed** (`user_roles` = 0 → RBAC DORMIDO, fail-open):

| Caso | Usuario | Rol | Acción | Resultado esperado |
|------|---------|-----|--------|--------------------|
| N0-1 | `joseluis@` | (sin asignar) | `GET /api/drive/list` | **200** · `enforced:false` + log WARN `fallback-allow` |
| N0-2 | `test-norole@` | (sin asignar) | `GET /api/drive/list` | **200** · `enforced:false` (mismo fallback dormido) |

> El contraste N0 → N1 es la prueba medular: demuestra la **transición dormido → activo** y que el fallback fail-open desaparece una vez seedeado.

### 2.3 · Matriz de casos — Nivel 2 (resolución por dominio)

Se valida que la **capa de resolución** (la misma query de `check.ts`: `user_roles → roles → role_permissions → permissions.slug`) devuelva el set correcto. **No** hay 200/403 de pantalla porque no hay guard; el resultado esperado es *"el permiso está/NO está en el set resuelto del usuario"*. Verificable read-only (Apéndice A) o con una ruta de prueba diseñada (no construida, §3 paso 6).

| Caso | Usuario | Rol | Dominio · permiso | ¿En el set del rol? (esperado) |
|------|---------|-----|-------------------|--------------------------------|
| N2-01 | `joseluis@` | `director_ops` | Compras · `compras.view` | ✅ sí |
| N2-02 | `joseluis@` | `director_ops` | Compras · **`compras.sign`** | ✅ **sí** (único rol que firma OC) |
| N2-03 | `ruth@` | `admin` | Compras · **`compras.sign`** | ❌ **NO** (admin no firma — test V9) |
| N2-04 | `ruth@` | `admin` | Compras · `compras.view` / `compras.create` / `compras.export` / `compras.delete` | ✅ sí (todo compras salvo sign) |
| N2-05 | `joseluis@` | `director_ops` | Compliance · `compliance.view` / `compliance.edit` | ✅ sí |
| N2-06 | `ruth@` | `admin` | Compliance · `compliance.view` / `compliance.edit` | ✅ sí |
| N2-07 | `joseluis@` | `director_ops` | Drive/Documental · `documental.view`/`create`/`delete` | ✅ sí · ❌ **NO** `documental.admin`/`export` |
| N2-08 | `ruth@` | `admin` | Drive/Documental · `documental.admin` / `documental.export` | ✅ **sí** (admin sí los tiene; director_ops no) |
| N2-09 | `joseluis@` | `director_ops` | CCTV · `cctv.view` / `cctv.admin` | ✅ sí |
| N2-10 | `ruth@` | `admin` | CCTV · `cctv.view` / `cctv.admin` | ✅ sí |
| N2-11 | `joseluis@` | `director_ops` | Settings · `sistema.admin` | ✅ sí |
| N2-12 | `ruth@` | `admin` | Settings · `sistema.admin` | ✅ sí |
| N2-13 | `joseluis@` | `director_ops` | Billing · `analytics.view` | ✅ sí (no existe `billing.*` — D3) |
| N2-14 | `ruth@` | `admin` | Billing · `analytics.view` | ✅ sí |
| N2-15 | `test-norole@` | (ninguno) | **cualquier** permiso | ❌ NO (set vacío) → 403 cuando exista guard |

> **Diferenciadores clave a probar explícitamente:** N2-02 vs N2-03 (`compras.sign` solo director_ops) y N2-07 vs N2-08 (`documental.admin`/`export` solo admin). Son los dos puntos donde `director_ops` y `admin` divergen.

---

## 3 · Plan de ejecución Sandbox (paso a paso)

> Desde *usuario inexistente* hasta *validación completa de permisos*. **El operador ejecuta manualmente; este documento no ejecuta nada.**

### Paso 0 · Pre-condiciones del entorno
- [ ] Confirmar que la app apunta al proyecto **sandbox** (`NEXT_PUBLIC_SUPABASE_URL` = sandbox) en el contexto de prueba.
- [ ] Confirmar `SUPABASE_SERVICE_ROLE_KEY` de sandbox presente (sin ella, `check.ts` cae a fail-closed self-only — cambia los resultados; ver Apéndice B).
- [ ] Confirmar `NEXT_PUBLIC_DEMO_MODE=0` en el contexto de prueba (si fuera 1, `check.ts` hace fail-open global y NO se puede validar enforcement).

### Paso 1 · Crear los 3 usuarios de prueba (manual)
- [ ] Supabase Dashboard (sandbox) → Authentication → Add user: `joseluis@logisticatops.com`, `ruth@logisticatops.com`, `test-norole@sandbox.local` (con password temporal cada uno).
- [ ] Verificar (read-only) que los 3 aparecen en `auth.users`.

### Paso 2 · Baseline DORMIDO (pre-seed)
- [ ] Confirmar `user_roles = 0` (read-only).
- [ ] Loguear como `joseluis@` → `GET /api/drive/list` → esperar **200** + log WARN `fallback-allow` (caso N0-1).
- [ ] Loguear como `test-norole@` → `GET /api/drive/list` → **200** `enforced:false` (caso N0-2).
- [ ] **Registrar evidencia** (status + línea de log) de que el fallback dormido funciona.

### Paso 3 · Ejecutar el seed preparado (BLOQUE SANDBOX)
- [ ] Abrir `scripts/seed-rbac-assign-users-OPCION-A.sql` → copiar **solo el Bloque 1 · SANDBOX**.
- [ ] Pegar en SQL Editor de sandbox. El pre-flight ahora pasa (usuarios existen).
- [ ] Revisar que el `SELECT` de verificación muestre **exactamente 2 filas**: `(joseluis@, director_ops, 'Director de Operaciones')`, `(ruth@, admin, 'Administración · Verotin S.A.')`.
- [ ] Descomentar `COMMIT;` → ejecutar. (Si algo no cuadra → `ROLLBACK;`.)

### Paso 4 · Validación Nivel 1 (Drive · enforcement real, post-seed)
- [ ] `joseluis@` → `GET /api/drive/list` → **200** `enforced:true` (N1-1).
- [ ] `ruth@` → `GET /api/drive/list` → **200** `enforced:true` (N1-2).
- [ ] `test-norole@` → `GET /api/drive/list` → **403** `compliance.view` (N1-3).
- [ ] `test-norole@` → `GET /api/drive/ping` → **403** (N1-4).
- [ ] Sin sesión → `GET /api/drive/list` → **401** (N1-5).
- [ ] Confirmar en logs que ya **no** aparece `fallback-allow` para usuarios asignados (el `enforced` pasó a `true`).

### Paso 5 · Validación Nivel 2 (resolución, read-only)
- [ ] Ejecutar la query de resolución del Apéndice A contra sandbox → confirmar set por rol.
- [ ] Verificar los diferenciadores: `compras.sign` ∈ director_ops ∧ ∉ admin (N2-02/03); `documental.admin`+`export` ∈ admin ∧ ∉ director_ops (N2-07/08).
- [ ] Marcar cada fila de §2.3 como ✅/❌ según el set resuelto.

### Paso 6 · (Opcional, diseñado · NO construido) Ruta de prueba de resolución
- Diseño de una ruta efímera `GET /api/_rbac-selftest` que llame `checkPermission(req, <slug>)` para un slug parametrizado y devuelva `{enforced, ok}` — permitiría ejercitar el motor de `check.ts` por dominio sin cablear cada pantalla. **No se implementa en P0.2** (requiere escribir código). Se deja como opción para validación Nivel 2 end-to-end si se desea más adelante.

### Paso 7 · Reset / decisión de cierre sandbox
- [ ] Opción reversible: para re-probar el estado dormido → `BEGIN; DELETE FROM user_roles WHERE user_id IN (...); ROLLBACK|COMMIT;` (sandbox).
- [ ] Dejar sandbox seedeado como evidencia del ensayo exitoso, o limpiarlo según preferencia del operador.

---

## 4 · Criterios de aprobación — 🟢 RBAC VALIDADO

Se considera **RBAC VALIDADO (sandbox)** y P0.2 listo para promoción cuando **todos** estos criterios se cumplen y quedan evidenciados:

### C1 · Transición dormido → activo demostrada
- [ ] Pre-seed: Drive devuelve **200 `enforced:false`** + log `fallback-allow` (N0-1, N0-2).
- [ ] Post-seed: el `SELECT` muestra exactamente **2 filas** correctas.

### C2 · Enforcement real correcto (Nivel 1 · Drive)
- [ ] `director_ops` → **200 `enforced:true`** (N1-1).
- [ ] `admin` → **200 `enforced:true`** (N1-2).
- [ ] usuario sin rol → **403** (N1-3, N1-4).
- [ ] sin sesión → **401** (N1-5).
- [ ] Cero `500` / cero `query-failed` / cero `seed-count-failed` en logs durante la prueba.

### C3 · Resolución correcta (Nivel 2 · matriz)
- [ ] El set de `director_ops` = 22 permisos del Apéndice A; incluye `compras.sign`; excluye `documental.admin`/`export`.
- [ ] El set de `admin` = 23 permisos del Apéndice A; excluye `compras.sign`; incluye `documental.admin`/`export`.
- [ ] usuario sin rol → set vacío.

### C4 · Sin regresión de seguridad
- [ ] `SUPABASE_SERVICE_ROLE_KEY` presente → el conteo global de seed usa service role (no se evalúa sobre el subset RLS del usuario).
- [ ] `DEMO_MODE=0` confirmado durante toda la prueba.

### C5 · Brecha de enforcement documentada y aceptada
- [ ] Queda registrado que Billing/CCTV/Settings/Compras/Compliance-páginas **resuelven** permisos correctamente pero **aún no tienen guard de pantalla** (Nivel 2), y que esto es una tarea de ETAPA 1 separada — **no** bloquea P0.2 (que es habilitar el motor RBAC vivo).

> **Definición honesta de 🟢:** "El motor RBAC resuelve y deniega correctamente, demostrado end-to-end en la superficie enforced (Drive) y por resolución en el resto. El catálogo y las asignaciones son correctos." NO significa "las 6 pantallas bloquean por rol" — eso es ETAPA 1.

---

## 5 · Plan de promoción a PRODUCCIÓN (diseño · NO ejecutar)

> Se diseña el paso posterior; **no se ejecuta** en esta tarea.

### 5.1 · Pre-condiciones de promoción
- [ ] **C1–C5 cumplidos en sandbox** (sección 4) con evidencia archivada.
- [ ] **P0.1 Backup CERRADO** (gate duro — no seedear prod sin respaldo).
- [ ] **Aprobación explícita del presidente** (firma en `RBAC-GATE-CHECKLIST.md`).
- [ ] Confirmar que `joseluis@`/`ruth@` existen en prod (ya verificado read-only: ✅ ambos existen).

### 5.2 · Ejecución (operador, manual)
1. Abrir `scripts/seed-rbac-assign-users-OPCION-A.sql` → **Bloque 2 · PRODUCCIÓN**.
2. Confirmar en el dashboard que el proyecto activo es `arsksytgdnzukbmfgkju` (prod) **antes** de pegar.
3. Ejecutar dentro de la transacción; revisar el `SELECT` (2 filas, IDs esperados del Apéndice del reporte read-only).
4. `COMMIT` solo si las 2 filas son correctas; de lo contrario `ROLLBACK`.

### 5.3 · Verificación post-promoción (read-only + smoke)
- [ ] Read-only: `user_roles` de prod = 2 filas correctas.
- [ ] Smoke con sesión real del Director: `GET /api/drive/list` → 200 `enforced:true`.
- [ ] Logs de prod sin `fallback-allow` para usuarios asignados.

### 5.4 · Rollback de producción
- [ ] `BEGIN; DELETE FROM user_roles WHERE user_id IN (<josé>,<ruth>); COMMIT;` deja el sistema en estado dormido (fail-open) — reversible y seguro. Documentar antes de ejecutar.

---

## 6 · Brecha de enforcement (registro para ETAPA 1 · fuera de P0.2)

Tarea de ingeniería separada (no parte de este plan, registrada para trazabilidad):

1. Cablear `checkPermission`/guard en las rutas/acciones de Compras (especialmente la **firma de OC** → `compras.sign`), CCTV (`cctv.view`), Settings (`sistema.admin`), Billing (`analytics.view` o crear `billing.*`), y páginas de Compliance.
2. Resolver **D3**: decidir si se crea el permiso `billing.*` o se reusa `analytics.view` para /billing.
3. Gating de UI por rol (ocultar items del sidebar / botones sin permiso).
4. Tras cablear: extender esta matriz a Nivel 1 (200/403 reales) para los 6 dominios.

---

## 7 · Restricciones honradas

- 🛑 NO se ejecutó SQL (solo `SELECT` read-only para anclar la matriz — Apéndice A).
- 🛑 NO se crearon usuarios (la creación es un paso manual diseñado, no ejecutado).
- 🛑 NO se modificó sandbox ni producción · NO deploy · NO merge · NO push · NO commit.
- 🛑 Documento **nuevo**; no toca código ni el script `.sql` ya preparado.

---

## Apéndice A · Matriz live verificada (read-only, 2026-05-30)

Query (`read_only:true`, sandbox `vrxosunxlhohmqymxots`):

```sql
SELECT r.slug AS role, p.slug AS perm
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.slug IN ('director_ops','admin')
ORDER BY r.slug, p.slug;
```

**`director_ops` — 22 permisos:**
`analytics.view`, `cctv.admin`, `cctv.view`, `cockpit.export`, `cockpit.view`, `comercial.edit`, `comercial.view`, `compliance.edit`, `compliance.view`, `compras.create`, `compras.delete`, `compras.edit`, `compras.export`, **`compras.sign`**, `compras.view`, `documental.create`, `documental.delete`, `documental.view`, `servicios.create`, `servicios.sign`, `servicios.view`, `sistema.admin`

**`admin` — 23 permisos:**
`analytics.view`, `cctv.admin`, `cctv.view`, `cockpit.export`, `cockpit.view`, `comercial.edit`, `comercial.view`, `compliance.edit`, `compliance.view`, `compras.create`, `compras.delete`, `compras.edit`, `compras.export`, `compras.view`, **`documental.admin`**, `documental.create`, `documental.delete`, **`documental.export`**, `documental.view`, `servicios.create`, `servicios.sign`, `servicios.view`, `sistema.admin`

**Diferencias (los 2 puntos de prueba clave):**
- `director_ops` ∖ `admin` = { **`compras.sign`** }  → solo el Director firma OC.
- `admin` ∖ `director_ops` = { **`documental.admin`**, **`documental.export`** } → solo admin administra/exporta documental.

---

## Apéndice B · Semántica de `src/lib/rbac/check.ts` (referencia)

| Condición | Resultado |
|-----------|-----------|
| `demoMode` o Supabase no configurado | fail-open `enforced:false` |
| Sin sesión | **401** |
| `user_roles` global = 0 (vía **service role**) | fail-open `enforced:false` + WARN `fallback-allow` (DORMIDO) |
| `user_roles` global > 0 ∧ user tiene el permiso | **200** `enforced:true` |
| `user_roles` global > 0 ∧ user **sin** el permiso | **403** |
| Sin `SUPABASE_SERVICE_ROLE_KEY` | fail-**closed** sobre subset propio: 403 si el user no tiene asignación propia |
| Error de query/conteo | fail-closed **403** (no fail-open silencioso) |

> Por eso el Paso 0 exige confirmar service role + `DEMO_MODE=0`: ambos cambian materialmente el resultado de las pruebas.
