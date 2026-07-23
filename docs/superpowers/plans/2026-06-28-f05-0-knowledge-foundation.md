# F0.5.0 — Knowledge Layer Foundation · Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

**Goal:** Registrar el bounded context `knowledge` y dejar parado el substrato del read-model corporativo (tablas + RBAC + scaffold TS), **sin** comportamiento de proyección todavía (triggers/RPCs/vistas son F0.5.1+).

**Architecture:** Capa cross-cutting `knowledge` (System of Knowledge). Esta sub-fase entrega: (a) el valor de enum `permission_module_t = 'knowledge'`, (b) las tablas del read-model (`knowledge_events`, `searchable_items`, `knowledge_nodes/edges`, `knowledge_entities/annotations`, `knowledge_documents/chunks`, `knowledge_sources`) con su RLS por `visibility_key`, (c) el seed RBAC `knowledge.*`, (d) el scaffold TS (`src/lib/knowledge/`) con un helper puro testeado. Las migraciones se **entregan, NO se aplican** (G3) — Martín las aplica a mano. La frontera de visibilidad es RLS (helpers existentes `has_permission`/`is_staff`/`is_admin`), nunca lógica nueva de permisos.

**Tech Stack:** Next.js 15 (App Router) · TypeScript · Supabase/Postgres 17.6 · Tailwind · Vitest. Sin SDK nuevos, sin shadcn, sin pgvector (diferido a `0119`).

## Global Constraints (copiados del spec aprobado — aplican a TODA tarea)

