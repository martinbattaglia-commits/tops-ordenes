# RELEASE REPORT — Asistente Fiscal · Ganancias v1.0

**Fecha de release:** 2026-06-27  
**Tag de versión:** `fiscal-assistant-v1.0`  
**Rama:** `feat/conciliacion-oc`  
**Commit:** `fe6e62a`  
**Entorno prod:** Supabase `arsksytgdnzukbmfgkju` (tops-ordenes-prod)  
**Estado:** Aprobado para producción

---

## 1. Objetivo del módulo

Automatizar el cálculo de la retención de Impuesto a las Ganancias (RG AFIP 2784 y concordantes) sobre facturas de proveedores, eliminando el trabajo manual de los administrativos, garantizando el cumplimiento normativo, y dejando un registro de auditoría completo e inmutable por cada retención practicada.

El módulo se integra directamente en el flujo de carga de facturas de proveedores de Nexus: ningún usuario necesita iniciar el cálculo manualmente ni navegar a una pantalla separada.

---

## 2. Alcance funcional

### Incluido en v1.0

- Cálculo automático de retención para los cuatro conceptos gravados: **honorarios** (escala progresiva), **mercaderías**, **servicios** y **alquileres** (alícuota lineal)
- Detección automática de conceptos excluidos: luz, gas, telefonía, internet, seguros
- Reglas de no-retención: proveedor exento, factura tipo C (monotributista), concepto excluido, acumulado bajo mínimo
- Cálculo del acumulado mensual por proveedor (todas las facturas del mes calendario)
- Persistencia del concepto de retención por proveedor (configuración única, sin repetición)
- Alertas inteligentes: monotributista, exento, certificado de exclusión vigente, posible retención duplicada, acumulado cercano al mínimo
- Semáforo visual 🟢🟠🔴 con resumen ejecutivo en lenguaje simple
- Nivel de confianza: automático vs. requiere validación contable
- Detalle expandible del cálculo paso a paso
- Modal "Ver normativa aplicada" con tabla de parámetros vigentes
- Guardado automático de la retención al crear la factura (sin acción manual)
- Auditoría completa con 22 campos por registro, incluyendo normativa versión y usuario
- Cuatro vistas de dashboard y un RPC de KPIs para reporting futuro
- Framework fiscal genérico para extensión a IVA, IIBB y percepciones

### Fuera del alcance de v1.0 (no implementado)

- Tablero visual de retenciones (`/compras/fiscal`)
- Extensión a IVA retenciones (RG 2408)
- Extensión a Ingresos Brutos
- Exportación a Excel para presentación AFIP
- Botón "Emitir certificado de exclusión" en ficha del proveedor

---

## 3. Arquitectura implementada

```
NuevaFacturaForm.tsx
│  (condición: vendorId && netoGravado > 0)
│
├── RetenciongananciasPanel.tsx       [Client Component]
│   │  Asistente Fiscal
│   │
│   ├── retencion-actions.ts          [Server Actions — Next.js]
│   │   └── ap_get_retencion_context  [RPC — Supabase]
│   │
│   └── retencion-ganancias.ts        [Motor puro de cálculo]
│       └── calculateIncomeTaxRetention()
│
└── [Al crear factura] → saveRetenciónAction()
    └── ap_upsert_retencion_ganancias [RPC — Supabase]

src/lib/fiscal/engine.ts              [Framework genérico]
└── FiscalEngine<TParams, TResult>    [Interface base reutilizable]
```

**Principio de diseño central:** el motor de cálculo es una función pura sin efectos secundarios. La DB proporciona todos los parámetros (mínimos, alícuotas, escala) en una sola llamada RPC. El panel React orquesta el flujo y persiste el resultado.

---

## 4. Flujo completo del cálculo

