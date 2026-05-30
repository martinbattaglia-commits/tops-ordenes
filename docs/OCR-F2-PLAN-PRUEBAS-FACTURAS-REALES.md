# OCR de Facturas de Proveedor (F2) — Plan de pruebas con documentos reales

> **Estado:** código commiteado local (`fbda299`), **sin push ni deploy**.
> **Decisión pendiente:** una vez validado contra facturas reales, se decide push + deploy + aplicar migración `0015`.

---

## 1. Objetivo

Validar que el OCR extrae correctamente, contra **facturas reales** de distintos
proveedores, los 7 campos críticos para Cuentas por Pagar:

| # | Campo | Dónde cae en el alta | Fuente en el `ExtractedDocument` |
|---|-------|----------------------|----------------------------------|
| 1 | **Proveedor** (razón social) | `Proveedor *` (match contra la base) | `parties[].role = emisor/proveedor` |
| 2 | **CUIT** | (valida/identifica al proveedor) | `parties[].taxId` |
| 3 | **Fecha de emisión** | `Fecha de emisión *` | `date` |
| 4 | **Neto gravado** | `Neto *` | `amounts[].kind = neto/subtotal` |
| 5 | **IVA** | `IVA *` | `amounts[].kind = iva` |
| 6 | **Total** | `Total comprobante` (calculado neto+iva+percep) | `amounts[].kind = total` (cross-check) |
| 7 | **Observaciones** | `Observaciones` | `summary` |

> Campos extra que también conviene mirar (ya verificados en muestra sintética):
> **Tipo** (Factura A/B/C, NC, ND), **Punto de venta**, **Número**, **CAE**, **Percepciones**, **Vencimiento**.

---

## 2. Preparación del entorno (modo prueba, sin tocar producción)

> El `.env.local` apunta a la Supabase **de producción**, así que las pruebas se
> corren con `DEMO_MODE` para que **NO se escriba nada en la base**: el OCR llama
> a OpenAI de verdad, pero el "Confirmar y guardar" devuelve un id sintético sin
> INSERT. Es seguro para producción.

```bash
cd ~/CODE/tops-ordenes
# Levantar el server de prueba (OCR real, sin writes a DB)
nohup env NEXT_PUBLIC_DEMO_MODE=1 PORT=3030 npm run dev \
  > /tmp/ocr-pruebas.log 2>&1 & disown
# Esperar a que levante y verificar
curl -s -o /dev/null -w "dev:%{http_code}\n" http://localhost:3030/
```

- **UI:** http://localhost:3030/compras/facturas/nueva
- **Requisito:** `OPENAI_API_KEY` cargada en `.env.local` (ya está y funcionando).

### Juntar los documentos
Dejar las facturas reales en una carpeta, p. ej. `~/CODE/facturas-test/`:

```bash
mkdir -p ~/CODE/facturas-test
# copiar ahí los PDF / fotos reales
ls -la ~/CODE/facturas-test
```

Formatos aceptados: **PDF, JPG, PNG, WebP** · hasta **12 MB** c/u.

---

## 3. Dos formas de probar cada documento

### A) Prueba rápida por API (ver el JSON crudo del OCR)
Útil para auditar exactamente qué devolvió el modelo, campo por campo:

```bash
F=~/CODE/facturas-test/NOMBRE-DEL-ARCHIVO.pdf   # o .jpg/.png
curl -s -X POST http://localhost:3030/api/documental/ocr \
  -F "file=@${F};type=application/pdf" \
  | python3 -m json.tool
```
> Para imágenes cambiar `type=application/pdf` por `image/jpeg` o `image/png`.

### B) Prueba de UI completa (flujo real que va a usar la gente)
1. Abrir http://localhost:3030/compras/facturas/nueva
2. Arrastrar la factura al recuadro (o tocar para elegir).
3. Esperar la lectura (~5–12 s). Verificar el **preview** del documento.
4. Revisar cada campo precompletado y su **badge de confianza**
   (Alta / Media / Revisar / vacío).
5. **No** se guarda nada hasta tocar **"Confirmar y guardar"** (en demo no escribe DB).

---

## 4. Matriz de cobertura (elegir facturas reales que cubran estos casos)

Marcar con una factura real cada escenario. Cuantos más cubra, mejor.

