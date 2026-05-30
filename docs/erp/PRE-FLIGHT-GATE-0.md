# PRE-FLIGHT · GATE 0

**Fecha:** 2026-05-29
**Scope:** evaluación consolidada de las 4 pre-condiciones operativas requeridas para autorizar ETAPA 1 (Schema + Data Layer FASE 1A).
**Estado:** 🔴 **GATE 0 NO CIERRA** (2 FAIL bloqueantes)
**Modo:** verificación · sin modificar nada · evidencia trazable a archivos + memoria persistente.

---

## 1 · Tabla solicitada — resultados objetivos

| Precondición | Estado | Reporte detallado |
|--------------|--------|---------------------|
| Backup | 🔴 **FAIL** | `PRE-FLIGHT-BACKUP-REPORT.md` |
| RBAC | 🔴 **FAIL** | `PRE-FLIGHT-RBAC-REPORT.md` |
| Sandbox | 🟢 **PASS** | `PRE-FLIGHT-SANDBOX-REPORT.md` |
| Supabase CLI | 🟢 **PASS** (con observación) | `PRE-FLIGHT-SUPABASE-CLI.md` |

---

## 2 · Regla aplicada

> "Solo si: Backup PASS · RBAC PASS · Sandbox PASS · Supabase CLI PASS, podremos evaluar la autorización de ETAPA 1 — Schema + Data Layer"

**Resultado de evaluación:**
- Backup: 🔴 FAIL → regla NO cumple
- RBAC: 🔴 FAIL → regla NO cumple
- Sandbox: 🟢 PASS
- Supabase CLI: 🟢 PASS

**GATE 0 NO CIERRA.** ETAPA 1 **NO autorizada todavía**.

---

## 3 · Resumen ejecutivo de cada pre-condición

### 🔴 P0.1 — Backup externo Supabase

**Status:** FAIL

**Evidencia clave:**
- `(Sin backup externo = RP6)` — declaración explícita en memoria persistente del proyecto
- 0 scripts de backup en `scripts/`
- 0 env vars de S3/GCS para backup
- 0 documentación de cron de backup
- Supabase Pro PITR built-in (7 días) **NO sustituye** backup externo

**Riesgo si se ignora:** pérdida total de datos ante incidente Supabase / billing / operador con service_role. Incumplimiento de retention 10 años AFIP.

**Remediación propuesta:** Opción A — pg_dump diario → S3 vía GitHub Action. Costo <$1/mes. Tiempo: 1-2 días.

### 🔴 P0.2 — RBAC seedeado para Director + Admin

**Status:** FAIL (trivial fix)

**Evidencia clave:**
- Catálogo completo: ✅ 7 roles + 22 permisos + 64 mapeos
- **`user_roles` = 0** (RBAC dormido)
- Script `seed-rbac-real-roles.sql` declara explícitamente: "NO incluye INSERT a user_roles"

**Riesgo si se ignora:** R22 fail-open continúa en producción — **cualquier usuario autenticado bypasa permisos billing.** Bloqueante crítico para FASE 1A.

**Remediación propuesta:** ~30 min de SQL parametrizado para insertar 2 rows (JL → director, Ruth → administracion) en `user_roles`. SQL diseñado, requiere validación de emails + sandbox testing + aprobación + ejecución supervisada.

### 🟢 P0.3 — Sandbox Supabase separado

**Status:** PASS

**Evidencia clave:**
- Proyecto sandbox identificado: `vrxosunxlhohmqymxots` ("tops-nexus-staging")
- Proyecto producción identificado: `arsksytgdnzukbmfgkju`
- CLI actualmente linked a sandbox (safety by default)
- Ambos refs en `.env.local` con nombres claros (`STAGING_PROJECT_REF`, `SUPABASE_PROJECT_REF`)

**Observaciones para ETAPA 1:**
- Validar drift de schema sandbox vs prod antes de aplicar 0014
- Documentar runbook de switching prod↔sandbox
- Sandbox stale no rompe nada inmediato pero limita realismo de tests

