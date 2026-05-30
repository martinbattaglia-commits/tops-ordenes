# RBAC-SANDBOX-DRYRUN

**Fecha:** 2026-05-30
**Naturaleza:** 🧪 **simulación en papel**. Traza exacta del flujo que ocurrirá en sandbox, derivada del código real. **NO se ejecuta SQL · NO se crean usuarios · NO se modifica nada.**
**Bloqueante:** P0.2 (RBAC) · cierre.
**Insumos:** `src/lib/rbac/check.ts`, `src/app/api/drive/list/route.ts`, `src/app/api/drive/ping/route.ts`, `scripts/seed-rbac-assign-users-OPCION-A.sql`, matriz live read-only (Apéndice A de `RBAC-SANDBOX-EXECUTION-PLAN.md`).
**Restricciones honradas:** 🛑 NO SQL · NO usuarios · NO sandbox · NO prod · NO deploy · NO merge · NO push · NO commit.

---

## 0 · Modelo de simulación (cómo leo el resultado de cada escenario)

Cada request a Drive atraviesa, **en este orden**, el código de `src/app/api/drive/list/route.ts`:

1. **Rate limit** (línea 49) → `429` si se supera (no relevante para RBAC; 60 req/min).
2. **Guard RBAC** (línea 72): `requireDrivePermission(req, "compliance.view")`. Si deniega, **corta acá** con `401`/`403`.
3. **`isDriveConfigured()`** (línea 75) → si Drive no tiene credenciales en sandbox, `503 "Drive no configurado"`. **Esto ocurre SÓLO si el guard ya pasó.**

> 🔑 **Regla de lectura del dry-run:**
> - **Guard PASA** ⇒ status **200** (Drive configurado) **o 503** "Drive no configurado" (Drive sin credenciales). **Ambos** demuestran autorización concedida.
> - **Guard DENIEGA** ⇒ **403** (con permiso) o **401** (sin sesión), y **nunca** llega al 503.
> - Lo que valida RBAC no es "200 vs 503", es **"pasó el guard (200/503) vs no pasó (403/401)"**.

Y el guard internamente (`checkPermission`, `src/lib/rbac/check.ts`) decide así:

| # | Rama en `check.ts` | Condición | Salida |
|---|---------------------|-----------|--------|
| R-demo | L72 | `demoMode` o Supabase no config | fail-open `enforced:false` |
| R-401 | L108 | sin `user` (sesión) | **401** |
| R-count | L122-144 | cuenta global `user_roles` vía **service role** | sigue |
| R-dormido | L180 | conteo global = 0 | fail-open `enforced:false` + WARN `fallback-allow` |
| R-resolve | L203-238 | arma set de permisos del user (`user_roles→roles→role_permissions→permissions.slug`) | sigue |
| R-ok | L240 | el set incluye el permiso | **200** `enforced:true` |
| R-403 | L261 | el set NO incluye el permiso | **403** |

**Estado de partida verificado (read-only):** `user_roles = 0` en sandbox → hoy TODO cae en **R-dormido** (fail-open). El dry-run simula el **antes** (dormido) y el **después** del seed (activo).

---

## 1 · Pre-condiciones de arranque que la simulación asume

Para que el resultado simulado coincida con la ejecución real, al momento de ejecutar deben darse (son setup, no "trabajo faltante"):

| Pre-cond | Por qué importa | Si NO se cumple |
|----------|-----------------|------------------|
| `NEXT_PUBLIC_DEMO_MODE=0` (contexto de prueba) | Si =1 → rama **R-demo** fail-open → no se puede validar enforcement | Todo da 200 `enforced:false`; la prueba no prueba nada |
| `SUPABASE_SERVICE_ROLE_KEY` (sandbox) presente | El conteo global de `user_roles` (R-count) necesita bypassear RLS | Cae a fail-**closed** self-only: no-role daría 403 incluso dormido (cambia N0) |
| App apunta a sandbox `vrxosunxlhohmqymxots` | Aislar de prod | Riesgo de probar contra prod |
| 3 usuarios creados (paso manual previo) | El seed identifica por email; el pre-flight aborta si faltan | `RAISE EXCEPTION` en el seed |

---

## 2 · Simulación del SQL (pre-flight del seed) — sin ejecutar

