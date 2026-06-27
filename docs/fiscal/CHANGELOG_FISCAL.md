# CHANGELOG — Asistente Fiscal · Ganancias

---

## v1.0.0 — 2026-06-27 (versión inicial estable)

### Funcionalidades incorporadas

**Motor de cálculo (`src/lib/compras/retencion-ganancias.ts`)**
- Función pura `calculateIncomeTaxRetention()` sin efectos secundarios ni valores hardcodeados
- Soporte para 4 conceptos gravados: honorarios (escala progresiva), mercaderías, servicios, alquileres (alícuota lineal)
- Soporte para conceptos excluidos: luz, gas, telefonía, internet, seguros, y "excluido genérico"
- Reglas de prioridad: exento individual → tipo de comprobante → concepto → mínimo → cálculo
- Resumen ejecutivo en lenguaje simple para administrativos (`resumenEjecutivo`)
- Semáforo de tres estados: `ok` / `warn` / `revision`
- Nivel de confianza: `automatico` / `validar`
- Trazabilidad del método aplicado: `escala` / `lineal` / `excluido`

**Panel UI — Asistente Fiscal (`src/components/compras/RetenciongananciasPanel.tsx`)**
- Carga automática de contexto al seleccionar proveedor (sin entrada manual)
- Semáforo visual 🟢🟠🔴 con título, resumen ejecutivo e importe de retención
- Indicador de nivel de confianza con ícono
- Setup inline de concepto (una vez por proveedor, persiste en DB)
- Alertas inteligentes: monotributista, exento, certificado de exclusión (vigente y vencido), retención duplicada posible, acumulado ≥70% del mínimo
- Detalle expandible paso a paso (base, excedente, tramo, alícuota, fijo, neto a pagar)
- Modal "Ver normativa aplicada" con tabla de parámetros y escala completa
- Guardado automático de la retención al crear la factura (sin acción manual)
- Indicador de persistencia (guardando / guardado con trazabilidad)

**Server Actions (`src/app/(app)/compras/facturas/nueva/retencion-actions.ts`)**
- `fetchRetenciónContextAction`: una sola llamada a la DB (RPC consolidado)
- `saveRetenciónAction`: persiste 22 campos de auditoría incluyendo normativa_version y created_by
- `saveVendorConceptoGananciasAction`: guarda concepto por proveedor

**Framework fiscal genérico (`src/lib/fiscal/engine.ts`)**
- Interfaces base `FiscalBaseParams`, `FiscalBaseResult`, `FiscalEngine<TParams, TResult>`
- Tipos compartidos `EstadoSemaforo`, `NivelConfianza`, `VendorFiscalBase`
- Registro `IMPUESTOS_REGISTRADOS` como punto de extensión
- Helpers `redondear2()`, `formatPesosAR()` reutilizables

**Base de datos — Migración 0099**
- Tabla `ganancias_retention_params` con parámetros versionados por `vigente_desde`
- Tabla `ganancias_escala_honorarios` con escala progresiva versionada
- Tabla `ganancias_retenciones` con auditoría completa (22 columnas)
- Tabla `ganancias_certificados` para certificados de exclusión
- Secuencia `ganancias_cert_seq` para numeración de certificados
- RLS: lectura para `authenticated`, escritura solo vía RPCs `SECURITY DEFINER`
- Seed de parámetros validados por la contadora

**Base de datos — Migración 0100**
- Campos fiscales en `vendors`: `concepto_ganancias`, `exento_ganancias`, `cert_exclusion_hasta`, `cond_iva`
- Columnas de auditoría en `ganancias_retenciones`: `normativa_version`, `pct_monto`
- RPC `ap_get_retencion_context`: contexto completo en una sola llamada
- RPC `ap_set_vendor_concepto_ganancias`: persistencia del concepto por proveedor
- RPC `ap_upsert_retencion_ganancias` v2: 22 parámetros, INSERT ON CONFLICT

**Base de datos — Migración 0101**
- 4 índices de performance en `ganancias_retenciones` (fecha_pago, concepto, corresponde, supplier_invoice_id)
- Vista `v_fiscal_dashboard_ganancias`: base de todos los reportes
- Vista `v_fiscal_resumen_mensual`: evolución mes a mes
- Vista `v_fiscal_ranking_proveedores`: ranking por importe retenido
- Vista `v_fiscal_resumen_concepto`: distribución por concepto
- RPC `ap_fiscal_dashboard_kpis(desde, hasta)`: KPIs agregados listos para tablero

