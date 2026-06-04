# RLS 0040 — EXECUTION RUNBOOK (profiles PII lockdown)

> Guía paso a paso para que **el owner (Martín)** aplique manualmente
> `supabase/migrations/0040_profiles_pii_lockdown.sql` en el SQL Editor de Supabase **PRODUCCIÓN**
> con riesgo mínimo. Veredicto previo: **APROBAR 0040 SIN CAMBIOS** (impact analysis + auditoría adversarial).
> Estado: **NO aplicada.** El asistente NO ejecuta WRITES en prod. Fecha: 2026-06-04.
>
> Qué hace 0040: cambia la policy SELECT de `public.profiles` de `id = auth.uid() OR is_staff()`
> a `id = auth.uid() OR is_admin()` → cierra exposición de PII (emails/roles) a staff no-admin (F-01-R).
> Reversible en segundos. No toca datos, ni otras tablas, ni `is_staff()`.

---

## 0. Prerrequisitos
- Acceso admin al proyecto Supabase `arsksytgdnzukbmfgkju` (SQL Editor).
- Conocer 1 usuario **admin** y 1 usuario **no-admin** (operaciones) reales para la verificación por app/API.
  - Admin conocido: `martin@logisticatops.com`. No-admin: `joseluis@logisticatops.com` (OPERACIONES).
- Ventana de bajo tráfico. Tener a mano el bloque de **ROLLBACK** (§5).

---

## 1. PRE-CHECK (read-only — correr en SQL Editor antes de aplicar)

```sql
-- 1.1 Policy SELECT actual de profiles (esperado: "profiles read own or staff" con is_staff())
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'profiles'
order by cmd, policyname;

-- 1.2 RLS habilitada en profiles (esperado: true)
select relname, relrowsecurity
from pg_class
where oid = 'public.profiles'::regclass;

-- 1.3 Cantidad de usuarios y distribución de roles (esperado: total ~7)
select count(*) as total_usuarios from public.profiles;
select role, count(*) from public.profiles group by role order by role;

-- 1.4 Funciones de autorización presentes (esperado: is_admin, is_staff, current_role)
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('is_admin','is_staff','current_role')
order by proname;
```

**Criterio para continuar:** existe **exactamente una** policy SELECT en profiles (`profiles read own or staff`),
RLS = true, las 3 funciones presentes. Si hay policies SELECT extra, **detenerse** y revisar (0040 asume una sola).

---

## 2. BACKUP (checklist previo — obligatorio; PROD compartida, PITR off)

- [ ] **Snapshot/export de la tabla `profiles`** (por las dudas, aunque 0040 no toca datos):
      en Supabase → Table Editor → `profiles` → Export to CSV. (O `pg_dump -t public.profiles`.)
- [ ] **Guardar el estado actual de las policies** (output del §1.1) en un archivo/nota — es el material de rollback.
- [ ] **Backup manual de la DB** (Supabase → Database → Backups → "Create backup" si está disponible, o `pg_dump`).
- [ ] Confirmar que no hay un deploy/migración en curso de otra persona sobre el mismo proyecto.
- [ ] Tener abierta esta runbook con el bloque **ROLLBACK** (§5) listo para pegar.

> 0040 es **solo DDL de policy** (sin cambios de datos), por lo que el riesgo de pérdida es nulo; el backup
> es resguardo estándar de la norma del proyecto.

---

## 3. APLICACIÓN (Supabase SQL Editor)

1. Abrir **Supabase → SQL Editor → New query**.
2. Pegar **el contenido completo** de `supabase/migrations/0040_profiles_pii_lockdown.sql`
   (o copiar solo el bloque ejecutable de abajo — es idéntico):

   ```sql
   drop policy if exists "profiles read own or staff" on public.profiles;
   drop policy if exists "profiles read own or admin" on public.profiles;

   create policy "profiles read own or admin"
     on public.profiles for select
     using (id = auth.uid() or public.is_admin());

   notify pgrst, 'reload schema';
   ```