`scripts/seed-rbac-assign-users-OPCION-A.sql` · Bloque 1 · SANDBOX. Traza del `DO $$` pre-flight:

```
v_dir_u = count(auth.users WHERE email='joseluis@...')   -- esperado 1 (tras crear usuario)
v_adm_u = count(auth.users WHERE email='ruth@...')        -- esperado 1
v_dir_r = count(roles WHERE slug='director_ops')          -- = 1 (catálogo seedeado ✓)
v_adm_r = count(roles WHERE slug='admin')                 -- = 1 (catálogo seedeado ✓)
IF cualquiera = 0 → RAISE EXCEPTION (aborta, no inserta)
```

- **Si los 3 usuarios NO fueron creados aún:** `v_dir_u=0` → **RAISE EXCEPTION** `'FALTA usuario joseluis@ en sandbox...'` → 0 filas insertadas. ✅ comportamiento correcto y seguro (no inserta basura).
- **Si los usuarios existen:** pre-flight `NOTICE 'Pre-flight OK'` → 2 `INSERT … ON CONFLICT (user_id, role_id) DO NOTHING` → `SELECT` de verificación devuelve **2 filas**:

| email | slug | position_title |
|-------|------|----------------|
| `joseluis@logisticatops.com` | `director_ops` | `Director de Operaciones` |
| `ruth@logisticatops.com` | `admin` | `Administración · Verotin S.A.` |

> Idempotencia: re-correr el bloque no duplica (el `ON CONFLICT (user_id, role_id)` lo impide; índice `user_roles_pkey` confirmado en validación read-only).

---

## 3 · Escenario 1 — `joseluis@` · `director_ops`

**Permiso de Drive:** `compliance.view`. **¿director_ops lo tiene?** ✅ **Sí** (matriz live, Apéndice A).

### 3.1 · PRE-seed (estado actual, dormido)
| Paso | Rama | Resultado |
|------|------|-----------|
| sesión presente | — | sigue |
| conteo global `user_roles` = 0 | **R-dormido** | fail-open |
| **HTTP Drive** | — | **200/503** · `enforced:false` + WARN `fallback-allow` |

### 3.2 · POST-seed (tras paso 2, activo)
| Paso | Rama | Resultado |
|------|------|-----------|
| sesión presente | — | sigue |
| conteo global = 2 (>0) | R-count | sigue |
| set de director_ops incluye `compliance.view` | **R-ok** | autoriza |
| **HTTP Drive** | — | **200** (o **503** si Drive sin creds) · `enforced:true` |

**✅ Resultado esperado Esc.1:** acceso **CONCEDIDO** a Drive en ambos estados; tras el seed con `enforced:true` (ya no fallback). Es el caso "Director ve Drive".

---

## 4 · Escenario 2 — `ruth@` · `admin`

**¿admin tiene `compliance.view`?** ✅ **Sí** (matriz live). admin = 23 permisos, incluye `compliance.view`.

### 4.1 · PRE-seed → **R-dormido** → **200/503** `enforced:false` + WARN.
### 4.2 · POST-seed → set de admin incluye `compliance.view` → **R-ok** → **200** (o 503) `enforced:true`.

**✅ Resultado esperado Esc.2:** acceso **CONCEDIDO** a Drive. Nota: admin pasa Drive porque Drive gatea por `compliance.view` (no por un permiso exclusivo de director). La diferencia admin↔director NO se ve en Drive — se ve en `compras.sign` (Esc.5).

---

## 5 · Escenario 3 — usuario autenticado **sin rol** (`test-norole@sandbox.local`)

**Asignación:** ninguna (no se inserta fila para este usuario).

### 5.1 · PRE-seed (tabla globalmente vacía)
| Paso | Rama | Resultado |
|------|------|-----------|
| sesión presente | — | sigue |
| conteo global = 0 | **R-dormido** | fail-open |
| **HTTP Drive** | — | **200/503** `enforced:false` ⚠️ (fallback dormido permite) |

> ⚠️ **Punto fino:** PRE-seed, el usuario sin rol **también entra** por fail-open. Esto es esperado y correcto (RBAC dormido = nadie bloqueado). **Por eso el test de denegación SOLO es válido POST-seed.**

