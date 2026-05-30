# RBAC-EXECUTION-PACK

**Track:** A · RBAC (P0.2) — bloqueante de GATE 0.
**Fecha:** 2026-05-30
**Naturaleza:** documento **único y autosuficiente**. Un operador puede ejecutar el proceso completo (sandbox → producción) **sin abrir ningún otro documento**.
**Restricciones honradas:** 🛑 NO ejecuta SQL · NO crea usuarios · NO modifica sandbox ni producción · NO deploy · NO merge · NO push · NO commit. Es un instrumento de ejecución manual.
**Veredicto (sección 12):** 🟢 **READY FOR SANDBOX EXECUTION**.

**Consolida (insumos verificados):**
`RBAC-READONLY-VALIDATION.md` · `RBAC-SANDBOX-EXECUTION-PLAN.md` · `RBAC-GATE-CHECKLIST.md` · `RBAC-SEED-EXECUTION-PLAN.md` · `scripts/seed-rbac-assign-users-OPCION-A.sql` · lectura de `src/lib/rbac/check.ts`, `src/middleware.ts`, guards `src/app/api/drive/*`.

---

## 1 · Resumen ejecutivo (qué se va a hacer y por qué)

**Objetivo de P0.2:** encender el RBAC vivo. El catálogo (roles + permisos + grants) ya está seedeado y es idéntico en sandbox y prod; lo único que falta es **asignar 2 roles** en `user_roles` para pasar de **DORMIDO (fail-open)** a **ACTIVO (enforced)**.

**Mapeo aprobado por Presidencia (Opción A, 2026-05-30):**

| Usuario | Email | Rol (slug vivo) | `position_title` |
|---------|-------|------------------|-------------------|
| José Luis Rodríguez Silva | `joseluis@logisticatops.com` | `director_ops` | `Director de Operaciones` |
| Ruth Carrasquero | `ruth@logisticatops.com` | `admin` | `Administración · Verotin S.A.` |

**La transición se hace en 2 etapas:** primero **SANDBOX** (ensayo 1:1), luego **PRODUCCIÓN** (gate duro: requiere Backup P0.1 cerrado + aprobación). El SQL es **idéntico** en ambos entornos (portable por email+slug, sin UUIDs hardcodeados).

**Acción manual final del Track A:** pegar el bloque correspondiente del script en el SQL Editor de Supabase y hacer `COMMIT` si la verificación muestra 2 filas.

---

## 2 · Estado de partida (verificado read-only · 2026-05-29/30)

Vía Supabase Management API `POST /v1/projects/{ref}/database/query` con `read_only:true` (cero escrituras).

| Métrica | SANDBOX `vrxosunxlhohmqymxots` | PRODUCCIÓN `arsksytgdnzukbmfgkju` |
|---------|:-----------------------------:|:----------------------------------:|
| `roles` | **7** | **7** |
| `permissions` | **24** | **24** |
| `user_roles` (filas) | **0** (RBAC dormido) | **0** (RBAC dormido) |
| `joseluis@` en `auth.users` | ❌ **no existe** | ✅ existe (last sign-in 2026-05-27) |
| `ruth@` en `auth.users` | ❌ **no existe** | ✅ existe (last sign-in 2026-05-26) |

**Catálogo vivo — 7 roles (idéntico ambos entornos):** `admin`, `cliente_b2b`, `comercial`, `compliance`, `director_ops`, `operaciones`, `seguridad`.

> 🔴 **Divergencia D1 (resuelta a nivel decisión):** los slugs vivos son **`director_ops`/`admin`**, NO `director`/`administracion` (que asumía el seed viejo `seed-rbac-real-roles.sql`). Seedear con `director` insertaría **0 filas en silencio**. El script de este pack usa los slugs vivos correctos. Presidencia aprobó Opción A → D1 cerrado.

**IDs de producción (solo para verificar el resultado — NO hardcodear):**

