# TOPS NEXUS — Roadmap de Implementación 12 Meses

> **Estado:** roadmap · **Fecha base:** 2026-05-29 · **Horizonte:** 2026-06 → 2027-05
> Plan de implementación a 12 meses para reemplazar progresivamente Neuralsoft.
> Cada iniciativa lleva: **prioridad · dependencias · riesgos · complejidad ·
> impacto de negocio**. Alineado al roadmap de 7 fases del rector, a la secuencia
> de migraciones 0012–0017 ([erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md) §9–10)
> y a los pasos de consolidación P1–P6
> ([ERP-CONSOLIDACION-DEFINITIVA.md](./ERP-CONSOLIDACION-DEFINITIVA.md) §2).
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md).
> **No** ejecuta nada: es plan y propuesta. Toda migración/deploy requiere
> aprobación explícita.

---

## 0. Leyenda

- **Prioridad:** P0 (bloqueante) · P1 (alta) · P2 (media) · P3 (oportunista).
- **Complejidad:** ◔ baja · ◑ media · ◕ alta · ● muy alta.
- **Impacto negocio:** ★☆☆ bajo · ★★☆ medio · ★★★ alto.

---

## 1. Vista trimestral

| Trimestre | Foco | Hitos |
|-----------|------|-------|
| **Q1 (Jun–Ago 2026)** | Consolidación → Facturación operativa | Paridad repo, RBAC vivo, ARCA decidido, Compras en prod |
| **Q2 (Sep–Nov 2026)** | Proveedores + fundación financiera | Migración 0012 (catálogos) + 0013 (supplier_invoices), Centros de Costo |
| **Q3 (Dic 2026–Feb 2027)** | Tesorería + Cuentas Corrientes | Migración 0015, subledgers AR/AP, conciliación |
| **Q4 (Mar–May 2027)** | Contabilidad/BI + reemplazo Neuralsoft | Migración 0016 (GL), Libros IVA, ETL Neuralsoft (0017) |

---

## 2. Iniciativas detalladas

### Q1 · Jun–Ago 2026 — Cerrar consolidación y dejar Facturación operativa

| # | Iniciativa | Prio | Depende de | Riesgos | Complej. | Impacto |
|:-:|-----------|:----:|-----------|---------|:--------:|:-------:|
| I1 | **Paridad repo (P1):** llevar SQL 0008/0009/0010 a `main` | P0 | — | bajo (solo archivos; DB ya los tiene salvo 0010) | ◔ | ★★☆ (riesgo silencioso) |
| I2 | **Resolver duplicados (P2):** clientify/drive/types + `drive/ping` | P0 | I1 | regresión si se elige mal el ganador | ◑ | ★★☆ |
| I3 | **Gate ARCA (P3):** feature-flag `/billing`+`/settings/fiscal` | P0 | — | bajo (solo flag) | ◔ | ★★★ (saca módulo roto de prod) |
| I4 | **Activar RBAC (P4):** poblar `user_roles` (seed) | P1 | — | bajo (reversible, no schema) | ◔ | ★★☆ (gobernanza/SoD) |
| I5 | **Roles faltantes:** Facturación, Compras, Auditor, Super Admin (seed) | P1 | I4 | bajo | ◑ | ★★☆ |
| I6 | **Promover Compras/OC a `main` (P5)** con tests | P1 | I1, I2 | deploy a prod (revert disponible) | ◕ | ★★★ |
| I7 | **Re-verificar estado DB Supabase** (read-only) | P0 | — | ninguno (read-only) | ◔ | ★★☆ (precondición de todo) |
| I8 | **Aplicar 0011 ARCA** (si hay cert X.509) | P2 | I3, cert host | down-migration; impacto fiscal | ◕ | ★★★ |

### Q2 · Sep–Nov 2026 — Proveedores + fundación contable

| # | Iniciativa | Prio | Depende de | Riesgos | Complej. | Impacto |
|:-:|-----------|:----:|-----------|---------|:--------:|:-------:|
| I9 | **Migración 0012 — catálogos:** `cost_centers`, `chart_of_accounts`, `tax_rates`, `tipos_cambio`, `fiscal_periods` + blindajes inmutabilidad (C2: ON DELETE RESTRICT + guard DELETE) | P0 | Q1 cerrado | schema nuevo (no toca tablas vivas) | ◕ | ★★★ |
| I10 | **Migración 0013 — `supplier_invoices` + items** + FK a OC | P0 | I9 | enlaza OC↔factura↔pago | ◕ | ★★★ (IVA Crédito, Fase 3) |
| I11 | **Módulo Proveedores/IVA Crédito** (UI carga/aprobación/auditoría) | P1 | I10 | conciliación 3 vías (OC↔remito↔factura) | ◕ | ★★★ |
| I12 | **Centros de Costo en documentos** (FK nullable en invoices/PO) | P1 | I9 | retroactividad en tablas vivas | ◑ | ★★★ (rentabilidad por unidad) |
| I13 | **CCTV Fase 2 — video en vivo** (RTSP/ONVIF/HLS) | P2 | — | red/latencia NVR; XML parser | ◕ | ★★☆ |
| I14 | **Migración 0014 — `withholdings`** (retenciones/percepciones) | P2 | I10 | padrones IIBB | ◑ | ★★☆ |

### Q3 · Dic 2026–Feb 2027 — Tesorería y Cuentas Corrientes

