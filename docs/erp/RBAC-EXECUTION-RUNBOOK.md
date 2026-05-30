# RBAC-EXECUTION-RUNBOOK

**Fecha:** 2026-05-29
**Objetivo:** cerrar el bloqueante **P0.2** de GATE 0 — poblar `user_roles` con Director y Administración para activar el RBAC (hoy dormido).
**Estado:** 🟡 **READY FOR EXECUTION** · documental · **nada ejecutado todavía**.
**Responsable de ejecución:** Martín / TOPS (con asistencia documental del proyecto).
**Naturaleza:** este runbook es **operable paso a paso sin interpretación**. Cada paso indica QUÉ correr, DÓNDE, QUÉ esperar, y QUÉ hacer si el resultado no coincide.

> 🛑 **Restricciones de esta entrega (ETAPA 0B):** este documento NO ejecuta SQL, NO toca sandbox ni producción, NO modifica código. Es la guía que el operador seguirá cuando se autorice ETAPA 1.

---

## 0 · Datos autoritativos (decisión del presidente · 2026-05-29)

| Atributo | Director | Administración |
|----------|----------|----------------|
| Nombre completo | José Luis **Rodríguez** | Ruth **Carrasquero** |
| Email (identificador del seed) | `joseluis@logisticatops.com` | `ruth@logisticatops.com` |
| Role slug objetivo | `director` | `administracion` |
| `position_title` | `Director de Operaciones` | `Administración · Verotin S.A.` |
| Depot | `NULL` (cross-depot) | `NULL` (cross-depot) |

> El apellido **NO entra** en ningún campo del seed (el `position_title` es el cargo, no el apellido). Por eso la discrepancia de apellidos del código (ver `ORG-DATA-CONSISTENCY-REPORT.md`) **no afecta** este runbook. El seed identifica por **email**.

---

## 1 · Pre-condiciones (checklist antes de empezar)

Marcá cada ítem antes de avanzar. **Si alguno falla, NO continuar.**

- [ ] **P1.1** — GATE 0 autorizado a ejecutar (autorización explícita del presidente para ETAPA 1 / ejecución real).
- [ ] **P1.2** — Bloqueante **P0.1 Backup CERRADO** (existe backup externo verificado). ⚠️ **Obligatorio antes de tocar PRODUCCIÓN** (no antes de sandbox). Ver `BACKUP-EXECUTION-RUNBOOK.md`.
- [ ] **P1.3** — Acceso al dashboard Supabase de ambos proyectos:
  - Sandbox: `vrxosunxlhohmqymxots` ("tops-nexus-staging")
  - Producción: `arsksytgdnzukbmfgkju`
- [ ] **P1.4** — `SUPABASE_ACCESS_TOKEN` disponible en `.env.local` (para CLI no-interactivo) **o** acceso al SQL Editor web.
- [ ] **P1.5** — José Luis y Ruth disponibles para validar login el mismo día de la ejecución en prod.

---

## 2 · STEP 1 — Verificación read-only (resolver divergencia de catálogo) 🔍

> **Por qué existe este paso:** hay una **divergencia conocida** entre dos catálogos de roles:
> - `scripts/seed-rbac-real-roles.sql` define **6 roles**: `director`, `administracion`, `operaciones`, `comercial`, `deposito`, `auditor`.
> - La migración `0009_rbac` y auditorías previas registraron **7 roles** con slugs distintos (`admin`, `director_ops`, `compliance`, `seguridad`, ...).
>
> El seed asume que existe el slug `director`. **Si en la DB el slug real es `director_ops` (no `director`), el INSERT fallaría silenciosamente** (0 filas). Por eso **se verifica primero, en modo solo-lectura, qué catálogo está vivo.**

### 2.1 — Todas estas consultas son `SELECT` (no modifican nada). Ejecutar en **SANDBOX** primero.

**Dónde:** Supabase Dashboard → proyecto **tops-nexus-staging** (`vrxosunxlhohmqymxots`) → SQL Editor → New query.