| Entidad | UUID PRODUCCIÓN |
|---------|-----------------|
| user `joseluis@` | `3b1607c9-32c5-4ca0-91e1-19c82099b64d` |
| user `ruth@` | `5b635940-28be-43ab-a2bd-606481052bee` |
| role `director_ops` | `7ca43377-8678-4fd3-8f8a-995920809cb2` |
| role `admin` | `335f09d6-e8a3-4057-aae9-5fcdd700c07d` |

---

## 3 · Matriz de permisos vivos (qué resuelve cada rol)

Verificado read-only (2026-05-30). Estos son los sets que el motor debe resolver.

**`director_ops` — 22 permisos:**
`analytics.view`, `cctv.admin`, `cctv.view`, `cockpit.export`, `cockpit.view`, `comercial.edit`, `comercial.view`, `compliance.edit`, `compliance.view`, `compras.create`, `compras.delete`, `compras.edit`, `compras.export`, **`compras.sign`**, `compras.view`, `documental.create`, `documental.delete`, `documental.view`, `servicios.create`, `servicios.sign`, `servicios.view`, `sistema.admin`

**`admin` — 23 permisos:**
`analytics.view`, `cctv.admin`, `cctv.view`, `cockpit.export`, `cockpit.view`, `comercial.edit`, `comercial.view`, `compliance.edit`, `compliance.view`, `compras.create`, `compras.delete`, `compras.edit`, `compras.export`, `compras.view`, **`documental.admin`**, `documental.create`, `documental.delete`, **`documental.export`**, `documental.view`, `servicios.create`, `servicios.sign`, `servicios.view`, `sistema.admin`

**Los 2 diferenciadores que SÍ o SÍ hay que probar:**
- `director_ops` ∖ `admin` = { **`compras.sign`** } → solo el Director firma OC.
- `admin` ∖ `director_ops` = { **`documental.admin`**, **`documental.export`** } → solo Administración administra/exporta documental.

---

## 4 · Semántica del motor (`src/lib/rbac/check.ts`) — leer antes de validar

El resultado de las pruebas **cambia** según el entorno. Confirmar estas tres condiciones de contexto antes de validar:

| Condición del entorno | Efecto en `checkPermission()` |
|-----------------------|-------------------------------|
| `NEXT_PUBLIC_DEMO_MODE=1` o Supabase no configurado | fail-open `enforced:false` (no se puede validar enforcement) |
| Sin sesión | **401** (cae en middleware antes del guard) |
| `user_roles` global = 0 (leído vía **service role**) | fail-open `enforced:false` + log WARN `fallback-allow` → **DORMIDO** |
| `user_roles` global > 0 ∧ user tiene el permiso | **200** `enforced:true` |
| `user_roles` global > 0 ∧ user **sin** el permiso | **403** |
| Falta `SUPABASE_SERVICE_ROLE_KEY` | fail-**closed** sobre el subset propio (403 si el user no tiene asignación) |
| Error de query/conteo | fail-closed **403** (no fail-open silencioso) |

> Por eso el Paso 0 exige confirmar **`SUPABASE_SERVICE_ROLE_KEY` presente** y **`DEMO_MODE=0`**: ambos alteran materialmente el resultado.

**Brecha de enforcement (aceptada, fuera de P0.2 → ETAPA 1):** hoy el único guard server-side cableado es **Drive API** (`GET /api/drive/ping`, `GET /api/drive/list` → exigen `compliance.view`). Billing / CCTV / Settings / Compras (incl. **`compras.sign`**) / páginas de Compliance **resuelven** permisos correctamente pero **aún no bloquean por pantalla**. P0.2 = "encender el motor"; cablear cada guard es ETAPA 1.

Por eso la validación tiene **dos niveles**:
- **Nivel 1 (end-to-end real):** Drive API → 200/403/401 reales.
- **Nivel 2 (resolución):** resto de dominios → se verifica que el set resuelto sea correcto (read-only), sin 200/403 de pantalla.