- **Gobernanza G1–G11.** No commit/push/deploy/`db push` sin OK explícito. SQL **idempotente, ENTREGADO-NO-APLICADO**, numerado al siguiente libre, cierra con `select pg_notify('pgrst','reload schema')`.
- **Aditividad estricta.** Cero `ALTER` de DDL sobre tablas existentes. Solo objetos **nuevos** (`knowledge_*`) + el `ALTER TYPE ... ADD VALUE 'knowledge'` (aditivo sobre enum).
- **Autorización:** RLS con `public.has_permission('knowledge.<action>')` / `public.is_staff()` / `public.is_admin()` (reusar, no redefinir). **NUNCA** `auth.jwt()->>'role'`.
- **Superficie de máquina:** `knowledge_events`/`searchable_items`/`nodes`/`edges`/`annotations` **no** tienen policy de INSERT/UPDATE/DELETE para `authenticated`; solo SELECT por `visibility_key`. Escritura solo por RPC `SECURITY DEFINER`/`service_role` (F0.5.1+).
- **Capa de datos:** Feature → Server Action/Route Handler → `src/lib/knowledge/data.ts` → Supabase, con guard `isMock()` (`env.app.demoMode || env.app.needsSupabase`; `createClient()` devuelve `null` en demo).
- **Numeración:** F0.5 = `0106`–`0111`; F1 Connect renumerado `0112`–`0118`; embeddings diferidos `0119`. **Verificar con `ls supabase/migrations/`** (NO `list_migrations` de prod: rastrea por timestamp). Esta sub-fase autora `0106`, `0107`, `0110`; `0108/0109/0111` son de F0.5.1. **No aplicar nada** hasta tener el bloque `0106–0111` completo (se aplica en orden numérico de una vez).
- **Fuente única de verdad del SQL:** el SQL completo y aprobado vive en el spec `docs/superpowers/specs/2026-06-28-nexus-connect-design.md` (Parte II §B §5). Para evitar duplicar/divergir (gobernanza "nada duplicado"), las tareas de SQL grande **copian textualmente** desde la sección citada del spec. El SQL chico se incluye inline acá.
- **Roles staff reales (seed):** `director_ops, admin, operaciones, comercial, compliance, seguridad, rrhh_admin, rrhh_manager, rrhh_viewer, employee_self_service, cliente_b2b` (`src/lib/rbac/types.ts:111-123`). `cliente_b2b` NO recibe `knowledge.*`.

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/0106_knowledge_module_enum.sql` | Crear | Agrega `'knowledge'` a `permission_module_t` (standalone) |
| `supabase/migrations/0107_knowledge_core.sql` | Crear | Tablas del read-model + extensiones `unaccent`/`pg_trgm` + índices GIN + RLS `visibility_key` + triggers (touch/forbid-delete) |
| `supabase/migrations/0110_knowledge_rbac_seed.sql` | Crear | Permisos `knowledge.*` + `role_permissions` |
| `src/lib/rbac/types.ts` | Modificar (`:5-27`, `:78-96`) | Agregar `'knowledge'` a `PermissionModule` + `MODULE_LABELS` |
| `src/lib/knowledge/types.ts` | Crear | Tipos del read-model (`KnowledgeEvent`, `TimelineEntry`, `VisibilityKey`) |
| `src/lib/knowledge/visibility.ts` | Crear | Helper PURO `requiredVisibilityKeys()` (regla del mínimo común) |
| `src/lib/knowledge/visibility.test.ts` | Crear | Tests del helper (Vitest) |
| `src/lib/knowledge/data.ts` | Crear | Accesores de lectura con guard `isMock()` (scaffold; devuelven vacío hasta F0.5.1) |
| `vitest.config.ts` | Modificar (`:10-19`) | Agregar `src/lib/knowledge/**/*.test.ts` al `include` |

---

## Task 1: Rama dedicada

**Files:** (ninguno — preparación de entorno)

- [ ] **Step 1: Crear la rama desde `main` (NO desde `feat/conciliacion-oc`)**

```bash
git -C /Users/martinbattaglia/CODE/tops-ordenes fetch origin
git -C /Users/martinbattaglia/CODE/tops-ordenes switch main
git -C /Users/martinbattaglia/CODE/tops-ordenes switch -c feat/f05-knowledge-foundation
```

- [ ] **Step 2: Confirmar rama**

Run: `git -C /Users/martinbattaglia/CODE/tops-ordenes branch --show-current`
Expected: `feat/f05-knowledge-foundation`

> Nota: si se prefiere aislamiento total, usar `superpowers:using-git-worktrees` en su lugar. No commitear sin OK (G1).

---

## Task 2: Registrar el módulo `knowledge` en RBAC (TypeScript)

El `Record<PermissionModule, string>` es **exhaustivo**: agregar el valor de unión sin su label rompe el build. Ese fallo de build **es** el test de esta tarea.

**Files:**
- Modify: `src/lib/rbac/types.ts:27` (unión) y `:95` (labels)

**Interfaces:**
- Produces: el valor `"knowledge"` del tipo `PermissionModule` y `MODULE_LABELS["knowledge"]` (consumidos por la UI de settings/roles, que renderiza cualquier módulo del catálogo automáticamente).

- [ ] **Step 1: Agregar `"knowledge"` a la unión `PermissionModule`**

En `src/lib/rbac/types.ts`, reemplazar la última línea de la unión (`:27`):

```ts
  // F0 (2026-06-25) — Prospección Inteligente: capa comercial aguas arriba del CRM.
  | "prospeccion"
  // F0.5 (2026-06-28) — Knowledge Layer: capa cross-cutting de conocimiento corporativo.
  | "knowledge";
