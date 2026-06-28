# Asistente Fiscal · Ganancias — Documento Técnico v1.0

**Módulo:** Retención de Impuesto a las Ganancias  
**Versión:** 1.0 (estable)  
**Fecha de cierre:** 2026-06-27  
**Estado:** Aprobado para producción  
**Proyecto Supabase:** `arsksytgdnzukbmfgkju` (tops-ordenes-prod)

---

## 1. Arquitectura general

```
┌─────────────────────────────────────────────────────────────────┐
│  NuevaFacturaForm.tsx                                           │
│  (condición: vendorId && netoGravado > 0)                       │
│                          │                                      │
│            ┌─────────────▼──────────────┐                       │
│            │  RetenciongananciasPanel   │  ← Client Component  │
│            │  "Asistente Fiscal"        │                       │
│            └──┬──────────────────┬──────┘                       │
│               │                  │                              │
│    Server Action            Motor puro                         │
│  retencion-actions.ts    retencion-ganancias.ts                 │
│       │  (Next.js)            (sin efectos)                     │
│       │                                                         │
│  ┌────▼────────────────────────────────────────┐               │
│  │  Supabase PostgreSQL (prod)                  │               │
│  │                                              │               │
│  │  RPCs (SECURITY DEFINER)                     │               │
│  │  ├── ap_get_retencion_context                │               │
│  │  ├── ap_upsert_retencion_ganancias           │               │
│  │  ├── ap_set_vendor_concepto_ganancias        │               │
│  │  ├── ap_emitir_certificado_ganancias         │               │
│  │  └── ap_fiscal_dashboard_kpis               │               │
│  │                                              │               │
│  │  Tablas                                      │               │
│  │  ├── vendors (+ campos fiscales)             │               │
│  │  ├── ganancias_retention_params              │               │
│  │  ├── ganancias_escala_honorarios             │               │
│  │  ├── ganancias_retenciones                   │               │
│  │  └── ganancias_certificados                  │               │
│  │                                              │               │
│  │  Vistas                                      │               │
│  │  ├── v_fiscal_dashboard_ganancias            │               │
│  │  ├── v_fiscal_resumen_mensual                │               │
│  │  ├── v_fiscal_ranking_proveedores            │               │
│  │  └── v_fiscal_resumen_concepto               │               │
│  └──────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

**Archivos fuente:**

| Archivo | Responsabilidad |
|---------|----------------|
| `src/lib/fiscal/engine.ts` | Interfaces base del framework fiscal genérico |
| `src/lib/compras/retencion-ganancias.ts` | Motor de cálculo puro (sin efectos secundarios) |
| `src/lib/compras/RETENCION_GANANCIAS.md` | Documentación operativa del módulo |
| `src/app/(app)/compras/facturas/nueva/retencion-actions.ts` | Server Actions de Next.js |
| `src/components/compras/RetenciongananciasPanel.tsx` | UI — "Asistente Fiscal" |

---

## 2. Flujo de cálculo

```
Usuario selecciona proveedor en NuevaFacturaForm
              │
              ▼
  fetchRetenciónContextAction(vendorId, fecha)
  └── RPC ap_get_retencion_context
      ├── vendor: id, razon, cuit, concepto_ganancias,
      │           exento_ganancias, cert_exclusion_hasta, cond_iva
      ├── params: 7 claves (mínimos + alícuotas) por vigente_desde
      ├── escala: 8 tramos progresivos por vigente_desde
      ├── acumulado_previo: Σ neto_gravado del mes calendario
      ├── normativa_version: MAX(vigente_desde params, escala)
      └── retencion_existente: bool (¿ya hay retención este mes?)
              │
              ▼
  ¿vendor.concepto_ganancias es null?
  ├── SÍ → Setup inline (ConceptoSetup)
  │         └── saveVendorConceptoGananciasAction()
  │             └── RPC ap_set_vendor_concepto_ganancias
  └── NO ↓
              │
              ▼
  calculateIncomeTaxRetention(params)   ← función pura, sin red
  │
  ├── R1: exentoProveedor? → no retiene (confianza: validar)
  ├── R2: !esFacturaA? → no retiene
  │       ├── FACTURA_C → resumen: "Monotributista"
  │       └── otro → resumen: "No aplica este tipo"
  ├── R3: concepto excluido? → no retiene
  └── R4: Factura A + concepto gravado
      ├── acumuladoTotal = acumuladoPrevio + netoGravado
      ├── baseImponible = acumuladoTotal − mínimo
      ├── baseImponible ≤ 0 → no retiene
      ├── honorarios → escala progresiva
      │   └── buscarTramo(base) → fijo + pct × excedente
      └── servicios/mercaderías/alquileres → lineal
          └── alícuota × base
              │
              ▼
  RetenciónResult {
    corresponde, estado (ok/warn/revision),
    confianza (automatico/validar),
    resumenEjecutivo,
    retencion, netoPagar,
    normativaVersion, ... (22 campos de auditoría)
  }
              │
              ▼
  Panel determina semáforo:
  ├── 🔴 rojo    → cert_exclusion vigente OR retención_existente+corresponde
  ├── 🟠 naranja → corresponde=true
  └── 🟢 verde   → corresponde=false (condición clara)
              │
              ▼
  Al crear la factura (supplierInvoiceId llega como prop):
  saveRetenciónAction(id, result, fechaPago)
  └── RPC ap_upsert_retencion_ganancias (22 params, INSERT ON CONFLICT)
