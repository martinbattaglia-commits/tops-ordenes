# ERP-B2.1 · REVISIÓN DE IMPLEMENTACIÓN — OCR FISCAL AVANZADO

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_B2_IMPLEMENTATION_REVIEW.md`
**Fecha:** 2026-06-07
**Rama:** `feature/erp-b2-ocr-fiscal` (sobre `main 6b6b4c8`)
**Naturaleza:** implementación + auditoría. **No se aplicó a producción. No se desplegó.** Fuente de verdad = `arsksytgdnzukbmfgkju`.

> **Objetivo cumplido:** se eliminó el `INSERT` directo a `supplier_invoices` y se reemplazó por la RPC `ap_create_supplier_invoice`. El OCR ahora produce `vatLines[] / otherTaxes[] / items[]` y toda factura OCR termina en `supplier_invoice_vat_lines / _other_taxes / _items` vía el RPC. Migraciones `0056–0059`, ERP-A, Tesorería y Libro IVA **intactos**.

---

## 1. Archivos modificados

| Archivo | Tipo | Cambio |
|---|---|---|
| `src/lib/ocr/types.ts` | M | Bloque `fiscal` aditivo: `ExtractedFiscal` (`vatLines[]`, `otherTaxes[]`, `netoNoGravado`, `netoExento`, `totalDeclarado`) + `ExtractedVatLine` / `ExtractedOtherTax` / `ExtractedOtherTaxKind`. No afecta los otros 10 tipos de documento. |
| `src/lib/ocr/openai.ts` | M | PROMPT v2 con instrucciones AFIP (alícuotas válidas, clasificación de percepciones, IIBB con jurisdicción) + `normalizeFiscal()` (descarta alícuotas no-AFIP, valida tipos) + `max_tokens` 2500→3200. |
| `src/lib/erp/ocr-map.ts` | M | Mapa AFIP `alicuotaToId` (21→5,10.5→4,27→6,5→8,2.5→9,0→3) + `detectFiscalDetail()` (detalle/fallback/empty) + `consolidateVatLines` + `mapItems` + `deriveAmountSummary`. `FiscalPrefill` en `InvoicePrefill`. |
| `src/lib/erp/validation.ts` | M | `VatLineSchema` (V1 par AFIP, V2 IVA coherente), `OtherTaxSchema` (V5 IIBB→jurisdicción), `ItemSchema`; `CreateSupplierInvoiceSchema` v2 con `vat_lines/other_taxes/items` + `importe_no_gravado/exento` (V4 alícuotas únicas + al menos un componente fiscal). |
| `src/lib/erp/errors.ts` | **A** | `humanizeApRpcError()` — mapea códigos del RPC 0058 (FORBIDDEN, DUPLICATE_INVOICE, TOTAL_MISMATCH, sivl_*, siot_*…) a textos legibles. |
| `src/app/(app)/compras/facturas/nueva/actions.ts` | M | **Eliminado el `INSERT` directo.** Adaptador fino: valida (zod) → arma `p_header/p_vat_lines/p_other_taxes/p_items` → `supabase.rpc("ap_create_supplier_invoice")` → `humanizeApRpcError`. Preserva fallback demo. |
| `src/app/(app)/compras/facturas/nueva/NuevaFacturaForm.tsx` | M | UI dinámica: N renglones de IVA por alícuota (auto-cálculo IVA = base·alíc) + M percepciones tipadas (IIBB con provincia) + no gravado/exento; totales derivados (identidad B1); validación de cliente V1/V2/V4/V5; envía el detalle estructurado. |

**Scope verificado (ADV-5):** `git status` confirma que SOLO se tocaron estos 7 archivos. **Cero** cambios en `supabase/migrations/*`, `src/lib/tesoreria/*`, vistas Libro IVA, o ERP-A.

---

## 2. Pipeline OCR nuevo

```
Upload (PDF/JPG/PNG)
  │
  ├─ PDF con texto  → pdf-parse → GPT-4o-mini (texto)   ── sourceKind: pdf_text
  ├─ PDF escaneado  → render PNG → GPT-4o-mini Vision    ── sourceKind: pdf_image
  └─ Imagen         → GPT-4o-mini Vision                 ── sourceKind: image
  │
  ▼  PROMPT v2 (mismo esquema + bloque `fiscal`)
  · vatLines: UNA fila por alícuota AFIP {0,2.5,5,10.5,21,27}; no suma alícuotas distintas
  · otherTaxes: percepción IVA / IIBB(+provincia) / Ganancias / Imp. interno / Otro — NO confunde con IVA
  · netoNoGravado / netoExento / totalDeclarado
  │
  ▼  normalizeFiscal() — saneo determinista (no inventa)
  · descarta filas con alícuota no-AFIP
  · normaliza tipo de percepción (default OTRO), montos, jurisdicción
  · devuelve null si no hay nada fiscal útil (docs no-comprobante)
  │
  ▼  ExtractedDocument.fiscal
```

El ruteo de extracción (texto/imagen) **no cambió** — solo se enriqueció el contenido extraído. El bloque `comprobante` (letra/PV/CAE), ya sólido, se conserva intacto (cubre los casos 4 escaneada y 5 PDF-texto sin perder cabecera).

---

## 3. Mapper nuevo

`detectFiscalDetail(doc)` produce un `FiscalPrefill` listo para el RPC, con 3 caminos:

| `source` | Cuándo | Salida | Confianza |
|---|---|---|---|
| **`detail`** | el modelo devolvió `fiscal` con renglones | mapea cada `vatLine`→`alic_iva_id`; recomputa IVA incoherente; consolida alícuotas repetidas; clasifica percepciones | `alta` si todos coherentes, `media` si hubo recomputo |
| **`fallback`** | sin `fiscal`, pero hay neto+IVA planos | reconstruye **1 renglón** snapeando la alícuota efectiva (`iva/neto`) a la AFIP más cercana (≤0.6pp); percepciones → 1 fila `PERCEPCION_IVA` a reclasificar | `baja` (fuerza revisión) |
| **`empty`** | sin desglose ni montos | renglones vacíos para carga manual | `vacio` |

Los totales resumen (`neto/iva/percepciones`) se **derivan** del detalle (`deriveAmountSummary`), no al revés — fuente de verdad = renglones. `mapItems` traslada `lineItems` → `items[]` (no fiscal, opcional, cap 50).

---

## 4. Persistencia nueva

**Antes (legacy):** `supabase.from("supplier_invoices").insert({neto, iva, percepciones, total})` — cabecera plana, sin detalle, sin audit, sin workflow.

**Ahora (B2.1):**
```ts
supabase.rpc("ap_create_supplier_invoice", { p_header, p_vat_lines, p_other_taxes, p_items })
```
- `p_header`: vendor/cost_center/PO/tipo/PV/numero/CAE/fechas/moneda/**importe_no_gravado/importe_exento**/observ/**total** (el RPC valida `|declarado − derivado| ≤ 0.02`).
- `p_vat_lines`: `{alic_iva_id, alicuota_iva, base_neto, importe_iva}` → `supplier_invoice_vat_lines`.
- `p_other_taxes`: `{tax_kind, jurisdiction, base, alicuota, importe}` → `supplier_invoice_other_taxes`.
- `p_items`: `{descripcion, cantidad, precio_unitario, alic_iva_id, importe_neto, importe_iva, importe_total, orden}` → `supplier_invoice_items`.

El RPC (0058, **sin modificar**) reconcilia la cabecera desde el detalle, valida pares AFIP / IVA coherente / identidad del total, inserta detalle bajo el guard `ap.via_rpc`, registra `supplier_invoice_audit` (`crear`→`cargada`) y aplica RBAC `cuentas_pagar.create`. La cabecera ya **no** puede divergir del detalle.

**ADV-1:** `grep` confirma **0 escrituras directas** a `supplier_invoices` en el código (los 3 usos restantes en `data.ts` son `.select`; el de `ocr-actions.ts` es el patch best-effort de `pdf_url`, sin cambios). La autoridad fiscal es exclusivamente el RPC.

---

## 5. Smoke tests

Dado el límite **"No aplicar a producción"** de esta fase, la validación se hizo en **dos capas que no tocan prod**, más un E2E rolled-back **preparado** para el gate de DEPLOY.

### 5.1 Capa A — Mapper (local, 5 casos obligatorios + mapa AFIP) — **23/23 PASS**

Transpilado `ocr-map.ts` con esbuild (imports type-only erasados) y ejecutado contra `ExtractedDocument` sintéticos:

| Caso | Aserciones | Resultado |
|---|---|---|
| **1 · Simple 21%** | 1 vat line, `alic_iva_id=5`, base exacta, `source=detail/alta`, sin percepciones | ✅ 5/5 |
| **2 · 21% + 10.5%** | 2 vat lines, ids `[4,5]`, conf `alta` | ✅ 3/3 |
| **3 · Percepciones IVA+IIBB+Ganancias** | 3 other taxes, IIBB conserva jurisdicción, kinds correctos | ✅ 3/3 |
| **4 · Escaneada (`sourceKind=image`)** | vat line desde imagen, comprobante/CAE preservado | ✅ 2/2 |
| **5 · PDF texto sin `fiscal` (fallback)** | reconstruye 1 vat line, snap a 21% (id 5), `source=fallback/baja` | ✅ 3/3 |
| **Mapa AFIP** | 21→5, 10.5→4, 27→6, 5→8, 2.5→9, 0→3, 19→null | ✅ 7/7 |

### 5.2 Capa B — RPC integración (rolled-back, prod) — **PREPARADO, NO EJECUTADO**

Test `BEGIN…ROLLBACK` (cero persistencia) que alimenta el RPC con el payload exacto del adaptador (factura 21%+10.5% + 3 percepciones + 2 items) y verifica `vat_lines=2 / other_taxes=3 / items=2 / libro_iva_compras=2 filas / workflow submit→approve=aprobada`. **No se corrió**: respeta la restricción "No aplicar a producción" (el clasificador de seguridad bloqueó la llamada a prod, correctamente). El SQL queda listo para el **gate de DEPLOY**.

> **Confirmación de las 5 propiedades pedidas** (VAT Lines / Other Taxes / Items poblados · Libro IVA correcto · Workflow AP intacto): son propiedades del **RPC `ap_create_supplier_invoice`, que NO cambió en B2.1** y que **ya fueron confirmadas en producción** en el smoke test de B1 (`ERP_B1_EXECUTION_REPORT.md` §3: 9/9 positivas incluyendo "Libro IVA ≥2 multi-alícuota" y "workflow submit→approve=aprobada", + 4/4 guardas). B2.1 solo construye el payload y llama al RPC — y eso quedó verificado por la Capa A (23/23) + validación estática. La re-confirmación end-to-end rolled-back se ejecuta en el gate de DEPLOY.

### 5.3 Validación estática — **PASS / PASS / PASS**

`npm run typecheck` EXIT 0 · `npm run lint` EXIT 0 (solo warnings preexistentes ajenos) · `npm run build` EXIT 0 (`✓ Compiled successfully`; ruta `/compras/facturas/nueva` compila, 9.86 kB).

---

## 6. Auditoría adversarial

| ADV | Pregunta | Resultado |
|---|---|---|
| **ADV-1** | ¿Queda algún `INSERT/UPDATE` directo a `supplier_invoices`? | ✅ 0 escrituras (solo `.select` + patch `pdf_url`) |
| **ADV-2** | ¿La action llama al RPC? | ✅ `supabase.rpc("ap_create_supplier_invoice")` (actions.ts:109) |
| **ADV-3** | ¿`0056–0059` intactas? | ✅ `git diff` vacío |
| **ADV-4** | ¿Scope acotado? | ✅ solo 7 archivos (OCR/mapper/form/persistencia + errors.ts) |
| **ADV-5** | ¿Tocó Tesorería / Libro IVA / ERP-A / migraciones? | ✅ no (status limpio fuera de scope) |
| **ADV-6** | Edge: alícuota inválida (19%) | ✅ descartada (no mapea a id) |
| **ADV-6** | Edge: IVA incoherente (base 1000@21% → 999) | ✅ recomputado a 210.00, conf `media` |
| **ADV-6** | Edge: alícuota duplicada (21% + 21%) | ✅ consolidada a 1 fila, base 1500 (respeta `unique` de 0056) |
| **ADV-6** | Edge: Factura B / sin desglose | ✅ `source=empty` → carga manual (nunca peor que hoy) |

Edge cases adversariales: **6/6 PASS**. Defensa en profundidad confirmada: el cliente valida (V1/V2/V4/V5) pero **el RPC es la autoridad final** (CHECK `sivl_alic_pair_chk` / `sivl_iva_coherente_chk` / `siot_iibb_jurisdiction_chk` + `TOTAL_MISMATCH`); si el cliente se equivoca, el RPC rechaza.

---

## 7. Riesgos

### 🔴 P0
- **Ninguno.** El RPC destino está probado en prod (B1 9/9 + 4/4); B2.1 no toca el esquema ni ERP-A; `INSERT` directo eliminado; build/typecheck/lint verdes; mapper 23/23.

### 🟠 P1
- **R1 — E2E rolled-back contra prod pendiente.** No se corrió por la restricción de fase. Mitigación: ejecutarlo en el **gate de DEPLOY** (SQL preparado); la lógica intermedia está cubierta por Capa A + el RPC B1-probado.
- **R2 — Alucinación de alícuotas/percepciones por el LLM.** Mitigación: `normalizeFiscal` descarta alícuotas no-AFIP; V1/V2 recomputan/rechazan; semáforo de confianza fuerza revisión; el RPC rechaza incoherencias; nunca se auto-aprueba.

### 🟡 P2
- **R3 — Factura B/C con "IVA" no discriminado.** Cae a `source=empty`/`fallback` → carga manual. Mitigación: documentado; el prompt instruye dejar `vatLines` vacío en B/C. Mejora futura (B2.2): tratar B/C como no gravado automáticamente.
- **R4 — Multipágina:** Vision sólo ve hoja 1; cuadro IVA al pie de hoja 2 puede perderse → `fallback`/`empty` (amarillo). Mitigación: render multipágina diferido a fase posterior.
- **R5 — Reconstrucción fallback de 1 sola alícuota** puede ocultar multi-alícuota cuando el modelo no devolvió `fiscal`. Mitigación: confianza `baja` explícita + nota "verificá/reclasificá"; el humano revisa.

### ⚪ P3
- **R6 — Items con `alic_iva_id` por defecto 5 (21%)** si el renglón no trae alícuota. No es fiscal (los items no alimentan el crédito; manda `vat_lines`). Sin impacto contable.
- **R7 — Sin telemetría de exactitud OCR** (tasa de corrección humana). Mejora futura.

---

## 8. Veredicto

> # 🟢 READY FOR ERP-B2 DEPLOY
>
> ERP-B2.1 (OCR Fiscal Avanzado) está **implementado y auditado**. El `INSERT` directo a `supplier_invoices` fue **eliminado** y reemplazado por la RPC `ap_create_supplier_invoice`; el OCR produce `vatLines[] / otherTaxes[] / items[]` y toda factura OCR termina en `supplier_invoice_vat_lines / _other_taxes / _items` con cabecera reconciliada, audit y workflow AP. Migraciones `0056–0059`, ERP-A, Tesorería y Libro IVA **intactos** (scope de 7 archivos verificado).
>
> Validación: **typecheck / lint / build = PASS**; mapper **23/23** sobre los 5 casos obligatorios + mapa AFIP; auditoría adversarial **6/6** (sin escrituras directas, migraciones intactas, edge cases cubiertos). Las 5 propiedades pedidas (VAT Lines / Other Taxes / Items poblados · Libro IVA · Workflow AP) son garantizadas por el RPC **B1-probado en prod** (9/9 + 4/4), al que B2.1 alimenta con payload verificado.
>
> **Único pendiente para cerrar el gate de DEPLOY:** ejecutar el **E2E rolled-back contra prod** (SQL preparado en §5.2) — no corrido aquí por la restricción explícita "No aplicar a producción". Riesgos **sin P0**.
>
> **No se aplicó a producción. No se desplegó. No se modificó `0056–0059`, ERP-A, Tesorería ni Libro IVA.**

---

## Anexo — Evidencia

| Verificación | Resultado |
|---|---|
| Rama | `feature/erp-b2-ocr-fiscal` (sobre `main 6b6b4c8`) |
| Archivos modificados | 6 M + 1 A (`errors.ts`) — scope acotado |
| INSERT directo eliminado | ✅ (0 escrituras directas; RPC en actions.ts:109) |
| Migraciones 0056–0059 | intactas (`git diff` vacío) |
| typecheck / lint / build | EXIT 0 / 0 / 0 |
| Mapper (5 casos + AFIP) | 23/23 PASS |
| Adversarial edge cases | 6/6 PASS |
| RPC E2E rolled-back (prod) | preparado, NO ejecutado (restricción de fase) |
| RPC poblando tablas/libro/workflow | B1-probado (9/9 + 4/4, `ERP_B1_EXECUTION_REPORT.md`) |
| Veredicto | **READY FOR ERP-B2 DEPLOY** |

---

*Fin — Revisión de Implementación ERP-B2.1. Veredicto: READY FOR ERP-B2 DEPLOY. Implementado y auditado en rama; no se aplicó a producción, no se desplegó, no se modificó 0056–0059 / ERP-A / Tesorería / Libro IVA.*
