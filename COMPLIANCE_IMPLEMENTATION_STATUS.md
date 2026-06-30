# COMPLIANCE_IMPLEMENTATION_STATUS

> Documento de estado único del rediseño del modelo de Compliance (estado administrativo / riesgo / semáforo).
> Pensado para que **cualquier desarrollador retome el trabajo sin contexto previo**.
> **Fecha de cierre de iteración**: 2026-06-30.
>
> ⚠️ **Proyecto Supabase autorizado (ÚNICO): `arsksytgdnzukbmfgkju`** (`https://arsksytgdnzukbmfgkju.supabase.co`). Los proyectos de Integración (`frcpzfeacejccerqwnqq`, `jyiygusacxbdosfkptci`, `bmrtlojmqmkuirhuzhyt`) fueron **DESCARTADOS** por incidente de infraestructura; eliminación solicitada a soporte. Las menciones en §9-R2/§10 son **registro histórico** — NO usar. El camino a prod es el **Plan de Integración** (transplante de Compliance sobre el commit desplegado en prod), no un entorno de Integración dedicado.

---

## 1. Resumen ejecutivo

Se rediseñó el modelo de **Compliance** de TOPS NEXUS para que el semáforo del cockpit (`/anmat`) refleje el **verdadero estado regulatorio** y no sólo la fecha de vencimiento. Se incorporó el estado **🟠 "En trámite administrativo"**, una **máquina de estados**, una **planilla central** como fuente primaria de verdad, **trazabilidad de evidencias**, y la separación estricta **Estado→color / Riesgo→prioridad / Semáforo=computado**.

- **Implementación: COMPLETA y revisada** (subagent-driven: implementador + revisor por tarea + review final de rama con modelo más capaz, que halló y corrigió 2 bugs reales).
- **Calidad**: `typecheck` 0 errores · `lint` 0 errores · **suite 309/309** (49 archivos) · **batería de regresión permanente 12/12**.
- **Estado de entrega**: TODO **aislado** en worktree/rama. **Nada aplicado a prod, nada mergeado, nada pusheado, sin PR, sin deploy, migración sin aplicar.**
- **Pendiente**: una **auditoría funcional E2E desde la UI** quedó **bloqueada por una incidencia de provisioning de Supabase** (no de Nexus). El paquete para correrla está listo (ver §11).
- **Caso testigo**: `MAG-04` (CAA Nación – Generador R. Peligrosos, `EX-2023-116887453`), vencido, con trámite activo → debe verse **🟠 "En trámite administrativo"**, nunca 🔴, mientras exista caso regulatorio activo.

---

## 2. Arquitectura implementada

**Patrón**: el color (semáforo) es **computado en runtime** a partir de (eje temporal por fecha) + (estado administrativo del caso activo). El nivel de riesgo NO participa del color (sólo prioridad).

**Unidades puras** (`src/lib/compliance/`):
- `semaforo.ts` — `temporalOf()`, `resolveAnticipacion()` (jerarquía override→config→default), `computeSemaforo(temporal, estado)` (**sin parámetro de riesgo**), `alertSeverity(nivel, semaforo)`.
- `cases/types.ts` — enums/tipos (`EstadoAdministrativo`, `Etapa`, `NivelRiesgo`, `Semaforo`=alias de `Riesgo`, `Origen`, `Confianza`, `Temporal`, `ComplianceCase`, `ComplianceCaseLite`).
- `cases/normalize.ts` — diccionario de normalización (sinónimo→canónico), extensible por datos.
- `cases/transitions.ts` — máquina de estados (`TRANSICIONES`, `canTransition`).
- `cases/sheet.ts` — parser CSV determinístico de la planilla (`parseCsv`, `parseEstadoSheet`).
- `cases/sync.ts` — `syncCasesFromSheet()` (Paso 0 del cron) + `planCaseChanges()` (valida transición) + `evidenceFor()` (registra evidencia). Sólo `confianza=confirmada` escribe estado.

