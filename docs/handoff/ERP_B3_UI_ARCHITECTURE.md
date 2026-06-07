# ERP-B3 · ARQUITECTURA DE UI — LIBRO IVA COMPRAS

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_B3_UI_ARCHITECTURE.md`
**Fecha:** 2026-06-07
**Naturaleza:** **diseño**. No se escribió código ni se creó UI. Fuente de verdad = `arsksytgdnzukbmfgkju`.
**Base:** `main` `a044213` (ERP-B2 desplegado).

> **Objetivo:** una pantalla `/compras/libro-iva` para que **Dirección y Administración** consulten, filtren y exporten el Libro IVA Compras, consumiendo **vistas read-only** (toda la matemática fiscal vive en la DB; **el frontend no recalcula impuestos**).

---

## 0. Decisión de fuente de datos (ratificada)

`libro_iva_compras` está **agregada por período + alícuota** (`periodo, alic_iva_id, alicuota_iva, comprobantes, neto_gravado, iva_credito_fiscal, total_gravado`). **No contiene** proveedor, CUIT, fecha por comprobante, número de comprobante, **percepciones** ni centro de costo → **sola no puede** alimentar la tabla por-comprobante ni los filtros Proveedor/CUIT/Centro de costo pedidos.

**Decisión presidencial (2026-06-07): consumir las DOS vistas read-only existentes (sin migración).**

| Necesidad UI | Fuente read-only | Notas |
|---|---|---|
| Tabla por-comprobante + KPIs (incl. Percepciones) | **`supplier_invoice_fiscal`** (ya existe, derivada del detalle, excluye `anulada`) | + join a `vendors` (razón/CUIT) y `supplier_invoices` (PV/número, centro de costo) **solo para display** |
| Subtotales por alícuota + filtro Alícuota | **`libro_iva_compras`** | agregado en DB por período+alícuota |

**Garantía "no recalcular en frontend":** los importes fiscales (neto/IVA/percepciones/total) salen **precomputados** de las vistas; el front solo **muestra** y, para KPIs, **suma** valores ya derivados por la DB (totalización, no liquidación de impuestos). Razón social, CUIT, número de comprobante y centro de costo son **atributos de display** (joins), no cálculos.

> **Excel: XLSX real con `exceljs`** (decisión ratificada) — única dependencia nueva.

---

## 1. Pantalla

**Ruta:** `/compras/libro-iva` (`src/app/(app)/compras/libro-iva/page.tsx`, `dynamic = "force-dynamic"`).
**Tipo:** Server Component que carga datos vía capa `src/lib/erp/libro-iva-data.ts` y delega los controles interactivos (filtros, export) a un Client Component `LibroIvaView.tsx`.
**Guard:** `cuentas_pagar.view` (ver §6). Sin permiso → `ModuleUnavailable`/redirect (espejo de las páginas de compras existentes).

**Layout (de arriba a abajo):**
1. **Header** — título "Libro IVA Compras", subtítulo con el período activo, botones **Exportar CSV** / **Exportar Excel** (visibles solo con `cuentas_pagar.export`).
2. **Barra de KPIs** (§2) — 4 tarjetas.
3. **Barra de filtros** (§4) — Desde/Hasta, Proveedor, CUIT, Alícuota, Centro de costo + "Limpiar".
4. **Subtotales por alícuota** (de `libro_iva_compras`) — strip compacto: por cada alícuota presente en el rango → `alícuota · comprobantes · neto · IVA · total`.
5. **Tabla por-comprobante** (§3) — de `supplier_invoice_fiscal` + joins, con fila de **totales** al pie.
6. **Estado vacío** — mensaje "Sin comprobantes con detalle fiscal para los filtros" (las facturas legacy sin `vat_lines` no aparecen — correcto).

**Navegación:** entrada en el Sidebar grupo "Compras" → "Libro IVA". (Edición de `Sidebar.tsx` es UI, dentro de alcance; **no** toca otros módulos.)

---

## 2. KPIs

Cuatro tarjetas, calculadas en **DB** (no en front):

| KPI | Fuente | Derivación |
|---|---|---|
| **IVA Crédito Fiscal** | `libro_iva_compras` | `Σ iva_credito_fiscal` sobre el rango/filtros |
| **Neto Gravado** | `libro_iva_compras` | `Σ neto_gravado` |
| **Percepciones** | `supplier_invoice_fiscal` | `Σ percepciones` sobre el conjunto filtrado (valor por-fila precomputado; solo se totaliza) |
| **Cantidad de comprobantes** | `supplier_invoice_fiscal` | `count(distinct invoice_id)` del conjunto filtrado |

> **Regla financiera obligatoria** (siempre visible): se muestra **Neto Gravado**, **IVA Pagado** y **Total Gravado = Neto + IVA** (= `total_gravado` de `libro_iva_compras`). El "Total" del comprobante (que incluye percepciones/no gravado) se muestra **además** en la tabla, claramente diferenciado del Total Gravado, para no mezclar el crédito fiscal con el total a pagar.

---

## 3. Tabla

**Fuente:** `supplier_invoice_fiscal` (1 fila por comprobante, excluye `anulada`) + joins de display.

| Columna pedida | Origen | Campo |
|---|---|---|
| Fecha | `supplier_invoice_fiscal` | `fecha_emision` |
| Proveedor | join `vendors` | `razon` |
| CUIT | join `vendors` | `cuit` |
| Comprobante | `tipo_comprobante` + join `supplier_invoices` | `tipo` + `PV-número` (ej. `FA A 0013-00001255`) |
| Neto Gravado | `supplier_invoice_fiscal` | `neto_gravado` |
| IVA | `supplier_invoice_fiscal` | `iva_pagado` |
| Percepciones | `supplier_invoice_fiscal` | `percepciones` |
| Total | `supplier_invoice_fiscal` | `total_derivado` (comprobante completo) |

**Columnas auxiliares opcionales** (toggles, no obligatorias): `periodo`, `approval_status` (badge cargada/en_revisión/aprobada), `importe_no_gravado`, `importe_exento`, `tributos`, `Total Gravado (Neto+IVA)`.

**Fila de totales** (pie): `Σ Neto Gravado · Σ IVA · Σ Percepciones · Σ Total` — todos sumas de valores precomputados.

**Orden:** por `fecha_emision` asc (orden de libro fiscal), luego `public_id`. **Paginación:** server-side (pageSize 50–100); export ignora paginación (hasta 5.000 filas, como el patrón de OC).

> **Sobre el "Total":** la tabla muestra el **Total del comprobante** (`total_derivado`, incluye percepciones); la regla obligatoria "Total = Neto + IVA" se cumple en el bloque de **Total Gravado** (KPIs + subtotales por alícuota). Ambos totales conviven, etiquetados sin ambigüedad.

---

## 4. Filtros

Todos aplicados en **DB** (PostgREST/SQL), nunca en front:

| Filtro | Aplica a | Mecánica |
|---|---|---|
| **Desde / Hasta** | ambas vistas | `fecha_emision` entre `[desde, hasta]` en la tabla; `periodo` (YYYY-MM) dentro del rango en los subtotales |
| **Proveedor** | tabla + KPIs | `vendor_id =` (selector de proveedores, espejo del alta) |
| **CUIT** | tabla + KPIs | resuelto a `vendor_id` vía `vendors.cuit` (o `ilike`); evita ambigüedad de homónimos |
| **Alícuota** | subtotales + tabla | subtotales: `alicuota_iva =` en `libro_iva_compras`; tabla: restringe a comprobantes con un `vat_line` de esa alícuota (set de `invoice_id` desde `supplier_invoice_vat_lines`) |
| **Centro de costo** | tabla + KPIs | join `supplier_invoices.cost_center_id =` (display + filtro) |

**Defaults:** período = mes corriente (`Desde`=1° del mes, `Hasta`=hoy). Los filtros se reflejan en la URL (querystring) para que **export reciba exactamente los mismos parámetros**.

**Nota:** las facturas **legacy sin `vat_lines`** (las 4 actuales) **no** aparecen en el libro (no tienen detalle fiscal) — comportamiento correcto; el libro lista solo comprobantes con crédito fiscal computable (OCR B2 en adelante).

---

## 5. Exportaciones

**Endpoint:** `src/app/api/compras/libro-iva/export/route.ts` (`runtime nodejs`, `dynamic force-dynamic`), parámetro `?format=csv|xlsx`, **mismos filtros por querystring** que la pantalla. Gated por `cuentas_pagar.export` (`checkPermission`, §6).

- **CSV** (`format=csv`): `text/csv; charset=utf-8` con **BOM** (acentos correctos en Excel). Header + filas por-comprobante + fila de totales. Patrón espejo de `/api/compras/export`.
- **XLSX** (`format=xlsx`, **`exceljs`**): workbook con
  - Hoja **"Libro IVA Compras"**: encabezados con estilo, filas por-comprobante (Fecha, Proveedor, CUIT, Comprobante, Neto Gravado, IVA, Percepciones, Total), fila de **totales** en negrita, formato numérico `#,##0.00`.
  - Hoja **"Subtotales por alícuota"**: de `libro_iva_compras` (período, alícuota, comprobantes, neto, IVA, total gravado).
  - Metadata: período exportado + fecha de generación.
