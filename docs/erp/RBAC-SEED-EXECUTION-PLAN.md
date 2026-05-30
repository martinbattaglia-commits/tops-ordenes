# RBAC-SEED-EXECUTION-PLAN

**Fecha:** 2026-05-29
**Objetivo:** cerrar P0.2 — seedear `user_roles` con Director (JL) y Admin (Ruth) para destrabar GATE 0.
**Estado:** plan documental · **NO ejecutar nada todavía**.
**Tiempo estimado de ejecución:** 30-60 min (con coordinación del usuario).
**Restricciones:** sin SQL ejecutado · sin producción tocada · sin role asignado.

---

## 0 · ⚠️ Decisión requerida del usuario antes de ejecutar

**Conflicto de nombres detectado:**

| Fuente | Director | Administración |
|--------|----------|----------------|
| Mensaje del usuario (hoy) | **José Luis Rodríguez** | **Ruth Carrasquero** |
| Código `src/lib/org.ts` (vigente en producción) | José Luis **Battaglia** | Ruth **Cardozo** |
| Email asumido (de `src/lib/org.ts`) | `joseluis@logisticatops.com` | `ruth@logisticatops.com` |

**Preguntas para el usuario antes de ejecutar:**

1. ¿Los apellidos correctos son **Rodríguez** y **Carrasquero**? (mensaje de hoy)
2. ¿O son **Battaglia** y **Cardozo**? (código actual)
3. **¿Los emails son los correctos?** Esto es lo que MÁS importa porque el SQL usa email como identificador.
4. Si los apellidos del código están mal, ¿se actualiza el código `src/lib/org.ts` en un PR separado? (eso es scope distinto a este plan)

**Sin esta confirmación NO se ejecuta el plan.** El SQL parametrizado abajo está diseñado para que solo los emails importen — los apellidos se setean explícitamente en `position_title` cuando se ejecute.

---

## PASO 1 · Identificación de usuarios reales

### 1.1 Datos esperados — Director

| Atributo | Valor esperado | Fuente |
|----------|----------------|---------|
| Nombre completo | **José Luis Rodríguez** | mensaje del usuario 2026-05-29 |
| Email | `joseluis@logisticatops.com` | `src/lib/org.ts:18` (`ORG.emitter.email`) |
| Role slug | `director` | `scripts/seed-rbac-real-roles.sql` |
| Role label | Director | `roles` table |
| Position title (libre) | "Director de Operaciones" | `src/lib/org.ts:17` (`ORG.emitter.role`) |
| Depot asignado | NULL (rol cross-depot) | decisión arquitectónica |

**Permisos efectivos esperados (de role_permissions):**

Per `docs/erp/FASE-1A-RLS.md §4.2` (sección RBAC asignación):

```
Director recibe TODOS los permisos billing.* (9 slugs):
  billing.view
  billing.create
  billing.recurring.manage
  billing.recurring.run
  billing.payments.register
  billing.payments.apply
  billing.late_fees.manage
  billing.adjustments.create
  billing.delete
```

Más permisos heredados de mig 0009 (catálogo seedeado, asumiendo seed `scripts/seed-rbac-real-roles.sql` aplicado):

```
cockpit.view, cockpit.export
compras.view, compras.create, compras.edit, compras.sign, compras.export, compras.delete
servicios.view, servicios.create, servicios.sign
comercial.view, comercial.edit
compliance.view, compliance.edit
cctv.view, cctv.admin
documental.view, documental.create, documental.delete
analytics.view
sistema.admin
```

Total esperado director: **22 permisos del catálogo base + 9 billing = 31 permisos**.

### 1.2 Datos esperados — Administración (Ruth)

| Atributo | Valor esperado | Fuente |
|----------|----------------|---------|
| Nombre completo | **Ruth Carrasquero** | mensaje del usuario 2026-05-29 |
| Email | `ruth@logisticatops.com` | `src/lib/org.ts:25` (`ORG.admin.email`) |
| Role slug | `administracion` | seed |
| Position title | "Administración · Verotin S.A." | `src/lib/org.ts:24` |
| Depot asignado | NULL (cross-depot) | decisión |

**Permisos efectivos esperados (Administración):**

```
billing.* (TODOS menos billing.delete) = 8 slugs
+ permisos heredados del catálogo:
  compras.view + create + edit + sign + export
  servicios.view + create + sign
  comercial.view + edit
  compliance.view
  documental.view + create
  analytics.view
  (sin sistema.admin)
```

