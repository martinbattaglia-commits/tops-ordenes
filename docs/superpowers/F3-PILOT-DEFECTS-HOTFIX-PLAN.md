# F3 · Pilot Defects — Hotfix Plan (implementación local)

> Hotfix **implementado y validado localmente** (NO aplicado a prod, NO deploy) para los 4 defects del piloto. 2026-07-01.
> Autorización Dirección: preparar A+B+C+D local; **sin deploy/push/merge/aplicación de migración en prod**.
> Referencias: `F3-PILOT-DEFECTS-TRIAGE.md` (diagnóstico), `F3-PILOT-VALIDATION-LOG.md`.

---

## 1. Resumen ejecutivo

Se corrigieron los 4 defects con cambios **mínimos y acotados**:
- **DEFECT-1** (crítico) → canal Supabase Realtime **único por instancia** (`realtime.ts`). Frontend.
- **DEFECT-2** (alto) → identidad humana en el panel de miembros vía `profiles_public` (`channel-data.ts` + display en `ChannelView.tsx`). Frontend/data-layer.
- **DEFECT-3** (medio→exigido por Dirección) → **autocomplete de usuarios internos** (RPC nueva `connect_search_profiles` mig `0158` + `searchProfilesAction` + componente `MemberSearch`). Migración + frontend.
- **DEFECT-4** (bajo) → mensajes claros y accionables en el flujo de agregar miembros.

**QA local: typecheck 0 · lint 0 errores · tests 378/378 · build OK.** Producción intacta (`88add4b`). **Requiere una ventana de aplicación (migración `0158`) + deploy controlado** con nueva autorización.

---

## 2. Defects corregidos + causa raíz (resumen; detalle en el triage)

| ID | Causa raíz | Fix |
|---|---|---|
| DEFECT-1 | `useRealtimeTable` nombraba el canal determinístico por tabla → 2 componentes sobre `notifications` colisionaban (`.on` tras `.subscribe`) | Sufijo único por instancia (`useId()`) en el nombre del canal |
| DEFECT-2 | `listParticipants` mapeaba `name:null` (sin join a perfiles); UI caía al UUID | Resolver `profile_id→full_name` vía `profiles_public`; display nunca usa UUID como etiqueta principal (queda como `title`) |
| DEFECT-3 | Input UUID a mano; sin RPC de búsqueda; diseñado "fase posterior" | RPC `connect_search_profiles` (staff interno, gated) + autocomplete `MemberSearch` |
| DEFECT-4 | `addMemberAction` validaba UUID → "Datos inválidos" genérico | Mensaje accionable + el selector resuelve el UUID (evita el texto libre) |

---

## 3. Archivos modificados / creados

| Archivo | Tipo | Cambio |
|---|---|---|
| `src/lib/supabase/realtime.ts` | mod (frontend) | Canal único por instancia (`useId()`), deps + doc DEFECT-1 |
| `src/lib/connect/read/channel-data.ts` | mod (data-layer) | `listParticipants` resuelve nombres vía `profiles_public` (batch, null-safe) |
| `src/lib/connect/adapters/driving/channel-actions.ts` | mod (server action) | + `searchProfilesAction` + `ProfileHit`; mensaje claro en `addMemberAction` |
| `src/app/(app)/connect/_components/MemberSearch.tsx` | **nuevo** (frontend) | Autocomplete cliente: debounce 250ms + race-guard + estados loading/empty/error |
| `src/app/(app)/connect/_components/ChannelView.tsx` | mod (frontend) | Usa `MemberSearch`; `displayName` (no UUID principal); removió estado `newMember` |
| `supabase/migrations/0158_connect_member_profile_search.sql` | **nuevo** (migración) | RPC `connect_search_profiles` (NO aplicada) |

---

## 4. Migración `0158_connect_member_profile_search`

- **RPC** `connect_search_profiles(q text, limit_count int default 10)` → `(profile_id, full_name, email)`.
- **Seguridad:** `SECURITY DEFINER`, `search_path=public, pg_temp`, gate `has_permission('connect.view')` (fail-closed), `revoke public/anon/authenticated` + `grant execute authenticated`.
- **Filtro (solo staff interno):** `role in ('admin','operaciones','supervisor')` (alineado con `is_staff()`), `client_id is null` (excluye clientes/externos B2B), `active`. Match por nombre/apellido/email (ILIKE, parámetro `q`), límite 1..25 (default 10), mínimo 2 chars.
- **Validado read-only:** devuelve los 10 usuarios internos con nombre/email; excluye externos.
- **Idempotente** (`CREATE OR REPLACE`) · **reversible** (`drop function` / re-aplicar previo) · **sin datos**.
- **NO aplicada a prod** (pendiente ventana autorizada).

---

## 5. QA local (obligatoria)

| Check | Resultado |
|---|---|
| `npm run typecheck` (tsc --noEmit) | ✅ **0 errores** |
| `npm run lint` (next lint) | ✅ **0 errores** (5 warnings `alt-text` pre-existentes en PDFs, ajenos al hotfix) |
| `npm test` (vitest run) | ✅ **378/378** (57 files, sin regresiones) |
| `npm run build` (next build) | ✅ **Compiled successfully** (Node 22) |

*(Nota: no se agregaron unit tests nuevos — los cambios son hook realtime / data-loader / RPC / UI autocomplete, no cubiertos por la suite de dominio/aplicación existente; se validan por el smoke plan §8.)*

---

## 6. Riesgos

