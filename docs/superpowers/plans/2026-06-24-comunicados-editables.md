# Comunicados editables (Command Center) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Hacer editables desde Nexus (Sistema › Comunicados) los comunicados del banner Command Center del Cockpit Ejecutivo, leyéndolos de una tabla Supabase en vez de una lista hardcodeada.

**Architecture:** Tabla aditiva `public.announcements` (RLS, sin enums/RBAC nuevos). `getAnnouncements()` la lee (fallback seed/[]). Pantalla admin `/sistema/comunicados` clonando el patrón `settings/centros-costo` (page + Manager + server actions), gateada por `canAccess("sistema.view")` + `isCurrentUserAdmin()`. Ítem en Sidebar bajo Sistema.

**Tech Stack:** Next.js 14 App Router (server actions), Supabase (@supabase/ssr, RLS), zod, TypeScript. UI: clases `card`/`tbl`/`btn`/`input` (NO `nx-*`).

## Global Constraints

- Server supabase client: `import { createClient } from "@/lib/supabase/server"` — **síncrono**, puede devolver `null` (demo). Guardar siempre.
- Cada server action arranca con `if (env.app.demoMode || env.app.needsSupabase) return { ok: true };` y re-chequea `isCurrentUserAdmin()`.
- Páginas: `export const dynamic = "force-dynamic";`.
- UI de settings CRUD usa `card`/`tbl`/`btn(-primary/-ghost/-sm)`/`input`/`field-label` — **NO** `nx-*`.
- Migración: lowercase SQL, `public.` explícito, `if not exists`, `drop policy if exists` antes de `create policy`, reusar `public.tg_touch_updated_at()`, cerrar con `notify pgrst, 'reload schema';`. Próximo número = **0084**.
- Verificación (no hay test runner global; vitest es solo Caja Chica): `npm run typecheck`, `npm run lint`, `npm run build` verdes + validación en branch Supabase + QA preview.
- Íconos válidos (subconjunto de IconName): `megaphone, calendar, shield, users, bell, bolt, sparkle`.

---

### Task 1: Migración `0084_announcements.sql`

**Files:** Create `supabase/migrations/0084_announcements.sql`

- [ ] **Step 1: Escribir la migración** (verificar antes `ls supabase/migrations | tail -1` = `0083_*`)

```sql
-- =====================================================================
-- 0084_announcements.sql — Command Center: comunicados editables
-- El banner del Cockpit Ejecutivo pasa de lista hardcodeada a tabla editable
-- (Sistema › Comunicados). RBAC en app: sistema.view + isCurrentUserAdmin().
-- RLS write = current_role()='admin'. 100% aditivo (sin enums/roles/permisos).
-- Aplicado a prod: <registrar fecha al aplicar>
-- =====================================================================

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null default '',
  icon        text not null default 'megaphone'
                check (icon in ('megaphone','calendar','shield','users','bell','bolt','sparkle')),
  priority    text not null default 'medium'
                check (priority in ('low','medium','high','critical')),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

create index if not exists announcements_active_sort_idx
  on public.announcements (active, sort_order);

drop trigger if exists trg_announcements_touch on public.announcements;
create trigger trg_announcements_touch
  before update on public.announcements
  for each row execute function public.tg_touch_updated_at();

alter table public.announcements enable row level security;

drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements
  for select to authenticated using (true);

drop policy if exists "announcements write" on public.announcements;
create policy "announcements write" on public.announcements
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

grant select, insert, update, delete on public.announcements to authenticated;

do $$
begin
  if not exists (select 1 from public.announcements) then
    insert into public.announcements (title, description, icon, priority, sort_order) values
      ('¡Atención!',            'Actualización urgente del sistema',  'megaphone', 'critical', 0),
      ('Sábado 28/06',          '22:00 a 02:00 hs',                   'calendar',  'high',     1),
      ('Política de seguridad', 'Cambios de contraseña cada 60 días', 'shield',    'medium',   2),
      ('Reunión general',       'Viernes 27/06 · 09:00 hs',           'users',     'medium',   3);
  end if;
end $$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Commit** `git add supabase/migrations/0084_announcements.sql && git commit -m "feat(comunicados): migración 0084 tabla announcements + RLS + seed"`
- [ ] **Step 3 (verificación real):** se valida en Task 7 contra un branch efímero de Supabase. No se aplica a prod hasta Task 8.

---

### Task 2: Tipos + validación + data layer admin (`src/lib/comunicados/`)

**Files:** Create `src/lib/comunicados/types.ts`, `src/lib/comunicados/validation.ts`, `src/lib/comunicados/data.ts`

**Interfaces (Produces):** `AnnouncementRow`, `COMUNICADO_ICONS`, `COMUNICADO_PRIORITIES`, `AnnouncementInput`, `AnnouncementInputSchema`, `listAnnouncements(opts)`.

- [ ] **Step 1: `types.ts`**

```ts
import type { IconName } from "@/components/Icon";