Total esperado administración: ~25 permisos.

### 1.3 Pre-condiciones de identificación

Antes de ejecutar el SQL del Paso 2, verificar:

1. **Existen en `auth.users` con los emails esperados:**
   ```sql
   -- A ejecutar en sandbox (consulta read-only)
   SELECT id, email, created_at, last_sign_in_at
   FROM auth.users
   WHERE email IN ('joseluis@logisticatops.com', 'ruth@logisticatops.com')
   ORDER BY email;
   ```
   **Esperado:** 2 rows con `created_at` razonable y `last_sign_in_at` no NULL.

2. **Catálogo de roles tiene `director` y `administracion`:**
   ```sql
   SELECT id, slug, name, color
   FROM public.roles
   WHERE slug IN ('director', 'administracion')
   ORDER BY slug;
   ```
   **Esperado:** 2 rows. Si solo aparece 0 o 1 → ejecutar primero `scripts/seed-rbac-real-roles.sql`.

3. **`user_roles` está vacía o no tiene rows para estos usuarios:**
   ```sql
   SELECT u.email, r.slug, ur.position_title, ur.assigned_at
   FROM public.user_roles ur
   JOIN auth.users u ON u.id = ur.user_id
   JOIN public.roles r ON r.id = ur.role_id
   WHERE u.email IN ('joseluis@logisticatops.com', 'ruth@logisticatops.com');
   ```
   **Esperado:** 0 rows (RBAC dormido). Si aparece algo → ya están seedeados, no requiere acción.

---

## PASO 2 · Script SQL parametrizado (sandbox)

### 2.1 Filosofía del script

- **Idempotente** — re-ejecutable sin efectos secundarios
- **Parametrizable** — emails y position_title en variables locales (no hardcoded mid-SQL)
- **Defensivo** — falla explícitamente si pre-condiciones no se cumplen
- **Auditado** — registra `assigned_by` y `assigned_at`
- **Verificable** — query post-INSERT confirma resultado

### 2.2 Script completo

```sql
-- ============================================================================
-- RBAC Seed · Director + Administración
-- TARGET: SANDBOX (vrxosunxlhohmqymxots) primero
-- DO NOT RUN ON PRODUCTION (arsksytgdnzukbmfgkju) sin OK explícito
-- ============================================================================
-- Prerequisitos verificados:
--   1. mig 0009_rbac.sql aplicada
--   2. scripts/seed-rbac-real-roles.sql ya ejecutado (roles + permissions + role_permissions)
--   3. JL y Ruth tienen sesión activa en auth.users
-- ============================================================================

BEGIN;

-- --- 1. Variables (revisar emails antes de ejecutar) ----------------------
\set director_email '''joseluis@logisticatops.com'''
\set admin_email    '''ruth@logisticatops.com'''
\set director_title '''Director de Operaciones'''
\set admin_title    '''Administración · Verotin S.A.'''

-- --- 2. Pre-flight: validaciones explícitas -------------------------------
DO $$
DECLARE
  v_director_user_count int;
  v_admin_user_count int;
  v_director_role_count int;
  v_admin_role_count int;
BEGIN
  SELECT count(*) INTO v_director_user_count
    FROM auth.users WHERE email = :director_email;
  SELECT count(*) INTO v_admin_user_count
    FROM auth.users WHERE email = :admin_email;

  IF v_director_user_count = 0 THEN
    RAISE EXCEPTION 'Director user no existe en auth.users (email=%)', :director_email;
  END IF;
  IF v_admin_user_count = 0 THEN
    RAISE EXCEPTION 'Admin user no existe en auth.users (email=%)', :admin_email;
  END IF;

  SELECT count(*) INTO v_director_role_count
    FROM public.roles WHERE slug = 'director';
  SELECT count(*) INTO v_admin_role_count
    FROM public.roles WHERE slug = 'administracion';

  IF v_director_role_count = 0 THEN
    RAISE EXCEPTION 'Role director no existe — ejecutar scripts/seed-rbac-real-roles.sql primero';
  END IF;
  IF v_admin_role_count = 0 THEN
    RAISE EXCEPTION 'Role administracion no existe — ejecutar scripts/seed-rbac-real-roles.sql primero';
  END IF;

  RAISE NOTICE 'Pre-flight OK: usuarios y roles existen';
END $$;

-- --- 3. INSERT Director ---------------------------------------------------
INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT
  u.id        AS user_id,
  r.id        AS role_id,
  :director_title,
  u.id        AS assigned_by,  -- bootstrap: self-assigned
  now()
FROM auth.users u
CROSS JOIN public.roles r
WHERE u.email = :director_email
  AND r.slug = 'director'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- --- 4. INSERT Administración --------------------------------------------
INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT
  u.id        AS user_id,
  r.id        AS role_id,
  :admin_title,
  u.id        AS assigned_by,
  now()
FROM auth.users u
CROSS JOIN public.roles r
WHERE u.email = :admin_email
  AND r.slug = 'administracion'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- --- 5. Verificación post-INSERT -----------------------------------------
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.user_roles ur
    JOIN auth.users u ON u.id = ur.user_id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE u.email IN (:director_email, :admin_email)
      AND r.slug IN ('director', 'administracion');

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Resultado inesperado: % rows insertadas, esperaba 2', v_count;
  END IF;
  RAISE NOTICE 'Post-INSERT OK: 2 rows de user_roles seedeadas';
END $$;

-- --- 6. Salida visual para review humano -------------------------------
SELECT
  u.email,
  r.slug AS role_slug,
  r.name AS role_name,
  ur.position_title,
  ur.assigned_at,
  (SELECT email FROM auth.users WHERE id = ur.assigned_by) AS assigned_by_email
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
JOIN public.roles r ON r.id = ur.role_id
WHERE u.email IN (:director_email, :admin_email)
ORDER BY r.slug;

-- ============================================================================
-- DECISIÓN: ¿COMMIT o ROLLBACK?
-- ============================================================================
-- En SANDBOX:
--   COMMIT;    -- aplicar
-- O bien:
--   ROLLBACK;  -- abortar si la salida visual sorprende
-- ============================================================================
```