### 5.2 · POST-seed (tabla con 2 filas → globalmente NO vacía)
| Paso | Rama | Resultado |
|------|------|-----------|
| sesión presente | — | sigue |
| conteo global = 2 (>0) | R-count | sigue |
| set del usuario = ∅ (sin roles) → no incluye `compliance.view` | **R-403** | deniega |
| **HTTP Drive** | — | **403** `Permiso requerido: compliance.view` + WARN `denied` |

**Sub-caso sin sesión:** **R-401** en L108 → **401** (corta antes del 503).

**✅ Resultado esperado Esc.3:** PRE-seed **200/503** (fallback dormido); POST-seed **403**. La transición 200→403 del mismo usuario es la **prueba medular** de que el enforcement se activó.

---

## 6 · Escenario 4 — validación específica `compliance.view` sobre Drive

Es el **único permiso con enforcement end-to-end hoy**. Matriz de verdad POST-seed:

| Usuario | ¿tiene `compliance.view`? | Guard Drive | HTTP |
|---------|----------------------------|-------------|------|
| `joseluis@` (director_ops) | ✅ sí | PASA | **200/503** `enforced:true` |
| `ruth@` (admin) | ✅ sí | PASA | **200/503** `enforced:true` |
| `test-norole@` | ❌ no | DENIEGA | **403** |
| (sin sesión) | — | — | **401** |

**Lectura correcta del 503:** si sandbox no tiene `GOOGLE_SERVICE_ACCOUNT_JSON`/`GOOGLE_DRIVE_ROOT_FOLDER_ID`, director_ops y admin reciben **503 "Drive no configurado"** — y eso **igualmente prueba que el guard RBAC autorizó** (el 503 está después de la línea 73). El criterio de aprobación es *"no-role recibe 403 mientras los roles reciben 200 o 503"*.

**✅ Resultado esperado Esc.4:** discriminación correcta — roles con `compliance.view` pasan (200/503), usuario sin rol recibe 403, sin sesión 401.

---

## 7 · Escenario 5 — `compras.sign` · `director_ops` vs `admin`

**Diferenciador crítico (matriz live, Apéndice A):**
- `director_ops` → **✅ tiene `compras.sign`** (único rol que firma OC).
- `admin` → **❌ NO tiene `compras.sign`**.

### 7.1 · Realidad de enforcement (honesta)
🛑 **No existe ninguna ruta/acción con guard `checkPermission(req, "compras.sign")`** en el código (verificado: el único `requireDrivePermission`/`checkPermission` cableado es Drive con `compliance.view`). La firma de OC **aún no está protegida server-side** — es ETAPA 1.

Por lo tanto, en sandbox **hoy** este escenario **NO produce un 200/403 HTTP**. Se valida en la **capa de resolución** (la misma que usa `check.ts` en L203-238):

### 7.2 · Validación por resolución (read-only, sin ejecutar nada nuevo)
Query de set de permisos (Apéndice A de `RBAC-SANDBOX-EXECUTION-PLAN.md`), filtrando `compras.sign`:

| Usuario | Rol | `compras.sign` en el set resuelto | Veredicto |
|---------|-----|-----------------------------------|-----------|
| `joseluis@` | director_ops | **✅ presente** | Director **firmaría** OC |
| `ruth@` | admin | **❌ ausente** | Admin **NO firmaría** OC |

### 7.3 · Simulación contrafáctica (si el guard existiera)
Trazando `checkPermission(req, "compras.sign")` POST-seed con la lógica real:
- `joseluis@`: set incluye `compras.sign` → **R-ok** → **200** `enforced:true`.
- `ruth@`: set NO incluye `compras.sign` → **R-403** → **403** `Permiso requerido: compras.sign`.

**✅ Resultado esperado Esc.5:** la **resolución** diferencia correctamente (director sí, admin no). El bloqueo HTTP efectivo de la firma queda **pendiente de cablear (ETAPA 1)** — coherente con la limitación de P0.2 ya aceptada.

---

## 8 · Tabla consolidada de resultados esperados