---

## 5 · SQL · SANDBOX (Bloque 1)

> TARGET: **SANDBOX** `vrxosunxlhohmqymxots` (tops-nexus-staging) · SQL Editor.
> ⚠️ Pre-requisito (D2): `joseluis@` y `ruth@` **NO existen** en sandbox. Crear esas cuentas (Dashboard → Authentication → Add user) **antes**, o el pre-flight aborta con `RAISE EXCEPTION`. Idéntico en estructura al de prod (portable por email+slug).

```sql
-- =============================================================================
-- BLOQUE 1 · SANDBOX (vrxosunxlhohmqymxots) — Opción A: director_ops + admin
-- =============================================================================
BEGIN;

DO $$
DECLARE v_dir_u int; v_adm_u int; v_dir_r int; v_adm_r int;
BEGIN
  SELECT count(*) INTO v_dir_u FROM auth.users WHERE email='joseluis@logisticatops.com';
  SELECT count(*) INTO v_adm_u FROM auth.users WHERE email='ruth@logisticatops.com';
  SELECT count(*) INTO v_dir_r FROM public.roles WHERE slug='director_ops';
  SELECT count(*) INTO v_adm_r FROM public.roles WHERE slug='admin';
  IF v_dir_u=0 THEN RAISE EXCEPTION 'FALTA usuario joseluis@ en sandbox auth.users (crear cuenta primero)'; END IF;
  IF v_adm_u=0 THEN RAISE EXCEPTION 'FALTA usuario ruth@ en sandbox auth.users (crear cuenta primero)'; END IF;
  IF v_dir_r=0 THEN RAISE EXCEPTION 'FALTA role director_ops'; END IF;
  IF v_adm_r=0 THEN RAISE EXCEPTION 'FALTA role admin'; END IF;
  RAISE NOTICE 'Pre-flight OK';
END $$;

INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT u.id, r.id, 'Director de Operaciones', u.id, now()
FROM auth.users u CROSS JOIN public.roles r
WHERE u.email='joseluis@logisticatops.com' AND r.slug='director_ops'
ON CONFLICT (user_id, role_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT u.id, r.id, 'Administración · Verotin S.A.', u.id, now()
FROM auth.users u CROSS JOIN public.roles r
WHERE u.email='ruth@logisticatops.com' AND r.slug='admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Verificación (esperado: EXACTAMENTE 2 filas)
SELECT u.email, r.slug, ur.position_title
FROM public.user_roles ur
JOIN auth.users u ON u.id=ur.user_id
JOIN public.roles r ON r.id=ur.role_id
WHERE u.email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')
ORDER BY r.slug;

-- COMMIT;   -- descomentá SOLO si la verificación muestra exactamente 2 filas correctas
-- ROLLBACK; -- en cualquier otro caso
```

**Salida esperada del SELECT (2 filas):**

| email | slug | position_title |
|-------|------|----------------|
| `joseluis@logisticatops.com` | `director_ops` | Director de Operaciones |
| `ruth@logisticatops.com` | `admin` | Administración · Verotin S.A. |

---

## 6 · SQL · PRODUCCIÓN (Bloque 2)

> TARGET: **PRODUCCIÓN** `arsksytgdnzukbmfgkju` · SQL Editor.
> 🛑 **GATE DURO:** no pegar este bloque sin (a) sandbox validado, (b) **Backup P0.1 CERRADO**, (c) aprobación explícita del Presidente, (d) confirmar en el dashboard que el proyecto activo es `arsksytgdnzukbmfgkju`. Usuarios ya existen → el pre-flight pasa. SQL **idéntico** al de sandbox.

