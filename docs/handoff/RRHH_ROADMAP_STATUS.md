# TOPS NEXUS — RRHH · ROADMAP STATUS (estado oficial)

> Snapshot de ejecución del programa RRHH. Documento de estado (no diseño, no código, no migraciones,
> no producción). Fuente de diseño: `RRHH_MASTER_ARCHITECTURE_v2_0.md`. **Fecha:** 2026-06-07.

---

## Estado del programa

```text
RRHH DEVELOPMENT COMPLETE
READY FOR E2E RUN
```

| Gate | Nombre | Migración / Artefacto | Commit | Estado |
|------|--------|------------------------|--------|--------|
| R1 | Permission Module | `0056_rrhh_permission_module` | `1dcd668` | ✅ **CLOSED** (verificado prod) |
| R2 | RBAC Foundation | `0057_rrhh_rbac_seed` | `d2e5cd9` | ✅ **CLOSED** (verificado prod) |
| R3 | Core Data Model | `0058_rrhh_core` | `bf8ca7e` | ✅ **CLOSED** (verificado prod) |
| R4 | Workflow Foundation | `0059_rrhh_workflows` | `ada9fd7` | ✅ **CLOSED** (verificado prod) |
| R5 | Documents & Storage | `0060_rrhh_documents_storage` | `9f02403` | ✅ **CLOSED** (POST_DEPLOY_AUDIT + E1–E12 PASS) |
| R6 | UI / Portal & Dashboard | UI (`src/lib/rrhh/*`, `src/app/(app)/rrhh/*`, Sidebar) | `043ae54` | 🟡 **READY FOR E2E** (implementado, typecheck 0 err, auditoría PASS) |

> **Orden de despliegue de migraciones:** `0056 → 0057 → 0058 → 0059 → 0060` (aplicadas en prod).

---

## Único pendiente
**R6 E2E EXECUTION** — según `RRHH_R6_E2E_EXECUTION_PLAN.md` (+ `RRHH_R6_PLAYWRIGHT_MATRIX.md` y
`RRHH_R6_MANUAL_VALIDATION_CHECKLIST.md`).

- **Dónde:** Preview / Staging (DB no productiva). **Nunca en producción** (los flujos de escritura
  persisten; tablas append-only).
- **Cierre R6:** Playwright en verde **+** checklist manual sin FAIL **+** cero fuga de PII.
- Tras R6 CLOSED: queda como **release separado** (D3) el build/deploy del frontend a producción.

---

## Pendientes no bloqueantes (Cross-Gate Hardening / diferidos)
- `requiere_doc` enforce en `aprobar_l2` (D3 de R5) — no tocar R4 sin gate dedicado.
- TRUNCATE guards en tablas append-only (R3 m1).
- Anti-ciclos de organigrama en el RPC de escritura de legajo.
- Check `doc_class ↔ bucket` salud (R5 m1).
- Recibos (`rrhh-receipts`) — gate de recibos posterior (D1 de R5).
- UX: toast de resultado de acciones; flujo de alta/upload admin de documentos; KPIs de
  ausentismo/saldo (gate de vistas `rrhh_v_*`).

---

## Restricciones vigentes
NO abrir R7 · NO diseñar R7 · NO código adicional RRHH · NO migraciones · NO tocar producción.

---
```text
RRHH

R1 CLOSED
R2 CLOSED
R3 CLOSED
R4 CLOSED
R5 CLOSED
R6 READY FOR E2E
```
*Estado oficial — a la espera de la ejecución del E2E en Preview/Staging.*
