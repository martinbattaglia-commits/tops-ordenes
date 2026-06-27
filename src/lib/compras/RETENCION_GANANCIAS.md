# Módulo: Retención de Ganancias — Nexus ERP

## Arquitectura

```
DB (Supabase prod)
  ├── ganancias_retention_params        parámetros (mínimos + alícuotas) versionados por fecha
  ├── ganancias_escala_honorarios       escala progresiva versionada por fecha
  ├── ganancias_retenciones             registro de cada retención calculada (auditoría completa)
  └── ganancias_certificados            certificados de exclusión emitidos

RPCs (SECURITY DEFINER)
  ├── ap_get_retencion_context(vendor_id, fecha)   → contexto completo en 1 llamada
  ├── ap_upsert_retencion_ganancias(...)            → persiste la retención (INSERT ON CONFLICT)
  ├── ap_set_vendor_concepto_ganancias(...)         → guarda el concepto en vendors
  ├── ap_emitir_certificado_ganancias(...)          → emite certificado de exclusión
  └── ap_fiscal_dashboard_kpis(desde, hasta)       → KPIs para el tablero

src/lib/fiscal/engine.ts                           interfaces base (framework reutilizable)
src/lib/compras/retencion-ganancias.ts             motor puro, sin efectos secundarios
src/app/(app)/compras/facturas/nueva/
  ├── retencion-actions.ts                          server actions (Next.js)
  └── NuevaFacturaForm.tsx                          integración en el flujo de factura
src/components/compras/RetenciongananciasPanel.tsx  Asistente Fiscal (UI)
```

## Flujo del cálculo

```
1. Usuario abre "Nueva Factura" y selecciona un proveedor
2. Panel llama fetchRetenciónContextAction(vendorId, fecha)
   └── RPC ap_get_retencion_context → vendor + params + escala + acumulado + normativa_version
3. Si vendor.concepto_ganancias es null → setup inline (se guarda una sola vez)
4. calculateIncomeTaxRetention(params) ejecuta en el cliente (sin red):
   a. exentoProveedor?          → no retiene
   b. no es Factura A?          → no retiene
   c. concepto excluido?        → no retiene
   d. acumulado < mínimo?       → no retiene
   e. honorarios → escala progresiva
   f. servicios/mercaderías/alquileres → alícuota lineal
5. Panel muestra semáforo + resumen ejecutivo + detalle expandible
6. Al crear la factura → saveRetenciónAction persiste auditoría completa
```

## Lógica de retención

| Concepto      | Método     | Mínimo no sujeto | Alícuota / Método     |
|---------------|------------|-------------------|-----------------------|
| Honorarios    | Escala     | $160.000          | Progresiva 5% → 31%   |
| Mercaderías   | Lineal     | $224.000          | 2% sobre excedente    |
| Servicios     | Lineal     | $67.170           | 2% sobre excedente    |
| Alquileres    | Lineal     | $11.200           | 6% sobre excedente    |
| Factura C     | Excluido   | —                 | Monotributista        |
| Excluidos     | Excluido   | —                 | Luz, gas, telefonía…  |

El acumulado considera **todas las facturas pagadas al mismo proveedor en el mes calendario**.

## Actualizar parámetros cuando cambia la normativa

Los valores están en la tabla `ganancias_retention_params` (filas separadas por `concepto` y `param_key`).
**No tocar el código** para actualizar alícuotas o mínimos. Solo ejecutar:

```sql
-- Ejemplo: nuevo mínimo de honorarios desde 2026-07-01
INSERT INTO ganancias_retention_params (concepto, param_key, valor, vigente_desde, descripcion)
VALUES ('honorarios', 'min_no_sujeto', 200000, '2026-07-01', 'Actualización RG AFIP jul-2026');

-- Nuevo tramo de escala desde 2026-07-01
INSERT INTO ganancias_escala_honorarios (desde, hasta, fijo, pct, vigente_desde)
VALUES (0, 80000, 0, 5, '2026-07-01'),
       -- ... resto de tramos ...
       ;
```

El sistema selecciona automáticamente la vigencia más reciente ≤ fecha de la factura.
Operaciones anteriores mantienen los parámetros históricos en el registro de auditoría.

## Semáforo del Asistente Fiscal

| Color | Significado | Cuándo aparece |
|-------|-------------|----------------|
| 🟢 Verde | No corresponde retener | Factura B/C, exento, excluido, bajo mínimo |
| 🟠 Naranja | Corresponde retener | Factura A con base imponible > 0 |
| 🔴 Rojo | Revisar manualmente | Certificado de exclusión vigente, retención duplicada posible |

## Framework fiscal — extensión a otros impuestos

Ver `src/lib/fiscal/engine.ts` para las interfaces base `FiscalEngine<TParams, TResult>`.

Para agregar IVA, Ingresos Brutos u otro régimen:
1. Crear `src/lib/fiscal/iva/engine.ts` implementando `FiscalEngine`
2. Crear tablas `iva_retention_params`, `iva_retenciones`
3. Crear RPC `ap_get_iva_retencion_context`
4. Registrar el impuesto en `IMPUESTOS_REGISTRADOS` (engine.ts)
5. El panel del Asistente Fiscal detecta y muestra todos los motores registrados

## Vistas del Dashboard Fiscal

| Vista | Descripción |
|-------|-------------|
| `v_fiscal_dashboard_ganancias` | Detalle de cada operación con datos de proveedor |
| `v_fiscal_resumen_mensual` | Evolución mes a mes |
| `v_fiscal_ranking_proveedores` | Ranking por importe retenido |
| `v_fiscal_resumen_concepto` | Retenciones por tipo de concepto |

KPI agregados: `SELECT ap_fiscal_dashboard_kpis('2026-01-01', '2026-12-31');`

## Advertencia importante

Los resultados son **orientativos**. Las retenciones definitivas deben validarse
con el estudio contable. El sistema no reemplaza el criterio profesional en casos
con certificados de exclusión, exenciones individuales o regímenes especiales.