**Documentación técnica**
- `src/lib/compras/RETENCION_GANANCIAS.md`: documentación operativa con instrucciones de actualización normativa
- `docs/fiscal/ASISTENTE_FISCAL_GANANCIAS_v1.md`: documento técnico completo (este repositorio)

### Bugs corregidos

| # | Descripción | Commit lógico |
|---|-------------|---------------|
| 1 | `estado: "ok" \| "warn"` no incluía el estado `"revision"` para condiciones ambiguas | Agregado `"revision"` al tipo y lógica `computeSemaforo()` |
| 2 | `EscalaTramo.hasta: Infinity` causaba errores de serialización JSON al venir de DB | Cambiado a `hasta: number \| null`; la función `buscarTramo()` convierte a `Infinity` internamente |
| 3 | `ap_fiscal_dashboard_kpis` fallaba con `aggregate function calls cannot be nested` | Reescrita usando subconsultas en lugar de agregados directos dentro de `jsonb_build_object` |
| 4 | Panel acumulaba re-renders al cambiar `totalFactura` sin cambiar proveedor | `useEffect` protegido con `prevVendor.current` para evitar re-fetches innecesarios |
| 5 | `saveRetenciónAction` se disparaba múltiples veces si el componente re-renderizaba | `prevInvoiceId.current` evita ejecuciones duplicadas; `resultRef.current` captura el último resultado |

### Decisiones de diseño

**Una sola llamada a la DB por panel**
El patrón de RPC consolidado (`ap_get_retencion_context`) evita el waterfall de 3-4 queries separadas desde el cliente. Todo el contexto fiscal llega en un único JSON, incluyendo vendor, parámetros, escala, acumulado del mes y flags de alerta.

**Motor de cálculo como función pura**
`calculateIncomeTaxRetention()` no tiene efectos secundarios ni dependencias externas. Esto permite testearlo exhaustivamente sin DB, probar cambios normativos futuros en modo demo, y ejecutarlo en el cliente sin latencia de red.

**Concepto por proveedor (persistido una vez)**
En lugar de pedir el concepto en cada factura, se configura una sola vez inline y se guarda en `vendors.concepto_ganancias`. Esto elimina la fricción operativa manteniendo la flexibilidad de cambio.

**`vigente_desde` como mecanismo de versión normativa**
En lugar de actualizar filas existentes (lo que rompería la auditoría histórica), cada cambio normativo se inserta como una nueva fila con su fecha de vigencia. El motor selecciona automáticamente la versión correcta para cada fecha de factura.

**Semáforo 🔴 separado del resultado del motor**
El motor de cálculo produce `estado: "ok"|"warn"|"revision"`. El semáforo 🔴 se determina en el panel combinando el resultado del motor con el contexto del proveedor (cert. exclusión, retención duplicada). Esto mantiene el motor puro y permite que el panel agregue inteligencia contextual sin contaminar la lógica de cálculo.

**Guardado automático sin acción del usuario**
La retención se registra automáticamente cuando llega `supplierInvoiceId` como prop (señal de que la factura fue creada exitosamente). El usuario nunca necesita recordar guardar la retención; el módulo garantiza que cada factura procesada tenga su registro de auditoría.

**Preparación para dashboard sin implementarlo**
Las vistas y el RPC de KPIs fueron creados como infraestructura. El tablero visual no se implementó para evitar sobreingeniería — se construirá cuando exista un requerimiento explícito y datos reales acumulados.

### Cambios incompatibles

Ninguno. Este es el primer release del módulo. Las tablas nuevas son aditivas y no modifican el comportamiento de módulos existentes. Los campos agregados a `vendors` tienen valores por defecto (`exento_ganancias DEFAULT false`) que no afectan proveedores existentes.

---

## Pendientes para versiones futuras (backlog, no compromisos)

- Tablero visual de retenciones (`/compras/fiscal`)
- Botón "Emitir certificado de exclusión" en ficha del proveedor
- Extensión a IVA (RG 2408) usando el framework `src/lib/fiscal/engine.ts`
- Extensión a Ingresos Brutos (por jurisdicción)
- Exportación del período a Excel para presentación a AFIP

*Estos ítems no forman parte de v1.0. Requieren un requerimiento funcional explícito para ser iniciados.*
