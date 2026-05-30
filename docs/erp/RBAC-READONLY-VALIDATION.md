# RBAC-READONLY-VALIDATION

**Fecha:** 2026-05-29
**Track:** A (RBAC) · **paso autorizado:** verificación read-only del catálogo previo a cualquier seed.
**Naturaleza:** 100% solo-lectura. **No se ejecutó ningún INSERT/UPDATE/DELETE/seed/deploy/migración.**
**Método:** Supabase Management API `POST /v1/projects/{ref}/database/query` con `read_only: true`, ejecutando únicamente sentencias `SELECT`.
**Entornos consultados:**
- **SANDBOX** `vrxosunxlhohmqymxots` (tops-nexus-staging)
- **PRODUCCIÓN** `arsksytgdnzukbmfgkju`

> 🛑 **Resultado de cabecera:** el catálogo de roles **vivo en ambos entornos es el de 7 roles** (`director_ops`, `admin`, …). **NO existen** los slugs `director` ni `administracion` que asume el seed (`scripts/seed-rbac-real-roles.sql`) y el `RBAC-EXECUTION-RUNBOOK` STEP 2. Esto corresponde a la rama **§2.3 "DETENER · Escalar"** del runbook: se requiere una **decisión de mapeo del presidente** antes de cualquier seed. El SQL exacto recomendado (sección 5) usa los slugs reales `director_ops`/`admin` y queda **sujeto a esa aprobación**.

---

## 1 · Rol existente

| Slug buscado | SANDBOX | PRODUCCIÓN | Veredicto |
|--------------|:------:|:----------:|-----------|
| `director` | ❌ no existe | ❌ no existe | **NO existe** |
| `director_ops` | ✅ existe | ✅ existe | **Es el rol vivo** (name: "Director de Operaciones") |
| `administracion` | ❌ no existe | ❌ no existe | **NO existe** |
| `admin` | ✅ existe | ✅ existe | **Es el rol vivo** (name: "Administración") |

**Respuesta directa a "director / director_ops / ambos / ninguno":** **`director_ops`** (no `director`). El homólogo de Administración es **`admin`** (no `administracion`).

**Catálogo completo vivo (idéntico en sandbox y prod) — 7 roles:**

| slug | name |
|------|------|
| `admin` | Administración |
| `cliente_b2b` | Cliente B2B |
| `comercial` | Comercial |
| `compliance` | Compliance / DT |
| `director_ops` | Director de Operaciones |
| `operaciones` | Operaciones |
| `seguridad` | Seguridad / CCTV |

**IDs de los roles objetivo (difieren por entorno — esperado):**

| slug | UUID SANDBOX | UUID PRODUCCIÓN |
|------|--------------|-----------------|
| `director_ops` | `220a602c-286d-4e1a-9cc6-0585d1e89849` | `7ca43377-8678-4fd3-8f8a-995920809cb2` |
| `admin` | `5937f3ab-f84e-4cdd-9ce2-3d5f52492add` | `335f09d6-e8a3-4057-aae9-5fcdd700c07d` |

---

## 2 · Existencia de usuarios en `auth.users`

| Email | SANDBOX | PRODUCCIÓN | `user_id` (prod) | `last_sign_in_at` (prod) |
|-------|:------:|:----------:|------------------|--------------------------|
| `joseluis@logisticatops.com` | ❌ **no existe** | ✅ existe | `3b1607c9-32c5-4ca0-91e1-19c82099b64d` | 2026-05-27 20:09:38 UTC |
| `ruth@logisticatops.com` | ❌ **no existe** | ✅ existe | `5b635940-28be-43ab-a2bd-606481052bee` | 2026-05-26 13:39:47 UTC |

**Implicancia operativa:**
- En **PRODUCCIÓN** ambos usuarios existen y ya iniciaron sesión → el seed real es ejecutable allí (sujeto a aprobación + backup P0.1).
- En **SANDBOX** **ninguno** de los dos existe → el seed para JL/Ruth **fallaría el pre-flight** del runbook. Para ensayar en sandbox hay que **crear cuentas de prueba primero** (registro en el entorno) o validar el enforcement con cuentas test genéricas.