- **Nombre de archivo:** `LibroIVACompras-{desde}_{hasta}.{csv|xlsx}`.

**Regla obligatoria en ambos formatos:** columnas **Neto Gravado**, **IVA Pagado** y **Total** siempre presentes; hoja/sección de **Total Gravado (Neto+IVA)** incluida.

**Dependencia nueva:** `exceljs` (única). Sin tocar otras libs. (CSV no requiere dependencia.)

---

## 6. Permisos

**Helper:** `checkPermission(req, slug)` (route handlers, `src/lib/rbac/check.ts`); guard de página vía Server Component (espejo de compras/tesorería). RBAC con caveat de **fail-open si `user_roles` está vacío en toda la DB** (documentado en `check.ts`); en prod RBAC está seedeado, así que enforcea.

**Matriz real en prod (`role_permissions`):**

| Rol | `cuentas_pagar.view` (pantalla) | `cuentas_pagar.export` (CSV/XLSX) |
|---|---|---|
| **Administración** | ✅ | ✅ |
| **Director de Operaciones** (Dirección) | ✅ | ✅ |
| **Compliance / DT** | ✅ | ✅ |
| **Operaciones** | ✅ | ❌ (solo consulta) |
| **admin** (superusuario) | ✅ (vía `has_permission` admin) | ✅ |

