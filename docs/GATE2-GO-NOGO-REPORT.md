# TOPS NEXUS — GATE 2 · GO / NO-GO REPORT (Entregable 6 · Fase C)

> **Estado:** síntesis de decisión · **NO implementa nada** · **Fecha:** 2026-05-29
> Responde: **¿Está TOPS Nexus en condiciones de abrir el ERP Financiero?**
> Clasifica **GO / GO CON CONDICIONES / NO GO** con evidencia, integrando los
> Entregables 1–5 de la Fase C. Insumo para **decisión ejecutiva**.
> Fuentes: [INFRASTRUCTURE-DECISION-REPORT](./INFRASTRUCTURE-DECISION-REPORT.md) ·
> [GATE-2-EXECUTION-PLAN](./GATE-2-EXECUTION-PLAN.md) ·
> [RBAC-READINESS-REPORT](./RBAC-READINESS-REPORT.md) ·
> [ARCA-READINESS-REPORT](./ARCA-READINESS-REPORT.md) ·
> [MIGRATION-0012-DESIGN-REVIEW](./MIGRATION-0012-DESIGN-REVIEW.md).

---

## 0. Veredicto

# 🟡 GO CON CONDICIONES

**TOPS Nexus NO está en condiciones de *abrir y operar* el ERP Financiero hoy**, pero **SÍ está en
condiciones de avanzar** porque la arquitectura es coherente, el código del módulo está construido y
existe un camino verificado y de bajo riesgo (GATE 2 → aplicar `0010`/`0011` → implementar ARCA real).

- **No es GO** porque hay **bloqueos productivos reales** (C1, ARCA-STUB, `0011` sin aplicar) que, si se
  ignoran, **rompen producción** o **emiten facturas inválidas**.
- **No es NO GO** porque **ningún hallazgo es de diseño/código irrecuperable**: todo lo pendiente es
  ejecución controlada con plan y rollback ya escritos.

---

## 1. Evidencia consolidada (verificada, no asumida)

| Dimensión | Evidencia | Estado |
|-----------|-----------|--------|
| Migraciones en prod | `supabase migration list` (live, read-only): `0001`→`0009` aplicadas; `0010`+`0011` **NO** | ✅ verificado |
| Entorno de validación | Docker ❌, psql ❌, CLI ✅ apuntando a **PROD**, `config.toml` ❌ | ✅ verificado |
| Código facturación | `emit.ts` (10 pasos), `qr.ts` (RG 4892/2020), `InvoicePdfDocument.tsx`, `calc.ts` | ✅ presente |
| ARCA real | `ProductionArcaService` = **STUB `NOT_READY`** (sin WSAA/WSFEv1/cert X.509) | 🔴 no operativo |
| Mock ARCA | `MockArcaService` → CAE simulado, flujo SANDBOX completo | ✅ funciona |
| RBAC enforced | modelo SIMPLE (`profiles.role` + `current_role()`) en todas las RLS | ✅ activo |
| RBAC granular | `0009`: 7 roles, 22 permisos, `role_permissions` sembrado; **`user_roles=0`**, `has_permission()` sin uso en RLS | ⚠️ dormido (G3) |
| Auditoría RBAC | `rbac_audit` **no existe** | ⚠️ pendiente (G9) |
| Bucket `invoices` | policy `auth.role()='authenticated'` **sin scoping por cliente** | 🟠 R4 |

---

## 2. Bloqueos clasificados

### 2.1 Bloqueos que impiden GO directo (deben cerrarse antes de operar)

| ID | Bloqueo | Por qué bloquea | Cierre |
|----|---------|-----------------|--------|
| **B-ENV** | Sin entorno aislado (Docker/Staging) + CLI→PROD | No se puede ejecutar GATE 2 ni aplicar `0011` sin riesgo | Entregable 1 (decisión ejecutiva) |
| **C1** | En prod `isMock=false` consulta tablas `0011` ausentes | `/billing` y `/settings/fiscal` fallan en runtime | Aplicar `0011` tras GATE 2 verde |
| **ARCA-STUB** | `ProductionArcaService` lanza `NOT_READY` | No hay emisión fiscal real | Implementar WSAA/WSFEv1 + cert (post-GATE 2) |

### 2.2 Bloqueos para *operar con dinero real* (SoD / compliance)

| ID | Bloqueo | Por qué importa | Cierre |
|----|---------|-----------------|--------|
| **G3** | RBAC granular dormido (sin SoD) | Mismo usuario emite y autoriza → sin control interno | `0012+`: poblar `user_roles` + RLS `has_permission()` |
| **G9** | Cambios RBAC sin versionar | Escalada de privilegios no trazable | `0012+`: `rbac_audit` (diseño listo) |
| **R4** | Bucket `invoices` sin scoping por cliente | Cliente B2B podría ver PDFs fiscales ajenos | Corregir policy (patrón `documents`) |

### 2.3 Lo que NO bloquea (ya resuelto / fuera de alcance)