---

## 3 · Conteos reales

| Métrica | SANDBOX | PRODUCCIÓN |
|---------|:------:|:----------:|
| `user_roles` (filas totales) | **0** | **0** |
| `roles` | **7** | **7** |
| `permissions` | **24** | **24** |

- `user_roles = 0` en ambos → **RBAC confirmado DORMIDO** (fallback fail-open R22 activo). Q4/Q5 del runbook: 0 filas para los usuarios objetivo.
- `permissions = 24` (no 22). El seed `seed-rbac-real-roles.sql` documentaba 22; el catálogo vivo tiene 24.

**Catálogo de 24 permisos (slugs):**
`analytics.view, cctv.admin, cctv.view, cockpit.export, cockpit.view, comercial.edit, comercial.view, compliance.edit, compliance.view, compras.create, compras.delete, compras.edit, compras.export, compras.sign, compras.view, documental.admin, documental.create, documental.delete, documental.export, documental.view, servicios.create, servicios.sign, servicios.view, sistema.admin`

**Grants de los roles objetivo:**

| Rol | # permisos | Tiene `sistema.admin` | Tiene `compras.sign` |
|-----|:---------:|:---------------------:|:--------------------:|
| `director_ops` | 22 | ✅ | ✅ |
| `admin` | 23 | ✅ | ❌ (no lo tiene) |

> El test de denegación **V9** del runbook ("Ruth/Admin NO puede firmar OC") **sigue siendo válido**: `admin` no incluye `compras.sign`, `director_ops` sí.

---

## 4 · Consistencia y divergencias

### 4.1 — Lo que ES consistente ✅
- **Sandbox ↔ Prod:** mismo catálogo (7 roles idénticos, mismos slugs/names) y mismo conteo de permisos (24). La estructura RBAC está sincronizada entre entornos.
- **Estado dormido:** `user_roles = 0` en ambos.
- **Estructura de `user_roles`:** existe el índice único **`user_roles_pkey UNIQUE (user_id, role_id)`** → la cláusula `ON CONFLICT (user_id, role_id) DO NOTHING` del runbook **es válida y soportada**.
- Columnas de `user_roles`: `user_id` (uuid, NOT NULL), `role_id` (uuid, NOT NULL), `position_title` (text, NULL ok), `depot` (enum, NULL ok), `assigned_at` (timestamptz, default `now()`), `assigned_by` (uuid, NULL ok).

### 4.2 — Divergencias encontradas ⚠️

| # | Divergencia | Detalle | Severidad |
|---|-------------|---------|-----------|
| **D1** | **Catálogo vivo ≠ seed ≠ runbook** | DB viva = 7 roles (`director_ops`/`admin`). `seed-rbac-real-roles.sql` y `RBAC-EXECUTION-RUNBOOK` STEP 2 asumen 6 roles (`director`/`administracion`). Seedear con slug `director` insertaría **0 filas** (silencioso). | 🔴 **Bloqueante** — rama §2.3 |
| **D2** | **Usuarios ausentes en sandbox** | `joseluis@` y `ruth@` no existen en `auth.users` de sandbox. El seed sandbox falla pre-flight sin crear cuentas test. | 🟠 Alta |
| **D3** | **No existe permiso `billing.*`** | El catálogo de 24 permisos **no incluye** `billing.view` ni ningún `billing.*`. El runbook (V2/V10) referencia `billing.view`, que **no existe hoy**. Las rutas `/billing` no están gobernadas por un permiso `billing.*` dedicado (probablemente caen bajo `sistema.admin` u otro). FASE 1A deberá decidir si crea `billing.*`. | 🟠 Alta (afecta diseño de tests + scope FASE 1A) |
| **D4** | **UUIDs de roles distintos por entorno** | Esperado (cada proyecto genera sus propios IDs). Implica que el SQL con UUIDs literales **no es portable**; usar resolución por slug/email. | 🟢 Informativa |
| **D5** | **Conteo de permisos 24 vs 22** | El catálogo vivo tiene 24 permisos; el script de seed documentaba 22. El catálogo vivo está más avanzado que el script versionado. | 🟢 Informativa |
| **D6** | **`cliente_b2b` no estaba en ningún catálogo documentado** | El rol `cliente_b2b` existe vivo pero no figura ni en el seed de 6 ni en las notas del catálogo de 7. | 🟢 Informativa |