```sql
-- Q1 · Catálogo de roles completo
SELECT id, slug, name
FROM public.roles
ORDER BY slug;
```
**Qué mirar:** anotá los `slug` reales. Buscá si existe `director` y `administracion` (catálogo de 6) o `director_ops`/`admin` (catálogo de 7).

```sql
-- Q2 · ¿Existen exactamente los slugs que el seed espera?
SELECT
  bool_or(slug = 'director')       AS tiene_director,
  bool_or(slug = 'administracion') AS tiene_administracion
FROM public.roles;
```
**Esperado para continuar por la vía normal:** `tiene_director = true` Y `tiene_administracion = true`.

```sql
-- Q3 · ¿Existen los usuarios en auth.users?
SELECT id, email, created_at, last_sign_in_at
FROM auth.users
WHERE email IN ('joseluis@logisticatops.com', 'ruth@logisticatops.com')
ORDER BY email;
```
**Esperado:** 2 filas, una por email. `last_sign_in_at` idealmente no NULL (ya iniciaron sesión alguna vez).

```sql
-- Q4 · ¿user_roles está dormido (vacío para estos usuarios)?
SELECT u.email, r.slug, ur.position_title, ur.assigned_at
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
JOIN public.roles r ON r.id = ur.role_id
WHERE u.email IN ('joseluis@logisticatops.com', 'ruth@logisticatops.com');
```
**Esperado:** 0 filas (RBAC dormido). Si ya hay filas → ya están seedeados, **no hace falta este runbook**.

```sql
-- Q5 · Conteo global de user_roles (confirma el estado "dormido" del sistema)
SELECT count(*) AS total_user_roles FROM public.user_roles;
```
**Esperado:** `0`.

### 2.2 — Árbol de decisión según resultado de Q2

| Resultado de Q2 | Q3 (usuarios) | Acción |
|-----------------|---------------|--------|
| `director` ✅ + `administracion` ✅ | 2 filas ✅ | ➡️ Ir a **STEP 2** (catálogo OK, usuarios OK) |
| Falta `director` y/o `administracion` | — | ➡️ Ir a **STEP 1B** (seedear catálogo primero) |
| Catálogo usa `director_ops`/`admin` (los 7) | — | 🛑 **DETENER. Escalar.** No asumir mapeo. Ver §2.3 |
| Q3 devuelve <2 filas (falta un usuario) | — | 🛑 **DETENER.** El usuario faltante debe crear cuenta y hacer login primero. Ver §2.4 |

### 2.3 — Si el catálogo vivo es el de 7 roles (`director_ops` en vez de `director`)

**NO ejecutar el seed con slug `director`.** Esto es una decisión arquitectónica, no operativa:
1. Documentar el catálogo real (output de Q1) en un nuevo doc `RBAC-CATALOG-RECONCILIATION.md`.
2. Escalar al presidente: ¿se adopta el catálogo de 6 (`director`/`administracion`, ejecutando `seed-rbac-real-roles.sql`) o se mapea a los slugs existentes (`director_ops`/`admin`)?
3. **No continuar** hasta resolver. El resto de este runbook asume catálogo de 6.

### 2.4 — Si falta un usuario en `auth.users`

1. La persona debe registrarse en https://tops-ordenes.netlify.app/login con el email exacto esperado.
2. Re-correr Q3 hasta que aparezcan las 2 filas.
3. Recién entonces continuar.

---

## 3 · STEP 1B — (Condicional) Seedear el catálogo de roles

> **Solo si Q2 mostró que falta `director` y/o `administracion`.** Si ya existían, **saltar a STEP 2.**

**Dónde:** SQL Editor de **SANDBOX**.

**Qué correr:** el contenido completo de `scripts/seed-rbac-real-roles.sql` (idempotente, usa `ON CONFLICT`). Crea 6 roles + 22 permisos + matriz `role_permissions`.

