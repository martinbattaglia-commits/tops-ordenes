---
name: observability-tops-nexus
description: >-
  Observabilidad de TOPS NEXUS: logging estructurado JSON, error tracking (Sentry/APM),
  health checks, cron monitoring, smoke tests post-deploy y alertas operativas. Usar al agregar
  telemetría, integrar Sentry, crear /api/health, añadir notify-on-failure a crons, diseñar
  alertas o investigar un incidente de producción. Estado actual: el sistema casi no tiene
  observabilidad (predomina console.* y verificación manual); esta skill guía para cerrar ese gap.
  NO usar para tuning de performance (performance-tops-nexus) ni cambios de pipeline de deploy
  puros (devops-tops-nexus).
---

# observability-tops-nexus

> **Antes de actuar, leé y aplicá [`../_shared/GOVERNANCE.md`](../_shared/GOVERNANCE.md) (G1–G11).**

## Propósito
Cerrar el gap estructural de observabilidad. Hoy **no hay** error tracking (Sentry/Bugsnag/Datadog),
**no hay** `/api/health`, **no hay** alertas proactivas; solo `console.*` (~60 ocurrencias — medir
con `grep -rn 'console\.' src/ | wc -l` → 64 total / 59 fuera de loggers) y **2-3 loggers JSON**
acotados (`arca/logger.ts`, `drive/client.ts`, más `compliance/source.ts:56-57`). Estandarizar
telemetría real.

## Cuándo usarla
- Agregar logging/telemetría a un módulo.
- Integrar Sentry / APM / log shipper.
- Crear un `/api/health` (readiness/liveness).
- Añadir `notify-on-failure` a los crons que no lo tienen.
- Diseñar alertas operativas (5xx, latencia, caída de integración).
- Investigar un incidente de producción.

## Cuándo NO usarla
- Optimización de rendimiento → `performance-tops-nexus`.
- Cambios de deploy/CI puros → `devops-tops-nexus` (aunque el cron-monitoring se solapa).
- Feature de negocio sin componente de observabilidad.

## Reglas obligatorias (además de G1–G11)
- **Logs estructurados JSON one-line a stdout/stderr** (parseables por log shipper); seguir el patrón existente. → `src/lib/arca/logger.ts:36-41`; `src/lib/drive/client.ts:119-129`.
- **Nunca loguear secretos en claro.** Usar `maskSecret()` (solo longitud, nunca el valor). → `src/lib/arca/logger.ts:1-8,30-34` (G9).
- **Smoke test manual post-deploy obligatorio**; fallo crítico (login, módulo core caído, 500 generalizado) → ROLLBACK. → `docs/handoff/POST-DEPLOY-SMOKE-TEST.md:4,50-53`.
- **No remover el `notify-on-failure` del backup** (único alerting automático de cron) sin un reemplazo. → `.github/workflows/supabase-backup.yml:206-216`.
- **Honestidad del error boundary:** prohibido que la UI diga "el equipo técnico fue notificado" si no hay captura real. Bug a corregir. → `src/app/error.tsx:15` (solo `console.error`) vs `:26` (texto).

## Gaps a atacar (backlog priorizado, todos verificados)
1. **Sin error tracking de runtime** — cero deps de APM en `package.json`; solo comentarios-marcador (`error.tsx:14`, `drive/client.ts:103,106`).
2. **Sin `/api/health`** — el árbol `src/app/api/*` no lo tiene (hay pings por integración, no agregado).
3. **Logging fragmentado** — ~60 `console.*` texto libre; solo ARCA, Drive y `compliance/source.ts` emiten JSON one-line (3 patrones ad-hoc a unificar).
4. **Crons sin alerta** — `compliance-drive-sync.yml` y `contratos-drive-sync.yml` **no** tienen notify-on-failure; si fallan, nadie se entera.
5. **Errores `(non-blocking)` tragados** — email/upload/sync/audit_log se loguean y se ignoran, invisibles sin leer logs de Netlify (`orders/new/actions.ts:184,217,240,312`).
6. **Sin log shipper / retención / búsqueda** — todo depende de logs efímeros de Netlify.
7. **Sin heartbeat/dead-man-switch** del backup (solo avisa si corre y falla, no si deja de correr).

## Comandos sugeridos
```bash
gh run list --workflow=supabase-backup.yml      # ¿último backup verde?
gh issue list --label backup                    # alertas de fallo de backup
gh run list --workflow=compliance-drive-sync.yml
gh run list --workflow=contratos-drive-sync.yml
grep -rn 'console\.\(error\|warn\)' src/        # inventario de logging no estructurado
curl -sS -o /dev/null -w '%{http_code}\n' https://tops-ordenes.netlify.app/   # smoke disponibilidad
```

## Checklist de validación
- [ ] ¿Logs JSON estructurados, sin secretos en claro?
- [ ] ¿Error tracking **realmente** conectado (no un comentario-marcador)?
- [ ] ¿`/api/health` responde y verifica dependencias?
- [ ] ¿Crons con `notify-on-failure`?
- [ ] ¿Alertas operativas definidas (umbral + canal)?
- [ ] ¿Smoke post-deploy corrido con evidencia?
- [ ] ¿`error.tsx` dice la verdad sobre la notificación?

## Criterios de cierre
- Telemetría verificada con **evidencia real** (un error de prueba aparece en Sentry / la alerta dispara), no por inspección de código (G5).
- `error.tsx` honesto.
- Una falla de cron simulada produce una alerta real.

## Ejemplos de prompts internos
- *"Diseñá la integración Sentry: `instrumentation.ts` + wrapper de route handlers + reemplazar el comentario-marcador de `error.tsx:14` por captura real, respetando `maskSecret` (sin exponer secretos). Entregá plan + diffs staged; no apliques ni deploys."*
- *"Agregá `notify-on-failure` (issue P0) a `compliance-drive-sync.yml` y `contratos-drive-sync.yml`, replicando el step de `supabase-backup.yml:206-216`."*
- *"Diseñá `/api/health` liviano que verifique Supabase + versión; documentá cómo lo consumiría un monitor externo."*
