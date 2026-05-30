# RBAC-GATE-CHECKLIST

**Bloqueante:** P0.2 (RBAC) · **Gate de aprobación ejecutiva**
**Fecha:** 2026-05-30
**Decisión a tomar:** ¿Se promueve el seed de `user_roles` a **PRODUCCIÓN**? → 🟢 GO / 🔴 NO-GO
**Documentos de respaldo:** `RBAC-SANDBOX-EXECUTION-PLAN.md` · `RBAC-READONLY-VALIDATION.md` · `scripts/seed-rbac-assign-users-OPCION-A.sql`
**Restricciones:** 🛑 NADA en esta checklist ejecuta SQL/usuarios/deploy. Es un instrumento de decisión.

---

## A · Estado de partida (verificado read-only · 2026-05-30)

| Ítem | Estado |
|------|--------|
| Catálogo RBAC (7 roles / 24 permisos) | ✅ seedeado y consistente (prod = sandbox) |
| `user_roles` (prod) | ⚪ 0 filas — RBAC **dormido** (fail-open) |
| `user_roles` (sandbox) | ⚪ 0 filas |
| Mapeo aprobado por Presidencia | ✅ Opción A: José Luis → `director_ops`, Ruth → `admin` |
| Script de seed preparado | ✅ `seed-rbac-assign-users-OPCION-A.sql` (bloques sandbox + prod) |
| Enforcement cableado | ⚠️ solo Drive API (`compliance.view`) — resto pendiente ETAPA 1 |
| Usuarios en prod | ✅ `joseluis@` + `ruth@` existen |
| Usuarios en sandbox | ❌ no existen (crear para el ensayo) |

---

## B · Gate 1 — Ensayo en SANDBOX (debe completarse ANTES de prod)

> Referencia: `RBAC-SANDBOX-EXECUTION-PLAN.md` §3–§4.

- [ ] **B1** · 3 usuarios de prueba creados en sandbox (`joseluis@`, `ruth@`, `test-norole@sandbox.local`)
- [ ] **B2** · Baseline dormido verificado: Drive → **200 `enforced:false`** + log `fallback-allow`
- [ ] **B3** · Bloque SANDBOX del script ejecutado → `SELECT` muestra **2 filas** correctas → `COMMIT`
- [ ] **B4** · `director_ops` → Drive **200 `enforced:true`**
- [ ] **B5** · `admin` → Drive **200 `enforced:true`**
- [ ] **B6** · usuario sin rol → Drive **403**
- [ ] **B7** · sin sesión → Drive **401**
- [ ] **B8** · Resolución: `compras.sign` ∈ director_ops ∧ ∉ admin (Director firma OC, admin no)
- [ ] **B9** · Resolución: `documental.admin`+`export` ∈ admin ∧ ∉ director_ops
- [ ] **B10** · Cero errores `500`/`query-failed`/`seed-count-failed` en logs durante el ensayo
- [ ] **B11** · `SUPABASE_SERVICE_ROLE_KEY` presente y `DEMO_MODE=0` confirmados en el contexto de prueba

**Gate 1:** ▢ 🟢 RBAC VALIDADO (sandbox) ▢ 🔴 Bloqueado → _motivo: _____________________

---

## C · Gate 2 — Pre-condiciones de PRODUCCIÓN (gate duro)

- [ ] **C1** · Gate 1 (sección B) cerrado con evidencia archivada
- [ ] **C2** · 🛑 **P0.1 Backup CERRADO** (no seedear prod sin respaldo restaurable)
- [ ] **C3** · Aprobación explícita del Presidente (firma sección F)
- [ ] **C4** · Confirmado proyecto activo = `arsksytgdnzukbmfgkju` (prod) antes de pegar SQL
- [ ] **C5** · Ventana de cambio acordada (RBAC pasa de fail-open a enforced — impacto en accesos)
- [ ] **C6** · Plan de rollback leído y a mano (`DELETE FROM user_roles …` → vuelve a dormido)

**Gate 2:** ▢ 🟢 Habilitado para prod ▢ 🔴 Bloqueado → _motivo: _____________________

---

## D · Ejecución en PRODUCCIÓN (manual · solo tras Gate 1 + Gate 2 🟢)

> La **única** acción pendiente del Track A. Referencia: `RBAC-SANDBOX-EXECUTION-PLAN.md` §5.

- [ ] **D1** · Pegar **Bloque 2 · PRODUCCIÓN** de `seed-rbac-assign-users-OPCION-A.sql` en SQL Editor de prod
- [ ] **D2** · Pre-flight OK (usuarios existen) → `SELECT` muestra **2 filas** correctas
- [ ] **D3** · `COMMIT` (o `ROLLBACK` si algo no cuadra)
- [ ] **D4** · Read-only post: `user_roles` prod = 2 filas con IDs esperados
- [ ] **D5** · Smoke con sesión real del Director: Drive **200 `enforced:true`**
- [ ] **D6** · Logs prod sin `fallback-allow` para usuarios asignados

**Resultado:** ▢ 🟢 RBAC ACTIVO en producción ▢ 🔴 Revertido → _motivo: _____________________

---

## E · Aceptación de alcance (importante)

Marcar para confirmar entendimiento del alcance real de P0.2:

- [ ] **E1** · Entiendo que 🟢 RBAC VALIDADO significa **"el motor RBAC resuelve y deniega correctamente"**, demostrado end-to-end en Drive y por resolución en el resto.
- [ ] **E2** · Entiendo que Billing / CCTV / Settings / Compras / Compliance-páginas **resuelven** permisos pero **aún no bloquean por pantalla** (guards pendientes — **ETAPA 1**, fuera de P0.2).
- [ ] **E3** · Entiendo que `compras.sign` (firma de OC) **aún no tiene guard server-side**; el RBAC lo resuelve correctamente pero el cableado de la acción es ETAPA 1.
- [ ] **E4** · Entiendo que `billing.*` no existe como permiso (D3); /billing mapea a `analytics.view` por ahora.

---

## F · Firma de aprobación

| Rol | Nombre | Decisión | Fecha |
|-----|--------|----------|-------|
| Presidente | Martín F. Battaglia | ▢ 🟢 GO ▢ 🔴 NO-GO | __________ |

**Condiciones / notas del aprobador:**

_______________________________________________________________________

---

## G · Estado del gate

▢ **PENDIENTE** — sandbox aún no ensayado
▢ **GATE 1 OK** — validado en sandbox, esperando aprobación prod
▢ **GO** — aprobado para producción
▢ **EJECUTADO** — RBAC activo en prod, P0.2 cerrado → habilita Track Backup GCS
▢ **NO-GO / REVERTIDO** — _motivo: _____________________