**Integración**:
- `data.ts` — `deriveComplianceStatus(item, today?, anticConfig?)` usa el caso activo; `RISK_LABEL` (🟠="En trámite administrativo", 🟡="Próximo a vencer"); `executiveKpis()` con KPI "En trámite administrativo". **El campo `item.riesgo` SIGUE siendo el color** (no se renombró; lo consumen ~25 sitios); `nivelRiesgo` es campo NUEVO separado.
- `source.ts` — adjunta el caso activo a cada ítem (degradación grácil si la tabla no existe).
- `sync/engine.ts` — cron: **Paso 0** lee la planilla primero; `rebuildAlerts` usa la cascada + severidad por riesgo; emite alertas `kind='review'` por evidencia secundaria (no muta estado).
- `components/compliance/ui.tsx` + `app/(app)/anmat/ComplianceMatrix.tsx` — `CaseChips` (estado/etapa/riesgo/origen/confianza).

**Flujo del cron** (GitHub Action `0 0 * * *` = 21:00 ART → `POST /api/compliance/sync`, Bearer `CRON_SECRET`): Paso 0 (planilla `00_ESTADO_COMPLIANCE` vía `exportGoogleFile` CSV → valida transiciones → upsert `compliance_cases` + evidencias) → walk de Drive (docs → alertas `review`, sin mutar estado) → `rebuildAlerts`.

---

## 3. Decisiones de diseño adoptadas

| # | Decisión |
|---|---|
| D1 | Entidad dedicada `compliance_cases` + cascada refactorizada. |
| D2 | `00_ESTADO_COMPLIANCE` = Google Sheet central (una fila por caso), leída por el cron (CSV, determinístico). |
| D3 | Entidad genérica `compliance_cases`; `expediente_nro` **opcional**. |
| D4 | Planilla = fuente **primaria pero no única**; docs/correos/archivos sólo generan alertas de revisión, **no mutan estado**. |
| D5 | **Estado / Riesgo / Semáforo** independientes. |
| D6 | Anticipación 🟡 **parametrizable** (override ítem → config por frecuencia → default). |
| D7 | **El riesgo NUNCA cambia el color** (sólo prioridad/orden/filtros/alertas/escalado). |
| D8 | Estado transitorio **`pendiente_emision`** (aprobado sin certificado nuevo) → 🟡; vuelve a 🟢 sólo con `vencimiento` nuevo. |
| D9 | **Diccionario de normalización** por datos (`compliance_normalizacion`), extensible sin tocar el motor. |
| D10 | **Confianza en 2 dimensiones**: `origen` + `confianza`. Sólo `confianza=confirmada` escribe estado. |
| D11 | **Máquina de estados**: transición inválida **no se aplica** (se conserva el estado previo + alerta `review`). |
| D12 | **Evidencias** (`compliance_evidence`): respaldo de cada cambio de estado (origen, fecha, nivel de verificación, referencia). |
| D13 | Alcance iteración 1 = **Sheets + Drive + Compliance** (correos diferidos). |

---

## 4. Migraciones involucradas

| Migración | Rol | Estado en prod |
|---|---|---|
| `0065_compliance_core.sql` | `compliance_items` (+seed 33 ítems) | aplicada (fuera de banda; no figura en `list_migrations`) |
| `0081_compliance_drive_sync.sql` | `compliance_alerts/documents/sync_log/categories` + cols sync | aplicada (fuera de banda) |
| **`0141_compliance_cases.sql`** (NUEVA, de esta iteración) | `compliance_cases`, `compliance_evidence`, `compliance_anticipacion_config` (+seed), `compliance_normalizacion` (+seed); `compliance_items.anticipacion_dias`; alters de `compliance_alerts` (`origen`/`confianza`/`case_id`, CHECK `kind`+`review`, CHECK `nivel`+`info`) | **NO aplicada (gated)** |

**Numeración (landmine activo)**: la migración nació `0125`, se renumeró **`0125→0139→0141`** porque prod **ya tiene aplicada** la cadena Knowledge `0125_knowledge_module_enum … 0140_knowledge_kpis_admin` (incl. `0139_knowledge_adapter_rrhh`), verificado por `list_migrations` el 2026-06-30. La cadena Knowledge **crece en paralelo** (worktree no mergeado) ⇒ **RE-VERIFICAR el número con `list_migrations` y usar `max+1` en el momento exacto de aplicar.** Depende de `0081`.

---

## 5. Estado de la rama