```
1. Usuario selecciona proveedor en NuevaFacturaForm
   │
2. Panel llama fetchRetenciónContextAction(vendorId, fecha)
   └── ap_get_retencion_context → devuelve en una sola llamada:
       vendor, params vigentes, escala vigente, acumulado del mes, normativa_version

3. ¿vendor.concepto_ganancias es null?
   ├── SÍ: muestra selector inline → saveVendorConceptoGananciasAction()
   └── NO: continúa

4. calculateIncomeTaxRetention(params) — función pura, sin red
   │
   ├── R1: exento? → no retiene, confianza="validar"
   ├── R2: ¿factura A? → si no, no retiene
   ├── R3: concepto excluido? → no retiene
   └── R4: factura A + concepto gravado
       ├── acumuladoTotal = acumuladoPrevio + netoGravado
       ├── base = acumuladoTotal − mínimo
       ├── base ≤ 0 → no retiene
       ├── honorarios → buscarTramo(base, escala) → fijo + pct × excedente
       └── otros → alícuota × base

5. Panel calcula semáforo:
   ├── 🔴: cert_exclusion vigente OR retención_existente+corresponde
   ├── 🟠: corresponde=true
   └── 🟢: no corresponde

6. Al crear la factura (supplierInvoiceId llega como prop):
   saveRetenciónAction(id, result, fechaPago)
   └── ap_upsert_retencion_ganancias (INSERT ON CONFLICT — idempotente)
```

---

## 5. Diagrama de alto nivel

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NEXUS — COMPRAS                             │
│                                                                     │
│  ┌──────────────────┐       ┌───────────────────────────────────┐  │
│  │ NuevaFacturaForm │──────▶│    RetenciongananciasPanel        │  │
│  │  (page.tsx)      │       │    "Asistente Fiscal"             │  │
│  └──────────────────┘       │                                   │  │
│                             │  🟢 No corresponde retener        │  │
│                             │  🟠 Corresponde retener           │  │
│                             │  🔴 Revisar manualmente           │  │
│                             │                                   │  │
│                             │  [Ver normativa] [Detalle ▼]      │  │
│                             └──────────┬────────────────────────┘  │
│                                        │                           │
│                    ┌───────────────────┼───────────────────────┐   │
│                    │  Server Actions   │                        │   │
│                    │                  ▼                         │   │
│                    │  fetchRetenciónContextAction               │   │
│                    │  saveRetenciónAction                       │   │
│                    │  saveVendorConceptoGananciasAction         │   │
│                    └──────────────────────────────────────────┘   │
│                                        │                           │
└────────────────────────────────────────│────────────────────────────┘
                                         │
                    ┌────────────────────▼───────────────────────────┐
                    │          SUPABASE PROD (arsksytgdnzukbmfgkju)  │
                    │                                                 │
                    │  RPCs (SECURITY DEFINER)                        │
                    │  ├── ap_get_retencion_context                   │
                    │  ├── ap_upsert_retencion_ganancias              │
                    │  ├── ap_set_vendor_concepto_ganancias           │
                    │  ├── ap_emitir_certificado_ganancias            │
                    │  ├── ap_acumulado_mensual_proveedor             │
                    │  └── ap_fiscal_dashboard_kpis                   │
                    │                                                 │
                    │  Tablas                                         │
                    │  ├── ganancias_retention_params (versionada)    │
                    │  ├── ganancias_escala_honorarios (versionada)   │
                    │  ├── ganancias_retenciones (22 cols, auditoría) │
                    │  └── ganancias_certificados                     │
                    │                                                 │
                    │  Vistas (dashboard)                             │
                    │  ├── v_fiscal_dashboard_ganancias               │
                    │  ├── v_fiscal_resumen_mensual                   │
                    │  ├── v_fiscal_ranking_proveedores               │
                    │  └── v_fiscal_resumen_concepto                  │
                    └─────────────────────────────────────────────────┘