export const COMUNICADO_ICONS = ["megaphone", "calendar", "shield", "users", "bell", "bolt", "sparkle"] as const;
export type ComunicadoIcon = (typeof COMUNICADO_ICONS)[number]; // ⊂ IconName

export const COMUNICADO_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type ComunicadoPriority = (typeof COMUNICADO_PRIORITIES)[number];

export interface AnnouncementRow {
  id: string;
  title: string;
  description: string;
  icon: ComunicadoIcon;
  priority: ComunicadoPriority;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Comprobación en compilación de que los íconos son IconName válidos.
const _iconCheck: Record<ComunicadoIcon, IconName> = {
  megaphone: "megaphone", calendar: "calendar", shield: "shield", users: "users",
  bell: "bell", bolt: "bolt", sparkle: "sparkle",
};
void _iconCheck;
```

- [ ] **Step 2: `validation.ts`**

```ts
import { z } from "zod";
import { COMUNICADO_ICONS, COMUNICADO_PRIORITIES } from "./types";

export const AnnouncementInputSchema = z.object({
  title: z.string().trim().min(2, "El título es obligatorio").max(60),
  description: z.string().trim().max(160).default(""),
  icon: z.enum(COMUNICADO_ICONS),
  priority: z.enum(COMUNICADO_PRIORITIES),
  active: z.boolean(),
  sort_order: z.number().int().min(0).max(99),
});
export type AnnouncementInput = z.infer<typeof AnnouncementInputSchema>;
```
(Reusar `formatZodIssues` de `@/lib/erp/validation`.)

- [ ] **Step 3: `data.ts` (admin read, server-only)**

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AnnouncementRow } from "./types";

const MOCK: AnnouncementRow[] = [
  { id: "seed-1", title: "¡Atención!", description: "Actualización urgente del sistema", icon: "megaphone", priority: "critical", active: true, sort_order: 0, created_at: "", updated_at: "" },
  { id: "seed-2", title: "Sábado 28/06", description: "22:00 a 02:00 hs", icon: "calendar", priority: "high", active: true, sort_order: 1, created_at: "", updated_at: "" },
  { id: "seed-3", title: "Política de seguridad", description: "Cambios de contraseña cada 60 días", icon: "shield", priority: "medium", active: true, sort_order: 2, created_at: "", updated_at: "" },
  { id: "seed-4", title: "Reunión general", description: "Viernes 27/06 · 09:00 hs", icon: "users", priority: "medium", active: true, sort_order: 3, created_at: "", updated_at: "" },
];

export async function listAnnouncements(opts: { includeInactive?: boolean } = {}): Promise<AnnouncementRow[]> {
  const supabase = createClient();
  if (!supabase) return MOCK;
  let q = supabase.from("announcements").select("*").order("sort_order").order("created_at");
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(`listAnnouncements: ${error.message}`);
  return (data ?? []) as AnnouncementRow[];
}
```

- [ ] **Step 4:** `npm run typecheck` → PASS. **Commit.**

---

### Task 3: Cockpit lee de la tabla (`src/lib/ejecutivo/announcements.ts`)

**Files:** Modify `src/lib/ejecutivo/announcements.ts`

**Interfaces:** mantiene `Announcement` + `AnnouncementPriority` (consumidos por `ejecutivo/page.tsx`). `getAnnouncements()` sigue siendo `Promise<Announcement[]>` (sin cambios de firma).

- [ ] **Step 1: Reescribir `getAnnouncements()` para leer la tabla; conservar `SEED_ANNOUNCEMENTS` como fallback de demo.**

```ts
import { createClient } from "@/lib/supabase/server";
import type { IconName } from "@/components/Icon";

export type AnnouncementPriority = "low" | "medium" | "high" | "critical";

export interface Announcement {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  priority: AnnouncementPriority;
}

const PRIORITY_RANK: Record<AnnouncementPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const byPriority = (a: Announcement, b: Announcement) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

export async function getAnnouncements(): Promise<Announcement[]> {
  const supabase = createClient();
  if (!supabase) return [...SEED_ANNOUNCEMENTS].sort(byPriority); // demo/preview
  const { data, error } = await supabase
    .from("announcements")
    .select("id,title,description,icon,priority,sort_order")
    .eq("active", true)
    .order("sort_order")
    .order("created_at");
  if (error) return []; // el cockpit nunca rompe
  return (data ?? [])
    .map((r): Announcement => ({
      id: r.id as string,
      title: r.title as string,
      description: (r.description as string) ?? "",
      icon: r.icon as IconName,
      priority: r.priority as AnnouncementPriority,
    }))
    .sort(byPriority); // sort estable: dentro de igual prioridad respeta sort_order
}

const SEED_ANNOUNCEMENTS: Announcement[] = [
  { id: "sys-update", priority: "critical", icon: "megaphone", title: "¡Atención!", description: "Actualización urgente del sistema" },
  { id: "maintenance-window", priority: "high", icon: "calendar", title: "Sábado 28/06", description: "22:00 a 02:00 hs" },
  { id: "security-policy", priority: "medium", icon: "shield", title: "Política de seguridad", description: "Cambios de contraseña cada 60 días" },
  { id: "general-meeting", priority: "medium", icon: "users", title: "Reunión general", description: "Viernes 27/06 · 09:00 hs" },
];
```

- [ ] **Step 2:** `npm run typecheck` → PASS (firma intacta; `ejecutivo/page.tsx` no cambia). **Commit.**

---

### Task 4: Server actions (`src/app/(app)/sistema/comunicados/actions.ts`)

**Files:** Create `src/app/(app)/sistema/comunicados/actions.ts`

**Interfaces (Produces):** `createAnnouncementAction(input)`, `updateAnnouncementAction(id, input)`, `setAnnouncementActiveAction(id, active)`, `deleteAnnouncementAction(id)` → `Promise<ComunicadoActionResult>` (`{ok:true}|{ok:false,error}`).

- [ ] **Step 1: Escribir actions** (patrón centros-costo: demo short-circuit + `isCurrentUserAdmin()` + `createClient()` + `revalidatePath` ×2).

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { isCurrentUserAdmin } from "@/lib/auth/roles";
import { formatZodIssues } from "@/lib/erp/validation";
import { AnnouncementInputSchema, type AnnouncementInput } from "@/lib/comunicados/validation";

interface Ok { ok: true; }
interface Err { ok: false; error: string; }
export type ComunicadoActionResult = Ok | Err;

const DENY: Err = { ok: false, error: "Solo Presidencia/Administración pueden gestionar comunicados." };

function revalidate() {
  revalidatePath("/sistema/comunicados");
  revalidatePath("/ejecutivo");
}

export async function createAnnouncementAction(input: AnnouncementInput): Promise<ComunicadoActionResult> {
  const parsed = AnnouncementInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: formatZodIssues(parsed.error) };
  if (env.app.demoMode || env.app.needsSupabase) return { ok: true };
  if (!(await isCurrentUserAdmin())) return DENY;
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("announcements").insert({ ...parsed.data, created_by: user?.id ?? null });
  if (error) return { ok: false, error: `No se pudo crear el comunicado: ${error.message}` };
  revalidate();
  return { ok: true };
}

