# PRE-FLIGHT · RBAC REPORT

**Fecha:** 2026-05-29
**Pre-condición:** P0.2 — Verificar RBAC seedeado para Director (JL) y Admin (Ruth).
**Estado:** 🔴 **FAIL** (con remediación trivial disponible)
**Modo:** verificación · sin modificar nada · sin ejecutar queries a producción.

---

## 1 · Resultado

| Aspecto | Estado | Evidencia |
|---------|--------|-----------|
| Tablas RBAC creadas | ✅ EXISTE | mig `0009_rbac.sql` aplicada (per memoria GATE B) |
| Funciones `current_role()` + `has_permission()` | ✅ EXISTE | mig `0009_rbac.sql:155-175` |
| Seed de roles (6 roles reales) | ✅ EXISTE script | `scripts/seed-rbac-real-roles.sql` |
| Seed de permissions (22 permisos) | ✅ EJECUTADO | per memoria: "7 roles/22 perms/64 mapeos seedeados" |
| Seed de role_permissions | ✅ EJECUTADO | idem |
| **`user_roles` con Director (JL)** | ❌ **AUSENTE** | memoria: `user_roles=0` (RBAC dormido) |
| **`user_roles` con Admin (Ruth)** | ❌ **AUSENTE** | idem |
| Script `seed-rbac-real-roles.sql` incluye user_roles | ❌ NO | el script declara explícitamente "NO incluye INSERT a user_roles" |

**Verdict:** ❌ **FAIL — RBAC dormido. La tabla `user_roles` está vacía. Director y Admin NO tienen rol asignado.**

---

## 2 · Evidencia objetiva

### 2.1 Memoria persistente del proyecto

`~/.claude/projects/-Users-martinbattaglia-CODE/memory/tops_nexus_state.md`:

> **RBAC dormido confirmado:** `user_roles`=0; 7 roles/22 perms/64 mapeos seedeados; funciones `current_role()` + `has_permission()` existen; enum `user_role_t`=admin/operaciones/supervisor/cliente (4) ≠ tabla `roles` (7, incl. director_ops/compliance/seguridad).

Esta verificación fue hecha en auditoría del 2026-05-29 (GATE B closure). Mientras nada haya cambiado desde entonces (no se ha ejecutado INSERT a `user_roles`), el estado se mantiene.

### 2.2 Script seed disponible

`scripts/seed-rbac-real-roles.sql` (header):

```sql
-- NEXUS · RBAC Seed real · 6 roles + 22 permisos + role_permissions
-- Genera idempotentemente los 6 roles reales de Logística TOPS:
--   1. director
--   2. administracion
--   3. operaciones
--   4. comercial
--   5. deposito
--   6. auditor
-- + 22 permisos seedeados + matriz role_permissions.
--
-- NO incluye INSERT a user_roles. Las asignaciones reales se hacen
-- después, con datos verificados del staff de Verotin S.A.
```

→ El catálogo (`roles`, `permissions`, `role_permissions`) está sembrado.
→ La asignación `user_id → role_id` para JL y Ruth está pendiente.

### 2.3 Auditoría documentada

`docs/ERP-AUDITORIA-SUPABASE-2026-05-29.md` confirma:

```
user_roles  | **0** ← **RBAC granular DORMIDO**
profiles    | 6
```

→ 6 perfiles existen (los usuarios reales registrados en `auth.users`/`profiles`) pero ninguno tiene rol asignado.

### 2.4 Riesgo conocido — R22 closure

`docs/R22-CLOSURE-REPORT.md` documenta:

> Por qué fail-open en (4): si fail-closed antes de seedear roles, NADIE (ni Director, ni Compliance) puede usar Drive. Bloqueo total no buscado. El warn en logs hace visible que falta seedear.

→ El RBAC actual hace **fail-open con WARN** mientras `user_roles` esté vacía. Esto es **aceptable como hack temporal** pero **inaceptable para FASE 1A producción** (factura electrónica con audit trail requiere RBAC enforced).

---

## 3 · Datos que necesito para la remediación

Para insertar las 2 filas mínimas en `user_roles`, necesito:

| Persona | Dato requerido | Cómo obtener |
|---------|----------------|---------------|
| **JL (Director)** | `auth.users.id` (uuid) | SELECT id FROM auth.users WHERE email='joseluis@logisticatops.com' |
| **JL (Director)** | role_id de `director` | SELECT id FROM roles WHERE slug='director' |
| **Ruth (Admin)** | `auth.users.id` | SELECT id FROM auth.users WHERE email='ruth@logisticatops.com' |
| **Ruth (Admin)** | role_id de `administracion` | SELECT id FROM roles WHERE slug='administracion' |

**Limitación:** las queries arriba requieren acceso a producción Supabase. NO se ejecutan en este pre-flight (restricción explícita: NO TOCAR producción).

**Mitigación:** los datos pueden obtenerse de 2 maneras:
1. **Usuario ejecuta las queries** en Supabase SQL Editor y me pega resultados
2. **Asumir emails** documentados en `src/lib/env.ts` y `src/lib/org.ts` y construir el SQL parametrizado