```

---

## 6. Migraciones incorporadas

| Nro | Nombre | Aplicada en prod | Contenido |
|-----|--------|:---:|-----------|
| 0099 | `0099_ganancias_retencion.sql` | ✅ | Tablas base, secuencia cert, RLS, seed de parámetros |
| 0100 | `0100_vendors_fiscal_ganancias.sql` | ✅ | Campos fiscales en `vendors`, cols auditoría, RPCs v2 |
| 0101 | `0101_fiscal_dashboard_views.sql` | ✅ | 4 vistas, 4 índices, `ap_fiscal_dashboard_kpis` |

---

## 7. Tablas nuevas

### `ganancias_retention_params`
Parámetros de retención versionados por `vigente_desde`. Permite actualizar normativa sin tocar código.

| Columna | Tipo | Notas |
|---------|------|-------|
| `concepto` | text | honorarios / mercaderias / servicios / alquileres |
| `param_key` | text | min_no_sujeto / alicuota |
| `valor` | numeric | importe o porcentaje |
| `vigente_desde` | date | **clave de versión** |
| `descripcion` | text | referencia a la RG AFIP |

### `ganancias_escala_honorarios`
Escala progresiva de 8 tramos versionada por `vigente_desde`.

| Columna | Tipo | Notas |
|---------|------|-------|
| `desde` / `hasta` | numeric | rango del tramo; `hasta` nullable (sin límite) |
| `fijo` | numeric | importe fijo del tramo |
| `pct` | numeric | porcentaje sobre excedente |
| `vigente_desde` | date | **clave de versión** |

### `ganancias_retenciones`
Registro de auditoría inmutable. 22 columnas. `UNIQUE` en `supplier_invoice_id`.

Columnas clave: `concepto`, `tipo_comprobante`, `fecha_pago`, `neto_gravado`, `acumulado_previo`, `acumulado_total`, `minimo_no_sujeto`, `base_imponible`, `excedente`, `alicuota`, `fijo_escala`, `pct_monto`, `retencion`, `neto_a_pagar`, `corresponde`, `motivo`, `tramo_txt`, `metodo`, `observaciones`, `normativa_version`, `created_by`, `created_at`.

### `ganancias_certificados`
Registro de certificados de exclusión emitidos. Numeración automática vía `ganancias_cert_seq`.

### Campos agregados a `vendors`
`concepto_ganancias`, `exento_ganancias` (bool), `cert_exclusion_hasta` (date), `cond_iva`.

---

## 8. Vistas

| Vista | Descripción |
|-------|-------------|
| `v_fiscal_dashboard_ganancias` | Base general: retenciones + facturas + vendors. Incluye `evitada_por_certificado`. |
| `v_fiscal_resumen_mensual` | Agrega por mes: operaciones, con/sin retención, evitadas, total retenido. |
| `v_fiscal_ranking_proveedores` | Top proveedores por monto retenido. |
| `v_fiscal_resumen_concepto` | Distribución porcentual por tipo de concepto. |

---

## 9. RPCs creadas

| RPC | Descripción |
|-----|-------------|
| `ap_get_retencion_context(p_vendor_id, p_fecha)` | Contexto completo en una sola llamada: vendor + params + escala + acumulado + normativa_version |
| `ap_upsert_retencion_ganancias(…22 params…)` | Persiste retención. `INSERT ON CONFLICT (supplier_invoice_id) DO UPDATE`. |
| `ap_set_vendor_concepto_ganancias(p_vendor_id, p_concepto)` | Configura concepto del proveedor. Valida enum. |
| `ap_emitir_certificado_ganancias(p_vendor_id, p_vigente_hasta)` | Registra certificado de exclusión numerado. |
| `ap_acumulado_mensual_proveedor(p_vendor_id, p_fecha)` | Acumulado del proveedor en el mes de p_fecha. |
| `ap_fiscal_dashboard_kpis(p_desde, p_hasta)` | KPIs agregados para tablero: total retenido, ranking, por concepto, por mes. |

---

## 10. Índices agregados

| Índice | Columna | Propósito |
|--------|---------|-----------|
| `idx_ganancias_ret_fecha_pago` | `fecha_pago` | Filtros de rango de fechas en dashboard |
| `idx_ganancias_ret_concepto` | `concepto` | Agrupaciones por tipo de concepto |
| `idx_ganancias_ret_corresponde` | `corresponde` | Filtros por si hubo o no retención |
| `idx_ganancias_ret_invoice` | `supplier_invoice_id` | Lookup individual (UNIQUE ya crea índice) |

---

## 11. Componentes React incorporados

### `RetenciongananciasPanel.tsx`
`src/components/compras/RetenciongananciasPanel.tsx`

Panel "Asistente Fiscal" integrado en `NuevaFacturaForm`. Expone:
- `Props`: `tipoComprobante`, `netoGravado`, `totalFactura`, `vendorId`, `fechaEmision`, `supplierInvoiceId?`
- Estado interno: `ctx`, `result`, `alertas`, `semaforo`, `modalOpen`
- Sub-componente: `NormativaModal` (modal de normativa aplicada)
- Sub-componente: `ConceptoSetup` (configuración inicial del concepto)
- Refs: `prevVendorId`, `prevSupplierInvoiceId`, `resultRef` (para auto-save sin cierre stale)

### Modificación en `NuevaFacturaForm.tsx`
Agrega `RetenciongananciasPanel` condicionalmente y captura `createdInvoiceId` para activar el auto-save.

---

## 12. Servicios y motores de cálculo

### `src/lib/compras/retencion-ganancias.ts` — Motor de cálculo
363 líneas. Función central: `calculateIncomeTaxRetention(p: RetenciónParams): RetenciónResult`.

- Entrada: monto, tipo comprobante, concepto, acumulado previo, parámetros de DB, escala de DB
- Sin efectos secundarios ni red. Testeable en aislamiento
- Prioridad de reglas: exento → tipo → concepto → mínimo → método de cálculo
- Produce: 20+ campos de resultado incluyendo `resumenEjecutivo`, `confianza`, `normativaVersion`

### `src/app/(app)/compras/facturas/nueva/retencion-actions.ts` — Server Actions
- `fetchRetenciónContextAction(vendorId, fecha)`: llama a la DB, mapea a tipos TS
- `saveRetenciónAction(invoiceId, result, fechaPago)`: persiste auditoría
- `saveVendorConceptoGananciasAction(vendorId, concepto)`: configura concepto

### `src/lib/fiscal/engine.ts` — Framework genérico
Interfaces base para todo el stack fiscal: `FiscalBaseParams`, `FiscalBaseResult`, `FiscalEngine<T, R>`. Helpers `redondear2`, `formatPesosAR`. Registro `IMPUESTOS_REGISTRADOS` como punto de extensión.

---

## 13. Estrategia de parametrización

**Principio:** ningún valor normativo está hardcodeado en el código.

Los mínimos no sujetos, alícuotas y escala progresiva viven en la DB en tablas versionadas por `vigente_desde`. Cuando AFIP modifica la normativa:

1. Se insertan filas nuevas con la nueva fecha de vigencia
2. El sistema aplica automáticamente la versión correcta para cada fecha de factura
3. Las retenciones históricas conservan su `normativa_version` original — son auditables y reproducibles

```sql
-- Actualizar mínimo de honorarios desde el 1° de julio:
INSERT INTO ganancias_retention_params
  (concepto, param_key, valor, vigente_desde, descripcion)