### 2.3 Cómo ejecutar el script

**Opción A — Supabase SQL Editor (recomendado para sandbox primera vez):**

1. Login en https://supabase.com/dashboard
2. Seleccionar proyecto **tops-nexus-staging** (`vrxosunxlhohmqymxots`)
3. SQL Editor → New query → pegar el script (con los `\set` reemplazados — el editor no soporta psql vars)
4. Run → revisar output → COMMIT o ROLLBACK

**Pre-procesamiento para SQL Editor (manual):**

El editor de Supabase no entiende `\set`. Reemplazar las variables con los valores literales antes de pegar:

```sql
-- Reemplazar todas las apariciones de:
--   :director_email  →  'joseluis@logisticatops.com'
--   :admin_email     →  'ruth@logisticatops.com'
--   :director_title  →  'Director de Operaciones'
--   :admin_title     →  'Administración · Verotin S.A.'
```

**Opción B — psql directo desde host (avanzado):**

```bash
# Sin ejecutar — propuesta
DATABASE_URL="postgresql://postgres.[ref]:[password]@[host]:5432/postgres"

psql "$DATABASE_URL" \
  -v director_email="'joseluis@logisticatops.com'" \
  -v admin_email="'ruth@logisticatops.com'" \
  -v director_title="'Director de Operaciones'" \
  -v admin_title="'Administración · Verotin S.A.'" \
  -f rbac-seed-execution.sql
```

**Opción C — Supabase CLI con archivo (recomendado para promoción a prod):**

```bash
# Sin ejecutar — propuesta
# Después de aprobar en sandbox:
supabase link --project-ref arsksytgdnzukbmfgkju   # PROD
supabase db execute --file scripts/rbac-seed-jl-ruth.sql --linked
```

(Requiere crear el archivo `scripts/rbac-seed-jl-ruth.sql` con las variables reemplazadas — NO se hace todavía.)

---

## PASO 3 · Plan de validación funcional

Después de aplicar en sandbox (paso 2), validar **antes de promover a prod**:

### 3.1 Validación DB (queries en sandbox)

```sql
-- 3.1.1 user_roles tiene los 2 nuevos rows
SELECT count(*) FROM user_roles;   -- esperado: ≥ 2

-- 3.1.2 helper has_permission() funciona para JL
-- Simular sesión JL ejecutando como su usuario:
-- (requires PostgREST con JWT de JL — testable via app login)

-- 3.1.3 v_my_permissions vista materializable funciona
SELECT * FROM my_permissions;   -- corre como auth.uid() actual
```

