# ERP-B3 · REVISIÓN DE IMPLEMENTACIÓN — LIBRO IVA COMPRAS UI

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_B3_IMPLEMENTATION_REVIEW.md`
**Fecha:** 2026-06-07
**Rama:** `feature/erp-b3-libro-iva` (sobre `main a044213`)
**Naturaleza:** implementación + auditoría. **No se desplegó. No se modificó producción.** Fuente de verdad = `arsksytgdnzukbmfgkju`.

> Pantalla `/compras/libro-iva` que consume vistas **read-only** (`supplier_invoice_fiscal` + `supplier_invoice_vat_lines` + joins de display). El frontend **no recalcula impuestos**: solo totaliza valores ya derivados por la DB. **No toca** ERP-A, Tesorería, OCR, workflow AP ni `0056–0059`.

---

## 1. Archivos creados

| Archivo | Tipo | Rol |
|---|---|---|
| `src/lib/erp/libro-iva-data.ts` | **A** | Capa de datos: `getLibroIvaCompras(filters)` → `{ rows, subtotales, kpis, truncated }`. Lee `supplier_invoice_fiscal` + joins `vendors`/`supplier_invoices`/`cost_centers` + `supplier_invoice_vat_lines`. Filtros en DB. |
| `src/lib/erp/libro-iva-export.ts` | **A** | Builders puros: `buildLibroIvaCsv` (UTF-8 + BOM), `buildLibroIvaXlsx` (exceljs, 2 hojas), `libroIvaFileName`. |
| `src/app/(app)/compras/libro-iva/page.tsx` | **A** | Server Component: carga datos + vendors + cost centers, resuelve `canExport`, degrada con `ModuleUnavailable`. |
| `src/app/(app)/compras/libro-iva/LibroIvaView.tsx` | **A** | Client Component: KPIs, filtros (URL), subtotales, tabla con totales, botones de export. |
| `src/app/api/compras/libro-iva/export/route.ts` | **A** | Route handler `?format=csv\|xlsx`, gated `cuentas_pagar.export`, mismos filtros por querystring. |
| `src/components/shell/Sidebar.tsx` | M | Entrada "Libro IVA Compras" en grupo Compras + ruta exacta. |
| `package.json` / `package-lock.json` | M | Dependencia nueva: **`exceljs@^4.4.0`** (única). |

**Scope verificado (auditoría §8):** 5 archivos nuevos + Sidebar + package. **Cero** cambios en `migrations/`, `tesoreria/`, `ocr/`, `arca/` o workflow AP.

---

## 2. Pantalla

`/compras/libro-iva` (`dynamic = "force-dynamic"`). Server Component carga en paralelo `getLibroIvaCompras(filters)`, `listVendors()`, `listCostCenters()`; si falla (vistas ausentes) → `ModuleUnavailable` (migración `0059_iva_compras_views`). Delega lo interactivo a `LibroIvaView`.

**Layout:** Header (título + período + botones export) → KPIs (4 tarjetas) → banda **Total Gravado (Neto+IVA)** → barra de filtros → subtotales por alícuota → tabla con fila de totales → estado vacío ("Sin comprobantes con detalle fiscal…"). Entrada en Sidebar > Compras. Filtros default: mes corriente (1° → hoy).

---

## 3. KPIs

Cuatro tarjetas + banda de Total Gravado, **calculadas en la capa server** (totalización de valores precomputados por la vista, **no liquidación**):

| KPI | Origen | Cálculo |
|---|---|---|
| IVA Crédito Fiscal | `supplier_invoice_fiscal.iva_pagado` | Σ sobre el set filtrado |
| Neto Gravado | `supplier_invoice_fiscal.neto_gravado` | Σ |
| Percepciones | `supplier_invoice_fiscal.percepciones` | Σ |
| Cantidad Comprobantes | `supplier_invoice_fiscal` | count |
| **Total Gravado (Neto+IVA)** | derivado de los dos primeros | Σ(neto+iva) |

> **Decisión de implementación (transparente):** los KPIs y los subtotales por alícuota se totalizan desde el **set filtrado** (`supplier_invoice_fiscal` + `supplier_invoice_vat_lines`) en vez de leer `libro_iva_compras` directamente. Motivo: `libro_iva_compras` está agregada **solo** por período+alícuota y **no puede honrar** los filtros Proveedor/CUIT/Centro de costo. Los valores son **idénticos** a `libro_iva_compras` cuando no hay filtros de entidad (mismo detalle canónico: `vat_lines`). Se respeta "no recalcular impuestos en frontend": cada importe por-fila viene **precomputado** por la vista; el front solo **suma**.

---

## 4. Filtros

Todos aplicados en **DB**, reflejados en la URL (querystring) para que el export reciba los mismos parámetros:

| Filtro | Mecánica (DB) |
|---|---|
| Desde / Hasta | `supplier_invoice_fiscal.fecha_emision` `gte`/`lte` |
| Proveedor | `vendor_id eq` (selector) |
| CUIT | resuelto a `vendor_id(s)` vía `vendors.cuit ilike` (solo dígitos); 0 matches → resultado vacío |
| Alícuota | `invoice_id ∈` (set desde `supplier_invoice_vat_lines.alicuota_iva eq`, índice `sivl_alic_idx`) |
| Centro de costo | `invoice_id ∈` (set desde `supplier_invoices.cost_center_id eq`) |

Los sets por `invoice_id` se **intersectan** antes de la query principal (cap 5.000 + aviso de truncado). "Limpiar" resetea a sin filtros.

---

## 5. Export CSV

`GET /api/compras/libro-iva/export?format=csv` — `text/csv; charset=utf-8` con **BOM** (acentos correctos en Excel), CRLF, escapado RFC-4180. Columnas: Fecha, Proveedor, CUIT, Comprobante, Centro de costo, **Neto Gravado, IVA Pagado, Percepciones, Total Gravado, Total Comprobante**, Estado + fila TOTALES. Filename `LibroIVACompras-{desde}_{hasta}.csv`. Gated `cuentas_pagar.export`.

**Test (builder puro, transpilado esbuild):** **6/6 PASS** — BOM presente, header con columnas obligatorias, escape de coma en razón social, fila de totales correcta (4000/630/75/4630), CRLF, filename.

> ### PASS

---

## 6. Export XLSX

`GET …?format=xlsx` — `exceljs` (import dinámico, no infla el bundle de la pantalla). Workbook con **Hoja 1 "Libro IVA Compras"** (encabezados en negrita, filas por-comprobante, fila de totales en negrita, formato `#,##0.00`) + **Hoja 2 "Subtotales por alícuota"** (período/alícuota/comprobantes/neto/IVA/total gravado). Filename `.xlsx`. Gated `cuentas_pagar.export`.