> Cubre el objetivo: **Dirección (Director de Operaciones) y Administración consultan, filtran y exportan**. Operaciones puede consultar pero **no** exportar (botones de export ocultos + endpoint rechaza con 403). Sin permisos nuevos: se reutilizan `cuentas_pagar.view/.export` (ya en prod). **No se modifica RBAC ni `0057`.**

---

## 7. Riesgos

### 🔴 P0
- **Ninguno.** Solo lectura de vistas existentes + UI nueva aislada; no toca ERP-A, Tesorería, OCR, workflow AP ni `0056–0059`; permisos ya existen.

### 🟠 P1
- **R1 — "Total" ambiguo (comprobante vs gravado).** Riesgo de confundir crédito fiscal con total a pagar. Mitigación: dos columnas/bloques etiquetados — **Total Gravado (Neto+IVA)** y **Total comprobante**; la regla obligatoria se ancla en el primero.
- **R2 — Joins de display sobre una vista.** `supplier_invoice_fiscal` es vista (sin FK para auto-embed PostgREST). Mitigación: la capa de datos arma el resultado en el server (lee la vista + mapas de `vendors`/`supplier_invoices` por `invoice_id`) — ensamblado, no recálculo fiscal. Alternativa: leer `supplier_invoices` (cache reconciliada por RPC) con embeds y cruzar la vista; se elige la vista como fuente fiscal autoritativa.