```sql
-- =============================================================================
-- BLOQUE 2 · PRODUCCIÓN (arsksytgdnzukbmfgkju) — Opción A: director_ops + admin
-- =============================================================================
BEGIN;

DO $$
DECLARE v_dir_u int; v_adm_u int; v_dir_r int; v_adm_r int;
BEGIN
  SELECT count(*) INTO v_dir_u FROM auth.users WHERE email='joseluis@logisticatops.com';
  SELECT count(*) INTO v_adm_u FROM auth.users WHERE email='ruth@logisticatops.com';
  SELECT count(*) INTO v_dir_r FROM public.roles WHERE slug='director_ops';
  SELECT count(*) INTO v_adm_r FROM public.roles WHERE slug='admin';
  IF v_dir_u=0 THEN RAISE EXCEPTION 'FALTA usuario joseluis@ en prod auth.users'; END IF;
  IF v_adm_u=0 THEN RAISE EXCEPTION 'FALTA usuario ruth@ en prod auth.users'; END IF;
  IF v_dir_r=0 THEN RAISE EXCEPTION 'FALTA role director_ops'; END IF;
  IF v_adm_r=0 THEN RAISE EXCEPTION 'FALTA role admin'; END IF;
  RAISE NOTICE 'Pre-flight OK';
END $$;

INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT u.id, r.id, 'Director de Operaciones', u.id, now()
FROM auth.users u CROSS JOIN public.roles r
WHERE u.email='joseluis@logisticatops.com' AND r.slug='director_ops'
ON CONFLICT (user_id, role_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT u.id, r.id, 'Administración · Verotin S.A.', u.id, now()
FROM auth.users u CROSS JOIN public.roles r
WHERE u.email='ruth@logisticatops.com' AND r.slug='admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Verificación (esperado: EXACTAMENTE 2 filas con los IDs de §2)
SELECT u.email, r.slug, ur.position_title
FROM public.user_roles ur
JOIN auth.users u ON u.id=ur.user_id
JOIN public.roles r ON r.id=ur.role_id
WHERE u.email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')
ORDER BY r.slug;

-- COMMIT;   -- descomentá SOLO si las 2 filas son correctas (IDs esperados de §2)
-- ROLLBACK; -- en cualquier otro caso
```

**Filas esperadas tras COMMIT (con IDs de §2):**
- `(3b1607c9…, 7ca43377…, 'Director de Operaciones')`
- `(5b635940…, 335f09d6…, 'Administración · Verotin S.A.')`

---

## 7 · Checklist PREVIA (cerrar antes de tocar nada)

### 7.1 · Contexto de entorno (Paso 0)
- [ ] **P0-1** · App apunta al proyecto correcto (`NEXT_PUBLIC_SUPABASE_URL` = sandbox para el ensayo).
- [ ] **P0-2** · `SUPABASE_SERVICE_ROLE_KEY` del entorno presente (sin ella, el conteo de seed cae a fail-closed self-only y cambia los resultados).
- [ ] **P0-3** · `NEXT_PUBLIC_DEMO_MODE=0` confirmado (si fuera 1 → fail-open global, no se valida enforcement).

### 7.2 · Pre-condiciones SANDBOX
- [ ] **PRE-S1** · 3 usuarios creados en sandbox: `joseluis@logisticatops.com`, `ruth@logisticatops.com`, `test-norole@sandbox.local` (Dashboard → Authentication → Add user, password temporal). Los 3 verificables en `auth.users` (read-only).
- [ ] **PRE-S2** · Baseline DORMIDO confirmado: `user_roles = 0` y Drive devuelve **200 `enforced:false`** + log `fallback-allow`.

### 7.3 · Pre-condiciones PRODUCCIÓN (gate duro)
- [ ] **PRE-P1** · Sandbox validado (sección 9 · criterios C1–C5 🟢) con evidencia archivada.
- [ ] **PRE-P2** · 🛑 **P0.1 Backup CERRADO** (restore-test exitoso — no seedear prod sin respaldo restaurable).
- [ ] **PRE-P3** · Aprobación explícita del Presidente (firma sección 11).
- [ ] **PRE-P4** · Confirmado en el dashboard: proyecto activo = `arsksytgdnzukbmfgkju` (prod) **antes** de pegar el SQL.
- [ ] **PRE-P5** · Ventana de cambio acordada (RBAC pasa de fail-open a enforced; impacto inmediato en accesos). Recomendado: día laboral 09:00–16:00 ART con JL y Ruth disponibles para validar.
- [ ] **PRE-P6** · Plan de rollback (sección 8) leído y a mano.