### 4.3 — Veredicto de consistencia
- **Catálogo RBAC consistente entre entornos:** ✅ **SÍ** (sandbox == prod).
- **Catálogo RBAC consistente con la documentación de seed/runbook:** ❌ **NO** (divergencia D1, bloqueante).
- **Listo para seed directo con el runbook tal como está escrito:** ❌ **NO** — el runbook asume slugs inexistentes.

---

## 5 · Recomendación final

### 5.1 — Decisión previa requerida (NO operativa — del presidente)

Antes de cualquier seed, resolver **D1** (rama §2.3 del runbook). Opciones:

- **Opción A (recomendada):** **adoptar el catálogo vivo de 7 roles** y mapear:
  - Director (José Luis Rodríguez) → **`director_ops`**
  - Administración (Ruth Carrasquero) → **`admin`**
  - No se toca el catálogo (ya existe y es consistente entre entornos). El seed solo agrega 2 filas a `user_roles`.
- **Opción B:** reescribir el catálogo al esquema de 6 (`director`/`administracion`) ejecutando `seed-rbac-real-roles.sql`. **No recomendada** — duplicaría/colisionaría con el catálogo vivo de 7 y rompería referencias existentes.

> El resto de esta sección asume **Opción A** (mapeo a `director_ops`/`admin`). Si se elige otra, el SQL cambia.

### 5.2 — SQL exacto requerido para **SANDBOX** (`vrxosunxlhohmqymxots`)

⚠️ **Pre-requisito sandbox (D2):** `joseluis@` y `ruth@` **no existen** en sandbox. Antes de este SQL hay que **crear esas cuentas** (registro en el entorno sandbox) **o** sustituir por cuentas de prueba. Sin eso, el pre-flight aborta con `RAISE EXCEPTION`.

```sql
-- TARGET: SANDBOX vrxosunxlhohmqymxots — SQL Editor
-- Mapeo Opción A: director_ops + admin. Identifica por EMAIL+SLUG (portable, sin UUIDs literales).
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

-- Verificación (esperado: 2 filas)
SELECT u.email, r.slug, ur.position_title
FROM public.user_roles ur
JOIN auth.users u ON u.id=ur.user_id
JOIN public.roles r ON r.id=ur.role_id
WHERE u.email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')
ORDER BY r.slug;

-- COMMIT;   -- si la verificación muestra 2 filas correctas
-- ROLLBACK; -- en cualquier otro caso
```

### 5.3 — SQL exacto requerido para **PRODUCCIÓN** (`arsksytgdnzukbmfgkju`)

Usuarios **ya existen** (sección 2) → el pre-flight pasará. **Gate duro:** no ejecutar en prod sin **P0.1 Backup CERRADO** y aprobación explícita. El SQL es **idéntico** al de sandbox (portable por email+slug):

```sql
-- TARGET: PRODUCCIÓN arsksytgdnzukbmfgkju — confirmar nombre del proyecto antes de pegar.
-- (idéntico al de §5.2; el pre-flight valida usuarios existentes)
BEGIN;
-- … mismo bloque DO $$ + 2 INSERT + SELECT de verificación que §5.2 …
-- COMMIT;  /  ROLLBACK;
```

**IDs ya resueltos (solo para verificación post-seed, NO para hardcodear):**

| Entidad | UUID PRODUCCIÓN |
|---------|-----------------|
| user `joseluis@` | `3b1607c9-32c5-4ca0-91e1-19c82099b64d` |
| user `ruth@` | `5b635940-28be-43ab-a2bd-606481052bee` |
| role `director_ops` | `7ca43377-8678-4fd3-8f8a-995920809cb2` |
| role `admin` | `335f09d6-e8a3-4057-aae9-5fcdd700c07d` |