### 🟡 P2
- **R3 — Filtro Alícuota en la tabla** requiere un lookup extra a `supplier_invoice_vat_lines` (set de `invoice_id`). Mitigación: subconsulta indexada (`sivl_alic_idx`); barato.
- **R4 — Volumen de export** (libros anuales). Mitigación: cap de filas (5.000, como OC) + aviso si se trunca; paginación en pantalla.
- **R5 — KPI Percepciones = suma en server** de un valor precomputado. Mitigación: es totalización de `supplier_invoice_fiscal.percepciones` (no liquidación); documentado para no leerse como "recálculo".

### ⚪ P3
- **R6 — Jurisdicciones IIBB** no se muestran en el libro resumido (existen en `other_taxes`). Mitigación: fuera de alcance B3; columna/detalle de percepciones por tipo = mejora futura.
- **R7 — `exceljs` suma peso al server bundle.** Mitigación: import dinámico en el route handler de export (no afecta la pantalla).

---

## 8. Veredicto

> # 🟢 READY FOR ERP-B3 IMPLEMENTATION
>
> La fundación de datos **ya existe y está desplegada**: `supplier_invoice_fiscal` (per-comprobante, derivada, excluye anuladas) y `libro_iva_compras` (subtotales por alícuota) son **read-only** y traen toda la matemática fiscal precomputada — el frontend **no recalcula impuestos**. La decisión de fuente de datos quedó **ratificada** (dos vistas existentes, sin migración) y el formato Excel también (**XLSX con `exceljs`**), resolviendo la única incompatibilidad real (la spec pedía una tabla por-comprobante que `libro_iva_compras` sola no expone).
>
> Permisos `cuentas_pagar.view`/`.export` **ya en prod** y cubren a Dirección + Administración (export) y Operaciones (solo consulta) — **sin tocar RBAC**. El patrón de export (route handler CSV) y de guard (`checkPermission`) existen y se espejan. Alcance **aislado**: pantalla + capa de datos + 2 endpoints de export + entrada de Sidebar; **no toca** ERP-A, Tesorería, OCR, workflow AP ni `0056–0059`. Riesgos **sin P0**.
>
> **Recomendación:** proceder a la implementación bajo el patrón gated habitual. Este documento es **solo diseño**: no se escribió código ni se creó UI.

---

## Anexo — Evidencia

| Verificación | Resultado |
|---|---|
| `libro_iva_compras` (cols) | periodo, alic_iva_id, alicuota_iva, comprobantes, neto_gravado, iva_credito_fiscal, total_gravado |
| `supplier_invoice_fiscal` (cols) | invoice_id, public_id, vendor_id, tipo_comprobante, fecha_emision, periodo, approval_status, neto_gravado, importe_no_gravado, importe_exento, iva_pagado, percepciones, tributos, total_derivado, total_cabecera |
| Ambas vistas | `security_invoker = true` (respetan RLS), read-only, excluyen `anulada` |
| Tabla por-comprobante | `supplier_invoice_fiscal` + join `vendors` (razón/CUIT) + `supplier_invoices` (PV/nº, centro de costo) |
| Subtotales + filtro alícuota | `libro_iva_compras` (+ `supplier_invoice_vat_lines` para el set de la tabla) |
| KPIs | IVA/Neto/Total Gravado (libro_iva) · Percepciones/Cantidad (fiscal) — sumas en DB |
| Permisos | view: Admin/Dir.Ops/Compliance/Operaciones · export: Admin/Dir.Ops/Compliance (no Operaciones) |
| Export | route handler CSV (BOM) + XLSX (`exceljs`), mismos filtros por querystring |
| Dependencia nueva | `exceljs` (única) |
| Alcance | pantalla + datos + export + Sidebar; sin tocar ERP-A/Tesorería/OCR/workflow/0056–0059 |
| Veredicto | **READY FOR ERP-B3 IMPLEMENTATION** |

---

*Fin — Arquitectura de UI ERP-B3 (Libro IVA Compras). Veredicto: READY FOR ERP-B3 IMPLEMENTATION. Solo diseño: no se escribió código ni se creó UI. No se tocó ERP-A, Tesorería, OCR, workflow AP ni 0056–0059.*
