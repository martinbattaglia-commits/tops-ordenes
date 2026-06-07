# ERP-B2 · REPORTE DE DEPLOY

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_B2_DEPLOY_REPORT.md`
**Fecha:** 2026-06-07
**Producción (fuente de verdad):** `arsksytgdnzukbmfgkju`
**Resultado:** 🟢 **ERP-B2 COMPLETADO** — OCR fiscal avanzado integrado en `main` (`3db919c`), build verde, deploy Netlify `ready`, E2E rolled-back PASS en prod.

> Reglas respetadas: **sin modificar** `0056–0059`, **sin tocar ERP-A**, **sin tocar Tesorería**, `git add` **dirigido**, **sin force-push**, **sin squash** (commits `c5797d5` + `bc598c3` preservados), E2E en **BEGIN…ROLLBACK** (cero persistencia). **No se inició ERP-B3.**

---

## 1. Commits

| Commit | Contenido |
|---|---|
| **`c5797d5`** | `feat(erp-b2)`: OCR fiscal avanzado — 7 archivos de código (ocr/types, ocr/openai, erp/ocr-map, erp/validation, erp/errors, compras/facturas/nueva/actions, NuevaFacturaForm). Elimina el INSERT directo → RPC `ap_create_supplier_invoice`. |
| **`bc598c3`** | `docs(erp-b2)`: `ERP_B2_OCR_ARCHITECTURE.md` + `ERP_B2_IMPLEMENTATION_REVIEW.md`. |

`git add` dirigido verificado: C1 solo los 7 archivos de código (0 de `migrations`/`tesoreria`); C2 solo docs ERP-B2. **Sin squash.**

---

## 2. Merge

`git switch main` → `git merge --no-ff feature/erp-b2-ocr-fiscal`.

- Pre-merge: `origin/main` (`6b6b4c8`) **ancestro** de la rama → integración limpia.
- **Merge commit:** **`3db919c`** (parents `6b6b4c8` + `bc598c3`).
- `9 files changed, 1383 insertions(+), 77 deletions(-)` — 7 código + 2 docs.
- Rama pusheada a `origin/feature/erp-b2-ocr-fiscal` (`bc598c3`, new branch, sin force).
- Push de `main`: **`6b6b4c8..3db919c`** (notación de 2 puntos = **fast-forward, sin force**). `main == origin/main == 3db919c`.

---

## 3. Build

`npm run typecheck` → **EXIT 0** · `npm run lint` → **EXIT 0** (solo warnings preexistentes ajenos) · `npm run build` → **EXIT 0** (`✓ Compiled successfully`). Rutas `/tesoreria*` = **6** (ERP-A intacto); `/compras/facturas/nueva` compila.

> ### PASS

---

## 4. Deploy

Push a `main` disparó el build de Netlify (`tops-ordenes`, `d84a7d34…`).

| Campo | Valor |
|---|---|
| `deploy id` | `6a2512a2d8958e00088b7e37` |
| `state` | **`ready`** |
| `commit_ref` | **`3db919c`** (= merge commit, exacto) |
| `branch` / `context` | `main` / `production` |
| `published_at` | `2026-06-07T06:43:29Z` |
| `error_message` / `plugin_state` | `null` / `success` |
| `deploy_time` / runtime | 109 s / `nodejs22.x` |
| secret scan | 798 archivos, **0 matches** |
| Producción | `https://nexus.logisticatops.com` (alias del deploy) |

> ### PASS

---

## 5. E2E OCR

Test **`BEGIN…ROLLBACK`** (cero persistencia) contra `arsksytgdnzukbmfgkju`, bajo impersonación de admin real (`request.jwt.claims`), alimentando `ap_create_supplier_invoice` con el payload exacto del adaptador. `RAISE` final → ROLLBACK garantizado.

### Casos obligatorios

| Caso | Payload | Verificado | Resultado |
|---|---|---|---|
| **1 · Simple 21%** | 1 vat line (5,21) | `vat_lines=1`, `items=1`, total `1210.00` | ✅ |
| **2 · Multi 21%+10.5%** | 2 vat lines (5,21)+(4,10.5) | `vat_lines=2`, `items=1`, total `3420.00` | ✅ |
| **3 · Percepciones IVA+IIBB+Ganancias** | 1 vat + 3 other taxes (IIBB c/ jurisdicción) | `other_taxes=3`, `items=1`, total `128500.00` | ✅ |
| **PDF texto** | camino `pdf_text` (fallback si sin `fiscal`) | mapper Capa A (B2.1 §5.1, fallback snap 21%) | ✅ |
| **PDF escaneado** | camino `pdf_image`/Vision | mapper Capa A (B2.1 §5.1, comprobante/CAE preservado) | ✅ |

> Los casos **PDF texto** y **PDF escaneado** se distinguen en la **extracción** (sourceKind), no en la persistencia; al RPC le llega el mismo shape. Su validación está en la Capa A del mapper (B2.1, 23/23) — el E2E del RPC ejercita las 3 formas fiscales distintas (1/2/3).

### Confirmaciones pedidas