---

## 8 · Rollback (vuelve a DORMIDO · reversible y seguro)

**Cuándo invocarlo:** si la verificación no muestra 2 filas, si JL/Ruth no pueden hacer login post-seed, o si aparecen errores `500`/`query-failed` tras el COMMIT. El rollback devuelve el sistema a "RBAC dormido" (fail-open) — no es estado deseable a largo plazo pero es **seguro y funcional** mientras se investiga.

```sql
-- ROLLBACK · elimina SOLO las asignaciones de JL + Ruth (no toca otros usuarios)
BEGIN;

DELETE FROM public.user_roles
WHERE user_id IN (
  SELECT id FROM auth.users
   WHERE email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')
)
AND role_id IN (
  SELECT id FROM public.roles WHERE slug IN ('director_ops','admin')
);

-- Verificación (esperado: 0 filas para estos usuarios)
SELECT count(*) AS filas_jl_ruth FROM public.user_roles
WHERE user_id IN (
  SELECT id FROM auth.users
   WHERE email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')
);

-- COMMIT;   -- si la verificación da 0
-- ROLLBACK; -- si sorprende
```

**Verificación post-rollback (el catálogo NO debe cambiar):**

```sql
SELECT count(*) FROM public.roles;            -- esperado: 7
SELECT count(*) FROM public.permissions;      -- esperado: 24
SELECT count(*) FROM public.user_roles;       -- esperado: 0 (si solo estaban JL+Ruth)
```

**Notas de seguridad del rollback:**
- Idempotente: una segunda corrida elimina 0 filas.
- El `WHERE email IN (...)` **no afecta** a otros usuarios que pudieran haberse seedeado después.
- Tras el rollback los logs vuelven a mostrar `check-permission.fallback-allow`; el sistema sigue **funcional** para usuarios autenticados (sin enforcement). Investigar causa raíz → fix → re-ejecutar sección 5/6.

---

## 9 · Validaciones · criterios de aprobación 🟢 RBAC VALIDADO

### 9.1 · Nivel 1 — Drive (enforcement real, post-seed)

| Caso | Usuario | Acción | Esperado |
|------|---------|--------|----------|
| N1-1 | `joseluis@` (`director_ops`) | `GET /api/drive/list` | **200** `enforced:true` |
| N1-2 | `ruth@` (`admin`) | `GET /api/drive/list` | **200** `enforced:true` |
| N1-3 | `test-norole@` (sin rol) | `GET /api/drive/list` | **403** `Permiso requerido: compliance.view` |
| N1-4 | `test-norole@` (sin rol) | `GET /api/drive/ping` | **403** |
| N1-5 | (sin sesión) | `GET /api/drive/list` | **401** |

Contraste **pre-seed** (demuestra la transición dormido → activo):

| Caso | Usuario | Acción | Esperado |
|------|---------|--------|----------|
| N0-1 | `joseluis@` (aún sin rol) | `GET /api/drive/list` | **200** `enforced:false` + WARN `fallback-allow` |
| N0-2 | `test-norole@` | `GET /api/drive/list` | **200** `enforced:false` |

### 9.2 · Nivel 2 — resolución por dominio (read-only)

Verificar con la query del Apéndice A que el set resuelto por rol sea el de la sección 3. Probar explícitamente los **2 diferenciadores**:
- **N2-A:** `compras.sign` ∈ `director_ops` ∧ ∉ `admin`.
- **N2-B:** `documental.admin` + `documental.export` ∈ `admin` ∧ ∉ `director_ops`.
- **N2-C:** `test-norole@` → set vacío → 403 cuando exista guard.

