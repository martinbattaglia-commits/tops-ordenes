# FACTURA-DESIGN-IMPLEMENTATION — Nuevo diseño institucional de facturas

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.) · **Fecha:** 2026-06-12
**Rama:** `feature/factura-design` · **Base:** main `84ca213`
**Fuente de verdad visual:** paquete `design_handoff_factura_tops_nexus` (Command Center · Alta legibilidad, Variante E/Dirección 05) — diseño aprobado; NO se rediseñó nada.

> **Estado: IMPLEMENTADO Y VALIDADO VISUALMENTE.** Solo capa visual: cálculos, IVA, numeración, ARCA, QR RG 4892, motor PDF (react-pdf), backend y base de datos **intactos** (mismos props `{invoice, config, qrDataUrl}`, misma ruta, mismo `buildInvoicePdf`).

## §1 — Qué se reemplazó

`src/lib/pdf/InvoicePdfDocument.tsx` se reescribió por completo del layout AFIP clásico (Helvetica, recuadro de letra central) al diseño **Command Center**: rail lateral navy con branding NEXUS, header oscuro con grilla + aurora, logos institucionales centrados, chips de estado, barra de fechas, tarjetas Emisor/Cliente con acentos, tabla ejecutiva, bloque Total con gradiente azul TOPS, trazabilidad CAE/QR y footer corporativo.

## §2 — Fidelidad al handoff (README = fuente de verdad)

| Elemento | Implementación |
|---|---|
| Escala | 880px → A4 595pt (factor 0,676) aplicado a todas las medidas del spec |
| Tipografías | **Inter** (400/600/700/800) + **JetBrains Mono** (400/600/700) embebidas en base64 (OFL); el bundle serverless no incluye `public/` |
| Gradientes | SVG nativo de react-pdf: rail `#040555→#0a1238`, Total `135° #040555→#1f33c8→#3e62f4`, aurora radial del header |
| Textura de grilla | líneas SVG cada 19pt (28px), `#94a3b8` al 6% |
| Logos | PNGs del paquete embebidos tal cual (`logo-tops-vertical`, `logo-connect-nexus`) — no redibujados |
| Tokens | paleta completa del README §Design Tokens (navy/azules/cyan/emerald/amber/slates/hairlines y blancos de alta legibilidad) |
| Chips de estado | EMITIDA (emerald) / **ANULADA** (rojo) según estado real · ANMAT·COMPLIANCE · SANDBOX/HOMOLOGACION solo fuera de PRODUCCIÓN |
| Datos dinámicos | todos del backend: letra y código de comprobante, N.º, fechas, emisor (fiscal_config — nada hardcodeado), cliente, renglones, totales (con filas condicionales no gravado/exento/percepciones/tributos), importe en letras, CAE/vto., QR fiscal real, rango de servicio, trazabilidad `DOC-{tipo}-{nro}`, aviso de validez por ambiente |
| Adaptación rgba en bordes | react-pdf no soporta alpha en `borderColor` → blends precalculados (`#252e44` = rgba(148,163,184,.14) sobre navy) |

## §3 — Compatibilidad validada

| Caso | Resultado |
|---|---|
| Factura simple (espejo de la 2-3 real, $854.260) | ✅ render fiel (evidencia en Escritorio: `Factura-NuevoDiseno-Simple.png` + PDF) |
| Factura extensa (14 renglones, $4.044.425) | ✅ **multipágina**: el rail y el footer se repiten en cada página (`fixed`), la tabla pagina limpio, totales/trazabilidad nunca se parten (`wrap={false}`) |
| Filas condicionales (exento/percepciones/tributos) | ✅ el bloque Total crece y el gradiente lo cubre |
| NC/ND | ✅ título dinámico ("Nota de Crédito A"), chip ANULADA, prefijo de trazabilidad NCA/NDA |
| Desktop/Mobile/impresión | A4 vertical nativo del PDF (se ve idéntico en cualquier visor); sin márgenes (sangre completa como pide el spec de impresión) |
| Tipos: todos los comprobantes | letra y label derivados de `tipo_comprobante` — sin cambios de lógica |

## §4 — Archivos

| Archivo | Cambio |
|---|---|
| `src/lib/pdf/InvoicePdfDocument.tsx` | reescritura completa (solo visual) |
| `src/lib/pdf/assets/invoice-fonts.ts` | NUEVO — Inter + JetBrains Mono base64 (~3,3MB, licencia OFL) |
| `src/lib/pdf/assets/invoice-logos.ts` | NUEVO — logos del handoff base64 |
| `scripts/qa/render-factura-design.ts` | NUEVO — QA visual reproducible (2 PDFs de muestra sin tocar la base) |

**Sin cambios:** `build.ts`, ruta `/api/invoices/[id]/pdf`, `calc.ts`, emisión, RPC, DB, OrderPdfDocument (el comprobante de OS conserva su diseño actual).

## §5 — Validaciones
tsc 0 · lint 0 · build 0 (✓ Compiled) · render local de ambos casos OK · evidencia visual en Escritorio.

## §6 — Nota
Las facturas existentes (2-1…2-4) se regeneran on-demand: al desplegar, **todas** pasan automáticamente al nuevo diseño — el "reemplazo del diseño anterior" es total y retroactivo, sin migraciones. Validación final sobre comprobante real: abrir el PDF de cualquier factura en `/billing` tras el deploy.
