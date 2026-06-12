# IVA-VENTAS-V2-QA — Evidencia de validación (FASE 3 · QA fiscal completo)

**Fecha:** 2026-06-12 · **Rama:** `feature/iva-ventas-v2`

## §1 — Validaciones de protocolo
| Validación | Resultado |
|---|---|
| `tsc --noEmit` | ✅ 0 |
| `next lint` | ✅ 0 errores |
| `next build` | ✅ Compiled successfully |
| Suite IVA Ventas (`scripts/qa/iva-ventas-v1-test.ts`) | ✅ **11/11** |
| Suite FISCAL-HARDENING (`scripts/qa/fiscal-hardening-test.ts`) | ✅ **15/15** |

Nota: V2 no introduce código de aplicación (solo migración 0073 + documentación) — el riesgo de regresión de runtime es nulo por construcción; las suites confirman que el dominio que las vistas leen sigue intacto.

## §2 — QA fiscal del ciclo completo

| Componente | Validación | Resultado |
|---|---|---|
| **Factura A** | emisión real de Presidencia (00002-00000003) → línea IVA automática + identidad 0,00 | ✅ (V1-CLOSURE ev. #4) |
| **Nota de Crédito** | unit: CbtesAsoc obligatorio, tope acumulado, letra/receptor, anulación; signo: caso sintético en SQL (121.000 − 12.100 → 90.000/18.900) + casos C1–C8 | ✅ |
| **Nota de Débito** | suma (+1) por diseño de signo (solo `NOTA_CREDITO%` invierte); validaciones de asociado idénticas a NC (C-suite) | ✅ |
| **Backfill histórico** | 2 líneas, Δ $0,00, 0 comprobantes sin detalle (V1 ev. #1–#3) | ✅ |
| **Libro IVA Compras** | operativo post-0071 (smoke 2026-06-12); sin cambios en V2 | ✅ |
| **Libro IVA Ventas** | control triple contra producción: IVA 931.266 ×3 · neto 4.434.600 ×3 · MAX \|Δ\| 0,00 — libro ≡ vat_lines ≡ cabecera | ✅ |
| **Tesorería / Cobranzas** | sin cambios de código ni de vistas en V2; smoke post-0071 vigente ($2.322.308 coherente) | ✅ sin regresión |
| **Auditoría** | 2 entradas por emisión en la misma transacción (verificado con 2-3) | ✅ |
| **Corte SANDBOX/PRODUCCIÓN** | `fiscal_ambiente()`=SANDBOX vigente; las vistas 0073 heredan el corte → al pasar a PRODUCCIÓN los 3 mocks salen solos del libro | ✅ |

## §3 — Validación específica del mandato V2 (libro vs canónico vs cabecera)
Ejecutada contra producción (solo lectura, cuerpo de las vistas):
- **Netos cierran**: 4.434.600,00 idéntico en las 3 fuentes.
- **IVA cierra**: 931.266,00 idéntico en las 3 fuentes.
- **Totales cierran**: total_gravado = neto+IVA por construcción; total_comprobante = cabecera (identidad garantizada por trigger 0072).
- **NC restando / ND y facturas sumando**: factor de signo verificado (sintético + suite).
- **Tolerancia ±0,02**: diferencia real = **0,00**.

## §4 — Pendiente para after-merge (no ejecutado por protocolo)
Aplicar 0073 → `select * from libro_iva_ventas` debe devolver las 2 filas de período (2026-05: 2 comp / 2026-06: 1 comp) idénticas al dry-run; query #5 de LIBRO-IVA-VENTAS-CONTROL debe devolver 0 filas.