export async function updateAnnouncementAction(id: string, input: AnnouncementInput): Promise<ComunicadoActionResult> {
  if (!id) return { ok: false, error: "Comunicado inválido" };
  const parsed = AnnouncementInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: formatZodIssues(parsed.error) };
  if (env.app.demoMode || env.app.needsSupabase) return { ok: true };
  if (!(await isCurrentUserAdmin())) return DENY;
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("announcements").update({ ...parsed.data, updated_by: user?.id ?? null }).eq("id", id);
  if (error) return { ok: false, error: `No se pudo actualizar: ${error.message}` };
  revalidate();
  return { ok: true };
}

export async function setAnnouncementActiveAction(id: string, active: boolean): Promise<ComunicadoActionResult> {
  if (!id) return { ok: false, error: "Comunicado inválido" };
  if (env.app.demoMode || env.app.needsSupabase) return { ok: true };
  if (!(await isCurrentUserAdmin())) return DENY;
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };
  const { error } = await supabase.from("announcements").update({ active }).eq("id", id);
  if (error) return { ok: false, error: `No se pudo actualizar: ${error.message}` };
  revalidate();
  return { ok: true };
}

export async function deleteAnnouncementAction(id: string): Promise<ComunicadoActionResult> {
  if (!id) return { ok: false, error: "Comunicado inválido" };
  if (env.app.demoMode || env.app.needsSupabase) return { ok: true };
  if (!(await isCurrentUserAdmin())) return DENY;
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };
  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) return { ok: false, error: `No se pudo borrar: ${error.message}` };
  revalidate();
  return { ok: true };
}
```

- [ ] **Step 2:** `npm run typecheck` → PASS. **Commit.**

---

### Task 5: Página admin + Manager (`src/app/(app)/sistema/comunicados/`)

**Files:** Create `page.tsx` + `ComunicadosManager.tsx`

**Consumes:** `listAnnouncements` (Task 2), actions (Task 4). **Produces:** ruta `/sistema/comunicados`.

- [ ] **Step 1: `page.tsx`** (gates clonados de centros-costo)

```tsx
import { listAnnouncements } from "@/lib/comunicados/data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { RestrictedAccess } from "@/components/shell/RestrictedAccess";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { canAccess } from "@/lib/rbac/guard";
import { isCurrentUserAdmin } from "@/lib/auth/roles";
import { ComunicadosManager } from "./ComunicadosManager";