- [ ] **Factura A** digital (PDF con texto) — caso más común
- [ ] **Factura B** o **C** (consumidor final / monotributo)
- [ ] **Factura escaneada / foto** (sin capa de texto → camino Vision)
- [ ] Proveedor **que SÍ está en la base** (debería matchear por CUIT → "Alta")
- [ ] Proveedor **que NO está en la base** (debería mostrar "Revisar" + nombre detectado)
- [ ] Con **percepciones** (IIBB / ganancias) además de IVA
- [ ] Con **IVA en varias alícuotas** (21% + 10,5%) — verificar que sume bien
- [ ] **Nota de crédito** y/o **Nota de débito**
- [ ] Importe **grande** (millones, con separadores de miles) — verificar parseo
- [ ] Factura **multipágina** (PDF de 2+ hojas)
- [ ] (Si aplica) Factura en **USD**

---

## 5. Planilla de resultados (una por documento)

Copiar este bloque por cada factura probada:

```
────────────────────────────────────────────────────────
Archivo:            ____________________________________
Proveedor (real):   ____________________________________
Tipo / origen:      [ ] PDF digital  [ ] escaneada/foto
────────────────────────────────────────────────────────
Campo            | Valor REAL (doc) | Valor OCR | Conf.  | ✓/✗ | Nota
-----------------|------------------|-----------|--------|-----|------
1 Proveedor      |                  |           |        |     |
2 CUIT           |                  |           |        |     |
3 Fecha emisión  |                  |           |        |     |
4 Neto gravado   |                  |           |        |     |
5 IVA            |                  |           |        |     |
6 Total          |                  |           |        |     |
7 Observaciones  |                  |           |        |     |
-- extra --      |                  |           |        |     |
  Punto de venta |                  |           |        |     |
  Número         |                  |           |        |     |
  CAE            |                  |           |        |     |
  Percepciones   |                  |           |        |     |
────────────────────────────────────────────────────────
Tiempo de lectura: ______ s   |   Modelo: gpt-4o-mini
Incidencias / ajustes sugeridos:
  ______________________________________________________
```

---

## 6. Criterios de aceptación (Go / No-Go)

**Listo para push + deploy** cuando, sobre la muestra real probada:

- [ ] **Proveedor + CUIT**: correctos en **≥ 90%** de los documentos
      (y cuando el proveedor está en la base, matchea por CUIT con "Alta").
- [ ] **Fecha de emisión**: correcta en **≥ 95%**.
- [ ] **Neto, IVA y Total**: los tres correctos y **consistentes**
      (`neto + iva + percepciones ≈ total`, tolerancia ±1%) en **≥ 95%**.
- [ ] **Cero falsos "Alta"** en campos que en realidad estaban mal
      (más grave que un "Revisar" de más).
- [ ] El flujo nunca rompe: documento ilegible / no soportado → mensaje claro y
      **se puede cargar a mano** igual.
- [ ] Ningún documento provoca error 500 en `/api/documental/ocr`.

> Un campo mal con badge **"Revisar"/"Media"** NO bloquea: la idea de F2 es que
> el humano confirma. Lo que bloquea es **un dato incorrecto mostrado como "Alta"**.

---

## 7. Casos borde a vigilar (aprendido en la muestra sintética)

- **Punto de venta y CAE en fotos**: el camino Vision no deja texto bruto; por eso
  se agregó el bloque discreto `comprobante`. Confirmar que en facturas
  **escaneadas reales** el PV y el CAE siguen saliendo bien.
- **Separadores de miles AR** (`1.234.567,89`): debe quedar como número
  `1234567.89`, no `1.234`.
- **Múltiples alícuotas de IVA**: hoy se toma el `kind="iva"`; si la factura trae
  21% y 10,5% por separado, anotar si conviene sumarlas (posible ajuste).
- **Proveedor no reconocido**: debe ofrecer crearlo/seleccionarlo, nunca inventar match.

---

## 8. Al terminar las pruebas

```bash
# Bajar el server de prueba
pkill -f "next dev"
```

- Anotar incidencias en la sección 5/6 de este archivo.
- Si hay ajustes de prompt/mapeo, se hacen sobre `main` local y se re-prueba.
- **Recién con el Go de la sección 6** se decide `git push origin main` + deploy
  Netlify + aplicar la migración `0015` en Supabase (crear bucket
  `supplier-invoices`).

---

### Apéndice — pasos de go-live (solo cuando se apruebe)
1. Aplicar `supabase/migrations/0015_supplier_invoice_attachments.sql` en Supabase.
2. Confirmar `OPENAI_API_KEY` en env vars de Netlify.
3. `git push origin main` → Netlify deploya.
