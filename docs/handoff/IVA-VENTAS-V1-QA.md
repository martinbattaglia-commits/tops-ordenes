# IVA-VENTAS-V1-QA — Evidencia de validación

**Fecha:** 2026-06-12 · **Rama:** `feature/iva-ventas-v1` (`02c214a`)

## §1 — Validaciones técnicas
| Validación | Resultado |
|---|---|
| `tsc --noEmit` | ✅ EXIT 0 |
| `next lint` | ✅ 0 errores |
| `next build` | ✅ EXIT 0 (compila completo) |
| Deploy Preview (PR #17) | ver IVA-VENTAS-V1-GATE.md |

## §2 — Suite V1: `scripts/qa/iva-ventas-v1-test.ts` — **10/10 PASS**
| # | Caso | Mandato |
|---|---|---|
| V1 | `alicuotaToId(19)` lanza error (antes: 21% silencioso) | G7 |
| V1b | Alícuotas válidas siguen mapeando (10,5 → Id 4) | G7 |
| V2 | Emisión con 19% rechazada con error explícito, sin excepción | G7 |
| V3 | Factura multi-alícuota (21/10,5/0) → 3 líneas IVA | #1/#2 |
| V3b | Pares AFIP válidos en todas las líneas | #1 |
| V4/V4b | Σ neto y Σ IVA de líneas = cabecera, diferencia $0,00 | #4 |
| V5 | Stress 9 renglones con centavos impares: identidad se sostiene | #4 |
| V6 | Backfill (`GROUP BY` items) ≡ vat_lines emitidas | #3 |
| V7 | Roundtrip Id↔alícuota para los 6 códigos AFIP | G7 |

## §3 — Regresión FISCAL-HARDENING: `scripts/qa/fiscal-hardening-test.ts` — **15/15 PASS**
NC/ND (CbtesAsoc, tope, letra, receptor), guard anti doble facturación: sin regresiones tras el cambio de persistencia. Nota: la suite de hardening usa alícuota explícita 21 en todos los casos — compatible con la alícuota ahora obligatoria.

## §4 — Revisión SQL de 0072 (no aplicada)
| Check | Resultado |
|---|---|
| Numeración 0072 libre en main | ✅ (verificada al crear la rama desde `675ac9e`) |
| Patrón espejo de 0056 (par AFIP, guard via_rpc, RLS, índices) | ✅ |
| `create constraint trigger ... deferrable initially deferred` solo afecta INSERTs nuevos (backfill histórico validado por §7, no por el trigger) | ✅ |
| RPC: `security definer` + `set search_path` + revoke public + gate de rol espejo del RLS | ✅ |
| Cero DROP / DELETE / UPDATE de datos; aditiva + backfill INSERT idempotente | ✅ |
| CHECK `ii_alic_pair_chk` valida los datos existentes (todos los renglones reales son 21% / Id 5) | ✅ se valida definitivamente al aplicar (fail-fast si hubiera fila inválida) |
| Compatibilidad de consumidores: nadie lee aún `customer_invoice_vat_lines` (V2 será el primer lector) | ✅ |

## §5 — Limitaciones conocidas y honestas
1. **Atomicidad real solo con 0072 aplicada**: con la migración pendiente, la emisión vía código nuevo falla controladamente (RPC inexistente) — fail-closed coherente con el mandato. El runbook del gate aplica 0072 inmediatamente tras el deploy.
2. **Demo/dev**: el mock no pasa por la DB (limitación preexistente documentada en FISCAL-HARDENING-QA §3); las garantías de base (trigger, CHECKs, RPC) se prueban al aplicar 0072 — la migración es auto-verificante.
3. El dry-run de backfill contra producción quedó como SQL de solo lectura en el BACKFILL-REPORT §4, para ejecutar en la sesión de revisión (directiva: detenerse antes de tocar producción).