- Diseño y código de `0010`/`0011`: **superan el desk-check estático** (críticos/altos cerrados en GATE 1C).
- Diseño conceptual de `0012` (7 entidades): **coherente** con los patrones del proyecto (Entregable 5).
- Modelo SIMPLE de RBAC: **seguro** para lo que ya está en producción.

---

## 3. Ruta crítica al ERP Financiero (orden obligatorio)

```
[1] Decisión de entorno (Entregable 1)         → ejecutiva: Staging cloud o Docker Local
        │
[2] Ejecutar GATE 2 (Entregable 2)              → aplicar 0010→0011 en aislado + batería + rollback
        │   (criterios GO §4 del plan; cualquier R1–R9 → DETENER)
        ▼
[3] GATE 2 verde  ──► autorización ejecutiva ──► aplicar 0011 en PRODUCCIÓN   (cierra C1)
        │
[4] Implementar ProductionArcaService           → WSAA + WSFEv1 + cert X.509 (solo host)
        │   + corregir R4 (scoping bucket)
        ▼
[5] Homologación ARCA (CUIT prueba)             → emitir en HOMOLOGACION OK
        │
[6] Cerrar G3 + G9 (0012: user_roles, has_permission, rbac_audit)  → SoD auditada
        ▼
[7] Smoke productivo controlado                 → primer comprobante real mínimo + verificación CAE/QR
        ▼
      ERP Financiero OPERATIVO
```

> **Punto de no-retorno seguro:** nada después de `[2]` se ejecuta sin GATE 2 verde + autorización ejecutiva
> explícita por paso. Cada flecha hacia producción es un gate independiente.

---

## 4. Condiciones del GO (qué debe cumplirse, y en qué orden)

| # | Condición | Bloquea apertura | Responsable de decisión |
|---|-----------|:----------------:|--------------------------|
| 1 | Autorizar entorno aislado (Staging o Docker) | Sí | Ejecutivo (gasto/infra) |
| 2 | GATE 2 ejecutado y **verde** (todos los criterios A1–A10) | Sí | Técnico + evidencia |
| 3 | `0011` aplicada en prod (post-GATE 2, autorizada) | Sí (cierra C1) | Ejecutivo |
| 4 | `ProductionArcaService` implementado + homologación OK | Sí (ARCA real) | Técnico + ejecutivo |
| 5 | R4 corregido (scoping bucket `invoices`) | Sí (multi-tenant fiscal) | Técnico |
| 6 | G3 cerrado (SoD: `user_roles` + RLS granular) | Sí (control interno) | Técnico |
| 7 | G9 cerrado (`rbac_audit` operativo) | Sí (auditoría) | Técnico |

**El GO se convierte en operativo solo cuando 1–7 estén cerrados, en orden.** Saltarse cualquiera reintroduce
un bloqueo crítico (rotura de prod, factura inválida, fuga de datos, o falta de control interno).

---

## 5. Riesgo de cada escenario de decisión

| Escenario ejecutivo | Riesgo | Recomendación |
|---------------------|--------|---------------|
| **Abrir ERP financiero hoy** (sin GATE 2) | 🔴 **Inaceptable** — C1 rompe prod; ARCA emite nada o inválido | **NO** |
| **Autorizar Staging + ejecutar GATE 2** | 🟢 Bajo — aislado, rollback trivial | **Recomendado (Entregable 1 primaria)** |
| **Docker Local + GATE 2 (pasada lógica)** | 🟡 Medio — cubre ~70% (schema/RLS/triggers), no storage/perf fiel | **Aceptable como primer paso**, luego Staging |
| **No avanzar** | 🟡 Costo de oportunidad — sigue dependiendo de Neuralsoft | Decisión de negocio |

---

## 6. Respuesta directa a la pregunta del gate

> **¿Está TOPS Nexus en condiciones de abrir el ERP Financiero?**

**🟡 GO CON CONDICIONES.** La base técnica está **lista en diseño y código**, y existe un **camino verificado,
con plan de ejecución y rollback escritos** (Entregable 2). Pero **operar** el ERP financiero exige cerrar,
en orden, las 7 condiciones de §4 — empezando por la **decisión ejecutiva de entorno** y la **ejecución de
GATE 2**. Hasta entonces, abrir facturación en producción es **NO** (rompe runtime + sin emisión fiscal real).

---

## 7. ¿Acerca a reemplazar Neuralsoft?

| Hito | ¿Acerca? |
|------|----------|
| Ejecutar GATE 2 (validar `0010`/`0011`) | **SÍ** — certifica documental + fiscal sin riesgo |
| Aplicar `0011` + ARCA real | **SÍ (decisivo)** — habilita facturación legal AR |
| Cerrar G3/G9 + R4 | **SÍ** — control interno y multi-tenant fiscal auditables |
| Diseño `0012` (contable/costos/multimoneda) | **SÍ (a futuro)** — completa el reemplazo |

> **Conclusión:** cada condición pendiente **acerca** a reemplazar Neuralsoft. El proyecto está
> **bien encaminado**; el siguiente movimiento es **ejecutivo**: autorizar el entorno y habilitar GATE 2.
> **Nada se implementa en esta fase.** GATE 2 permanece **PENDIENTE**.
