# Comunicados editables del Command Center — Diseño

- **Fecha:** 2026-06-24
- **Estado:** Aprobado (diseño) — RBAC ajustado tras descubrimiento de código
- **Autor:** Martín Battaglia + Claude
- **Ámbito:** Cockpit Ejecutivo (`/ejecutivo`) · módulo Sistema · Supabase prod (`arsksytgdnzukbmfgkju`)
- **Branch de trabajo:** worktree aislado `worktree-comunicados-editables` (basado en `main` @ `74141ad`)

## Contexto y problema

El banner **Command Center** del Cockpit Ejecutivo (bloque amarillo "¡Atención!" + 3 celdas)
hoy lee una lista **curada en código** en `src/lib/ejecutivo/announcements.ts`
(`SEED_ANNOUNCEMENTS`). Cualquier cambio de texto exige editar el código + commit + deploy.

**Objetivo:** que el equipo (Presidencia / Administración) edite los comunicados **desde una
pantalla dentro de Nexus**, sin tocar código ni hacer deploy.

## Decisiones tomadas (brainstorming)

1. **Superficie de edición:** pantalla de admin **dentro de Nexus** (no el Table Editor de Supabase).
2. **Quién edita:** **Presidencia + Administración**, gateado con el patrón ya usado por los CRUD de
   administración de Nexus (`settings/centros-costo`): permiso de área **`sistema.view`** + chequeo
   **`isCurrentUserAdmin()`** (rol legacy `profiles.role='admin'`). Ver el banner en el cockpit no
   cambia (lo siguen viendo todos).
   > **Cambio vs. la idea inicial** (`permiso nuevo comunicados.manage`): el descubrimiento del código
   > mostró que un permiso dedicado exigiría **ALTERar tipos enum en la base de PROD**
   > (`permission_module_t`/`permission_action_t`, con `UNIQUE(module,action)`) y extender el enum de
   > `gate` del Sidebar — todo para **cero cambio efectivo**, porque el enforcement RBAC está dormido
   > (fail-open salvo `RBAC_ENFORCE=1`) y el gate real es `isCurrentUserAdmin()`. Reusar
   > `sistema.view` + admin **restringe a Presidencia + Administración igual**, sigue el patrón del
   > repo y deja la migración **100% aditiva (solo la tabla)**, mucho más segura en prod.
3. **Vigencia:** **solo toggle `active`** (activo/inactivo). **Sin fechas** ni scheduling automático.
4. **Borrado:** se soportan **ambas** acciones — *desactivar* (uso diario) y *borrar* (limpieza).
5. **Ubicación de la pantalla:** **Sistema › Comunicados** (`/sistema/comunicados`).

## No-objetivos (YAGNI)

- Sin `start_date`/`end_date` ni mostrado/ocultado automático por fecha.
- Sin rich text / imágenes / adjuntos (solo título + descripción + ícono).
- Sin segmentación por destinatario (todos ven el mismo banner).
- Sin historial/versionado (solo `created_at`/`updated_at`).
- **Sin permiso/rol/enum nuevo en RBAC** (ver decisión 2).

## Modelo de datos

Tabla nueva `public.announcements` (migración **aditiva**, no toca tablas existentes):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `title` | `text` NOT NULL | título (ej. "¡Atención!") |
| `description` | `text` NOT NULL DEFAULT `''` | subtítulo |
| `icon` | `text` NOT NULL DEFAULT `'megaphone'` | `CHECK in (lista cerrada de IconName válidos)` |
| `priority` | `text` NOT NULL DEFAULT `'medium'` | `CHECK in ('low','medium','high','critical')` |
| `active` | `boolean` NOT NULL DEFAULT `true` | el switch de la UI |
| `sort_order` | `integer` NOT NULL DEFAULT `0` | orden manual entre activos |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `created_by` | `uuid` → `auth.users(id)` ON DELETE SET NULL | auditoría |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | trigger `public.tg_touch_updated_at()` |
| `updated_by` | `uuid` → `auth.users(id)` ON DELETE SET NULL | auditoría |

