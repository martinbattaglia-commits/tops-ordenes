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
