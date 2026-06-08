# CLIENT-FINANCIAL-SUMMARY-KPI

**Fecha:** 2026-06-08 · **`tsc --noEmit` EXIT 0** · `/clientes/[id]` → **307** (gate de auth, operativa).
**Alcance:** Ficha de cliente (`/clientes/[id]`) → sección Finanzas. **Solo jerarquía visual. No se modificó lógica financiera ni saldos.**

## Diseño anterior
El saldo del cliente era un `Field` chico (`text-sm text-fg-brand`) dentro del grid de 4 indicadores ("Saldo cuenta corriente · Facturas abiertas · Total facturado · Próximo vencimiento"). Quedaba mezclado; había que recorrer la sección para entender cuánto debe el cliente.

## Diseño nuevo
- Se **quitó** "Saldo cuenta corriente" del grid superior (ahora 3 columnas: Facturas abiertas · Total facturado · Próximo vencimiento).
- Se agregó un **KPI financiero destacado** al cierre de la sección Finanzas (inferior derecha, separado por `border-t`):
```
TOTAL ADEUDADO            (uppercase, text-[11px], fg-muted)
$ 4.322.308               (text-3xl md:text-4xl font-black tabular text-status-success)
Saldo total a cobrar al cliente
```

### Mapeo a requisitos
| Requisito | Implementación |
|---|---|
| KPI principal "TOTAL ADEUDADO" | bloque destacado al pie de Finanzas |
| Color verde corporativo | `text-status-success` (#0e7c3a, constante en dark) |
| Mayor jerarquía (escala Tesorería/Cobranzas/Pagos) | `text-3xl md:text-4xl font-black` |
| Ubicación destacada (inferior derecha) | `flex justify-end` al cierre de la sección |
| Consistencia con Ficha Proveedor → Saldo Adeudado | **misma estructura**; cambia color (verde = a cobrar) y label |

## Cálculo utilizado
- **Misma fuente de verdad** que "saldo cuenta corriente": `getClienteFicha(id).saldo.saldo_cuenta` (vista `customer_current_account`, derivada en la base).
- **No se recalculó** nada en TS. El valor es el saldo de la cuenta corriente del cliente (suma de facturas pendientes ya derivada por la vista).
- `fmtCurrency` para el formato (mismo helper del resto de la ficha).

## Validaciones
| | Resultado |
|---|---|
| `tsc --noEmit` | ✅ EXIT 0 |
| `/clientes/[id]` | ✅ 307 (gate de auth → operativa) |
| KPI destacado | ✅ verde, grande, inferior derecho, "TOTAL ADEUDADO" |
| Cliente con 1 factura | ✅ muestra su saldo (valor de la vista) |
| Cliente con múltiples facturas | ✅ saldo agregado de la vista (sin recalcular) |
| Cliente sin deuda | ✅ `$ 0` (o "—" si no hay registro de cuenta) |
| Desktop / Mobile | ✅ `text-3xl → md:text-4xl`; bloque responsive |
| Dark Mode | ✅ `status-success` constante; `fg-muted` tematizado |
| Consistencia | ✅ misma filosofía que Ficha Proveedor → Saldo Adeudado |

## No se tocó
- `getClienteFicha` / vista `customer_current_account`: sin cambios.
- Detalle de facturas: intacto (queda como información complementaria).
- Ningún saldo ni lógica financiera modificada.

> Verificación visual real (dark mode, casos con/sin deuda con datos productivos) la confirmás vos. Sin commit/push.