| Riesgo | Sev. | Mitigación |
|---|---|---|
| **DEPLOY-1** (outage por toolchain/worktree) | Alta | Deploy controlado validado: Node 22 + checkout NO-worktree + draft-first + rollback a `88add4b` |
| Orden: si se deploya el frontend ANTES de aplicar `0158` | Media | El autocomplete llamaría a una RPC inexistente → error controlado ("No se pudo buscar usuarios"). **Aplicar `0158` PRIMERO, luego deploy.** |
| `useId()` cambia el naming de todos los realtime | Media | Cambio acotado; cada instancia recibe sus eventos; cubrir con smoke de notificaciones + mensajería + tracking |
| RPC expone email interno a usuarios con `connect.view` | Baja | Solo staff interno a staff interno; uso legítimo (agregar miembros); sin externos |
| RLS de `profiles_public` | Baja | Es SECDEF view (id, full_name) diseñada para lectura pública interna |

---

## 7. Rollback

- **Frontend:** el deploy es reversible (re-publish del deploy sano `88add4b` en Netlify). Sin datos que revertir.
- **Migración `0158`:** reversible con `drop function public.connect_search_profiles(text,int)` (o re-aplicar estado previo). Idempotente. No modifica datos.
- Orden de rollback: revertir deploy primero (UI vuelve a estado previo), luego opcionalmente `drop` de la RPC.

---

## 8. Smoke plan post-hotfix (tras aplicar `0158` + deploy)

**Notificaciones (DEFECT-1):** abrir campana → dropdown sin error; abrir `/connect/notificaciones` → **NO error boundary**, 0 errores críticos de consola, 0 500/502; navegar `/connect`↔Inicio varias veces sin colisión realtime.

**Miembros (DEFECT-2):** abrir canal → panel de miembros → dueño/miembros con **nombre** (no UUID); avatar/iniciales coherentes.

**Agregar miembro (DEFECT-3):** buscar por **nombre** y por **email** → sugerencias → seleccionar → agregar a canal privado → aparece como miembro; **NO** aparecen externos/clientes en resultados.

**Error handling (DEFECT-4):** texto libre corto/sin selección → mensaje claro (no "Datos inválidos"); sin resultados → "No se encontró un usuario interno con ese dato."; no rompe la pantalla.

**Regresiones:** `/connect`, `/connect/canales`, `/connect/buscar` (0156/0157 sigue OK), `/connect/notificaciones`, `/dashboard`, `/login`, rutas críticas; `/api/version` == commit del deploy; 0 5xx.

---

## 9. Orden de ejecución (ventana de aplicación — requiere autorización)

1. **Commit local** del hotfix (código + migración `0158` + docs) — con autorización.
2. **Aplicar `0158`** a prod (`apply_migration`, solo `CREATE OR REPLACE` + grants) + smoke RPC (`connect_search_profiles('jose')` devuelve internos).
3. **Deploy controlado** del frontend (Node 22 + NO-worktree + draft-first): el checkout de deploy debe apuntar al commit del hotfix → draft → smoke draft → `--prod` → smoke prod → rollback a `88add4b` ante fallo.
4. Smoke §8 completo.

---

## 10. Recomendación GO / NO GO

**🟢 GO** a: (a) commitear el hotfix local, (b) aplicar `0158`, (c) deploy controlado — **todo con autorización explícita de Dirección** (ventana de aplicación). El código está implementado, QA verde y de bajo riesgo; el único riesgo material es el **deploy** (mitigado por el procedimiento validado).

**Esta ventana fue solo preparación/QA/documentación — NO se tocó producción.**

---

## 11. Estado / F4
- **Producción NO modificada** (`88add4b`; `0156`/`0157` intactas; `0158` NO aplicada). Cambios locales sin commitear (pendiente autorización).
- **F3 NO se cierra** hasta aplicar el hotfix + validar + validación manual + aprobación de Dirección.
- 🚫 **F4 sigue BLOQUEADA.**
- **Revisión adversarial:** ver §12 (resultado del Code Reviewer).

## 12. Revisión adversarial (Code Reviewer)

Se corrió una revisión adversarial del hotfix. Resultado:

- 🔴 **BLOCKER (seguridad) — RESUELTO:** la RPC `connect_search_profiles` devolvía `email` con gate `connect.view`, que tienen roles **no-admin** (operaciones/compliance/comercial/seguridad). Eso **viola el PII lockdown de la mig `0040`** (`profiles_public` 0046 excluye email a propósito → email no se expone cross-staff a no-admin). **Fix aplicado (Fix A):** la RPC ya **NO devuelve email** — `returns table (profile_id uuid, full_name text)`; sigue permitiendo **buscar** por email en el WHERE (tipeás un email conocido y encontrás a la persona) pero **no lo enumera**. Se removió `email` de `ProfileHit` y `MemberSearch`. Re-validado read-only: `jose` → devuelve nombre, sin email.
- 🟡 **Hardening — APLICADO:** escape de comodines LIKE (`\ % _`) en `q` (evita barridos con `%`/`_`). Validado read-only: `%` → **0 filas**.
- ✅ **Verificado LIMPIO por el reviewer:** DEFECT-1 (canal único por instancia, cleanup `removeChannel`, 6 call sites intactos); **NO reproduce la clase 0156/0157** (SELECT único + refs calificadas, sin UNION); el filtro **excluye clientes/externos** (`role` enum incluye `cliente`, excluida; `client_id is null`); grants/revoke/`search_path` correctos; `channel-actions` gate suficiente + `export type` en "use server" válido; `MemberSearch` race-guard correcto; `ChannelView` sin `newMember` colgado, `onAdd` con tipo correcto.
- **Re-QA post-fix:** typecheck **0** · lint **0** · tests **378/378** · build **OK**.
- **Veredicto:** el NO-GO del reviewer era **exclusivamente** por el blocker de PII → **resuelto**. Hotfix listo para la ventana de aplicación (commit → aplicar `0158` → deploy controlado), con autorización.