| # | Iniciativa | Prio | Depende de | Riesgos | Complej. | Impacto |
|:-:|-----------|:----:|-----------|---------|:--------:|:-------:|
| I15 | **Migración 0015 — Tesorería + CC:** `accounts`, `payment_methods`, `treasury_movements`, `payments`, `collections`, `checks`, allocations | P0 | I10, I12 | núcleo financiero; consistencia de saldos | ● | ★★★ |
| I16 | **Módulo Tesorería** (caja/bancos/cheques/e-cheq/conciliación/flujo de fondos) | P0 | I15 | conciliación bancaria | ● | ★★★ |
| I17 | **Módulo Cuentas Corrientes** (subledger AR/AP, aging, aplicación de cobros/pagos) | P1 | I15, I16 | aplicación a comprobantes; mora | ◕ | ★★★ |
| I18 | **CCTV Fase 3 — evidencia ↔ órdenes** (`cctv_evidence`) + ANMAT | P2 | I13 | bucket privado scoping | ◑ | ★★☆ |
| I19 | **Libro IVA Ventas** (consolidado por período/alícuota) | P2 | I9, 0011 aplicada | DDJJ | ◑ | ★★☆ |

### Q4 · Mar–May 2027 — Contabilidad/BI y reemplazo Neuralsoft

| # | Iniciativa | Prio | Depende de | Riesgos | Complej. | Impacto |
|:-:|-----------|:----:|-----------|---------|:--------:|:-------:|
| I20 | **Migración 0016 — GL:** `journal_entries`/`journal_lines` + motor de asientos automáticos (subledger→GL) | P0 | I15, I17 | partida doble; correctitud contable | ● | ★★★ |
| I21 | **Balance / Estado de Resultados / Mayor** + Libro IVA Compras | P1 | I20 | cierre de períodos | ◕ | ★★★ |
| I22 | **BI ejecutivo** (ventas, rentabilidad, facturación, cobranzas, costos, ops, ANMAT, transporte) | P1 | I17, I20 | calidad de datos | ◕ | ★★★ |
| I23 | **Migración 0017 — ETL Neuralsoft** (saldos iniciales + históricos) | P0 | I20, I21 | migración de datos legacy; cuadre | ● | ★★★ (reemplazo total) |
| I24 | **CCTV Fase 4 — eventos automáticos** (alertStream) | P2 | I18 | suscripción NVR estable | ◕ | ★★☆ |
| I25 | **ANMAT avanzado** (RNE/RNPA, vencimientos, cadena de frío, trazabilidad) | P2 | I18 | datos reales vs mock | ◕ | ★★☆ |

---

## 3. Cadena de dependencias críticas (camino largo)

```
I7 (verificar DB) ─► I1/I2 (paridad+duplicados) ─► I6 (Compras prod)
                                                        │
I3/I4 (gate ARCA + RBAC) ───────────────────────────────┤
                                                        ▼
                          I9 (0012 catálogos) ─► I10 (0013 supplier_invoices)
                                │                        │
                                ▼                        ▼
                          I12 (cost centers)      I11 (módulo Proveedores)
                                        │
                                        ▼
                          I15 (0015 Tesorería+CC) ─► I16/I17 (módulos)
                                        │
                                        ▼
                          I20 (0016 GL) ─► I21 (Balance) ─► I23 (ETL Neuralsoft)
```

**Regla de oro del camino:** no se puede empezar Tesorería (I15) sin cerrar
Proveedores/IVA Crédito (I10/I11), y no se puede reemplazar Neuralsoft (I23) sin
el GL (I20) que produce el Balance.

---

## 4. Riesgos de programa (transversales)

| # | Riesgo de programa | Mitigación |
|:-:|--------------------|-----------|
| RP1 | **Inmutabilidad fiscal incompleta** (C2) llega a Tesorería sin blindaje | resolver en 0012 (I9) antes de cualquier subledger |
| RP2 | **Doble RBAC** sin unificar bloquea SoD financiera | I4/I5 en Q1; migrar RLS a `has_permission` progresivamente |
| RP3 | **Certificado X.509 ARCA** no disponible retrasa Facturación real | gate (I3) desacopla; aplicar 0011 (I8) cuando esté el cert |
| RP4 | **Migración de datos Neuralsoft** subestimada | I23 con ventana amplia (Q4) + cuadre paralelo antes del corte |
| RP5 | **Calidad de datos** para BI/Balance | validaciones en DB (triggers de totales) desde 0012 |
| RP6 | **Backup de datos productivos** (0008/0009 sin respaldo fuera de Supabase) | política de backup del proyecto Supabase en Q1 |

---

## 5. Hitos de negocio (qué se gana y cuándo)

| Hito | Trimestre | Valor para dirección |
|------|:---------:|----------------------|
| Facturación ARCA operativa + RBAC vivo + Compras en prod | Q1 | deja de perderse trabajo; gobernanza real; OC con datos en producción |
| Proveedores/IVA Crédito + Centros de Costo | Q2 | **rentabilidad por unidad de negocio** (ANMAT vs Cargas vs Oficinas vs Transporte) |
| Tesorería + Cuentas Corrientes | Q3 | control de caja, deuda y cobranzas en una sola plataforma |
| Balance + BI + reemplazo Neuralsoft | Q4 | **dirección basada en datos** y baja definitiva de Neuralsoft |

---

## 6. Nota de método

Este roadmap es **propuesta**. Ninguna migración (0012–0017) se aplica, ninguna
rama se fusiona y ningún deploy se ejecuta sin diagnóstico + riesgos + impacto +
plan + rollback + aprobación explícita, por fase, según la política de producción
del rector.
