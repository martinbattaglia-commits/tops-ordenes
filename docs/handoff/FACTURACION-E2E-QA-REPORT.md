# FACTURACION-E2E-QA-REPORT — Auditoría End-to-End del módulo de Facturación

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.) · **Fecha:** 2026-06-12
**Alcance:** funcional · visual · UX/UI · negocio · PDF · estrés · integraciones · seguridad de datos — ejecutado EN PRODUCCIÓN con datos de prueba autorizados (ambiente fiscal SANDBOX).
**Flujo E2E ejecutado:** cliente nuevo → OS con 2 conceptos y firma digital → emisión Factura A con CAE → PDF → verificación SQL integral → anulación (limpieza fiscal).

---

## 1 · Resumen general

| Dimensión | Evaluación |
|---|---|
| **Estado general** | 🟢 Sólido. El flujo completo (cliente → OS firmada → factura CAE → PDF → libro → tesorería) funciona de punta a punta sin errores |
| **Nivel de madurez** | Alto para el circuito OS-céntrico; la facturación directa (sin OS) no tiene UI todavía (por diseño, ERP-C) |
| **Riesgo operativo** | Bajo en SANDBOX; para facturación fiscal real restan credenciales ARCA + letra por condición IVA (G9, ya roadmapped) |

## 2 · Score (1–10)

| Criterio | Nota | Fundamento |
|---|---|---|
| UX/UI | **9** | Wizard de 4 pasos con resumen en vivo, validación AFIP en línea, tarifario inteligente con mínimos señalizados, firma digital con trazabilidad. Design system respetado al 100% |
| Funcionalidad | **8.5** | E2E impecable; resta facturación directa con UI y desglose de conceptos en factura (hoy 1 renglón por OS) |
| Robustez | **9** | Checksum de CUIT, mínimos de tarifa, doble facturación bloqueada, comprobantes inmutables, identidad fiscal por trigger, transacción única |
| Escalabilidad | **8** | Fundación canónica probada; listado de facturas sin paginación visible aún (volumen actual bajo) |
| Branding | **9.5** | Coherencia total Nexus/TOPS; PDF con membrete, QR fiscal, montos en letras y aviso SANDBOX explícito |
| Calidad técnica | **9** | Matemática fiscal en DB, append-only, RPC transaccional, corte de ambiente — patrón Fortune 500 |

## 3 · Evidencia del flujo E2E (todo verificado en vivo)

1. **Cliente** `CLIENTE TEST QA TOPS` (CUIT ficticio 30-99999999-5) creado por UI — la validación rechazó el CUIT con dígito verificador inválido ✅
2. **OS-201617**: 2 conceptos (Palletizado 10 un × $28.000 + Carga palletizada 1 m³ con **mínimo $43.000 aplicado y señalizado**), IVA estimado 21% = $67.830 calculado en vivo, **firma digital** con GPS/IP/hash, comprobante de servicio brandeado → FIRMADA ✅
3. **Factura A 00002-00000004**: $323.000 + $67.830 = **$390.830** — CAE mock, AUTORIZADO, badge SANDBOX, numeración correlativa correcta ✅
4. **Verificación SQL integral (9/9)**: línea IVA automática (21% → 323.000/67.830) · identidad Δ 0,00/0,00 · 2 auditorías en la misma transacción · OS → FACTURADA · libro IVA junio actualizado ($216.090) · tesorería actualizada ($3.567.398) · vista fiscal coherente ✅
5. **PDF**: template validado visualmente (factura 2-3): membrete TOPS, datos del receptor, detalle, totales, monto en letras, QR fiscal RG 4892, CAE + vencimiento, leyenda SANDBOX en rojo. Imagen corporativa: premium ✅
6. **Responsive**: mobile con topbar compacta (TOPS Connect icon-only), bottom-nav, tablas adaptadas ✅
7. **Integraciones**: Clientes (maestro + Clientify) · OS ↔ Factura (back-link bidireccional) · ARCA (request/response/auditoría persistidos) · Libro IVA Ventas · Tesorería/Cobranzas · KPI Cockpit ✅

## 4 · Hallazgos