```

- [ ] **Step 2: Agregar la etiqueta a `MODULE_LABELS`**

En `MODULE_LABELS` (`:78-96`), agregar la entrada antes del cierre `}`:

```ts
  prospeccion: "Comercial · Prospección Inteligente",
  knowledge: "Conocimiento · Memoria corporativa",
};
```

- [ ] **Step 3: Verificar typecheck (este es el test)**

Run: `cd /Users/martinbattaglia/CODE/tops-ordenes && npm run typecheck`
Expected: 0 errores. (Si faltara la entrada en `MODULE_LABELS`, `tsc` fallaría con "Property 'knowledge' is missing".)

- [ ] **Step 4: Commit**

```bash
git add src/lib/rbac/types.ts
git commit -m "feat(knowledge): registrar módulo 'knowledge' en el catálogo RBAC (tipos)"
```

---

## Task 3: Migración `0106` — enum del módulo (entregada, no aplicada)

**Files:**
- Create: `supabase/migrations/0106_knowledge_module_enum.sql`

- [ ] **Step 1: Crear el archivo con este contenido EXACTO**

```sql
-- ENTREGADA, NO APLICADA — F0.5 Knowledge Layer; verificar numeración contra prod arsksytgdnzukbmfgkju
-- 0106 — Agrega el valor 'knowledge' al enum permission_module_t.
--
-- Bounded context propio cross-cutting. En prod permission_module_t NO incluye 'knowledge'.
-- ALTER en su PROPIA transacción: Postgres no permite USAR un valor de enum recién agregado
-- en la misma transacción → el seed de permisos/roles vive en 0110 (molde 0086→0087 / 0088→0089).
alter type public.permission_module_t add value if not exists 'knowledge';

-- PostgREST: refrescar caché de esquema.
select pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 2: Revisión de idempotencia (test del SQL)**

Verificar a ojo: usa `add value if not exists` (re-ejecutable) y NO usa el valor nuevo en la misma transacción. Confirmar que el nombre de archivo `0106_knowledge_module_enum.sql` está libre:

Run: `cd /Users/martinbattaglia/CODE/tops-ordenes && ls supabase/migrations/ | grep -E '^010[6-9]|^011' || echo "0106+ libres"`
Expected: `0106+ libres` (no debe listar ningún `0106..0119` previo).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0106_knowledge_module_enum.sql
git commit -m "feat(knowledge): mig 0106 — enum permission_module_t += 'knowledge' (entregada, no aplicada)"
```

---

## Task 4: Migración `0107` — tablas del read-model (entregada, no aplicada)

El SQL completo y aprobado está en el spec **§B §5.2 `0107_knowledge_core.sql`** (`docs/superpowers/specs/2026-06-28-nexus-connect-design.md`). Para no duplicar/divergir el SQL (gobernanza "una sola fuente de verdad"), se **copia textualmente** desde ahí.

**Files:**
- Create: `supabase/migrations/0107_knowledge_core.sql`

**Interfaces (lo que esta migración deja disponible para tareas/fases siguientes):**
- Tablas `public.knowledge_events`, `public.searchable_items`, `public.knowledge_entities`, `public.knowledge_annotations`, `public.knowledge_nodes`, `public.knowledge_edges`, `public.knowledge_documents`, `public.knowledge_chunks`, `public.knowledge_sources`.
- Policy SELECT por `visibility_key` en `knowledge_events` y `searchable_items` (reusa `has_permission`/`is_staff`/`is_admin`).
- Trigger append-only `tg_knowledge_forbid_delete` sobre `knowledge_events`/`knowledge_annotations`; `updated_at` vía el global `public.tg_touch_updated_at()`.

- [ ] **Step 1: Crear `supabase/migrations/0107_knowledge_core.sql` copiando el bloque SQL de la sección `### 5.2 0107_knowledge_core.sql` del spec (Parte II §B), íntegro, incluido su header `-- ENTREGADA, NO APLICADA …` y el `select pg_notify('pgrst','reload schema')` final.**

- [ ] **Step 2: Verificación de aditividad e idempotencia (test del SQL)**

Confirmar a ojo, sobre el archivo creado:
- Solo `create table if not exists` / `create index if not exists` / `do $$ … exception when duplicate_object` / `drop policy if exists` antes de `create policy` / `alter table … enable row level security` sobre tablas **nuevas**.
- `create extension if not exists unaccent`/`pg_trgm with schema extensions` (idempotente).
- La columna `tsv` de `searchable_items` usa `to_tsvector('spanish', …)` (immutable) — **sin** `unaccent` dentro del `GENERATED`.
- NINGÚN `alter table public.<tabla_existente>` (cero modificación de DDL ajeno).
- Cierra con `select pg_notify('pgrst','reload schema')`.