### 3.2 Validación funcional vía la app

Test plan que ejecuta **el usuario** desde su browser:

| # | Test | Esperado | Persona |
|---|------|----------|---------|
| V1 | JL hace login en https://tops-ordenes.netlify.app/login | sesión activa | JL |
| V2 | JL navega a `/billing` | accede sin redirect a /login | JL |
| V3 | JL navega a `/anmat` | accede (tiene `compliance.view`) | JL |
| V4 | JL navega a `/drive` | accede (tiene `compliance.view`) | JL |
| V5 | JL navega a `/cctv` | accede (tiene `cctv.view` + `cctv.admin`) | JL |
| V6 | JL navega a `/settings/roles` | accede (tiene `sistema.admin`) | JL |
| V7 | JL navega a `/settings/users` | ve a Ruth con rol asignado | JL |
| V8 | Ruth hace login | sesión activa | Ruth |
| V9 | Ruth navega a `/billing` | accede | Ruth |
| V10 | Ruth navega a `/anmat` | accede (`compliance.view`) | Ruth |
| V11 | Ruth navega a `/drive` | accede | Ruth |
| V12 | Ruth navega a `/settings/users` | accede (depende: si admin tiene permiso → ok; si no, 403) | Ruth |

### 3.3 Validación de denegación (RBAC enforced post-seed)

Como R22 closure detecta fallback fail-open solo si **user_roles está globalmente vacío**, después del seed:
- `user_roles` tiene 2 rows → fallback NO aplica
- Usuarios autenticados **sin** rol asignado serán denegados con 403 en endpoints que requieran permisos billing.*

Test crítico:
| # | Test | Esperado |
|---|------|----------|
| V13 | Usuario test sin rol asignado intenta `/api/billing/recurring/contracts` | **403 Permiso requerido: billing.view** |

**Si V13 NO da 403** (o sea, sigue dando 200 fail-open) → algo está mal con el seed. Investigar:
- ¿user_roles realmente tiene rows?
- ¿`checkPermission()` está usando `createAdminClient()` correctamente (R22 fix)?
- ¿Algún warn en logs de Netlify Functions?

### 3.4 Validación de logs estructurados

Después del seed, los logs estructurados de RBAC deben mostrar:

**Antes del seed (fail-open):**
```json
{"level":"warn","mod":"rbac","op":"check-permission.fallback-allow",
 "reason":"user_roles table empty globally (RBAC dormido, FASE 1)"}
```

**Después del seed (enforced):**
```json
{"level":"info","mod":"rbac","op":"check-permission",
 "permission":"billing.view","userId":"<jl-uuid>","enforced":true,"ok":true}
```

Validar buscando estos logs en Netlify Functions logs durante V1-V12.

---

## PASO 4 · Plan de promoción a producción

**Requisitos para promover a prod:**

| # | Requisito | Status |
|---|-----------|--------|
| 1 | Sandbox seedeado sin issues (Paso 2 + 3) | pre-condición |
| 2 | Tests V1-V12 todos PASS en sandbox | pre-condición |
| 3 | Test V13 (denegación) PASS | pre-condición |
| 4 | Backup pre-cambio confirmado activo (P0.1 closed) | pre-condición — ⚠️ **bloquea si P0.1 no cerrado** |
| 5 | Aprobación explícita del usuario para ejecutar en prod | gate |

### 4.1 Procedimiento de promoción

```
1. Re-link CLI a prod:
     supabase link --project-ref arsksytgdnzukbmfgkju

2. Confirmar:
     cat supabase/.temp/project-ref
     # debe mostrar: arsksytgdnzukbmfgkju

3. (Si Opción C de ejecución) Crear archivo con valores literales:
     scripts/rbac-seed-jl-ruth.sql  ← copia del script con :vars reemplazadas

4. Ejecutar el mismo script (con vars resueltas) en SQL Editor de prod
   o:
     supabase db execute --file scripts/rbac-seed-jl-ruth.sql --linked

5. Capturar output completo en RBAC-SEED-CLOSURE-PROD.md:
     - user_id de JL post-INSERT
     - user_id de Ruth post-INSERT
     - role_id de director
     - role_id de administracion
     - timestamp del INSERT
     - operador que ejecutó

6. Validación inmediata en prod:
     - JL hace login → smoke check de V1-V7
     - Ruth hace login → V8-V12 (si está disponible)
     - V13 con cuenta test si existe

7. Re-link CLI de vuelta a sandbox:
     supabase link --project-ref vrxosunxlhohmqymxots

8. Generar PRE-FLIGHT-RBAC-REPORT-V2.md como PASS
```