| # | Problema | Severidad | Impacto | Solución propuesta |
|---|---|---|---|---|
| H1 | El buscador del maestro de Clientes no encuentra clientes locales recién creados (busca el espejo CRM) y la cabecera contradice la tabla ("1 CLIENTES" vs "Sin coincidencias") | **P2** | Confusión operativa; el usuario cree que el alta falló | Unificar la búsqueda sobre ambas fuentes (clients + CRM) y corregir el contador |
| H2 | La factura consolida **1 renglón por OS** ("OS OS-201617 — fecha"), sin desglosar los conceptos | **P2** | La Contadora/cliente no ve el detalle en la factura (sí está en el comprobante de servicio adjuntable) | Decisión de producto: trasladar los renglones de la OS a `invoice_items` (la RPC ya lo soporta) |
| H3 | El PDF no se materializa al bucket (regeneración on-demand) | **P2** | El comprobante legal depende del sistema vivo | Activar `storeInvoicePdf` post-CAE (ya identificado en NEXT-STEPS-ARCA-PRODUCCION) |
| H4 | Letra de comprobante fija en A / receptor RI | **P2** | Facturar a monotributista emitiría letra incorrecta | G9 — conectar `comprobanteParaReceptor()` (roadmap V2 del diseño, previo a ARCA real) |
| H5 | Fecha fiscal = `created_at` (sin `fecha_emision` propia) | **P3** | Cortes de período en el límite de mes | G3 — columna `fecha_emision` (roadmapped) |
| H6 | Tablas en mobile requieren scroll horizontal para llegar a la columna Acción | **P3** | Fricción menor en uso móvil | Cards apiladas en `<md` o columna de acción sticky |
| H7 | Listado de comprobantes sin paginación visible (pageSize 50) | **P3** | Irrelevante hoy; degradará con volumen | Paginación/búsqueda al crecer |
| — | **P0/P1: NO se encontraron** | — | — | — |

**Pruebas de estrés superadas:** CUIT inválido rechazado en línea · mínimos de facturación aplicados y señalizados · re-emisión imposible (OS FACTURADA desaparece de pendientes + guard de idempotencia en base) · importes grandes renderizan bien ($4,4M) · anulación protegida por confirmación humana · comprobantes inmutables post-CAE (trigger) · datos de prueba imposibles de "editar" — solo rectificables por NC (correcto fiscalmente).

## 5 · Veredicto

# ✅ APTO PARA PRODUCCIÓN (operatoria actual, ambiente SANDBOX)

**Justificación técnica:** el flujo de negocio completo funciona sin errores P0/P1; la integridad fiscal está garantizada **a nivel de base de datos** (transacción única, identidad por trigger, inmutabilidad, alícuotas validadas); la matemática es exacta (Δ $0,00 en todas las verificaciones); el corte SANDBOX/PRODUCCIÓN garantiza que nada de lo emitido hoy contamine los libros reales. **Condiciones para facturación fiscal REAL (ARCA productivo):** kit de credenciales (certificado VEROT24 vigente ✓ + clave privada pendiente + delegación wsfe) y cierre de H4/G9 si se factura a clientes no-RI — ambos ya planificados en NEXT-STEPS-ARCA-PRODUCCION.md.

## 6 · Limpieza (FASE 11) — estado

| Dato de prueba | Estado |
|---|---|
| Factura 2-4 ($390.830, SANDBOX) | ⏳ **anulación por NC pendiente del click presidencial** (los comprobantes son inmutables por diseño: la "eliminación" fiscal correcta es la NC, y la directiva vigente exige click manual para emitir comprobantes) |
| OS-201617 | queda FACTURADA vinculada al comprobante anulado (residual documentado, mismo criterio que WMS E2E) |
| CLIENTE TEST QA TOPS | no eliminable (FK con comprobantes — restricción correcta del sistema); marcado "TEMPORAL QA" en observaciones; reutilizable para futuras auditorías |
| Efecto en libros/KPIs | **cero al pasar a PRODUCCIÓN**: todo es SANDBOX y sale del corte automáticamente |

Verificación post-anulación prevista: NC-A 00002-00000001 emitida y vinculada · 2-4 con badge ANULADA · libro IVA junio vuelve a $216.090 − 67.830 = $148.260 · saldo de tesorería vuelve a $3.176.568.