### 🟢 P0.4 — Supabase CLI configurado

**Status:** PASS (con observación)

**Evidencia clave:**
- CLI v2.101.0 instalado en `/opt/homebrew/bin/supabase`
- Linked al sandbox
- `SUPABASE_ACCESS_TOKEN` configurado
- Tracker `schema_migrations` sincronizado a 0001-0009 (PARIDAD-3 GATE B closure)
- Migration repair ejecutado con éxito previamente

**Observación (no bloqueante):**
- `supabase/config.toml` ausente — CLI funciona pero pierde IaC
- Recomendado: `supabase init` para generarlo (opcional, no bloquea ETAPA 1)

---

## 4 · Plan de remediación consolidado

### 4.1 Trabajo requerido para cerrar GATE 0

| # | Pre-cond | Acción | Estimación | Responsable | Bloqueante para |
|---|----------|--------|------------|--------------|------------------|
| 1 | P0.1 Backup | Implementar pg_dump diario → S3 + restore test | 1-2 días | DevOps | ETAPA 1 |
| 2 | P0.1 Backup | Documentar runbook restore | 0.5 día | DevOps | ETAPA 1 |
| 3 | P0.2 RBAC | Confirmar emails reales JL + Ruth en prod | 5 min | Usuario | Acción #4 |
| 4 | P0.2 RBAC | Ejecutar `seed-rbac-real-roles.sql` si catálogo falta | 5 min | DBA + Usuario | Acción #5 |
| 5 | P0.2 RBAC | Aplicar 2 INSERT en `user_roles` (sandbox + prod) | 15 min | DBA + Usuario | ETAPA 1 |
| 6 | P0.2 RBAC | Validar accesos funcionales | 10 min | Usuario | ETAPA 1 |
| 7 | P0.4 CLI | Opcional: `supabase init` para config.toml | 5 min | Dev | (no bloquea) |
| 8 | P0.3 Sandbox | Opcional: refrescar sandbox con snapshot prod | 30 min | DevOps | (no bloquea) |

**Total trabajo bloqueante:** 1-2 días calendario + ~1 hora de coordinación de Usuario.

### 4.2 Orden recomendado

1. **Día 1:**
   - Usuario confirma emails reales JL + Ruth
   - DBA + Usuario ejecutan RBAC seed (sandbox → validación → prod)
   - Re-generar `PRE-FLIGHT-RBAC-REPORT.md` como PASS

2. **Día 1-2:**
   - DevOps implementa pg_dump → S3 (GitHub Action o Netlify Scheduled Function)
   - DevOps ejecuta primer backup
   - DevOps documenta runbook restore
   - DevOps ejecuta restore test en sandbox
   - Re-generar `PRE-FLIGHT-BACKUP-REPORT.md` como PASS

3. **Día 2-3:**
   - Re-evaluar GATE 0 — si los 4 son PASS → cerrar GATE 0 → autorizar evaluación de ETAPA 1

### 4.3 Lo que NO se requiere para cerrar GATE 0

- ❌ `config.toml` no es bloqueante (observación menor)
- ❌ Refresh sandbox no es bloqueante (recomendado pero no obligatorio)
- ❌ Otros usuarios (operaciones, deposito) NO necesitan seedeo para FASE 1A
- ❌ Validación de 0010/0011 NO bloquea (independiente de ETAPA 1)

---

## 5 · Riesgos identificados durante el pre-flight

| ID | Riesgo | Severidad | Plan |
|----|--------|-----------|------|
| GATE0.R1 | Backup externo demora >2 días por blockers organizacionales | media | escalación a JL si Día 3 sin avance |
| GATE0.R2 | Emails reales JL/Ruth no coinciden con auth.users prod | baja | confirmación con SELECT antes de SQL |
| GATE0.R3 | Sandbox tiene schema drift vs prod → tests mienten | media | runbook de refresh + checklist comparativo |
| GATE0.R4 | RBAC seed afecta sesiones activas | baja | regla del seed: "NO afecta sesiones activas" (declarado en script) |
| GATE0.R5 | pg_dump tiene tamaño explosivo (no crítico hoy con datos chicos) | baja | monitor S3 bucket size mensual |
| GATE0.R6 | Operador linkeado a prod ejecuta comando peligroso por confusion | media | banner + alias propuestos en P0.4 report |