Se usa **text + CHECK** (no enum) para `icon` y `priority` — evita `create type`/`ALTER TYPE` y mantiene
la migración trivialmente aditiva. Índice: `announcements (active, sort_order)`.

**Íconos válidos** (subconjunto de `IconName`, `src/components/Icon.tsx`):
`megaphone, calendar, shield, users, bell, bolt, sparkle`. El `CHECK` y el `<select>` del form
comparten esta lista (fuente única en código: `COMUNICADO_ICONS`).

**Seed:** la migración inserta los **4 comunicados actuales** (los de `SEED_ANNOUNCEMENTS`) **solo si la
tabla está vacía** (`do $$ begin if not exists (select 1 from public.announcements) then insert … end if; end $$;`)
para que el banner muestre lo mismo desde el primer momento y la migración sea re-ejecutable.

## RBAC (sin cambios de esquema)

Patrón idéntico a `src/app/(app)/settings/centros-costo/`:

- **Gate de página (grueso):** `canAccess("sistema.view")` (de `@/lib/rbac/guard`) → si no, `AccesoRestringido`.
- **Gate fino (admin):** `isCurrentUserAdmin()` (de `@/lib/auth/roles`, lee `profiles.role='admin'`) → si no,
  `RestrictedAccess`. Esto restringe efectivamente a **Presidencia + Administración**.
- **Re-enforcement server-side:** cada server action vuelve a chequear `isCurrentUserAdmin()` (defensa en
  profundidad — el gate de página es bypasseable; la action es el límite real).
- **RLS de la tabla:** `read` abierto a `authenticated` (`using (true)` — el banner no es sensible);
  `write` (`for all`) gateado por `public.current_role() = 'admin'` (alinea RLS con `isCurrentUserAdmin()`).
- **Sidebar:** ítem `Comunicados` dentro del dominio `Sistema` (ya `gate: "sistema"`), gateado por
  `sistema.view`. No se toca el enum `gate` del Sidebar.
- **Lectura del cockpit:** sin permiso nuevo; cualquier usuario que ya ve el cockpit ve el banner.

## Flujo de datos

**Lectura (cockpit) —** `src/lib/ejecutivo/announcements.ts`:
- `getAnnouncements()` deja de devolver `SEED_ANNOUNCEMENTS` y pasa a **consultar la tabla** con el
  cliente user-scoped (`createClient()`): `where active = true`, ordenado por rango de `priority`
  (critical→low) y luego `sort_order`, `created_at`. Mapea filas → tipo `Announcement` (el tipo expuesto a
  la UI no cambia). El componente `CommandCenterBanner` **no cambia**.
- **Fallbacks (el cockpit nunca se rompe):**
  - `createClient()` null (demo/preview) → devuelve `SEED_ANNOUNCEMENTS` (se conserva como constante de
    fallback de demo, para que el preview siga mostrando el banner).
  - error de DB → devuelve `[]` (banner oculto), nunca lanza.
  - 0 comunicados activos → el banner no se renderiza (`CommandCenterBanner` ya retorna `null` en `[]`).

**Escritura (admin) —** `src/app/(app)/sistema/comunicados/actions.ts` (server actions):
- `createAnnouncementAction`, `updateAnnouncementAction`, `setAnnouncementActiveAction`,
  `deleteAnnouncementAction`. Cada una: zod `safeParse` → short-circuit demo
  (`if (env.app.demoMode || env.app.needsSupabase) return { ok: true }`) → `isCurrentUserAdmin()` →
  `createClient()` (user-scoped) write → `revalidatePath("/sistema/comunicados")` **y**
  `revalidatePath("/ejecutivo")`. Resultado: union `{ ok:true } | { ok:false, error:string }`.

**Lectura del admin —** `src/lib/comunicados/data.ts` (`import "server-only"`):
- `listAnnouncements({ includeInactive })` → filas crudas (incl. inactivas), ordenadas por `sort_order`,
  `created_at`. Fallback mock cuando `createClient()` es null.

## Pantalla de admin

