# APP-BOOT-ROOT-CAUSE — TOPS NEXUS

**Fecha:** 2026-06-09 · Causa raíz del splash eterno en `nexus.logisticatops.com`.

---

## Qué está esperando la aplicación
El navegador espera que **termine el stream RSC de `(app)/layout.tsx`**. El splash (`app/loading.tsx`) es el fallback de Suspense de ese layout: se reemplaza **solo** cuando los `await` del layout resuelven y el server envía el payload. No hay ninguna condición client-side (no es un `setLoading` que falta).

## Por qué nunca termina
**`(app)/layout.tsx` ejecuta ~8 round trips de red bloqueantes por page-view** (4× `auth.getUser()` + 3 counts + 1 profiles — detalle archivo:línea en APP-BOOT-AUDIT §3), **sin ningún timeout** (supabase-js usa fetch sin AbortSignal), corriendo dentro de una **función SSR de Netlify con timeout (~10s)** que **streamea el splash primero**. Dos modos de falla, mismo síntoma:

1. **Función muerta a mitad de stream:** la cadena de awaits supera el presupuesto de la función → Netlify la mata → el stream queda inconcluso → React **nunca** reemplaza el fallback → splash para siempre, **sin error visible**.
2. **Await estancado:** cualquiera de los 8 RTs se cuelga (conexión TLS estancada, sin timeout) → mismo resultado.

## Qué cambio introdujo el problema
**Commit `0f51acc`** (RBAC Estrategia B) — único commit reciente sobre el boot path (git log):
- Agregó al layout `Promise.all([canAccess("sistema.view"), canAccess("rrhh.documentacion.view")])` → **+4 round trips** (2 getUser + 2 counts; +2 RPC si el usuario tiene `user_roles`).
- Reescribió `checkPermission` (usado por `canViewExecutiveFinancialBlocks`, también en el layout): el conteo pasó de service-role a **cliente de sesión con RLS** sobre `user_roles` (policy que evalúa `current_role()` → lee `profiles`), añadiendo costo por request.
- Neto: las llamadas bloqueantes del layout **se duplicaron (4 → 8)**. El "código dormido" era funcionalmente inocuo (no restringe nada), pero **NO era inocuo en performance**: ese costo corre en CADA page-view de CADA usuario.

## Por qué se manifiesta en `nexus.logisticatops.com`
Medido (mismo backend): nexus responde **~3-4× más lento por request** que `tops-ordenes.netlify.app` (949 vs 183 ms en `/`; 2.649 vs 708 ms en `/login`). El multiplicador del camino del dominio custom, aplicado sobre 8 RTs secuenciales-en-cadena, **empuja el render del layout por encima del límite de la función** en nexus; en netlify.app el mismo código puede completar a tiempo. (El onboarding de Martín validó login en nexus probablemente **antes** de que `0f51acc` quedara Published — la validación Published de ese commit nunca se confirmó explícitamente.)

## Cadena causal (resumen)
```
0f51acc duplica awaits del layout (4→8 RTs, sin timeout)
        + force-dynamic + streaming (splash sale primero)
        + función SSR Netlify con límite (~10s, sin [functions] config)
        + dominio nexus ~3-4× más lento por request
        ───────────────────────────────────────────────
        layout no resuelve dentro del presupuesto
        → stream muere/queda colgado a mitad
        → fallback (splash) nunca se reemplaza
        → "INICIALIZANDO MÓDULOS" para siempre, sin error
```

## Descartado (con evidencia)
| Hipótesis | Veredicto |
|---|---|
| Estado client-side / `setLoading(false)` faltante | ❌ el splash no tiene estado (fallback Suspense puro) |
| Redirect loop | ❌ se vería rebote/error, no splash estable; middleware sano (307 correcto) |
| Lógica RBAC denegando | ❌ todas las ramas de error de `canAccess`/`checkPermission` **devuelven valor** (true/false/403), no cuelgan |
| Página `/ejecutivo` colgada (Hikvision/Clientify) | ❌ se vería el **skeleton gris** `(app)/loading.tsx`, no el splash; además `camerasOnline` tiene timeout 10s + try/catch |
| Archivos faltantes del deploy | ❌ n/a (no es 404; el shell streamea) |
| Cookies/auth rotas en nexus | ❌ login/magic link validados en nexus; middleware redirige bien |

## Confirmación pendiente (1 dato tuyo)
El **log de la función SSR en Netlify** a la hora del cuelgue (`Task timed out…`/Duration≈límite/502) confirma el modo de falla 1 vs 2. El fix plan cubre ambos (es la misma superficie: awaits del layout sin presupuesto).

## Clasificación
- **Severidad:** Crítico (bloquea el ingreso a la app en el dominio productivo).
- **Naturaleza:** regresión de **performance/arquitectura de boot** introducida por `0f51acc` (no es bug de lógica RBAC; la lógica dormida funciona).
- **Mitigación inmediata disponible:** republicar el deploy previo (`00dfb41`) — restaura el boot sin perder nada (0f51acc no activaba restricciones aún). Ver FIX-PLAN.
