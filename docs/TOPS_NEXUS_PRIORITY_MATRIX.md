# TOPS_NEXUS_PRIORITY_MATRIX — Matriz Impacto × Esfuerzo (CTO)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Base:** `TOPS_NEXUS_CURRENT_STATE.md` + `TOPS_NEXUS_NEXT_PHASES.md` (estado real del repo).

---

## 1. Matriz

```
                 BAJO ESFUERZO                         ALTO ESFUERZO
              ┌───────────────────────────────┬───────────────────────────────┐
   ALTO       │  ★ P0 Consolidación git        │  ★ P1 Salida a Producción      │
   IMPACTO    │     (commit + reconciliar main)│     P3 Clientify Outbound       │
              │  P2 Reconciliación seed Twin*  │     P6 Portal cliente / KPIs    │
              ├───────────────────────────────┼───────────────────────────────┤
   BAJO       │  P4 Cierre gates Clientify     │  (vacío)                        │
   IMPACTO    │  P5 Owner routing por equipo   │                                 │
              └───────────────────────────────┴───────────────────────────────┘
   * P2 = impacto alto / esfuerzo medio (se ubica en el borde bajo-medio).
```

---

## 2. Clasificación por cuadrante

### 🟢 ALTO IMPACTO / BAJO ESFUERZO — *hacer ya*
| Frente | Por qué |
|---|---|
| **P0 · Consolidación git** | Protege TODO el activo (hoy sin commitear = riesgo de pérdida total) y desbloquea la integración. Esfuerzo casi nulo; dentro de las restricciones (no toca main/prod/deploy). **Acción inmediata, no negociable.** |
| **P2 · Reconciliación seed Twin** (esfuerzo medio) | La vacancia "oficial" que se vendería hoy no coincide con la realidad auditada; alinearla protege la credibilidad del dato comercial. |

### 🔵 ALTO IMPACTO / ALTO ESFUERZO — *planificar y ejecutar con foco*
| Frente | Por qué |
|---|---|
| **P1 · Salida a Producción** | Único frente que **convierte lo construido en valor** (vender ~3.770 m² ociosos). Alto esfuerzo/riesgo (merge multi-rama, 10 migraciones a PROD, deploy, cutover) + requiere **autorización de Dirección**. |
| **P3 · Clientify Outbound** | Cierra el bidireccional; evita divergencia Clientify↔Nexus. Necesita consolidar cliente de escritura + sandbox. Mejor **después** de estar en vivo. |
| **P6 · Portal cliente / KPIs en vivo** | Producto de expansión; depende de tener el CRM en producción y maduro. |

### ⚪ BAJO IMPACTO / BAJO ESFUERZO — *oportunista / relleno*
| Frente | Por qué |
|---|---|
| **P4 · Cierre gates Clientify (G-3/G-4)** | De-risk del inbound; mayormente acción externa (ticket + captura webhook.site). Bajo costo, valor incremental. |
| **P5 · Owner routing por equipo** | Mejora de reparto; least-loaded ya es justo. |

### 🔴 BAJO IMPACTO / ALTO ESFUERZO — *evitar*
| Frente | Por qué |
|---|---|
| *(ninguno identificado)* | No hay frentes en este cuadrante en el backlog actual. |

---

## 3. Secuencia recomendada (derivada de la matriz)

1. **P0 ahora** (horas): commitear todo el trabajo W-1…F2.2 y reconciliar `main` local↔origin. Elimina CR-1/CR-2.
2. **P2 + P4 en paralelo** (días): dato confiable + inbound de-riskeado, como soporte de P1.
3. **P1 como el gran frente** (semanas, con autorización de Dirección): salida a producción del stack comercial.
4. **P3 / P6 después** de estar en vivo.

---

## 4. Nota de método

Clasificación basada en el **estado real** del repo: trabajo validado pero sin commitear/desplegar. Por eso los frentes de **consolidación y salida a producción** dominan sobre los de "construir más" — el cuello de botella del proyecto es de **entrega**, no de capacidad técnica.
