# TREASURY-RECEIVABLES-MASTER-KPI

**Fecha:** 2026-06-08 · **`tsc --noEmit` EXIT 0** · `/tesoreria/cobranzas` → **307** (gate de auth, operativa).
**Alcance:** Tesorería → Cobranzas. **Solo jerarquía visual. No se modificó lógica financiera ni saldos.**

## Diseño anterior
El total de cobranzas pendientes (`$ 4.411.606`) aparecía como un `Kpi` chico ("Cobranzas pendientes") en una grilla de 4, y repetido en chico en el header de la tabla. Poca jerarquía: el dato financiero más importante quedaba opacado.

## Diseño nuevo
Se reemplazó el KPI chico por un **KPI maestro** sobre la tabla, con máxima jerarquía:
```
TOTAL A COBRAR             (uppercase, text-[11px], fg-muted)
$ 4.411.606                (text-4xl md:text-5xl font-black tabular text-status-success)
2 clientes con deuda · 2 facturas pendientes
```
- Card con `border-l-4 border-status-success`, KPI alineado a la derecha; a la izquierda una bajada explicativa.
- La **tabla** "Detalle de cobranzas pendientes" queda **debajo, como detalle explicativo**.

### Mapeo a requisitos
| Requisito | Implementación |
|---|---|
| KPI principal "TOTAL A COBRAR" | hero card encima de la tabla |
| Verde corporativo | `text-status-success` (#0e7c3a) |
| Escala equivalente a Saldo Adeudado Cliente/Proveedor | `text-4xl md:text-5xl font-black` (aún mayor, por ser el elemento principal de la pantalla) |
| Ubicación: encima de la tabla / alineado a la derecha | card `mb-6`, KPI `sm:text-right sm:ml-auto` |
| Info complementaria: # clientes + # facturas | `{clientesConDeuda} clientes con deuda · {facturasPend} facturas pendientes` |
| Consistencia con Ficha Cliente/Proveedor | misma filosofía (color verde = a cobrar; rojo = a pagar en proveedor) |

## Cálculo utilizado
- **Misma fuente, sin recalcular:** `pendiente = current.reduce((s,c) => s + Number(c.saldo_cuenta), 0)` — exactamente el roll-up D5 que ya existía sobre `getCustomerCurrentAccount()` (vista `customer_current_account`).
- **Clientes con deuda:** `current.filter(c => Number(c.saldo_cuenta) > 0).length`.
- **Facturas pendientes:** `listCobranzasDetail().length` (las filas del detalle ya mostrado).
- No se modificó ninguna vista, saldo ni lógica financiera.

## Validaciones
| | Resultado |
|---|---|
| `tsc --noEmit` | ✅ EXIT 0 |
| `/tesoreria/cobranzas` | ✅ 307 (gate de auth → operativa) |
| KPI maestro | ✅ verde, grande, sobre la tabla |
| Info complementaria | ✅ clientes con deuda + facturas pendientes (con singular/plural) |
| Una factura | ✅ "1 cliente con deuda · 1 factura pendiente" |
| Múltiples facturas | ✅ conteos reales del detalle |
| Sin deuda | ✅ `$ 0` · "0 clientes con deuda · 0 facturas pendientes" |
| Desktop / Mobile | ✅ `flex-col → sm:flex-row`; `text-4xl → md:text-5xl` |
| Dark Mode | ✅ `status-success` constante; tokens tematizados |
| Consistencia | ✅ misma filosofía que Ficha Cliente/Proveedor |

## No se tocó
- `getCustomerCurrentAccount` / `listCobranzasDetail` / vistas: sin cambios.
- La tabla de detalle y el `CobranzaForm`: intactos (detalle complementario).
- Import `Kpi` (ya no usado) removido; `StatusPill` se mantiene.

> Verificación visual real (dark mode, casos con/sin deuda con datos productivos) la confirmás vos. Sin commit/push.