export const metadata = { title: "Comunicados" };
export const dynamic = "force-dynamic";

export default async function ComunicadosPage() {
  if (!(await canAccess("sistema.view"))) return <AccesoRestringido modulo="Sistema · Comunicados" />;
  if (!(await isCurrentUserAdmin())) return <RestrictedAccess message="Solo Presidencia/Administración pueden gestionar los comunicados del cockpit." />;

  let rows: Awaited<ReturnType<typeof listAnnouncements>>;
  try {
    rows = await listAnnouncements({ includeInactive: true });
  } catch (e) {
    return <ModuleUnavailable title="Comunicados no disponibles" migration="0084_announcements" detail={e instanceof Error ? e.message : String(e)} />;
  }

  return (
    <div className="p-4 lg:p-8 max-w-4xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Cockpit · Command Center</div>
          <h1 className="page-title">Comunicados</h1>
          <p className="page-subtitle">Lo que se muestra en el banner del Cockpit Ejecutivo. El de prioridad “crítica” es el destacado amarillo.</p>
        </div>
      </div>
      <ComunicadosManager rows={rows} />
    </div>
  );
}
```

- [ ] **Step 2: `ComunicadosManager.tsx`** — client; form (title, description, `<select>` icon de `COMUNICADO_ICONS`, `<select>` priority, checkbox active, input number sort_order) + tabla con Activar/Desactivar, Borrar (confirm), y “Editar” que precarga el form. `useTransition` + `router.refresh()`. Clases `card`/`tbl`/`btn`/`input`/`field-label`. (Estructura idéntica a `CentrosCostoManager.tsx`; ver snippet de referencia en la spec/discovery.)

- [ ] **Step 3:** `npm run typecheck && npm run lint` → PASS. **Commit.**

---

### Task 6: Ítem en el Sidebar (`src/components/shell/Sidebar.tsx`)

**Files:** Modify `src/components/shell/Sidebar.tsx`

- [ ] **Step 1:** En el dominio `id: "sistema"`, agregar como último item (después de `{ href: "/settings", label: "Configuración", icon: "gear" }`):

```tsx
      { href: "/sistema/comunicados", label: "Comunicados", icon: "megaphone" },
