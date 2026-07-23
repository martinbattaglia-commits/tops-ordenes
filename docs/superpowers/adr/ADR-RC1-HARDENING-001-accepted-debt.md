# ADR-RC1-HARDENING-001 — Deuda técnica aceptada en el cierre de Nexus Link RC1

- **Estado:** Aceptado · **Fecha:** 2026-06-30 · **Contexto:** cierre de hardening de RC1 (ver `RC1-HARDENING-REPORT.md`).
- **Decisor:** Lead Software Architect (pase de hardening), bajo directiva de Dirección "estabilidad > velocidad; no gold-plating".

## Contexto
La auditoría integral de RC1 (8 dimensiones) surfaceó hallazgos que, tras triaje senior, se resuelven **NO corrigiendo** porque el costo/riesgo supera el valor o porque exceden el alcance de RC1. Se registran aquí para que sean decisiones trazables, no omisiones.

## Decisiones

### D1 — `isMock()` duplicado se mantiene como convención
`function isMock(){ return env.app.demoMode || env.app.needsSupabase }` se repite en **38 data layers** del codebase (9 en RC1). **No se extrae** un helper compartido: unificar solo RC1 crea split-brain (dos patrones); unificar las 38 excede el alcance y toca módulos congelados. La función es estable y trivial. Si en el futuro se centraliza, hacerlo en `@/lib/env` y migrar TODO el codebase en un pase dedicado.

### D2 — Postura RBAC fail-open (sistémica) no se cambia desde RC1
`src/lib/rbac/guard.ts` (Estrategia B) deja pasar usuarios sin asignación en ciertos modos. Es la **política global de Nexus** (documentada en la auditoría de permisos), no RC1-específica. RC1 gatea fail-closed con `canAccess('connect.*')`. Cambiar la postura global es **decisión de Dirección**; pendiente antes de exponer a externos (F5). Blast-radius actual: interno, 0 clientes.

### D3 — Anuncio incremental para lectores de pantalla (aria-live) se difiere
Envolver la lista de notificaciones en `aria-live` (fix naíf) **degradaría** la UX: re-anuncia toda la lista en cada `router.refresh()` (polling 30s). La solución correcta es una región de estado *debounced* que anuncie solo el delta ("N nuevas"). Se difiere como mejora de diseño post-RC1.

### D4 — Casts de borde en data layers se mantienen
`as unknown as RpcCapableClient` y `Record<string, unknown>` en los mappers son el **patrón de borde** establecido para filas loosely-typed de PostgREST (consistente con knowledge/rbac). No son bugs; el tipado fuerte vive en el dominio. No se cambian.

### D5 — Colores de paleta fija (emerald/amber) se mantienen
`text-emerald-500`/`bg-amber-400` son colores de paleta elegidos (no tokens `status-*` que la guía de dark-mode desaconseja como texto). Sin fallo de contraste confirmado. Si se detecta uno, bajar a `-400` en texto.

## Consecuencias
- Estas decisiones NO bloquean el GO de RC1 (ver report §8).
- D2 es la única con condición de release externo (F5); las demás son permanentes o diferidas de bajo impacto.
- Cualquier reapertura debe citar este ADR.