- **Worktree**: `~/CODE/tops-ordenes/.claude/worktrees/feat+compliance-cases-semaforo`
- **Rama**: `worktree-feat+compliance-cases-semaforo` (aislada; nombre asignado por el harness)
- **Base**: `origin/main` @ `3ea0de1`
- **HEAD**: `e1345ba` (+ commit de cierre de esta iteración — ver §6)
- **Aislamiento**: sin merge, sin push, sin PR, sin deploy. La migración `0141` no se aplicó a ninguna base.

---

## 6. Commits relevantes (origin/main..HEAD)

| Commit | Qué |
|---|---|
| `6817db1` | spec + plan (diseño) |
| `6cb4548` | D11 máquina de estados + D12 evidencias + D13 alcance |
| `edcf54f` | migración (casos/config/diccionario/evidencias) |
| `1044954` | tipos | `2622eb5` diccionario | `966e9e8` motor semáforo | `1e22f28` máquina de estados | `e791d2c`(+`04a12c4` fix) parser |
| `82242fa` | `deriveComplianceStatus` (caso activo + anticipación) |
| `7c245f6` | **batería de regresión permanente (12 escenarios)** |
| `3981664` | KPIs | `c510f34` env | `d7db7f4` syncCasesFromSheet (D11+D12) | `7ac26a2` join caso activo | `c1913d9` cron Paso 0 + rebuildAlerts + review | `5cd97c4` UI CaseChips |
| `f8821d4` | fix lint (regla eslint inexistente) |
| `be7fe6c` | **fix review final**: nivel CHECK `+info`, review-alerts idempotentes, ternario |
| `91e96ca` / `e1345ba` | renumeración `0125→0139→0141` + runbook + sincronización docs |

---

## 7. Cobertura de tests

- **Suite total**: 309/309 (49 archivos). Compliance: 65/65 (9 archivos). `typecheck` 0, `lint` 0 errores.
- Unidades puras con TDD: `semaforo`, `normalize`, `transitions`, `sheet`, `sync` (planificadores), `derive`, `kpis`, `types`.
- Comando: `npx vitest run` (todo) / `npx vitest run src/lib/compliance` (módulo).

---

## 8. Batería de regresión (permanente)

`src/lib/compliance/derive.regression.test.ts` — **12 escenarios de negocio**, gate obligatorio del motor. Toda modificación futura del algoritmo DEBE pasarla. **No relajar ni borrar sin aprobación de Dirección.** Escenarios: vigente→🟢; próximo (anticipación)→🟡; vencido sin caso→🔴; vencido EN_TRAMITE→🟠; PRONTO_DESPACHO→🟠; PENDIENTE_EMISION→🟡; RECHAZADO→🔴; riesgo alto/crítico no cambia color; cambiar sólo riesgo ⇒ color idéntico; cambiar sólo estado ⇒ color cambia; **MAG-04 (EX-2023-116887453)→🟠 "En trámite administrativo"**.

---

## 9. Riesgos pendientes

- **R1**: la validación del **render real de la UI** (MAG-04 🟠 en pantalla) queda pendiente hasta correr el E2E vivo (bloqueado por infra). Mitigado por 309 tests + regresión 12/12 + smoke SQL listo.
- **R2**: los proyectos de Integración (`frcpzfeacejccerqwnqq`, `jyiygusacxbdosfkptci`, `bmrtlojmqmkuirhuzhyt`) quedaron **DESCARTADOS** — eliminación solicitada a soporte de Supabase. **NO usar** (sólo registro histórico del incidente). Único proyecto autorizado: **`arsksytgdnzukbmfgkju`**.
- **R3**: el entorno de Integración objetivo es el **slice de Compliance** (auth `0001` + `0065/0081/0141`), no un mirror completo de prod. Prod mezcla migraciones trackeadas con **DDL fuera de banda** (`compliance_items/alerts` existen pero no figuran en `list_migrations`), por eso un branch-desde-prod no es viable. Mirror total = follow-up vía `pg_dump --schema-only`.
- **R4 (numeración)**: la cadena Knowledge crece en paralelo; el número `0141` puede ser superado antes del merge → re-verificar `max+1` al aplicar (§4).

---

## 10. Incidente de infraestructura de Supabase