### 4.2 Ventana de cambio recomendada

- **Día laboral** (no madrugada — necesitamos a JL y Ruth disponibles para validar)
- **Horario:** después de las 09:00 ART y antes de las 16:00 ART
- **Duración:** 30-60 min total
- **Bloqueo operativo:** ninguno (RBAC se enciende sin downtime)

---

## PASO 5 · Plan de rollback

### 5.1 Cuándo invocar rollback

- Si tests V1-V12 fallan en sandbox → rollback sandbox + investigar
- Si tests V1-V12 fallan en prod → rollback prod inmediato + revertir a fail-open mientras se investiga
- Si JL o Ruth no pueden hacer login después del seed → rollback prod inmediato

### 5.2 SQL de rollback (sandbox o prod, según corresponda)

```sql
-- ============================================================================
-- RBAC Seed · ROLLBACK · Eliminar asignaciones de JL + Ruth
-- ============================================================================
-- IMPORTANTE: este rollback DEVUELVE el sistema al estado "RBAC dormido"
-- (fail-open R22 closure). No es estado deseable a largo plazo pero
-- es seguro como medida temporal mientras se investiga el problema.
-- ============================================================================

BEGIN;

DELETE FROM public.user_roles
WHERE user_id IN (
  SELECT id FROM auth.users
   WHERE email IN ('joseluis@logisticatops.com', 'ruth@logisticatops.com')
)
AND role_id IN (
  SELECT id FROM public.roles
   WHERE slug IN ('director', 'administracion')
);

-- Verificación:
SELECT count(*) FROM public.user_roles
WHERE user_id IN (
  SELECT id FROM auth.users
   WHERE email IN ('joseluis@logisticatops.com', 'ruth@logisticatops.com')
);
-- esperado: 0

-- COMMIT o ROLLBACK según resultado
```

### 5.3 Verificación post-rollback

```sql
-- Catálogo intacto?
SELECT count(*) FROM public.roles;            -- esperado: 7 (no cambia)
SELECT count(*) FROM public.permissions;      -- esperado: 22
SELECT count(*) FROM public.role_permissions; -- esperado: 64

-- user_roles vuelve a 0?
SELECT count(*) FROM public.user_roles;       -- esperado: 0

-- Fail-open R22 closure se reactiva
-- (verificar con request a /api/billing/* sin token billing)
```

### 5.4 Recuperación funcional

Después del rollback:
- RBAC vuelve a estar dormido → fail-open R22 closure activo
- Logs muestran `check-permission.fallback-allow` otra vez
- Sistema sigue **funcional** para usuarios autenticados (pero sin enforcement)
- Investigar la causa raíz del fallo
- Aplicar fix
- Re-ejecutar paso 2 cuando esté listo

### 5.5 Recuperación de datos

**Si el rollback se ejecuta MÁS DE 24h después del seed**:
- Otros usuarios pueden haber sido seedeados en `user_roles` en ese período (operadores, etc.)
- El DELETE arriba **NO afecta a esos otros usuarios** (filtro WHERE email IN)
- Estado seguro

**Si el script de rollback se ejecuta múltiples veces**: idempotente — la segunda corrida elimina 0 rows porque ya no hay nada que eliminar.

---

## 6 · Riesgos identificados

| ID | Riesgo | Severidad | Mitigación |
|----|--------|-----------|------------|
| RBAC.R1 | Email incorrecto de JL → DELETE falla → seed falla | media | DO $$ pre-flight valida emails antes de INSERT |
| RBAC.R2 | Catálogo no seedeado (roles vacíos) | media | DO $$ valida + fallback: ejecutar seed-rbac-real-roles.sql primero |
| RBAC.R3 | Concurrencia: 2 ejecuciones simultáneas del seed | baja | ON CONFLICT DO NOTHING + UNIQUE (user_id, role_id) por mig 0009 |
| RBAC.R4 | JL o Ruth no pueden hacer login después del seed | baja | rollback documentado |
| RBAC.R5 | Backup-pre-cambio no existe (P0.1 sin cerrar) | **alta** | **bloquea promoción a prod hasta P0.1 cerrado** |
| RBAC.R6 | Otros usuarios (operaciones, etc.) sin rol → 403 en endpoints | esperada | seed solo agrega JL + Ruth. Otros tendrán que seedearse cuando empiecen a operar |
| RBAC.R7 | Apellidos en `position_title` quedan inconsistentes con `src/lib/org.ts` | baja | PR aparte para alinear código si los apellidos del usuario son los correctos |

