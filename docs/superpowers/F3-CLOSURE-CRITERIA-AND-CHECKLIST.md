# F3 · Criterio Formal de Cierre + Checklist para Dirección

> Define las condiciones para declarar **F3 (Nexus Link) formalmente CERRADA** y provee la checklist de aprobación para Dirección.
> Referencias: `F3-2B-PROD-DEPLOY-REPORT.md`, `F3-PILOT-VALIDATION-RUNBOOK.md`, `F3-2B-NON-BLOCKING-DEBTS.md`.
> Estado a la fecha de este documento: **2026-07-01** (post-deploy, pre-piloto).

---

## 1. Criterio formal de cierre de F3

F3 se declara **CERRADA** únicamente cuando **todos** los siguientes criterios están en estado **Completo**:

| # | Criterio | Cómo se verifica |
|---|---|---|
| K1 | Producción en `88add4b` | `/api/version` → `version=88add4b`, `environment=production` |
| K2 | Nexus Link visible y operativo | `/connect` y subrutas renderizan para usuarios habilitados |
| K3 | Smoke técnico verde | 0 5xx, fail-closed OK, APIs correctas (ver reporte §3–§5) |
| K4 | Piloto interno validado | 7 usuarios habilitados completan el runbook con resultado APROBADO |
| K5 | 0 críticos | Sin errores críticos de consola/servidor (más allá de deudas conocidas no críticas) |
| K6 | 0 regresiones | Rutas preexistentes no rompen para ningún rol |
| K7 | RBAC correcto | Acceso por rol según matriz; fail-closed; edit acotado correcto |
| K8 | Rollback no requerido | No fue necesario revertir a `c310589` |
| K9 | Reporte final archivado | `F3-2B-PROD-DEPLOY-REPORT.md` en `docs/superpowers/` |
| K10 | Deudas no bloqueantes registradas y aceptadas | `F3-2B-NON-BLOCKING-DEBTS.md`; Dirección toma nota de deuda B (RBAC) |
| K11 | **Dirección aprueba el cierre** | Firma en la checklist §3 |

> **Nota:** Las deudas no bloqueantes (hydration shell; RBAC `seguridad→knowledge.edit`) **no impiden** el cierre, siempre que estén registradas (K10) y Dirección tome nota.

---

## 2. Estado actual de los criterios (2026-07-01, pre-piloto)

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| K1 | Producción en `88add4b` | ✅ **Completo** | `/api/version`=88add4b |
| K2 | Nexus Link visible/operativo | ✅ **Completo** | screenshots `/connect`, `/connect/canales` |
| K3 | Smoke técnico verde | ✅ **Completo** | 0 5xx / fail-closed (reporte §3–§5) |
| K4 | Piloto interno validado | ⏳ **Pendiente** | ejecutar `F3-PILOT-VALIDATION-RUNBOOK.md` |
| K5 | 0 críticos | 🟡 **Parcial** | 0 críticos técnicos; pendiente confirmación en piloto |
| K6 | 0 regresiones | 🟡 **Parcial** | fail-closed OK; render por rol pendiente en piloto |
| K7 | RBAC correcto | 🟡 **Parcial** | modelo validado read-only; comportamiento por rol pendiente en piloto |
| K8 | Rollback no requerido | ✅ **Completo** | no ejecutado |
| K9 | Reporte final archivado | ✅ **Completo** | `F3-2B-PROD-DEPLOY-REPORT.md` |
| K10 | Deudas registradas/aceptadas | 🟡 **Parcial** | registradas ✅; aceptación de Dirección pendiente |
| K11 | Dirección aprueba cierre | ⏳ **Pendiente** | checklist §3 |

**Resumen:** el bloque técnico del deploy está **Completo**; el cierre depende de **K4 (piloto)**, la **aceptación de deudas (K10)** y la **aprobación de Dirección (K11)**.

---

## 3. Checklist de aprobación para Dirección

> Marcar el estado de cada ítem: **Pendiente** · **Completo** · **Bloqueado**. Agregar comentario donde aplique.

