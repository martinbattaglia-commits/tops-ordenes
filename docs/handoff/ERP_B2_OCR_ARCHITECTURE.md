# ERP-B2 · ARQUITECTURA DE OCR AVANZADO

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_B2_OCR_ARCHITECTURE.md`
**Fecha:** 2026-06-07
**Naturaleza:** **auditoría + diseño**. No se escribió código, ni migraciones, ni se modificó producción. Fuente de verdad = `arsksytgdnzukbmfgkju`.
**Base:** `main` `6b6b4c8` (ERP-B1 consolidado: `0052–0059`).

> **Objetivo:** que una factura de proveedor recorra **PDF → OCR → Header + VAT Lines + Other Taxes → Workflow AP** y quede *prácticamente lista para aprobación*, con mínima intervención humana, alimentando la fundación fiscal que **ya existe** (B1) pero que **hoy nadie llena**.

---

## 0. Resumen ejecutivo

ERP-B1 construyó las tablas canónicas (`supplier_invoice_vat_lines`, `supplier_invoice_other_taxes`, `supplier_invoice_items`) y la RPC reconciliadora `ap_create_supplier_invoice`. **Están vacías y sin uso**: el alta real de la app (`createSupplierInvoiceAction`) hace un `INSERT` directo a la cabecera con **3 montos planos** (`neto`/`iva`/`percepciones`) y **nunca invoca el RPC ni el detalle**. El OCR, a su vez, extrae montos en una lista plana (`amounts[].kind = neto|iva|total|otro`) sin desglose por alícuota ni clasificación de percepciones, y el mapper **suma todo "otro" como percepciones** (`ocr-map.ts:228-230`).

ERP-B2 es el puente: **enriquecer la extracción** (prompt + schema), **mapear a estructuras fiscales** (vat_lines[] / other_taxes[]), **validar fiscalmente en cliente** (espejo de la identidad del RPC) y **conmutar la persistencia** del `INSERT` legacy al RPC `ap_create_supplier_invoice`. La fundación destino ya valida durísimo (pares AFIP, IVA coherente, total reconciliado), así que el riesgo estructural es bajo. **Veredicto: READY** (detalle en §9).

---

## 1. OCR actual

### 1.1 Topología (archivos)

| Capa | Archivo | Rol |
|---|---|---|
| Endpoint | `src/app/api/documental/ocr/route.ts` | recibe archivo, despacha a extractor |
| Extracción | `src/lib/ocr/openai.ts` | prompt único + 3 caminos (pdf_text / pdf_image / image) |
| Render | `src/lib/ocr/pdf-render.ts` | rasteriza 1ª página de PDF escaneado → PNG |
| Tipos | `src/lib/ocr/types.ts` | `ExtractedDocument` (amounts **planos**) |
| Mapper | `src/lib/erp/ocr-map.ts` | `ExtractedDocument` → `InvoicePrefill` (3 montos planos) |
| Form | `src/app/(app)/compras/facturas/nueva/NuevaFacturaForm.tsx` | prefill + 3 inputs (neto/iva/percep) |
| Persistencia | `src/app/(app)/compras/facturas/nueva/actions.ts` | **INSERT directo legacy** (no RPC) |
| Adjunto | `…/nueva/ocr-actions.ts` | sube blob, patch `pdf_url` (best-effort) |

### 1.2 Extracción (cómo funciona hoy)

- **Estrategia híbrida** (`openai.ts:12-26`): PDF con texto → `pdf-parse` → GPT-4o-mini texto (~$0.001); PDF escaneado (`rawText < 100`) → rasteriza a PNG → GPT-4o-mini **Vision** (`sourceKind: pdf_image`); imagen JPG/PNG → Vision directo. Modelo configurable (`OPENAI_OCR_MODEL`, default `gpt-4o-mini`), `temperature 0.1`, `response_format json_object`, `max_tokens 2000-2500`.
- **Prompt único** (`EXTRACTION_PROMPT`, `openai.ts:51-96`) genérico para 11 tipos de documento. Para montos pide una lista `amounts[]` con `kind ∈ {subtotal, iva, total, neto, otro}` — **un solo IVA, un solo neto, todo lo demás "otro"**. Tiene un bloque `comprobante` discreto bien resuelto (letra/clase/PV/numero/CAE) que sobrevive al camino de imagen.
- **Saneo** (`mergeWithDefaults`, `normalizeComprobante`, `normalizeDate`): valida tipo, clamp de confianza, fecha ISO, CAE 14 díg, PV/numero solo dígitos. Sólido para cabecera.

### 1.3 Mapeo (cómo arma el prefill)

`mapOcrToInvoice` (`ocr-map.ts:333`) produce `InvoicePrefill` con confianza explicable por campo (presencia + formato + cross-check). **Cabecera muy buena**: `detectVendor` (match por CUIT con dígito verificador + razón social normalizada), `detectTipo` (letra+clase del comprobante), `detectPvNumero`, `detectCae`. **Montos pobres**: `detectAmounts` (`ocr-map.ts:220-267`) toma `pick("neto")`/`pick("iva")`/`pick("total")` y **suma todos los "otro" en un único `percepciones`**; reconstruye `neto = total − iva − percep` si falta; valida `neto+iva+percep ≈ total` con tolerancia 1%.

### 1.4 Persistencia (el eslabón roto)

`createSupplierInvoiceAction` (`actions.ts:47-68`) hace `supabase.from("supplier_invoices").insert({ neto, iva, percepciones, total, … })` — **directo, sin RPC, sin detalle, sin audit, sin approval workflow**. El `total` se computa en JS (`neto+iva+percep`). **No usa nada de B1.**

### 1.5 Evidencia de producción (`arsksytgdnzukbmfgkju`)

4 facturas reales, todas `approval_status='cargada'`, `status='pendiente'`. **Detalle B1: `vat_lines=0, other_taxes=0, items=0`** (vacío total). 13 proveedores.

| # | Tipo | PV-Nº | neto | iva | percep | IVA efectivo | Lectura |
|---|---|---|---|---|---|---|---|
| 1 | A | 13-1255 | 880 860.39 | 184 980.68 | 0 | **21.00%** | factura simple 21% limpia |
| 2 | A | 2031-247690 | 69 941.86 | 2 998.26 | **32 582.38** | **4.29%** | **caso testigo del gap**: IVA efectivo ≠ alícuota AFIP + percepciones = 46% del neto → multi-componente que la cabecera plana no puede representar |
| 3 | B | 6-5228129 | 100 000 | 10 000 | 0 | 10% | seed de prueba |
| 4 | A | 1-52 | 50 000 | 10 000 | 0 | 20% | seed de prueba (sin CAE/PDF) |

> La factura **#2** prueba en datos reales por qué B2 es necesario: su IVA efectivo (4.29%) no es ninguna alícuota AFIP válida → mezcla de bases a distintas alícuotas (o no gravado) colapsadas en un solo `neto`, y un bloque de percepciones de $32.582 sin clasificar (¿IVA? ¿IIBB? ¿Ganancias?). El crédito fiscal y el Libro IVA Compras son imposibles de derivar de esa cabecera.

---

## 2. Gaps

| ID | Severidad | Gap | Evidencia |
|---|---|---|---|
| **G1** | P0 | **Extracción no desglosa IVA por alícuota.** El prompt pide un único `iva`. Una factura 21%+10.5% colapsa a un solo número. | `openai.ts:68-70`, `types.ts:18-27` |
| **G2** | P0 | **No clasifica percepciones.** Todo "otro" → un solo `percepciones`; no distingue PERCEPCION_IVA / IIBB (+jurisdicción) / GANANCIAS / IMPUESTO_INTERNO. | `ocr-map.ts:228-230` |
| **G3** | P0 | **Persistencia bypassa B1.** Alta = INSERT directo a cabecera; nunca llama `ap_create_supplier_invoice` ni llena el detalle. Las tablas B1 quedan vacías. | `actions.ts:47-68` |
| **G4** | P1 | **Sin validación fiscal dura en la captura.** El cross-check es ±1% sobre el total; no valida pares (alic_iva_id↔alícuota), ni `importe_iva ≈ base·alícuota`, ni la identidad `total = neto+no_grav+exento+iva+percep+tributos`. | `ocr-map.ts:238-243` |
| **G5** | P1 | **No separa neto gravado / no gravado / exento.** `neto` absorbe todo; `importe_no_gravado`/`importe_exento` (existen en cabecera desde 0056) nunca se llenan. | `actions.ts:60`, `0056:51-54` |
| **G6** | P1 | **Form sólo tiene 3 inputs planos** (neto/iva/percep). No hay UI para N renglones de IVA ni M percepciones tipadas. | `NuevaFacturaForm.tsx:92-94,476-490` |
| **G7** | P2 | **Sin auto-submit al workflow.** Tras crear no hay `ap_submit_for_review`/`ap_approve` opcional; queda en `cargada` siempre. | (no existe) |
| **G8** | P2 | **Vision sólo 1ª página.** Facturas multipágina con detalle de alícuotas al pie pueden perder el cuadro IVA si está en hoja 2. | `openai.ts:170-171` |
| **G9** | P2 | **No mapea `lineItems` → `supplier_invoice_items`.** El modelo ya extrae renglones; se descartan. | `types.ts:40-47` vs `0056:138` |
| **G10** | P3 | **Sin telemetría de exactitud OCR** (tasa de campos corregidos por humano) para mejorar prompts. | (no existe) |

---

## 3. Modelo objetivo

### 3.1 Estructura destino (ya existe en B1 — no se modifica)

- **`supplier_invoice_vat_lines`**: `{alic_iva_id (3/4/5/6/8/9), alicuota_iva (0/2.5/5/10.5/21/27), base_neto, importe_iva}`. CHECK: par AFIP válido (`sivl_alic_pair_chk`), `|importe_iva − round(base·alíc/100,2)| ≤ 0.02` (`sivl_iva_coherente_chk`), unique por (factura, alic_iva_id).
- **`supplier_invoice_other_taxes`**: `{tax_kind (PERCEPCION_IVA|PERCEPCION_IIBB|PERCEPCION_GANANCIAS|IMPUESTO_INTERNO|OTRO), jurisdiction, base, alicuota, importe}`. CHECK: IIBB exige `jurisdiction`.
- **`supplier_invoice_items`** (opcional, no fiscal): `{descripcion, cantidad, precio_unitario, alic_iva_id, importe_neto, importe_iva, importe_total, orden}`.
- **Cabecera** = caché reconciliada por el RPC: `neto=Σbase_neto`, `iva=Σimporte_iva`, `percepciones=Σ(PERCEPCION_*)`, `tributos=Σ(IMPUESTO_INTERNO,OTRO)`, `total=neto+no_grav+exento+iva+percep+tributos`.

### 3.2 Contrato OCR objetivo (lo nuevo de B2)

El `ExtractedDocument` debe ganar un bloque fiscal opcional **`fiscal`** (aditivo, no rompe los otros 10 tipos de documento):

```
fiscal: {
  vatLines: [ { alicuota: 21|10.5|27|5|2.5|0, baseNeto: number, importeIva: number } ],
  otherTaxes: [ { kind: "PERCEPCION_IVA"|"PERCEPCION_IIBB"|"PERCEPCION_GANANCIAS"|"IMPUESTO_INTERNO"|"OTRO",
                  jurisdiction: string|null, base: number|null, alicuota: number|null, importe: number } ],
  netoNoGravado: number|null,
  netoExento:    number|null,
  totalDeclarado: number|null
}
```

El mapper traduce `alicuota → alic_iva_id` con el **mapa AFIP fijo** (`21→5, 10.5→4, 27→6, 5→8, 2.5→9, 0→3`) y arma los arrays que consume el RPC tal cual (`p_vat_lines`, `p_other_taxes`, `p_items`). La cabecera se completa con `importe_no_gravado`/`importe_exento` y **se deja que el RPC derive el resto** (no se envía neto/iva agregados; el RPC los reconcilia).

### 3.3 Niveles de autonomía

- **Verde (auto-listo):** todas las alícuotas mapean a pares AFIP, IVA coherente por renglón, identidad total cuadra ≤0.02, proveedor matcheado por CUIT, CAE presente → factura prellenada lista; humano confirma 1 clic (y opcionalmente auto-`submit_for_review`).
- **Amarillo (revisión):** algún renglón no cuadra, percepción sin clasificar, o total declarado ≠ derivado → se prellenan los renglones pero la UI marca los que requieren ojo humano.
- **Rojo (manual):** OCR no separó alícuotas / Vision falló / multipágina sin cuadro IVA → cae al alta manual con renglones vacíos (comportamiento actual, nunca peor).

---

## 4. Pipeline OCR (objetivo)

```
[1] Upload (PDF/JPG/PNG)
     │
