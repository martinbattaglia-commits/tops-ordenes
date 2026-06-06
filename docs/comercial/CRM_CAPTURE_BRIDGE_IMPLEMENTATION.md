# CRM_CAPTURE_BRIDGE_IMPLEMENTATION — UX-1 (CB-2)

**Frente:** UX-1 Implementation · **Rama:** `feature/crm-comercial-f2-1` · **Fecha:** 2026-06-06
**Objetivo:** implementar el Capture Bridge de [CRM_CAPTURE_BRIDGE_ARCHITECTURE](./CRM_CAPTURE_BRIDGE_ARCHITECTURE.md) con la decisión ratificada **CB-2 = `window.__nexusCapture()`**, persistiendo `crm_quotes(+items)` / `crm_proposals` desde la Ficha 360°.
**Sin Clientify · sin webhook HMAC · sin producción · sin main · sin Netlify.**

---

## 1. Implementación

```
Ficha 360° · tab Cotizaciones/Propuestas
  └─ botón "Cotizar / Generar propuesta"
       └─ CaptureEmbed (host)  ── iframe same-origin /tools/<slug>/index.html
            └─ botón "Guardar en Nexus" (barra del HOST, no toca el artefacto)
                 └─ lee iframe.contentWindow.__nexusCapture()   (CB-2)
                      └─ parseCapture() (Zod)  →  saveCaptureForOpportunity()
                           └─ crm_quotes(+items) / crm_proposals
```

| Pieza | Archivo |
|---|---|
| Contrato + validación (Zod) | `src/lib/comercial/capture-bridge.ts` |
| Server action de persistencia | `src/lib/comercial/capture-actions.ts` |
| Host embed + "Guardar en Nexus" | `src/app/(app)/comercial/oportunidades/[id]/CaptureEmbed.tsx` |
| Wiring en la Ficha 360° | `Opportunity360View.tsx` (tabs Cotizaciones/Propuestas) |
| Hook en artefactos | `public/tools/{cotizador,propuesta-anmat,propuesta-general}/index.html` |

### 1.1 Hook `window.__nexusCapture()` por artefacto (additive, sin tocar la lógica)
| Artefacto | Tipo | Implementación del hook |
|---|---|---|
| **propuesta-anmat** | inline + localStorage | lee `localStorage['tops_propuesta_v1']` / `['tops_anmat_gen_v1']` → `ProposalCapture` ✅ **robusto** |
| **cotizador** | bundle opaco | el bundle **no expone estado** → el hook devuelve `{kind:'quote', unavailable:true, note}` (honesto) |
| **propuesta-general** | bundle opaco | ídem → `{kind:'proposal', tipo:'general', unavailable:true, note}` |

> **Hallazgo honesto:** cotizador y propuesta-general son **bundles base64+gzip sin localStorage ni estado en `window`** (decodificados y verificados). No se les puede agregar un hook robusto sin tocar el bundle (prohibido). El hook existe (contrato CB-2 satisfecho) y declara `unavailable:true` con la nota: para captura robusta, su mantenedor debe definir `window.__nexusCapture` **desde el propio bundle**. `parseCapture` rechaza esos payloads → el host muestra el motivo en vez de persistir basura.

### 1.2 Contrato de payload (Zod)
- `QuoteCapture` → `crm_quotes` (subtotal/desc/iva/total + `items[]` → `crm_quote_items`).
- `ProposalCapture` → `crm_proposals` (tipo + `payload` jsonb).
- `parseCapture()` valida; los `unavailable:true` y los incompletos se rechazan con motivo.

---

## 2. QA

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx next lint` | ✅ sin errores |
| `npm run build` | ✅ Compiled successfully · ficha `[id]` 7,63 kB |

---

## 3. Evidencia

### 3.1 Hook en browser real (Playwright, same-origin http)
- **propuesta-anmat:** `typeof window.__nexusCapture === 'function'` y devolvió:
  ```
  { kind:'proposal', tipo:'anmat', fields:{cliente, razonSocial, cuit, m2…}, raw:{state,…}, source:'localStorage' }
  ```
- **cotizador (bundle):** `{ kind:'quote', unavailable:true, source:'bundle', note:'Artefacto bundleado sin estado expuesto…' }` (honesto).

### 3.2 Captura → validación → persistencia real (staging, tx + rollback)
```
parseCapture(anmat proposal): OK ✅
parseCapture(quote completo):  OK ✅
parseCapture(bundled):         rechazado ✅ → "Artefacto bundleado sin estado expuesto."
PERSISTIDO en staging (rollback): propuesta=PROP-2026-0008 · cotización=COT-2026-0008 (items=1)
RESULTADO UX-1: PASS ✅
```
> El payload capturado real (vía `__nexusCapture()`) se validó con el **mismo `parseCapture`** de la app y se persistió en `crm_proposals` / `crm_quotes(+items)` del **modelo real** (staging). Sin residuos (rollback). Producción intacta.

---

## 4. Persistencia real desde artefactos existentes — estado

| Artefacto | Captura | Persistencia |
|---|---|---|
| **propuesta-anmat** | ✅ `__nexusCapture()` (localStorage) | ✅ `crm_proposals` (probado) |
| **cotizador** | ⚠️ contrato presente; bundle debe exponer estado | ✅ `crm_quotes(+items)` (probado con `QuoteCapture` válido) |
| **propuesta-general** | ⚠️ ídem cotizador | ✅ `crm_proposals` (vía `ProposalCapture`) |

> La **infraestructura del bridge** (host + Zod + server action + persistencia) está **completa y probada**. La **captura** es robusta para el artefacto inline (anmat); los dos bundleados necesitan que su mantenedor exponga `window.__nexusCapture` desde el bundle (1 línea, additive) — ahí el bridge ya los persiste sin más cambios.

---

## 5. Fuera de alcance
Clientify, webhook HMAC, transiciones de etapa con server actions, resolución de owner. **Sin merge · sin main · sin Netlify · sin deploy · sin producción.**
