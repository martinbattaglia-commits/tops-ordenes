# TOPS NEXUS — RRHH · R1 PRODUCTION CLOSEOUT (STANDBY PACKAGE)

> **Modo:** `STANDBY · AWAITING EVIDENCE`. Instrumento de cierre **pre-armado**, listo para
> ejecutarse en cuanto exista evidencia verificable de producción.
> **No** implementa, **no** despliega, **no** modifica producción. Sin código, sin SQL.
> **Regla rectora:** R1 **no** se cierra por confianza, inferencia ni consistencia — **solo por
> evidencia verificable**.
> **Procedimiento de referencia:** `RRHH_R1_CLOSURE_STRATEGY.md`. **Producción:** `arsksytgdnzukbmfgkju`.
> **Fecha:** 2026-06-07.

---

## 0. Estado actual (al momento de armar el standby)

```text
RRHH R1
IMPLEMENTATION COMPLETE   (artefacto 0056 · commit 1dcd668 · auditoría PASS)
DEPLOYMENT PENDING        (sin evidencia verificable de producción)
GATE OPEN
R2 NO-GO
```

**Veredicto vigente (sin evidencia): `OPTION B — OPEN · ADDITIONAL EVIDENCE REQUIRED`.**
Este documento permanece en standby hasta que se complete §2 con evidencia real.

---

## 1. Evento disparador (uno de dos)

- **Escenario A:** el operador confirma la aplicación manual de `0056_rrhh_permission_module` en
  `arsksytgdnzukbmfgkju` y **aporta evidencia**.
- **Escenario B:** se habilita **acceso read-only** a producción y la verificación se hace
  directamente contra el catálogo (sin escribir nada).

> En ambos casos, la **aplicación** de la migración es responsabilidad del operador. Este instrumento
> solo **verifica y clasifica**.

---

## 2. Formulario de intake de evidencia (a completar al disparar)

> Estado inicial: **todo PENDIENTE**. El cierre requiere E1–E4 confirmadas con evidencia adjunta.

| ID | Evidencia requerida | Cómo se confirma (read-only) | Estado | Evidencia adjunta |
|----|---------------------|------------------------------|--------|-------------------|
| **E1** | `0056` aplicada en prod | Operador confirma aplicación / historial de migraciones la lista | ☐ PENDIENTE | _(pegar evidencia)_ |
| **E2** | `permission_module_t` contiene `'rrhh'` | Consulta read-only al catálogo de enums | ☐ PENDIENTE | _(pegar evidencia)_ |
| **E3** | Sin errores tras el cambio (estable) | Smoke check / ausencia de errores reportados | ☐ PENDIENTE | _(pegar evidencia)_ |
| **E4** | R1 no creó tablas / RPC / policies RRHH | Catálogo: ausencia de objetos RRHH (solo el enum) | ☐ PENDIENTE | _(pegar evidencia)_ |

> Nota: E2 y E4 son verificables por la herramienta si se habilita acceso read-only (Escenario B).
> E1 y E3 las aporta/confirma el operador (Escenario A).

---

## 3. Lógica de decisión (determinística)

```text
SI  (E1 ∧ E2 ∧ E3 ∧ E4) confirmadas con evidencia
    → OPTION A : RRHH R1 CLOSED · READY FOR R2

EN CUALQUIER OTRO CASO (falta ≥1 evidencia, o no verificable)
    → OPTION B : RRHH R1 OPEN · ADDITIONAL EVIDENCE REQUIRED
```

Sin terceras opciones. Una sola evidencia faltante ⇒ OPTION B.

---

## 4. Veredicto (se emite al completar §2)

### ▸ OPTION A — al confirmarse E1–E4
```text
RRHH R1

CLOSED
READY FOR R2
```
Acciones al emitir A:
1. Actualizar `RRHH_R1_CLOSURE_REPORT.md` a **CLOSED** (criterio de éxito de Dirección cumplido).
2. (Recomendado, estilo ERP-A) emitir `RRHH_R1_PRODUCTION_VERIFICATION` independiente read-only.
3. Habilitar la **planificación de R2** — sujeta a aprobación explícita de Dirección
   (`R2 GO ⇔ R1 CLOSED ∧ aprobación`).

### ▸ OPTION B — estado vigente hoy (sin evidencia)
```text
RRHH R1

OPEN
ADDITIONAL EVIDENCE REQUIRED
```

---

## 5. Cómo finalizar este documento cuando llegue la evidencia

1. Completar §2 (marcar E1–E4 y **adjuntar** la evidencia verificable).
2. Aplicar §3 (lógica de decisión).
3. Emitir el veredicto de §4 (A o B) y registrar fecha/operador.
4. Si A: ejecutar las acciones de cierre; si B: indicar qué evidencia falta y permanecer en standby.

> **No** anticipar el resultado. **No** marcar E1–E4 sin evidencia adjunta.

---

## 6. Estado del standby

- Instrumento de cierre: **ARMADO y LISTO**.
- Evidencia de producción: **NO RECIBIDA**.
- Veredicto vigente: **OPTION B (OPEN · ADDITIONAL EVIDENCE REQUIRED)**.

---

```text
CURRENT STATUS

IMPLEMENTATION COMPLETE
DEPLOYMENT PENDING
GATE OPEN
R2 NO-GO
```

*Standby package — listo para cerrar R1 al instante con evidencia. Sin código, sin SQL, sin cambios.*
*Detenido a la espera de evidencia verificable de producción.*