Run (chequeo mecánico de aditividad — no debe haber ALTER sobre tablas que no sean `knowledge_*`):
`cd /Users/martinbattaglia/CODE/tops-ordenes && grep -nE 'alter table public\.' supabase/migrations/0107_knowledge_core.sql | grep -v 'knowledge_' || echo "OK: sin ALTER sobre tablas existentes"`
Expected: `OK: sin ALTER sobre tablas existentes`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0107_knowledge_core.sql
git commit -m "feat(knowledge): mig 0107 — tablas read-model + RLS visibility_key (entregada, no aplicada)"
```

---

## Task 5: Migración `0110` — seed RBAC `knowledge.*` (entregada, no aplicada)

**Files:**
- Create: `supabase/migrations/0110_knowledge_rbac_seed.sql`

- [ ] **Step 1: Crear el archivo con este contenido EXACTO**

```sql
-- ENTREGADA, NO APLICADA — F0.5 Knowledge Layer; verificar numeración contra prod arsksytgdnzukbmfgkju
-- 0110 — Permisos knowledge.* + grant a roles staff. Molde 0087 / 0089:419-440.
--        permission_action_t es CERRADO → solo view/create/edit/delete/admin.
--        Respeta unique(module,action) (0009:50) y unique(slug). on conflict do nothing.

insert into public.permissions (slug, module, action, label, description) values
  ('knowledge.view',   'knowledge', 'view',   'Ver conocimiento',
   'Timeline corporativo + Búsqueda Universal'),
  ('knowledge.create', 'knowledge', 'create', 'Anotar conocimiento',
   'Crear anotaciones/etiquetas entidad↔concepto'),
  ('knowledge.edit',   'knowledge', 'edit',   'Editar conocimiento',
   'Editar entidades/anotaciones de la capa de conocimiento'),
  ('knowledge.delete', 'knowledge', 'delete', 'Depurar conocimiento',
   'Marcar/depurar anotaciones (eventos son append-only)'),
  ('knowledge.admin',  'knowledge', 'admin',  'Administrar knowledge',
   'Gestionar fuentes, backfills y configuración de la capa')
on conflict (slug) do nothing;

-- Lectura (knowledge.view) para TODO rol interno (excluye cliente_b2b). Molde 0087:13-19.
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
cross join public.permissions p
where p.slug = 'knowledge.view'
  and ro.slug <> 'cliente_b2b'
on conflict do nothing;

-- create/edit a roles operativos reales: director_ops, admin, operaciones, compliance, comercial, seguridad
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p
  on p.slug in ('knowledge.create','knowledge.edit')
where ro.slug in ('director_ops','admin','operaciones','compliance','comercial','seguridad')
on conflict do nothing;

-- delete + admin solo a director_ops y admin
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p
  on p.slug in ('knowledge.delete','knowledge.admin')
where ro.slug in ('director_ops','admin')
on conflict do nothing;

select pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 2: Revisión (test del SQL)**