```

---

## 3. Tablas

### `vendors` (campos agregados por migración 0100)

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `concepto_ganancias` | text | `honorarios\|mercaderias\|servicios\|alquileres\|excluido` |
| `exento_ganancias` | boolean | Exención individual por resolución AFIP |
| `cert_exclusion_hasta` | date | Vigencia del certificado de exclusión (RG AFIP) |
| `cond_iva` | text | `RI\|Monotributista\|Exento\|No Responsable` |

### `ganancias_retention_params`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `concepto` | text | `honorarios\|mercaderias\|servicios\|alquileres` |
| `param_key` | text | `min_no_sujeto\|alicuota` |
| `valor` | numeric | Importe o porcentaje |
| `vigente_desde` | date | Clave de versión normativa |
| `descripcion` | text | Referencia a la norma (RG AFIP) |

### `ganancias_escala_honorarios`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `desde` | numeric | Límite inferior del tramo |
| `hasta` | numeric\|null | Límite superior (null = sin límite) |
| `fijo` | numeric | Importe fijo del tramo |
| `pct` | numeric | Porcentaje sobre excedente |
| `vigente_desde` | date | Clave de versión normativa |

### `ganancias_retenciones` (registro de auditoría)

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `supplier_invoice_id` | uuid | FK a supplier_invoices (UNIQUE) |
| `concepto` | text | Concepto aplicado |
| `tipo_comprobante` | text | Tipo de factura |
| `fecha_pago` | date | Fecha del pago |
| `neto_gravado` | numeric | Neto de esta factura |
| `acumulado_previo` | numeric | Acumulado anterior del mes |
| `acumulado_total` | numeric | Total acumulado (previo + esta) |
| `minimo_no_sujeto` | numeric | Mínimo aplicado |
| `base_imponible` | numeric | Base = acumulado − mínimo |
| `excedente` | numeric | Monto sobre límite del tramo |
| `alicuota` | numeric | Porcentaje aplicado |
| `fijo_escala` | numeric | Importe fijo del tramo (honorarios) |
| `pct_monto` | numeric | Monto del porcentaje sobre excedente |
| `retencion` | numeric | Retención total practicada |
| `neto_a_pagar` | numeric | Total factura − retención |
| `corresponde` | boolean | Si se practicó retención |
| `motivo` | text | Descripción técnica del resultado |
| `tramo_txt` | text | Descripción del tramo (honorarios) |
| `metodo` | text | `escala\|lineal\|excluido` |
| `observaciones` | text | Notas manuales opcionales |
| `normativa_version` | text | Fecha de vigencia de los parámetros aplicados |
| `created_by` | uuid | Usuario que ejecutó el cálculo |
| `created_at` | timestamptz | Fecha/hora del registro |
| `updated_at` | timestamptz | Última modificación |

### `ganancias_certificados`

Registro de certificados de exclusión emitidos. Columnas: `vendor_id`, `numero`, `vigente_hasta`, `archivo_url`, `emitido_by`, `created_at`.

---

## 4. Vistas

| Vista | Uso |
|-------|-----|
| `v_fiscal_dashboard_ganancias` | Base de todos los reportes. Join retenciones + facturas + vendors. Incluye flag `evitada_por_certificado`. |
| `v_fiscal_resumen_mensual` | Evolución mes a mes: operaciones, con/sin retención, evitadas por cert, total retenido. |
| `v_fiscal_ranking_proveedores` | Ranking por importe retenido. |
| `v_fiscal_resumen_concepto` | Distribución por tipo de concepto. |

---

## 5. RPCs

### `ap_get_retencion_context(p_vendor_id uuid, p_fecha date) → jsonb`

Una sola llamada que devuelve todo el contexto necesario para el panel. Selecciona automáticamente la vigencia de parámetros y escala más reciente ≤ p_fecha.

**Retorna:** `{ vendor, params, escala, acumulado_previo, normativa_version, retencion_existente }`

### `ap_upsert_retencion_ganancias(...22 params...) → uuid`

INSERT ON CONFLICT (supplier_invoice_id). Persiste la retención con trazabilidad completa incluyendo `normativa_version` y `created_by` (auth.uid()).

### `ap_set_vendor_concepto_ganancias(p_vendor_id uuid, p_concepto text) → void`

Guarda el concepto de retención en `vendors`. Valida el enum antes de actualizar.

### `ap_emitir_certificado_ganancias(p_vendor_id uuid, p_vigente_hasta date) → uuid`

Emite un certificado de exclusión de retención numerado con `ganancias_cert_seq`.

### `ap_acumulado_mensual_proveedor(p_vendor_id uuid, p_fecha date) → numeric`

Retorna el acumulado de retenciones del proveedor en el mes de p_fecha.

### `ap_fiscal_dashboard_kpis(p_desde date, p_hasta date) → jsonb`

KPIs agregados para el tablero: total retenido, operaciones, top proveedores, por concepto, por mes, evitadas por certificado.

---

## 6. Migraciones

| Migración | Versión aplicada | Contenido |
|-----------|-----------------|-----------|
| `0099_ganancias_retencion` | 20260627211326 | Tablas base (`ganancias_retention_params`, `ganancias_escala_honorarios`, `ganancias_retenciones`, `ganancias_certificados`), secuencia `ganancias_cert_seq`, RLS, seed de parámetros validados, RPCs v1 |
| `0100_vendors_fiscal_ganancias` | 20260627212848 | Campos fiscales en `vendors`, columnas `normativa_version` y `pct_monto` en `ganancias_retenciones`, RPC consolidado `ap_get_retencion_context`, `ap_set_vendor_concepto_ganancias`, `ap_upsert_retencion_ganancias` v2 |
| `0101_fiscal_dashboard_views` | 20260627 | 4 vistas de dashboard, 4 índices de performance, `ap_fiscal_dashboard_kpis` |

---

## 7. Estructura de auditoría

Cada retención registrada en `ganancias_retenciones` permite reconstruir el cálculo completo:

```
Retención #uuid
├── ¿Cuándo?          fecha_pago, created_at
├── ¿Quién la cargó?  created_by (auth.uid())
├── ¿Qué factura?     supplier_invoice_id → supplier_invoices → vendor_id
├── ¿Qué normativa?   normativa_version (vigente_desde de params y escala)
├── ¿Cuánto se cobró? neto_gravado, total_factura
├── ¿Cómo se calculó? acumulado_previo, acumulado_total, minimo_no_sujeto,
│                     base_imponible, excedente, alicuota, fijo_escala,
│                     pct_monto, retencion, neto_a_pagar
├── ¿Qué método?      metodo (escala/lineal/excluido), tramo_txt
└── ¿Por qué?         motivo (descripción técnica)
```

Dado que `normativa_version` registra la fecha de vigencia de los parámetros utilizados, es posible consultar `ganancias_retention_params` y `ganancias_escala_honorarios` con esa fecha y reproducir exactamente el cálculo original, incluso si la normativa fue actualizada posteriormente.

---

## 8. Parametrización — actualizar sin tocar código

Cuando AFIP modifique mínimos, alícuotas o escala, se insertan nuevas filas con la nueva `vigente_desde`. El sistema selecciona automáticamente la vigencia correcta para cada fecha de factura.

```sql
-- Ejemplo: nuevo mínimo de honorarios a partir del 1° de julio
INSERT INTO ganancias_retention_params
  (concepto, param_key, valor, vigente_desde, descripcion)