### 9.3 · Criterios de aprobación (todos deben cumplirse y evidenciarse)

- [ ] **C1 · Transición demostrada:** pre-seed N0 (200 `enforced:false` + `fallback-allow`); post-seed `SELECT` = exactamente 2 filas correctas.
- [ ] **C2 · Enforcement real (Nivel 1):** N1-1/N1-2 = 200 `enforced:true`; N1-3/N1-4 = 403; N1-5 = 401; **cero** `500`/`query-failed`/`seed-count-failed` en logs.
- [ ] **C3 · Resolución (Nivel 2):** `director_ops` = 22 permisos (incluye `compras.sign`, excluye `documental.admin`/`export`); `admin` = 23 (excluye `compras.sign`, incluye `documental.admin`/`export`); sin rol = set vacío.
- [ ] **C4 · Sin regresión de seguridad:** `SERVICE_ROLE_KEY` presente y `DEMO_MODE=0` durante toda la prueba.
- [ ] **C5 · Brecha aceptada:** registrado que Billing/CCTV/Settings/Compras/Compliance-páginas resuelven pero aún no bloquean por pantalla (guards = ETAPA 1, fuera de P0.2).

> **Definición honesta de 🟢:** "El motor RBAC resuelve y deniega correctamente — end-to-end en Drive, por resolución en el resto; catálogo y asignaciones correctos." **No** significa "las 6 pantallas bloquean por rol" (eso es ETAPA 1).

---

## 10 · Checklist POSTERIOR (cierre)

### 10.1 · Post-sandbox
- [ ] **POST-S1** · C1–C5 🟢 con evidencia (status + líneas de log) archivada.
- [ ] **POST-S2** · Decisión sobre el sandbox: dejarlo seedeado como evidencia del ensayo, o limpiarlo con el rollback (sección 8).

### 10.2 · Post-producción
- [ ] **POST-P1** · Read-only: `user_roles` prod = 2 filas con los IDs esperados de §2.
- [ ] **POST-P2** · Smoke con sesión real del Director: Drive **200 `enforced:true`**.
- [ ] **POST-P3** · Logs de prod sin `fallback-allow` para usuarios asignados.
- [ ] **POST-P4** · Documentar `RBAC-SEED-CLOSURE-PROD.md` (IDs, timestamp del INSERT, operador, output del SELECT, líneas de log).
- [ ] **POST-P5** · Re-emitir `PRE-FLIGHT-RBAC-REPORT.md` → **PASS** (`-V2`).
- [ ] **POST-P6** · `PRE-FLIGHT-GATE-0.md`: P0.2 → 🟢 PASS.

---

## 11 · Riesgos

| ID | Riesgo | Severidad | Mitigación (ya incorporada) |
|----|--------|-----------|------------------------------|
| RBAC.R1 | Email incorrecto → INSERT inserta 0 filas | media | pre-flight `DO $$` aborta con `RAISE EXCEPTION` si falta el usuario |
| RBAC.R2 | Slug equivocado (`director` en vez de `director_ops`) → 0 filas en silencio | **alta (D1)** | script usa los slugs **vivos** verificados; pre-flight valida que el role exista |
| RBAC.R3 | Catálogo no seedeado | baja | verificado read-only: 7 roles / 24 permisos en ambos entornos |
| RBAC.R4 | Concurrencia (2 corridas simultáneas) | baja | `ON CONFLICT (user_id, role_id) DO NOTHING` + índice único `user_roles_pkey` |
| RBAC.R5 | Usuarios `joseluis@`/`ruth@` ausentes en sandbox (D2) | alta | PRE-S1: crearlos antes; el pre-flight aborta limpio si faltan |
| RBAC.R6 | Backup-pre-cambio inexistente al seedear prod | **alta (gate duro)** | PRE-P2 bloquea prod hasta **P0.1 cerrado** |
| RBAC.R7 | Falta `SERVICE_ROLE_KEY` o `DEMO_MODE=1` → resultados de prueba engañosos | media | P0-2/P0-3 lo confirman antes de validar |
| RBAC.R8 | Otros usuarios (operaciones, etc.) sin rol → 403 cuando se cableen guards | esperada | el seed solo agrega JL+Ruth; el resto se seedea al operar (ETAPA 1) |
| RBAC.R9 | `billing.*` no existe como permiso (D3) | media | /billing mapea a `analytics.view` por ahora; decisión de FASE 1A |