---

## 7 · Cronograma propuesto

```
Día 1 (sesión de coordinación con usuario, ~30 min)
  ├── 1.1 Confirmar apellidos correctos (Rodríguez/Carrasquero vs Battaglia/Cardozo)
  ├── 1.2 Confirmar emails reales (joseluis@ + ruth@)
  ├── 1.3 Verificar que JL y Ruth tienen cuenta en auth.users prod
  ├── 1.4 Confirmar disponibilidad para validación post-seed
  └── 1.5 Aprobación del plan

Día 1 o 2 (ejecución sandbox, ~20 min)
  ├── 2.1 Re-link CLI a sandbox
  ├── 2.2 Ejecutar pre-flight (validaciones SQL read-only)
  ├── 2.3 Ejecutar script seed en sandbox
  ├── 2.4 Validar resultado SQL
  ├── 2.5 Smoke test funcional (JL login en sandbox URL si existe)
  └── 2.6 Documentar resultados

Día 2 o 3 (ejecución prod, ~40 min)
  ├── 3.1 Confirmar P0.1 Backup CERRADO  ← bloqueante
  ├── 3.2 Re-link CLI a prod
  ├── 3.3 Confirmar status linked
  ├── 3.4 Ejecutar script seed en prod
  ├── 3.5 JL hace V1-V7
  ├── 3.6 Ruth hace V8-V12
  ├── 3.7 Validación V13 (denegación)
  ├── 3.8 Capturar logs estructurados
  ├── 3.9 Generar PRE-FLIGHT-RBAC-REPORT-V2.md (PASS)
  └── 3.10 Re-link CLI de vuelta a sandbox
```

---

## 8 · Documentos a generar al cerrar

1. `RBAC-SEED-CLOSURE-SANDBOX.md` — resultado de ejecución en sandbox
2. `RBAC-SEED-CLOSURE-PROD.md` — resultado de ejecución en prod
3. `PRE-FLIGHT-RBAC-REPORT-V2.md` — re-emisión del reporte como PASS
4. (Si aplica) PR aparte para actualizar `src/lib/org.ts` con apellidos correctos

---

## 9 · Decisiones pendientes del usuario

| # | Decisión | Default propuesto |
|---|----------|---------------------|
| 1 | Apellidos correctos JL/Ruth (Rodríguez/Carrasquero vs Battaglia/Cardozo) | **Asumo Rodríguez/Carrasquero** según mensaje del usuario; PR aparte si código tiene mal |
| 2 | Emails correctos | `joseluis@logisticatops.com` y `ruth@logisticatops.com` (de `src/lib/org.ts`) |
| 3 | Position titles exactos | "Director de Operaciones" / "Administración · Verotin S.A." |
| 4 | Depot asignado | NULL para ambos (cross-depot) |
| 5 | Self-assignment (assigned_by = self) o assigned_by = NULL para bootstrap | self-assignment marca audit trail |
| 6 | ¿Otros usuarios críticos a seedear en este round? | Solo JL + Ruth para FASE 1A |
| 7 | ¿Ejecutar en sandbox primero? | **Sí** — pre-condición no negociable |
| 8 | ¿Ventana horaria preferida para prod? | Horario laboral 09:00-16:00 ART para validación inmediata |

---

## 10 · Restricciones honradas

- 🛑 NO EJECUTAR SQL (solo diseñado y revisable)
- 🛑 NO MODIFICAR `src/lib/org.ts` (PR separado si necesario)
- 🛑 NO TOCAR producción
- 🛑 NO TOCAR sandbox sin OK explícito del usuario
- 🛑 NO PROMOVER a prod sin P0.1 (backup) cerrado
- 🛑 NO INVENTAR — todo trazable a `scripts/seed-rbac-real-roles.sql`, mig 0009, `src/lib/org.ts`, decisiones aprobadas FASE 1A/1B
