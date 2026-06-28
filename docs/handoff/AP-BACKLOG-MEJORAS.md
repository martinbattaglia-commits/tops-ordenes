# Backlog de Mejoras — Compras / Cuentas por Pagar

> Ítems **no urgentes** surgidos durante la validación funcional del circuito de Compras (Conciliación OC↔Factura + alta de factura por OCR).
> **No son correcciones**: la integridad y la persistencia funcionan correctamente. Son mejoras de experiencia/robustez para una próxima Release.
> Decisión registrada por Martín B. el 2026-06-28.

---

## B-01 · Chequeo proactivo de facturas duplicadas en el formulario (UX)

- **Tipo:** Mejora de UX · **Prioridad:** Baja · **Estado:** Backlog (próxima Release)
- **Resumen:** La integridad ya está garantizada (constraint `UNIQUE (vendor_id, tipo_comprobante, punto_venta, numero)` + manejo `DUPLICATE_INVOICE` en el RPC + traducción en `humanizeApRpcError`). Falta avisar al usuario del duplicado **antes** de confirmar, en vez de recién al enviar.
- **Propuesta:** server action `checkDuplicateInvoiceAction(vendor, tipo, pv, numero)` + advertencia inline on-blur en `NuevaFacturaForm`. Sin migración, sin tocar RPC/BD.
- **Estimado:** ~2–3 h con tests.
- **Detalle completo:** [`AP-INFORME-A-PREVENCION-DUPLICADOS.md`](./AP-INFORME-A-PREVENCION-DUPLICADOS.md)

---

## B-02 · Observación de infraestructura: HTTP 503 en Preview al guardar (hardening diferido)

- **Tipo:** Observación de infraestructura / hardening · **Prioridad:** Baja-Media · **Estado:** Backlog (seguimiento)
- **Resumen:** 503 transitorio observado **sólo en el entorno Preview** de Netlify (deploy draft, cold-start + concurrencia limitada) al guardar una factura, amplificado por una ráfaga de ~5 requests concurrentes post-guardado. **Sin pérdida de datos** (RPC atómico; la factura persistió). No se reproduce de forma determinística por código.
- **Decisión:** No se modifica el flujo de producción por este comportamiento. Hardening opcional (secuenciar efectos post-guardado + navegación única) queda diferido.
- **Seguimiento:** si reaparece en un deploy estable/prod, revisar logs de función en la UI de Netlify o ejecutar reproducción controlada.
- **Detalle completo:** [`AP-INFORME-B-HTTP-503-PREVIEW.md`](./AP-INFORME-B-HTTP-503-PREVIEW.md)

---

## Hallazgos de la validación E2E (2026-06-28) — backlog próximo ciclo

> Registrados durante la validación funcional del circuito de Compras. **No bloquean el release** (decisión de Martín B.). Detalle en [`AP-PLAN-VALIDACION-COMPRAS-E2E.md`](./AP-PLAN-VALIDACION-COMPRAS-E2E.md).

| # | Severidad | Hallazgo | Recomendación |
|---|---|---|---|
| **H-1** | Media (integridad) | CUIT sin normalizar: `createVendor` guarda crudo (`20163361788`) vs legacy con guiones → `UNIQUE(cuit)` no frena duplicados por formato. | Normalizar CUIT a forma canónica antes de guardar + índice único sobre el valor normalizado; dedupe del maestro. |
| **H-2** | Media (fiscal/UX) | Fecha **−1 día** en listados/comparación de Compras (`compras/format.ts`, TZ de máquina). | Unificar al formateador AR-TZ de `utils.ts` (el del fix d). |
| **H-3** | Media (UX/estabilidad) | Hidratación React **#425/#422** en el preview A4 de OC (`/compras/nueva`, `/compras/ordenes/[id]`) por `new Date()` SSR/cliente. | Aplicar el patrón TZ-fija/`suppressHydrationWarning` o render client-only de la fecha/hora del preview. |
| **H-4** | Baja (política) | Se puede **pagar una factura no aprobada** (handoff excluye solo anuladas). | Definir si el pago exige `approval_status='aprobada'` y, en su caso, enforcement en el gate. |
| **H-5** | Baja (seguridad) | **RBAC de Compras no cableado** (permisos `compras.*` no aplicados en nav/páginas). | Cablear los permisos `compras.*` en middleware/guards. |
| **H-6** | Baja (cosmético) | Dashboard: saludo fijo "José Luis" + KPIs/chart anclados a mayo (`now` fijo). | Usar el usuario real y `now` dinámico. |
| **H-7** | Baja (UX) | Agregados del listado de proveedores (OC histórico/comprado YTD/última OC) en 0/—. | Revisar la agregación/period del listado de proveedores. |

## Datos de prueba a conservar (NO eliminar todavía)

Se mantienen como casos de prueba mientras se finaliza la validación funcional del módulo de Compras:

| Comprobante | Proveedor | Detalle |
|---|---|---|
| `FP-2026-0024` | Bulonera Balemap | Usada en la validación de Conciliación OC↔Factura |
| `FP-2026-0025` | Mobiliarios Fontenla SA | Alta por OCR — validación E2E del circuito de factura |

Se eliminarán recién cuando se complete la validación funcional completa del circuito de Compras (pendiente de autorización de Martín B.).