---

## 12 · Veredicto y firma

### 12.1 · Veredicto del pack

🟢 **READY FOR SANDBOX EXECUTION**

**Evidencia que lo sustenta:**
- Catálogo vivo verificado read-only (7 roles / 24 permisos, idéntico sandbox↔prod; `user_roles=0`).
- Mapeo aprobado por Presidencia (Opción A) → D1 cerrado a nivel decisión.
- Script idempotente preparado y consolidado aquí (secciones 5 y 6), portable por email+slug, con pre-flight defensivo, verificación y rollback.
- Criterios de validación y de aprobación definidos (sección 9).

**Lo único pendiente (acción manual del operador):**
1. Crear `joseluis@`/`ruth@`/`test-norole@` en sandbox (PRE-S1).
2. Ejecutar Bloque 1 (sección 5) y validar C1–C5.
3. Con sandbox 🟢 + **Backup P0.1 cerrado** + aprobación → ejecutar Bloque 2 (sección 6) en prod.

> **🔴 BLOCKED solo aplicaría si:** el catálogo divergiera entre entornos, faltara la aprobación de mapeo, o el script no estuviera preparado. Ninguna de esas condiciones se cumple → no hay bloqueo para el **ensayo en sandbox**. La **promoción a prod** sí está condicionada por el gate duro **P0.1 Backup** (Track B).

### 12.2 · Firma de aprobación (promoción a PRODUCCIÓN)

| Rol | Nombre | Decisión | Fecha |
|-----|--------|----------|-------|
| Presidente | Martín F. Battaglia | ▢ 🟢 GO ▢ 🔴 NO-GO | __________ |

**Condiciones / notas del aprobador:**

_______________________________________________________________________

---

## Apéndice A · Query de resolución (Nivel 2, read-only)

```sql
SELECT r.slug AS role, p.slug AS perm
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.slug IN ('director_ops','admin')
ORDER BY r.slug, p.slug;
```

Esperado: `director_ops` = 22 filas (incl. `compras.sign`, sin `documental.admin`/`export`); `admin` = 23 filas (sin `compras.sign`, con `documental.admin`/`export`). Coincide con la sección 3.

## Apéndice B · Estructura de `user_roles` (verificada)

Columnas: `user_id` (uuid, NOT NULL), `role_id` (uuid, NOT NULL), `position_title` (text, NULL ok), `depot` (enum, NULL ok), `assigned_at` (timestamptz, default `now()`), `assigned_by` (uuid, NULL ok). Índice único `user_roles_pkey (user_id, role_id)` → la cláusula `ON CONFLICT (user_id, role_id) DO NOTHING` es válida y soportada.

## Apéndice C · Restricciones honradas

- 🛑 Este documento NO ejecuta SQL ni crea usuarios. Las únicas consultas que respaldan sus cifras fueron `SELECT` con `read_only:true` (2026-05-29/30).
- 🛑 NO deploy · NO merge · NO push · NO commit · NO modificación de sandbox ni producción.
- 🛑 NO inventa: todo trazable a `RBAC-READONLY-VALIDATION.md`, `RBAC-SANDBOX-EXECUTION-PLAN.md`, `RBAC-GATE-CHECKLIST.md` y `scripts/seed-rbac-assign-users-OPCION-A.sql`.