| # | Ítem a aprobar | Estado | Comentario Dirección |
|---|---|---|---|
| D1 | Confirmo que producción está en `88add4b` y estable | ☐ Pendiente / ☐ Completo / ☐ Bloqueado | |
| D2 | Confirmo que Nexus Link es visible/operativo para el piloto | ☐ Pendiente / ☐ Completo / ☐ Bloqueado | |
| D3 | Apruebo la ejecución del **piloto** con los 7 usuarios habilitados | ☐ Pendiente / ☐ Completo / ☐ Bloqueado | |
| D4 | Acepto la **deuda A** (hydration shell) como no bloqueante | ☐ Pendiente / ☐ Completo / ☐ Bloqueado | |
| D5 | Tomo nota de la **deuda B** (`seguridad→knowledge.edit`) y decido: ☐ mantener / ☐ revocar (en ventana posterior) | ☐ Pendiente / ☐ Completo / ☐ Bloqueado | |
| D6 | Confirmo resultado del piloto: ☐ Aprobado / ☐ Con observaciones / ☐ Rechazado | ☐ Pendiente / ☐ Completo / ☐ Bloqueado | |
| D7 | **Apruebo el CIERRE FORMAL de F3** | ☐ Pendiente / ☐ Completo / ☐ Bloqueado | |
| D8 | Autorizo (o no) el inicio de **F4**: ☐ Autorizo / ☐ No autorizo aún | ☐ Pendiente / ☐ Completo / ☐ Bloqueado | |

**Firma / fecha Dirección:** ________________________  ·  **Fecha:** __________

---

## 4. Regla de secuencia

- **F4 NO debe comenzar** hasta que D6 (piloto) esté Aprobado, D7 (cierre F3) esté Completo y D8 autorice explícitamente.
- Mientras tanto: sin push/merge/deploy/migraciones/cambios de código/DB/permisos, salvo autorización explícita por ítem.

---

## 5. Actualización de estado (2026-07-01, post-hotfix búsqueda)

- **F-SEARCH RESUELTO:** `connect_search` estaba roto (bug `42702` + bug `0A000`). Corregido con **migs `0156` + `0157` APLICADAS a prod** (autorizadas por Dirección). Búsqueda **operativa RPC + UI** (smoke aprobado). Commit local `d935640`.
- **Actualización de criterios técnicos:** K1 ✅ · K2 ✅ · K3 ✅ · **K5/K6 (0 críticos / 0 regresiones):** técnicos ✅ (search era el hallazgo crítico y quedó resuelto) — falta confirmación en piloto manual · **K7 (RBAC):** modelo validado + fail-closed app-layer ✅, con H-1 aceptado como deuda temporal · K8 (rollback) ✅ no requerido · K9 ✅ · K10 🟡 (deudas registradas; falta nota formal de Dirección) · **K4 (piloto) ⏳ PENDIENTE** · **K11 (aprobación Dirección) ⏳ PENDIENTE**.
- **Único camino restante a cierre:** ejecutar `F3-PILOT-MANUAL-VALIDATION-PACK.md` con los 7 usuarios → consolidar → Dirección acepta deudas (H-1, hydration shell, `seguridad→knowledge.edit`) + aprueba cierre (D6/D7) → autoriza F4 (D8).
- **Migraciones aplicadas en esta línea de trabajo:** `0156_fix_connect_search_ambiguous_conversation_id`, `0157_fix_connect_search_union_order_by` (ambas en `schema_migrations`). Deploy de UI NO revertido; producción en `88add4b`.
- 🚫 **F4 sigue BLOQUEADA.**

---

## 6. CIERRE FORMAL APROBADO (2026-07-01) — supera §2/§5

**Dirección aprobó el cierre de F3 tras validación manual autenticada con varios usuarios (PASS).**

- **Producción evolucionó de `88add4b` → `a6c23f9`** por los hotfixes del piloto (DEFECT-1..10). K1 se reinterpreta como "prod estable en `a6c23f9`".
- **Todos los criterios K1–K11: ✅ Completo.**

| Ítem Dirección | Resultado |
|---|---|
| D1 Producción estable | ✅ `a6c23f9` (`/api/version`=`a6c23f9`, 0 5xx) |
| D2 Nexus Link visible/operativo | ✅ |
| D3 Piloto ejecutado con usuarios | ✅ |
| D4 Deuda A (hydration) aceptada | ✅ |
| D5 Deuda B (`seguridad→knowledge.edit`) | ✅ tomada nota (revisar en ventana posterior) |
| D6 Resultado del piloto | ✅ **APROBADO** |
| D7 **CIERRE FORMAL de F3** | ✅ **APROBADO** |
| D8 Inicio de F4 | ✅ **AUTORIZADO** (solo planificación / kickoff) |

- **Defects resueltos y en prod:** F-SEARCH + DEFECT-1..10 (ver `F3-FINAL-CLOSURE-REPORT.md` §3).
- **Migraciones prod:** `0156/0157/0158/0159`.
- **Deudas no bloqueantes** (A, B, H-1, R-2, R-3, F-1, F-3) registradas y aceptadas — no impiden el cierre.
- **🏁 F3 CERRADA.** **F4 ABIERTA solo en fase de planificación** (`F4-KICKOFF-SCOPE-PLAN.md`); sin desarrollo hasta Master Plan aprobado.