- Ruta **`/sistema/comunicados`** — `src/app/(app)/sistema/comunicados/page.tsx` (server component,
  `dynamic = "force-dynamic"`), gates `canAccess("sistema.view")` + `isCurrentUserAdmin()`, fetch vía
  `listAnnouncements` con fallback `ModuleUnavailable`, renderiza `ComunicadosManager`.
- `ComunicadosManager.tsx` (client, `"use client"`): form (título, descripción, `<select>` ícono,
  `<select>` prioridad, switch activo, orden) + tabla con editar/activar/borrar. `useTransition` +
  `router.refresh()`. **Vocabulario de clases `card`/`tbl`/`btn`/`input`/`field-label`/`badge`** (NO `nx-*`
  — los settings CRUD no usan `nx-*`).
- Sidebar: una línea en el dominio Sistema → `{ href:"/sistema/comunicados", label:"Comunicados", icon:"megaphone" }`.

## Migración y despliegue a producción 🔒

`arsksytgdnzukbmfgkju` es el **único** entorno. El cambio es **100% aditivo** (una tabla nueva; sin enums,
sin RBAC, sin tocar datos). Camino:

1. Escribir migración **`0084_announcements.sql`** + código en el worktree.
   - Estilo casa (ver 0082/0076): `create table if not exists public.…`, `enable row level security`,
     `drop policy if exists` antes de cada `create policy`, trigger que **reusa** `public.tg_touch_updated_at()`
     (NO redefinir), `grant select,insert,update,delete … to authenticated`, y cierre con
     `notify pgrst, 'reload schema';`.
2. **Validar en un branch efímero de Supabase** (MCP `list_migrations` para confirmar drift →
   `create_branch` → `apply_migration` → smoke test `select`/`insert` → `delete_branch`). No toca prod.
3. Con **OK explícito de Martín** (ya otorgado: "de punta a punta hasta prod"), aplicar a **prod**
   (MCP `apply_migration`) y deployar el código (PR → merge a `main` → Netlify).
4. Verificar live: banner muestra los 4 seed; alta/edición/toggle/borrado desde la pantalla se reflejan en
   el cockpit; usuario sin admin recibe `AccesoRestringido`/`RestrictedAccess`.

> **Nota de coordinación:** el repo está muy concurrido (rama principal drifteó a billing; 20+ worktrees).
> Antes del merge a `main` + deploy, re-verificar el estado de `origin/main` para no colisionar con otros
> deploys en curso.

## Módulos (una responsabilidad cada uno)

- `supabase/migrations/0084_announcements.sql` — tabla + CHECKs + índice + trigger updated_at + RLS + grants + seed-if-empty.
- `src/lib/comunicados/types.ts` — `AnnouncementRow` (fila DB snake_case) + `COMUNICADO_ICONS` (lista compartida).
- `src/lib/comunicados/validation.ts` — schemas zod (create/update) + `formatZodIssues` (reuso si existe).
- `src/lib/comunicados/data.ts` — `listAnnouncements({includeInactive})` (server-only, read admin).
- `src/lib/ejecutivo/announcements.ts` — `getAnnouncements()` lee la tabla (fallback seed/[]); conserva `Announcement`.
- `src/app/(app)/sistema/comunicados/page.tsx` — página admin gateada.
- `src/app/(app)/sistema/comunicados/ComunicadosManager.tsx` — UI list+form (client).
- `src/app/(app)/sistema/comunicados/actions.ts` — server actions CRUD gateadas.
- `src/components/shell/Sidebar.tsx` — ítem Comunicados bajo Sistema.

## Verificación

- **No hay test runner global** (vitest está acotado a Caja Chica por diseño). Gates: `npm run typecheck`
  (`tsc --noEmit`), `npm run lint` (`next lint`), `npm run build` (`next build`) — todos verdes.
- QA visual en preview (modo demo y/o branch Supabase): banner con datos de tabla; crear/editar/toggle/borrar
  reflejado en el cockpit; sin-admin → restringido.
- Migración validada en branch efímero de Supabase antes de prod.