3. **Run.** Esperado: `Success. No rows returned` (las 2 primeras líneas pueden reportar "policy does not exist, skipping" la primera vez — es normal por el `if exists`).
4. Continuar con el **POST-CHECK** (§4) inmediatamente.

> Idempotente: re-ejecutar el bloque es seguro (vuelve a dejar exactamente una policy SELECT).

---

## 4. POST-CHECK

### 4.1 Verificación de estado (SQL Editor — read-only)
Correr `docs/handoff/RLS_0040_SMOKE_TEST.sql` (sección "CHECKS DE CATÁLOGO"). **Esperado: todas las filas `OK`.**
Verifica: policy nueva activa, policy vieja eliminada, qual usa `is_admin` (no `is_staff`), una sola policy SELECT,
RLS habilitada, funciones presentes.

> ⚠️ **No** uses `select count(*) from profiles` en el SQL Editor para "probar el bloqueo": el SQL Editor corre
> como `postgres` (BYPASSRLS) y verás **todas** las filas siempre. La verificación de comportamiento real va por
> app/API (§4.2) o con el bloque de impersonación opcional del smoke test (BEGIN/ROLLBACK).

### 4.2 Verificación de comportamiento (app / API — autoritativa)
1. **Como ADMIN** (`martin@logisticatops.com`): abrir `/settings/users` → debe **listar los 7 usuarios** (sigue funcionando).
2. **Como NO-ADMIN** (`joseluis@logisticatops.com`, operaciones):
   - `/settings/users` → "Acceso restringido" (ya era así por el guard).
   - **Prueba del cierre de PII (clave):** con su sesión, llamar la API REST directa:
     ```
     GET https://arsksytgdnzukbmfgkju.supabase.co/rest/v1/profiles?select=email,role
       apikey: <anon_key>
       Authorization: Bearer <access_token del usuario operaciones>
     ```
     **Esperado:** devuelve **solo 1 fila** (la propia). *(Antes de 0040 devolvía las 7.)*
3. **Regresión rápida** (como no-admin): el shell sigue mostrando su nombre/rol; el portal/aislamiento por cliente
   y los flujos WMS/Custody siguen operando (no dependen de lectura cross-user de profiles).

### 4.3 Sanity de funciones (SQL Editor)
```sql
select public.is_admin() as is_admin, public.is_staff() as is_staff, public.current_role() as current_role;
-- En SQL Editor (postgres) is_admin/is_staff devuelven false y current_role NULL (no hay auth.uid());
-- esto es ESPERADO. Su semántica real se valida por app (§4.2). El objetivo acá es solo que NO tiren error.
```

---

## 5. ROLLBACK (exacto — pegar en SQL Editor si hay regresión)

```sql
drop policy if exists "profiles read own or admin" on public.profiles;

create policy "profiles read own or staff"
  on public.profiles for select
  using (id = auth.uid() or public.is_staff());

notify pgrst, 'reload schema';
```

- Restaura el comportamiento previo (staff lee todos) en segundos. Idempotente.
- No hay cambios de datos que revertir (0040 es solo policy).
- **Disparadores de rollback:** admin deja de ver `/settings/users`; pantallas que muestren usuarios quedan vacías
  para roles que antes funcionaban; pérdida inesperada de visibilidad en portal-cliente (no esperado).
- Tras rollback, correr §1.1 → debe reaparecer `profiles read own or staff`.

---

## 6. Cierre
- Registrar en el handoff: fecha/hora de aplicación, responsable, resultado del smoke test (§4.1) y de §4.2.
- **NO** marcar Gate como CLOSED por esto: 0040 cierra F-01-R; quedan follow-ups (audit_log payloads con email
  legibles por supervisor, infra F-03). Ver `PRODUCTION_READINESS_REPORT.md`.

> **FIN — Runbook.** El asistente no aplica la migración; la ejecuta el owner siguiendo estos pasos.