---

## 6 · Decisión final

# 🔴 GATE 0 NO CIERRA

**Razón:** 2 pre-condiciones bloqueantes en FAIL (Backup, RBAC).

**ETAPA 1 — Schema + Data Layer queda NO AUTORIZADA** hasta que las 4 pre-condiciones estén en PASS verificable.

**Acción siguiente requerida del usuario:**

1. **Revisar los 4 reportes detallados** (`PRE-FLIGHT-BACKUP/RBAC/SANDBOX/SUPABASE-CLI.md`)
2. **Decidir plan de remediación** para P0.1 (backup) y P0.2 (RBAC)
3. **Asignar responsables** y plazos
4. **Coordinar ejecución** de las acciones bloqueantes
5. **Solicitar re-evaluación de GATE 0** cuando los 4 pasen a PASS

---

## 7 · Estado oficial post-GATE 0

| Flag | Estado |
|------|--------|
| Documentación ERP Billing FASE 1A/B/C | 🟢 BASELINE OFICIAL |
| ETAPA 0 — Pre-flight verificada | 🟢 COMPLETADA |
| Backup externo | 🔴 **NO IMPLEMENTADO** |
| RBAC seedeado prod | 🔴 **NO SEEDEADO** |
| Sandbox separado | 🟢 EXISTE |
| Supabase CLI | 🟢 FUNCIONAL |
| GATE 0 | 🔴 **NO CIERRA** |
| ETAPA 1 — Schema + Data Layer | 🟡 NO AUTORIZADA |
| Migration 0014 | 🟡 NO AUTORIZADA |
| Implementación funcional | 🟡 NO AUTORIZADA |
| Deploy / Merge / Push / Commit | 🟡 NO AUTORIZADO |
| Producción | 🟡 NO TOCAR |

---

## 8 · Documentos generados en ETAPA 0

| # | Documento | Tamaño |
|---|-----------|--------|
| 1 | `docs/erp/PRE-FLIGHT-BACKUP-REPORT.md` | ~6.3 KB |
| 2 | `docs/erp/PRE-FLIGHT-RBAC-REPORT.md` | ~7.8 KB |
| 3 | `docs/erp/PRE-FLIGHT-SANDBOX-REPORT.md` | ~6.2 KB |
| 4 | `docs/erp/PRE-FLIGHT-SUPABASE-CLI.md` | ~7.1 KB |
| 5 | `docs/erp/PRE-FLIGHT-GATE-0.md` (este) | — |

**Total ETAPA 0:** ~28 KB documentación verificada.

---

## 9 · Restricciones honradas

- 🛑 NO IMPLEMENTAR · NO MIGRAR · NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO TOCAR producción · sandbox · credenciales · Drive · ARCA · RBAC enforcement
- 🛑 NO MODIFICAR documentos aprobados FASE 1A/B/C ni script de RBAC seed
- 🛑 NO EJECUTAR comandos CLI (sólo identificados como propuestas)
- 🛑 NO EJECUTAR SQL (sólo diseñado)
- 🛑 NO INVENTAR — cada estado trazado a evidencia verificable (filesystem, .env.local, memoria persistente, supabase/.temp/, output de `which`/`--version`/`ls`)

---

## 10 · Cierre

GATE 0 verificó **honestamente** las 4 pre-condiciones con evidencia trazable. Resultado:

- 2 PASS (Sandbox, CLI) — diseño operativo del proyecto ya cubrió estas necesidades
- 2 FAIL (Backup, RBAC) — ambos identificados, ambos con plan de remediación, ambos fixables en <2 días

**El sistema NO está roto. Solo falta infraestructura operativa que es independiente del código.** Una vez resuelta, el camino hacia ETAPA 1 está limpio.

**Esperando decisión y coordinación del usuario para arrancar remediación de FAILs.**
