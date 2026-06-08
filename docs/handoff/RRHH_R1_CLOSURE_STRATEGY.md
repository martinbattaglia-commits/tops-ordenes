# TOPS NEXUS — RRHH · R1 CLOSURE STRATEGY

> **Tipo:** procedimiento operativo de cierre (solo definición). **No** implementa, **no** aplica
> migraciones, **no** toca producción, **no** contiene SQL. Define **cómo** cerrar R1 correctamente.
> **Producción:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07.

---

## Nomenclatura oficial (vigente)

| Estado | Significado |
|--------|-------------|
| `IMPLEMENTATION COMPLETE` | Artefacto creado + commit realizado + auditoría local PASS |
| `DEPLOYMENT PENDING` | No hay evidencia verificable de aplicación en prod (o aún no ocurrió) |
| `GATE OPEN` | No puede declararse cerrado; no habilita el gate siguiente |

---

## 1. Estado actual

```text
RRHH R1
IMPLEMENTATION COMPLETE   (artefacto 0056 · commit 1dcd668 · auditoría PASS)
DEPLOYMENT PENDING        (sin evidencia verificable en arsksytgdnzukbmfgkju)
GATE OPEN
R2 NO-GO
```

- Artefacto: `supabase/migrations/0056_rrhh_permission_module.sql`.
- Commit aislado: `1dcd668`.
- Auditoría: `RRHH_R1_AUDIT_REPORT.md` (0 críticos / 0 mayores).
- Validación de prod: `RRHH_R1_PRODUCTION_VALIDATION.md` → sin acceso → no verificable.

---

## 2. Condiciones de cierre (evidencias requeridas)

Para declarar `R1 CLOSED` se requieren **todas** estas evidencias verificables sobre
`arsksytgdnzukbmfgkju`:

```
☐ E1 — El valor 'rrhh' figura entre los valores del enum permission_module_t (catálogo de enums).
☐ E2 — La migración 0056_rrhh_permission_module consta como aplicada (historial de migraciones).
☐ E3 — Idempotencia confirmada: una segunda aplicación de 0056 es no-op (sin error).
☐ E4 — Alcance respetado: NO existen tablas / policies / RPC RRHH (R1 no debía crearlas).
☐ E5 — Dominios intactos: ERP-A / ERP-B / CRM / Operaciones / Compliance sin modificaciones.
☐ E6 — Producción estable (sin errores tras el cambio; smoke check).
```

> Todas las evidencias son **read-only** (consulta de catálogo / historial). Ninguna requiere
> escribir en producción.

---

## 3. Procedimiento de validación (paso a paso)

> Según el escenario disponible. La aplicación de la migración (Escenario A) es un paso manual del
> operador; la verificación puede hacerla el operador o, con acceso read-only, la herramienta.

### Escenario A — El operador aplica y aporta evidencia
1. **Preflight:** confirmar backup verificado · `0056` sigue siendo la próxima libre en prod ·
   ventana acordada · operador único.
2. **Aplicar** `0056` en `arsksytgdnzukbmfgkju` por el canal habitual de migraciones (mismo
   procedimiento manual que `0052`).
3. **Verificar** E1–E6 (read-only) y **registrar evidencia** (capturas/salidas de catálogo).
4. **Entregar** la evidencia para emitir el cierre.

### Escenario B — Verificación asistida (acceso read-only habilitado)
1. Habilitar acceso **solo lectura** (linkear el proyecto con `SUPABASE_ACCESS_TOKEN`, o connection
   string read-only). **Sin** permisos de escritura.
2. La herramienta verifica E1, E2, E4, E5 contra el catálogo de producción (read-only).
3. Si E1–E5 se confirman → emitir cierre. (E3/E6 las confirma quien aplicó.)
   > Nota: si solo se habilita lectura, la **aplicación** sigue siendo paso manual del operador
   > (Escenario A); B sirve para **verificar**, no para aplicar.

### Escenario C — No hay evidencia
1. Si no se puede confirmar E1/E2 con evidencia → **no cerrar**.
2. Resultado obligatorio: `R1 OPEN · DEPLOYMENT PENDING`.

---

## 4. Criterio de cierre

```text
R1 CLOSED  ⇔  E1 ∧ E2 ∧ E3 ∧ E4 ∧ E5 ∧ E6  (todas verificadas con evidencia)
```

- Si **todas** se cumplen → emitir `RRHH_R1_CLOSURE_REPORT` actualizado a **CLOSED** +
  (recomendado, estilo ERP-A) un `RRHH_R1_PRODUCTION_VERIFICATION` independiente read-only.
- Si **falta una sola** → permanece `GATE OPEN · DEPLOYMENT PENDING`.

---

## 5. Criterio de apertura de R2

```text
R2 GO  ⇔  R1 CLOSED  ∧  aprobación explícita de Dirección para R2
```

Condiciones:
- `0056` **aplicada y verificada** en prod (E1–E2 confirmadas) — el seed RBAC de R2 (`0057`,
  permisos `rrhh.*` + roles) **requiere** el valor de enum efectivamente aplicado.
- Diseño de referencia sin cambios: `RRHH_MASTER_ARCHITECTURE_v2_0.md`.
- Autorización explícita de Dirección para abrir R2 (igual que R1).

> Mientras R1 no esté `CLOSED`, **R2 = NO-GO**. No se planifica ni se ejecuta `0057`.

---

## 6. Matriz de resultados

| Escenario | Evidencia E1–E2 | Veredicto |
|-----------|-----------------|-----------|
| A (operador aplica + evidencia) | ✅ | `R1 CLOSED · READY FOR R2` |
| B (verificación read-only confirma) | ✅ | `R1 CLOSED · READY FOR R2` |
| C (sin evidencia) | ❌ | `R1 OPEN · DEPLOYMENT PENDING` |

---

```text
CURRENT STATUS

IMPLEMENTATION COMPLETE
DEPLOYMENT PENDING
GATE OPEN
R2 NO-GO
```

*Estrategia de cierre R1 — solo procedimiento. Sin código, sin SQL, sin cambios en producción.*
*Vigente hasta que exista evidencia verificable de producción (E1–E6).*