[2] Ruteo de extracción (sin cambios estructurales)
     ├─ PDF con texto  → pdf-parse → GPT-4o-mini (texto)
     ├─ PDF escaneado  → render PNG (→ ampliar a N páginas si hay cuadro IVA al pie) → Vision
     └─ Imagen         → Vision directo
     │
[3] Extracción enriquecida (PROMPT v2)
     · Mantiene comprobante/parties/fecha (ya sólidos)
     · AÑADE bloque `fiscal`: vatLines[] por alícuota, otherTaxes[] tipados, no_gravado/exento, totalDeclarado
     · Reglas AFIP en el prompt: alícuotas válidas {0,2.5,5,10.5,21,27}; IIBB siempre con provincia;
       percepción de IVA ≠ IVA; "IIBB"/"Ing. Brutos"→PERCEPCION_IIBB; "Ret./Perc. Ganancias"→PERCEPCION_GANANCIAS
     │
[4] Normalización (ocr-map v2)
     · alicuota → alic_iva_id (mapa AFIP fijo); descarta alícuotas no válidas → amarillo
     · clasifica otherTaxes; exige jurisdiction en IIBB
     · cabecera: no_gravado/exento; NO agrega neto/iva (los deriva el RPC)
     · confianza por renglón (presencia + coherencia base·alícuota + identidad total)
     │
