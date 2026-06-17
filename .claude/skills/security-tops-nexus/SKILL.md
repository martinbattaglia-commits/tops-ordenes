---
name: security-tops-nexus
description: >-
  Seguridad y hardening de TOPS NEXUS: autenticación de crons (CRON_SECRET, fail-closed),
  RLS como frontera, middleware/allowlist, RBAC enforcement, service_role, secrets, verificación
  de webhooks (HMAC / token timing-safe), OWASP y auditoría. Usar al tocar auth, exponer un
  endpoint público, crear/revisar un webhook o cron, manejar secrets/service_role, o revisar
  hardening. NO usar para optimización (performance-tops-nexus) ni diseño de módulos
  (architecture-tops-nexus).
---

# security-tops-nexus

> **Antes de actuar, leé y aplicá [`../_shared/GOVERNANCE.md`](../_shared/GOVERNANCE.md) (G1–G11).
> En particular G9 (secretos) y G10 (inmutabilidad / RPC). Diseñás y entregás diffs staged; NO arreglás
> producción ni activás cambios system-wide sin plan aprobado (G1/G7).**

## Propósito
Cerrar y prevenir los huecos de seguridad concretos del ERP —empezando por el **fail-open del
cron** (hallazgo crítico #1 de la auditoría)— y estandarizar el hardening.

## Cuándo usarla
- Tocar autenticación / autorización.
- Agregar o exponer un endpoint público (allowlist del middleware).
- Crear o revisar un webhook o un cron.
- Manejar secrets / `service_role`.
- Revisar RLS como frontera de datos, o auditar OWASP / hardening.

## Cuándo NO usarla
- Optimización de runtime → `performance-tops-nexus`.
- Diseño de dónde vive un módulo → `architecture-tops-nexus`.
- Operación de deploy (salvo el ángulo de secrets) → `devops-tops-nexus`.

## Reglas obligatorias (además de G1–G11)

### CRON_SECRET / Fail-open (OWASP A07/A05) — bug activo P0
- Patrón actual **fail-open**: `const secret = process.env.CRON_SECRET; if (secret) { … 401 }` → si la env var no está seteada, **no hay auth** → `src/app/api/compliance/sync/route.ts:19-25`. Como la ruta está en la allowlist, el endpoint queda **abierto**.
- **Regla fail-closed obligatoria:** `if (!secret || auth !== \`Bearer ${secret}\`) return 401`. Centralizar en un helper `requireCronAuth()` reutilizado por `compliance/sync`, `comercial/contratos/sync`, `clientify/sync-contacts`, `whatsapp/send`.
- Comparar el Bearer con **`crypto.timingSafeEqual`**, no `!==` (hoy `compliance/sync` y `whatsapp/send` usan `!==`).

### Middleware / Allowlist (A05)
- La allowlist `isPublic` define las rutas sin sesión (login/auth, webhooks, `tracking/ingest`, `compliance/sync`) → `src/lib/supabase/middleware.ts:60-82`. **Agregar a la allowlist es una decisión de seguridad:** solo lo estrictamente necesario, y cada alta debe tener su propio guard en el handler.
- ⚠️ **Demo mode = bypass total:** `if (!env.supabase.configured || env.app.demoMode) return response;` → `src/lib/supabase/middleware.ts:17-20`. **Prohibir `NEXT_PUBLIC_DEMO_MODE=1` en producción.**
- El middleware solo valida **autenticación**, no rol → la autorización fina vive en page / server-action / RPC (`src/middleware.ts`).

### RLS / RBAC / Service Role (A01)
- RLS es la frontera real de datos; `current_role()` autoritativo desde `profiles` (no del JWT) (G10).
- ⚠️ **RBAC dormido / fail-open:** si `totalAssignments === 0` y `RBAC_ENFORCE != 1` → `checkPermission` retorna `ok:true` → `src/lib/rbac/check.ts:147-182`, `src/lib/env.ts:62`. **Activar RBAC es system-wide:** seedear roles + permisos + asignaciones (incluida Presidencia/super_admin) **antes** de `RBAC_ENFORCE=1`, o deja sin acceso. Requiere plan aprobado por Dirección.
- **`service_role` solo backend**, para persistir vía RPC `SECURITY DEFINER`; **nunca para autorizar** (en RBAC se usa solo para seed-count `head=true`). Nunca al cliente (G9).

### Secrets (A05 / G9)
- `.env.local` nunca commiteado; nunca imprimir valores; clave X.509 ARCA host-only.
- Secret-scan de Netlify bloqueante: remover + **rotar** el secreto real (no solo enmascarar).
- ARCA no filtra secretos en logs (`maskSecret`) → `src/lib/arca/logger.ts:31-34`.

### Webhooks / HMAC (A08)
- ⚠️ **WhatsApp/Meta NO verifica HMAC:** el POST acepta cualquier body y lo loguea → `src/app/api/whatsapp/webhook/route.ts:29-39` (verificación `X-Hub-Signature-256` es TODO). **Regla: validar HMAC con `app_secret` + `timingSafeEqual` antes de procesar** (crítico cuando F3 persista en DB).
- **Patrón correcto a imitar (Clientify):** token-en-URL comparado con `timingSafeEqual`, **fail-closed** si falta el secret → `src/lib/clientify/webhook.ts:16-35`.
- ⚠️ **Confirmado por grep:** `X-Hub-Signature` / `createHmac` / `app_secret` = **0** en `src/`; `timingSafeEqual` solo en `clientify/webhook.ts`.
- Tracking ingest compara token con `!==` (no timing-safe) → `src/app/api/tracking/ingest/route.ts:82-83`.

### OWASP / Hardening
- ⚠️ **Sin CSP:** hay X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy (`next.config.mjs:30-43`) y HSTS (`netlify.toml:43-51`), pero **ninguna Content-Security-Policy** (`grep`=0) (= P2.3 del plan de remediación).
- **Rate limiter in-memory** no distribuido (evadible en serverless) → `src/lib/rate-limit.ts:5-15`.

### Auditoría (apoyarse en los audits vivos del repo)
- `docs/handoff/SECURITY_HARDENING_AUDIT.md` (Gate 5.5: F-01-R PII de `profiles` P1; F-04 `/settings/roles*` sin guard P1).
- `docs/handoff/SECURITY_REMEDIATION_PLAN.md` (P0.1 cerrar PII de `profiles` vía RLS / vista `profiles_public`; P0.2 guard de rol; P0.3 DEV/PROD + PITR + backup Storage).
- `docs/ARCA-SECURITY-AUDIT.md` (aprobado), `docs/DRIVE-PREFLIGHT-AUDIT.md` (H1 público corregido el 2026-05-29).

## Mapa OWASP (de los hallazgos reales)
| OWASP | Hallazgo en TOPS NEXUS |
|---|---|
| A01 Broken Access Control | RBAC dormido fail-open; allowlist; IDOR mitigado por RLS |
| A05 Misconfiguration | cron fail-open; demo mode bypass; sin CSP |
| A07 Auth Failures | comparación no timing-safe; CRON_SECRET ausente |
| A08 Integrity | webhook WhatsApp sin HMAC |
| A09 Logging | sin error tracking → derivar a `observability-tops-nexus` |

## Comandos sugeridos (todos de solo lectura / diagnóstico)
```bash
grep -rn "if (secret)" src/app/api/                       # detectar guards fail-open de cron
grep -rn "X-Hub-Signature\|createHmac\|timingSafeEqual" src/   # cobertura de verificación de firma
grep -rn "content-security-policy" next.config.mjs netlify.toml src/   # confirmar ausencia de CSP
grep -rn "isPublic" src/lib/supabase/middleware.ts        # revisar la allowlist
```
> Estos comandos son de diagnóstico. Cualquier fix (fail-closed, HMAC, activar RBAC, setear/rotar
> secrets) se **entrega como diff staged**; lo ejecuta/deploya Martín (G1). Setear o rotar secrets en
> Netlify y activar RBAC son acciones de Dirección, no del asistente.

## Checklist de cierre
- [ ] Cron fail-**closed** + `timingSafeEqual`.
- [ ] Webhooks con HMAC (Meta) o token timing-safe (patrón Clientify).
- [ ] Alta de allowlist justificada + guard propio en el handler.
- [ ] Demo mode prohibido en producción.
- [ ] RBAC: plan de seed completo antes de `RBAC_ENFORCE=1`.
- [ ] `service_role` solo backend; nunca al cliente.
- [ ] Secrets sin commitear y rotados si se expusieron.
- [ ] Verificado con **evidencia real** (G5), no por inspección de código.

## Relación con las otras skills (sin duplicar)
- `security` = *frontera y hardening* (auth, RLS-como-defensa, webhooks, secrets, OWASP).
- Se apoya en **postgres-tops-nexus** para escribir las policies RLS / RPC `SECURITY DEFINER`.
- Se apoya en **devops-tops-nexus** para setear/rotar secrets y el fail-closed de crons.
- Deriva la parte de logging/alertas a **observability-tops-nexus**.

## Ejemplos de prompts internos
- *"Convertí el guard de cron de fail-open a fail-closed en `api/compliance/sync`, `api/comercial/contratos/sync`, `api/clientify/sync-contacts` y `api/whatsapp/send` con un helper `requireCronAuth()` + `timingSafeEqual`. Entregá diffs staged; no apliques ni deploys."*
- *"Diseñá la verificación HMAC `X-Hub-Signature-256` para el webhook de WhatsApp imitando el patrón timing-safe de `clientify/webhook.ts:16-35`. Entregá diff staged."*
- *"Armá el plan de activación de RBAC: seed completo de roles+permisos+asignaciones (incl. Presidencia) y recién después `RBAC_ENFORCE=1`. Presentalo a Dirección; no lo actives."*