Filas esperadas tras COMMIT:
- `(3b1607c9…, 7ca43377…, 'Director de Operaciones')`
- `(5b635940…, 335f09d6…, 'Administración · Verotin S.A.')`

### 5.4 — Acciones recomendadas antes de habilitar ETAPA 1 (RBAC)
1. **Presidente:** aprobar el **mapeo Opción A** (`director_ops`/`admin`). Cierra D1.
2. **Actualizar `RBAC-EXECUTION-RUNBOOK.md`** (AMENDMENT aditivo) para usar `director_ops`/`admin` en STEP 2 y reflejar D2/D3. *(No ejecutado en este paso — solo recomendación.)*
3. **D3 (billing):** decidir en FASE 1A si se crea el permiso `billing.view`/`billing.*` y a qué roles se asigna; ajustar tests V2/V10 en consecuencia.
4. **D2 (sandbox):** crear cuentas de prueba para validar enforcement en sandbox, o validar directamente en prod con JL/Ruth + una cuenta test sin rol para V10.

---

## 5.5 · AMENDA (2026-05-30) — Decisión del presidente registrada

> **Aditivo.** No ejecuta ninguna escritura. Solo deja constancia de la aprobación y del artefacto preparado.

El presidente (Martín Battaglia) **aprobó el mapeo Opción A**:

| Usuario | Rol asignado |
|---------|--------------|
| José Luis Rodríguez Silva (`joseluis@logisticatops.com`) | `director_ops` |
| Ruth Carrasquero (`ruth@logisticatops.com`) | `admin` |

Esto **cierra D1** (decisión de mapeo pendiente) a nivel de decisión. El catálogo vivo (7 roles) ya es consistente, por lo que no se toca.

**Artefacto preparado (NO ejecutado):** `scripts/seed-rbac-assign-users-OPCION-A.sql` — script listo para pegar manualmente en el SQL Editor de Supabase. Contiene dos bloques (SANDBOX y PRODUCCIÓN), cada uno con pre-flight `RAISE EXCEPTION`, 2 `INSERT` idempotentes (`ON CONFLICT DO NOTHING`), `SELECT` de verificación y `COMMIT`/`ROLLBACK` comentados. Reproduce textualmente el SQL de §5.2/§5.3.

**Sigue pendiente / sin ejecutar:**
- `user_roles` sigue en **0** en ambos entornos. El RBAC sigue **dormido** hasta que alguien corra el script manualmente.
- SANDBOX requiere crear primero `joseluis@`/`ruth@` (D2) o el pre-flight aborta.
- PROD exige BACKUP CERRADO (P0.1) + confirmación explícita antes de `COMMIT`.

---

## 6 · Restricciones honradas

- ✅ Solo `SELECT` (Management API con `read_only: true`). **Cero** INSERT/UPDATE/DELETE/seed.
- 🛑 NO se creó ni modificó ningún rol, usuario, permiso ni fila de `user_roles`.
- 🛑 NO deploy · NO migración · NO push · NO merge · NO commit · NO cambios en producción.
- 🛑 NO se modificó código ni documentos aprobados (este es un documento **nuevo**).
- **Detención:** este reporte cierra el paso autorizado. **No se ejecutará ninguna modificación** hasta autorización explícita.

---

## Apéndice · Trazabilidad de evidencia

Todas las cifras provienen de consultas `SELECT` vía `https://api.supabase.com/v1/projects/{ref}/database/query` (`read_only:true`), ejecutadas 2026-05-29 contra `vrxosunxlhohmqymxots` (sandbox) y `arsksytgdnzukbmfgkju` (prod):
- Catálogo de roles, conteos (roles/permissions/user_roles), flags `tiene_*` → query consolidada Q-A.
- Existencia/`last_sign_in_at` de usuarios → `auth.users` filtrado por email.
- Estructura `user_roles`, índices (`user_roles_pkey`), grants por rol → `information_schema` + `pg_indexes` + `role_permissions`.
- Catálogo de 24 permisos → `public.permissions`.