Al intentar montar un entorno aislado para el E2E, **3 provisionamientos quedaron estancados en `COMING_UP` en 2 regiones distintas**, mientras **prod (`arsksytgdnzukbmfgkju`) sigue `ACTIVE_HEALTHY`**:

| Recurso | Región | Resultado |
|---|---|---|
| Branch `compliance-e2e` (`frcpzfeacejccerqwnqq`) | sa-east-1 | >18 min, nunca levantó (eliminado) |
| Proyecto `tops-ordenes-integracion` (`jyiygusacxbdosfkptci`) | sa-east-1 | >24 min, trabado |
| Proyecto `tops-ordenes-integracion-use1` (`bmrtlojmqmkuirhuzhyt`) | us-east-1 | >12 min, trabado |

**Diagnóstico**: prod sano + 2 proyectos nuevos sin provisionar en 2 regiones ⇒ **incidencia a nivel cuenta/plataforma de Supabase** (asignación de compute para proyectos nuevos), **NO del proyecto Nexus ni del diseño**. Se aplicó la regla de corte de Dirección (detener al repetirse el comportamiento). **Estado**: los 3 proyectos de Integración quedaron **DESCARTADOS**; eliminación solicitada a soporte de Supabase. El desarrollo continúa **exclusivamente** sobre el proyecto oficial `arsksytgdnzukbmfgkju` (ver §11).

Detalle completo + línea base + acciones: `docs/superpowers/integration/2026-06-30-compliance-e2e-runbook.md`.

---

## 11. Procedimiento para llevar Compliance a producción (proyecto oficial)

> **Único proyecto autorizado: `arsksytgdnzukbmfgkju`.** NO crear proyectos/branches de Supabase. Requiere **autorización explícita de Dirección** antes de cualquier acción irreversible (merge/migración/deploy). El enfoque de "entorno de Integración dedicado" quedó **descartado** (ver §10/§9-R2).

1. **Identificar el commit desplegado en prod hoy** (read-only). Ver el **Plan de Integración** (`docs/superpowers/integration/`).
2. **Rama de integración**: crear una rama **desde ese commit** y **transplantar exclusivamente** el diff del módulo Compliance (NO la base vieja `3ea0de1`).
3. **Verificación sin regresión**: `npm run typecheck` + `npm run lint` + `npx vitest run` (objetivo 309/309 + regresión 12/12) sobre la rama de integración; confirmar que el diff toca **sólo** archivos de Compliance (sin tocar Fiscal/Knowledge/Connect/resto).
4. **Migración (gateada)**: re-verificar `max+1` con `list_migrations` en prod y aplicar **sólo** `0141_compliance_cases.sql`. Smoke test (runbook §3): confirmar CHECK `nivel` admite `info` y `kind` admite `review`.
5. **Deploy (gateado)**: build + deploy del commit de integración por el canal oficial (Netlify manual), con **plan de rollback**.
6. **Validación post-deploy** sobre el proyecto oficial: `/anmat` — MAG-04 → 🟠 "En trámite administrativo"; KPIs/semáforos/CaseChips; cron `?dry=1`. (En prod los casos reales se cargan vía la planilla `00_ESTADO_COMPLIANCE`; el seed de 6 casos del runbook §4 es para validación.)

**Referencias**: spec `docs/superpowers/specs/2026-06-29-compliance-cases-estado-riesgo-semaforo-design.md` · plan `docs/superpowers/plans/2026-06-29-compliance-cases-estado-riesgo-semaforo.md` · runbook `docs/superpowers/integration/2026-06-30-compliance-e2e-runbook.md` · **Plan de Integración** (informe entregado en esta sesión).

---

## 12. Confirmación de estado final

- ✅ Implementación **finalizada** (309/309, regresión 12/12, typecheck/lint 0).
- ✅ Rama **aislada** (`worktree-feat+compliance-cases-semaforo`, base `3ea0de1`).
- ✅ **Ningún cambio aplicado a producción** (prod sólo lecturas read-only de descubrimiento).
- ✅ **Ningún merge / push / PR**.
- ✅ **Ningún deploy**. Migración `0141` **sin aplicar**.
- ✅ Listo para **reanudar el E2E únicamente cuando Supabase normalice el provisioning** y con nueva autorización de Dirección.
