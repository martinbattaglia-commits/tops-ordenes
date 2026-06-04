# RLS 0040 — IMPACT ANALYSIS (profiles PII lockdown)

> Análisis de impacto de la migración **`supabase/migrations/0040_profiles_pii_lockdown.sql`** ANTES de aplicarla.
> Estado: **NO aplicada · NO incluida en release deployable.** Decisión de aplicar = pendiente de esta revisión.
> Repo `~/CODE/tops-ordenes`, rama `main`. Fecha: 2026-06-04.

---

## 1. Qué cambia exactamente

**Única modificación:** la policy **SELECT** de `public.profiles`.

| | Antes (0005) | Después (0040) |
|---|---|---|
| Policy SELECT | `"profiles read own or staff"` → `using (id = auth.uid() OR public.is_staff())` | `"profiles read own or admin"` → `using (id = auth.uid() OR public.is_admin())` |

- `is_staff()` = `role IN ('admin','operaciones','supervisor')` → **se deja de usar en esta policy** (la función NO se borra; otras tablas que la usen siguen igual).
- `is_admin()` = `role = 'admin'`.
- **No se tocan** INSERT/UPDATE/DELETE de `profiles` (ya eran own-or-admin / admin-only en 0005).
- **No se tocan** otras tablas, funciones, datos, ni `is_staff()`/`is_admin()`/`current_role()`.

**Efecto neto:** un usuario **no-admin** solo puede `SELECT` **su propia fila** de `profiles`. Hoy puede leer **todas** (emails/nombres/roles de los 7 usuarios) vía PostgREST directo — esa es la exposición de PII (F-01-R) que se cierra.

---

## 2. Consultas afectadas

### 2.1 Lecturas de `profiles` en el código (PostgREST, RLS-bound)
| Ubicación | Consulta | ¿Afectada? | Por qué |
|---|---|---|---|
| `app/(app)/layout.tsx` (F-06) | `profiles.select(role).eq(id, user.id)` | **No** | Fila propia (`id = auth.uid()`) → sigue permitida. El label del shell funciona para todos. |
| `lib/auth/roles.ts` (guards) | `profiles.select(role).eq(id, user.id)` | **No** | Fila propia. |
| `settings/users/page.tsx:41` | own role (guard) | **No** | Fila propia. |
| `settings/users/page.tsx:60` | `profiles.select(...)` **todos** | **Solo non-admin** | Página **admin-gated** → admin lee todos; non-admin nunca llega (guard). Sin impacto funcional. |
| `settings/users/actions.ts:40` | own role | **No** | Fila propia. |
| `settings/users/actions.ts:63` | `upsert` vía **admin client** | **No** | service_role **bypassa RLS**. |
| `settings/fiscal/page.tsx:42` · `actions.ts:28` | own role | **No** | Fila propia. |
| `lib/rbac/data.ts:275` | `listUserAssignments` join `profiles(email, full_name)` | **Solo non-admin** | Consumido por `/settings/roles` (ahora **admin-gated**, Gate 5.5) y además 0009 no está aplicada (la query ya falla). Sin impacto práctico. |

### 2.2 Subqueries a `profiles` dentro de OTRAS RLS policies
Todas son **`where id = auth.uid()` (fila propia)** → **no afectadas** (la fila propia sigue siendo legible):

| Migración | Uso | ¿Afectada? |
|---|---|---|
| `0001_init.sql:184` | `current_role()` body (`select role ... where id = auth.uid()`) | No (además SECURITY DEFINER en 0005) |
| `0001_init.sql:202,227` | aislamiento por `client_id` (`select client_id ... where id = auth.uid()`) | **No** (fila propia) |
| `0004_extended_schema.sql:112` | `o.client_id = (select client_id ... where id = auth.uid())` | **No** |
| `0010_documents.sql:238,320,388` | scoping de documentos por `client_id` propio | **No** |
| `0011_arca_billing.sql:320` | scoping de facturas por `client_id` propio | **No** |
| `0013_invoices_storage_isolation.sql:57` | scoping de storage de facturas | **No** |

> Clave: **ninguna** subquery consulta el `profiles` de **otro** usuario inline; todas resuelven la propia
> fila. Como 0040 mantiene `id = auth.uid()` permitido, el aislamiento cliente (documents/invoices/orders)
> **sigue intacto**.

### 2.3 Funciones SECURITY DEFINER (bypassan RLS) — no afectadas
`current_role()`, `is_admin()`, `is_staff()` (0005) son `security definer` → leen `profiles` saltándose la RLS.
Por lo tanto **todas las RPC de WMS/Custody** (que usan `current_role()`) y toda policy que use estas
funciones **siguen funcionando exactamente igual** post-0040.