**Test (builder real, releído con exceljs):** **11/11 PASS** — buffer válido (magic `PK`/zip), ambas hojas presentes, header fila 1 = "Fecha", columnas obligatorias presentes, 4 filas (hdr+2+totales), celdas numéricas (`1000`), fila de totales (`4000`), 2 alícuotas en hoja 2, `numFmt = #,##0.00`.

> ### PASS

---

## 7. Permisos

- **Pantalla:** lectura bajo middleware de auth + RLS de las vistas (`security_invoker` → RLS de `supplier_invoices`, escritura/lectura roles internos). Un usuario sin acceso no ve datos.
- **Exportación:** `checkPermission(req, "cuentas_pagar.export")` en el route handler → 403 si falta. Botones de export ocultos si `!canExport` (resuelto server-side reutilizando `checkPermission`, que ignora el request).

**Matriz real en prod (`role_permissions`):**

| Rol | Ver pantalla (`view`) | Exportar (`export`) |
|---|---|---|
| Administración | ✅ | ✅ |
| Director de Operaciones (Dirección) | ✅ | ✅ |
| Compliance / DT | ✅ | ✅ |
| Operaciones | ✅ | ❌ |
| admin (superusuario) | ✅ | ✅ |

> Cumple el objetivo: Dirección y Administración consultan, filtran y **exportan**; Operaciones solo consulta. **Sin permisos nuevos ni cambios de RBAC** (`cuentas_pagar.view/.export` ya en prod). Caveat heredado: `check.ts` hace fail-open si `user_roles` está vacío en TODA la DB (RBAC seedeado en prod → enforcea).

---

## 8. Auditoría adversarial

| ADV | Verificación | Resultado |
|---|---|---|
| ADV-1 | Scope de archivos | ✅ 5 nuevos + Sidebar + package; nada más |
| ADV-2 | ¿Capa de datos solo lee? | ✅ solo `.select` (0 insert/update/delete/upsert/rpc) |
| ADV-3 | ¿Toca migraciones/ERP-A/Tesorería/OCR/workflow? | ✅ ninguno |
| ADV-4 | ¿Dependencias nuevas? | ✅ solo `exceljs` |
| ADV-5 | ¿Export gated? | ✅ `checkPermission(req,'cuentas_pagar.export')` |
| ADV-6 | ¿`0056–0059` intactas? | ✅ `git diff` vacío |
| ADV-7 | Regla obligatoria (Neto/IVA/Total Gravado + distinción de Total Comprobante) | ✅ presente en KPIs, tabla, CSV y XLSX, con columnas separadas |
| ADV-8 | ¿Frontend recalcula impuestos? | ✅ no — valores precomputados por la vista; JS solo suma |
| ADV-9 | Filtro CUIT sin matches | ✅ devuelve resultado vacío (no error) |
| ADV-10 | Truncado >5.000 | ✅ cap + aviso visible |