**Verificación post-seed:**
```sql
SELECT r.slug, COUNT(rp.permission_id) AS perms
FROM public.roles r
LEFT JOIN public.role_permissions rp ON rp.role_id = r.id
WHERE r.slug IN ('director','administracion','operaciones','comercial','deposito','auditor')
GROUP BY r.slug
ORDER BY r.slug;
```
**Esperado (según el script):**
```
director       → 22
administracion → 21
operaciones    →  9
comercial      →  3
deposito       →  4
auditor        →  7
```
Si los conteos coinciden → continuar a STEP 2.

---

## 4 · STEP 2 — Seed de `user_roles` en SANDBOX

> Esto **sí escribe** (2 filas). Pero en **sandbox**, dentro de una transacción que podés revertir. **No tocar prod en este paso.**

### 4.1 — Script (pegar en SQL Editor de SANDBOX `vrxosunxlhohmqymxots`)

El SQL Editor web **no soporta variables `\set` de psql**. Este script ya tiene los **valores literales** embebidos — copiá y pegá tal cual.

```sql
-- ============================================================================
-- RBAC Seed · Director (José Luis Rodríguez) + Administración (Ruth Carrasquero)
-- TARGET: SANDBOX vrxosunxlhohmqymxots — NO ejecutar en prod en este paso
-- Identificación por EMAIL (el apellido no entra en el seed)
-- ============================================================================
BEGIN;

-- 1. Pre-flight: validar usuarios y roles ANTES de insertar
DO $$
DECLARE
  v_dir_user int; v_adm_user int; v_dir_role int; v_adm_role int;
BEGIN
  SELECT count(*) INTO v_dir_user FROM auth.users WHERE email = 'joseluis@logisticatops.com';
  SELECT count(*) INTO v_adm_user FROM auth.users WHERE email = 'ruth@logisticatops.com';
  SELECT count(*) INTO v_dir_role FROM public.roles WHERE slug = 'director';
  SELECT count(*) INTO v_adm_role FROM public.roles WHERE slug = 'administracion';

  IF v_dir_user = 0 THEN RAISE EXCEPTION 'FALTA usuario Director (joseluis@logisticatops.com) en auth.users'; END IF;
  IF v_adm_user = 0 THEN RAISE EXCEPTION 'FALTA usuario Administración (ruth@logisticatops.com) en auth.users'; END IF;
  IF v_dir_role = 0 THEN RAISE EXCEPTION 'FALTA role slug=director — correr seed-rbac-real-roles.sql primero (STEP 1B)'; END IF;
  IF v_adm_role = 0 THEN RAISE EXCEPTION 'FALTA role slug=administracion — correr seed-rbac-real-roles.sql primero (STEP 1B)'; END IF;

  RAISE NOTICE 'Pre-flight OK: usuarios y roles existen';
END $$;

-- 2. INSERT Director
INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT u.id, r.id, 'Director de Operaciones', u.id, now()
FROM auth.users u
CROSS JOIN public.roles r
WHERE u.email = 'joseluis@logisticatops.com' AND r.slug = 'director'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 3. INSERT Administración
INSERT INTO public.user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT u.id, r.id, 'Administración · Verotin S.A.', u.id, now()
FROM auth.users u
CROSS JOIN public.roles r
WHERE u.email = 'ruth@logisticatops.com' AND r.slug = 'administracion'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 4. Verificación post-INSERT
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.user_roles ur
  JOIN auth.users u ON u.id = ur.user_id
  JOIN public.roles r ON r.id = ur.role_id
  WHERE u.email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')
    AND r.slug IN ('director','administracion');
  IF v_count <> 2 THEN RAISE EXCEPTION 'Esperaba 2 filas, hay %', v_count; END IF;
  RAISE NOTICE 'Post-INSERT OK: 2 filas en user_roles';
END $$;

-- 5. Salida visual para revisión humana
SELECT u.email, r.slug AS role, ur.position_title, ur.assigned_at,
       (SELECT email FROM auth.users WHERE id = ur.assigned_by) AS assigned_by_email
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
JOIN public.roles r ON r.id = ur.role_id
WHERE u.email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')
ORDER BY r.slug;

-- ============================================================================
-- DECISIÓN MANUAL:
--   Si la salida visual muestra 2 filas correctas →  COMMIT;
--   Si algo sorprende                             →  ROLLBACK;
-- ============================================================================
-- COMMIT;
-- ROLLBACK;
```