---

## 3. Páginas afectadas

| Página | Impacto post-0040 |
|---|---|
| `/settings/users` | Ninguno (admin-gated; admin lee todos). |
| `/settings/roles*` | Ninguno (admin-gated en Gate 5.5; 0009 no aplicada). |
| Shell / topbar (todas las páginas) | Ninguno — el label lee la **fila propia** (`id = auth.uid()`), siempre legible. |
| Portal cliente / documentos / facturas | Ninguno — el aislamiento por `client_id` usa subquery de fila propia. |
| WMS / Custody / Pedidos / Compras | Ninguno — autorización por `current_role()` (SECURITY DEFINER). |

**No se identificó ninguna página que, para un usuario no-admin, dependa de leer el `profiles` de OTRO usuario.**

---

## 4. Joins afectados

- **Único join cross-usuario:** `lib/rbac/data.ts` `listUserAssignments` → `user_roles … profile:profiles(email, full_name)`.
  - Bajo RLS del usuario, para un non-admin devolvería `profile = null`. Pero la página que lo consume
    (`/settings/roles`) está admin-gated y el módulo RBAC (0009) **no está aplicado** (la query ya lanza
    error → ModuleUnavailable). **Sin impacto real.** Si en el futuro se aplica 0009, el consumo seguirá
    siendo admin-only.
- No hay joins a `profiles` en WMS/Custody/Pedidos/Compras (verificado por grep).

---

## 5. Riesgo de regresión

| Vector | Riesgo | Nota |
|---|---|---|
| Aislamiento cliente (documents/invoices/orders) | 🟢 Nulo | Subqueries de fila propia; intactas. |
| Shell/topbar label | 🟢 Nulo | Fila propia. |
| RPC WMS/Custody | 🟢 Nulo | `current_role()` SECURITY DEFINER bypassa RLS. |
| `/settings/users`, `/settings/roles*` | 🟢 Nulo | Admin-gated. |
| Display de nombres de otros usuarios en UI non-admin | 🟡 Bajo (latente) | Hoy no existe ningún flujo así; si se agrega uno, usar vista `profiles_public(id, full_name)` sin email. |
| Reportes/automatizaciones que asuman "staff ve a todos" | 🟡 Bajo | No se detectó ninguno en el código actual. Verificar antes de cablear features futuras. |

**Veredicto de riesgo: BAJO.** El cambio es quirúrgico (una sola policy SELECT), y todas las lecturas
cross-usuario actuales están admin-gated o son SECURITY DEFINER. El único riesgo es **latente/futuro** (un
flujo non-admin que muestre datos de otros usuarios), mitigable con una vista pública sin PII.

---

## 6. Plan de rollback

**Inmediato (revertir la policy):**
```sql
drop policy if exists "profiles read own or admin" on public.profiles;
create policy "profiles read own or staff" on public.profiles for select
  using (id = auth.uid() or public.is_staff());
notify pgrst, 'reload schema';
```
- Idempotente y reversible en segundos. No hay cambios de datos ni de esquema → rollback = solo restaurar la policy.
- **Pre-requisito de aplicación:** backup manual previo (PROD compartida, PITR off) — norma del proyecto.
- **Señal de regresión a vigilar tras aplicar:** errores/empties en pantallas que muestren datos de usuarios,
  o pérdida de visibilidad en portal-cliente (no esperado). Si aparecen → rollback inmediato + revisar el flujo.

---

## 7. Verificación post-aplicación (qué correr)

```sql
-- Como usuario NO admin (p.ej. operaciones):
select count(*) from public.profiles;     -- ESPERADO: 1 (solo su fila)
select email from public.profiles;        -- ESPERADO: solo su propio email
-- Como admin:
select count(*) from public.profiles;     -- ESPERADO: 7 (todas)
```
Y E2E: como non-admin, `GET /rest/v1/profiles?select=email,role` debe devolver solo la fila propia;
el shell debe seguir mostrando nombre/rol; portal cliente debe seguir aislado.

---

## 8. Recomendación

**Aplicar 0040** — riesgo bajo, cierra una exposición real de PII (P0), reversible en segundos. Aplicar en
ventana de bajo tráfico, con backup previo y corriendo la verificación §7 inmediatamente después. Si se
planean features non-admin que muestren otros usuarios, introducir primero la vista `profiles_public`.

> **Decisión pendiente del owner.** Este informe NO aplica la migración.