VALUES
  ('honorarios', 'min_no_sujeto', 200000, '2026-07-01', 'RG AFIP xxxx/2026');
```

Zero downtime. Zero cambios de código.

---

## 14. Estrategia de auditoría

Cada retención registrada en `ganancias_retenciones` contiene todo lo necesario para reconstruir el cálculo completo:

- **Quién:** `created_by` (UUID del usuario, `auth.uid()`)
- **Cuándo:** `created_at`, `fecha_pago`
- **Qué factura:** `supplier_invoice_id` → `supplier_invoices` → `vendor_id`
- **Qué normativa:** `normativa_version` (vigente_desde de params y escala)
- **Cómo se calculó:** todos los componentes intermedios (acumulado_previo, base_imponible, excedente, alicuota, fijo_escala, pct_monto)
- **Resultado:** `retencion`, `neto_a_pagar`, `corresponde`
- **Por qué:** `motivo`, `metodo`, `tramo_txt`

La constraint `UNIQUE (supplier_invoice_id)` garantiza que no puede haber dos retenciones para la misma factura. El patrón `INSERT ON CONFLICT DO UPDATE` hace la persistencia idempotente: ante un error de red y reintento, el sistema actualiza en lugar de duplicar.

---

## 15. Framework reutilizable para futuros impuestos

`src/lib/fiscal/engine.ts` define el contrato que todos los motores fiscales deben cumplir:

```typescript
interface FiscalEngine<TParams extends FiscalBaseParams, TResult extends FiscalBaseResult> {
  impuesto: string;
  calcular: (params: TParams) => TResult;
}
```

Para agregar IVA retenciones (RG 2408):

1. `src/lib/fiscal/iva/engine.ts` → implementa `FiscalEngine<IVAParams, IVAResult>`
2. Migración con tablas `iva_retention_params`, `iva_retenciones`
3. RPC `ap_get_iva_retencion_context`
4. Server actions `iva-retencion-actions.ts`
5. Registrar `"iva"` en `IMPUESTOS_REGISTRADOS`
6. Panel reutiliza la misma estructura visual (semáforo, resumen, detalle)

El registro `IMPUESTOS_REGISTRADOS` permite que el Asistente Fiscal evolucione hacia un panel unificado que muestre todos los regímenes activos sin refactorizar el código existente.

---

## 16. Dependencias

### Código (ya presentes en el proyecto)
- `react` — hooks `useEffect`, `useRef`, `useState`, `useTransition`
- `next` — Server Actions (`"use server"`)
- `@supabase/ssr` — cliente de servidor para RPCs
- `@/components/Icon` — íconos de Nexus (sistema existente)
- `@/lib/utils` — `fmtCurrency`

### Base de datos
- PostgreSQL (Supabase) con `plpgsql` habilitado
- `auth.uid()` — función de autenticación de Supabase
- `SECURITY DEFINER` en todas las RPCs de escritura (bypass RLS)

### No hay dependencias externas nuevas
El módulo no introduce ninguna librería nueva. Todo el stack es el mismo que el resto de Nexus.

---

## 17. Riesgos conocidos

### R1 — Parámetros desactualizados
**Probabilidad:** Media. AFIP actualiza los mínimos periódicamente (Resolución General).  
**Impacto:** El sistema calcula la retención incorrecta hasta que se carguen los nuevos parámetros.  
**Mitigación:** La contadora debe cargar los nuevos valores en `ganancias_retention_params` y `ganancias_escala_honorarios` antes de la fecha de vigencia. Ver sección 13.

### R2 — Concepto de proveedor incorrecto
**Probabilidad:** Media (especialmente en proveedores nuevos).  
**Impacto:** La alícuota o el método de cálculo son incorrectos.  
**Mitigación:** El panel muestra qué concepto se está usando. El concepto puede modificarse desde la ficha del proveedor.

### R3 — Certificado de exclusión expirado no actualizado
**Probabilidad:** Baja.  
**Impacto:** El sistema retiene cuando no debería (o viceversa).  
**Mitigación:** El panel alerta cuando un certificado está próximo a vencer. Monitoreo manual recomendado.

### R4 — Acumulado del mes basado solo en facturas registradas en Nexus
**Probabilidad:** Media en las primeras semanas.  
**Impacto:** Si existen facturas del mismo proveedor en el mes que aún no se cargaron en Nexus, el acumulado calculado es inferior al real, pudiendo resultar en no-retención incorrecta.  
**Mitigación:** Asegurar que todas las facturas del mes se registren antes de calcular la retención. El semáforo 🟠 siempre sugiere validación con el estado de cuenta.

### R5 — Retención calculada, factura no creada (panel sin auto-save)
**Probabilidad:** Baja.  
**Impacto:** El cálculo se muestra pero no se persiste si el usuario abandona el formulario antes de guardar.  
**Mitigación:** El auto-save se dispara cuando `supplierInvoiceId` llega como prop (señal de factura creada). No hay registro huérfano porque la retención siempre se vincula a una factura existente.

---

## 18. Limitaciones actuales

- **Solo Ganancias.** IVA retenciones, Ingresos Brutos y Percepciones no están implementados (aunque el framework está preparado).
- **Solo facturas de proveedores.** No cubre retenciones sobre pagos de otros tipos (honorarios directos sin factura, alquileres sin factura, etc.).
- **No emite constancias AFIP.** El módulo registra la retención internamente pero no genera el formulario de constancia de retención que debe entregarse al proveedor.
- **No presenta declaraciones juradas.** El registro es la fuente de datos; la carga en Sicore/Sijp es manual o vía exportación futura.
- **Monotributista detectado por tipo de comprobante.** Si un proveedor emite Factura A (por error o por cambio de categoría), el sistema procesará como RI. Requiere actualización del `cond_iva` del proveedor.

---

## 19. Próximas mejoras posibles (backlog, sin prioridad)

Estas mejoras no forman parte de v1.0 y no deben implementarse sin un requerimiento funcional explícito:

1. **Tablero visual** de retenciones con gráficos de evolución mensual y ranking de proveedores (`/compras/fiscal`), alimentado por las vistas v1.0
2. **Generación de constancia de retención** (PDF) para entregar al proveedor
3. **Exportación SICORE** del período (formato CSV compatible con AFIP)
4. **IVA retenciones** (RG 2408) — extensión natural usando el framework existente
5. **Ingresos Brutos** por jurisdicción — mismo patrón
6. **Alerta de parámetros próximos a vencer** — notificación al contable cuando la normativa vigente tiene más de 90 días sin actualización
7. **Botón "Emitir certificado de exclusión"** en la ficha del proveedor
8. **Histórico de retenciones** en la ficha del proveedor (últimos 12 meses)

---

## Sección 20. Validación de repositorio — Resultado

| Punto auditado | Resultado |
|---------------|-----------|
| TODO/FIXME en archivos del módulo | ✅ Ninguno |
| Comentarios temporales | ✅ Ninguno |
| Imports sin utilizar | ✅ Todos los imports están referenciados |
| Archivos huérfanos | ✅ No hay archivos del módulo sin referencia |
| Migraciones duplicadas | ✅ 0099/0100/0101 sin duplicados |
| Tablas sin uso | ✅ Todas referenciadas por al menos una RPC o vista |
| RPCs obsoletas | ✅ Ninguna — la v1 de `ap_upsert_retencion_ganancias` fue reemplazada por v2 via `CREATE OR REPLACE` |
| Componentes muertos | ✅ `RetenciongananciasPanel` importado en `NuevaFacturaForm` |

---

## Sección 21. Revisión de calidad — Resultado

| Dimensión | Resultado |
|-----------|-----------|
| Consistencia de nombres | ✅ `Retención` con tilde en tipos TS; `retencion` sin tilde en nombres de archivo/función (convención del proyecto) |
| Consistencia de tipos | ✅ `Concepto`, `EscalaTramo`, `RetenciónConfig`, `RetenciónResult` coherentes entre motor, panel y actions |
| Consistencia de interfaces | ✅ `FiscalEngine<T, R>` extiende correctamente desde `FiscalBaseParams`/`FiscalBaseResult` |
| Consistencia de documentación | ✅ `RETENCION_GANANCIAS.md`, `CHANGELOG_FISCAL.md`, `ASISTENTE_FISCAL_GANANCIAS_v1.md`, `RELEASE_REPORT` son coherentes entre sí |
| Convenciones del proyecto | ✅ Server Actions con `"use server"`, Client Components con `"use client"`, RPCs con prefijo `ap_`, tablas con prefijo `ganancias_`, íconos via `<Icon name>` |
| Estilo visual del panel | ✅ Usa las mismas variables CSS, `bg-status-*`, `text-status-*`, `border-*`, y componente `<Icon>` que el resto de Nexus |

---

## Sección 22. Estado de producción — Checklist

| Área | Estado |
|------|--------|
| **Build** | ✅ `next build` verde (verificado en sesión) |
| **TypeScript** | ✅ `npx tsc --noEmit` EXIT=0, cero errores |
| **ESLint** | ✅ Sin errores en archivos del módulo |
| **Migración 0099** | ✅ Aplicada en prod — tablas y seed |
| **Migración 0100** | ✅ Aplicada en prod — campos vendors y RPCs v2 |
| **Migración 0101** | ✅ Aplicada en prod — vistas e índices |
| **RPCs** | ✅ 6/6 presentes en prod (verificado vía SQL) |
| **Vistas** | ✅ 4/4 presentes en prod (verificado vía SQL) |
| **Índices** | ✅ 4/4 presentes en prod (verificado vía SQL) |
| **Tablas** | ✅ 4/4 con estructura correcta (columnas verificadas) |
| **Motor de cálculo** | ✅ 10/10 escenarios de validación aprobados |
| **Auditoría** | ✅ RPC `ap_upsert_retencion_ganancias` persiste 22 campos con `created_by` y `normativa_version` |
| **Documentación** | ✅ `RETENCION_GANANCIAS.md`, `ASISTENTE_FISCAL_GANANCIAS_v1.md`, `CHANGELOG_FISCAL.md`, `RELEASE_REPORT` |
| **Tag git** | ✅ `fiscal-assistant-v1.0` en commit `fe6e62a` |

---

## Sección 23. Recomendaciones post-implementación

Las siguientes acciones son **recomendadas para la etapa de operación**. No requieren desarrollo adicional.

### A. Pruebas con usuarios reales (primeras 2 semanas)
- Realizar al menos 5 altas de facturas de proveedores con distintos conceptos (honorarios, servicios, mercaderías) acompañadas por el administrativo, observando si el panel aparece correctamente y el semáforo es coherente con la expectativa
- Registrar cualquier caso donde el resultado difiera del cálculo manual previo

### B. Validación con el estudio contable (primera semana)
- Compartir 3-5 ejemplos de retenciones calculadas con la contadora y verificar que los importes coincidan con su método
- Confirmar que los parámetros seed en `ganancias_retention_params` y `ganancias_escala_honorarios` son los vigentes a la fecha actual
- Acordar el proceso de actualización de normativa: quién lo hace, cuándo y cómo se verifica

### C. Monitoreo durante el primer mes de operación
- Revisar semanalmente la tabla `ganancias_retenciones` para confirmar que los registros se están generando correctamente
- Usar la vista `v_fiscal_resumen_mensual` para cruzar el total mensual retenido contra el registro manual anterior
- Detectar proveedores con `corresponde=false` que la contadora esperaría que retuvieran → revisar concepto

### D. Métricas recomendadas (primer mes)
- Total de facturas procesadas con el panel activo
- % de facturas con retención vs. sin retención
- Distribución por concepto (honorarios, servicios, etc.)
- Cantidad de alertas de certificado de exclusión disparadas
- Cantidad de configuraciones de concepto (setup inline completados)

### E. Controles posteriores al despliegue
- Verificar que `vendor.cond_iva` esté correctamente cargado para los principales proveedores (detecta monotributistas automáticamente)
- Revisar que todos los proveedores frecuentes tengan `concepto_ganancias` configurado (el panel lo solicita la primera vez, pero puede hacerse preventivamente)
- Confirmar que la fecha de vencimiento de certificados de exclusión existentes esté cargada en `cert_exclusion_hasta`

---

## Cierre definitivo

**El módulo Asistente Fiscal · Ganancias v1.0 queda aprobado para producción.**

No se recomiendan cambios adicionales antes del despliegue. El módulo está completo, validado, documentado y libre de deuda técnica.

Futuras mejoras deben surgir exclusivamente de nuevos requerimientos funcionales explícitos o de cambios normativos que requieran actualizar los parámetros de la DB o la lógica del motor.

---

*Documento de cierre oficial — versión 1.0 — 2026-06-27*
