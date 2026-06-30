# Run Log — Nexus Link RC1.2 (Canales / Grupos · Membresía · Roles · Moderación · Pinned)

> **Base:** `release/nexus-base` (`42ad20d`, RC1.0). **Estrategia:** RC1 = bloque único en evolución;
> nada se commitea/aplica/deploya hasta cerrar todo RC1. **Estado global:** entregado-NO-aplicado (G3).
> Proyecto: `tops-ordenes-prod` / `arsksytgdnzukbmfgkju`.

---

## Hito 0 — Implementación RC1.2 (G7 aprobado)

| Campo | Valor |
|---|---|
| **G7** | Plan RC1.2 aprobado (D-RC1.2-1 auto-unión a canales públicos; D-RC1.2-2 moderación = tema/archivar/miembros/roles/**pinned**; invitaciones → RC1.4). |
| **Migración** | `0150_connect_join_channel.sql` (auto-unión a canal público, fail-closed para privados). |
| **Lib (nuevo, aditivo, reusa RC1.1 por import)** | `ports/channel-ops-port.ts` · `adapters/supabase/connect-ops.adapter.ts` · `application/channel-use-cases.ts` (+test) · `domain/channel.ts` (+test) · `adapters/driving/channel-actions.ts` · `read/channel-data.ts` · `channel-mock.ts`. |
| **UI (nuevo)** | `(app)/connect/canales/page.tsx` (directorio) · `canales/[slug]/page.tsx` (vista de canal) · `_components/{ChannelView,ChannelDirectory}.tsx` (reusan `ThreadView` de RC1.1). |
| **No-modificación RC1.1** | Único cambio a archivo de RC1.1/shell = **1 línea aditiva** en `Sidebar.tsx` (item "Canales"). ThreadView/inbox-data/mock/types/actions de RC1.1 INTACTOS. |
| **Gates** | typecheck **0** · build **0** (rutas `/connect/canales` + `[slug]`) · vitest **369/369** (+10 RC1.2: 6 domain/channel + 4 use-cases). |
| **Render preview (demo)** | Directorio (3 canales · Abrir/Unirme/Crear) + vista de canal (header con tema editable + Archivar + **panel de miembros con selectores de rol** + **fijados** + hilo reusado) + estado de unión (no-miembro). 0 errores de consola. |

---

## Hito 1 — Engineering Readiness Review + HARDENING (decisión de Dirección)

| Campo | Valor |
|---|---|
| **Review** | Adversarial 5 dimensiones + verify (verify parcial por rate-limit). **52 hallazgos · 0 Critical.** |
| **🔴 RC12-008 (important, en RC1.0/`0144`)** | **FAIL-OPEN** de las 7 RPC de moderación: guard `NOT IN` NULL-inseguro → un staff no-miembro podía moderar conversaciones ajenas. (Sin exposición viva: migraciones no aplicadas.) |
| **Decisión Dirección (2026-06-30)** | **Opción 1:** NO tocar `0144`; corregir vía migración **aditiva** nueva `0151_connect_moderation_failclose.sql` (`create or replace` de las 7 RPC con guard fail-closed NULL-safe: `if not is_admin() and (v_role is null or v_role not in (...)) then raise`). No reescribir la historia de RC1.0. |
| **Política permanente P-1** | Registrada en `docs/superpowers/NEXUS-ENGINEERING-POLICY.md`: toda SECDEF considera NULL explícito; prohibido depender de `NOT IN`/`<>`; guards fail-closed. Vinculante para RC1.3, RC1.4, RC2… |
| **Minor (documentados)** | `conversationId`/`messageId` como `string().min(1)` y no `.uuid()` (deliberado: soporta ids mock en demo; la RPC re-valida uuid — sin agujero). `mapPgError` duplicado RC1.1/RC1.2 (aceptado). |
| **Verificación post-fix (evidencia, G5/G6)** | `0151` validado por el **motor PostgreSQL real** (expresión booleana pura, read-only en prod): no-miembro/member/guest no-admin → **DENY=true**; moderator/owner/admin → ALLOW (false); set_member_role no-miembro/moderator → DENY=true, owner → ALLOW. Las 7 funciones FAIL-CLOSED. Cuerpos fieles a 0144 (solo cambia el guard). Sanity determinístico: 7 funciones, 0 guards NULL-inseguros, $$ balanceados, revoke/grant 7/7. *(Nota: un verificador adversarial reportó "fail-open" por un error propio de lógica —evaluó `is_admin()` en vez de `not is_admin()`—; el motor lo desmiente: `TRUE AND (TRUE OR NULL) = TRUE` → el raise dispara → deniega.)* typecheck/build/tests sin cambio (369). |

**Estado al cierre:** 0 Critical / 0 Important abiertos (RC12-008 corregido vía `0151`).

---

## Estado del bloque RC1 (acumulado, entregado-NO-aplicado, SIN commitear)
Migraciones del bloque: `0142`–`0151` (RC1.0: 0142-0149 · RC1.2: 0150 join + 0151 hardening). Código:
`src/lib/connect/**` + `src/app/(app)/connect/**` + integraciones aditivas. **Aplicación + commit + push +
merge + deploy = UNA sola vez al cierre de Nexus Link RC1 completo.**

## Hito 2+ — (PENDIENTE) RC1.3 (chat contextual ERP)
*No iniciar hasta confirmar el hardening de RC1.2 completamente validado (decisión Dirección).*