### 4.2 — Cómo decidir COMMIT vs ROLLBACK

1. Mirá la tabla de "Salida visual" (sección 5 del script).
2. Confirmá: 2 filas, emails correctos, roles `director`/`administracion`, `position_title` correcto.
3. Si todo OK → escribí `COMMIT;` y ejecutá. Si no → `ROLLBACK;`.

> ⚠️ El `BEGIN;` abre transacción. Mientras no hagas `COMMIT`, nada queda persistido. El SQL Editor de Supabase puede auto-commitear por sentencia según configuración — por seguridad, ejecutá el bloque y luego `COMMIT;`/`ROLLBACK;` como sentencia separada, y re-verificá con Q4 (§2.1).

---

## 5 · STEP 3 — Validación funcional en SANDBOX

> Antes de prod, validar que el enforcement funciona. **Lo ejecutan las personas reales** (o cuentas de prueba) contra el entorno donde apunte el sandbox.

### 5.1 — Validación de datos (SQL read-only en sandbox)
```sql
SELECT count(*) FROM public.user_roles;          -- esperado: ≥ 2
SELECT * FROM public.my_permissions;             -- corre como el usuario actual
```

### 5.2 — Validación funcional (checklist por persona)

| # | Test | Esperado | Quién |
|---|------|----------|-------|
| V1 | José Luis hace login | sesión activa | JL |
| V2 | JL entra a `/billing` | accede (sin redirect a /login) | JL |
| V3 | JL entra a `/anmat` | accede (`compliance.view`) | JL |
| V4 | JL entra a `/cctv` | accede (`cctv.view` + `cctv.admin`) | JL |
| V5 | JL entra a `/settings/roles` | accede (`sistema.admin`) | JL |
| V6 | Ruth hace login | sesión activa | Ruth |
| V7 | Ruth entra a `/billing` | accede | Ruth |
| V8 | Ruth entra a `/anmat` | accede | Ruth |
| V9 | (firma) Ruth intenta firmar una OC | **denegado** (admin no tiene `compras.sign`) | Ruth |

### 5.3 — Test crítico de denegación (R22 / fail-open)
> Con `user_roles` poblado, el fallback "fail-open" (que dejaba pasar a todos cuando la tabla estaba globalmente vacía) **deja de aplicar**. Un usuario autenticado **sin rol** debe recibir 403.

| # | Test | Esperado |
|---|------|----------|
| V10 | Cuenta de prueba **sin rol** llama `/api/billing/recurring/contracts` | **403 — Permiso requerido: billing.view** |

**Si V10 devuelve 200 (sigue fail-open):** algo está mal. Verificar: ¿`user_roles` realmente tiene filas? ¿`checkPermission()` usa el cliente admin (R22 fix)? Revisar logs de Netlify Functions. **No promover a prod hasta resolver.**

---

## 6 · STEP 4 — Promoción a PRODUCCIÓN

> 🔴 **Gate duro:** no entrar a este paso si **P0.1 Backup no está CERRADO** (ver checklist P1.2). El RBAC seed es reversible, pero exigimos backup como red de seguridad estándar antes de tocar prod.

### 6.1 — Pre-condiciones de promoción
- [ ] STEP 2 + STEP 3 completados en sandbox sin issues.
- [ ] V1–V9 PASS y V10 PASS (denegación) en sandbox.
- [ ] **P0.1 Backup CERRADO** (backup productivo verificado existe).
- [ ] Aprobación explícita del presidente para ejecutar en prod.
- [ ] JL y Ruth disponibles para validar inmediatamente.

### 6.2 — Procedimiento
1. Abrir Supabase Dashboard → proyecto **producción** `arsksytgdnzukbmfgkju` → SQL Editor.
   - ⚠️ **Confirmá visualmente el nombre del proyecto antes de pegar nada.** Es el paso de mayor riesgo de confusión prod↔sandbox.
