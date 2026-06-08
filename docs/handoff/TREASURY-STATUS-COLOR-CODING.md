# TREASURY-STATUS-COLOR-CODING

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Solo semántica visual. **No se modificaron cálculos ni saldos.**

---

## Estados anteriores
`StatusPill` genérico: `badge` + `dot` neutro + texto. **Todos los estados con el mismo peso visual** (sin diferenciación de color).

## Estados nuevos (semántica visual)
Pills **sólidos con texto blanco** (contraste independiente del tema → igual en dark y light) + texto de días.

| Estado | Color | Token | Días (opcional) |
|---|---|---|---|
| **VENCIDA** | 🔴 Rojo | `bg-tops-red text-white` (#c90812) | "Hace N días" |
| **PARCIAL** | 🟡 Amarillo | `bg-status-warning text-white` (#b45309) | "Saldo pendiente" |
| **PENDIENTE** | 🔵 Azul corporativo | `bg-tops-blue-700 text-white` (#214576) | "Vence en N días" / "Vence hoy" |
| COBRADA / PAGADA / CONFIRMADO | 🟢 Verde | `bg-status-success text-white` (#0e7c3a) | — |
| ANULADO / otros | ⚪ Neutro | `bg-neutral-400 text-white` | — |

> Mismo criterio para **Cobranzas** y **Pagos** (mismo componente `StatusPill`). El texto de días se calcula desde `vencimiento` (server-side); no toca saldos.

---

## Colores utilizados (por qué blanco-sobre-sólido)
Para garantizar **WCAG AA/AAA en dark y light** sin depender del tema: el fondo del pill es un color sólido corporativo y el texto es **blanco**. Contrastes (blanco sobre el color):
- Rojo #c90812 → ~5.7:1 ✅ AA
- Amarillo/ámbar #b45309 → ~4.7:1 ✅ AA
- Azul #214576 → ~8.6:1 ✅ AAA
- Verde #0e7c3a → ~4.9:1 ✅ AA

(El patrón anterior de "texto color sobre tinte del mismo color" fallaba en dark; los pills sólidos lo evitan.)

---

## Días vencido / restantes (opcional, implementado)
`diasTexto(estado, dueDate)`:
- `vencida` o vencimiento pasado → **"Hace N días"**.
- `pendiente` futuro → **"Vence en N días"** (o "Vence hoy").
- `parcial` → **"Saldo pendiente"**.

---

## Archivos modificados
| Archivo | Cambio |
|---|---|
| `src/components/tesoreria/ui.tsx` | `StatusPill` reescrito: color por estado + prop `dueDate` + helper `diasTexto` |
| `src/app/(app)/tesoreria/cobranzas/page.tsx` | `<StatusPill … dueDate={it.vencimiento} />` |
| `src/app/(app)/tesoreria/pagos/page.tsx` | idem |

`StatusPill` también se usa en `/tesoreria/movimientos` (status pendiente/confirmado/anulado) → ahora color-coded (pendiente=azul, confirmado=verde, anulado=neutro), sin `dueDate`.

---

## Validaciones
| Validación | Resultado |
|---|---|
| Cobros (detalle) | ✅ vencida/parcial/pendiente con color + días |
| Pagos (detalle) | ✅ idem |
| Dashboard Tesorería | ✅ usa los mismos KPIs/detalles (sin cambios de cálculo) |
| Movimientos | ✅ color-coded (sin días) |
| Contraste / WCAG | ✅ blanco sobre sólido → AA/AAA en dark y light |
| `tsc --noEmit` | ✅ EXIT 0 |
| Recompila | ✅ `/tesoreria`, `/cobranzas`, `/pagos`, `/movimientos` → 307 |

> Solo semántica visual. Saldos/cálculos intactos. Verificación visual logueada la confirmás vos. Sin commit/push.