---

## 9. Riesgos

### 🔴 P0
- **Ninguno.** Solo lectura de vistas existentes + UI aislada; no toca ERP-A/Tesorería/OCR/workflow/`0056–0059`; permisos ya en prod; typecheck/lint/build + export CSV/XLSX verdes.

### 🟠 P1
- **R1 — Validación end-to-end con datos reales pendiente.** Los builders y la lógica se probaron con fixtures (no contra prod, por "no modificar producción"). Las 4 facturas legacy **sin `vat_lines`** no aparecen en el libro (correcto). Mitigación: smoke read-only en el gate de DEPLOY (consulta de las vistas ya verificada en columnas). Las primeras altas OCR (B2) poblarán el libro.

### 🟡 P2
- **R2 — `canExport` vía `checkPermission` con request casteado.** Reutiliza el helper (que ignora `_req`). Mitigación: el gate **real** está en el route handler (con request real); la página solo oculta botones (UX). Sin riesgo de seguridad.
- **R3 — Join de display sobre vista** (`supplier_invoice_fiscal` sin FK auto-embed). Mitigación: ensamblado en server por `invoice_id`/`vendor_id` (mapas) — no recálculo fiscal.

### ⚪ P3
- **R4 — `exceljs` suma peso al server bundle.** Mitigación: import **dinámico** solo en el route de export (no afecta la pantalla, 3.26 kB).
- **R5 — Jurisdicciones IIBB** no se muestran (existen en `other_taxes`). Fuera de alcance; mejora futura.

---

## 10. Veredicto

> # 🟢 READY FOR ERP-B3 DEPLOY
>
> ERP-B3 (Libro IVA Compras UI) está **implementado y auditado** en `feature/erp-b3-libro-iva`. La pantalla `/compras/libro-iva` consume **vistas read-only** (`supplier_invoice_fiscal` + `supplier_invoice_vat_lines` + joins de display) — el frontend **no recalcula impuestos**, solo totaliza valores derivados por la DB. KPIs (IVA Crédito Fiscal, Neto Gravado, Percepciones, Cantidad) + banda **Total Gravado (Neto+IVA)** claramente diferenciada del **Total Comprobante**. Filtros Desde/Hasta/Proveedor/CUIT/Alícuota/Centro de costo aplicados en DB. Export **CSV (UTF-8 BOM)** y **XLSX (exceljs)** gated por `cuentas_pagar.export`.
>
> Validaciones: **typecheck / lint / build = PASS**; **Export CSV = PASS (6/6)**; **Export XLSX = PASS (11/11)**; auditoría adversarial **10/10**. Permisos `cuentas_pagar.view/.export` ya en prod cubren Dirección + Administración (export) y Operaciones (solo consulta). Alcance **aislado**: 5 archivos + Sidebar + `exceljs`; **no toca** ERP-A, Tesorería, OCR, workflow AP ni `0056–0059`. Riesgos **sin P0**.
>
> **No se desplegó. No se modificó producción.** Listo para el gate de DEPLOY (commit → merge → build → deploy + smoke read-only de export).

---

## Anexo — Evidencia

| Verificación | Resultado |
|---|---|
| Rama | `feature/erp-b3-libro-iva` (sobre `main a044213`) |
| Archivos | 5 nuevos + Sidebar + package (`exceljs`) |
| typecheck / lint / build | EXIT 0 / 0 / 0 — rutas `/compras/libro-iva` + `/api/compras/libro-iva/export` compilan |
| Export CSV | 6/6 PASS (BOM, columnas obligatorias, escape, totales) |
| Export XLSX | 11/11 PASS (zip válido, 2 hojas, numérico, totales, numFmt) |
| Capa de datos | solo lecturas (`.select`) |
| Permisos | view: Admin/Dir.Ops/Compliance/Operaciones · export: Admin/Dir.Ops/Compliance |
| Regla obligatoria | Neto/IVA/Total Gravado presentes y distintos de Total Comprobante |
| Migraciones 0056–0059 / ERP-A / Tesorería / OCR | intactos |
| Veredicto | **READY FOR ERP-B3 DEPLOY** |

---

*Fin — Revisión de Implementación ERP-B3 (Libro IVA Compras UI). Veredicto: READY FOR ERP-B3 DEPLOY. Implementado y auditado en rama; no se desplegó, no se modificó producción. No se tocó ERP-A, Tesorería, OCR, workflow AP ni 0056–0059.*
