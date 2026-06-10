# APP-BOOT-AUDIT — TOPS NEXUS

**Fecha:** 2026-06-09 · Incidente: `nexus.logisticatops.com` queda en "TOPS NEXUS · SISTEMA OPERATIVO · INICIALIZANDO MÓDULOS".
**Sin fixes aplicados.** Evidencia con archivo:línea exactos.

---

## 1. Qué componente controla la pantalla
- **`src/app/loading.tsx`** — el splash de la captura (logo + wordmark "TOPS NEXUS / Sistema Operativo" + footer `"Inicializando módulos · Logística TOPS · Verotin S.A."`, línea 41).
- Es el **loading UI del App Router (Next 14)** a nivel raíz: **NO tiene estado, ni `setLoading(false)`, ni hooks, ni store**. Es un fallback de Suspense puramente visual.
- Existe un segundo loading: **`src/app/(app)/loading.tsx`** — un **skeleton gris** (pulse, cards), visualmente distinto.

## 2. Condición exacta para salir de la pantalla
**Que el stream RSC del segmento debajo del fallback termine de renderizar en el server.** No hay condición client-side.
Jerarquía de Suspense (clave del diagnóstico):
- **Splash raíz** (`app/loading.tsx`) = fallback mientras resuelve **`src/app/(app)/layout.tsx`** (que es `async` y hace `await`).
- **Skeleton gris** (`(app)/loading.tsx`) = fallback mientras resuelve la **página** (ej. `/ejecutivo`), una vez que el layout ya resolvió.

→ **La captura muestra el splash raíz ⇒ lo que nunca termina son los `await` de `(app)/layout.tsx`** (si fuera la página, se vería el skeleton gris).

## 3. Llamadas exactas que bloquean (archivo:línea)
Camino del usuario autenticado: `/` (`src/app/page.tsx` → `redirect("/ejecutivo")`) → **`(app)/layout.tsx`**:

| # | Llamada | Archivo:línea | Round trips de red |
|---|---|---|---|
| 1 | `supabase.auth.getUser()` | `(app)/layout.tsx:19` | 1 (Supabase Auth) |
| 2 | `profiles` select | `(app)/layout.tsx:26-29` | 1 (PostgREST) |
| 3 | `await canViewExecutiveFinancialBlocks()` → `checkPermission("cockpit.view")` | `layout.tsx:56` → `cockpit-visibility.ts:23` → `check.ts` | `getUser()` (**2º**) + count `user_roles` self (**edit 0f51acc**) = 2 |
| 4 | `Promise.all([canAccess("sistema.view"), canAccess("rrhh.documentacion.view")])` | `layout.tsx:61-63` → `guard.ts` (canAccess) | por cada uno: `getUser()` (**3º y 4º**) + count `user_roles` (= 4; +RPC `has_permission` ×2 si el usuario tiene `user_roles`) |

**Total: ~8 round trips bloqueantes por page-view** (4× `auth.getUser` + 3× counts + 1 profiles). **Antes de `0f51acc` eran ~4** (getUser + profiles + checkPermission con count admin). → el commit **duplicó** las llamadas bloqueantes del layout.

## 4. ¿Apareció después de RBAC `0f51acc`?
**Sí, es el único commit reciente que tocó el boot path**:
```
git log -- (app)/layout.tsx, rbac/check.ts, rbac/guard.ts
0f51acc  feat(rbac): gating real Sistema + RRHH→Documentación (Estrategia B)   ← agregó #3-interno y #4
1430204  RC release (no tocó layout-awaits)
```
Además `check.ts` cambió el conteo: de service-role (sin RLS) a **cliente de sesión con RLS sobre `user_roles`** (policy que invoca `current_role()` → lee `profiles`).

## 5. Middleware / auth / session / Supabase client
- **Middleware** (`src/middleware.ts` → `updateSession`): solo sesión; sin RBAC. Sano en ambos dominios (`/`→307→login correcto).
- **Cliente Supabase server** (`src/lib/supabase/server.ts`): **sin timeout de fetch** (supabase-js usa `fetch` sin `AbortSignal`) → **una conexión estancada = `await` que no resuelve nunca**.
- **Netlify**: `netlify.toml` **sin config `[functions]`** → timeout default de la función SSR (≈10s). Con `force-dynamic` + layout async, Netlify **streamea el splash primero**; si la función muere por timeout **a mitad del stream**, el RSC payload nunca llega → **React nunca reemplaza el fallback → splash eterno, sin error en pantalla**. (Coincide 1:1 con el síntoma.)

## 6. ¿Promise pendiente / loop / timeout?
- No hay loop ni hook client-side (la pantalla no es client-state).
- Mecanismos posibles que dejan el `await` del layout sin resolver: **(a)** fetch a Supabase estancado (sin timeout) en cualquiera de los 8 RTs; **(b)** función SSR muerta por timeout a mitad de stream (ver §5); **(c)** ambos combinados (latencia acumulada > presupuesto).

## 7. nexus.logisticatops.com vs tops-ordenes.netlify.app (medido)
| Request (sin sesión) | nexus | netlify.app |
|---|---|---|
| `GET /` (middleware 307) | **949 ms** | 183 ms |
| `GET /login` (SSR 200) | **2.649 ms** | 708 ms |
→ Mismo backend Netlify, pero **nexus ≈3-4× más lento por request** en esta muestra (camino DNS/proxy/TLS del dominio custom). Con 8 RTs bloqueantes en el layout, ese multiplicador **empuja el render del layout hacia/encima del límite de la función** en nexus, mientras netlify.app puede pasar raspando. Cookies/auth/callbacks: sin diferencias de lógica (cookies por host: sesiones separadas; el magic link en nexus ya validó el flujo auth).

## 8. Evidencia faltante (solo accesible para vos — confirma el diagnóstico)
1. **Netlify → Functions/Logs** a la hora del cuelgue: buscar `Task timed out after 10.00 seconds` (o Duration ≈ límite) / 502 en la función SSR. **Es el smoking gun.**
2. **Probar logueado en `tops-ordenes.netlify.app`**: si ahí carga y en nexus no → confirma el factor latencia de dominio; si cuelga en ambos → es puramente el layout/award (igual causa, sin factor dominio).
3. DevTools → Network en la pantalla colgada: el document request queda ¿(pending) o terminó truncado? (truncado = función muerta a mitad de stream).
4. Confirmar si la **migración 0070 fue aplicada** y si **hay filas en `user_roles`** para el usuario que prueba (suma 2 RPC más al layout).