Confirmar: `on conflict do nothing` en todos los `insert` (idempotente); las 5 filas usan acciones distintas (respeta `unique(module,action)`); ningún rol inventado (todos están en `src/lib/rbac/types.ts:111-123`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0110_knowledge_rbac_seed.sql
git commit -m "feat(knowledge): mig 0110 — seed permisos knowledge.* + grants (entregada, no aplicada)"
```

---

## Task 6: Helper puro de visibilidad + test (Vitest, TDD)

Helper foundacional compartido: compone la visibilidad de un artefacto derivado de varias fuentes con la **regla del mínimo común** (Parte III §4.1 / ADR-MACL-5): un artefacto solo es visible para quien puede ver TODAS sus fuentes (semántica AND). `public_auth` es el constraint más débil → redundante cuando hay uno más estricto.

**Files:**
- Modify: `vitest.config.ts:10-19`
- Create: `src/lib/knowledge/visibility.ts`
- Test: `src/lib/knowledge/visibility.test.ts`

**Interfaces:**
- Produces: `requiredVisibilityKeys(sourceKeys: string[]): string[]` — set ordenado de `visibility_keys` que el lector debe satisfacer todas (AND). Lo consumirán los motores de F0.5.1+/KIL para sellar artefactos multi-fuente.

- [ ] **Step 1: Habilitar tests de `knowledge` en Vitest**

En `vitest.config.ts`, agregar al array `include` (después de `"src/lib/erp/**/*.test.ts",`):

```ts
      "src/lib/erp/**/*.test.ts",
      "src/lib/knowledge/**/*.test.ts",
```

- [ ] **Step 2: Escribir el test que falla**

Crear `src/lib/knowledge/visibility.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { requiredVisibilityKeys } from "./visibility";

describe("requiredVisibilityKeys (regla del mínimo común)", () => {
  it("sin fuentes → fail-closed a ['staff']", () => {
    expect(requiredVisibilityKeys([])).toEqual(["staff"]);
  });
  it("todas public_auth → ['public_auth']", () => {
    expect(requiredVisibilityKeys(["public_auth", "public_auth"])).toEqual(["public_auth"]);
  });
  it("descarta public_auth cuando hay una más estricta (AND redundante)", () => {
    expect(requiredVisibilityKeys(["public_auth", "staff"])).toEqual(["staff"]);
  });
  it("conserva y deduplica múltiples claves estrictas, ordenadas", () => {
    expect(requiredVisibilityKeys(["staff", "client:abc", "client:abc"])).toEqual(["client:abc", "staff"]);
  });
  it("ignora espacios y vacíos", () => {
    expect(requiredVisibilityKeys([" perm:comercial.view ", ""])).toEqual(["perm:comercial.view"]);
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd /Users/martinbattaglia/CODE/tops-ordenes && npx vitest run src/lib/knowledge/visibility.test.ts`
Expected: FALLA con "Failed to resolve import './visibility'" (el módulo no existe aún).

- [ ] **Step 4: Implementar el helper**

Crear `src/lib/knowledge/visibility.ts`:

```ts
/**
 * Compone la visibilidad de un artefacto derivado de MÚLTIPLES fuentes con la
 * regla del MÍNIMO COMÚN (Parte III §4.1 / ADR-MACL-5): el artefacto solo es
 * visible para quien pueda ver TODAS sus fuentes (semántica AND sobre el set).
 *
 * - Sin fuentes → fail-closed: ["staff"] (nunca abierto).
 * - "public_auth" es el constraint más débil (cualquier autenticado): si hay
 *   alguna clave más estricta, "public_auth" es redundante en un AND y se descarta.
 * - Devuelve el set deduplicado y ordenado de visibility_keys requeridas.
 */
export function requiredVisibilityKeys(sourceKeys: string[]): string[] {
  const set = new Set(sourceKeys.map((k) => k.trim()).filter(Boolean));
  if (set.size === 0) return ["staff"];
  if (set.size > 1) set.delete("public_auth");
  return Array.from(set).sort();
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd /Users/martinbattaglia/CODE/tops-ordenes && npx vitest run src/lib/knowledge/visibility.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts src/lib/knowledge/visibility.ts src/lib/knowledge/visibility.test.ts
git commit -m "feat(knowledge): helper puro requiredVisibilityKeys (regla mínimo común) + tests"
```

---

## Task 7: Scaffold TS del read-model (tipos + data layer con isMock)

Scaffold de lectura. En F0.5.0 las tablas existen pero no hay proyección (F0.5.1), así que los accesores devuelven vacío en producción y `[]` en demo — sin romper nada. Establece el contrato que F0.5.1 implementará.

**Files:**
- Create: `src/lib/knowledge/types.ts`
- Create: `src/lib/knowledge/data.ts`

**Interfaces:**
- Consumes: `createClient()` (`src/lib/supabase/server.ts:12`), `env.app.demoMode`/`env.app.needsSupabase` (`src/lib/env.ts`).
- Produces: tipo `KnowledgeEvent`, `TimelineEntry`, `VisibilityKey`; función `listTimeline(scope): Promise<TimelineEntry[]>` (scaffold; F0.5.1 la completa contra `v_knowledge_timeline`).

- [ ] **Step 1: Crear `src/lib/knowledge/types.ts`**

```ts
/** Discriminador de visibilidad (Parte II §B 1.2 / Parte III §4.1). */
export type VisibilityKey = "public_auth" | "staff" | `client:${string}` | `perm:${string}`;

export type ActorKind = "user" | "system" | "integration";

/** Fila del read-model del timeline (espeja public.knowledge_events). */
export interface KnowledgeEvent {
  id: string;
  seq: number;
  eventType: string;
  occurredAt: string;
  actorKind: ActorKind;
  actorLabel: string | null;
  entityType: string;
  entityId: string;
  summary: string | null;
  visibilityKey: string;
}

/** Entrada de timeline para la UI. */
export interface TimelineEntry extends KnowledgeEvent {}

/** Scope de consulta del timeline. */
export interface TimelineScope {
  entityType?: string;
  entityId?: string;
  limit?: number;
}
```

- [ ] **Step 2: Crear `src/lib/knowledge/data.ts` (guard isMock; scaffold)**

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { TimelineEntry, TimelineScope } from "./types";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

/**
 * Lee el timeline corporativo unificado. Scaffold de F0.5.0: la vista
 * v_knowledge_timeline se crea en F0.5.1 (mig 0111). Hasta entonces devuelve [].
 * En demo/preview devuelve [] (no rompe la shell). G11.
 */
export async function listTimeline(_scope: TimelineScope = {}): Promise<TimelineEntry[]> {
  if (isMock()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  // F0.5.1: query a v_knowledge_timeline filtrando por scope, keyset por seq desc.
  return [];
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `cd /Users/martinbattaglia/CODE/tops-ordenes && npm run typecheck`
Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add src/lib/knowledge/types.ts src/lib/knowledge/data.ts
git commit -m "feat(knowledge): scaffold TS read-model (types + data.ts con isMock)"
```

---

## Task 8: Verificación integral + checklist de aplicación manual (handoff)

**Files:**
- Create: `docs/superpowers/plans/F05-0-APPLY-CHECKLIST.md`

- [ ] **Step 1: Gates de build/test (todo verde)**

Run: `cd /Users/martinbattaglia/CODE/tops-ordenes && npm run typecheck && npm test && npm run lint && npm run build`
Expected: typecheck 0 errores · vitest todos PASS · lint sin errores · build exit 0.

- [ ] **Step 2: Confirmar que NO se aplicó ninguna migración (G3)**

Run: `cd /Users/martinbattaglia/CODE/tops-ordenes && git status --porcelain supabase/migrations/ && echo '--- solo archivos nuevos 0106/0107/0110, ninguno aplicado ---'`
Expected: aparecen los 3 archivos nuevos; ninguna acción contra la DB de prod.

- [ ] **Step 3: Escribir el checklist de aplicación manual para Dirección**

Crear `docs/superpowers/plans/F05-0-APPLY-CHECKLIST.md`:

```markdown
# F0.5 — Checklist de aplicación manual (Martín)

> Las migraciones se ENTREGAN, NO se aplican (G3). Aplicar SOLO cuando el bloque F0.5 esté completo.

## Precondición
- [ ] `ls supabase/migrations/ | sort` confirma que 0106–0119 están libres como nombre de archivo (prod rastrea por timestamp; NO usar list_migrations).
- [ ] El bloque F0.5 (0106, 0107, 0108, 0109, 0110, 0111) está completo. (0108/0109/0111 los entrega F0.5.1.)

## Orden de aplicación (en el SQL editor de Supabase, prod arsksytgdnzukbmfgkju)
1. [ ] Aplicar `0106_knowledge_module_enum.sql` SOLA, en su propia transacción. Verificar: `select unnest(enum_range(null::public.permission_module_t));` incluye `knowledge`.
2. [ ] Aplicar `0107_knowledge_core.sql`. Verificar: las 9 tablas `knowledge_*` existen con RLS habilitada (`select relname, relrowsecurity from pg_class where relname like 'knowledge_%'`).
3. [ ] Aplicar `0108`, `0109`, `0111` (de F0.5.1) en orden.
4. [ ] Aplicar `0110_knowledge_rbac_seed.sql`. Verificar: `select slug from public.permissions where module='knowledge';` devuelve 5 filas.
5. [ ] `get_advisors` (security + performance) sin hallazgos nuevos.

## Smoke de RLS (post-aplicación)
- [ ] Un usuario `comercial` ve `knowledge.view` en su set de permisos; un `cliente_b2b` NO.

## Rollback
- Todo es aditivo. Rollback = `drop table` de las tablas `knowledge_*` nuevas + revocar los grants `knowledge.*`. El valor de enum `knowledge` NO se puede quitar fácilmente (es inocuo si queda).
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/F05-0-APPLY-CHECKLIST.md
git commit -m "docs(knowledge): checklist de aplicación manual F0.5 (entregado, no aplicado)"
```

- [ ] **Step 5: Cierre de sub-fase**

Confirmar criterios de cierre de F0.5.0 (spec Parte II §5):
- [ ] Módulo `knowledge` registrado en RBAC (tipos + seed entregado).
- [ ] Tablas read-model + RLS `visibility_key` entregadas (0107) — no aplicadas.
- [ ] Scaffold TS con `isMock` + helper puro testeado.
- [ ] typecheck 0 · vitest PASS · build exit 0.
- [ ] NADA aplicado a prod; checklist de aplicación entregado.

---

## Self-Review (hecho al escribir el plan)

**1. Cobertura del spec (Parte II, F0.5.0):** registro bounded context (Task 2+3+5) ✓ · tablas read-model + RLS (Task 4) ✓ · scaffold TS + isMock (Task 7) ✓ · helper de visibilidad mínimo-común (Task 6) ✓ · entregado-no-aplicado + checklist (Task 8) ✓. Proyección (triggers/RPCs/vistas), búsqueda, grafo, semántica → **F0.5.1–F0.5.5** (planes separados; fuera de scope acá, declarado).

**2. Placeholders:** sin TBD/TODO genéricos. El SQL grande (0107) se referencia a su fuente única en el spec aprobado (decisión DRY de gobernanza, declarada en Global Constraints) en vez de duplicarse; el SQL chico (0106/0110) está inline completo; el TS está completo.

**3. Consistencia de tipos:** `requiredVisibilityKeys(string[]):string[]`, `VisibilityKey`, `KnowledgeEvent`/`TimelineEntry`, `listTimeline(TimelineScope)` — nombres usados consistentemente entre Task 6 y 7. `MODULE_LABELS["knowledge"]` y la unión `PermissionModule` alineados (Task 2).

---

## Execution Handoff

Plan completo y guardado en `docs/superpowers/plans/2026-06-28-f05-0-knowledge-foundation.md`. Dos opciones de ejecución:

1. **Subagent-Driven (recomendada)** — despacho un subagente fresco por tarea, reviso entre tareas, iteración rápida (`superpowers:subagent-driven-development`).
2. **Inline** — ejecuto las tareas en esta sesión con checkpoints de revisión (`superpowers:executing-plans`).

**¿Qué enfoque preferís?** (Recordatorio: nada se commitea/aplica sin tu OK; las migraciones quedan entregadas-no-aplicadas.)