---

## 4 · Plan de remediación

### 4.1 SQL propuesto (sin ejecutar — para revisión)

```sql
-- A ejecutar EN SUPABASE SANDBOX primero, luego en producción
-- bajo gate ejecutivo, con OK explícito del usuario

-- 1. Verificar que el catálogo está completo (idempotente)
DO $$
BEGIN
  IF (SELECT count(*) FROM roles WHERE slug IN ('director','administracion')) < 2 THEN
    RAISE EXCEPTION 'roles faltantes — ejecutar seed-rbac-real-roles.sql primero';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE email IN ('joseluis@logisticatops.com','ruth@logisticatops.com')) < 2 THEN
    RAISE EXCEPTION 'usuarios auth faltantes — JL y Ruth deben estar registrados en auth.users';
  END IF;
END $$;

-- 2. Insertar asignación Director (JL)
INSERT INTO user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT
  u.id,
  r.id,
  'Director de Operaciones',
  u.id,  -- self-assigned como bootstrap
  now()
FROM auth.users u
CROSS JOIN roles r
WHERE u.email = 'joseluis@logisticatops.com'
  AND r.slug = 'director'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 3. Insertar asignación Admin (Ruth)
INSERT INTO user_roles (user_id, role_id, position_title, assigned_by, assigned_at)
SELECT
  u.id,
  r.id,
  'Administración Verotin S.A.',
  u.id,  -- self-bootstrap
  now()
FROM auth.users u
CROSS JOIN roles r
WHERE u.email = 'ruth@logisticatops.com'
  AND r.slug = 'administracion'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 4. Verificar
SELECT
  u.email,
  r.slug AS role,
  ur.position_title,
  ur.assigned_at
FROM user_roles ur
JOIN auth.users u ON u.id = ur.user_id
JOIN roles r ON r.id = ur.role_id
ORDER BY u.email;
```

### 4.2 Pasos formales

1. **Verificar previo:** ¿están JL y Ruth registrados en `auth.users` de producción? Confirmar emails reales.
2. **Aprobación del usuario:** revisar el SQL propuesto y aprobarlo
3. **Ejecutar en sandbox** (`vrxosunxlhohmqymxots` per P0.3) — verifica que no rompe nada
4. **Ejecutar en producción** (`arsksytgdnzukbmfgkju`) con OK explícito
5. **Validar:** test funcional → entrar como JL al sistema, verificar acceso a módulos con `compliance.view`, `billing.create`, etc.
6. **Documentar:** generar `RBAC-SEED-CLOSURE.md` con timestamps y user_ids reales
7. **Re-generar este reporte** como PASS

### 4.3 Implicación del fix

Una vez `user_roles` tiene rows para JL + Ruth:
- El fallback fail-open de R22 closure **deja de aplicar** para esos usuarios
- Cualquier usuario adicional autenticado **sin rol asignado** será denegado por 403 (`Permiso requerido: X`)
- Esto **previene** el bypass de R22 una vez RBAC está vivo

**Importante:** otros usuarios (operaciones, deposito, comercial, etc.) tendrán que ser seedeados también en su momento. Para FASE 1A solo necesitamos Director y Admin (los aprobadores principales).

---

## 5 · Decisiones operativas pendientes (del usuario)

| # | Pregunta | Default propuesto |
|---|----------|---------------------|
| 1 | Email exacto de JL en auth.users | `joseluis@logisticatops.com` (per `src/lib/org.ts` ORG.emitter.email) |
| 2 | Email exacto de Ruth | `ruth@logisticatops.com` (per `src/lib/org.ts` ORG.admin.email) |
| 3 | ¿JL y Ruth ya tienen cuenta en auth.users prod? | requiere SELECT en prod para confirmar |
| 4 | ¿position_title de cada uno? | "Director de Operaciones" / "Administración Verotin S.A." |
| 5 | ¿Se asignan en sandbox primero o solo prod? | Recomendado: sandbox primero |
| 6 | ¿Algún otro usuario crítico para FASE 1A? | Backup admin? Si Ruth está de vacaciones, ¿alguien más aprueba facturas? |

---

## 6 · Conclusión

🔴 **P0.2 RBAC = FAIL.**

**Pero remediación es trivial** (~30 minutos):
- Catálogo seedeado: ✅
- Funciones: ✅
- Solo faltan 2 INSERT (JL + Ruth) en `user_roles`

**Acción requerida del usuario:**
1. Confirmar emails reales de JL y Ruth en `auth.users` prod (o ejecutar SELECT y pegar resultado)
2. Aprobar SQL propuesto
3. Ejecutar primero en sandbox → validar
4. Ejecutar en producción con OK explícito
5. Documentar resultados
6. Re-generar este reporte como PASS

**Estimación:** 1 sesión de 30-60 min con el usuario.

---

## 7 · Restricciones honradas

- 🛑 NO EJECUTAR SQL — solo propuesto para revisión
- 🛑 NO TOCAR producción ni sandbox
- 🛑 NO MODIFICAR scripts existentes
- 🛑 NO INVENTAR — evidencia citada de memoria + scripts + auditoría