```
(El dominio ya tiene `gate: "sistema"` → queda gateado por `sistema.view`; no se toca el enum `gate`.) Opcional: agregar `"/sistema/comunicados"` al `Set` `exact` de `isActive()`.

- [ ] **Step 2:** `npm run typecheck && npm run lint && npm run build` → PASS. **Commit.**

---

### Task 7: Verificación + validación de migración en branch Supabase

- [ ] **Step 1:** `npm run typecheck` · `npm run lint` · `npm run build` → todos verdes.
- [ ] **Step 2:** QA preview (modo demo): `/ejecutivo` muestra el banner (vía seed fallback); `/sistema/comunicados` renderiza (en demo, admin fail-open).
- [ ] **Step 3:** Validar migración: MCP `list_migrations` (confirmar drift/estado) → `create_branch` (efímero) → `apply_migration(0084)` → smoke `execute_sql`: `select count(*) from announcements;` (=4) + `insert`/`update`/`delete` de prueba → `delete_branch`.

---

### Task 8: Aplicar a prod + deploy (con OK de Martín — ya otorgado)

- [ ] **Step 1:** Re-verificar `origin/main` (no colisionar con billing/otros deploys en curso).
- [ ] **Step 2:** Aplicar a prod: MCP `apply_migration` sobre `arsksytgdnzukbmfgkju` (tabla + seed). Registrar fecha en el header de la migración.
- [ ] **Step 3:** Push branch `worktree-comunicados-editables` → PR → merge a `main` → Netlify deploya.
- [ ] **Step 4:** Verificar live en `nexus.logisticatops.com`: banner = seed; alta/edición/toggle/borrado desde `/sistema/comunicados` se refleja en el cockpit; sin-admin → restringido.
- [ ] **Step 5 (cleanup):** `ExitWorktree` (keep o remove); borrar la rama huérfana `feat/comunicados-editables` del repo principal.

## Self-Review

- **Cobertura de spec:** tabla (T1) · data/types/validation (T2) · lectura cockpit (T3) · escritura (T4) · pantalla admin (T5) · sidebar (T6) · verificación + branch validation (T7) · prod + deploy (T8). ✔
- **Sin placeholders:** SQL y TS concretos; el único “ver snippet” es el Manager (estructura idéntica a `CentrosCostoManager`, ya capturada). ✔
- **Consistencia de tipos:** `AnnouncementInput` (T2) usado por actions (T4); `Announcement` firma intacta (T3) → `ejecutivo/page.tsx` sin cambios; `AnnouncementRow` (T2) usado por data (T2) y page (T5). ✔