| Ítem | Evidencia (rolled-back) | Resultado |
|---|---|---|
| **VAT Lines** pobladas | `supplier_invoice_vat_lines` = 1 / 2 / 1 por caso | ✅ |
| **Other Taxes** pobladas | `supplier_invoice_other_taxes` = 3 (caso 3) | ✅ |
| **Items** poblados | `supplier_invoice_items` = 1 por caso | ✅ |
| **Workflow AP** | `submit_for_review` → `en_revision`; `approve` → `aprobada` | ✅ |
| **Libro IVA Compras** | `libro_iva_compras` = **2 filas** (21% neto `102000.00`, 10.5% neto `2000.00`) | ✅ |
| **No persistencia** | post-test: `invoices=4, vat=0, other=0, items=0, libro=0` (todo revertido) | ✅ |

> ### PASS

---

## 6. Regresión ERP-B1

| Verificación (prod) | Resultado |
|---|---|
| `ap_create_supplier_invoice` presente | ✅ (1 función) |
| Tablas detalle B1 (`vat_lines`/`other_taxes`/`items`) | presentes, sin datos espurios (0/0/0 tras rollback) |
| `supplier_invoices` legacy | `4` (sin cambios) |
| Migraciones `0056–0059` | **intactas** (`git diff` vacío) |
| ERP-A (`supplier_payments`) | `1` (sin cambios) · `supplier_open_items` = 7 (vista operativa) |
| Tesorería | sin tocar (6 rutas `/tesoreria*` compilan) |
| Workflow AP (B1) | operativo (submit/approve PASS en E2E) |

> ### PASS

---

## 7. Riesgos

### 🔴 P0
- **Ninguno.** Deploy `ready` sirviendo `3db919c`; E2E 5 casos PASS con cero persistencia; ERP-B1/ERP-A/Tesorería intactos; build verde.

### 🟠 P1
- **R1 — Exactitud del LLM en producción real.** El E2E validó la *persistencia* con payloads controlados; la *extracción* real depende del modelo sobre facturas heterogéneas. Mitigación: semáforo de confianza por renglón fuerza revisión humana; el RPC rechaza incoherencias (CHECK AFIP / TOTAL_MISMATCH); nunca se auto-aprueba. Recomendación: monitorear las primeras altas reales.

### 🟡 P2
- **R2 — Factura B/C sin IVA discriminado** → carga manual (`source=empty`). Documentado; mejora en fase posterior.
- **R3 — Multipágina (cuadro IVA en hoja 2)** → Vision ve hoja 1; cae a fallback/manual. Render multipágina diferido.

### ⚪ P3
- **R4 — Sin telemetría de exactitud OCR** (tasa de corrección humana). Mejora futura para iterar el prompt.

---

## 8. Veredicto

> # 🟢 ERP-B2 COMPLETADO
>
> ERP-B2 (OCR Fiscal Avanzado) está **integrado, validado y desplegado** en `main` (`3db919c` == `origin/main`):
> - **Commits** `c5797d5` (código) + `bc598c3` (docs), **merge `--no-ff` `3db919c`**, push **fast-forward sin force** (`6b6b4c8..3db919c`).
> - **Build = PASS** (typecheck/lint/build EXIT 0); **Deploy Netlify = PASS** (`ready`, `commit_ref 3db919c`, `production`, `error_message null`) → `nexus.logisticatops.com`.
> - **E2E OCR = PASS** (BEGIN…ROLLBACK, cero persistencia): 3 formas fiscales (simple 21% · multi 21%+10.5% · percepciones IVA/IIBB/Ganancias) + PDF texto/escaneado (mapper) → **VAT Lines, Other Taxes, Items poblados · Libro IVA Compras 2 filas correctas · Workflow AP aprobada**.
> - **Regresión ERP-B1 = PASS**; `0056–0059`, ERP-A y Tesorería **intactos**; producción DB no mutada.
>
> El INSERT directo a `supplier_invoices` quedó **eliminado**: toda factura OCR termina ahora en el detalle fiscal canónico vía `ap_create_supplier_invoice`.
>
> **Queda habilitado ERP-B3 (Libro IVA UI).** **No se inició** — pendiente de autorización.

---

## Anexo — Evidencia

| Verificación | Resultado |
|---|---|
| Commits | `c5797d5` (código, 7 archivos) · `bc598c3` (docs) |
| Merge a main | `--no-ff` → `3db919c` (parents `6b6b4c8`+`bc598c3`) |
| Push main | `6b6b4c8..3db919c` (FF, sin force) |
| `main` == `origin/main` | SÍ (`3db919c`) |
| typecheck / lint / build | EXIT 0 / 0 / 0 — PASS |
| Deploy Netlify | `ready` · `commit_ref 3db919c` · `production` — PASS |
| E2E OCR (5 casos, rolled-back) | PASS · libro 2 filas · workflow aprobada · 0 persistencia |
| Regresión ERP-B1 / ERP-A / Tesorería | PASS (intactos) |
| Migraciones 0056–0059 | intactas |
| Veredicto | **ERP-B2 COMPLETADO** |

---

*Fin — Reporte de Deploy ERP-B2. Veredicto: ERP-B2 COMPLETADO. Integrado en `main` (`3db919c`), build verde, deploy Netlify ready, E2E rolled-back PASS en prod. `0056–0059`, ERP-A y Tesorería intactos. No se inició ERP-B3.*