2. Re-correr **STEP 1 (verificación read-only Q1–Q5)** contra prod. El estado debe ser: catálogo con `director`/`administracion`, 2 usuarios, `user_roles` con 0 filas para ellos.
   - Si el catálogo de prod difiere del de sandbox → **DETENER** y reconciliar (§2.3).
3. Si Q2/Q3/Q4 OK → pegar y ejecutar el **mismo script de STEP 2 (§4.1)**, ya con valores literales.
4. Revisar salida visual → `COMMIT;` si las 2 filas son correctas.
5. Re-verificar con Q4 (§2.1) sobre prod: 2 filas.
6. Validación inmediata en prod:
   - JL hace login en https://tops-ordenes.netlify.app/login → V2–V5.
   - Ruth hace login → V7–V9.
   - V10 (denegación) con cuenta de prueba si existe.
7. Capturar evidencia (ver STEP 6).

---

## 7 · STEP 5 — Rollback (si algo falla)

> Devuelve el sistema al estado "RBAC dormido" (fail-open). No es ideal a largo plazo, pero es seguro como medida temporal.

**Dónde:** el entorno donde falló (sandbox o prod).
```sql
BEGIN;
DELETE FROM public.user_roles
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')
)
AND role_id IN (
  SELECT id FROM public.roles WHERE slug IN ('director','administracion')
);
-- Verificar:
SELECT count(*) FROM public.user_roles
WHERE user_id IN (SELECT id FROM auth.users WHERE email IN ('joseluis@logisticatops.com','ruth@logisticatops.com'));
-- esperado: 0
-- COMMIT;  (si el conteo es 0 y querés confirmar el rollback)
-- ROLLBACK;
```
- El DELETE filtra por email → **no afecta** a otros usuarios que pudieran haberse seedeado después.
- Es idempotente: una segunda corrida borra 0 filas.

**Cuándo invocar rollback:** V1–V9 fallan, V10 sigue en 200, o JL/Ruth no pueden loguear tras el seed.

---

## 8 · STEP 6 — Evidencia y cierre

Al terminar (sandbox y prod), generar:

1. `RBAC-SEED-CLOSURE-SANDBOX.md` — output de STEP 2/3 en sandbox.
2. `RBAC-SEED-CLOSURE-PROD.md` — output de STEP 4 en prod, incluyendo: `user_id` de JL y Ruth, `role_id` de cada rol, timestamp del INSERT, operador.
3. Re-emitir `PRE-FLIGHT-RBAC-REPORT.md` → versión **PASS** (`PRE-FLIGHT-RBAC-REPORT-V2.md`).
4. Actualizar `PRE-FLIGHT-GATE-0.md`: P0.2 → 🟢 PASS.

---

## 9 · Resumen de seguridad

| Garantía | Cómo se cumple |
|----------|----------------|
| No se rompe nada irreversible | Todo en `BEGIN`/`COMMIT`; rollback documentado |
| No se toca prod sin red | Gate P0.1 Backup cerrado obligatorio |
| Sandbox primero | STEP 2/3 antes de STEP 4 |
| Identificación robusta | por email (no por apellido); pre-flight valida existencia |
| Idempotente | `ON CONFLICT DO NOTHING` |
| Auditable | `assigned_by` + `assigned_at`; evidencia en docs de cierre |
| Divergencia de catálogo cubierta | STEP 1 verifica slugs reales antes de escribir |

---

## 10 · Restricciones honradas (ETAPA 0B)

- 🛑 NO EJECUTAR SQL · NO TOCAR sandbox ni producción
- 🛑 NO MODIFICAR código (`org.ts` y apellidos → ver `ORG-DATA-CONSISTENCY-REPORT.md`)
- 🛑 NO COMMIT · NO PUSH · NO DEPLOY · NO MERGE
- 🛑 NO INVENTAR — script y conteos trazados a `scripts/seed-rbac-real-roles.sql`, mig `0009_rbac`, `src/lib/org.ts`, `src/lib/env.ts` y decisiones del presidente (2026-05-29)