[5] Validación fiscal en cliente (espejo del RPC, pre-submit) — §5
     │
[6] Prefill UI (form v2): N renglones IVA + M percepciones + cabecera; semáforo por renglón
     │
[7] Persistencia vía RPC  →  ap_create_supplier_invoice(p_header, p_vat_lines, p_other_taxes, p_items)
     · reconcilia, valida duro, inserta cabecera+detalle+audit atómico, devuelve {invoice_id, totales}
     │
[8] Adjunto (attach existente) + opcional ap_submit_for_review (auto-encaminar)
```

**Costos/latencia:** sin cambio de orden de magnitud (mismo modelo). El prompt v2 agrega ~tokens de salida (renglones), absorbibles subiendo `max_tokens` a ~3000. Override a `gpt-4o` reservado para facturas con cuadros de IVA complejos/manuscritos.

---

## 5. Validaciones fiscales (capa cliente, espejo del RPC)

Antes de llamar al RPC, validar en cliente para feedback inmediato (el RPC es la autoridad final e idéntica):

| V | Regla | Fuente canónica |
|---|---|---|
| **V1** | `alic_iva_id ↔ alicuota_iva` es par AFIP válido `{(3,0),(4,10.5),(5,21),(6,27),(8,5),(9,2.5)}` | `0056:89-93` |
| **V2** | Por renglón: `|importe_iva − round(base_neto·alícuota/100,2)| ≤ 0.02` | `0056:95-97` |
| **V3** | `base_neto ≥ 0`, `importe_iva ≥ 0`, `importe ≥ 0` | `0056:98-99,125` |
| **V4** | Una sola fila por alícuota (consolidar renglones repetidos antes de enviar) | `0056:101` |
| **V5** | `PERCEPCION_IIBB ⇒ jurisdiction` no vacío | `0056:122-124` |
| **V6** | Identidad: `total = Σbase_neto + no_grav + exento + Σimporte_iva + Σpercep + Σtributos`; si OCR trae `totalDeclarado`, `|declarado − derivado| ≤ 0.02` | `0058:66-73` |
| **V7** | `vendor_id` y `numero` requeridos | `0058:48-51` |
| **V8** | Unicidad (tipo, PV, número, proveedor) — el RPC lanza `DUPLICATE_INVOICE` | `0058:99-101` |

> Diseño: **el cliente nunca es la autoridad** — V1–V8 reproducen las CHECK/validaciones del RPC para UX; si el cliente se equivoca, el RPC rechaza (`TOTAL_MISMATCH`, `sivl_*_chk`, `DUPLICATE_INVOICE`). Cero confianza en el front para integridad fiscal.

---

## 6. Integración B1

| Aspecto | Hoy (legacy) | B2 (objetivo) |
|---|---|---|
| Persistencia | `INSERT` directo a `supplier_invoices` | `rpc('ap_create_supplier_invoice', {p_header, p_vat_lines, p_other_taxes, p_items})` |
| Detalle IVA | — | `p_vat_lines[]` → `supplier_invoice_vat_lines` |
| Percepciones | 1 monto plano | `p_other_taxes[]` tipado → `supplier_invoice_other_taxes` |
| Renglones | descartados | `p_items[]` → `supplier_invoice_items` (de `lineItems`) |
| Totales cabecera | computados en JS | **derivados por el RPC** (caché reconciliada) |
| Audit | — | `supplier_invoice_audit` (acción `crear`) automática |
| Estado | `status='pendiente'` legacy | `approval_status='cargada'` + opcional `ap_submit_for_review` |
| Libro IVA | imposible (sin detalle) | `libro_iva_compras` se puebla solo (periodo/alícuota/neto/crédito) |
| Permisos | RLS genérica | `has_permission('cuentas_pagar.create')` dentro del RPC |

**Cambios de código B2 (alcance, para la fase de implementación):**
1. `src/lib/ocr/openai.ts` — PROMPT v2 (bloque `fiscal`) + `max_tokens`.
2. `src/lib/ocr/types.ts` — `ExtractedDocument.fiscal?` (aditivo).
3. `src/lib/erp/ocr-map.ts` — `detectAmounts` → `detectFiscalDetail` (vatLines[]/otherTaxes[] + mapa AFIP + confianza por renglón).
4. `NuevaFacturaForm.tsx` — UI dinámica de renglones IVA + percepciones tipadas + semáforo; estado y `total` derivado.
5. `…/nueva/actions.ts` — `createSupplierInvoiceAction` → adaptador fino sobre `ap_create_supplier_invoice` (`humanizeRpcError`); preservar fallback demo.
6. (Opcional) `pdf-render.ts` — render multipágina cuando se detecta cuadro IVA al pie.

> **Sin migraciones**: B1 (`0056–0059`) cubre todo el almacenamiento y la lógica. B2 es **frontend + capa de extracción/mapeo + cambio de llamada de persistencia**. No toca ERP-A ni el esquema.

---

## 7. Riesgos

### 🔴 P0
- **R1 — Regresión del alta.** Cambiar INSERT→RPC toca el camino crítico de carga de facturas. Mitigación: el RPC ya está probado (smoke 9/9 B1); feature-flag/coexistencia; E2E rolled-back antes de cortar; preservar fallback demo.
- **R2 — Alucinación de alícuotas/percepciones.** El LLM puede inventar un renglón 21% que no está, o clasificar mal IIBB vs Ganancias. Mitigación: V1–V8 en cliente + CHECK del RPC rechazan incoherencias; semáforo amarillo fuerza revisión humana; nunca auto-aprobar (sólo opcional auto-`submit_for_review`, no `approve`).

### 🟠 P1
- **R3 — Multipágina / cuadro IVA al pie.** Vision sólo ve hoja 1 (G8). Mitigación: detectar y rasterizar páginas con patrón de cuadro IVA; si falta, caer a amarillo (renglón único = total) y avisar.
- **R4 — Bases que no cuadran por redondeo AFIP.** Sumas de renglones con ±0.01. Mitigación: tolerancia 0.02 ya en CHECK/RPC; consolidar por alícuota (V4) antes de enviar.
- **R5 — Percepción de IVA confundida con IVA crédito.** Inflaría el crédito fiscal. Mitigación: regla explícita en prompt + el RPC separa `vat_lines` (crédito) de `other_taxes` (percepción); revisión en amarillo.

### 🟡 P2
- **R6 — FACTURA_B/C sin crédito fiscal** pero con IVA discriminado erróneo. Mitigación: en B/C el IVA no es computable; el prompt debe tratar el "IVA" de B como no-discriminado (parte del neto) — regla por letra.
- **R7 — Costo/latencia** por prompts más largos y override a gpt-4o. Mitigación: mantener 4o-mini por defecto; subir tier sólo por confianza baja.
- **R8 — `lineItems` ruidosos** inflando `supplier_invoice_items`. Mitigación: items son no-fiscales/opcionales; cap de renglones; no bloquean.

### ⚪ P3
- **R9 — Falta de telemetría** de exactitud (G10). Mitigación: registrar tasa de campos corregidos por humano para iterar el prompt.
- **R10 — Jurisdicciones IIBB no normalizadas** (texto libre). Mitigación: catálogo de provincias ARCA en UI (no bloqueante).

---

## 8. Roadmap

| Fase | Entregable | Alcance | Gate |
|---|---|---|---|
| **B2.0** | `ERP_B2_OCR_ARCHITECTURE.md` (este doc) | auditoría + diseño | ✅ aprobación presidencial |
| **B2.1** | Extracción enriquecida | PROMPT v2 + `ExtractedDocument.fiscal` (types) — aditivo, no rompe otros tipos | revisión de prompt + pruebas con los 5 casos obligatorios |
| **B2.2** | Mapeo fiscal | `ocr-map` v2 (vatLines[]/otherTaxes[] + mapa AFIP + confianza por renglón) + V1–V8 cliente | unit tests del mapper sobre fixtures reales (factura #1 y #2 de prod) |
| **B2.3** | UI de renglones | `NuevaFacturaForm` v2: N renglones IVA + M percepciones tipadas + semáforo + total derivado | revisión UX |
| **B2.4** | Conmutar persistencia | `createSupplierInvoiceAction` → adaptador `ap_create_supplier_invoice` (humanizeRpcError, fallback demo) | E2E **rolled-back** en prod (5 casos), ERP-A intacto |
| **B2.5** | Auto-encaminar (opcional) | `ap_submit_for_review` post-alta + items de `lineItems` | revisión |
| **B2.6** | Cierre | `ERP_B2_*` execution report + consolidación Git | veredicto CONSOLIDATED |

**Casos obligatorios (suite de validación B2.2/B2.4):**
1. **Simple 21%** → 1 vat_line (5, 21). *(= factura real #1, 880 860.39 / 184 980.68)*
2. **Multi-alícuota 21%+10.5%** → 2 vat_lines (5,21)+(4,10.5).
3. **Con percepciones IVA+IIBB+Ganancias** → 3 other_taxes (IIBB con jurisdicción). *(aproxima factura real #2)*
4. **Escaneada (imagen)** → camino Vision; comprobante/CAE preservados.
5. **PDF texto embebido** → camino pdf_text.

---

## 9. Veredicto

> # 🟢 READY FOR ERP-B2 IMPLEMENTATION
>
> La fundación destino **ya existe, está consolidada y validada** (B1: `0056–0059` en `main 6b6b4c8` y en prod `arsksytgdnzukbmfgkju`), con validación fiscal dura en el RPC `ap_create_supplier_invoice` (pares AFIP, IVA coherente, identidad total, audit, RBAC). El gap de B2 está **acotado y mapeado** a 5–6 archivos de **frontend + capa de extracción/mapeo + conmutación de la llamada de persistencia** — **sin migraciones, sin tocar ERP-A, sin tocar el esquema**. La evidencia de producción (factura #2: IVA efectivo 4.29% + percepciones 46% sin clasificar, detalle B1 vacío) confirma a la vez el problema y que la estructura para resolverlo ya está disponible.
>
> Riesgos P0 (regresión del alta, alucinación de alícuotas) tienen mitigación clara: el RPC es la autoridad final e idéntica al cliente, el semáforo fuerza revisión humana en lo dudoso, y nunca se auto-aprueba. Camino degradado (rojo) = el alta manual actual, nunca peor.
>
> **Recomendación:** proceder a **B2.1** (extracción enriquecida) bajo el patrón gated habitual. Este documento es **sólo diseño**: no se escribió código, ni migraciones, ni se modificó producción.

---

## Anexo — Evidencia

| Verificación | Resultado |
|---|---|
| Rama / HEAD | `main` / `6b6b4c8` (B1 consolidado) |
| Persistencia actual | `INSERT` directo (`actions.ts:47`), **no** usa `ap_create_supplier_invoice` |
| Detalle B1 en prod | `vat_lines=0, other_taxes=0, items=0` (vacío) |
| Facturas reales | 4 (`cargada`/`pendiente`); #2 IVA efectivo 4.29% + percep 46% (gap testigo) |
| Prompt OCR | único, 11 tipos; `amounts` planos (1 iva / 1 neto / "otro") |
| Mapper montos | suma todo "otro" → 1 percepción (`ocr-map.ts:228-230`) |
| Contrato RPC destino | `ap_create_supplier_invoice(p_header, p_vat_lines, p_other_taxes, p_items)` deriva totales y valida ≤0.02 |
| Mapa AFIP alícuotas | 3=0 · 4=10.5 · 5=21 · 6=27 · 8=5 · 9=2.5 (`0056:89-93`) |
| Migraciones B2 | **ninguna** (B1 cubre el almacenamiento) |
| Veredicto | **READY FOR ERP-B2 IMPLEMENTATION** |

---

*Fin — Arquitectura de OCR Avanzado ERP-B2. Veredicto: READY FOR ERP-B2 IMPLEMENTATION. Sólo auditoría y diseño: no se escribió código ni migraciones, no se modificó producción, no se tocó ERP-A.*