| Esc. | Usuario | Rol | Superficie | PRE-seed | POST-seed | Tipo |
|------|---------|-----|------------|----------|-----------|------|
| 1 | joseluis@ | director_ops | Drive `compliance.view` | 200/503 `enforced:false` | **200/503 `enforced:true`** | Enforcement |
| 2 | ruth@ | admin | Drive `compliance.view` | 200/503 `enforced:false` | **200/503 `enforced:true`** | Enforcement |
| 3 | test-norole@ | — | Drive `compliance.view` | 200/503 (fallback) | **403** | Enforcement |
| 3b | (sin sesión) | — | Drive | 401 | **401** | Enforcement |
| 4 | (los tres) | — | Drive `compliance.view` | — | roles→200/503 · no-role→403 · anon→401 | Enforcement |
| 5 | joseluis@ vs ruth@ | director_ops/admin | `compras.sign` | — | **resolución:** dir ✅ / admin ❌ (HTTP pendiente ETAPA 1) | Resolución |

---

## 9 · Chequeo de bloqueadores (¿falta algo para ejecutar?)

| ¿Bloquea ejecución en sandbox? | Ítem | Estado |
|-------------------------------|------|--------|
| ❌ No | Catálogo (roles/permisos/role_permissions) | ✅ seedeado y consistente |
| ❌ No | Script de seed `user_roles` | ✅ preparado, idempotente, con pre-flight |
| ❌ No | Matriz de permisos director_ops/admin | ✅ verificada read-only |
| ❌ No | Lógica de `check.ts` | ✅ leída y trazada; ramas coherentes |
| ❌ No | Lectura del 503 vs 403 | ✅ documentada (no confundir Drive-no-config con denegación) |
| ⚙️ Setup (no es "falta") | Crear 3 usuarios sandbox | paso manual previo, documentado |
| ⚙️ Setup | `DEMO_MODE=0` + `SERVICE_ROLE_KEY` presente | verificar al arrancar (§1) |
| ⚠️ Limitación aceptada | `compras.sign` sin guard HTTP | validación por resolución; enforcement = ETAPA 1 |

**No hay ningún bloqueador técnico sobre los artefactos.** Lo pendiente es **setup de ejecución** (crear usuarios + confirmar 2 flags), que es parte del procedimiento, no trabajo faltante.

---

## 10 · RECOMENDACIÓN ÚNICA

# 🟢 LISTO PARA EJECUTAR EN SANDBOX

**Evidencia que sostiene el veredicto:**

1. **Artefactos correctos y verificados:** catálogo consistente (read-only), script de seed con pre-flight idempotente, matriz `director_ops`/`admin` confirmada contra la DB live.
2. **Flujo trazado contra código real:** los 5 escenarios se derivan línea a línea de `check.ts` + rutas Drive; los resultados esperados son deterministas.
3. **Transición demostrable:** PRE-seed (fail-open dormido) → POST-seed (enforced) produce el contraste 200→403 en el usuario sin rol (Esc.3) — la prueba medular de activación.
4. **Diferenciador clave cubierto:** `compras.sign` resuelve director✅/admin❌ (Esc.5), y `compliance.view` discrimina correctamente en Drive (Esc.4).

**Condiciones de arranque (parte del procedimiento, no bloqueadores):**
- (a) Crear los 3 usuarios en sandbox (`joseluis@`, `ruth@`, `test-norole@sandbox.local`).
- (b) Confirmar `NEXT_PUBLIC_DEMO_MODE=0` y `SUPABASE_SERVICE_ROLE_KEY` presente en el contexto de prueba.
- (c) Confirmar que la app apunta a sandbox.

**Limitación explícitamente aceptada (no degrada el 🟢):**
- `compras.sign` se valida por **resolución**, no por HTTP — su guard es ETAPA 1. Esto es exactamente el alcance de P0.2 acordado ("el motor RBAC resuelve correctamente", no "todas las pantallas protegidas").

> Con esto, la **próxima conversación de RBAC se reduce a una sola decisión**: *ejecutar o no ejecutar el SQL preparado en sandbox* (y, tras validar, promover a prod bajo `RBAC-GATE-CHECKLIST.md`).

---

## 11 · Restricciones honradas

- 🛑 NO se ejecutó SQL (la simulación es en papel; la query de matriz fue `read_only:true` previa).
- 🛑 NO se crearon usuarios · NO se modificó sandbox ni producción.
- 🛑 NO deploy · NO merge · NO push · NO commit.
- 🛑 Documento **nuevo**; no toca código ni el `.sql` preparado.