VALUES
  ('honorarios', 'min_no_sujeto', 200000, '2026-07-01', 'RG AFIP 5xxx/2026');

-- Ejemplo: nueva escala a partir del 1° de julio
INSERT INTO ganancias_escala_honorarios
  (desde, hasta, fijo, pct, vigente_desde)
VALUES
  (0,       80000,  0,      5,  '2026-07-01'),
  (80000,   160000, 4000,   9,  '2026-07-01'),
  -- ... resto de tramos
  (900000,  null,   180000, 31, '2026-07-01');
```

Las operaciones anteriores a `2026-07-01` seguirán usando los parámetros originales registrados en `normativa_version`.

---

## 9. Puntos de extensión — IVA, IIBB, percepciones

El framework en `src/lib/fiscal/engine.ts` define las interfaces base:

```typescript
// Extender para un nuevo régimen:
interface IVARetenciónParams extends FiscalBaseParams {
  cuitAgente: string;
  // ...
}

interface IVARetenciónResult extends FiscalBaseResult {
  // campos específicos de IVA
}

const ivaEngine: FiscalEngine<IVARetenciónParams, IVARetenciónResult> = {
  impuesto: "iva",
  calcular: (params) => { /* lógica RG 2408 */ },
};
```

**Pasos para agregar un nuevo impuesto:**

1. Crear `src/lib/fiscal/<impuesto>/engine.ts` implementando `FiscalEngine<TParams, TResult>`
2. Crear tablas `<impuesto>_retention_params` y `<impuesto>_retenciones` (mismo patrón que Ganancias)
3. Crear RPC `ap_get_<impuesto>_context` con el mismo contrato de respuesta
4. Crear server actions en `src/app/(app)/compras/facturas/nueva/<impuesto>-actions.ts`
5. Registrar el impuesto en `IMPUESTOS_REGISTRADOS` en `engine.ts`
6. Reutilizar el layout del panel (`card`, semáforo, resumen ejecutivo, detalle expandible)

El Asistente Fiscal puede evolucionar hacia un panel unificado que muestre todos los regímenes activos para una factura dada, sin necesidad de refactorizar el código existente.

---

## 10. Lógica de retención vigente (v1.0)

| Concepto | Mínimo no sujeto | Método | Alícuota/Escala |
|----------|-----------------|--------|-----------------|
| Honorarios | $160.000 | Escala progresiva | 5% → 31% (8 tramos) |
| Mercaderías | $224.000 | Lineal | 2% sobre excedente |
| Servicios | $67.170 | Lineal | 2% sobre excedente |
| Alquileres | $11.200 | Lineal | 6% sobre excedente |
| Factura C | — | Excluido | Monotributista |
| Excluidos | — | Excluido | Luz, gas, telefonía, seguros |

El acumulado considera todas las facturas pagadas al mismo proveedor en el **mes calendario** de la fecha de pago.

---

*Documento generado al cierre del desarrollo. Versión 1.0 — no modificar sin requerimiento funcional o cambio normativo explícito.*
